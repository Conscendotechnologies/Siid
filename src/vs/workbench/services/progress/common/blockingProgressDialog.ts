/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import Severity from '../../../../base/common/severity.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

export const IBlockingProgressDialogService = createDecorator<IBlockingProgressDialogService>('blockingProgressDialogService');

export interface IBlockingProgressOptions {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The main message to display
	 */
	message: string;

	/**
	 * Optional icon to display
	 */
	icon?: ThemeIcon;

	/**
	 * Optional additional details in markdown format
	 */
	details?: string[];

	/**
	 * Severity level of the dialog (Info, Warning, Error)
	 */
	severity?: Severity;
}

export interface IBlockingProgressDialogService {
	readonly _serviceBrand: undefined;

	/**
	 * Show a blocking modal overlay that prevents user interaction
	 * @param options Configuration for the blocking dialog
	 * @returns An object with close and update methods to control the dialog
	 */
	show(options: IBlockingProgressOptions): {
		close: () => void;
		updateMessage: (message: string) => void;
		updateTitle: (title: string) => void;
		updateProgress: (current: number, total: number) => void;
		showRestartButton: (onRestart: () => void, onLater: () => void) => void;
	};
}

export class BlockingProgressDialogService implements IBlockingProgressDialogService {
	declare readonly _serviceBrand: undefined;

	private currentOverlay: HTMLElement | undefined;
	private currentTitleElement: HTMLElement | undefined;
	private currentMessageElement: HTMLElement | undefined;
	private currentProgressBar: HTMLElement | undefined;
	private currentProgressText: HTMLElement | undefined;
	private currentFooter: HTMLElement | undefined;
	private currentProgressContainer: HTMLElement | undefined;

	constructor() {
		console.log('[BlockingProgressDialogService] Constructor called');
	}

	show(options: IBlockingProgressOptions): {
		close: () => void;
		updateMessage: (message: string) => void;
		updateTitle: (title: string) => void;
		updateProgress: (current: number, total: number) => void;
		showRestartButton: (onRestart: () => void, onLater: () => void) => void;
	} {
		console.log('[BlockingProgressDialogService] show() called with options:', options);

		// Close any existing overlay first
		if (this.currentOverlay) {
			console.log('[BlockingProgressDialogService] Closing existing overlay');
			this.close();
		}

		// Create overlay element (transparent background for click blocking)
		const overlay = document.createElement('div');
		overlay.className = 'blocking-progress-overlay';
		overlay.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: transparent;
			z-index: 2147483647;
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: all;
		`;

		// Create dialog box (AIPexiumNight theme colors)
		const dialog = document.createElement('div');
		dialog.className = 'blocking-progress-dialog';
		dialog.style.cssText = `
			background: var(--vscode-editorWidget-background);
			border: 2px solid var(--vscode-focusBorder);
			border-radius: 4px;
			padding: 48px 44px;
			width: 65vw;
			max-width: 900px;
			min-width: 600px;
			min-height: 320px;
			box-shadow: 0 16px 64px rgba(0, 0, 0, 0.9), 0 0 0 1px var(--vscode-focusBorder);
			position: relative;
			pointer-events: all;
		`;

		// Prevent clicks on overlay from closing it and add pulse animation
		overlay.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Add pulse animation to dialog when overlay is clicked
			dialog.style.animation = 'none';
			setTimeout(() => {
				dialog.style.animation = 'pulse-shake 0.5s ease-out';
			}, 10);
		});

		// Prevent clicks inside dialog from triggering overlay pulse
		dialog.addEventListener('click', (e) => {
			e.stopPropagation();
		});

		// Add pulse-shake animation styles
		const style = document.createElement('style');
		style.textContent = `
			@keyframes pulse-shake {
				0%, 100% {
					transform: scale(1) translateX(0);
					border-color: var(--vscode-focusBorder);
				}
				10%, 30%, 50%, 70%, 90% {
					transform: scale(1.001) translateX(-1px);
					border-color: var(--vscode-editorWarning-foreground);
				}
				20%, 40%, 60%, 80% {
					transform: scale(1.001) translateX(1 px);
					border-color: var(--vscode-editorWarning-foreground);
				}
			}
			@keyframes shimmer {
				0% { background-position: 200% 0; }
				100% { background-position: -200% 0; }
			}
		`;
		document.head.appendChild(style);

		// Create title
		const title = document.createElement('div');
		title.className = 'blocking-progress-title';
		title.textContent = options.title;
		title.style.cssText = `
			font-size: 18px;
			font-weight: 600;
			color: var(--vscode-editorWarning-foreground);
			margin-bottom: 20px;
			display: flex;
			align-items: center;
			gap: 12px;
		`;

		// Add icon if provided
		if (options.icon) {
			const icon = document.createElement('span');
			icon.className = `codicon codicon-${options.icon.id} codicon-modifier-spin`;
			icon.style.cssText = `
				font-size: 20px;
				color: var(--vscode-editorWarning-foreground);
			`;
			title.prepend(icon);
		}

		// Create message (current step - bold and prominent)
		const message = document.createElement('div');
		message.className = 'blocking-progress-message';
		message.textContent = options.message;
		message.style.cssText = `
			font-size: 16px;
			font-weight: 600;
			color: var(--vscode-editor-foreground);
			line-height: 1.6;
			margin-bottom: 20px;
		`;

		// Create enhanced reassurance section
		const description = document.createElement('div');
		description.className = 'blocking-progress-description';
		description.style.cssText = `
			font-size: 13px;
			color: var(--vscode-textLink-foreground);
			line-height: 1.6;
			margin-bottom: 24px;
			padding: 16px 20px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-focusBorder);
			border-left: 4px solid var(--vscode-editorWarning-foreground);
			border-radius: 4px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		`;

		// Create header
		const descHeader = document.createElement('div');
		descHeader.textContent = '⚠ Important:';
		descHeader.style.cssText = 'font-weight: 600; margin-bottom: 8px; color: var(--vscode-editorWarning-foreground);';
		description.appendChild(descHeader);

		// Create bullet points
		const bullet1 = document.createElement('div');
		bullet1.textContent = '• Please wait...';
		bullet1.style.cssText = 'margin-bottom: 6px;';
		description.appendChild(bullet1);

		const bullet2 = document.createElement('div');
		bullet2.textContent = '• Extensions are being configured for your workspace';
		bullet2.style.cssText = 'margin-bottom: 6px;';
		description.appendChild(bullet2);

		const bullet3 = document.createElement('div');
		bullet3.textContent = '• This process may take 2-3 minutes';
		description.appendChild(bullet3);

		// Create progress container
		const progressContainer = document.createElement('div');
		progressContainer.className = 'blocking-progress-container';
		progressContainer.style.cssText = `
			margin-bottom: 16px;
		`;

		// Create progress bar background
		const progressBarBg = document.createElement('div');
		progressBarBg.className = 'blocking-progress-bar-bg';
		progressBarBg.style.cssText = `
			width: 100%;
			height: 14px;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-progressBar-background);
			border-radius: 6px;
			overflow: hidden;
			position: relative;
		`;

		// Create progress bar fill
		const progressBarFill = document.createElement('div');
		progressBarFill.className = 'blocking-progress-bar-fill';
		progressBarFill.style.cssText = `
			height: 100%;
			width: 0%;
			background: linear-gradient(90deg, var(--vscode-focusBorder) 0%, var(--vscode-textLink-foreground) 50%, var(--vscode-focusBorder) 100%);
			background-size: 200% 100%;
			border-radius: 6px;
			transition: width 0.3s ease-out;
			animation: shimmer 2s infinite linear;
		`;

		progressBarBg.appendChild(progressBarFill);
		progressContainer.appendChild(progressBarBg);

		// Create progress text
		const progressText = document.createElement('div');
		progressText.className = 'blocking-progress-text';
		progressText.textContent = '0%';
		progressText.style.cssText = `
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-top: 10px;
			text-align: right;
			font-weight: 500;
		`;

		progressContainer.appendChild(progressText);

		// Create footer status line
		const footer = document.createElement('div');
		footer.className = 'blocking-progress-footer';
		footer.textContent = 'Configuring environment...';
		footer.style.cssText = `
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-top: 24px;
			padding-top: 20px;
			border-top: 1px solid var(--vscode-widget-border);
			text-align: center;
			font-style: italic;
		`;

		// Assemble dialog
		dialog.appendChild(title);
		dialog.appendChild(message);
		dialog.appendChild(description);
		dialog.appendChild(progressContainer);
		dialog.appendChild(footer);
		overlay.appendChild(dialog);

		// Add to DOM
		document.body.appendChild(overlay);
		this.currentOverlay = overlay;
		this.currentTitleElement = title;
		this.currentMessageElement = message;
		this.currentProgressBar = progressBarFill;
		this.currentProgressText = progressText;
		this.currentFooter = footer;
		this.currentProgressContainer = progressContainer;

		console.log('[BlockingProgressDialogService] Overlay shown');

		// Return control functions
		return {
			close: () => this.close(),
			updateMessage: (newMessage: string) => {
				if (this.currentMessageElement) {
					this.currentMessageElement.textContent = newMessage;
					console.log('[BlockingProgressDialogService] Message updated:', newMessage);
				}
			},
			updateTitle: (newTitle: string) => {
				if (this.currentTitleElement) {
					// Preserve icon if it exists
					const icon = this.currentTitleElement.querySelector('.codicon');
					this.currentTitleElement.textContent = newTitle;
					if (icon) {
						this.currentTitleElement.prepend(icon);
					}
					console.log('[BlockingProgressDialogService] Title updated:', newTitle);
				}
			},
			updateProgress: (current: number, total: number) => {
				if (this.currentProgressBar && this.currentProgressText) {
					const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
					this.currentProgressBar.style.width = `${percentage}%`;
					this.currentProgressText.textContent = `${current} / ${total} (${percentage}%)`;
					console.log('[BlockingProgressDialogService] Progress updated:', current, '/', total, `(${percentage}%)`);
				}
			},
			showRestartButton: (onRestart: () => void, onLater: () => void) => {
				if (!this.currentFooter || !this.currentProgressContainer) {
					return;
				}

				// Hide progress bar and footer
				this.currentProgressContainer.style.display = 'none';
				this.currentFooter.style.display = 'none';

				// Update message
				if (this.currentMessageElement) {
					this.currentMessageElement.textContent = 'Update complete! A window reload is required to activate the updated extensions.';
				}

				// Create button container
				const buttonContainer = document.createElement('div');
				buttonContainer.style.cssText = `
					display: flex;
					gap: 12px;
					justify-content: flex-end;
					margin-top: 24px;
					padding-top: 20px;
					border-top: 1px solid var(--vscode-widget-border);
				`;

				// Create Restart button
				const restartButton = document.createElement('button');
				restartButton.textContent = 'Reload Window';
				restartButton.style.cssText = `
					background: var(--vscode-button-background);
					color: var(--vscode-editorWarning-foreground);
					border: 1px solid var(--vscode-focusBorder);
					border-radius: 4px;
					padding: 8px 20px;
					font-size: 13px;
					font-weight: 600;
					cursor: pointer;
					transition: background 0.2s ease;
				`;
				restartButton.addEventListener('mouseenter', () => {
					restartButton.style.background = 'var(--vscode-button-hoverBackground)';
				});
				restartButton.addEventListener('mouseleave', () => {
					restartButton.style.background = 'var(--vscode-button-background)';
				});
				restartButton.addEventListener('click', () => {
					onRestart();
				});

				// Create Later button
				const laterButton = document.createElement('button');
				laterButton.textContent = 'Later';
				laterButton.style.cssText = `
					background: var(--vscode-button-secondaryBackground);
					color: var(--vscode-editorWarning-foreground);
					border: 1px solid var(--vscode-widget-border);
					border-radius: 4px;
					padding: 8px 20px;
					font-size: 13px;
					font-weight: 600;
					cursor: pointer;
					transition: background 0.2s ease;
				`;
				laterButton.addEventListener('mouseenter', () => {
					laterButton.style.background = 'var(--vscode-button-secondaryHoverBackground)';
				});
				laterButton.addEventListener('mouseleave', () => {
					laterButton.style.background = 'var(--vscode-button-secondaryBackground)';
				});
				laterButton.addEventListener('click', () => {
					onLater();
					this.close();
				});

				buttonContainer.appendChild(laterButton);
				buttonContainer.appendChild(restartButton);

				// Find dialog and append buttons
				const dialogEl = this.currentOverlay?.querySelector('.blocking-progress-dialog');
				if (dialogEl) {
					dialogEl.appendChild(buttonContainer);
				}

				console.log('[BlockingProgressDialogService] Restart buttons shown');
			}
		};
	}

	private close(): void {
		console.log('[BlockingProgressDialogService] close() called');
		if (this.currentOverlay) {
			this.currentOverlay.remove();
			this.currentOverlay = undefined;
			this.currentTitleElement = undefined;
			this.currentMessageElement = undefined;
			this.currentProgressBar = undefined;
			this.currentProgressText = undefined;
			this.currentFooter = undefined;
			this.currentProgressContainer = undefined;
			console.log('[BlockingProgressDialogService] Overlay removed');
		}
	}
}

registerSingleton(IBlockingProgressDialogService, BlockingProgressDialogService, InstantiationType.Delayed);
