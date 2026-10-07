/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/blockingProgressDialog.css';
import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { DeferredPromise, disposableTimeout } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogger, ILoggerService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgress, IProgressDialogOptions, IProgressNotificationOptions, IProgressService, IProgressStep, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { ILifecycleService } from '../../lifecycle/common/lifecycle.js';

export const IBlockingProgressDialogService = createDecorator<IBlockingProgressDialogService>('blockingProgressDialogService');

/**
 * - `blocking`: overlay, no way out.
 * - `dismissible`: overlay with "Run in Background", which moves the task to a notification.
 * - `background`: no overlay, a notification right away.
 */
export type BlockingProgressMode = 'blocking' | 'dismissible' | 'background';

export interface IBlockingProgressOptions {
	title: string;
	message?: string;
	/** Default `blocking`. */
	mode?: BlockingProgressMode;
	/** Icon shown while running, default a spinning sync icon. */
	icon?: ThemeIcon;
	/** Plain-text lines shown in an "Important" box. */
	details?: string[];
	/** Omit for an indeterminate bar. */
	total?: number;
	/** `true` shows "Cancel", a string is used as the button label. */
	cancellable?: boolean | string;
	/** ms before the dialog appears, so fast tasks never flash. Default 300, 0 when the overlay is already open. */
	delay?: number;
	/** ms after which the task is cancelled and closed, so a lost caller can never lock the UI. */
	timeout?: number;
	/** Who asked, for the log. */
	source?: string;
}

export interface IBlockingProgressStep {
	message?: string;
	increment?: number;
	current?: number;
	total?: number;
}

export interface IBlockingProgressAction {
	label: string;
	primary?: boolean;
	run(): void;
}

export interface IBlockingProgressResult {
	message?: string;
	/** With actions the row stays until one is clicked. */
	actions?: IBlockingProgressAction[];
}

export interface IBlockingProgressHandle {
	/** The user pressed Cancel (or the timeout / force close hit). The caller decides what to stop. */
	readonly onDidCancel: Event<void>;
	readonly onDidClose: Event<void>;
	report(step: IBlockingProgressStep): void;
	setTitle(title: string): void;
	complete(result?: IBlockingProgressResult): void;
	fail(result?: IBlockingProgressResult): void;
	close(): void;
}

export interface IBlockingProgressDialogService {
	readonly _serviceBrand: undefined;

	/** One overlay for all callers: a request made while it is open becomes another row in it. */
	show(options: IBlockingProgressOptions): IBlockingProgressHandle;
}

const DEFAULT_DELAY = 300;
const LINGER_MS = 1200;
const FORCE_CLOSE_AFTER_MS = 60_000;

type Outcome = 'completed' | 'failed' | 'closed' | 'timeout' | 'forceClosed';

class ProgressTask {

	status: 'running' | 'done' | 'failed' | 'closed' = 'running';
	title: string;
	message: string | undefined;
	current = 0;
	total: number | undefined;
	cancelling = false;
	row: ProgressRow | undefined;
	notification: { done: DeferredPromise<void>; progress?: IProgress<IProgressStep> } | undefined;

	readonly startedAt = Date.now();
	readonly timers = new DisposableStore();
	readonly onDidCancel = new Emitter<void>();
	readonly onDidClose = new Emitter<void>();

	constructor(readonly id: string, readonly options: IBlockingProgressOptions) {
		this.title = options.title;
		this.message = options.message;
		this.total = options.total;
	}

	get mode(): BlockingProgressMode {
		return this.options.mode ?? 'blocking';
	}

	/** @returns how much `current` moved */
	apply(step: IBlockingProgressStep): number {
		const before = this.current;
		if (step.total !== undefined) {
			this.total = step.total;
		}
		if (step.current !== undefined) {
			this.current = step.current;
		} else if (step.increment) {
			this.current += step.increment;
		}
		if (step.message !== undefined) {
			this.message = step.message;
		}
		return this.current - before;
	}
}

function setIcon(element: HTMLElement, icon: ThemeIcon, spin = false): void {
	element.className = ThemeIcon.asClassName(icon) + (spin ? ' codicon-modifier-spin' : '');
}

class ProgressRow extends Disposable {

	readonly element = $('.siid-progress-row');

	private readonly icon: HTMLElement;
	private readonly titleElement: HTMLElement;
	private readonly messageElement: HTMLElement;
	private readonly bar: HTMLElement;
	private readonly fill: HTMLElement;
	private readonly text: HTMLElement;
	private readonly actions: HTMLElement;
	private cancelButton: Button | undefined;

	constructor(private readonly task: ProgressTask, onCancel: () => void) {
		super();

		const title = append(this.element, $('.siid-progress-row-title'));
		this.icon = append(title, $('span'));
		setIcon(this.icon, task.options.icon ?? Codicon.sync, true);
		this.titleElement = append(title, $('span'));
		this.messageElement = append(this.element, $('.siid-progress-row-message', { 'aria-live': 'polite' }));

		if (task.options.details?.length) {
			const box = append(this.element, $('.siid-progress-details'));
			const header = append(box, $('.siid-progress-details-header'));
			setIcon(append(header, $('span')), Codicon.warning);
			append(header, $('span')).textContent = localize('progressImportant', "Important");
			for (const detail of task.options.details) {
				append(box, $('div')).textContent = detail;
			}
		}

		this.bar = append(this.element, $('.siid-progress-bar', { role: 'progressbar', 'aria-valuemin': '0' }));
		this.fill = append(this.bar, $('.siid-progress-bar-fill'));
		this.text = append(this.element, $('.siid-progress-text'));
		this.actions = append(this.element, $('.siid-progress-row-actions'));

		if (task.options.cancellable) {
			const cancel = this.cancelButton = this._register(new Button(this.actions, { ...defaultButtonStyles, secondary: true }));
			cancel.label = typeof task.options.cancellable === 'string' ? task.options.cancellable : localize('progressCancel', "Cancel");
			this._register(cancel.onDidClick(() => onCancel()));
		}

		this.update();
	}

	update(): void {
		const { task } = this;
		this.titleElement.textContent = task.title;
		this.messageElement.textContent = task.cancelling ? localize('progressCancelling', "Cancelling…") : task.message ?? '';

		const total = task.total ?? 0;
		this.bar.classList.toggle('indeterminate', total <= 0);
		if (total > 0) {
			const percent = Math.min(100, Math.round(task.current / total * 100));
			this.fill.style.width = `${percent}%`;
			this.text.textContent = `${task.current} / ${total} (${percent}%)`;
			this.bar.setAttribute('aria-valuemax', String(total));
			this.bar.setAttribute('aria-valuenow', String(task.current));
		} else {
			this.fill.style.width = '';
			this.text.textContent = '';
			this.bar.removeAttribute('aria-valuemax');
			this.bar.removeAttribute('aria-valuenow');
		}

		if (this.cancelButton) {
			this.cancelButton.enabled = !task.cancelling;
		}
	}

	showResult(failed: boolean, message: string, actions: IBlockingProgressAction[], onDone: () => void): void {
		this.element.classList.toggle('failed', failed);
		setIcon(this.icon, failed ? Codicon.error : Codicon.check);
		this.messageElement.textContent = message;
		this.bar.style.display = 'none';
		this.text.style.display = 'none';

		this.cancelButton = undefined;
		clearNode(this.actions);
		const buttons = actions.map(action => {
			const button = this._register(new Button(this.actions, { ...defaultButtonStyles, secondary: !action.primary }));
			button.label = action.label;
			this._register(button.onDidClick(() => {
				action.run();
				onDone();
			}));
			return button;
		});
		buttons[buttons.length - 1]?.focus();
	}
}

interface IOverlay {
	readonly element: HTMLElement;
	readonly dialog: HTMLElement;
	readonly list: HTMLElement;
	readonly footer: HTMLElement;
	readonly forceClose: HTMLElement;
	readonly runInBackground: Button;
	readonly store: DisposableStore;
	readonly previousFocus: Element | null;
	forceCloseShown: boolean;
}

export class BlockingProgressDialogService extends Disposable implements IBlockingProgressDialogService {

	declare readonly _serviceBrand: undefined;

	private readonly log: ILogger;
	private readonly running = new Set<ProgressTask>();
	private readonly visible = new Set<ProgressTask>();
	private overlay: IOverlay | undefined;
	private nextId = 1;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IProgressService private readonly progressService: IProgressService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService dialogService: IDialogService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILoggerService loggerService: ILoggerService,
	) {
		super();
		this.log = this._register(loggerService.createLogger('siid.progress', { name: localize('progressLogName', "SIID Progress") }));

		this._register(lifecycleService.onBeforeShutdown(e => {
			if (this.running.size) {
				e.veto(dialogService.confirm({
					type: 'warning',
					message: localize('progressQuitMessage', "An operation is still in progress. Do you want to quit anyway?"),
					detail: [...this.running].map(task => task.title).join('\n'),
					primaryButton: localize('progressQuitAnyway', "Quit Anyway")
				}).then(result => !result.confirmed), 'siid.progress');
			}
		}));
	}

	show(options: IBlockingProgressOptions): IBlockingProgressHandle {
		const task = new ProgressTask(`p${this.nextId++}`, options);
		this.running.add(task);
		this.log.info(`[${task.id}] start "${task.title}" mode=${task.mode}${options.source ? ` source=${options.source}` : ''}`);

		if (task.mode === 'background') {
			this.toProgressService(task, ProgressLocation.Notification);
		} else {
			disposableTimeout(() => this.attach(task), this.overlay ? 0 : options.delay ?? DEFAULT_DELAY, task.timers);
		}
		if (options.timeout) {
			disposableTimeout(() => {
				this.log.warn(`[${task.id}] timed out after ${options.timeout}ms`);
				task.onDidCancel.fire();
				this.end(task, 'timeout');
			}, options.timeout, task.timers);
		}

		return {
			onDidCancel: task.onDidCancel.event,
			onDidClose: task.onDidClose.event,
			report: step => {
				if (task.status !== 'running') {
					return;
				}
				const delta = task.apply(step);
				task.row?.update();
				this.reportToProgressService(task, delta);
			},
			setTitle: title => {
				if (task.status === 'running') {
					task.title = title;
					task.row?.update();
				}
			},
			complete: result => this.end(task, 'completed', result),
			fail: result => this.end(task, 'failed', result),
			close: () => this.end(task, 'closed')
		};
	}

	private end(task: ProgressTask, outcome: Outcome, result?: IBlockingProgressResult): void {
		if (task.status !== 'running') {
			return;
		}
		const failed = outcome === 'failed';
		task.status = failed ? 'failed' : outcome === 'completed' ? 'done' : 'closed';
		task.timers.clear();
		this.running.delete(task);
		this.log.info(`[${task.id}] ${outcome} after ${Date.now() - task.startedAt}ms "${task.title}"`);

		const showsResult = outcome === 'completed' || failed;
		const actions = result?.actions?.length ? result.actions : failed ? [{ label: localize('progressDismiss', "Dismiss"), run: () => { } }] : [];
		const message = result?.message ?? (failed ? localize('progressFailed', "Failed") : localize('progressDone', "Done"));

		if (task.notification) {
			task.notification.done.complete();
			if (showsResult && actions.length) {
				this.notificationService.prompt(failed ? Severity.Error : Severity.Info, message, actions.map(action => ({ label: action.label, run: () => action.run() })));
			}
		} else if (showsResult && (actions.length || this.visible.has(task))) {
			// Results with actions must be seen, so they open the overlay even if the delay has not elapsed
			if (!this.visible.has(task)) {
				this.attach(task);
			}
			if (task.row) {
				task.row.showResult(failed, message, actions, () => this.detach(task));
				if (!actions.length) {
					disposableTimeout(() => this.detach(task), LINGER_MS, task.timers);
				}
				this.refresh();
			}
		} else {
			this.detach(task);
		}

		task.onDidClose.fire();
		task.onDidCancel.dispose();
		task.onDidClose.dispose();
	}

	private cancel(task: ProgressTask): void {
		if (task.cancelling || task.status !== 'running') {
			return;
		}
		task.cancelling = true;
		this.log.info(`[${task.id}] cancel requested "${task.title}"`);
		task.row?.update();
		task.onDidCancel.fire();
	}

	private attach(task: ProgressTask): void {
		if (this.visible.has(task) || (task.status === 'running') === false && !task.row && task.status === 'closed') {
			return;
		}
		try {
			const overlay = this.overlay ?? this.createOverlay();
			task.row = new ProgressRow(task, () => this.cancel(task));
			append(overlay.list, task.row.element);
			this.visible.add(task);
			this.refresh();
		} catch (error) {
			// The old workbench progress UI is the fallback when the custom overlay cannot render
			this.log.error(`[${task.id}] overlay failed, falling back to workbench progress: ${error}`);
			this.detach(task);
			if (task.status === 'running') {
				this.toProgressService(task, task.mode === 'blocking' ? ProgressLocation.Dialog : ProgressLocation.Notification);
			}
		}
	}

	private detach(task: ProgressTask): void {
		task.row?.dispose();
		task.row?.element.remove();
		task.row = undefined;
		this.visible.delete(task);
		this.refresh();
	}

	private active(): ProgressTask[] {
		return [...this.visible].filter(task => task.status === 'running');
	}

	private refresh(): void {
		const overlay = this.overlay;
		if (!overlay) {
			return;
		}
		if (!this.visible.size) {
			this.closeOverlay();
			return;
		}
		const active = this.active();
		const canRunInBackground = active.length > 0 && active.every(task => task.mode !== 'blocking');
		const showForceClose = overlay.forceCloseShown && active.length > 0;
		overlay.element.classList.toggle('idle', active.length === 0);
		overlay.runInBackground.element.style.display = canRunInBackground ? '' : 'none';
		overlay.forceClose.style.display = showForceClose ? '' : 'none';
		overlay.footer.style.display = canRunInBackground || showForceClose ? '' : 'none';
	}

	private createOverlay(): IOverlay {
		const container = this.layoutService.activeContainer;
		const store = new DisposableStore();
		const element = append(container, $('.siid-progress-overlay'));
		store.add({ dispose: () => element.remove() });
		const dialog = append(element, $('.siid-progress-dialog', {
			tabindex: '-1',
			role: 'alertdialog',
			'aria-modal': 'true',
			'aria-label': localize('progressDialogLabel', "Operations in progress")
		}));
		const list = append(dialog, $('.siid-progress-rows'));
		const footer = append(dialog, $('.siid-progress-footer'));
		const forceClose = append(footer, $('button.siid-progress-force-close'));
		forceClose.textContent = localize('progressForceClose', "Force close");
		append(footer, $('.siid-progress-spacer'));
		const runInBackground = store.add(new Button(footer, { ...defaultButtonStyles, secondary: true }));
		runInBackground.label = localize('progressRunInBackground', "Run in Background");

		const overlay: IOverlay = { element, dialog, list, footer, forceClose, runInBackground, store, previousFocus: container.ownerDocument.activeElement, forceCloseShown: false };
		this.overlay = overlay;

		store.add(runInBackground.onDidClick(() => this.runInBackground()));
		store.add(addDisposableListener(forceClose, EventType.CLICK, () => this.forceCloseAll()));
		store.add(disposableTimeout(() => {
			overlay.forceCloseShown = true;
			this.refresh();
		}, FORCE_CLOSE_AFTER_MS));

		store.add(addDisposableListener(element, EventType.CLICK, e => {
			if (e.target === element && this.active().length) {
				dialog.classList.remove('shake');
				void dialog.offsetWidth; // restart the animation
				dialog.classList.add('shake');
			}
		}));
		store.add(addDisposableListener(dialog, 'animationend', () => dialog.classList.remove('shake')));
		store.add(addDisposableListener(element, EventType.KEY_DOWN, e => this.onKeyDown(new StandardKeyboardEvent(e), overlay)));

		dialog.focus();
		return overlay;
	}

	private onKeyDown(event: StandardKeyboardEvent, overlay: IOverlay): void {
		if (event.keyCode === KeyCode.Escape) {
			const active = this.active();
			if (active.length && active.every(task => task.mode !== 'blocking')) {
				event.preventDefault();
				event.stopPropagation();
				this.runInBackground();
			}
		} else if (event.keyCode === KeyCode.Tab) {
			const focusable = [...overlay.dialog.querySelectorAll<HTMLElement>('.monaco-button:not(.disabled), .siid-progress-force-close')].filter(element => element.offsetParent !== null);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const current = overlay.element.ownerDocument.activeElement;
			if (!first) {
				event.preventDefault();
			} else if (event.shiftKey && (current === first || current === overlay.dialog)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && current === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	private closeOverlay(): void {
		const overlay = this.overlay;
		if (overlay) {
			this.overlay = undefined;
			overlay.store.dispose();
			if (overlay.previousFocus instanceof HTMLElement && overlay.previousFocus.isConnected) {
				overlay.previousFocus.focus();
			}
		}
	}

	private runInBackground(): void {
		for (const task of this.active()) {
			this.detach(task);
			this.toProgressService(task, ProgressLocation.Notification);
		}
	}

	private forceCloseAll(): void {
		for (const task of [...this.visible]) {
			if (task.status === 'running') {
				this.log.warn(`[${task.id}] force closed "${task.title}"`);
				task.onDidCancel.fire();
				this.end(task, 'forceClosed');
			}
			this.detach(task);
		}
	}

	private toProgressService(task: ProgressTask, location: ProgressLocation.Notification | ProgressLocation.Dialog): void {
		const cancellable = !!task.options.cancellable;
		const done = new DeferredPromise<void>();
		task.notification = { done };
		const options: IProgressNotificationOptions | IProgressDialogOptions = location === ProgressLocation.Dialog
			? { location, title: task.title, cancellable, sticky: !cancellable }
			: { location, title: task.title, cancellable, source: task.options.source };

		this.progressService.withProgress(options, progress => {
			task.notification!.progress = progress;
			this.reportToProgressService(task, task.current);
			return done.p;
		}, () => this.cancel(task));
	}

	private reportToProgressService(task: ProgressTask, increment: number): void {
		task.notification?.progress?.report({ message: task.message, total: task.total, increment });
	}
}

registerSingleton(IBlockingProgressDialogService, BlockingProgressDialogService, InstantiationType.Delayed);
