/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure update rules. No `vscode` import, so test/updatePolicy.test.js can run them with plain node.

export interface UpdateCandidate {
	fileName: string;
	extensionId?: string;
	version?: string;
	autoUpdate?: boolean;
}

export interface SplitUpdates<T> {
	/** Must install automatically, and no earlier start has done it yet. */
	automatic: T[];
	/** Must install automatically, but an earlier start or another window already did; it applies on reload. */
	alreadyInstalled: T[];
	/** The user chooses, through the toast. */
	optional: T[];
}

export function compareVersions(v1: string, v2: string): number {
	// A suffix such as "-agent" ("1.2.64-agent") is split off before the numeric parse; it only breaks ties.
	const [core1, pre1] = splitVersion(v1);
	const [core2, pre2] = splitVersion(v2);
	const v1Parts = core1.split('.').map(Number);
	const v2Parts = core2.split('.').map(Number);

	for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
		const p1 = v1Parts[i] || 0;
		const p2 = v2Parts[i] || 0;
		if (p1 > p2) { return 1; }
		if (p1 < p2) { return -1; }
	}
	// Same numbers: a bare version is newer than one with a prerelease suffix (semver); two suffixes compare as text.
	if (pre1 === pre2) { return 0; }
	if (!pre1) { return 1; }
	if (!pre2) { return -1; }
	return pre1 > pre2 ? 1 : -1;
}

function splitVersion(version: string): [string, string] {
	const match = /^([^-+]*)(?:-([^+]*))?/.exec(version.trim());
	return [match?.[1] ?? version, match?.[2] ?? ''];
}

/** True only for a real upgrade: a user on a higher (or the same) version keeps theirs. */
export function isUpgrade(installedVersion: string, packagedVersion: string): boolean {
	return compareVersions(installedVersion, packagedVersion) < 0;
}

const AUTO_UPDATE_KEY_PREFIX = 'marketplace.autoUpdated.';

/** globalState key recording that this exact version was installed successfully. */
export function autoUpdateKey(ext: UpdateCandidate): string {
	return `${AUTO_UPDATE_KEY_PREFIX}${ext.extensionId ?? ext.fileName}@${ext.version}`;
}

/** Install records that no longer match a packaged version, such as those left by the previous pin. */
export function staleAutoUpdateKeys(keys: readonly string[], packaged: UpdateCandidate[]): string[] {
	const current = new Set(packaged.map(autoUpdateKey));
	return keys.filter(key => key.startsWith(AUTO_UPDATE_KEY_PREFIX) && !current.has(key));
}

/** Matches VS Code's install folders: `publisher.name-1.2.3`, plus `-win32-x64` for a platform build. */
export function hasVersionFolder(folderNames: string[], extensionId: string, version: string): boolean {
	const folder = `${extensionId}-${version}`.toLowerCase();
	return folderNames.some(name => {
		const lower = name.toLowerCase();
		return lower === folder || lower.startsWith(`${folder}-`);
	});
}

export function splitUpdates<T extends UpdateCandidate>(updates: T[], wasInstalled: (key: string) => boolean): SplitUpdates<T> {
	const result: SplitUpdates<T> = { automatic: [], alreadyInstalled: [], optional: [] };
	for (const ext of updates) {
		if (!ext.autoUpdate) {
			result.optional.push(ext);
		} else if (wasInstalled(autoUpdateKey(ext))) {
			result.alreadyInstalled.push(ext);
		} else {
			result.automatic.push(ext);
		}
	}
	return result;
}
