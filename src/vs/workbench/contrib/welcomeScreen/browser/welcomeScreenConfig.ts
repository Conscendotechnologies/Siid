/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IWelcomeScreenConfig {
	screens: IScreenConfig[];
}

export interface IScreenConfig {
	id: string;
	title: string;
	subtitle: string;
	type: 'welcome' | 'content' | 'final';
	buttons?: IButtonConfig[];
	content?: string;
}

export interface IButtonConfig {
	label: string;
	action: 'next' | 'back' | 'finish';
	primary?: boolean;
}

export interface IFeatureConfig {
	id: string;
	title: string;
	description: string;
	icon: string;
}

// Default welcome screen configuration
export const defaultWelcomeScreenConfig: IWelcomeScreenConfig = {
	screens: [
		{
			id: 'welcome',
			title: 'Welcome to SIID',
			subtitle: 'Your intelligent coding companion',
			type: 'welcome',
			buttons: [
				{
					label: 'Next',
					action: 'next',
					primary: true
				}
			]
		},
		{
			id: 'features',
			title: 'About SIID',
			subtitle: 'Your Ultimate Salesforce Development Environment',
			type: 'content',
			content: `
• Create Objects & Fields       • Manage Profiles
• Bulk Field Creation           • Object & Field Permissions
• Set Up Record Types           • Create Roles
• Build Paths                   • Validation Rules
• Reports                       • Flows
• Assignment Rules              • LWC Components
• Apex Development              • Metadata Deployment

`,
			buttons: [
				{
					label: 'Back',
					action: 'back',
					primary: false
				},
				{
					label: 'Next',
					action: 'next',
					primary: true
				}
			]
		},
		{
			id: 'getting-started',
			title: 'Ready to Start!',
			subtitle: 'Everything is set up. Let\'s begin coding!',
			type: 'final',
			buttons: [
				{
					label: 'Back',
					action: 'back',
					primary: false
				},
				{
					label: 'Get Started',
					action: 'finish',
					primary: true
				}
			]
		}
	]
};
