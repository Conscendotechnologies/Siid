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
		return url;
	}
	const url = `${productService.updateUrl}/api/update/${platform}/${quality}/${productService.commit}`;
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

export function parseGitHubReleaseToUpdate(release: GitHubRelease, platform: string, productService: IProductService, logService?: ILogService): IUpdate | null {

	// Skip prereleases unless explicitly allowed
	if (release.prerelease) {
		logService?.trace('[Update] GitHub release is prerelease - skipping:', release.tag_name);
		return null;
	}

	// Find the appropriate asset for this platform
	const asset = findAssetForPlatform(release.assets, platform, productService, logService);
	if (!asset) {
		logService?.trace('[Update] GitHub release has no suitable asset for platform:', platform, 'release assets:', release.assets.map(a => a.name));
		return null;
	}


	// Parse version from tag (assuming v2025.1.0 format after user updates)
	const version = release.tag_name.startsWith('v') ? release.tag_name.substring(1) : release.tag_name;

	const update: IUpdate = {
		version: release.tag_name, // Keep the full tag name
		productVersion: version,
		timestamp: new Date(release.published_at).getTime(),
		url: asset.browser_download_url,
		sha256hash: asset.digest?.replace('sha256:', '') // Remove sha256: prefix if present
	};
	logService?.trace('[Update] Parsed GitHub release to update:', update);

	return update;
}

function findAssetForPlatform(assets: GitHubAsset[], platform: string, productService: IProductService, logService?: ILogService): GitHubAsset | null {

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
				logService?.trace('[Update] Found User setup asset by name:', userAsset.name);
				return userAsset;
			}
		} else {
			// Look for system setup - try both old naming and new naming patterns
			let systemAsset = assets.find(asset => asset.name === 'SIIDSystemSetup.exe');
			if (!systemAsset) {
				systemAsset = assets.find(asset => asset.name.includes('SystemSetup.exe'));
			}
			if (systemAsset) {
				logService?.trace('[Update] Found System setup asset by name:', systemAsset.name);
				return systemAsset;
			}
		}

		// Fallback to any .exe file (excluding .sha256 files)
		const exeAsset = assets.find(asset => asset.name.endsWith('.exe') && !asset.name.endsWith('.sha256'));
		if (exeAsset) {
			logService?.trace('[Update] Found fallback .exe asset:', exeAsset.name);
			return exeAsset;
		}
	}

	// For Linux, look for .tar.gz files
	if (platform.includes('linux')) {
		const tarAsset = assets.find(asset => asset.name.endsWith('.tar.gz'));
		if (tarAsset) {
			logService?.trace('[Update] Found tar.gz asset:', tarAsset.name);
			return tarAsset;
		}
	}

	// For macOS, look for .dmg files
	if (platform.includes('darwin')) {
		const dmgAsset = assets.find(asset => asset.name.endsWith('.dmg'));
		if (dmgAsset) {
			logService?.trace('[Update] Found dmg asset:', dmgAsset.name);
			return dmgAsset;
		}
	}

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
		this.logService.trace('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	constructor(
		@ILifecycleMainService protected readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IRequestService protected requestService: IRequestService,
		@ILogService protected logService: ILogService,
		@IProductService protected readonly productService: IProductService
	) {
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => {
				this.initialize();
			});
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	 */
	protected async initialize(): Promise<void> {

		if (!this.environmentMainService.isBuilt) {
			this.setState(State.Disabled(DisablementReason.NotBuilt));
			return; // updates are never enabled when running out of sources
		}

		if (this.environmentMainService.disableUpdates) {
			this.setState(State.Disabled(DisablementReason.DisabledByEnvironment));
			this.logService.trace('update#ctor - updates are disabled by the environment');
			return;
		}

		if (!this.productService.updateUrl || !this.productService.commit) {
			this.setState(State.Disabled(DisablementReason.MissingConfiguration));
			this.logService.trace('update#ctor - updates are disabled as there is no update URL');
			return;
		}

		const updateMode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');
		const quality = this.getProductQuality(updateMode);

		if (!quality) {
			this.setState(State.Disabled(DisablementReason.ManuallyDisabled));
			this.logService.trace('update#ctor - updates are disabled by user preference');
			return;
		}

		this.url = this.buildUpdateFeedUrl(quality);
		if (!this.url) {
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.trace('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}

		// hidden setting
		if (this.configurationService.getValue<boolean>('_update.prss')) {
			const url = new URL(this.url);
			url.searchParams.set('prss', 'true');
			this.url = url.toString();
		}

		this.setState(State.Idle(this.getUpdateType()));

		if (updateMode === 'manual') {
			this.logService.trace('update#ctor - manual checks only; automatic updates are disabled by user preference');
			return;
		}

		if (updateMode === 'start') {
			this.logService.trace('update#ctor - startup checks only; automatic updates are disabled by user preference');

			// Check for updates only once after 30 seconds
			setTimeout(() => this.checkForUpdates(false), 30 * 1000);
		} else {
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
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.doCheckForUpdates(explicit);
	}

	async downloadUpdate(): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// noop
	}

	async applyUpdate(): Promise<void> {
		this.logService.trace('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	protected async doApplyUpdate(): Promise<void> {
		// noop
	}

	quitAndInstall(): Promise<void> {
		this.logService.trace('update#quitAndInstall, state = ', this.state.type);

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
