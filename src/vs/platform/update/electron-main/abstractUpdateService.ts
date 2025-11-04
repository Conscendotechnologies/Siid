/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { AvailableForDownload, DisablementReason, IUpdateService, State, StateType, UpdateType, IUpdate } from '../common/update.js';

export function createUpdateURL(platform: string, quality: string, productService: IProductService): string {
	// Check if using GitHub API for updates
	if (productService.updateUrl && productService.updateUrl.includes('api.github.com')) {
		const url = `${productService.updateUrl}/latest`;
		console.log('[Update] Using GitHub API URL:', url);
		return url;
	}
	const url = `${productService.updateUrl}/api/update/${platform}/${quality}/${productService.commit}`;
	console.log('[Update] Using Microsoft API URL:', url);
	return url;
}

interface GitHubAsset {
	name: string;
	browser_download_url: string;
	size: number;
	digest?: string;
}

interface GitHubRelease {
	tag_name: string;
	name: string;
	published_at: string;
	assets: GitHubAsset[];
	prerelease: boolean;
}

export function parseGitHubReleaseToUpdate(release: GitHubRelease, platform: string, productService: IProductService): IUpdate | null {
	console.log('[Update] Parsing GitHub release:', release.tag_name, 'for platform:', platform);

	// Skip prereleases unless explicitly allowed
	if (release.prerelease) {
		console.log('[Update] Skipping prerelease:', release.tag_name);
		return null;
	}

	// Find the appropriate asset for this platform
	const asset = findAssetForPlatform(release.assets, platform, productService);
	if (!asset) {
		console.log('[Update] No suitable asset found for platform:', platform, 'Available assets:', release.assets.map(a => a.name));
		return null;
	}

	console.log('[Update] Selected asset:', asset.name, 'URL:', asset.browser_download_url);

	// Parse version from tag (assuming v2025.1.0 format after user updates)
	const version = release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name;

	const update: IUpdate = {
		version: release.tag_name, // Keep the full tag name
		productVersion: version,
		timestamp: new Date(release.published_at).getTime(),
		url: asset.browser_download_url,
		sha256hash: asset.digest?.replace('sha256:', '') // Remove sha256: prefix if present
	};

	console.log('[Update] Created update object:', update);
	return update;
}

function findAssetForPlatform(assets: GitHubAsset[], platform: string, productService: IProductService): GitHubAsset | null {
	console.log('[Update] Finding asset for platform:', platform, 'target:', productService.target);

	// For Windows, prefer user setup over system setup
	if (platform.startsWith('win32')) {
		// Check if it's a user installation target
		const isUserSetup = productService.target === 'user';

		if (isUserSetup) {
			// Look for user setup first - try both old naming and new naming patterns
			let userAsset = assets.find(asset => asset.name === 'SIIDUserSetup.exe');
			if (!userAsset) {
				userAsset = assets.find(asset => asset.name.includes('UserSetup.exe'));
			}
			if (userAsset) {
				console.log('[Update] Found user setup asset:', userAsset.name);
				return userAsset;
			}
		} else {
			// Look for system setup - try both old naming and new naming patterns
			let systemAsset = assets.find(asset => asset.name === 'SIIDSystemSetup.exe');
			if (!systemAsset) {
				systemAsset = assets.find(asset => asset.name.includes('SystemSetup.exe'));
			}
			if (systemAsset) {
				console.log('[Update] Found system setup asset:', systemAsset.name);
				return systemAsset;
			}
		}

		// Fallback to any .exe file (excluding .sha256 files)
		const exeAsset = assets.find(asset => asset.name.endsWith('.exe') && !asset.name.endsWith('.sha256'));
		if (exeAsset) {
			console.log('[Update] Using fallback exe asset:', exeAsset.name);
			return exeAsset;
		}
	}

	// For Linux, look for .tar.gz files
	if (platform.includes('linux')) {
		const tarAsset = assets.find(asset => asset.name.endsWith('.tar.gz'));
		if (tarAsset) {
			console.log('[Update] Found Linux tar.gz asset:', tarAsset.name);
			return tarAsset;
		}
	}

	// For macOS, look for .dmg files
	if (platform.includes('darwin')) {
		const dmgAsset = assets.find(asset => asset.name.endsWith('.dmg'));
		if (dmgAsset) {
			console.log('[Update] Found macOS dmg asset:', dmgAsset.name);
			return dmgAsset;
		}
	}

	console.log('[Update] No asset found for platform:', platform);
	return null;
}

export type UpdateErrorClassification = {
	owner: 'joaomoreno';
	messageHash: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The hash of the error message.' };
	comment: 'This is used to know how often VS Code updates have failed.';
};

export abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	protected url: string | undefined;

	private _state: State = State.Uninitialized;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	get state(): State {
		return this._state;
	}

	protected setState(state: State): void {
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN setState from', this._state.type, 'to', state.type);
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN state change event fired for:', state.type);
	}

	constructor(
		@ILifecycleMainService protected readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IRequestService protected requestService: IRequestService,
		@ILogService protected logService: ILogService,
		@IProductService protected readonly productService: IProductService
	) {
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN constructor - service created');
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => {
				console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN AfterWindowOpen phase reached, calling initialize()');
				this.initialize();
			});
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	 */
	protected async initialize(): Promise<void> {
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN initialize() starting');
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN isBuilt:', this.environmentMainService.isBuilt);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN disableUpdates:', this.environmentMainService.disableUpdates);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN updateUrl:', this.productService.updateUrl);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN commit:', this.productService.commit);

		// TEMPORARILY DISABLED FOR TESTING - REMOVE BEFORE PRODUCTION
		// if (!this.environmentMainService.isBuilt) {
		// 	this.setState(State.Disabled(DisablementReason.NotBuilt));
		// 	return; // updates are never enabled when running out of sources
		// }

		if (this.environmentMainService.disableUpdates) {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN updates disabled by environment');
			this.setState(State.Disabled(DisablementReason.DisabledByEnvironment));
			this.logService.info('update#ctor - updates are disabled by the environment');
			return;
		}

		if (!this.productService.updateUrl || !this.productService.commit) {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN missing configuration - updateUrl:', !!this.productService.updateUrl, 'commit:', !!this.productService.commit);
			this.setState(State.Disabled(DisablementReason.MissingConfiguration));
			this.logService.info('update#ctor - updates are disabled as there is no update URL');
			return;
		}

		const updateMode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN updateMode:', updateMode);
		const quality = this.getProductQuality(updateMode);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN quality:', quality);

		if (!quality) {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN no quality, updates disabled by user preference');
			this.setState(State.Disabled(DisablementReason.ManuallyDisabled));
			this.logService.info('update#ctor - updates are disabled by user preference');
			return;
		}

		this.url = this.buildUpdateFeedUrl(quality);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN built update URL:', this.url);
		if (!this.url) {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN invalid update URL configuration');
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.info('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}

		// hidden setting
		if (this.configurationService.getValue<boolean>('_update.prss')) {
			const url = new URL(this.url);
			url.searchParams.set('prss', 'true');
			this.url = url.toString();
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN PRSS enabled, modified URL:', this.url);
		}

		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN setting state to Idle');
		this.setState(State.Idle(this.getUpdateType()));
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN state set to Idle, current state =', this.state.type);

		if (updateMode === 'manual') {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN manual mode - no automatic checks');
			this.logService.info('update#ctor - manual checks only; automatic updates are disabled by user preference');
			return;
		}

		if (updateMode === 'start') {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN start mode - scheduling one check in 30s');
			this.logService.info('update#ctor - startup checks only; automatic updates are disabled by user preference');

			// Check for updates only once after 30 seconds
			setTimeout(() => this.checkForUpdates(false), 30 * 1000);
		} else {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN default mode - scheduling periodic checks');
			// Start checking for updates after 30 seconds
			this.scheduleCheckForUpdates(30 * 1000).then(undefined, err => this.logService.error(err));
		}
	}

	private getProductQuality(updateMode: string): string | undefined {
		return updateMode === 'none' ? undefined : this.productService.quality;
	}

	private scheduleCheckForUpdates(delay = 60 * 60 * 1000): Promise<void> {
		return timeout(delay)
			.then(() => this.checkForUpdates(false))
			.then(() => {
				// Check again after 1 hour
				return this.scheduleCheckForUpdates(60 * 60 * 1000);
			});
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN checkForUpdates called with explicit =', explicit);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN current state =', this.state.type);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN StateType.Idle =', StateType.Idle);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN state comparison:', this.state.type === StateType.Idle);
		this.logService.info('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN EARLY RETURN - state is not Idle, current state:', this.state.type);
			return;
		}

		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN calling doCheckForUpdates');
		this.doCheckForUpdates(explicit);
		console.log('[DEBUG-UPDATE] AbstractUpdateService MAIN doCheckForUpdates call completed');
	}

	async downloadUpdate(): Promise<void> {
		this.logService.info('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// noop
	}

	async applyUpdate(): Promise<void> {
		this.logService.info('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	protected async doApplyUpdate(): Promise<void> {
		// noop
	}

	quitAndInstall(): Promise<void> {
		this.logService.info('update#quitAndInstall, state = ', this.state.type);

		if (this.state.type !== StateType.Ready) {
			return Promise.resolve(undefined);
		}

		this.logService.trace('update#quitAndInstall(): before lifecycle quit()');

		this.lifecycleMainService.quit(true /* will restart */).then(vetod => {
			this.logService.trace(`update#quitAndInstall(): after lifecycle quit() with veto: ${vetod}`);
			if (vetod) {
				return;
			}

			this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
			this.doQuitAndInstall();
		});

		return Promise.resolve(undefined);
	}

	async isLatestVersion(): Promise<boolean | undefined> {
		if (!this.url) {
			return undefined;
		}

		const mode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');

		if (mode === 'none') {
			return false;
		}

		try {
			const context = await this.requestService.request({ url: this.url }, CancellationToken.None);
			// The update server replies with 204 (No Content) when no
			// update is available - that's all we want to know.
			return context.res.statusCode === 204;

		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check for updates');
			this.logService.error(error);
			return undefined;
		}
	}

	async _applySpecificUpdate(packagePath: string): Promise<void> {
		// noop
	}

	protected getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

	protected doQuitAndInstall(): void {
		// noop
	}

	protected abstract buildUpdateFeedUrl(quality: string): string | undefined;
	protected abstract doCheckForUpdates(explicit: boolean): void;
}
