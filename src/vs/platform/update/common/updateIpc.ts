/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IUpdateService, State } from './update.js';

export class UpdateChannel implements IServerChannel {

	constructor(private service: IUpdateService) {
		console.log('[DEBUG-UPDATE] UpdateChannel MAIN PROCESS constructor - wrapping service:', service.constructor.name);
	}

	listen(_: unknown, event: string): Event<any> {
		console.log('[DEBUG-UPDATE] UpdateChannel MAIN PROCESS listen called for event:', event);
		switch (event) {
			case 'onStateChange':
				console.log('[DEBUG-UPDATE] UpdateChannel MAIN PROCESS returning onStateChange event');
				return this.service.onStateChange;
		}

		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		console.log('[DEBUG-UPDATE] UpdateChannel.call MAIN PROCESS received command:', command, 'with arg:', arg);
		switch (command) {
			case 'checkForUpdates':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service.checkForUpdates with arg:', arg);
				const result = this.service.checkForUpdates(arg);
				console.log('[DEBUG-UPDATE] UpdateChannel service.checkForUpdates returned:', result);
				return result;
			case 'downloadUpdate':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service.downloadUpdate');
				return this.service.downloadUpdate();
			case 'applyUpdate':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service.applyUpdate');
				return this.service.applyUpdate();
			case 'quitAndInstall':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service.quitAndInstall');
				return this.service.quitAndInstall();
			case '_getInitialState':
				console.log('[DEBUG-UPDATE] UpdateChannel getting initial state:', this.service.state);
				return Promise.resolve(this.service.state);
			case 'isLatestVersion':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service.isLatestVersion');
				return this.service.isLatestVersion();
			case '_applySpecificUpdate':
				console.log('[DEBUG-UPDATE] UpdateChannel calling service._applySpecificUpdate with path:', arg);
				return this.service._applySpecificUpdate(arg);
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class UpdateChannelClient implements IUpdateService {

	declare readonly _serviceBrand: undefined;
	private readonly disposables = new DisposableStore();

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	private _state: State = State.Uninitialized;
	get state(): State { return this._state; }
	set state(state: State) {
		console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER state changed from', this._state.type, 'to', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	constructor(private readonly channel: IChannel) {
		console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER constructor - setting up IPC channel');
		this.disposables.add(this.channel.listen<State>('onStateChange')(state => {
			console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER received state change event:', state);
			this.state = state;
		}));
		this.channel.call<State>('_getInitialState').then(state => {
			console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER got initial state:', state);
			this.state = state;
		});
	}

	checkForUpdates(explicit: boolean): Promise<void> {
		console.log('[DEBUG-UPDATE] UpdateChannelClient.checkForUpdates RENDERER called with explicit:', explicit);
		console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER making IPC call to main process');
		const promise = this.channel.call<void>('checkForUpdates', explicit);
		promise.then(() => {
			console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER IPC call completed successfully');
		}).catch(err => {
			console.log('[DEBUG-UPDATE] UpdateChannelClient RENDERER IPC call failed:', err);
		});
		return promise;
	}

	downloadUpdate(): Promise<void> {
		return this.channel.call('downloadUpdate');
	}

	applyUpdate(): Promise<void> {
		return this.channel.call('applyUpdate');
	}

	quitAndInstall(): Promise<void> {
		return this.channel.call('quitAndInstall');
	}

	isLatestVersion(): Promise<boolean | undefined> {
		return this.channel.call('isLatestVersion');
	}

	_applySpecificUpdate(packagePath: string): Promise<void> {
		return this.channel.call('_applySpecificUpdate', packagePath);
	}

	dispose(): void {
		this.disposables.dispose();
	}
}
