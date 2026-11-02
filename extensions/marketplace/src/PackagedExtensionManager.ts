import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarketplaceLogger } from './MarketplaceLogger';
import { hasVersionFolder, isUpgrade } from './updatePolicy';

export interface PackagedExtensionMeta {
	fileName: string;
	extensionId?: string;
	displayName?: string;
	description?: string;
	version?: string;
	publisher?: string;
	category?: string;
	tags?: string[];
	addedDate?: string;
	/** Install upgrades automatically at startup instead of asking through the toast. */
	autoUpdate?: boolean;
}

export interface InstalledExtensionMeta extends PackagedExtensionMeta {
	installed: boolean;
	installedVersion?: string;
	needsUpdate?: boolean;
}

export interface InstallResult {
	succeeded: InstalledExtensionMeta[];
	failed: InstalledExtensionMeta[];
}

export class PackagedExtensionManager {
	private packagedExtensions: PackagedExtensionMeta[] = [];
	private installedExtensions: InstalledExtensionMeta[] = [];
	private logger: MarketplaceLogger;

	constructor(private context: vscode.ExtensionContext) {
		this.logger = new MarketplaceLogger();
	}

	public async loadPackagedExtensions(): Promise<void> {
		// Use extensionPath to resolve the packaged-extensions folder and JSON
		const jsonPath = path.join(this.context.extensionPath, 'packaged-extensions.json');
		this.logger.info(`Loading packaged extensions from: ${jsonPath}`);
		if (!fs.existsSync(jsonPath)) {
			this.logger.error('packaged-extensions.json not found');
			throw new Error('packaged-extensions.json not found');
		}
		try {
			const raw = fs.readFileSync(jsonPath, 'utf8');
			this.packagedExtensions = JSON.parse(raw);
			this.logger.info(`Loaded ${this.packagedExtensions.length} packaged extensions.`);
		} catch (err) {
			this.logger.error(`Error reading packaged-extensions.json: ${err}`);
			throw err;
		}
	}

	public getPackagedExtensionsFolder(): string {
		const folder = path.join(this.context.extensionPath, 'packaged-extensions');
		this.logger.info(`Packaged extensions folder resolved: ${folder}`);
		return folder;
	}

	public checkInstalledExtensions(): void {
		this.logger.info('Checking installed extensions against packaged metadata...');
		const allExtensions = vscode.extensions.all;
		this.logger.info(`Total installed extensions found: ${allExtensions.length}`);

		this.installedExtensions = this.packagedExtensions.map(pkg => {
			const extId = this.getExtensionId(pkg);
			// Extension IDs are case-insensitive
			const found = allExtensions.find(ext => ext.id.toLowerCase() === extId.toLowerCase());

			const installed = !!found;
			const installedVersion = found?.packageJSON.version;
			const needsUpdate = installed && pkg.version && installedVersion && isUpgrade(installedVersion, pkg.version);

			this.logger.info(`Extension: ${extId}, Installed: ${installed}, InstalledVersion: ${installedVersion}, NeedsUpdate: ${needsUpdate}`);
			return {
				...pkg,
				installed,
				installedVersion,
				needsUpdate
			};
		});
		this.logger.info(`Checked ${this.installedExtensions.length} extensions.`);
	}

	public getInstalledExtensionsMeta(): InstalledExtensionMeta[] {
		this.logger.info('Returning installed extensions metadata.');
		return this.installedExtensions;
	}

	/**
	 * Whether the packaged version is on disk beside the running one, so a reload would apply it.
	 * An unreadable folder counts as yes: the install was recorded as successful.
	 */
	public isVersionOnDisk(ext: InstalledExtensionMeta): boolean {
		const extId = this.getExtensionId(ext);
		const running = vscode.extensions.getExtension(extId);
		if (!running || !ext.version) {
			return false;
		}
		try {
			return hasVersionFolder(fs.readdirSync(path.dirname(running.extensionPath)), extId, ext.version);
		} catch (err) {
			this.logger.error(`Could not read the extensions folder: ${err}`);
			return true;
		}
	}

	private getExtensionId(pkg: PackagedExtensionMeta): string {
		if (pkg.extensionId) {
			this.logger.info(`Using explicit extensionId for ${pkg.fileName}: ${pkg.extensionId}`);
			return pkg.extensionId;
		}
		let extId: string;
		if (pkg.publisher && pkg.displayName) {
			extId = `${pkg.publisher}.${this.normalizeName(pkg.displayName)}`;
		} else {
			// Fallback: try to infer from fileName
			const match = pkg.fileName.match(/^([^.]+)\.([^-]+)-/);
			if (match) {
				extId = `${match[1]}.${match[2]}`;
			} else {
				extId = pkg.fileName.replace(/\.vsix$/, '');
			}
		}
		this.logger.info(`Resolved extensionId for ${pkg.fileName}: ${extId}`);
		return extId;
	}

	private normalizeName(name: string): string {
		return name.replace(/\s+/g, '-').toLowerCase();
	}

	public async installExtensions(extensions: InstalledExtensionMeta[]): Promise<InstallResult> {
		this.logger.info(`Installing/Updating ${extensions.length} extensions...`);
		const folder = this.getPackagedExtensionsFolder();
		const result: InstallResult = { succeeded: [], failed: [] };

		for (const ext of extensions) {
			try {
				const vsixPath = path.join(folder, ext.fileName);
				if (!fs.existsSync(vsixPath)) {
					this.logger.error(`VSIX not found: ${vsixPath}`);
					result.failed.push(ext);
					continue;
				}
				const vsixUri = vscode.Uri.file(vsixPath);
				this.logger.info(`Installing ${ext.displayName} from ${vsixPath}`);
				await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri, { donotVerifySignature: true });
				this.logger.info(`Successfully installed ${ext.displayName}`);
				result.succeeded.push(ext);
			} catch (err) {
				this.logger.error(`Failed to install ${ext.displayName}: ${err}`);
				result.failed.push(ext);
			}
		}
		this.logger.info(`Finished installing/updating extensions: ${result.succeeded.length} succeeded, ${result.failed.length} failed.`);
		return result;
	}
}
