import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarketplaceLogger } from './MarketplaceLogger';

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
}

export interface InstalledExtensionMeta extends PackagedExtensionMeta {
	installed: boolean;
	installedVersion?: string;
	needsUpdate?: boolean;
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
			const needsUpdate = installed && pkg.version && installedVersion && this.compareVersions(installedVersion, pkg.version) < 0;

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

	private compareVersions(v1: string, v2: string): number {
		// A suffix such as "-agent" ("1.2.64-agent") is split off before the numeric parse; it only breaks ties.
		const [core1, pre1] = PackagedExtensionManager.splitVersion(v1);
		const [core2, pre2] = PackagedExtensionManager.splitVersion(v2);
		const v1Parts = core1.split('.').map(Number);
		const v2Parts = core2.split('.').map(Number);

		for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
			const p1 = v1Parts[i] || 0;
			const p2 = v2Parts[i] || 0;
			if (p1 > p2) return 1;
			if (p1 < p2) return -1;
		}
		// Same numbers: a bare version is newer than one with a prerelease suffix (semver); two suffixes compare as text.
		if (pre1 === pre2) return 0;
		if (!pre1) return 1;
		if (!pre2) return -1;
		return pre1 > pre2 ? 1 : -1;
	}

	private static splitVersion(version: string): [string, string] {
		const match = /^([^-+]*)(?:-([^+]*))?/.exec(version.trim());
		return [match?.[1] ?? version, match?.[2] ?? ''];
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

	public async installExtensions(extensions: InstalledExtensionMeta[]): Promise<void> {
		this.logger.info(`Installing/Updating ${extensions.length} extensions...`);
		const folder = this.getPackagedExtensionsFolder();

		for (const ext of extensions) {
			try {
				const vsixPath = path.join(folder, ext.fileName);
				if (!fs.existsSync(vsixPath)) {
					this.logger.error(`VSIX not found: ${vsixPath}`);
					continue;
				}
				const vsixUri = vscode.Uri.file(vsixPath);
				this.logger.info(`Installing ${ext.displayName} from ${vsixPath}`);
				await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri, { donotVerifySignature: true });
				this.logger.info(`Successfully installed ${ext.displayName}`);
			} catch (err) {
				this.logger.error(`Failed to install ${ext.displayName}: ${err}`);
			}
		}
		this.logger.info('Finished installing/updating extensions.');
	}
}
