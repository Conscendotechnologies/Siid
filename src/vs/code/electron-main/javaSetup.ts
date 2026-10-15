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
 * Sets up the Java Development Kit environment for Salesforce development.
 * This function:
 * 1. Checks if Java is already available in the system
 * 2. Detects JDK installed by the Siid installer
 * 3. Detects system-wide Java installations
 * 4. Sets JAVA_HOME and updates PATH for the current process
 * 5. Only runs once per installation (tracked via state service)
 *
 * Priority order:
 * 1. JAVA_HOME from Machine environment (set by installer)
 * 2. JAVA_HOME from User environment
 * 3. Java found in PATH
 * 4. Standard installation locations
 *
 * @param logService - The log service for logging messages
 * @param stateService - The state service for tracking whether setup has been completed
 */
export async function setupJavaEnvironment(logService: ILogService, stateService: IStateService): Promise<void> {
	// Check if we've already set up Java
	const isSetup = stateService.getItem<boolean>('java.environmentSetup');
	if (isSetup) {
		logService.trace('Java environment already configured, skipping setup');
		return;
	}

	logService.info('Setting up Java environment...');

	try {
		// Method 1: Check JAVA_HOME from Machine environment (set by installer or system admin)
		if (isWindows) {
			const getJavaHomeCmd = `powershell -Command "[Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine')"`;
			const { stdout: machineJavaHome } = await execAsync(getJavaHomeCmd);
			const javaHome = machineJavaHome.trim();

			if (javaHome && fs.existsSync(javaHome)) {
				const javaExe = path.join(javaHome, 'bin', 'java.exe');
				if (fs.existsSync(javaExe)) {
					process.env.JAVA_HOME = javaHome;
					const javaBin = path.join(javaHome, 'bin');
					process.env.PATH = `${javaBin}${path.delimiter}${process.env.PATH}`;

					// Verify Java version
					try {
						const { stdout: version } = await execAsync(`"${javaExe}" -version`);
						logService.info('Using Java from Machine JAVA_HOME:', javaHome);
						logService.info('Java version:', version.split('\n')[0]);

						await stateService.setItem('java.environmentSetup', true);
						await stateService.setItem('java.source', 'machine');
						return;
					} catch (error) {
						logService.warn('Java executable found but failed to get version:', error);
					}
				}
			}
		}

		// Method 2: Check JAVA_HOME from User environment
		if (isWindows) {
			const getUserJavaHomeCmd = `powershell -Command "[Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')"`;
			const { stdout: userJavaHome } = await execAsync(getUserJavaHomeCmd);
			const javaHome = userJavaHome.trim();

			if (javaHome && fs.existsSync(javaHome)) {
				const javaExe = path.join(javaHome, 'bin', 'java.exe');
				if (fs.existsSync(javaExe)) {
					process.env.JAVA_HOME = javaHome;
					const javaBin = path.join(javaHome, 'bin');
					process.env.PATH = `${javaBin}${path.delimiter}${process.env.PATH}`;

					try {
						const { stdout: version } = await execAsync(`"${javaExe}" -version`);
						logService.info('Using Java from User JAVA_HOME:', javaHome);
						logService.info('Java version:', version.split('\n')[0]);

						await stateService.setItem('java.environmentSetup', true);
						await stateService.setItem('java.source', 'user');
						return;
					} catch (error) {
						logService.warn('Java executable found but failed to get version:', error);
					}
				}
			}
		}

		// Method 3: Try to detect java in PATH
		try {
			const whereCmd = isWindows ? 'where java' : 'which java';
			const { stdout: javaPath } = await execAsync(whereCmd);
			const javaExe = javaPath.trim().split('\n')[0];

			if (javaExe && fs.existsSync(javaExe)) {
				const { stdout: version } = await execAsync(`"${javaExe}" -version`);
				logService.info('Java found in system PATH:', javaExe);
				logService.info('Java version:', version.split('\n')[0]);

				// Try to determine JAVA_HOME from java.exe location
				// Typically: C:\Program Files\Java\jdk-17\bin\java.exe -> C:\Program Files\Java\jdk-17
				const javaBinDir = path.dirname(javaExe);
				const javaHome = path.dirname(javaBinDir);

				if (fs.existsSync(javaHome)) {
					process.env.JAVA_HOME = javaHome;
					logService.info('Derived JAVA_HOME from PATH:', javaHome);
				}

				await stateService.setItem('java.environmentSetup', true);
				await stateService.setItem('java.source', 'path');
				return;
			}
		} catch (error) {
			logService.trace('Java not found in PATH:', error);
		}

		// Method 4: Check standard installation locations (last resort)
		if (isWindows) {
			const commonLocations = [
				path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
				path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
				path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Java'),
			];

			for (const baseLocation of commonLocations) {
				if (fs.existsSync(baseLocation)) {
					try {
						const jdkDirs = fs.readdirSync(baseLocation)
							.filter(dir => dir.toLowerCase().includes('jdk'))
							.sort()
							.reverse(); // Get latest version first

						for (const jdkDir of jdkDirs) {
							const javaHome = path.join(baseLocation, jdkDir);
							const javaExe = path.join(javaHome, 'bin', 'java.exe');

							if (fs.existsSync(javaExe)) {
								process.env.JAVA_HOME = javaHome;
								const javaBin = path.join(javaHome, 'bin');
								process.env.PATH = `${javaBin}${path.delimiter}${process.env.PATH}`;

								try {
									const { stdout: version } = await execAsync(`"${javaExe}" -version`);
									logService.info('Found Java in standard location:', javaHome);
									logService.info('Java version:', version.split('\n')[0]);

									await stateService.setItem('java.environmentSetup', true);
									await stateService.setItem('java.source', 'discovered');
									return;
								} catch (error) {
									logService.trace('Failed to verify Java at:', javaHome);
								}
							}
						}
					} catch (error) {
						logService.trace('Error scanning location:', baseLocation, error);
					}
				}
			}
		}

		// No Java found
		logService.warn('No Java installation detected. Java features may not work properly.');
		logService.warn('Please install Java Development Kit 17 or later for full Salesforce development features.');
		logService.warn('You can run the Siid installer again and select the "Download and install JDK" option.');

		// Mark as setup attempted (to avoid repeated checks)
		await stateService.setItem('java.environmentSetup', true);
		await stateService.setItem('java.source', 'none');

	} catch (error) {
		logService.error('Error during Java environment setup:', error);
		// Still mark as setup to avoid repeated failures
		await stateService.setItem('java.environmentSetup', true);
		await stateService.setItem('java.source', 'error');
	}
}

/**
 * Checks if Java is available and returns the version information
 * @param logService - The log service for logging messages
 * @returns Java version string or null if not available
 */
export async function getJavaVersion(logService: ILogService): Promise<string | null> {
	try {
		const javaCmd = isWindows ? 'java' : 'java';
		const { stdout, stderr } = await execAsync(`${javaCmd} -version`);
		const versionOutput = stderr || stdout;
		const versionMatch = versionOutput.match(/version "(.+?)"/);

		if (versionMatch) {
			return versionMatch[1];
		}

		return versionOutput.split('\n')[0];
	} catch (error) {
		logService.trace('Failed to get Java version:', error);
		return null;
	}
}
