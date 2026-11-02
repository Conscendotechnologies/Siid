/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs with node's built-in runner against the compiled output: `npm test` after `npm run compile`.

const assert = require('node:assert');
const { test } = require('node:test');
const { autoUpdateKey, hasVersionFolder, isUpgrade, splitUpdates, staleAutoUpdateKeys } = require('../out/updatePolicy.js');

test('isUpgrade only allows a higher packaged version', () => {
	assert.strictEqual(isUpgrade('2026.0.64', '2026.1.0'), true);
	assert.strictEqual(isUpgrade('2026.1.0', '2026.1.0'), false);
	assert.strictEqual(isUpgrade('2026.2.0', '2026.1.0'), false, 'never downgrades');
	assert.strictEqual(isUpgrade('2026.1.0-agent', '2026.1.0'), true, 'a prerelease is older than its release');
	assert.strictEqual(isUpgrade('2026.1.0', '2026.1.0-agent'), false);
});

test('splitUpdates separates required, already installed and optional updates', () => {
	const required = { fileName: 'a.vsix', extensionId: 'pub.a', version: '2.0.0', autoUpdate: true };
	const installedElsewhere = { fileName: 'b.vsix', extensionId: 'pub.b', version: '2.0.0', autoUpdate: true };
	const optional = { fileName: 'c.vsix', extensionId: 'pub.c', version: '2.0.0' };
	const seen = new Set([autoUpdateKey(installedElsewhere)]);

	assert.deepStrictEqual(splitUpdates([required, installedElsewhere, optional], key => seen.has(key)), {
		automatic: [required],
		alreadyInstalled: [installedElsewhere],
		optional: [optional]
	});
});

test('the install record is per version, so a newer pin updates again', () => {
	const seen = new Set([autoUpdateKey({ fileName: 'a.vsix', extensionId: 'pub.a', version: '2.0.0', autoUpdate: true })]);
	const next = { fileName: 'a.vsix', extensionId: 'pub.a', version: '2.1.0', autoUpdate: true };
	assert.deepStrictEqual(splitUpdates([next], key => seen.has(key)).automatic, [next]);
});

test('stale install records are the ones for other versions; other state is kept', () => {
	const packaged = [{ fileName: 'a.vsix', extensionId: 'pub.a', version: '2.1.0', autoUpdate: true }];
	const current = autoUpdateKey(packaged[0]);
	const previous = autoUpdateKey({ ...packaged[0], version: '2.0.0' });
	const removedFromManifest = autoUpdateKey({ fileName: 'b.vsix', extensionId: 'pub.b', version: '1.0.0' });

	assert.deepStrictEqual(staleAutoUpdateKeys([current, previous, removedFromManifest, 'marketplace.other'], packaged), [previous, removedFromManifest]);
	assert.deepStrictEqual(staleAutoUpdateKeys([current], packaged), []);
});

test('hasVersionFolder finds the install folder of that exact version', () => {
	const folders = ['conscendotechinc.siid-code-2026.0.64', 'conscendotechinc.siid-code-2026.1.0', 'pub.b-1.0.0-win32-x64', '.obsolete'];
	assert.strictEqual(hasVersionFolder(folders, 'ConscendoTechInc.siid-code', '2026.1.0'), true, 'ignores case');
	assert.strictEqual(hasVersionFolder(folders, 'pub.b', '1.0.0'), true, 'allows a platform suffix');
	assert.strictEqual(hasVersionFolder(folders, 'ConscendoTechInc.siid-code', '2026.2.0'), false);
	assert.strictEqual(hasVersionFolder(folders, 'ConscendoTechInc.siid-code', '2026.1'), false, 'no partial version match');
});

test('a required update can never take the optional (toast) path', () => {
	const required = { fileName: 'a.vsix', extensionId: 'pub.a', version: '2.0.0', autoUpdate: true };
	assert.deepStrictEqual(splitUpdates([required], () => false).optional, []);
	assert.deepStrictEqual(splitUpdates([required], () => true).optional, []);
});
