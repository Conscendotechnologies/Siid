import * as vscode from 'vscode';
import { PackagedExtensionManager, InstalledExtensionMeta, InstallResult } from './PackagedExtensionManager';
import { MarketplaceLogger } from './MarketplaceLogger';
import { autoUpdateKey, splitUpdates, staleAutoUpdateKeys } from './updatePolicy';

function displayNames(extensions: InstalledExtensionMeta[]): string {
	return extensions.map(ext => ext.displayName || ext.fileName).join(', ');
}

function reportInstallFailures(failed: InstalledExtensionMeta[], logger: MarketplaceLogger, action: 'Installing' | 'Updating'): void {
	const verb = action === 'Installing' ? 'install' : 'update';
	logger.error(`Failed to ${verb}: ${displayNames(failed)}`);
	vscode.window.showErrorMessage(`Failed to ${verb} ${displayNames(failed)}. See the Marketplace output for details.`);
}

function showReloadPrompt(count: number, logger: MarketplaceLogger): void {
	logger.info(`Showing the reload prompt for ${count} extension${count > 1 ? 's' : ''}`);
	vscode.window.showInformationMessage(
		`Successfully updated ${count} extension${count > 1 ? 's' : ''}. Please reload window to apply changes.`,
		'Reload Window'
	).then(selection => {
		if (selection === 'Reload Window') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	});
}

async function installExtensionsWithBlockingModal(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<void> {
	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	// Show blocking modal overlay (blocks UI but not background processes)
	const title = `${action} Extensions`;
	const message = `${action} ${extensions.length} extension${extensions.length > 1 ? 's' : ''}. Please wait...`;
	logger.info(`[BLOCKING_MODAL] Showing blocking modal overlay`);
	try {
		const result = await vscode.commands.executeCommand('_showBlockingProgress', title, message);
		logger.info(`[BLOCKING_MODAL] Command returned: ${JSON.stringify(result)}`);
	} catch (err) {
		logger.error(`[BLOCKING_MODAL] Failed to show modal: ${err}`);
	}

	let showRestart = false;
	try {
		const failed: InstalledExtensionMeta[] = [];

		for (let i = 0; i < extensions.length; i++) {
			const ext = extensions[i];

			// Update status bar
			statusBarItem.text = `$(sync~spin) ${action} ${i + 1}/${extensions.length}: ${ext.displayName || ext.fileName}`;
			logger.info(`${action} ${ext.displayName || ext.fileName} (${i + 1}/${extensions.length})`);

			// Update blocking modal message with current progress
			const progressMessage = `${action} ${i + 1}/${extensions.length}: ${ext.displayName || ext.fileName}`;
			try {
				await vscode.commands.executeCommand('_updateBlockingProgressMessage', progressMessage);
				await vscode.commands.executeCommand('_updateBlockingProgress', i + 1, extensions.length);
			} catch (err) {
				logger.error(`[BLOCKING_MODAL] Failed to update modal: ${err}`);
			}

			// Install this extension
			failed.push(...(await packagedManager.installExtensions([ext])).failed);
		}

		if (failed.length > 0) {
			statusBarItem.text = `$(error) ${action} failed: ${displayNames(failed)}`;
			reportInstallFailures(failed, logger, action);
		} else {
			statusBarItem.text = `$(check) ${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;
			logger.info(`${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`);
			showRestart = action === 'Updating';
		}
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		logger.error(`${action} failed: ${err}`);
		throw err;
	} finally {
		// Clean up status bar after a delay
		setTimeout(() => statusBarItem.dispose(), 5000);

		// Handle completion based on the outcome
		if (showRestart) {
			// For successful updates, show restart buttons on the blocking modal
			logger.info('[BLOCKING_MODAL] Showing restart buttons on modal');
			setTimeout(async () => {
				try {
					// Show restart buttons on custom blocking dialog
					await vscode.commands.executeCommand('_showBlockingProgressRestartButtons');
				} catch (err) {
					logger.error(`[BLOCKING_MODAL] Failed to show restart buttons: ${err}`);
				}
			}, 500);
		} else {
			// For fresh installs and failures, auto-close the modal
			logger.info('[BLOCKING_MODAL] Closing modal overlay');
			setTimeout(async () => {
				try {
					const result = await vscode.commands.executeCommand('_closeBlockingProgress');
					logger.info(`[BLOCKING_MODAL] Close command returned: ${JSON.stringify(result)}`);
				} catch (err) {
					logger.error(`[BLOCKING_MODAL] Failed to close modal: ${err}`);
				}
			}, 500);
		}
	}
}

async function installExtensionsWithStatusBar(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<InstallResult> {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	try {
		logger.info(`${action} ${displayNames(extensions)}`);

		const result = await packagedManager.installExtensions(extensions);
		setTimeout(() => statusBarItem.dispose(), 5000);

		if (result.failed.length > 0) {
			statusBarItem.text = `$(error) ${action} failed: ${displayNames(result.failed)}`;
			reportInstallFailures(result.failed, logger, action);
			return result;
		}

		statusBarItem.text = `$(check) ${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;

		// Only show reload prompt for updates, not for new installations
		if (action === 'Updating' && extensions.length > 0) {
			showReloadPrompt(extensions.length, logger);
		}
		return result;
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		setTimeout(() => statusBarItem.dispose(), 5000);
		logger.error(`${action} failed: ${err}`);
		throw err;
	}
}

/** The record is written only on success, so a failed install retries at the next start. */
async function installRequiredUpdates(
	context: vscode.ExtensionContext,
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger
): Promise<void> {
	const { succeeded } = await installExtensionsWithStatusBar(packagedManager, extensions, logger, 'Updating');
	await Promise.all(succeeded.map(ext => context.globalState.update(autoUpdateKey(ext), true)));
}

export async function activate(context: vscode.ExtensionContext) {
	const logger = new MarketplaceLogger();
	logger.info('Marketplace extension activated v1');

	const packagedManager = new PackagedExtensionManager(context);

	const ready = (async () => {
		await packagedManager.loadPackagedExtensions();
		logger.info('Loaded packaged extensions metadata');
		packagedManager.checkInstalledExtensions();
		logger.info('Checked installed extensions');
	})();

	// Registered before anything is awaited: Agents mode can run this command while activation is still installing.
	const updateAllCommand = vscode.commands.registerCommand('marketplace.updateAllExtensions', async () => {
		try {
			await ready;
			const meta = packagedManager.getInstalledExtensionsMeta();
			const toUpdate = meta.filter(ext => ext.needsUpdate);
			if (toUpdate.length === 0) {
				vscode.window.showInformationMessage('All extensions are up to date.');
				return;
			}

			await installExtensionsWithBlockingModal(packagedManager, toUpdate, logger, 'Updating');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to update extensions: ${err}`, { modal: true });
			logger.error(`Update failed: ${err}`);
		}
	});

	context.subscriptions.push(updateAllCommand, logger);

	try {
		await ready;
		const installedMeta = packagedManager.getInstalledExtensionsMeta();
		logger.info(`Installed extensions metadata: ${JSON.stringify(installedMeta, null, 2)}`);

		await Promise.all(staleAutoUpdateKeys(context.globalState.keys(), installedMeta).map(key => context.globalState.update(key, undefined)));

		// Separate new installations from updates
		const newExtensions = installedMeta.filter(ext => !ext.installed);
		const updates = installedMeta.filter(ext => ext.needsUpdate);

		// Automatically install new extensions with blocking modal
		if (newExtensions.length > 0) {
			logger.info(`Found ${newExtensions.length} new extensions to install automatically`);
			await installExtensionsWithBlockingModal(packagedManager, newExtensions, logger, 'Installing');
		}

		const { automatic, alreadyInstalled, optional } = splitUpdates(updates, key => context.globalState.get<boolean>(key) === true);

		// Recorded as installed but still running older. Without the version on disk a reload changes nothing, so don't ask.
		const waitingForReload = alreadyInstalled.filter(ext => packagedManager.isVersionOnDisk(ext));
		if (waitingForReload.length > 0) {
			logger.info(`Already installed, waiting for a reload: ${displayNames(waitingForReload)}`);
			showReloadPrompt(waitingForReload.length, logger);
		}
		if (waitingForReload.length < alreadyInstalled.length) {
			logger.info(`Recorded as installed, but not on disk: ${displayNames(alreadyInstalled.filter(ext => !waitingForReload.includes(ext)))}`);
		}

		// Required updates install in the background, without blocking activation
		if (automatic.length > 0) {
			logger.info(`Found ${automatic.length} required updates to install automatically: ${displayNames(automatic)}`);
			installRequiredUpdates(context, packagedManager, automatic, logger).catch(err => logger.error(`Automatic update failed: ${err}`));
		}

		// Optional updates only get a notification
		if (optional.length > 0) {
			const message = `Found ${optional.length} extension${optional.length > 1 ? 's' : ''} that need${optional.length === 1 ? 's' : ''} to be updated.`;
			const action = 'Update All';
			vscode.window.showInformationMessage(message, action).then(selection => {
				if (selection === action) {
					vscode.commands.executeCommand('marketplace.updateAllExtensions');
				}
			});
		}
	} catch (err) {
		logger.error(`Error initializing PackagedExtensionManager: ${err}`);
	}
}

export function deactivate() {
	// Add any necessary cleanup logic here
}
