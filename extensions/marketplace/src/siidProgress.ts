import * as vscode from 'vscode';

/**
 * Typed wrapper over the SIID progress dialog commands (`_siid.progress.*`).
 * Falls back to a notification progress when the dialog service is not available (plain VS Code, old SIID build).
 */

export interface SiidProgressOptions {
	title: string;
	message?: string;
	/** `blocking` (default): overlay, no way out. `dismissible`: overlay + "Run in Background". `background`: notification only. */
	mode?: 'blocking' | 'dismissible' | 'background';
	/** Lines shown in an "Important" box. */
	details?: string[];
	/** Omit for an indeterminate bar. */
	total?: number;
	/** `true` shows "Cancel", a string is the button label. */
	cancellable?: boolean | string;
	/** ms before the dialog shows (default 300). */
	delay?: number;
	/** ms after which the dialog closes on its own (default and max 15 min). */
	timeout?: number;
}

export interface SiidProgressStep {
	message?: string;
	increment?: number;
	current?: number;
	total?: number;
}

export interface SiidProgressAction {
	label: string;
	primary?: boolean;
	/** Command to run when clicked; omit to just dismiss. */
	command?: string;
	args?: unknown[];
}

export interface SiidProgressResult {
	message?: string;
	/** With actions the finished row stays until one is clicked. */
	actions?: SiidProgressAction[];
}

export interface SiidProgress {
	readonly cancelled: boolean;
	readonly onDidCancel: vscode.Event<void>;
	report(step: SiidProgressStep): void;
	setTitle(title: string): void;
	/** What to show when the task succeeds (default: "Done"). */
	setResult(result: SiidProgressResult): void;
}

type Op =
	| { op: 'report'; step: SiidProgressStep }
	| { op: 'setTitle'; title: string }
	| { op: 'complete' | 'fail'; result?: SiidProgressResult }
	| { op: 'state' };

const SHOW = '_siid.progress.show';
const UPDATE = '_siid.progress.update';
const POLL_MS = 500;

/** Runs `task` under the progress dialog; completes it when the task resolves and fails it when it throws. */
export async function withSiidProgress<T>(options: SiidProgressOptions, task: (progress: SiidProgress) => Thenable<T>): Promise<T> {
	const cancelEmitter = new vscode.EventEmitter<void>();
	let cancelled = false;
	let result: SiidProgressResult | undefined;
	const cancel = () => {
		if (!cancelled) {
			cancelled = true;
			cancelEmitter.fire();
		}
	};
	const makeProgress = (send: (op: Op) => void): SiidProgress => ({
		get cancelled() { return cancelled; },
		onDidCancel: cancelEmitter.event,
		report: step => send({ op: 'report', step }),
		setTitle: title => send({ op: 'setTitle', title }),
		setResult: r => { result = r; }
	});

	let id: string | undefined;
	try {
		id = await vscode.commands.executeCommand<string>(SHOW, options);
	} catch {
		// not available: use the plain notification below
	}

	try {
		if (id === undefined) {
			return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: options.title, cancellable: !!options.cancellable }, (progress, token) => {
				token.onCancellationRequested(cancel);
				let current = 0;
				return task(makeProgress(op => {
					if (op.op === 'report') {
						const { step } = op;
						const next = step.current ?? current + (step.increment ?? 0);
						const total = step.total ?? options.total;
						progress.report({ message: step.message, increment: total ? (next - current) / total * 100 : undefined });
						current = next;
					}
				}));
			});
		}

		const send = async (op: Op) => {
			try {
				const state = await vscode.commands.executeCommand<{ cancelled: boolean } | undefined>(UPDATE, id, op);
				if (state?.cancelled) {
					cancel();
				}
			} catch {
				// the dialog is gone (timeout, force close); the task keeps running
			}
		};
		const timer = options.cancellable ? setInterval(() => send({ op: 'state' }), POLL_MS) : undefined;
		try {
			const value = await task(makeProgress(op => { send(op); }));
			await send({ op: 'complete', result });
			return value;
		} catch (error) {
			await send({ op: 'fail', result: { message: error instanceof Error ? error.message : String(error) } });
			throw error;
		} finally {
			clearInterval(timer);
		}
	} finally {
		cancelEmitter.dispose();
	}
}
