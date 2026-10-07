/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { ILoggerService, NullLogger } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { ILifecycleService } from '../../../lifecycle/common/lifecycle.js';
import { BlockingProgressDialogService, IBlockingProgressOptions } from '../../browser/blockingProgressDialog.js';

suite('BlockingProgressDialogService', () => {

	const disposables = new DisposableStore();
	let clock: sinon.SinonFakeTimers;
	let container: HTMLElement;
	let notificationProgress: string[];
	let service: BlockingProgressDialogService;

	setup(() => {
		clock = sinon.useFakeTimers();
		container = mainWindow.document.body.appendChild(mainWindow.document.createElement('div'));
		notificationProgress = [];

		service = disposables.add(new BlockingProgressDialogService(
			{ activeContainer: container } as ILayoutService,
			{ withProgress: (options: { title?: string }) => { notificationProgress.push(options.title ?? ''); return Promise.resolve(); } } as unknown as IProgressService,
			{} as INotificationService,
			{} as IDialogService,
			{ onBeforeShutdown: Event.None } as unknown as ILifecycleService,
			{ createLogger: () => new NullLogger() } as unknown as ILoggerService
		));
	});

	teardown(() => {
		disposables.clear();
		container.remove();
		clock.restore();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	const rows = () => container.querySelectorAll('.siid-progress-row').length;
	const overlays = () => container.querySelectorAll('.siid-progress-overlay').length;
	const show = (options: Partial<IBlockingProgressOptions> = {}) => service.show({ title: 'Task', ...options });

	test('a task that finishes before the delay never shows a dialog', () => {
		const handle = show();
		clock.tick(100);
		handle.complete();
		clock.tick(1000);
		assert.strictEqual(overlays(), 0);
	});

	test('concurrent tasks merge into one overlay and it closes with the last row', () => {
		const first = show({ title: 'A' });
		clock.tick(300);
		const second = show({ title: 'B' });
		clock.tick(0);

		assert.strictEqual(overlays(), 1);
		assert.strictEqual(rows(), 2);

		first.close();
		second.close();
		assert.strictEqual(overlays(), 0);
	});

	test('cancel button fires onDidCancel once', () => {
		const handle = show({ cancellable: true });
		let cancels = 0;
		disposables.add(handle.onDidCancel(() => cancels++));
		clock.tick(300);

		const button = container.querySelector<HTMLElement>('.siid-progress-row-actions .monaco-button')!;
		button.click();
		button.click();
		assert.strictEqual(cancels, 1);
		handle.close();
	});

	test('timeout cancels and closes the task', () => {
		const handle = show({ timeout: 1000 });
		let cancelled = false;
		let closed = false;
		disposables.add(handle.onDidCancel(() => cancelled = true));
		disposables.add(handle.onDidClose(() => closed = true));
		clock.tick(300);
		assert.strictEqual(overlays(), 1);

		clock.tick(700);
		assert.ok(cancelled && closed);
		assert.strictEqual(overlays(), 0);
	});

	test('background mode uses a notification and no overlay', () => {
		const handle = show({ mode: 'background', title: 'Bg' });
		clock.tick(1000);
		assert.deepStrictEqual(notificationProgress, ['Bg']);
		assert.strictEqual(overlays(), 0);
		handle.close();
	});

	test('report updates the bar', () => {
		const handle = show({ total: 4 });
		clock.tick(300);
		handle.report({ current: 1 });
		assert.strictEqual(container.querySelector('.siid-progress-text')!.textContent, '1 / 4 (25%)');
		handle.close();
	});
});
