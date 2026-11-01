/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { WillSaveStateReason } from '../../../../../platform/storage/common/storage.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { Parts } from '../../../../services/layout/browser/layoutService.js';
import { ThemeSettingDefaults } from '../../../../services/themes/common/workbenchThemeService.js';
import { AGENTS_MODE_CLASS, AGENTS_MODE_MARKER_KEY, AgentsModeService, CLOSE_AGENTS_VIEW_COMMAND, OPEN_AGENTS_VIEW_COMMAND, OPEN_TIMEOUT_MS } from '../../browser/agentsModeService.js';

suite('AgentsModeService', () => {

	const store = new DisposableStore();
	teardown(() => store.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	interface ITestTheme { id: string; settingsId: string; type: ColorScheme }

	interface ISetupOptions {
		failOpen?: boolean;
		/** The open command only finishes when releaseOpen() is called. */
		hangOpen?: boolean;
		startTheme?: ITestTheme;
		groups?: number;
		maximized?: boolean;
		initialVisible?: [Parts, boolean][];
		storage?: Map<string, string>;
		/** Runs inside the open command (e.g. to simulate the task re-opening the panel). */
		onOpen?: (visible: Map<Parts, boolean>) => void;
	}

	function setup(opts: ISetupOptions = {}) {
		const visible = new Map<Parts, boolean>([
			[Parts.ACTIVITYBAR_PART, true], [Parts.SIDEBAR_PART, true], [Parts.PANEL_PART, false],
			[Parts.AUXILIARYBAR_PART, false], [Parts.STATUSBAR_PART, true],
			...(opts.initialVisible ?? [])
		]);
		const container = mainWindow.document.createElement('div');
		const dark: ITestTheme = { id: 'dark', settingsId: 'Dark', type: ColorScheme.DARK };
		const light: ITestTheme = { id: 'light', settingsId: ThemeSettingDefaults.COLOR_THEME_LIGHT, type: ColorScheme.LIGHT };
		const other: ITestTheme = { id: 'other', settingsId: 'Other', type: ColorScheme.DARK };
		let theme: ITestTheme = opts.startTheme ?? dark;
		const themeWrites: unknown[] = [];
		const themeEmitter = store.add(new Emitter<ITestTheme>());
		const commands: string[] = [];
		const notifications: unknown[] = [];
		const storage = opts.storage ?? new Map<string, string>();
		const storageEmitter = store.add(new Emitter<{ reason: WillSaveStateReason }>());
		const editor = { groups: opts.groups ?? 1, maximized: opts.maximized ?? false, merged: 0, unmaximized: 0 };
		let releaseOpen: () => void = () => { };

		const layout: any = {
			isVisible: (part: Parts) => visible.get(part),
			setPartHidden: (hidden: boolean, part: Parts) => visible.set(part, !hidden),
			getContainer: () => container
		};
		const setTheme = async (t: ITestTheme, target: unknown) => { themeWrites.push(target); theme = t; themeEmitter.fire(t); return t; };
		const themes: any = {
			getColorTheme: () => theme,
			getColorThemes: async () => [dark, light, other],
			setColorTheme: setTheme,
			onDidColorThemeChange: themeEmitter.event
		};
		const commandService: any = {
			executeCommand: async (id: string) => {
				commands.push(id);
				if (id === OPEN_AGENTS_VIEW_COMMAND) {
					opts.onOpen?.(visible);
					if (opts.failOpen) {
						throw new Error('command not found');
					}
					if (opts.hangOpen) {
						await new Promise<void>(resolve => { releaseOpen = resolve; });
					}
				}
			}
		};
		const notificationService: any = { notify: (n: unknown) => { notifications.push(n); } };
		const storageService: any = {
			get: (key: string) => storage.get(key),
			store: (key: string, value: string) => storage.set(key, value),
			remove: (key: string) => storage.delete(key),
			onWillSaveState: storageEmitter.event
		};
		const mainPart: any = {
			get count() { return editor.groups; },
			groups: [],
			activeGroup: { id: 1 },
			hasMaximizedGroup: () => editor.maximized,
			toggleMaximizeGroup: () => { editor.maximized = false; editor.unmaximized++; },
			mergeAllGroups: () => { editor.groups = 1; editor.merged++; return true; }
		};
		const editorGroupsService: any = { mainPart };

		const service = new AgentsModeService(layout, themes, commandService, notificationService, new MockContextKeyService(), new NullLogService(), storageService, editorGroupsService);
		store.add(service);
		return {
			service, visible, container, commands, notifications, themeWrites, storage, editor, dark, light, other,
			getTheme: () => theme,
			userPicksTheme: (t: ITestTheme) => setTheme(t, 'user'),
			willSave: (reason: WillSaveStateReason) => storageEmitter.fire({ reason }),
			releaseOpen: () => releaseOpen()
		};
	}

	const entryVisible = [true, true, false, false, true];

	test('enter hides parts and applies light theme in memory; exit restores', async () => {
		const t = setup();
		await t.service.enter();
		assert.strictEqual(t.service.isActive, true);
		assert.ok(t.container.classList.contains(AGENTS_MODE_CLASS));
		assert.ok([...t.visible.values()].every(v => !v));
		assert.strictEqual(t.getTheme().settingsId, ThemeSettingDefaults.COLOR_THEME_LIGHT);
		assert.ok(t.themeWrites.every(target => target === undefined), 'never writes settings');

		await t.service.exit();
		assert.strictEqual(t.service.isActive, false);
		assert.ok(!t.container.classList.contains(AGENTS_MODE_CLASS));
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
		assert.strictEqual(t.getTheme(), t.dark);
		assert.deepStrictEqual(t.commands, [OPEN_AGENTS_VIEW_COMMAND, CLOSE_AGENTS_VIEW_COMMAND]);
	});

	test('re-entrancy: double enter, exit while not open, toggle', async () => {
		const t = setup();
		await t.service.exit();
		assert.deepStrictEqual(t.commands, []);

		await Promise.all([t.service.enter(), t.service.enter()]);
		assert.deepStrictEqual(t.commands, [OPEN_AGENTS_VIEW_COMMAND]);

		await t.service.toggle();
		assert.strictEqual(t.service.isActive, false);
		await Promise.all([t.service.exit(), t.service.exit()]);
		assert.deepStrictEqual(t.commands, [OPEN_AGENTS_VIEW_COMMAND, CLOSE_AGENTS_VIEW_COMMAND]);
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
	});

	test('failing open command rolls back and notifies', async () => {
		const t = setup({ failOpen: true });
		await t.service.enter();
		assert.strictEqual(t.service.isActive, false);
		assert.strictEqual(t.notifications.length, 1);
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
		assert.strictEqual(t.getTheme(), t.dark);
		assert.ok(!t.container.classList.contains(AGENTS_MODE_CLASS));
		assert.strictEqual(t.storage.size, 0, 'marker removed after rollback');
	});

	// 1. Layout persistence

	test('marker is stored on enter and removed on normal exit', async () => {
		const t = setup();
		await t.service.enter();
		assert.ok(t.storage.has(AGENTS_MODE_MARKER_KEY));
		await t.service.exit();
		assert.ok(!t.storage.has(AGENTS_MODE_MARKER_KEY));
	});

	test('shutdown while in the mode restores the parts synchronously', async () => {
		const t = setup();
		await t.service.enter();
		assert.ok([...t.visible.values()].every(v => !v));
		t.willSave(WillSaveStateReason.NONE);
		assert.ok([...t.visible.values()].every(v => !v), 'idle flush does not leave the mode');
		t.willSave(WillSaveStateReason.SHUTDOWN);
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
		assert.ok(t.storage.has(AGENTS_MODE_MARKER_KEY), 'marker stays as a fallback until the next start');
		await t.service.exit();
	});

	test('startup with a leftover marker restores the saved visibilities', async () => {
		const storage = new Map<string, string>();
		const first = setup({ storage });
		await first.service.enter();
		assert.ok(storage.has(AGENTS_MODE_MARKER_KEY));

		// "next launch": parts persisted as hidden, marker still present
		const t = setup({ storage, initialVisible: [[Parts.ACTIVITYBAR_PART, false], [Parts.SIDEBAR_PART, false], [Parts.STATUSBAR_PART, false]] });
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
		assert.ok(!storage.has(AGENTS_MODE_MARKER_KEY));
		await first.service.exit();
	});

	// 2. Stuck enter

	test('open command that never finishes rolls back after the timeout; a late finish closes the view', () => runWithFakedTimers({}, async () => {
		const t = setup({ hangOpen: true });
		await t.service.enter();
		assert.ok(OPEN_TIMEOUT_MS <= 20000);
		assert.strictEqual(t.service.isActive, false);
		assert.strictEqual(t.notifications.length, 1);
		assert.deepStrictEqual([...t.visible.values()], entryVisible);
		assert.deepStrictEqual(t.commands, [OPEN_AGENTS_VIEW_COMMAND]);

		t.releaseOpen();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual(t.commands, [OPEN_AGENTS_VIEW_COMMAND, CLOSE_AGENTS_VIEW_COMMAND]);
	}));

	// 3. Restore vs user changes

	test('panel opened by the mode task is closed again; a part the user opened stays', async () => {
		const t = setup();
		await t.service.enter();
		// the terminal task re-opens the panel, the user opens the auxiliary bar (entry state: hidden)
		t.visible.set(Parts.PANEL_PART, true);
		t.visible.set(Parts.AUXILIARYBAR_PART, true);
		await t.service.exit();
		assert.strictEqual(t.visible.get(Parts.PANEL_PART), false, 'panel back to entry state');
		assert.strictEqual(t.visible.get(Parts.AUXILIARYBAR_PART), true, 'user change kept');
		assert.strictEqual(t.visible.get(Parts.SIDEBAR_PART), true);
		assert.strictEqual(t.visible.get(Parts.ACTIVITYBAR_PART), true);
	});

	test('theme picked by the user during the mode is kept; the mode own switch is not a user change', async () => {
		const t = setup();
		await t.service.enter();
		await t.userPicksTheme(t.other);
		await t.service.exit();
		assert.strictEqual(t.getTheme(), t.other);

		const u = setup();
		await u.service.enter();
		await u.service.exit();
		assert.strictEqual(u.getTheme(), u.dark);
	});

	// 4. High contrast

	test('high contrast themes are not replaced by the light theme', async () => {
		const hc: ITestTheme = { id: 'hc', settingsId: 'High Contrast', type: ColorScheme.HIGH_CONTRAST_DARK };
		const hcLight: ITestTheme = { id: 'hcl', settingsId: 'High Contrast Light', type: ColorScheme.HIGH_CONTRAST_LIGHT };
		for (const startTheme of [hc, hcLight]) {
			const t = setup({ startTheme });
			await t.service.enter();
			assert.strictEqual(t.getTheme(), startTheme);
			assert.deepStrictEqual(t.themeWrites, []);
			await t.service.exit();
			assert.strictEqual(t.getTheme(), startTheme);
		}
	});

	// 6. Maximized group

	test('a maximized editor group is un-maximized on enter', async () => {
		const t = setup({ maximized: true });
		await t.service.enter();
		assert.strictEqual(t.editor.maximized, false);
		assert.strictEqual(t.editor.unmaximized, 1);
		const u = setup();
		await u.service.enter();
		assert.strictEqual(u.editor.unmaximized, 0);
		await t.service.exit();
		await u.service.exit();
	});

	// 7. Groups after exit

	test('groups are merged on exit only when entry had a single group', async () => {
		const t = setup({ groups: 1 });
		await t.service.enter();
		t.editor.groups = 2;
		await t.service.exit();
		assert.strictEqual(t.editor.merged, 1);
		assert.strictEqual(t.editor.groups, 1);

		const u = setup({ groups: 2 });
		await u.service.enter();
		await u.service.exit();
		assert.strictEqual(u.editor.merged, 0);
		assert.strictEqual(u.editor.groups, 2);
	});
});
