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
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchColorTheme, IWorkbenchThemeService, ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';

export const AgentsModeContext = new RawContextKey<boolean>('siid.agentsMode', false, localize('agentsMode', "Whether the workbench is in Agents mode"));

/** Commands contributed by the bundled Siid-Code extension (publisher-independent command prefix `siid-code`). */
export const OPEN_AGENTS_VIEW_COMMAND = 'siid-code.openAgentsView';
export const CLOSE_AGENTS_VIEW_COMMAND = 'siid-code.closeAgentsView';

export const AGENTS_MODE_CLASS = 'agents-mode';

/** How long to wait for the Agents view to open before rolling back. */
export const OPEN_TIMEOUT_MS = 15000;

/** Workspace-storage marker (value: entry visibilities) present while Agents mode may have left the layout persisted as hidden. */
export const AGENTS_MODE_MARKER_KEY = 'siid.agentsMode.layoutSnapshot';

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
	readonly groupCount: number;
}

export class AgentsModeService extends Disposable implements IAgentsModeService {

	declare readonly _serviceBrand: undefined;

	private state = State.Off;
	private exitRequested = false;
	private saved: ISavedLayout | undefined;
	/** Visibility right after the mode finished setting itself up; differences at exit are changes made during the mode. */
	private baseline: Map<Parts, boolean> | undefined;
	private modeTheme: IWorkbenchColorTheme | undefined;
	private settingTheme = false;
	private userChangedTheme = false;
	private readonly contextKey: IContextKey<boolean>;

	get isActive(): boolean { return this.state === State.On || this.state === State.Entering; }

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService
	) {
		super();
		this.contextKey = AgentsModeContext.bindTo(contextKeyService);

		this._register(this.themeService.onDidColorThemeChange(theme => {
			if (this.modeTheme && !this.settingTheme && theme.settingsId !== this.modeTheme.settingsId) {
				this.userChangedTheme = true;
			}
		}));

		// The workbench persists part visibility on shutdown. If we are still in Agents mode then, put the entry
		// visibilities back synchronously so the hidden layout is not written. (The marker below is the fallback.)
		this._register(this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN && this.saved && this.state !== State.Off) {
				this.restoreParts(this.saved);
			}
		}));

		this.recoverFromUncleanShutdown();
	}

	/** A marker left behind means the previous run ended in Agents mode (crash, or persisted before restore) with parts possibly stored as hidden. */
	private recoverFromUncleanShutdown(): void {
		const raw = this.storageService.get(AGENTS_MODE_MARKER_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}
		this.storageService.remove(AGENTS_MODE_MARKER_KEY, StorageScope.WORKSPACE);
		try {
			const entries = JSON.parse(raw) as [Parts, boolean][];
			this.restoreParts({ visibility: new Map(entries) });
			this.logService.info('[agentsMode] restored layout after a previous session ended in Agents mode');
		} catch (error) {
			this.logService.error('[agentsMode] invalid layout snapshot', error);
		}
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
		this.userChangedTheme = false;
		this.saved = this.save();
		this.storageService.store(AGENTS_MODE_MARKER_KEY, JSON.stringify([...this.saved.visibility]), StorageScope.WORKSPACE, StorageTarget.MACHINE);

		try {
			// A maximized editor group can hide the Agents panel; un-maximizing keeps every editor open
			const mainPart = this.editorGroupsService.mainPart;
			if (mainPart.hasMaximizedGroup()) {
				mainPart.toggleMaximizeGroup();
			}
			await this.apply();
			this.contextKey.set(true);
			await this.openAgentsView();
			this.baseline = this.currentVisibility();
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

	private async openAgentsView(): Promise<void> {
		const open = Promise.resolve(this.commandService.executeCommand(OPEN_AGENTS_VIEW_COMMAND));
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				reject(new Error(localize('agentsMode.timeout', "Timed out waiting for the Agents view.")));
			}, OPEN_TIMEOUT_MS);
		});
		try {
			await Promise.race([open, timeout]);
		} finally {
			clearTimeout(timer);
			if (timedOut) {
				// The view may still appear later; close it so it does not open over the restored layout
				open.then(() => this.commandService.executeCommand(CLOSE_AGENTS_VIEW_COMMAND)).catch(() => { /* open failed or close unavailable */ });
			}
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
		const groupCountAtEntry = this.saved?.groupCount;
		await this.restore();
		try {
			await this.commandService.executeCommand(CLOSE_AGENTS_VIEW_COMMAND);
		} catch (error) {
			this.logService.warn('[agentsMode] close command failed', error);
		}
		this.mergeGroupsCreatedByMode(groupCountAtEntry);
		this.state = State.Off;
	}

	/** If the user entered with a single group and the mode left several, fold them back into one. Editors are moved, never closed. */
	private mergeGroupsCreatedByMode(groupCountAtEntry: number | undefined): void {
		const part = this.editorGroupsService.mainPart;
		if (groupCountAtEntry !== 1 || part.count <= 1) {
			return;
		}
		try {
			if (part.groups.some(group => group.isLocked)) {
				return; // locked groups are a deliberate layout
			}
			if (!part.mergeAllGroups(part.activeGroup)) {
				this.logService.warn('[agentsMode] could not merge all editor groups; leaving them as they are');
			}
		} catch (error) {
			this.logService.warn('[agentsMode] failed to merge editor groups', error);
		}
	}

	private currentVisibility(): Map<Parts, boolean> {
		const visibility = new Map<Parts, boolean>();
		for (const part of HIDDEN_PARTS) {
			visibility.set(part, this.layoutService.isVisible(part, mainWindow));
		}
		return visibility;
	}

	private save(): ISavedLayout {
		return { visibility: this.currentVisibility(), theme: this.themeService.getColorTheme(), groupCount: this.editorGroupsService.mainPart.count };
	}

	private async apply(): Promise<void> {
		for (const part of HIDDEN_PARTS) {
			this.layoutService.setPartHidden(true, part);
		}
		this.setStatusBarHidden(true);
		this.layoutService.getContainer(mainWindow).classList.add(AGENTS_MODE_CLASS);

		// In-memory only: settingsTarget `undefined` never writes user settings. High contrast themes are an accessibility choice and stay.
		const current = this.themeService.getColorTheme();
		this.modeTheme = current;
		if (current.settingsId !== ThemeSettingDefaults.COLOR_THEME_LIGHT && !isHighContrast(current.type)) {
			const light = (await this.themeService.getColorThemes()).find(theme => theme.settingsId === ThemeSettingDefaults.COLOR_THEME_LIGHT);
			if (light) {
				this.settingTheme = true;
				try {
					await this.themeService.setColorTheme(light, undefined);
				} finally {
					this.settingTheme = false;
				}
				this.modeTheme = light;
			}
		}
	}

	private async restore(): Promise<void> {
		const saved = this.saved;
		const baseline = this.baseline;
		const modeTheme = this.modeTheme;
		const userChangedTheme = this.userChangedTheme;
		this.saved = undefined;
		this.baseline = undefined;
		this.modeTheme = undefined;
		this.contextKey.set(false);
		this.layoutService.getContainer(mainWindow).classList.remove(AGENTS_MODE_CLASS);
		if (!saved) {
			return;
		}

		// Parts first and synchronously: this is what the shutdown save must see
		this.restoreParts(saved, baseline);
		this.storageService.remove(AGENTS_MODE_MARKER_KEY, StorageScope.WORKSPACE);

		try {
			// Leave the theme alone if the user picked another one during the mode
			const current = this.themeService.getColorTheme();
			if (!userChangedTheme && modeTheme && current.settingsId === modeTheme.settingsId && current.settingsId !== saved.theme.settingsId) {
				this.settingTheme = true;
				try {
					await this.themeService.setColorTheme(saved.theme, undefined);
				} finally {
					this.settingTheme = false;
				}
			}
		} catch (error) {
			this.logService.error('[agentsMode] failed to restore theme', error);
		}
	}

	/**
	 * Puts parts back to their entry state. A part whose visibility differs from `baseline` was changed while in the
	 * mode and is kept as is, except the panel: the only thing that opens it is the mode's own task (terminal.show),
	 * so it goes back to its entry state.
	 */
	private restoreParts(saved: { readonly visibility: Map<Parts, boolean> }, baseline?: Map<Parts, boolean>): void {
		for (const part of [...HIDDEN_PARTS].reverse()) {
			if (baseline && part !== Parts.PANEL_PART && this.layoutService.isVisible(part, mainWindow) !== baseline.get(part)) {
				continue;
			}
			this.layoutService.setPartHidden(!saved.visibility.get(part), part);
			if (part === Parts.STATUSBAR_PART) {
				this.setStatusBarHidden(!saved.visibility.get(part));
			}
		}
	}

	/** IWorkbenchLayoutService.setPartHidden does not handle the status bar, so use the workbench's own (in-memory) toggle when present. */
	private setStatusBarHidden(hidden: boolean): void {
		(this.layoutService as unknown as { setStatusBarHidden?: (hidden: boolean) => void }).setStatusBarHidden?.(hidden);
	}
}
