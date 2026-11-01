/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/agentsMode.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IAction } from '../../../../base/common/actions.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { AgentsModeContext, AgentsModeService, IAgentsModeService } from './agentsModeService.js';

registerSingleton(IAgentsModeService, AgentsModeService, InstantiationType.Delayed);

const OPEN_ID = 'workbench.action.openAgentsMode';
const EXIT_ID = 'workbench.action.exitAgentsMode';

registerAction2(class OpenAgentsModeAction extends Action2 {
	constructor() {
		super({
			id: OPEN_ID,
			title: localize2('openAgentsMode', "Open in Agents Window"),
			tooltip: localize2('openAgentsModeTooltip', "Open in Agents Window"),
			category: localize2('agentsModeCategory', "View"),
			f1: true,
			icon: Codicon.sparkle,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KeyA
			},
			menu: {
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 100,
				when: AgentsModeContext.negate()
			}
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		// Also toggles: when Agents mode is active the shortcut returns to the editor
		return accessor.get(IAgentsModeService).toggle();
	}
});

registerAction2(class ExitAgentsModeAction extends Action2 {
	constructor() {
		super({
			id: EXIT_ID,
			title: localize2('exitAgentsMode', "Exit Agents Window"),
			tooltip: localize2('exitAgentsModeTooltip', "Open in Editor"),
			category: localize2('agentsModeCategory2', "View"),
			f1: true,
			precondition: AgentsModeContext,
			icon: Codicon.window,
			menu: {
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 100,
				when: AgentsModeContext
			}
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IAgentsModeService).exit();
	}
});

/** Icon + text button, used for the "Open in Agents" entry in the title bar. */
class OpenInAgentsActionViewItem extends BaseActionViewItem {

	constructor(action: IAction, options: IBaseActionViewItemOptions, private readonly keybindingService: IKeybindingService) {
		super(undefined, action, options);
	}

	protected override getTooltip(): string | undefined {
		const label = this.keybindingService.lookupKeybinding(OPEN_ID)?.getLabel();
		const text = localize('openInAgentsTooltip', "Open in Agents");
		return label ? localize('openInAgentsTooltipKeybinding', "{0} ({1})", text, label) : text;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('open-in-agents');
		const button = append(container, $('.open-in-agents-button'));
		append(button, $('span' + ThemeIcon.asCSSSelector(Codicon.sparkle)));
		append(button, $('span.open-in-agents-label')).textContent = localize('openInAgents', "Open in Agents");
	}
}

/** SIID logo + name, used for the title bar button that returns to the editor. */
class ExitAgentsActionViewItem extends BaseActionViewItem {

	constructor(action: IAction, options: IBaseActionViewItemOptions) {
		super(undefined, action, options);
	}

	protected override getTooltip(): string | undefined {
		return localize('exitAgentsTooltip', "Open in Editor");
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('open-in-agents');
		const button = append(container, $('.open-in-agents-button'));
		append(button, $('span.agents-siid-logo'));
		append(button, $('span.agents-siid-label')).textContent = 'SIID';
	}
}

class AgentsModeTitleBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentsModeTitleBar';

	constructor(@IActionViewItemService actionViewItemService: IActionViewItemService, @IKeybindingService keybindingService: IKeybindingService) {
		super();
		this._register(actionViewItemService.register(MenuId.TitleBar, OPEN_ID, (action, options) => new OpenInAgentsActionViewItem(action, options ?? {}, keybindingService)));
		this._register(actionViewItemService.register(MenuId.TitleBar, EXIT_ID, (action, options) => new ExitAgentsActionViewItem(action, options ?? {})));
	}
}

registerWorkbenchContribution2(AgentsModeTitleBarContribution.ID, AgentsModeTitleBarContribution, WorkbenchPhase.BlockRestore);

/** Instantiates the (lazy) service at startup so it can restore the layout when the previous session ended in Agents mode. */
class AgentsModeRecoveryContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentsModeRecovery';

	constructor(@IAgentsModeService _agentsModeService: IAgentsModeService) { }
}

registerWorkbenchContribution2(AgentsModeRecoveryContribution.ID, AgentsModeRecoveryContribution, WorkbenchPhase.AfterRestored);
