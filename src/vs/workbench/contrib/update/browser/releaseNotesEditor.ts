/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/releasenoteseditor.css';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { escapeMarkdownSyntaxTokens } from '../../../../base/common/htmlContent.js';
import { KeybindingParser } from '../../../../base/common/keybindingParser.js';
import { escape } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { TokenizationRegistry } from '../../../../editor/common/languages.js';
import { generateTokensCSSForColorMap } from '../../../../editor/common/languages/supports/tokenization.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import * as nls from '../../../../nls.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { DEFAULT_MARKDOWN_STYLES, renderMarkdownDocument } from '../../markdown/browser/markdownDocumentRenderer.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ACTIVE_GROUP, IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { getTelemetryLevel, supportsTelemetry } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TelemetryLevel } from '../../../../platform/telemetry/common/telemetry.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { SimpleSettingRenderer } from '../../markdown/browser/markdownSettingRenderer.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Schemas } from '../../../../base/common/network.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { dirname } from '../../../../base/common/resources.js';
import { asWebviewUri } from '../../webview/common/webview.js';

interface GitHubReleaseResponse {
	body: string;
	name: string;
	tag_name: string;
	html_url: string;
	published_at: string;
	author?: {
		login: string;
	};
}

export class ReleaseNotesManager {
	private readonly _simpleSettingRenderer: SimpleSettingRenderer;
	private readonly _releaseNotesCache = new Map<string, Promise<string>>();

	private _currentReleaseNotes: WebviewInput | undefined = undefined;
	private _lastMeta: { text: string; base: URI } | undefined;
	private readonly disposables = new DisposableStore();

	public constructor(
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IRequestService private readonly _requestService: IRequestService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IProductService private readonly _productService: IProductService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		TokenizationRegistry.onDidChange(() => {
			return this.updateHtml();
		});

		_configurationService.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);
		_webviewWorkbenchService.onDidChangeActiveWebviewEditor(this.onDidChangeActiveWebviewEditor, this, this.disposables);
		this._simpleSettingRenderer = this._instantiationService.createInstance(SimpleSettingRenderer);
	}

	private async updateHtml() {
		if (!this._currentReleaseNotes || !this._lastMeta) {
			return;
		}
		const html = await this.renderBody(this._lastMeta);
		if (this._currentReleaseNotes) {
			this._currentReleaseNotes.webview.setHtml(html);
		}
	}

	private async getBase(useCurrentFile: boolean) {
		if (useCurrentFile) {
			const currentFileUri = this._codeEditorService.getActiveCodeEditor()?.getModel()?.uri;
			if (currentFileUri) {
				return dirname(currentFileUri);
			}
		}
		return URI.parse('https://github.com/Conscendotechnologies/Siid');
	}

	public async show(version: string, useCurrentFile: boolean): Promise<boolean> {
		const releaseNoteText = await this.loadReleaseNotes(version, useCurrentFile);
		const base = await this.getBase(useCurrentFile);
		this._lastMeta = { text: releaseNoteText, base };
		const html = await this.renderBody(this._lastMeta);
		const title = nls.localize('releaseNotesInputName', "Release Notes: {0}", version);

		const activeEditorPane = this._editorService.activeEditorPane;
		if (this._currentReleaseNotes) {
			this._currentReleaseNotes.setName(title);
			this._currentReleaseNotes.webview.setHtml(html);
			this._webviewWorkbenchService.revealWebview(this._currentReleaseNotes, activeEditorPane ? activeEditorPane.group : this._editorGroupService.activeGroup, false);
		} else {
			this._currentReleaseNotes = this._webviewWorkbenchService.openWebview(
				{
					title,
					options: {
						tryRestoreScrollPosition: true,
						enableFindWidget: true,
						disableServiceWorker: useCurrentFile ? false : true,
					},
					contentOptions: {
						localResourceRoots: useCurrentFile ? [base] : [],
						allowScripts: true
					},
					extension: undefined
				},
				'releaseNotes',
				title,
				{ group: ACTIVE_GROUP, preserveFocus: false });

			this._currentReleaseNotes.webview.onDidClickLink(uri => this.onDidClickLink(URI.parse(uri)));

			const disposables = new DisposableStore();
			disposables.add(this._currentReleaseNotes.webview.onMessage(e => {
				if (e.message.type === 'showReleaseNotes') {
					this._configurationService.updateValue('update.showReleaseNotes', e.message.value);
				} else if (e.message.type === 'clickSetting') {
					const x = this._currentReleaseNotes?.webview.container.offsetLeft + e.message.value.x;
					const y = this._currentReleaseNotes?.webview.container.offsetTop + e.message.value.y;
					this._simpleSettingRenderer.updateSetting(URI.parse(e.message.value.uri), x, y);
				}
			}));

			disposables.add(this._currentReleaseNotes.onWillDispose(() => {
				disposables.dispose();
				this._currentReleaseNotes = undefined;
			}));

			this._currentReleaseNotes.webview.setHtml(html);
		}

		return true;
	}

	private async loadReleaseNotes(version: string, useCurrentFile: boolean): Promise<string> {
		const match = /^(\d+\.\d+)\./.exec(version);
		if (!match) {
			throw new Error('not found');
		}

		const updateUrl = this._productService.updateUrl;
		const isGitHub = !!updateUrl && updateUrl.includes('api.github.com');
		const quality = (this._productService.quality || 'stable').toLowerCase();
		const tagCandidates = quality === 'stable'
			? [`v${version}`, version, `v${version}-stable`, `${version}-stable`]
			: [`v${version}-${quality}`, `${version}-${quality}`, `${quality}-${version}`, `v${quality}-${version}`, `v${version}`, version];
		const releaseUrls = isGitHub && updateUrl
			? tagCandidates.map(tag => `${updateUrl}/tags/${encodeURIComponent(tag)}?bg=true`)
			: [];
		const fallbackUrl = updateUrl ? `${updateUrl}/latest?bg=true` : undefined;
		const unassigned = nls.localize('unassigned', "unassigned");

		const escapeMdHtml = (text: string): string => {
			return escape(text).replace(/\\/g, '\\\\');
		};

		const patchKeybindings = (text: string) => {
			const kb = (match: string, kb: string) => {
				const keybinding = this._keybindingService.lookupKeybinding(kb);

				if (!keybinding) {
					return unassigned;
				}

				return keybinding.getLabel() || unassigned;
			};

			const kbstyle = (match: string, kb: string) => {
				const keybinding = KeybindingParser.parseKeybinding(kb);

				if (!keybinding) {
					return unassigned;
				}

				const resolvedKeybindings = this._keybindingService.resolveKeybinding(keybinding);

				if (resolvedKeybindings.length === 0) {
					return unassigned;
				}

				return resolvedKeybindings[0].getLabel() || unassigned;
			};

			const kbCode = (match: string, binding: string) => {
				const resolved = kb(match, binding);
				return resolved ? `<code title="${binding}">${escapeMdHtml(resolved)}</code>` : resolved;
			};

			const kbstyleCode = (match: string, binding: string) => {
				const resolved = kbstyle(match, binding);
				return resolved ? `<code title="${binding}">${escapeMdHtml(resolved)}</code>` : resolved;
			};

			return text
				.replace(/`kb\(([a-z.\d\-]+)\)`/gi, kbCode)
				.replace(/`kbstyle\(([^\)]+)\)`/gi, kbstyleCode)
				.replace(/kb\(([a-z.\d\-]+)\)/gi, (match, binding) => escapeMarkdownSyntaxTokens(kb(match, binding)))
				.replace(/kbstyle\(([^\)]+)\)/gi, (match, binding) => escapeMarkdownSyntaxTokens(kbstyle(match, binding)));
		};

		const fetchReleaseNotes = async () => {
			let text;
			try {
				if (useCurrentFile) {
					const file = this._codeEditorService.getActiveCodeEditor()?.getModel()?.getValue();
					text = file ? file.substring(file.indexOf('#')) : undefined;
				} else {
					let response: GitHubReleaseResponse | null | undefined;
					if (releaseUrls.length) {
						for (const releaseUrl of releaseUrls) {
							try {
								response = await asJson<GitHubReleaseResponse>(await this._requestService.request({ url: releaseUrl }, CancellationToken.None));
								if (response) {
									break;
								}
							} catch {
								// try next candidate
							}
						}
					}

					if (!response && fallbackUrl) {
						response = await asJson<GitHubReleaseResponse>(await this._requestService.request({ url: fallbackUrl }, CancellationToken.None));
					}

					if (!response) {
						throw new Error('Failed to fetch release notes');
					}

					// Build enhanced release notes with metadata
					let enhancedText = `# ${response.name || 'Release Notes'}\n\n`;

					// Add version and publication info
					if (response.tag_name) {
						enhancedText += `**Version:** ${response.tag_name}\n`;
					}
					if (response.published_at) {
						const publishDate = new Date(response.published_at).toLocaleDateString();
						enhancedText += `**Published:** ${publishDate}\n`;
					}
					if (response.author?.login) {
						enhancedText += `**Author:** ${response.author.login}\n`;
					}
					enhancedText += '\n---\n\n';

					// Add the actual release notes body
					enhancedText += response.body || 'No release notes available.';

					text = enhancedText;
				}
			} catch {
				throw new Error('Failed to fetch release notes');
			}

			if (!text || (!/^#\s/.test(text) && !useCurrentFile)) { // release notes always starts with `#` followed by whitespace, except when using the current file
				throw new Error('Invalid release notes');
			}

			return patchKeybindings(text);
		};

		// Don't cache the current file
		if (useCurrentFile) {
			return fetchReleaseNotes();
		}
		if (!this._releaseNotesCache.has(version)) {
			this._releaseNotesCache.set(version, (async () => {
				try {
					return await fetchReleaseNotes();
				} catch (err) {
					this._releaseNotesCache.delete(version);
					throw err;
				}
			})());
		}

		return this._releaseNotesCache.get(version)!;
	}

	private async onDidClickLink(uri: URI) {
		if (uri.scheme === Schemas.codeSetting) {
			// handled in receive message
		} else {
			this.addGAParameters(uri, 'ReleaseNotes')
				.then(updated => this._openerService.open(updated, { allowCommands: ['workbench.action.openSettings'] }))
				.then(undefined, onUnexpectedError);
		}
	}

	private async addGAParameters(uri: URI, origin: string, experiment = '1'): Promise<URI> {
		if (supportsTelemetry(this._productService, this._environmentService) && getTelemetryLevel(this._configurationService) === TelemetryLevel.USAGE) {
			if (uri.scheme === 'https' && uri.authority === 'code.visualstudio.com') {
				return uri.with({ query: `${uri.query ? uri.query + '&' : ''}utm_source=VsCode&utm_medium=${encodeURIComponent(origin)}&utm_content=${encodeURIComponent(experiment)}` });
			}
		}
		return uri;
	}

	private async renderBody(fileContent: { text: string; base: URI }) {
		const nonce = generateUuid();

		const content = await renderMarkdownDocument(fileContent.text, this._extensionService, this._languageService, {
			shouldSanitize: false,
			markedExtensions: [{
				renderer: {
					html: this._simpleSettingRenderer.getHtmlRenderer(),
					codespan: this._simpleSettingRenderer.getCodeSpanRenderer(),
				}
			}]
		});
		const colorMap = TokenizationRegistry.getColorMap();
		const css = colorMap ? generateTokensCSSForColorMap(colorMap) : '';
		const showReleaseNotes = Boolean(this._configurationService.getValue<boolean>('update.showReleaseNotes'));

		return `<!DOCTYPE html>
		<html>
			<head>
				<base href="${asWebviewUri(fileContent.base).toString(true)}/" >
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; media-src https:; style-src 'nonce-${nonce}' https://code.visualstudio.com; script-src 'nonce-${nonce}';">
				<style nonce="${nonce}">
					${DEFAULT_MARKDOWN_STYLES}
					${css}

					:root {
						--brand-orange: var(--vscode-editorWarning-foreground);
						--brand-purple: var(--vscode-progressBar-background);
						--gradient-dark: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-editorWidget-background) 100%);
						--card-bg: rgba(255, 255, 255, 0.03);
						--card-border: rgba(255, 255, 255, 0.08);
					}

					/* Base Layout */
					body {
						max-width: 1400px;
						margin: 0 auto;
						padding: 0;
						line-height: 1.7;
						font-size: 14px;
						background: var(--vscode-editor-background);
						position: relative;
					}

					/* Scroll Progress Indicator */
					body::before {
						content: '';
						position: fixed;
						top: 0;
						left: 0;
						height: 3px;
						background: linear-gradient(90deg, var(--brand-orange) 0%, var(--brand-purple) 100%);
						z-index: 9999;
						animation: progressBar 1s linear;
						transform-origin: left;
					}

					@keyframes progressBar {
						from { width: 0%; }
						to { width: 100%; }
					}

					/* Professional Hero Header - Sticky */
				.release-header {
					position: relative;
					z-index: 200;
					background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-editorWidget-background) 50%, var(--vscode-widget-border) 100%);
					padding: 70px 60px 55px;
					margin-bottom: 0;
					overflow: hidden;
					border-bottom: 1px solid rgba(255, 255, 255, 0.06);
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
				}					.release-header::before {
						content: '';
						position: absolute;
						top: 0;
						left: 0;
						right: 0;
						height: 3px;
						background: linear-gradient(90deg, var(--brand-orange) 0%, var(--vscode-editorWarning-foreground) 50%, var(--brand-orange) 100%);
						background-size: 200% 100%;
						animation: shimmer 4s ease-in-out infinite;
					}

					@keyframes shimmer {
						0%, 100% { background-position: 0% 50%; }
						50% { background-position: 100% 50%; }
					}

					.release-header::after {
						content: '';
						position: absolute;
						top: -100px;
						right: -100px;
						width: 400px;
						height: 400px;
						background: radial-gradient(circle, rgba(255, 120, 0, 0.06) 0%, transparent 70%);
						border-radius: 50%;
						pointer-events: none;
					}

					.release-header-content {
						position: relative;
						z-index: 1;
						max-width: 1200px;
					}

					.release-header h1 {
						margin: 0;
						font-size: 3em;
						font-weight: 700;
						color: var(--vscode-editor-foreground);
						letter-spacing: -0.03em;
						line-height: 1.2;
						animation: fadeInUp 0.6s ease-out;
						position: relative;
						display: inline-block;
					}

					.release-header h1::after {
						content: '';
						position: absolute;
						bottom: -8px;
						left: 0;
						width: 80px;
						height: 3px;
						background: linear-gradient(90deg, var(--brand-orange) 0%, transparent 100%);
						border-radius: 2px;
					}

					@keyframes fadeInUp {
						from {
							opacity: 0;
							transform: translateY(20px);
						}
						to {
							opacity: 1;
							transform: translateY(0);
						}
					}

					/* Content Area */
					.release-content {
						padding: 50px 50px 50px;
						background: var(--vscode-editor-background);
					}

					/* Professional Section Headings */
					h1 {
						font-size: 2.4em;
						margin-top: 64px;
						margin-bottom: 32px;
						font-weight: 700;
						color: var(--vscode-foreground);
						position: relative;
						padding-bottom: 14px;
						border-bottom: 2px solid rgba(255, 255, 255, 0.06);
					}

					h1::after {
						content: '';
						position: absolute;
						bottom: -2px;
						left: 0;
						width: 70px;
						height: 2px;
						background: var(--brand-orange);
					}

					h2 {
						font-size: 1.7em;
						margin-top: 52px;
						margin-bottom: 26px;
						font-weight: 600;
						color: var(--vscode-foreground);
						position: relative;
						padding-left: 16px;
					}

					h2::before {
						content: '';
						position: absolute;
						left: 0;
						top: 4px;
						bottom: 4px;
						width: 4px;
						background: var(--brand-orange);
						border-radius: 2px;
					}

					h3 {
						font-size: 1.4em;
						margin-top: 40px;
						margin-bottom: 20px;
						font-weight: 600;
						color: rgba(255, 255, 255, 0.95);
						position: relative;
						padding-left: 24px;
					}

					h3::before {
						content: '•';
						position: absolute;
						left: 0;
						color: var(--brand-orange);
						font-size: 1.2em;
					}

					h4 {
						font-size: 1.2em;
						margin-top: 32px;
						margin-bottom: 16px;
						font-weight: 600;
						color: rgba(255, 255, 255, 0.9);
						opacity: 0.95;
					}

					/* Links */
					a {
						color: var(--vscode-textLink-foreground);
						text-decoration: none;
						transition: color 0.2s ease;
					}

					a:hover {
						color: var(--brand-orange);
						text-decoration: underline;
					}

					/* Professional Code Blocks */
					pre {
						background: rgba(0, 0, 0, 0.3);
						border: 1px solid rgba(255, 255, 255, 0.1);
						border-left: 3px solid var(--brand-orange);
						border-radius: 6px;
						padding: 20px 24px;
						overflow-x: auto;
						margin: 28px 0;
						position: relative;
						box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
						backdrop-filter: blur(10px);
					}

					code {
						background-color: rgba(255, 255, 255, 0.08);
						color: var(--vscode-textPreformat-foreground);
						padding: 3px 8px;
						border-radius: 4px;
						font-size: 0.9em;
						font-family: var(--vscode-editor-font-family);
						border: 1px solid rgba(255, 255, 255, 0.08);
					}

					pre code {
						background: transparent;
						padding: 0;
						color: var(--vscode-foreground);
						border: none;
					}

					/* Professional Card-based Lists */
					ul {
						list-style: none;
						padding: 0;
						margin: 32px 0;
						display: grid;
						grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
						gap: 18px;
					}

					ul li {
						background: rgba(255, 255, 255, 0.02);
						border: 1px solid rgba(255, 255, 255, 0.08);
						border-left: 3px solid transparent;
						border-radius: 8px;
						padding: 22px 26px;
						margin: 0;
						line-height: 1.7;
						transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
						position: relative;
						backdrop-filter: blur(10px);
					}

					ul li::before {
						content: '';
						position: absolute;
						left: -3px;
						top: 0;
						bottom: 0;
						width: 3px;
						background: var(--brand-orange);
						opacity: 0;
						transition: opacity 0.25s ease;
					}

					ul li:hover {
						background: rgba(255, 255, 255, 0.04);
						border-color: rgba(255, 120, 0, 0.3);
						transform: translateY(-3px);
						box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 120, 0, 0.1);
					}

					ul li:hover::before {
						opacity: 1;
					}

					/* Nested lists - clean style */
					ul ul, ul ol {
						display: block;
						grid-template-columns: none;
						padding-left: 28px;
						margin: 16px 0;
						gap: 8px;
					}

					ul ul li, ul ol li {
						background: transparent;
						border: none;
						padding: 8px 0 8px 20px;
						border-radius: 0;
						position: relative;
					}

					ul ul li::before {
						content: '•';
						position: absolute;
						left: 0;
						color: var(--brand-orange);
						font-size: 16px;
						opacity: 0.7;
					}

					ul ul li::after {
						display: none;
					}

					ul ul li:hover {
						background: transparent;
						transform: none;
						box-shadow: none;
						border-color: transparent;
					}

					ul ul li:hover::before {
						opacity: 1;
					}

					/* Ordered Lists */
					ol {
						padding-left: 28px;
						margin: 16px 0;
					}

					ol li {
						margin: 10px 0;
						line-height: 1.7;
					}

					ol li::marker {
						color: var(--vscode-textLink-foreground);
						font-weight: 600;
					}

					/* Professional Blockquotes */
					blockquote {
						margin: 32px 0;
						padding: 20px 24px;
						background: rgba(86, 156, 214, 0.05);
						border: 1px solid rgba(86, 156, 214, 0.2);
						border-left: 4px solid var(--vscode-textLink-foreground);
						border-radius: 6px;
						position: relative;
						font-style: italic;
						box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
					}

					blockquote p {
						position: relative;
						margin: 8px 0;
						color: rgba(255, 255, 255, 0.85);
					}

					/* Tables */
					table {
						border-collapse: collapse;
						width: 100%;
						margin: 24px 0;
						border-radius: 8px;
						overflow: hidden;
						border: 1px solid var(--card-border);
					}

					th, td {
						padding: 14px 18px;
						text-align: left;
						border-bottom: 1px solid var(--card-border);
					}

					th {
						background: var(--card-bg);
						color: var(--vscode-foreground);
						font-weight: 600;
						font-size: 13px;
						text-transform: uppercase;
						letter-spacing: 0.5px;
					}

					tr:hover td {
						background-color: var(--card-bg);
					}

					tr:last-child td {
						border-bottom: none;
					}

					/* Horizontal Rules */
					hr {
						border: none;
						height: 1px;
						background-color: var(--card-border);
						margin: 50px 0;
					}

					/* Images */
					img {
						max-width: 100%;
						height: auto;
						border-radius: 8px;
						margin: 24px 0;
						border: 1px solid var(--card-border);
					}

					/* Professional Settings Panel - Scrollable */
					.settings-panel {
						position: relative;
						background: rgba(255, 255, 255, 0.03);
						border: 1px solid rgba(255, 255, 255, 0.08);
						border-radius: 8px;
						padding: 16px 24px;
						margin: 36px 0;
						display: flex;
						align-items: center;
						gap: 12px;
						backdrop-filter: blur(10px);
						box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
						transition: all 0.25s ease;
					}

					.settings-panel:hover {
						background: rgba(255, 255, 255, 0.05);
						border-color: rgba(255, 120, 0, 0.25);
						box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
					}

					.settings-panel input[type="checkbox"] {
						width: 18px;
						height: 18px;
						cursor: pointer;
						accent-color: var(--brand-orange);
						transition: transform 0.2s ease;
					}

					.settings-panel input[type="checkbox"]:hover {
						transform: scale(1.05);
					}

					.settings-panel label {
						cursor: pointer;
						font-size: 13.5px;
						font-weight: 500;
						user-select: none;
						flex-grow: 1;
						color: rgba(255, 255, 255, 0.85);
						transition: color 0.2s ease;
					}

					.settings-panel:hover label {
						color: rgba(255, 255, 255, 0.95);
					}

					/* Code Settings Enhancements */
					code:has(.codesetting) {
						background-color: var(--vscode-textPreformat-background);
						color: var(--vscode-textPreformat-foreground);
						padding-left: 1px;
						margin-right: 3px;
						padding-right: 0px;
						border-radius: 4px;
						transition: all 0.2s ease;
					}

					code:has(.codesetting):focus {
						border: 1px solid var(--brand-orange);
						outline: 2px solid rgba(255, 120, 0, 0.2);
						outline-offset: 2px;
					}

					.codesetting {
						color: var(--vscode-textPreformat-foreground);
						padding: 0px 1px 1px 0px;
						font-size: 0px;
						overflow: hidden;
						text-overflow: ellipsis;
						outline-offset: 2px !important;
						box-sizing: border-box;
						text-align: center;
						cursor: pointer;
						display: inline;
						margin-right: 3px;
					}

					.codesetting svg {
						font-size: 12px;
						text-align: center;
						cursor: pointer;
						border: 1px solid var(--vscode-button-secondaryBorder, transparent);
						outline: 1px solid transparent;
						line-height: 9px;
						margin-bottom: -5px;
						padding: 2px;
						display: inline-block;
						text-decoration: none;
						text-rendering: auto;
						text-transform: none;
						-webkit-font-smoothing: antialiased;
						-moz-osx-font-smoothing: grayscale;
						user-select: none;
						-webkit-user-select: none;
						transition: all 0.2s ease;
					}

					.codesetting .setting-name {
						font-size: 13px;
						padding: 1px 3px 1px 2px;
						margin-top: -3px;
					}

					.codesetting:hover {
						color: var(--brand-orange) !important;
						text-decoration: none !important;
					}

					code:has(.codesetting):hover {
						background-color: rgba(255, 120, 0, 0.1);
						text-decoration: none !important;
					}

					.codesetting:focus {
						outline: 0 !important;
						text-decoration: none !important;
						color: var(--brand-orange) !important;
					}

					.codesetting .separator {
						width: 1px;
						height: 14px;
						margin-bottom: -3px;
						display: inline-block;
						background-color: var(--vscode-editor-background);
						font-size: 12px;
						margin-right: 4px;
					}

					/* Scrollbar */
					::-webkit-scrollbar {
						width: 12px;
						height: 12px;
					}

					::-webkit-scrollbar-track {
						background: transparent;
					}

					::-webkit-scrollbar-thumb {
						background: var(--vscode-scrollbarSlider-background);
						border-radius: 6px;
					}

					::-webkit-scrollbar-thumb:hover {
						background: var(--vscode-scrollbarSlider-hoverBackground);
					}

					/* Enhanced Text Accents */
					p {
						margin: 16px 0;
						line-height: 1.8;
						color: rgba(255, 255, 255, 0.9);
					}

					strong, b {
						color: var(--vscode-foreground);
						font-weight: 700;
						position: relative;
					}

					em, i {
						color: var(--vscode-textLink-foreground);
						font-style: italic;
						font-weight: 500;
					}

					/* Highlight effect for strong text on hover */
					p strong:hover, p b:hover {
						color: var(--brand-orange);
						transition: color 0.2s ease;
					}

					/* Selection */
					::selection {
						background: rgba(255, 120, 0, 0.25);
						color: var(--vscode-foreground);
					}

					/* Smooth Scroll */
					html {
						scroll-behavior: smooth;
					}

					/* Subtle Fade-in Animation for Content */
					.release-content > * {
						animation: fadeIn 0.4s ease-out;
					}

					@keyframes fadeIn {
						from {
							opacity: 0;
							transform: translateY(8px);
						}
						to {
							opacity: 1;
							transform: translateY(0);
						}
					}

					/* Enhanced Responsive Design */
					@media (max-width: 1000px) {
						ul {
							grid-template-columns: 1fr;
						}

						.release-header {
							padding: 60px 40px 45px;
						}

						.release-header h1 {
							font-size: 2.8em;
						}
					}

					@media (max-width: 768px) {
						.release-header {
							padding: 50px 24px 40px;
						}

						.release-header h1 {
							font-size: 2.2em;
						}

						.release-content {
							padding: 40px 24px;
						}

						h1 {
							font-size: 1.9em;
							margin-top: 40px;
						}

						h2 {
							font-size: 1.5em;
							margin-top: 35px;
						}

						h3 {
							font-size: 1.25em;
						}

						ul li {
							padding: 18px 20px;
						}

						.metadata-item {
							padding: 6px 14px;
							font-size: 13px;
						}

						.settings-panel {
							padding: 14px 20px;
						}
					}

					@media (max-width: 480px) {
						.release-header {
							padding: 40px 20px 35px;
						}

						.release-header h1 {
							font-size: 1.8em;
						}

						.release-content {
							padding: 30px 20px;
						}

						h1 {
							font-size: 1.6em;
						}

						h2 {
							font-size: 1.3em;
						}
					}
				</style>
			</head>
			<body>
				<div class="release-content">
					${content}
				</div>
				<script nonce="${nonce}">
					const vscode = acquireVsCodeApi();

					// Create enhanced settings panel
					const settingsPanel = document.createElement('div');
					settingsPanel.className = 'settings-panel';

					const input = document.createElement('input');
					input.type = 'checkbox';
					input.id = 'showReleaseNotes';
					input.checked = ${showReleaseNotes};
					settingsPanel.appendChild(input);

					const label = document.createElement('label');
					label.htmlFor = 'showReleaseNotes';
					label.textContent = '${nls.localize('showOnUpdate', "Show release notes after an update")}';
					settingsPanel.appendChild(label);

					// Create professional release header
					const firstH1 = document.querySelector('.release-content > h1');
					if (firstH1) {
						const headerWrapper = document.createElement('div');
						headerWrapper.className = 'release-header';

						// Create content wrapper
						const contentWrapper = document.createElement('div');
						contentWrapper.className = 'release-header-content';

						// Remove metadata paragraphs (Version, Published, Author)
						let nextSibling = firstH1.nextElementSibling;
						while (nextSibling && nextSibling.tagName === 'P') {
							const text = nextSibling.textContent || '';
							if (text.includes('Version:') || text.includes('Published:') || text.includes('Author:') || text.includes('View on GitHub:')) {
								const temp = nextSibling.nextElementSibling;
								nextSibling.remove();
								nextSibling = temp;
							} else {
								break;
							}
						}

						// Remove horizontal rule after metadata if present
						if (firstH1.nextElementSibling?.tagName === 'HR') {
							firstH1.nextElementSibling.remove();
						}

						// Insert header structure
						firstH1.parentNode?.insertBefore(headerWrapper, firstH1);
						contentWrapper.appendChild(firstH1);
						headerWrapper.appendChild(contentWrapper);
					}

					// Insert settings panel after header
					const header = document.querySelector('.release-header');
					if (header) {
						header.parentNode?.insertBefore(settingsPanel, header.nextSibling);
					} else {
						const firstElement = document.querySelector('.release-content > *');
						if (firstElement) {
							firstElement.parentNode?.insertBefore(settingsPanel, firstElement);
						} else {
							document.body.insertBefore(settingsPanel, document.body.firstChild);
						}
					}

					// Event listeners
					window.addEventListener('message', event => {
						if (event.data.type === 'showReleaseNotes') {
							input.checked = event.data.value;
						}
					});

					window.addEventListener('click', event => {
						const href = event.target.href ?? event.target.parentElement?.href ?? event.target.parentElement?.parentElement?.href;
						if (href && (href.startsWith('${Schemas.codeSetting}'))) {
							vscode.postMessage({ type: 'clickSetting', value: { uri: href, x: event.clientX, y: event.clientY }});
						}
					});

					window.addEventListener('keypress', event => {
						if (event.keyCode === 13) {
							if (event.target.children.length > 0 && event.target.children[0].href) {
								const clientRect = event.target.getBoundingClientRect();
								vscode.postMessage({ type: 'clickSetting', value: { uri: event.target.children[0].href, x: clientRect.right , y: clientRect.bottom }});
							}
						}
					});

					input.addEventListener('change', event => {
						vscode.postMessage({ type: 'showReleaseNotes', value: input.checked }, '*');
					});

					// Smooth scroll for anchor links
					document.addEventListener('click', event => {
						if (event.target.tagName === 'A' && event.target.hash) {
							const targetId = event.target.hash.substring(1);
							const targetElement = document.getElementById(targetId);
							if (targetElement) {
								event.preventDefault();
								targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
							}
						}
					});

					// Dynamic scroll progress indicator
					function updateScrollProgress() {
						const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
						const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
						const scrollProgress = (scrollTop / scrollHeight) * 100;
						document.body.style.setProperty('--scroll-progress', scrollProgress + '%');
					}

					// Update CSS to use dynamic scroll progress
					const style = document.createElement('style');
					style.textContent = 'body::before { width: var(--scroll-progress, 0%); animation: none; }';
					document.head.appendChild(style);

					window.addEventListener('scroll', updateScrollProgress);
					updateScrollProgress();

					// Subtle scroll-based animations
					const observerOptions = {
						threshold: 0.15,
						rootMargin: '0px 0px -40px 0px'
					};

					const observer = new IntersectionObserver((entries) => {
						entries.forEach(entry => {
							if (entry.isIntersecting) {
								entry.target.style.opacity = '1';
								entry.target.style.transform = 'translateY(0)';
							}
						});
					}, observerOptions);

					// Apply subtle animations to major content elements
					document.querySelectorAll('h2, h3, ul, pre, blockquote, table').forEach(el => {
						el.style.opacity = '0';
						el.style.transform = 'translateY(12px)';
						el.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
						observer.observe(el);
					});
				</script>
			</body>
		</html>`;
	}

	private onDidChangeConfiguration(e: IConfigurationChangeEvent): void {
		if (e.affectsConfiguration('update.showReleaseNotes')) {
			this.updateCheckboxWebview();
		}
	}

	private onDidChangeActiveWebviewEditor(input: WebviewInput | undefined): void {
		if (input && input === this._currentReleaseNotes) {
			this.updateCheckboxWebview();
		}
	}

	private updateCheckboxWebview() {
		if (this._currentReleaseNotes) {
			this._currentReleaseNotes.webview.postMessage({
				type: 'showReleaseNotes',
				value: this._configurationService.getValue<boolean>('update.showReleaseNotes')
			});
		}
	}
}
