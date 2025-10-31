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

const WELCOME_SCREEN_DISMISSED_KEY = 'workbench.welcomeScreen.dismissed';

export class WelcomeScreenContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.welcomeScreen';

	private welcomeScreenElement: HTMLElement | undefined;
	private currentScreenIndex: number = 0;
	private screenContents: HTMLElement[] = [];
	private config: IWelcomeScreenConfig;

	constructor(
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService
	) {
		super();
		// Load config from product.json or use default
		this.config = (this.productService as any).welcomeScreenConfig || defaultWelcomeScreenConfig;
		this.init();
	}

	private async init(): Promise<void> {
		// Wait for the workbench to be restored
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// Check if welcome screen has been dismissed
		const dismissed = this.storageService.getBoolean(WELCOME_SCREEN_DISMISSED_KEY, StorageScope.PROFILE, false);

		if (!dismissed) {
			this.showWelcomeScreen();
		}
	}

	private showWelcomeScreen(): void {
		// Hide all workbench parts
		this.hideAllParts();

		// Create and show welcome screen
		this.createWelcomeScreen();
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
		orangePath.setAttribute('fill', '#FF7800');
		group.appendChild(orangePath);

		// Violet path (top-left triangle)
		const violetPath = document.createElementNS(svgNS, 'path');
		violetPath.setAttribute('d', 'M61.44 47.104C61.44 32.4 73.36 20.48 88.064 20.48H201.964C225.683 20.48 237.562 49.1578 220.79 65.93L106.89 179.83C90.1178 196.602 61.44 184.723 61.44 161.004V47.104Z');
		violetPath.setAttribute('fill', '#443264');
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
				'aria-label': buttonConfig.label
			}, buttonConfig.label);

			// Add click handler based on action
			this._register(addDisposableListener(button, 'click', () => {
				this.handleButtonAction(buttonConfig.action);
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

	run(accessor: ServicesAccessor): void {
		const storageService = accessor.get(IStorageService);
		storageService.remove(WELCOME_SCREEN_DISMISSED_KEY, StorageScope.PROFILE);
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand('workbench.action.reloadWindow');
	}
}

registerAction2(ResetWelcomeScreenAction);

