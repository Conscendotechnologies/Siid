/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { WelcomeScreenContribution } from './welcomeScreen.js';
import './welcomeScreen.css';

registerWorkbenchContribution2(WelcomeScreenContribution.ID, WelcomeScreenContribution, WorkbenchPhase.AfterRestored);
