import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Storage } from '../utils/storage';
import { UriHandler } from './uriHandler';
import { WebAuthFlow } from './webAuthFlow';
import { FirebaseManager } from './firebaseManager';
import { AuthResult } from '../types/auth.types';

export class AuthManager {
	private readonly logger: Logger;
	private readonly storage: Storage;
	private readonly uriHandler: UriHandler;
	private readonly webAuthFlow: WebAuthFlow;
	private readonly firebaseManager: FirebaseManager;

	constructor(context: vscode.ExtensionContext, logger: Logger) {
		this.logger = logger;
		this.storage = new Storage(context);
		this.uriHandler = new UriHandler(logger, this.storage);
		this.webAuthFlow = new WebAuthFlow(logger, this.storage, this.uriHandler);
		this.firebaseManager = new FirebaseManager(logger, this.storage);
	}

	/**
	 * Initiate sign in process
	 */
	public async signIn(provider?: string): Promise<void> {
		this.logger.info(`Starting sign in process for provider: ${provider || 'default'}`);

		try {
			// Check if already authenticated
			if (await this.firebaseManager.isAuthenticated()) {
				const session = await this.firebaseManager.getCurrentSession();
				vscode.window.showInformationMessage(`Already signed in as ${session?.user.email || 'unknown user'}`);
				return;
			}

			// Show provider selection if none specified
			if (!provider) {
				provider = await this.showProviderSelection();
				if (!provider) {
					return; // User cancelled
				}
			}

			// Initiate web auth flow
			await this.webAuthFlow.initiateAuthFlow(provider);

			// Show status message
			vscode.window.showInformationMessage(
				'Authentication started. Please complete the process in your browser and you will be redirected back to VS Code.'
			);

		} catch (error) {
			this.logger.error('Sign in failed', error);
			throw error;
		}
	}

	/**
	 * Handle authentication callback from external page
	 */
	public async handleAuthCallback(uri: vscode.Uri): Promise<void> {
		this.logger.info('Processing authentication callback');

		try {
			// Process callback URI to get uid and state
			const authResult: AuthResult = await this.uriHandler.handleAuthCallback(uri);

			// Process with Firebase using the uid
			const session = await this.firebaseManager.processAuthResult(authResult);

			// Show success message
			vscode.window.showInformationMessage(
				`Successfully signed in with user ID: ${authResult.uid}!`
			);

			// Send post message to siid-code to update the UI
			try {
				await vscode.commands.executeCommand('siid-code.onFirebaseLogin', {
					uid: authResult.uid,
					email: session.user.email,
					displayName: session.user.displayName,
					photoURL: session.user.photoURL
				});
			} catch (err) {
				this.logger.error('Failed to send post message to siid-code.onFirebaseLogin', err);
			}
			this.logger.info('Sent post message to siid-code.onFirebaseLogin');


			// Optionally show profile
			this.showAuthStatus();

		} catch (error) {
			this.logger.error('Auth callback failed', error);
			vscode.window.showErrorMessage(`Authentication failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Sign out current user
	 */
	public async signOut(): Promise<void> {
		this.logger.info('Starting sign out process');

		try {
			await this.firebaseManager.signOut();
			this.logger.info('User signed out successfully');
			// Send post message to siid-code to update the UI
			try {
				await vscode.commands.executeCommand('siid-code.onFirebaseLogout');
			} catch (err) {
				this.logger.error('Failed to send post message to siid-code.onFirebaseLogout', err);
			}
			this.logger.info('Sent post message to siid-code.onFirebaseLogout');
		} catch (error) {
			this.logger.error('Sign out failed', error);
			throw error;
		}
	}

	/**
	 * Show user profile information
	 */
	public async showProfile(): Promise<void> {
		try {
			const session = await this.firebaseManager.getCurrentSession();

			if (!session) {
				vscode.window.showWarningMessage('Not signed in. Please sign in first.');
				return;
			}

			const user = session.user;
			const profileInfo = [
				`Name: ${user.displayName || 'Not provided'}`,
				`Email: ${user.email || 'Not provided'}`,
				`Provider: ${user.providerId}`,
				`Email Verified: ${user.emailVerified ? 'Yes' : 'No'}`,
				`User ID: ${user.uid}`
			].join('\n');

			vscode.window.showInformationMessage(`Firebase Profile:\n${profileInfo}`, 'OK');

		} catch (error) {
			this.logger.error('Show profile failed', error);
			throw error;
		}
	}

	/**
	 * Refresh authentication session
	 */
	public async refreshSession(): Promise<void> {
		this.logger.info('Refreshing authentication session');

		try {
			const refreshedSession = await this.firebaseManager.refreshSession();

			if (!refreshedSession) {
				vscode.window.showWarningMessage('No active session to refresh. Please sign in first.');
				return;
			}

			this.logger.info('Session refreshed successfully');
		} catch (error) {
			this.logger.error('Session refresh failed', error);
			throw error;
		}
	}

	/**
	 * Show current authentication status
	 */
	public async showAuthStatus(): Promise<void> {
		try {
			if (await this.firebaseManager.isAuthenticated()) {
				const session = await this.firebaseManager.getCurrentSession();
				const user = session?.user;

				if (user) {
					const expiresAt = new Date(session!.expiresAt).toLocaleString();
					const status = [
						'✅ Authenticated',
						`User: ${user.displayName || user.email || 'Unknown'}`,
						`Provider: ${user.providerId}`,
						`Session expires: ${expiresAt}`
					].join('\n');

					vscode.window.showInformationMessage(`Firebase Auth Status:\n${status}`, 'OK');
				}
			} else {
				vscode.window.showInformationMessage('❌ Not authenticated. Use "Firebase: Sign In" to authenticate.', 'Sign In').then((selection: string | undefined) => {
					if (selection === 'Sign In') {
						this.signIn();
					}
				});
			}
		} catch (error) {
			this.logger.error('Show auth status failed', error);
			throw error;
		}
	}

	/**
	 * Check if user is currently authenticated
	 */
	public async isAuthenticated(): Promise<boolean> {
		try {
			return await this.firebaseManager.isAuthenticated();
		} catch (error) {
			this.logger.error('Check authentication failed', error);
			return false;
		}
	}

	/**
	 * Get current user information
	 */
	public async getUserInfo(): Promise<any> {
		try {
			const session = await this.firebaseManager.getCurrentSession();
			if (!session) {
				return null;
			}

			return {
				uid: session.user.uid,
				email: session.user.email,
				displayName: session.user.displayName,
				photoURL: session.user.photoURL,
				emailVerified: session.user.emailVerified,
				providerId: session.user.providerId
			};
		} catch (error) {
			this.logger.error('Get user info failed', error);
			return null;
		}
	}

	/**
	 * Show provider selection dialog
	 */
	private async showProviderSelection(): Promise<string | undefined> {
		const providers = [
			{ label: 'Google', value: 'google' },
			{ label: 'GitHub', value: 'github' },
			{ label: 'Email/Password', value: 'email' },
			{ label: 'Default (Show all options)', value: '' }
		];

		const selection = await vscode.window.showQuickPick(providers, {
			placeHolder: 'Select authentication provider',
			canPickMany: false
		});

		return selection?.value;
	}

	/**
	 * Dispose resources
	 */
	public dispose(): void {
		this.logger.info('AuthManager disposing...');
		// Clean up any resources if needed
	}
}
