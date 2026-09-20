/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { defaultWelcomeScreenConfig, IWelcomeScreenConfig, IScreenConfig } from './welcomeScreenConfig.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { ImportSettingsService, IImportSettings } from './importSettingsService.js';

const WELCOME_SCREEN_DISMISSED_KEY = 'workbench.welcomeScreen.dismissed';

export class WelcomeScreenContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.welcomeScreen';

	private welcomeScreenElement: HTMLElement | undefined;
	private currentScreenIndex: number = 0;
	private screenContents: HTMLElement[] = [];
	private config: IWelcomeScreenConfig;
	private importSettingsService: ImportSettingsService | undefined;
	private importSettings: IImportSettings = { importSettings: true, importKeybindings: true };

	constructor(
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super();
		// Initialize import settings service
		this.importSettingsService = new ImportSettingsService(this.fileService, this.environmentService);

		// Load config from product.json or use default
		this.config = (this.productService as any).welcomeScreenConfig || defaultWelcomeScreenConfig;
		this.init();
	}

	private async init(): Promise<void> {
		// Wait for the workbench to be restored
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// Check if welcome screen has been dismissed
		const dismissed = this.storageService.getBoolean(WELCOME_SCREEN_DISMISSED_KEY, StorageScope.PROFILE, false);

		console.log('[WelcomeScreen] Init - Dismissed:', dismissed);

		if (!dismissed) {
			console.log('[WelcomeScreen] Showing welcome screen...');
			this.showWelcomeScreen();
		} else {
			console.log('[WelcomeScreen] Welcome screen was previously dismissed');
		}
	}

	private showWelcomeScreen(): void {
		console.log('[WelcomeScreen] Creating welcome screen UI');
		// Hide all workbench parts
		this.hideAllParts();

		// Create and show welcome screen
		this.createWelcomeScreen();
		console.log('[WelcomeScreen] Welcome screen created and displayed');
	}

	public resetAndShowWelcome(): void {
		console.log('[WelcomeScreen] Resetting and showing welcome screen');

		// If welcome screen already exists, remove it
		if (this.welcomeScreenElement) {
			this.welcomeScreenElement.remove();
			this.welcomeScreenElement = undefined;
		}

		// Reset screen index
		this.currentScreenIndex = 0;
		this.screenContents = [];

		// Show the welcome screen
		this.showWelcomeScreen();
	}

	private hideAllParts(): void {
		// Hide all major parts of the workbench
		this.layoutService.setPartHidden(true, Parts.TITLEBAR_PART);
		this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		this.layoutService.setPartHidden(true, Parts.STATUSBAR_PART);
		this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
	}

	private showAllParts(): void {
		// Show all major parts of the workbench
		this.layoutService.setPartHidden(false, Parts.TITLEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.STATUSBAR_PART);
		// Panel and auxiliary bar remain hidden by default
	}

	private createWelcomeScreen(): void {
		// Create the main welcome screen container
		this.welcomeScreenElement = $('.welcome-screen-overlay', {
			role: 'dialog',
			'aria-label': 'Welcome to SIID'
		});

		// Add fade-in animation class
		this.welcomeScreenElement.classList.add('fade-in');

		// Create all screens dynamically from config
		this.config.screens.forEach((screenConfig, index) => {
			this.createScreenFromConfig(screenConfig, index);
		});

		// Add all screens to the overlay
		this.screenContents.forEach(screen => {
			this.welcomeScreenElement!.appendChild(screen);
		});

		// Show the first screen
		this.showScreen(0);

		// Add to document body using the appropriate window context
		const window = getWindow(this.welcomeScreenElement);
		window.document.body.appendChild(this.welcomeScreenElement);
	}

	private createScreenFromConfig(screenConfig: IScreenConfig, index: number): void {
		const contentContainer = $('.welcome-content');
		contentContainer.setAttribute('data-screen', index.toString());

		// Add logo for welcome screen
		if (screenConfig.type === 'welcome') {
			const logoContainer = this.createLogo();
			contentContainer.appendChild(logoContainer);

			// Trigger logo animation when screen is shown
			setTimeout(() => {
				logoContainer.classList.add('animate-in');
			}, 200);
		}

		// Welcome text
		const welcomeText = $('.welcome-text');
		const title = $('h1.welcome-title', {}, screenConfig.title);
		const subtitle = $('p.welcome-subtitle', {}, screenConfig.subtitle);
		welcomeText.appendChild(title);
		welcomeText.appendChild(subtitle);
		contentContainer.appendChild(welcomeText);

		// Add import settings UI if it's an import screen
		if (screenConfig.type === 'import' && screenConfig.importOptions) {
			const importContainer = this.createImportOptionsUI(screenConfig);
			contentContainer.appendChild(importContainer);
		}

		// Add content if it's a content screen
		if (screenConfig.type === 'content' && screenConfig.content) {
			const contentElement = $('.welcome-content-text');

			// Split the content by lines and create animated elements
			const lines = screenConfig.content.split('\n');
			lines.forEach((line, index) => {
				if (line.trim()) {
					const lineElement = $('.feature-line');
					lineElement.style.cssText = `
						font-size: 14px;
						line-height: 1.8;
						opacity: 0;
						transform: translateY(20px);
						animation: fadeInUp 0.5s ease forwards;
						animation-delay: ${index * 0.1}s;
						transition: all 0.3s ease;
					`;

					// Split the line by bullet points
					const parts = line.split('•').filter(part => part.trim());
					parts.forEach((part, partIndex) => {
						const partElement = $('.feature-item');
						partElement.style.cssText = `
							display: inline-block;
							margin: 0 10px;
							padding: 6px 12px;
							color: var(--vscode-editor-foreground);
							font-weight: 500;
							cursor: pointer;
							transition: all 0.3s ease;
							position: relative;
							border-radius: 4px;
							background: transparent;
						`;
						partElement.textContent = part.trim();
						lineElement.appendChild(partElement);
					});

					contentElement.appendChild(lineElement);
				}
			});

			// Add the animation keyframes
			const window = getWindow(contentElement);
			const style = window.document.createElement('style');
			style.textContent = `
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
				@keyframes pulse {
					0% { transform: scale(1); }
					50% { transform: scale(1.05); }
					100% { transform: scale(1); }
				}
				.feature-item {
					transition: all 0.3s ease !important;
				}
				.feature-item:hover {
					transform: scale(1.1) !important;
					font-size: 16px !important;
					background: var(--vscode-button-hoverBackground) !important;
					color: var(--vscode-button-foreground) !important;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
					animation: pulse 1s infinite !important;
				}
				.feature-line {
					display: flex !important;
					justify-content: center !important;
					align-items: center !important;
					flex-wrap: wrap !important;
					gap: 12px !important;
					padding: 6px 0 !important;
					margin-bottom: 8px !important;
				}
			`;
			window.document.head.appendChild(style);

			contentContainer.appendChild(contentElement);
		}

		// Add buttons
		if (screenConfig.buttons) {
			const buttonsContainer = this.createButtons(screenConfig.buttons);
			contentContainer.appendChild(buttonsContainer);
		}

		// Add to screens array
		this.screenContents.push(contentContainer);
	}

	private createLogo(): HTMLElement {
		const logoContainer = $('.welcome-logo');

		// Create inline SVG logo with the actual design
		const svgNS = 'http://www.w3.org/2000/svg';
		const logoIcon = document.createElementNS(svgNS, 'svg');
		logoIcon.setAttribute('class', 'welcome-logo-icon');
		logoIcon.setAttribute('width', '150');
		logoIcon.setAttribute('height', '150');
		logoIcon.setAttribute('viewBox', '0 0 256 256');
		logoIcon.setAttribute('fill', 'none');

		// Create defs for filter
		const defs = document.createElementNS(svgNS, 'defs');
		const filter = document.createElementNS(svgNS, 'filter');
		filter.setAttribute('id', 'filter0_d_logo');
		filter.setAttribute('x', '22.3586');
		filter.setAttribute('y', '15.98');
		filter.setAttribute('width', '211.283');
		filter.setAttribute('height', '204.56');
		filter.setAttribute('filterUnits', 'userSpaceOnUse');
		filter.setAttribute('color-interpolation-filters', 'sRGB');

		// Filter effects
		const feFlood = document.createElementNS(svgNS, 'feFlood');
		feFlood.setAttribute('flood-opacity', '0');
		feFlood.setAttribute('result', 'BackgroundImageFix');
		filter.appendChild(feFlood);

		const feColorMatrix1 = document.createElementNS(svgNS, 'feColorMatrix');
		feColorMatrix1.setAttribute('in', 'SourceAlpha');
		feColorMatrix1.setAttribute('type', 'matrix');
		feColorMatrix1.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0');
		feColorMatrix1.setAttribute('result', 'hardAlpha');
		filter.appendChild(feColorMatrix1);

		const feOffset = document.createElementNS(svgNS, 'feOffset');
		feOffset.setAttribute('dy', '0.5');
		filter.appendChild(feOffset);

		const feGaussianBlur = document.createElementNS(svgNS, 'feGaussianBlur');
		feGaussianBlur.setAttribute('stdDeviation', '2.5');
		filter.appendChild(feGaussianBlur);

		const feComposite = document.createElementNS(svgNS, 'feComposite');
		feComposite.setAttribute('in2', 'hardAlpha');
		feComposite.setAttribute('operator', 'out');
		filter.appendChild(feComposite);

		const feColorMatrix2 = document.createElementNS(svgNS, 'feColorMatrix');
		feColorMatrix2.setAttribute('type', 'matrix');
		feColorMatrix2.setAttribute('values', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0');
		filter.appendChild(feColorMatrix2);

		const feBlend1 = document.createElementNS(svgNS, 'feBlend');
		feBlend1.setAttribute('mode', 'normal');
		feBlend1.setAttribute('in2', 'BackgroundImageFix');
		feBlend1.setAttribute('result', 'effect1_dropShadow_22_40');
		filter.appendChild(feBlend1);

		const feBlend2 = document.createElementNS(svgNS, 'feBlend');
		feBlend2.setAttribute('mode', 'normal');
		feBlend2.setAttribute('in', 'SourceGraphic');
		feBlend2.setAttribute('in2', 'effect1_dropShadow_22_40');
		feBlend2.setAttribute('result', 'shape');
		filter.appendChild(feBlend2);

		defs.appendChild(filter);
		logoIcon.appendChild(defs);

		// Create group with filter
		const group = document.createElementNS(svgNS, 'g');
		group.setAttribute('filter', 'url(#filter0_d_logo)');

		// Orange path (bottom-right triangle)
		const orangePath = document.createElementNS(svgNS, 'path');
		orangePath.setAttribute('d', 'M194.56 188.416C194.56 203.12 182.64 215.04 167.936 215.04H54.036C30.3166 215.04 18.4378 186.362 35.21 169.59L149.11 55.6899C165.882 38.9178 194.56 50.7966 194.56 74.516V188.416Z');
		orangePath.setAttribute('fill', 'var(--vscode-editorWarning-foreground)');
		group.appendChild(orangePath);

		// Violet path (top-left triangle)
		const violetPath = document.createElementNS(svgNS, 'path');
		violetPath.setAttribute('d', 'M61.44 47.104C61.44 32.4 73.36 20.48 88.064 20.48H201.964C225.683 20.48 237.562 49.1578 220.79 65.93L106.89 179.83C90.1178 196.602 61.44 184.723 61.44 161.004V47.104Z');
		violetPath.setAttribute('fill', 'var(--vscode-button-background)');
		group.appendChild(violetPath);

		logoIcon.appendChild(group);
		logoContainer.appendChild(logoIcon);

		return logoContainer;
	}



	private createButtons(buttons: any[]): HTMLElement {
		const buttonsContainer = $('.welcome-buttons');

		buttons.forEach(buttonConfig => {
			const buttonClass = buttonConfig.primary ? 'welcome-button primary' : 'welcome-button secondary';
			const button = $(`button.${buttonClass}`, {
				type: 'button',
				'aria-label': buttonConfig.label,
				disabled: buttonConfig.action === 'importSettings' ? 'disabled' : undefined
			}, buttonConfig.label) as HTMLButtonElement;

			// Mark the confirm button for later state updates
			if (buttonConfig.action === 'importSettings') {
				(button as any)._isConfirmButton = true;
			}

			// Add click handler based on action
			this._register(addDisposableListener(button, 'click', () => {
				if (!button.disabled) {
					this.handleButtonAction(buttonConfig.action);
				}
			}));

			buttonsContainer.appendChild(button);
		});

		return buttonsContainer;
	}

	private handleButtonAction(action: string): void {
		switch (action) {
			case 'next':
				this.goToNextScreen();
				break;
			case 'back':
				this.goToPreviousScreen();
				break;
			case 'finish':
				this.handleGetStarted();
				break;
			case 'importSettings':
				this.handleImportSettings();
				break;
		}
	}

	private createImportOptionsUI(screenConfig: IScreenConfig): HTMLElement {
		const optionsContainer = $('.import-options-container');
		optionsContainer.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 20px;
			margin: 30px 0;
			justify-content: center;
			align-items: center;
		`;

		if (screenConfig.importOptions) {
			// Only show the first option (VS Code import)
			const option = screenConfig.importOptions[0];
			const optionCard = $('.import-option-card');
			optionCard.setAttribute('data-option-id', option.id);

			// Icon container with VS Code logo
			const iconContainer = $('.import-option-icon');

			// Create official VS Code logo as SVG - EXACT with proper gap
			const svgNS = 'http://www.w3.org/2000/svg';
			const vscodeLogo = document.createElementNS(svgNS, 'svg');
			vscodeLogo.setAttribute('width', '100%');
			vscodeLogo.setAttribute('height', '100%');
			vscodeLogo.setAttribute('viewBox', '0 0 100 100');
			vscodeLogo.setAttribute('fill', 'none');

			// Define the official VS Code gradient
			const defs = document.createElementNS(svgNS, 'defs');

			const gradient = document.createElementNS(svgNS, 'linearGradient');
			gradient.setAttribute('id', 'vscode_gradient_official');
			gradient.setAttribute('x1', '0');
			gradient.setAttribute('y1', '50');
			gradient.setAttribute('x2', '100');
			gradient.setAttribute('y2', '50');
			gradient.setAttribute('gradientUnits', 'userSpaceOnUse');

			const stop1 = document.createElementNS(svgNS, 'stop');
			stop1.setAttribute('offset', '0');
			stop1.setAttribute('stop-color', 'var(--vscode-textLink-activeForeground)');
			gradient.appendChild(stop1);

			const stop2 = document.createElementNS(svgNS, 'stop');
			stop2.setAttribute('offset', '0.5');
			stop2.setAttribute('stop-color', 'var(--vscode-textLink-foreground)');
			gradient.appendChild(stop2);

			const stop3 = document.createElementNS(svgNS, 'stop');
			stop3.setAttribute('offset', '1');
			stop3.setAttribute('stop-color', 'var(--vscode-textLink-foreground)');
			gradient.appendChild(stop3);

			defs.appendChild(gradient);
			vscodeLogo.appendChild(defs);

			// Create the official VS Code logo with the characteristic gap
			// This is the EXACT official VS Code icon shape
			const path = document.createElementNS(svgNS, 'path');
			path.setAttribute('d', 'M 95.1 86.5 L 95.1 13.4 L 74.5 4.9 C 73.4 4.4 72.1 4.5 71.1 5.2 L 27.4 36.9 L 14.3 27.5 C 13.5 26.9 12.4 26.9 11.5 27.5 L 5.1 32.4 C 4.0 33.2 4.0 34.9 5.1 35.7 L 16.2 44.5 L 5.1 53.3 C 4.0 54.1 4.0 55.8 5.1 56.6 L 11.5 61.5 C 12.4 62.1 13.5 62.1 14.3 61.5 L 27.4 52.1 L 71.1 83.8 C 72.1 84.5 73.4 84.6 74.5 84.1 L 95.1 75.6 L 95.1 13.4 Z M 74.3 25.4 L 74.3 63.6 L 41.2 44.5 L 74.3 25.4 Z');
			path.setAttribute('fill', 'url(#vscode_gradient_official)');
			path.setAttribute('transform', 'translate(2, 6) scale(0.95)');

			vscodeLogo.appendChild(path);

			iconContainer.appendChild(vscodeLogo);

			// Checkbox indicator
			const checkboxIndicator = $('div', { class: 'import-option-checkbox' });
			const checkmark = $('div', { class: 'checkbox-checkmark' }, '✓');
			checkboxIndicator.appendChild(checkmark);

			// Label
			const label = $('div', { class: 'import-option-label' }, option.label);

			// Description
			const description = $('div', { class: 'import-option-description' }, option.description);

			optionCard.appendChild(checkboxIndicator);
			optionCard.appendChild(iconContainer);
			optionCard.appendChild(label);
			optionCard.appendChild(description);

			// Handle selection
			this._register(addDisposableListener(optionCard, 'click', () => {
				// Toggle selected state
				if (optionCard.classList.contains('selected')) {
					optionCard.classList.remove('selected');
					this.importSettings.importSettings = false;
					this.importSettings.importKeybindings = false;
				} else {
					optionCard.classList.add('selected');
					this.importSettings.importSettings = true;
					this.importSettings.importKeybindings = true;
				}

				// Update button state
				this.updateImportButtonState();
			}));

			// Set initial selected state
			if (option.selected) {
				optionCard.classList.add('selected');
			}

			optionsContainer.appendChild(optionCard);
		}

		return optionsContainer;
	}

	private updateImportButtonState(): void {
		const currentScreen = this.screenContents[this.currentScreenIndex];
		const buttonsContainer = currentScreen.querySelector('.welcome-buttons') as HTMLElement | null;

		if (buttonsContainer) {
			const confirmButton = Array.from(buttonsContainer.querySelectorAll('button')).find(btn => {
				return (btn as any)._isConfirmButton === true;
			}) as HTMLButtonElement | undefined;

			if (confirmButton) {
				const selectedCard = currentScreen.querySelector('.import-option-card.selected');
				if (selectedCard) {
					// Enable button
					confirmButton.disabled = false;
				} else {
					// Disable button
					confirmButton.disabled = true;
				}
			}
		}
	}

	private async handleImportSettings(): Promise<void> {
		try {
			if (this.importSettingsService) {
				// Show loading state
				this.showLoadingState();

				// Perform import
				await this.importSettingsService.importFromVSCode(this.importSettings);

				// Hide loading state
				this.hideLoadingState();

				// Go to next screen
				this.goToNextScreen();
			}
		} catch (error) {
			console.error('Failed to import settings:', error);
			this.hideLoadingState();

			// Continue without showing error UI
			this.goToNextScreen();
		}
	}

	private showLoadingState(): void {
		const currentScreen = this.screenContents[this.currentScreenIndex];
		const buttonsContainer = currentScreen.querySelector('.welcome-buttons') as HTMLElement | null;

		if (buttonsContainer) {
			buttonsContainer.style.opacity = '0.5';
			buttonsContainer.style.pointerEvents = 'none';
		}

		// Show loading spinner or message
		const loadingMsg = $('.import-loading-message', {}, 'Importing settings...');
		loadingMsg.style.cssText = `
			text-align: center;
			color: var(--vscode-editor-foreground);
			font-size: 14px;
			opacity: 0.8;
		`;
		currentScreen.appendChild(loadingMsg);
	}

	private hideLoadingState(): void {
		const currentScreen = this.screenContents[this.currentScreenIndex];
		const buttonsContainer = currentScreen.querySelector('.welcome-buttons') as HTMLElement | null;
		const loadingMsg = currentScreen.querySelector('.import-loading-message');

		if (buttonsContainer) {
			buttonsContainer.style.opacity = '1';
			buttonsContainer.style.pointerEvents = 'auto';
		}

		if (loadingMsg) {
			loadingMsg.remove();
		}
	}

	private showScreen(index: number): void {
		// Hide all screens
		this.screenContents.forEach((screen, i) => {
			if (i === index) {
				screen.style.display = 'flex';
				screen.classList.add('fade-in');

				// Trigger animations for elements within the screen
				setTimeout(() => {
					const welcomeText = screen.querySelector('.welcome-text');
					if (welcomeText) {
						welcomeText.classList.add('animate-in');
					}
				}, 100);

				setTimeout(() => {
					const themesContainer = screen.querySelector('.welcome-themes');
					const logoContainer = screen.querySelector('.welcome-logo');
					if (themesContainer) {
						themesContainer.classList.add('animate-in');
					}
					if (logoContainer) {
						logoContainer.classList.add('animate-in');
					}
				}, 300);

				setTimeout(() => {
					const buttonsContainer = screen.querySelector('.welcome-buttons');
					if (buttonsContainer) {
						buttonsContainer.classList.add('animate-in');
					}
					// Update button state for import screens
					const isImportScreen = this.config.screens && this.config.screens[index]?.type === 'import';
					if (isImportScreen) {
						this.updateImportButtonState();
					} else {
						// Add Enter key listener for non-import screens
						this.addEnterKeyListener(screen);
					}
				}, 500);
			} else {
				screen.style.display = 'none';
				screen.classList.remove('fade-in');
				// Reset animations
				const elements = screen.querySelectorAll('.animate-in');
				elements.forEach(el => el.classList.remove('animate-in'));
			}
		});

		this.currentScreenIndex = index;
	}

	private addEnterKeyListener(screen: HTMLElement): void {
		// Get the window for this element
		const win = getWindow(screen);

		// Remove any previous Enter key listener
		const previousHandler = (screen as any)._enterKeyHandler;
		if (previousHandler) {
			win.document.removeEventListener('keydown', previousHandler);
		}

		// Create new Enter key handler
		const enterKeyHandler = (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.altKey) {
				event.preventDefault();
				// Find the primary button and click it
				const primaryButton = screen.querySelector('.welcome-button.primary') as HTMLButtonElement | null;
				if (primaryButton && !primaryButton.disabled) {
					primaryButton.click();
				}
			}
		};

		// Store handler reference for cleanup
		(screen as any)._enterKeyHandler = enterKeyHandler;

		// Add listener to document for reliable key capture
		win.document.addEventListener('keydown', enterKeyHandler);
	}

	private goToNextScreen(): void {
		if (this.currentScreenIndex < this.config.screens.length - 1) {
			this.showScreen(this.currentScreenIndex + 1);
		}
	}

	private goToPreviousScreen(): void {
		if (this.currentScreenIndex > 0) {
			this.showScreen(this.currentScreenIndex - 1);
		}
	}

	private handleGetStarted(): void {
		// Mark as dismissed
		this.storageService.store(WELCOME_SCREEN_DISMISSED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);

		// Add exit animation
		if (this.welcomeScreenElement) {
			this.welcomeScreenElement.classList.add('fade-out');

			// Wait for animation to complete before showing IDE
			setTimeout(() => {
				this.dismissWelcomeScreen();
			}, 500);
		} else {
			this.dismissWelcomeScreen();
		}
	}


	private dismissWelcomeScreen(): void {
		// Remove welcome screen element
		if (this.welcomeScreenElement) {
			this.welcomeScreenElement.remove();
			this.welcomeScreenElement = undefined;
		}

		// Show all workbench parts
		this.showAllParts();

		// Trigger layout
		this.layoutService.layout();

		// Execute welcome page command to show normal welcome
		this.commandService.executeCommand('workbench.action.showWelcomePage');
	}
}

// Register a command to reset the welcome screen for testing
class ResetWelcomeScreenAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.resetWelcomeScreen',
			title: localize2('resetWelcomeScreen', "Reset Welcome Screen"),
			category: localize2('view', "View"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		console.log('[ResetWelcomeScreen] Command triggered');

		// Get services
		const storageService = accessor.get(IStorageService);

		// Clear the dismissed flag
		storageService.remove(WELCOME_SCREEN_DISMISSED_KEY, StorageScope.PROFILE);
		console.log('[ResetWelcomeScreen] Storage flag cleared');

		// Reload the window to reinitialize
		const commandService = accessor.get(ICommandService);
		console.log('[ResetWelcomeScreen] Reloading window...');
		await commandService.executeCommand('workbench.action.reloadWindow');
	}
}

registerAction2(ResetWelcomeScreenAction);

// Register another command to show welcome screen immediately (for quick testing)
class ShowWelcomeScreenAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.showWelcomeScreenImmediate',
			title: localize2('showWelcomeScreen', "Show Welcome Screen"),
			category: localize2('view', "View"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		// Remove the dismissed flag
		storageService.remove(WELCOME_SCREEN_DISMISSED_KEY, StorageScope.PROFILE);
		console.log('[WelcomeScreen] Welcome screen flag removed from storage');
		console.log('[WelcomeScreen] Please reload the window to see the welcome screen');
	}
}

registerAction2(ShowWelcomeScreenAction);
