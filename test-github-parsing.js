/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Mock test for GitHub release parsing
import { parseGitHubReleaseToUpdate } from './abstractUpdateService.js';

const mockGitHubRelease = {
	tag_name: 'v2025.1.0',
	name: 'Alpexium IDE Release 2025.1.0',
	published_at: '2025-11-03T10:00:00Z',
	prerelease: false,
	assets: [
		{
			name: 'SIIDUserSetup.exe',
			browser_download_url: 'https://github.com/Conscendotechnologies/AIpexium2/releases/download/v2025.1.0/SIIDUserSetup.exe',
			size: 214582235,
			digest: 'sha256:3dd6fc439753118ac528bfd9882c2ff3cbf4967b4583657c91e8cf3a7110453e'
		},
		{
			name: 'SIIDSystemSetup.exe',
			browser_download_url: 'https://github.com/Conscendotechnologies/AIpexium2/releases/download/v2025.1.0/SIIDSystemSetup.exe',
			size: 214582235,
			digest: 'sha256:1a4041267bf49475212e085f3eb575ddf1aa6b6cec0d6d5151a20cdd5ac0ddde'
		}
	]
};

const mockProductService = {
	updateUrl: 'https://api.github.com/repos/Conscendotechnologies/AIpexium2/releases',
	target: 'user'
};

// Test parsing
const result = parseGitHubReleaseToUpdate(mockGitHubRelease, 'win32-x64', mockProductService);
console.log('Parsed update:', result);

// Expected result should have:
// - version: 'v2025.1.0'
// - productVersion: '2025.1.0'
// - url: pointing to SIIDUserSetup.exe (since target is 'user')
// - sha256hash: without 'sha256:' prefix
