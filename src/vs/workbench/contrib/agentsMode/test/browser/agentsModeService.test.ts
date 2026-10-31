/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { Parts } from '../../../../services/layout/browser/layoutService.js';
import { ThemeSettingDefaults } from '../../../../services/themes/common/workbenchThemeService.js';
import { AGENTS_MODE_CLASS, AgentsModeService, CLOSE_AGENTS_VIEW_COMMAND, OPEN_AGENTS_VIEW_COMMAND } from '../../browser/agentsModeService.js';

suite('AgentsModeService', () => {

	const store = new DisposableStore();
	teardown(() => store.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	function setup(opts: { failOpen?: boolean } = {}) {
		const visible = new Map<Parts, boolean>([
			[Parts.ACTIVITYBAR_PART, true], [Parts.SIDEBAR_PART, true], [Parts.PANEL_PART, false],
			[Parts.AUXILIARYBAR_PART, false], [Parts.STATUSBAR_PART, true]
		]);
		const container = mainWindow.document.createElement('div');
		const dark = { id: 'dark', settingsId: 'Dark' };
		const light = { id: 'light', settingsId: ThemeSettingDefaults.COLOR_THEME_LIGHT };
		let theme: { id: string; settingsId: string } = dark;
		const themeWrites: unknown[] = [];
		const commands: string[] = [];
		const notifications: unknown[] = [];

		const layout: any = {
			isVisible: (part: Parts) => visible.get(part),
			setPartHidden: (hidden: boolean, part: Parts) => visible.set(part, !hidden),
			getContainer: () => container
		};
		const themes: any = {
			getColorTheme: () => theme,
			getColorThemes: async () => [dark, light],
			setColorTheme: async (t: any, target: unknown) => { themeWrites.push(target); theme = t; return t; }
		};
		const commandService: any = {
			executeCommand: async (id: string) => {
				commands.push(id);
				if (opts.failOpen && id === OPEN_AGENTS_VIEW_COMMAND) {
					throw new Error('command not found');
				}
			}
		};
		const notificationService: any = { notify: (n: unknown) => { notifications.push(n); } };
		const service = new AgentsModeService(layout, themes, commandService, notificationService, new MockContextKeyService(), new NullLogService());
		store.add(service);
		return { service, visible, container, commands, notifications, themeWrites, getTheme: () => theme, dark };
	}

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
		assert.deepStrictEqual([...t.visible.entries()].map(([, v]) => v), [true, true, false, false, true]);
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
		assert.deepStrictEqual([...t.visible.values()], [true, true, false, false, true]);
	});

	test('failing open command rolls back and notifies', async () => {
		const t = setup({ failOpen: true });
		await t.service.enter();
		assert.strictEqual(t.service.isActive, false);
		assert.strictEqual(t.notifications.length, 1);
		assert.deepStrictEqual([...t.visible.values()], [true, true, false, false, true]);
		assert.strictEqual(t.getTheme(), t.dark);
		assert.ok(!t.container.classList.contains(AGENTS_MODE_CLASS));
	});
});
