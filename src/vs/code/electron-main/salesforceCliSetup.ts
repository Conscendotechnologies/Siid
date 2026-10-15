/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { ILogService } from '../../platform/log/common/log.js';
import { IStateService } from '../../platform/state/node/state.js';
import { isWindows } from '../../base/common/platform.js';

const execAsync = promisify(exec);

/**
 * Sets up the Salesforce CLI environment.
 * This function:
 * 1. Checks if Salesforce CLI is already available in the system
 * 2. Detects CLI installed by the Siid installer
 * 3. Detects system-wide Salesforce CLI installations
 * 4. Updates PATH for the current process if needed
 * 5. Only runs once per installation (tracked via state service)
 *
 * Priority order:
 * 1. 'sf' command in PATH (modern CLI)
 * 2. 'sfdx' command in PATH (legacy CLI)
 * 3. Standard installation locations (%LOCALAPPDATA%\sf, %LOCALAPPDATA%\sfdx)
 * 4. Bundled CLI (if present in app resources)
 *
 * @param logService - The log service for logging messages
 * @param stateService - The state service for tracking whether setup has been completed
 */
export async function setupSalesforceCliPath(logService: ILogService, stateService: IStateService): Promise<void> {
	// Check if we've already set up the Salesforce CLI
	const isSetup = stateService.getItem<boolean>('salesforce.cliPathSetup');
	if (isSetup) {
		logService.trace('Salesforce CLI path already configured, skipping setup');
		return;
	}

	logService.info('Setting up Salesforce CLI...');

	try {
		// Method 1: Check if 'sf' command is available in PATH (modern CLI)
		try {
			const { stdout } = await execAsync('sf --version');
			if (stdout) {
				logService.info('Salesforce CLI (sf) found in system PATH');
				logService.info('SF Version:', stdout.trim().split('\n')[0]);

				stateService.setItem('salesforce.cliPathSetup', true);
				stateService.setItem('salesforce.cliSource', 'path-sf');
				return;
			}
		} catch (error) {
			logService.trace('sf command not found in PATH');
		}

		// Method 2: Check if 'sfdx' command is available in PATH (legacy CLI)
		try {
			const { stdout } = await execAsync('sfdx --version');
			if (stdout) {
				logService.info('Salesforce CLI (sfdx) found in system PATH');
				logService.info('SFDX Version:', stdout.trim().split('\n')[0]);

				stateService.setItem('salesforce.cliPathSetup', true);
				stateService.setItem('salesforce.cliSource', 'path-sfdx');
				return;
			}
		} catch (error) {
			logService.trace('sfdx command not found in PATH');
		}

		// Method 3: Check standard installation locations
		if (isWindows) {
			const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');

			// Check for modern SF CLI
			const sfCliPath = path.join(localAppData, 'sf', 'bin');
			const sfExe = path.join(sfCliPath, 'sf.exe');

			if (fs.existsSync(sfExe)) {
				process.env.PATH = `${sfCliPath}${path.delimiter}${process.env.PATH}`;

				try {
					const { stdout } = await execAsync(`"${sfExe}" --version`);
					logService.info('Salesforce CLI (sf) found at:', sfCliPath);
					logService.info('SF Version:', stdout.trim().split('\n')[0]);

					stateService.setItem('salesforce.cliPathSetup', true);
					stateService.setItem('salesforce.cliSource', 'local-sf');
					return;
				} catch (error) {
					logService.warn('Found sf.exe but failed to get version:', error);
				}
			}

			// Check for legacy SFDX CLI
			const sfdxCliPath = path.join(localAppData, 'sfdx', 'bin');
			const sfdxExe = path.join(sfdxCliPath, 'sfdx.exe');

			if (fs.existsSync(sfdxExe)) {
				process.env.PATH = `${sfdxCliPath}${path.delimiter}${process.env.PATH}`;

				try {
					const { stdout } = await execAsync(`"${sfdxExe}" --version`);
					logService.info('Salesforce CLI (sfdx) found at:', sfdxCliPath);
					logService.info('SFDX Version:', stdout.trim().split('\n')[0]);

					stateService.setItem('salesforce.cliPathSetup', true);
					stateService.setItem('salesforce.cliSource', 'local-sfdx');
					return;
				} catch (error) {
					logService.warn('Found sfdx.exe but failed to get version:', error);
				}
			}
		}

		// Method 4: Check bundled CLI (fallback for legacy bundled approach)
		const appResourcesPath = process.resourcesPath;
		const bundledCliPath = path.join(appResourcesPath, 'app', 'node_modules', '.bin');

		if (fs.existsSync(bundledCliPath)) {
			const sfExe = path.join(bundledCliPath, isWindows ? 'sf.cmd' : 'sf');
			const sfdxExe = path.join(bundledCliPath, isWindows ? 'sfdx.cmd' : 'sfdx');

			if (fs.existsSync(sfExe) || fs.existsSync(sfdxExe)) {
				process.env.PATH = `${bundledCliPath}${path.delimiter}${process.env.PATH}`;

				try {
					const testExe = fs.existsSync(sfExe) ? sfExe : sfdxExe;
					const { stdout } = await execAsync(`"${testExe}" --version`);
					logService.info('Using bundled Salesforce CLI from:', bundledCliPath);
					logService.info('CLI Version:', stdout.trim().split('\n')[0]);

					stateService.setItem('salesforce.cliPathSetup', true);
					stateService.setItem('salesforce.cliSource', 'bundled');
					return;
				} catch (error) {
					logService.warn('Found bundled CLI but failed to get version:', error);
				}
			}
		}

		// No Salesforce CLI found
		logService.warn('No Salesforce CLI installation detected.');
		logService.warn('Please install Salesforce CLI for full Salesforce development features.');
		logService.warn('You can run the Siid installer again and select the "Download and install Salesforce CLI" option.');
		logService.warn('Or download manually from: https://developer.salesforce.com/tools/salesforcecli');

		// Mark as setup attempted (to avoid repeated checks)
		stateService.setItem('salesforce.cliPathSetup', true);
		stateService.setItem('salesforce.cliSource', 'none');

	} catch (error) {
		logService.error('Error during Salesforce CLI setup:', error);
		// Still mark as setup to avoid repeated failures
		stateService.setItem('salesforce.cliPathSetup', true);
		stateService.setItem('salesforce.cliSource', 'error');
	}
}

/**
 * Checks if Salesforce CLI is available and returns the version information
 * @param logService - The log service for logging messages
 * @returns CLI version string or null if not available
 */
export async function getSalesforceCliVersion(logService: ILogService): Promise<string | null> {
	try {
		// Try 'sf' first (modern CLI)
		try {
			const { stdout } = await execAsync('sf --version');
			return stdout.trim().split('\n')[0];
		} catch {
			// Try 'sfdx' (legacy CLI)
			const { stdout } = await execAsync('sfdx --version');
			return stdout.trim().split('\n')[0];
		}
	} catch (error) {
		logService.trace('Failed to get Salesforce CLI version:', error);
		return null;
	}
}
