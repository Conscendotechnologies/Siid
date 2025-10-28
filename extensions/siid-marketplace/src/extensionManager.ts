import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { GitHubService } from './githubService';
import { ConfigService } from './configService';
import { LoggerService } from './loggerService';
import { BundledExtensionManager } from './bundledExtensionManager';
import { IExtensionInfo, IGithubRelease } from './types';

export class ExtensionManager {
	private static instance: ExtensionManager;
	private githubService: GitHubService;
	private configService: ConfigService;
	private logger: LoggerService;
	private bundledManager: BundledExtensionManager;
	private extensionsPath: string;

	private constructor() {
		this.githubService = GitHubService.getInstance();
		this.configService = ConfigService.getInstance();
		this.logger = LoggerService.getInstance();
		this.bundledManager = BundledExtensionManager.getInstance();

		// Set downloads path but don't create directory yet (created on-demand)
		this.extensionsPath = path.join(os.tmpdir(), 'siid-marketplace-downloads');
	}

	public static getInstance(): ExtensionManager {
		if (!ExtensionManager.instance) {
			ExtensionManager.instance = new ExtensionManager();
		}
		return ExtensionManager.instance;
	}

	/**
	 * Install an extension using hybrid approach: Bundle first, then GitHub fallback
	 */
	public async installExtension(extensionInfo: IExtensionInfo): Promise<boolean> {
		try {
			this.logger.show();
			this.logger.info(`[ExtensionManager.installExtension] Starting installation of ${extensionInfo.displayName}...`);

			// Check if already installed
			const installedExtension = vscode.extensions.getExtension(extensionInfo.extensionId);
			if (installedExtension) {
				this.logger.info(`[ExtensionManager.installExtension] Extension ${extensionInfo.displayName} is already installed.`);
				return true;
			}

			// Try bundled installation first
			if (this.bundledManager.hasBundledExtension(extensionInfo.extensionId)) {
				this.logger.info(`[ExtensionManager.installExtension] Found bundled version for ${extensionInfo.displayName}, installing from bundle...`);
				try {
					return await this.bundledManager.installFromBundle(extensionInfo);
				} catch (error) {
					this.logger.warn(`[ExtensionManager.installExtension] Bundled installation failed, falling back to GitHub: ${error}`);
				}
			} else {
				this.logger.info(`[ExtensionManager.installExtension] No bundled version found for ${extensionInfo.displayName}, installing from GitHub...`);
			}

			// Fallback to GitHub installation
			return await this.installFromGitHub(extensionInfo);

		} catch (error) {
			this.logger.error(`[ExtensionManager.installExtension] ❌ Failed to install ${extensionInfo.displayName}`, error);
			throw error;
		}
	}

	/**
	 * Install extension from GitHub (original logic)
	 */
	private async installFromGitHub(extensionInfo: IExtensionInfo): Promise<boolean> {
		// Get latest release info
		const release = await this.githubService.getLatestRelease(extensionInfo.owner, extensionInfo.repo);
		if (!release) {
			throw new Error('Could not fetch latest release information');
		}

		// Find the VSIX asset
		const vsixAsset = this.findVsixAsset(release, extensionInfo.vsixAssetName);
		if (!vsixAsset) {
			// Debug: List all available assets
			this.logger.debug(`[ExtensionManager.installFromGitHub] Available assets in release ${release.tag_name}:`);
			release.assets.forEach(asset => {
				this.logger.debug(`[ExtensionManager.installFromGitHub]   - ${asset.name}`);
			});
			throw new Error(`VSIX file not found in release assets (pattern: ${extensionInfo.vsixAssetName})`);
		}

		// Download VSIX file
		const vsixPath = await this.downloadVsixFile(vsixAsset.browser_download_url, extensionInfo.extensionId);

		// Install the extension
		await this.installVsixFile(vsixPath);

		this.logger.info(`[ExtensionManager.installFromGitHub] ✅ Successfully installed ${extensionInfo.displayName} from GitHub`);
		return true;
	}

	/**
	 * Update an extension
	 */
	public async updateExtension(extensionInfo: IExtensionInfo): Promise<boolean> {
		try {
			this.logger.show();
			this.logger.info(`[ExtensionManager.updateExtension] Starting update of ${extensionInfo.displayName}...`);

			// Uninstall current version first
			await this.uninstallExtension(extensionInfo);

			// Install latest version
			await this.installExtension(extensionInfo);

			this.logger.info(`[ExtensionManager.updateExtension] ✅ Successfully updated ${extensionInfo.displayName} to v${extensionInfo.latestVersion}`);
			return true;

		} catch (error) {
			this.logger.error(`[ExtensionManager.updateExtension] ❌ Failed to update ${extensionInfo.displayName}`, error);
			throw error;
		}
	}

	/**
	 * Uninstall an extension
	 */
	public async uninstallExtension(extensionInfo: IExtensionInfo): Promise<boolean> {
		try {
			this.logger.show();
			this.logger.info(`[ExtensionManager.uninstallExtension] Starting uninstall of ${extensionInfo.displayName}...`);

			// Use VS Code's extension management API
			await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', extensionInfo.extensionId);

			this.logger.info(`[ExtensionManager.uninstallExtension] ✅ Successfully uninstalled ${extensionInfo.displayName}`);
			return true;

		} catch (error) {
			this.logger.error(`[ExtensionManager.uninstallExtension] ❌ Failed to uninstall ${extensionInfo.displayName}`, error);
			throw error;
		}
	}

	/**
	 * Check for updates for all managed extensions
	 */
	public async checkForUpdates(): Promise<IExtensionInfo[]> {
		try {
			this.logger.show();
			this.logger.info('[ExtensionManager.checkForUpdates] Checking for extension updates...');

			const config = await this.configService.getConfig();
			if (!config) {
				throw new Error('[ExtensionManager.checkForUpdates] No configuration found');
			}

			const updatableExtensions: IExtensionInfo[] = [];

			for (const extensionConfig of config.githubReleases) {
				try {
					const installedExtension = vscode.extensions.getExtension(extensionConfig.extensionId);
					if (!installedExtension) {
						continue; // Skip non-installed extensions
					}

					const currentVersion = installedExtension.packageJSON.version;
					const release = await this.githubService.getLatestRelease(extensionConfig.owner, extensionConfig.repo);

					if (release) {
						const latestVersion = release.tag_name.replace(/^v/, '');

						if (this.compareVersions(latestVersion, currentVersion) > 0) {
							const extensionInfo: IExtensionInfo = {
								...extensionConfig,
								version: currentVersion,
								latestVersion: latestVersion,
								isInstalled: true,
								hasUpdate: true
							};
							updatableExtensions.push(extensionInfo);
						}
					}
				} catch (error) {
					this.logger.error(`[ExtensionManager.checkForUpdates] Error checking updates for ${extensionConfig.displayName}`, error);
				}
			}

			this.logger.info(`[ExtensionManager.checkForUpdates] Found ${updatableExtensions.length} extension(s) with available updates`);
			return updatableExtensions;

		} catch (error) {
			this.logger.error(`[ExtensionManager.checkForUpdates] ❌ Failed to check for updates`, error);
			throw error;
		}
	}

	/**
	 * Install all required extensions
	 */
	public async installAllRequired(): Promise<void> {
		try {
			this.logger.show();
			this.logger.info('[ExtensionManager.installAllRequired] Installing all required extensions...');

			const config = await this.configService.getConfig();
			if (!config) {
				throw new Error('[ExtensionManager.installAllRequired] No configuration found');
			}

			const requiredExtensions = config.githubReleases.filter(ext => ext.required);

			for (const extensionConfig of requiredExtensions) {
				const installedExtension = vscode.extensions.getExtension(extensionConfig.extensionId);
				if (!installedExtension) {
					// Create basic extension info without GitHub API calls
					const extensionInfo: IExtensionInfo = {
						...extensionConfig,
						isInstalled: false,
						version: '',
						latestVersion: '',
						hasUpdate: false,
						downloadCount: 0,
						lastUpdated: new Date()
					};
					await this.installExtension(extensionInfo);
				}
			}

			this.logger.info('[ExtensionManager.installAllRequired] ✅ Completed installing required extensions');
		} catch (error) {
			this.logger.error(`[ExtensionManager.installAllRequired] ❌ Failed to install required extensions`, error);
			throw error;
		}
	}

	/**
	 * Update all installed extensions
	 */
	public async updateAllExtensions(): Promise<void> {
		try {
			const updatableExtensions = await this.checkForUpdates();

			for (const extensionInfo of updatableExtensions) {
				await this.updateExtension(extensionInfo);
			}

		} catch (error) {
			this.logger.error(`[ExtensionManager.updateAllExtensions] ❌ Failed to update extensions`, error);
			throw error;
		}
	}

	private findVsixAsset(release: IGithubRelease, pattern: string) {
		this.logger.debug(`[ExtensionManager.findVsixAsset] Looking for VSIX asset with pattern: ${pattern}`);
		const regex = new RegExp(pattern.replace('*', '.*'));
		this.logger.debug(`[ExtensionManager.findVsixAsset] Generated regex: ${regex}`);

		const vsixAssets = release.assets.filter(asset => asset.name.endsWith('.vsix'));
		this.logger.debug(`[ExtensionManager.findVsixAsset] Found ${vsixAssets.length} VSIX assets:`);
		vsixAssets.forEach(asset => {
			const matches = regex.test(asset.name);
			this.logger.debug(`[ExtensionManager.findVsixAsset]   - ${asset.name} (matches: ${matches})`);
		});

		return release.assets.find(asset => regex.test(asset.name) && asset.name.endsWith('.vsix'));
	}

	private async downloadVsixFile(url: string, extensionId: string): Promise<string> {
		// Ensure downloads directory exists before downloading
		await this.ensureDirectoryExistsAsync();

		return new Promise((resolve, reject) => {
			const fileName = `${extensionId}-${Date.now()}.vsix`;
			const filePath = path.join(this.extensionsPath, fileName);
			const file = fs.createWriteStream(filePath);

			https.get(url, (response) => {
				if (response.statusCode !== 200) {
					reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				response.pipe(file);

				file.on('finish', () => {
					file.close();
					resolve(filePath);
				});

				file.on('error', (error) => {
					fs.unlink(filePath, () => { }); // Clean up
					reject(error);
				});
			}).on('error', reject);
		});
	}

	private async installVsixFile(vsixPath: string): Promise<void> {
		try {
			// Use VS Code's extension installation API
			await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));

			// Clean up downloaded file
			fs.unlink(vsixPath, (error) => {
				if (error) {
					this.logger.warn(`[ExtensionManager.installVsixFile] Warning: Could not clean up downloaded file: ${error}`);
				}
			});

		} catch (error) {
			// Clean up on error
			fs.unlink(vsixPath, () => { });
			throw error;
		}
	}

	private compareVersions(version1: string, version2: string): number {
		const v1parts = version1.split('.').map(n => parseInt(n, 10));
		const v2parts = version2.split('.').map(n => parseInt(n, 10));

		const maxLength = Math.max(v1parts.length, v2parts.length);

		for (let i = 0; i < maxLength; i++) {
			const v1part = v1parts[i] || 0;
			const v2part = v2parts[i] || 0;

			if (v1part > v2part) return 1;
			if (v1part < v2part) return -1;
		}

		return 0;
	}

	private async ensureDirectoryExistsAsync(): Promise<void> {
		try {
			const dirUri = vscode.Uri.file(this.extensionsPath);
			await vscode.workspace.fs.createDirectory(dirUri);
		} catch (error) {
			// Directory might already exist, or we might not have permissions
			// Log the error but don't throw - we'll handle it during actual file operations
			this.logger.warn(`[ExtensionManager.ensureDirectoryExistsAsync] Could not create directory ${this.extensionsPath}: ${error}`);
		}
	}

	public dispose(): void {
		this.logger.dispose();
	}
}
