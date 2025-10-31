/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';

// Context keys for Firebase authentication state
const FirebaseAuthenticatedContext = new RawContextKey<boolean>('firebaseAuthenticated', false, localize('firebaseAuthenticated', 'Whether user is authenticated with Firebase'));

export class CustomAccountsMenuContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.customAccountsMenu';

	private readonly firebaseAuthenticatedKey = FirebaseAuthenticatedContext.bindTo(this.contextKeyService);

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();

		this.registerActions();
		this.registerMenuItems();
		this.checkAuthenticationStatus(); // Check initial auth status
	}

	private async checkAuthenticationStatus(): Promise<void> {
		try {
			const isAuthenticated = await this.commandService.executeCommand('firebase-authentication-v1.isAuthenticated');
			this.firebaseAuthenticatedKey.set(!!isAuthenticated);
		} catch (error) {
			console.error('Failed to check Firebase authentication status:', error);
			this.firebaseAuthenticatedKey.set(false);
		}
	}

	private async updateAuthenticationStatus(): Promise<void> {
		await this.checkAuthenticationStatus();
	}

	private registerActions(): void {
		// Main menu action
		this._register(registerAction2(class CustomAccountsMenuAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.main',
					title: localize2('customAccountsMenu', 'User Management'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(): Promise<void> {
				// This won't be called directly since it's a submenu
			}
		}));

		// Firebase Authentication Actions
		const self = this; // Reference to parent class for context updates

		this._register(registerAction2(class FirebaseSignInAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.signIn',
					title: localize2('firebaseSignIn', 'Firebase Sign In'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					await commandService.executeCommand('firebase-authentication-v1.signIn');
					notificationService.info(localize('signInSuccess', 'Firebase sign in initiated'));

					// Update authentication status after sign in
					setTimeout(async () => {
						await self.updateAuthenticationStatus();
					}, 1000); // Wait a bit for auth to complete
				} catch (error) {
					console.error('Failed to sign in:', error);
					notificationService.error(localize('signInError', 'Failed to sign in: {0}', error));
				}
			}
		}));

		this._register(registerAction2(class FirebaseSignOutAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.signOut',
					title: localize2('firebaseSignOut', 'Firebase Sign Out'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					await commandService.executeCommand('firebase-authentication-v1.signOut');
					notificationService.info(localize('signOutSuccess', 'Successfully signed out'));

					// Update authentication status after sign out
					await self.updateAuthenticationStatus();
				} catch (error) {
					console.error('Failed to sign out:', error);
					notificationService.error(localize('signOutError', 'Failed to sign out: {0}', error));
				}
			}
		}));

		this._register(registerAction2(class FirebaseShowProfileAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.showProfile',
					title: localize2('firebaseShowProfile', 'Show Firebase Profile'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					await commandService.executeCommand('firebase-authentication-v1.showProfile');
				} catch (error) {
					console.error('Failed to show profile:', error);
					notificationService.error(localize('showProfileError', 'Failed to show profile: {0}', error));
				}
			}
		}));

		this._register(registerAction2(class FirebaseRefreshSessionAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.refreshSession',
					title: localize2('firebaseRefreshSession', 'Refresh Firebase Session'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					await commandService.executeCommand('firebase-authentication-v1.refreshSession');
					notificationService.info(localize('refreshSessionSuccess', 'Session refreshed successfully'));
				} catch (error) {
					console.error('Failed to refresh session:', error);
					notificationService.error(localize('refreshSessionError', 'Failed to refresh session: {0}', error));
				}
			}
		}));

		this._register(registerAction2(class FirebaseGetUserInfoAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.getUserInfo',
					title: localize2('firebaseGetUserInfo', 'Get Firebase User Info'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					const userInfo = await commandService.executeCommand('firebase-authentication-v1.getUserInfo');
					if (userInfo) {
						const info = userInfo as any;
						const message = localize('userInfoMessage', 'User: {0} ({1})',
							info.displayName || 'No display name',
							info.email || 'No email'
						);
						notificationService.info(message);
					} else {
						notificationService.info(localize('noUserInfo', 'No user information available'));
					}
				} catch (error) {
					console.error('Failed to get user info:', error);
					notificationService.info(localize('getUserInfoError', 'Failed to get user info: {0}', error));
				}
			}
		}));

		// Advanced Firebase Authentication Menu Action (Dynamic based on auth status)
		this._register(registerAction2(class FirebaseAuthMenuAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.accounts.customMenu.firebase.authMenu',
					title: localize2('firebaseAuthMenu', 'Firebase Authentication'),
					category: Categories.Developer,
					f1: true
				});
			}

			async run(accessor: any): Promise<void> {
				const notificationService = accessor.get(INotificationService);
				const commandService = accessor.get(ICommandService);

				try {
					// Check authentication status first
					const isAuthenticated = await commandService.executeCommand('firebase-authentication-v1.isAuthenticated');

					if (isAuthenticated) {
						// User is logged in - show user info and options
						const userInfo = await commandService.executeCommand('firebase-authentication-v1.getUserInfo') as any;

						if (userInfo) {
							const message = localize('authMenuLoggedIn',
								'Logged in as: {0}\nEmail: {1}\nProvider: {2}',
								userInfo.displayName || 'No display name',
								userInfo.email || 'No email',
								userInfo.providerId || 'Unknown'
							);
							notificationService.info(message);
						} else {
							notificationService.info(localize('authMenuAuthenticated', 'User is authenticated but no user info available'));
						}
					} else {
						// User is not logged in
						notificationService.info(localize('authMenuNotLoggedIn', 'Not logged in to Firebase'));
					}
				} catch (error) {
					console.error('Failed to get authentication status:', error);
					notificationService.error(localize('authMenuError', 'Failed to check authentication status: {0}', error));
				}
			}
		}));
	}

	private registerMenuItems(): void {
		// Register a custom submenu ID for our developer tools
		const customSubmenuId = new MenuId('CustomDeveloperToolsSubmenu');

		// Sign In button - only show when NOT authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.signIn',
				title: localize('firebaseSignIn', 'Firebase Sign In'),
				icon: ThemeIcon.fromString('$(sign-in)')
			},
			group: 'firebase',
			order: 1,
			when: ContextKeyExpr.not('firebaseAuthenticated') // Only show when not authenticated
		});

		// Sign Out button - only show when authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.signOut',
				title: localize('firebaseSignOut', 'Firebase Sign Out'),
				icon: ThemeIcon.fromString('$(sign-out)')
			},
			group: 'firebase',
			order: 2,
			when: FirebaseAuthenticatedContext // Only show when authenticated
		});

		// Show Profile - only show when authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.showProfile',
				title: localize('firebaseShowProfile', 'Show Firebase Profile'),
				icon: ThemeIcon.fromString('$(account)')
			},
			group: 'firebase',
			order: 3,
			when: FirebaseAuthenticatedContext // Only show when authenticated
		});

		// Refresh Session - only show when authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.refreshSession',
				title: localize('firebaseRefreshSession', 'Refresh Firebase Session'),
				icon: ThemeIcon.fromString('$(refresh)')
			},
			group: 'firebase',
			order: 4,
			when: FirebaseAuthenticatedContext // Only show when authenticated
		});

		// Get User Info - only show when authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.getUserInfo',
				title: localize('firebaseGetUserInfo', 'Get Firebase User Info'),
				icon: ThemeIcon.fromString('$(info)')
			},
			group: 'firebase',
			order: 5,
			when: FirebaseAuthenticatedContext // Only show when authenticated
		});

		// Authentication Status - only show when authenticated
		MenuRegistry.appendMenuItem(customSubmenuId, {
			command: {
				id: 'workbench.accounts.customMenu.firebase.authMenu',
				title: localize('firebaseAuthMenu', 'Firebase Authentication Status'),
				icon: ThemeIcon.fromString('$(shield)')
			},
			group: 'firebase',
			order: 6,
			when: FirebaseAuthenticatedContext // Only show when authenticated
		});

		// Register the main submenu in the accounts context
		MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			submenu: customSubmenuId,
			title: localize('customDeveloperTools', 'User Management'),
			icon: ThemeIcon.fromString('$(gear)'),
			group: '4_custom',
			order: 1,
			when: ContextKeyExpr.true() // Always show this menu
		});
	}
}
