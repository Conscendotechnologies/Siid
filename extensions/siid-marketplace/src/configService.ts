import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LoggerService } from './loggerService';
import { ICustomExtensionsConfig, IMarketplaceConfig } from './types';

export class ConfigService {
	private static instance: ConfigService;
	private config: ICustomExtensionsConfig | null = null;
	private logger: LoggerService;

	private constructor() {
		this.logger = LoggerService.getInstance();
	}

	public static getInstance(): ConfigService {
		if (!ConfigService.instance) {
			ConfigService.instance = new ConfigService();
		}
		return ConfigService.instance;
	}

	public async getConfig(): Promise<ICustomExtensionsConfig | null> {
		if (this.config) {
			return this.config;
		}

		try {
			// Try to get config from VS Code settings first
			const workspaceConfig = vscode.workspace.getConfiguration('siid');
			const customExtensions = workspaceConfig.get<ICustomExtensionsConfig>('customExtensions');

			if (customExtensions) {
				this.config = customExtensions;
				return this.config;
			}

			// Try to read from product.json
			if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
				try {
					const productJsonPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'product.json');
					if (fs.existsSync(productJsonPath)) {
						const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
						if (productJson.customExtensions) {
							this.config = productJson.customExtensions;
							return this.config;
						}
					}
				} catch (error) {
					this.logger.warn('[ConfigService.getConfig] Error reading product.json', error);
				}
			}

			// If not in settings or product.json, return test data as fallback
			this.config = this.getTestConfig();
			return this.config;

		} catch (error) {
			this.logger.error('[ConfigService.getConfig] Error loading configuration', error);
			return null;
		}
	}

	public getMarketplaceConfig(): IMarketplaceConfig {
		return this.config?.marketplace || {
			enabled: true,
			showInExplorer: true,
			categories: ['AI Tools', 'Salesforce', 'Development Tools', 'Themes', 'Other']
		};
	}

	public async refreshConfig(): Promise<void> {
		this.config = null;
		await this.getConfig();
	}

	private getTestConfig(): ICustomExtensionsConfig {
		return {
			githubReleases: [
				{
					owner: "conscendotechinc",
					repo: "siid-code",
					extensionId: "conscendotechinc.siid-code",
					vsixAssetName: "siid-code-*.vsix",
					displayName: "Siid Code",
					description: "Core Siid IDE functionality and enhancements for improved development experience.",
					category: "Development Tools",
					icon: "https://raw.githubusercontent.com/ConscendoTech/siid-code/main/icon.png",
					required: true,
					tags: ["siid", "development", "core", "productivity"]
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-core",
					vsixAssetName: "salesforcedx-vscode-core-*.vsix",
					displayName: "Salesforce CLI Integration",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-apex",
					vsixAssetName: "salesforcedx-vscode-apex-*.vsix",
					displayName: "Apex",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-apex-replay-debugger",
					vsixAssetName: "salesforce.salesforcedx-vscode-apex-replay-debugger-*.vsix",
					displayName: "Apex Replay Debug Adapter",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-lightning",
					vsixAssetName: "salesforcedx-vscode-lightning-*.vsix",
					displayName: "Aura Components",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-visualforce",
					vsixAssetName: "salesforcedx-vscode-visualforce-*.vsix",
					displayName: "Visualforce",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-lwc",
					vsixAssetName: "salesforcedx-vscode-lwc-*.vsix",
					displayName: "Lightning Web Components",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforcedx-vscode-soql",
					vsixAssetName: "salesforcedx-vscode-soql-*.vsix",
					displayName: "SOQL",
					required: true
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.apex-language-server-extension",
					vsixAssetName: "salesforce.apex-language-server-extension-*.vsix",
					displayName: "Apex Language Server",
					description: "Apex Language Server for enhanced Apex development experience.",
					category: "Salesforce",
					required: true,
					tags: ["salesforce", "apex", "language-server"]
				},
				{
					owner: "aman-dhakar-191",
					repo: "salesforcedx-siid",
					extensionId: "salesforce.salesforce-vscode-slds",
					vsixAssetName: "salesforce.salesforce-vscode-slds-*.vsix",
					displayName: "Salesforce Lightning Design System",
					description: "Salesforce Lightning Design System support for improved UI development.",
					category: "Salesforce",
					required: true,
					tags: ["salesforce", "slds", "lightning", "design-system"]
				}
			],
			autoUpdate: true,
			checkInterval: 24,
			marketplace: {
				enabled: true,
				showInExplorer: true,
				categories: ["AI Tools", "Salesforce", "Development Tools", "Themes"]
			}
		};
	}
}
