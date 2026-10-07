import * as vscode from 'vscode';
import { PackagedExtensionManager, InstalledExtensionMeta } from './PackagedExtensionManager';
import { MarketplaceLogger } from './MarketplaceLogger';
import { withSiidProgress } from './siidProgress';

async function installExtensionsWithBlockingModal(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<void> {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	const count = `${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;
	try {
		await withSiidProgress({
			title: `${action} Extensions`,
			message: `${action} ${count}. Please wait...`,
			total: extensions.length,
			details: action === 'Installing'
				? ['Extensions are being configured for your workspace.', 'This process may take 2-3 minutes.']
				: undefined
		}, async progress => {
			const folder = packagedManager.getPackagedExtensionsFolder();
			const fs = await import('fs');
			const path = await import('path');

			for (let i = 0; i < extensions.length; i++) {
				const ext = extensions[i];
				const name = ext.displayName || ext.fileName;
				statusBarItem.text = `$(sync~spin) ${action} ${i + 1}/${extensions.length}: ${name}`;
				logger.info(`${action} ${name} (${i + 1}/${extensions.length})`);
				progress.report({ message: `${action} ${i + 1}/${extensions.length}: ${name}`, current: i });

				try {
					const vsixPath = path.join(folder, ext.fileName);
					if (!fs.existsSync(vsixPath)) {
						logger.error(`VSIX not found: ${vsixPath}`);
						continue;
					}
					logger.info(`Installing ${ext.displayName} from ${vsixPath}`);
					await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath), { donotVerifySignature: true });
					logger.info(`Successfully installed ${ext.displayName}`);
				} catch (err) {
					logger.error(`Failed to install ${ext.displayName}: ${err}`);
				}
				progress.report({ current: i + 1 });
			}

			statusBarItem.text = `$(check) ${action} complete: ${count}`;
			logger.info(`${action} complete: ${count}`);
			if (action === 'Updating') {
				progress.setResult({
					message: 'Update complete! A window reload is required to apply the changes.',
					actions: [
						{ label: 'Later' },
						{ label: 'Reload Window', primary: true, command: 'workbench.action.reloadWindow' }
					]
				});
			}
		});
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		logger.error(`${action} failed: ${err}`);
		throw err;
	} finally {
		setTimeout(() => statusBarItem.dispose(), 5000);
	}
}

async function installExtensionsWithStatusBar(
	packagedManager: PackagedExtensionManager,
	extensions: InstalledExtensionMeta[],
	logger: MarketplaceLogger,
	action: 'Installing' | 'Updating'
): Promise<void> {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = `$(sync~spin) ${action} extensions...`;
	statusBarItem.show();

	try {
		for (let i = 0; i < extensions.length; i++) {
			const ext = extensions[i];
			statusBarItem.text = `$(sync~spin) ${action} extenions...`;
			logger.info(`${action} ${ext.displayName || ext.fileName}`);
		}

		await packagedManager.installExtensions(extensions);

		statusBarItem.text = `$(check) ${action} complete: ${extensions.length} extension${extensions.length > 1 ? 's' : ''}`;
		setTimeout(() => statusBarItem.dispose(), 5000);

		// Only show reload prompt for updates, not for new installations
		if (action === 'Updating' && extensions.length > 0) {
			vscode.window.showInformationMessage(
				`Successfully updated ${extensions.length} extension${extensions.length > 1 ? 's' : ''}. Please reload window to apply changes.`,
				'Reload Window'
			).then(selection => {
				if (selection === 'Reload Window') {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		}
	} catch (err) {
		statusBarItem.text = `$(error) ${action} failed`;
		setTimeout(() => statusBarItem.dispose(), 5000);
		logger.error(`${action} failed: ${err}`);
		throw err;
	}
}

export async function activate(context: vscode.ExtensionContext) {
	const logger = new MarketplaceLogger();
	logger.info('Marketplace extension activated v1');

	const packagedManager = new PackagedExtensionManager(context);
	try {
		await packagedManager.loadPackagedExtensions();
		logger.info('Loaded packaged extensions metadata');
		packagedManager.checkInstalledExtensions();
		logger.info('Checked installed extensions');
		const installedMeta = packagedManager.getInstalledExtensionsMeta();
		logger.info(`Installed extensions metadata: ${JSON.stringify(installedMeta, null, 2)}`);

		// Separate new installations from updates
		const newExtensions = installedMeta.filter(ext => !ext.installed);
		const updates = installedMeta.filter(ext => ext.needsUpdate);

		// Automatically install new extensions with blocking modal
		if (newExtensions.length > 0) {
			logger.info(`Found ${newExtensions.length} new extensions to install automatically`);
			await installExtensionsWithBlockingModal(packagedManager, newExtensions, logger, 'Installing');
		}

		// Show notification only for updates
		if (updates.length > 0) {
			const message = `Found ${updates.length} extension${updates.length > 1 ? 's' : ''} that need${updates.length === 1 ? 's' : ''} to be updated.`;
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

	const updateAllCommand = vscode.commands.registerCommand('marketplace.updateAllExtensions', async () => {
		try {
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
}

export function deactivate() {
	// Add any necessary cleanup logic here
}
