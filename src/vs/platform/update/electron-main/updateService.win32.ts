/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { hash } from '../../../base/common/hash.js';
import * as path from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { checksum } from '../../../base/node/crypto.js';
import * as pfs from '../../../base/node/pfs.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, DisablementReason, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, parseGitHubReleaseToUpdate, UpdateErrorClassification } from './abstractUpdateService.js';

async function pollUntil(fn: () => boolean, millis = 1000): Promise<void> {
	while (!fn()) {
		await timeout(millis);
	}
}

interface IAvailableUpdate {
	packagePath: string;
	updateFilePath?: string;
}

let _updateType: UpdateType | undefined = undefined;
function getUpdateType(): UpdateType {
	if (typeof _updateType === 'undefined') {
		_updateType = fs.existsSync(path.join(path.dirname(process.execPath), 'unins000.exe'))
			? UpdateType.Setup
			: UpdateType.Archive;
	}

	return _updateType;
}

export class Win32UpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private availableUpdate: IAvailableUpdate | undefined;

	@memoize
	get cachePath(): Promise<string> {
		const result = path.join(tmpdir(), `vscode-${this.productService.quality}-${this.productService.target}-${process.arch}`);
		return fs.promises.mkdir(result, { recursive: true }).then(() => result);
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		if (this.productService.target === 'user' && await this.nativeHostMainService.isAdmin(undefined)) {
			this.setState(State.Disabled(DisablementReason.RunningAsAdmin));
			this.logService.info('update#ctor - updates are disabled due to running as Admin in user setup');
			return;
		}

		await super.initialize();
	}

	protected buildUpdateFeedUrl(quality: string): string | undefined {
		let platform = `win32-${process.arch}`;

		if (getUpdateType() === UpdateType.Archive) {
			platform += '-archive';
		} else if (this.productService.target === 'user') {
			platform += '-user';
		}

		const url = createUpdateURL(platform, quality, this.productService);
		this.logService.trace('[Update] buildUpdateFeedUrl - platform:', platform, 'quality:', quality, 'url:', url);
		return url;
	}

	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.url) {
			this.logService.trace('[DEBUG-UPDATE] Win32UpdateService MAIN No update URL configured');
			return;
		}

		const url = explicit ? this.url : `${this.url}?bg=true`;
		this.setState(State.CheckingForUpdates(explicit));

		// Check if using GitHub API
		const isGitHub = this.productService.updateUrl?.includes('api.github.com');
		this.logService.trace('[Update] checkForUpdates - explicit:', explicit, 'isGitHub:', isGitHub, 'request url:', url);
		console.log('[UpdateService] checkForUpdates - explicit:', explicit, 'isGitHub:', isGitHub, 'request url:', url);


		this.requestService.request({ url }, CancellationToken.None)
			.then<any>(asJson)
			.then(response => {
				const updateType = getUpdateType();
				let update: IUpdate | null = null;

				if (isGitHub) {
					// Parse GitHub release response
					// Build the platform string directly instead of extracting from URL
					let platform = `win32-${process.arch}`;
					if (getUpdateType() === UpdateType.Archive) {
						platform += '-archive';
					} else if (this.productService.target === 'user') {
						platform += '-user';
					}
					update = parseGitHubReleaseToUpdate(response, platform, this.productService, this.logService);
					this.logService.trace('[Update] Parsed GitHub release response; update:', update);
					console.log('[UpdateService] Parsed GitHub release response; update:', update);
				} else {
					// Original Microsoft format
					update = response;
				}


				if (!update || !update.url || !update.version || !update.productVersion) {
					this.setState(State.Idle(updateType));
					return Promise.resolve(null);
				}

				this.logService.trace('[Update] Detected updateType:', updateType, 'update:', update);
				console.log('[UpdateService] Detected updateType:', updateType, 'update:', update);
				if (updateType === UpdateType.Archive) {
					this.setState(State.AvailableForDownload(update));
					return Promise.resolve(null);
				}

				this.setState(State.Downloading);

				this.logService.trace('[Update] Starting cleanup for version:', update.version);
				console.log('[UpdateService] Starting cleanup for version:', update.version);
				return this.cleanup(update.version).then(() => {
					return this.getUpdatePackagePath(update.version).then(updatePackagePath => {
						this.logService.trace('[Update] Update package path:', updatePackagePath);
						console.log('[UpdateService] Update package path:', updatePackagePath);
						return pfs.Promises.exists(updatePackagePath).then(exists => {
							if (exists) {
								this.logService.trace('[Update] Package already exists in cache:', updatePackagePath);
								console.log('[UpdateService] Package already exists in cache:', updatePackagePath);
								return Promise.resolve(updatePackagePath);
							}

							const downloadPath = `${updatePackagePath}.tmp`;

							this.logService.trace('[Update] Starting download from URL:', update.url, 'to file:', downloadPath);
							console.log('[UpdateService] Starting download from URL:', update.url, 'to file:', downloadPath);
							return this.requestService.request({ url: update.url }, CancellationToken.None)
								.then(context => this.fileService.writeFile(URI.file(downloadPath), context.stream))
								.then(update.sha256hash ? () => checksum(downloadPath, update.sha256hash) : () => undefined)
								.then(() => this.logService.trace('[Update] Download finished, renaming tmp file to final path'))
								.then(() => pfs.Promises.rename(downloadPath, updatePackagePath, false /* no retry */))
								.then(() => updatePackagePath);
						});
					}).then(packagePath => {
						this.availableUpdate = { packagePath };
						this.logService.trace('[Update] Downloaded packagePath set as availableUpdate:', packagePath);
						console.log('[UpdateService] Downloaded packagePath set as availableUpdate:', packagePath);
						this.setState(State.Downloaded(update));

						const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
						if (fastUpdatesEnabled) {
							this.logService.trace('[Update] Fast updates are enabled. Will attempt to apply update now for user setup:', this.productService.target === 'user');
							console.log('[UpdateService] Fast updates are enabled. Will attempt to apply update now for user setup:', this.productService.target === 'user');
							if (this.productService.target === 'user') {
								this.doApplyUpdate();
							}
						} else {
							this.setState(State.Ready(update));
						}
					});
				});
			})
			.then(undefined, err => {
				this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
				this.logService.error(err);

				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(getUpdateType(), message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		this.logService.trace('[Update] doDownloadUpdate - available update url:', state.update.url);
		console.log('[UpdateService] doDownloadUpdate - available update url:', state.update.url);
		if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}
		this.setState(State.Idle(getUpdateType()));
	}

	private async getUpdatePackagePath(version: string): Promise<string> {
		const cachePath = await this.cachePath;
		const p = path.join(cachePath, `CodeSetup-${this.productService.quality}-${version}.exe`);
		this.logService.trace('[Update] getUpdatePackagePath - cachePath:', cachePath, 'package:', p);
		console.log('[UpdateService] getUpdatePackagePath - cachePath:', cachePath, 'package:', p);
		return p;
	}

	private async cleanup(exceptVersion: string | null = null): Promise<void> {
		const filter = exceptVersion ? (one: string) => !(new RegExp(`${this.productService.quality}-${exceptVersion}\\.exe$`).test(one)) : () => true;

		const cachePath = await this.cachePath;
		const versions = await pfs.Promises.readdir(cachePath);

		const promises = versions.filter(filter).map(async one => {
			try {
				const filePath = path.join(cachePath, one);
				this.logService.trace('[Update] cleanup - deleting file:', filePath);
				console.log('[UpdateService] cleanup - deleting file:', filePath);
				await fs.promises.unlink(filePath);
			} catch (err) {
				// ignore
			}
		});

		await Promise.all(promises);
	}

	protected override async doApplyUpdate(): Promise<void> {
		if (this.state.type !== StateType.Downloaded) {
			return Promise.resolve(undefined);
		}

		if (!this.availableUpdate) {
			return Promise.resolve(undefined);
		}

		const update = this.state.update;
		this.setState(State.Updating(update));

		const cachePath = await this.cachePath;

		this.availableUpdate.updateFilePath = path.join(cachePath, `CodeSetup-${this.productService.quality}-${update.version}.flag`);
		this.logService.trace('[Update] Will use updateFilePath:', this.availableUpdate.updateFilePath);
		console.log('[UpdateService] Will use updateFilePath:', this.availableUpdate.updateFilePath);

		await pfs.Promises.writeFile(this.availableUpdate.updateFilePath, 'flag');
		this.logService.trace('[Update] Wrote update flag file to:', this.availableUpdate.updateFilePath);
		console.log('[UpdateService] Wrote update flag file to:', this.availableUpdate.updateFilePath);
		const spawnArgs = ['/verysilent', '/log', `/update="${this.availableUpdate.updateFilePath}"`, '/nocloseapplications', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'];
		this.logService.trace('[Update] Spawning update installer:', this.availableUpdate.packagePath, 'args:', spawnArgs);
		console.log('[UpdateService] Spawning update installer:', this.availableUpdate.packagePath, 'args:', spawnArgs);
		const child = spawn(this.availableUpdate.packagePath, spawnArgs, {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
			windowsVerbatimArguments: true
		});

		child.once('exit', () => {
			this.availableUpdate = undefined;
			this.setState(State.Idle(getUpdateType()));
		});

		const readyMutexName = `${this.productService.win32MutexName}-ready`;
		const mutex = await import('@vscode/windows-mutex');

		// poll for mutex-ready
		this.logService.trace('[Update] Waiting for ready mutex:', readyMutexName);
		console.log('[UpdateService] Waiting for ready mutex:', readyMutexName);
		pollUntil(() => mutex.isActive(readyMutexName))
			.then(() => this.setState(State.Ready(update)));
	}

	protected override doQuitAndInstall(): void {
		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return;
		}

		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		console.log('update#quitAndInstall(): running raw#quitAndInstall()');

		if (this.availableUpdate.updateFilePath) {
			this.logService.trace('[Update] doQuitAndInstall - removing update flag file:', this.availableUpdate.updateFilePath);
			console.log('[UpdateService] doQuitAndInstall - removing update flag file:', this.availableUpdate.updateFilePath);
			fs.unlinkSync(this.availableUpdate.updateFilePath);
		} else {
			this.logService.trace('[Update] doQuitAndInstall - launching installer from package path:', this.availableUpdate.packagePath);
			console.log('[UpdateService] doQuitAndInstall - launching installer from package path:', this.availableUpdate.packagePath);
			spawn(this.availableUpdate.packagePath, ['/silent', '/log', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore']
			});
		}
	}

	protected override getUpdateType(): UpdateType {
		return getUpdateType();
	}

	override async _applySpecificUpdate(packagePath: string): Promise<void> {
		if (this.state.type !== StateType.Idle) {
			return;
		}

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		const update: IUpdate = { version: 'unknown', productVersion: 'unknown' };

		this.logService.trace('[Update] _applySpecificUpdate - packagePath:', packagePath);
		console.log('[UpdateService] _applySpecificUpdate - packagePath:', packagePath);
		this.setState(State.Downloading);
		this.availableUpdate = { packagePath };
		this.setState(State.Downloaded(update));

		if (fastUpdatesEnabled) {
			if (this.productService.target === 'user') {
				this.doApplyUpdate();
			}
		} else {
			this.setState(State.Ready(update));
		}
	}
}
