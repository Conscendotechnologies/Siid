/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../platform/commands/common/commands.js';
import { IBlockingProgressDialogService, IBlockingProgressHandle, IBlockingProgressAction, IBlockingProgressStep, BlockingProgressMode } from '../../services/progress/browser/blockingProgressDialog.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../common/contributions.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';

/** An extension that never closes its progress can not lock the UI longer than this. */
const MAX_TIMEOUT = 15 * 60_000;
const MODES: readonly string[] = ['blocking', 'dismissible', 'background'];

export interface IExtensionProgressOptions {
	title: string;
	message?: string;
	mode?: BlockingProgressMode;
	details?: string[];
	total?: number;
	cancellable?: boolean | string;
	delay?: number;
	timeout?: number;
}

/** Actions from an extension can not carry callbacks, so they run a command. */
export interface IExtensionProgressAction {
	label: string;
	primary?: boolean;
	/** Omit to just dismiss. */
	command?: string;
	args?: unknown[];
}

export interface IExtensionProgressResult {
	message?: string;
	actions?: IExtensionProgressAction[];
}

export type ExtensionProgressOp =
	| { op: 'report'; step: IBlockingProgressStep }
	| { op: 'setTitle'; title: string }
	| { op: 'complete' | 'fail'; result?: IExtensionProgressResult }
	| { op: 'close' }
	| { op: 'state' };

export interface IExtensionProgressState {
	cancelled: boolean;
}

export const SHOW_PROGRESS_COMMAND = '_siid.progress.show';
export const UPDATE_PROGRESS_COMMAND = '_siid.progress.update';

/**
 * Lets extensions use {@link IBlockingProgressDialogService}: `show` returns an id,
 * `update` drives it and returns the state (`undefined` once the task is gone).
 */
export class MainThreadBlockingProgress extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.mainThreadBlockingProgress';

	private nextId = 1;
	private readonly tasks = new Map<string, { handle: IBlockingProgressHandle; state: IExtensionProgressState }>();

	constructor(
		@IBlockingProgressDialogService private readonly progressService: IBlockingProgressDialogService,
		@ICommandService private readonly commandService: ICommandService,
		@IExtensionService extensionService: IExtensionService
	) {
		super();

		this._register(CommandsRegistry.registerCommand(SHOW_PROGRESS_COMMAND, (_accessor, options: IExtensionProgressOptions) => this.show(options)));
		this._register(CommandsRegistry.registerCommand(UPDATE_PROGRESS_COMMAND, (_accessor, id: string, update: ExtensionProgressOp) => this.update(id, update)));

		// The tasks belong to extension code, which is gone once the hosts stop
		this._register(extensionService.onWillStop(() => this.closeAll()));
	}

	private show(options: IExtensionProgressOptions): string {
		if (!options || typeof options.title !== 'string') {
			throw new Error('progress options need a title');
		}
		const handle = this.progressService.show({
			title: options.title,
			message: typeof options.message === 'string' ? options.message : undefined,
			mode: MODES.includes(options.mode as string) ? options.mode : undefined,
			details: Array.isArray(options.details) ? options.details.filter(detail => typeof detail === 'string') : undefined,
			total: typeof options.total === 'number' ? options.total : undefined,
			cancellable: typeof options.cancellable === 'string' || typeof options.cancellable === 'boolean' ? options.cancellable : undefined,
			delay: typeof options.delay === 'number' ? options.delay : undefined,
			timeout: Math.min(typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : MAX_TIMEOUT, MAX_TIMEOUT),
			source: 'extension'
		});

		const id = `ext${this.nextId++}`;
		const state: IExtensionProgressState = { cancelled: false };
		this.tasks.set(id, { handle, state });
		handle.onDidCancel(() => state.cancelled = true);
		handle.onDidClose(() => this.tasks.delete(id));
		return id;
	}

	private update(id: string, update: ExtensionProgressOp): IExtensionProgressState | undefined {
		const task = this.tasks.get(id);
		if (!task) {
			return undefined;
		}
		const { handle, state } = task;
		switch (update.op) {
			case 'report': handle.report(update.step); break;
			case 'setTitle': handle.setTitle(update.title); break;
			case 'complete': handle.complete(this.toResult(update.result)); break;
			case 'fail': handle.fail(this.toResult(update.result)); break;
			case 'close': handle.close(); break;
		}
		return { ...state };
	}

	private toResult(result: IExtensionProgressResult | undefined) {
		return result && {
			message: result.message,
			actions: result.actions?.map((action): IBlockingProgressAction => ({
				label: action.label,
				primary: action.primary,
				run: () => {
					if (typeof action.command === 'string') {
						this.commandService.executeCommand(action.command, ...(Array.isArray(action.args) ? action.args : []));
					}
				}
			}))
		};
	}

	private closeAll(): void {
		for (const { handle } of [...this.tasks.values()]) {
			handle.close();
		}
	}

	override dispose(): void {
		this.closeAll();
		super.dispose();
	}
}

registerWorkbenchContribution2(MainThreadBlockingProgress.ID, MainThreadBlockingProgress, WorkbenchPhase.BlockRestore);
