/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchColorTheme, IWorkbenchThemeService, ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';

export const AgentsModeContext = new RawContextKey<boolean>('siid.agentsMode', false, localize('agentsMode', "Whether the workbench is in Agents mode"));

/** Commands contributed by the bundled Siid-Code extension (publisher-independent command prefix `siid-code`). */
export const OPEN_AGENTS_VIEW_COMMAND = 'siid-code.openAgentsView';
export const CLOSE_AGENTS_VIEW_COMMAND = 'siid-code.closeAgentsView';

export const AGENTS_MODE_CLASS = 'agents-mode';

const HIDDEN_PARTS: readonly Parts[] = [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.PANEL_PART, Parts.AUXILIARYBAR_PART, Parts.STATUSBAR_PART];

export const IAgentsModeService = createDecorator<IAgentsModeService>('agentsModeService');

export interface IAgentsModeService {
	readonly _serviceBrand: undefined;
	readonly isActive: boolean;
	enter(): Promise<void>;
	exit(): Promise<void>;
	toggle(): Promise<void>;
}

const enum State { Off, Entering, On, Exiting }

interface ISavedLayout {
	readonly visibility: Map<Parts, boolean>;
	readonly theme: IWorkbenchColorTheme;
}

export class AgentsModeService extends Disposable implements IAgentsModeService {

	declare readonly _serviceBrand: undefined;

	private state = State.Off;
	private exitRequested = false;
	private saved: ISavedLayout | undefined;
	private readonly contextKey: IContextKey<boolean>;

	get isActive(): boolean { return this.state === State.On || this.state === State.Entering; }

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		// Agents mode is never persisted: a reload always starts in the normal layout.
		this.contextKey = AgentsModeContext.bindTo(contextKeyService);
	}

	toggle(): Promise<void> {
		return this.isActive ? this.exit() : this.enter();
	}

	async enter(): Promise<void> {
		if (this.state !== State.Off) {
			// Already open (or transitioning): a repeated open is a no-op, but cancels a pending exit
			this.exitRequested = false;
			return;
		}

		this.state = State.Entering;
		this.exitRequested = false;
		this.saved = this.save();

		try {
			await this.apply();
			this.contextKey.set(true);
			await this.commandService.executeCommand(OPEN_AGENTS_VIEW_COMMAND);
		} catch (error) {
			this.logService.error('[agentsMode] failed to enter Agents mode', error);
			await this.restore();
			this.state = State.Off;
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('agentsMode.failed', "Could not open Agents mode: the Siid Code Agents view is unavailable. {0}", error instanceof Error ? error.message : String(error))
			});
			return;
		}

		this.state = State.On;
		if (this.exitRequested) {
			this.exitRequested = false;
			await this.exit();
		}
	}

	async exit(): Promise<void> {
		if (this.state === State.Entering) {
			this.exitRequested = true;
			return;
		}
		if (this.state !== State.On) {
			return; // not in Agents mode (or already exiting, e.g. the extension called exit from its close handler)
		}

		this.state = State.Exiting;
		await this.restore();
		try {
			await this.commandService.executeCommand(CLOSE_AGENTS_VIEW_COMMAND);
		} catch (error) {
			this.logService.warn('[agentsMode] close command failed', error);
		}
		this.state = State.Off;
	}

	private save(): ISavedLayout {
		const visibility = new Map<Parts, boolean>();
		for (const part of HIDDEN_PARTS) {
			visibility.set(part, this.layoutService.isVisible(part, mainWindow));
		}
		return { visibility, theme: this.themeService.getColorTheme() };
	}

	private async apply(): Promise<void> {
		for (const part of HIDDEN_PARTS) {
			this.layoutService.setPartHidden(true, part);
		}
		this.setStatusBarHidden(true);
		this.layoutService.getContainer(mainWindow).classList.add(AGENTS_MODE_CLASS);

		// In-memory only: settingsTarget `undefined` never writes user settings
		const current = this.themeService.getColorTheme();
		if (current.settingsId !== ThemeSettingDefaults.COLOR_THEME_LIGHT) {
			const light = (await this.themeService.getColorThemes()).find(theme => theme.settingsId === ThemeSettingDefaults.COLOR_THEME_LIGHT);
			if (light) {
				await this.themeService.setColorTheme(light, undefined);
			}
		}
	}

	private async restore(): Promise<void> {
		const saved = this.saved;
		this.saved = undefined;
		this.contextKey.set(false);
		this.layoutService.getContainer(mainWindow).classList.remove(AGENTS_MODE_CLASS);
		if (!saved) {
			return;
		}

		try {
			if (this.themeService.getColorTheme().settingsId !== saved.theme.settingsId) {
				await this.themeService.setColorTheme(saved.theme, undefined);
			}
		} catch (error) {
			this.logService.error('[agentsMode] failed to restore theme', error);
		}

		for (const part of [...HIDDEN_PARTS].reverse()) {
			this.layoutService.setPartHidden(!saved.visibility.get(part), part);
		}
		this.setStatusBarHidden(!saved.visibility.get(Parts.STATUSBAR_PART));
	}

	/** IWorkbenchLayoutService.setPartHidden does not handle the status bar, so use the workbench's own (in-memory) toggle when present. */
	private setStatusBarHidden(hidden: boolean): void {
		(this.layoutService as unknown as { setStatusBarHidden?: (hidden: boolean) => void }).setStatusBarHidden?.(hidden);
	}
}
