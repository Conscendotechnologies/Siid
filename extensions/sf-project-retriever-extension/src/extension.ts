/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

export async function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('SF Project Retriever extension is now active!');
  console.log('SF Project Retriever extension activated');

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('No workspace folder opened.');
    return;
  }

  // Automatically open the retrieve modal when the extension activates
  await openRetrieveModal(folder);

  // Optional: manual command to re-open the modal later
  const manual = vscode.commands.registerCommand('sf-project-retriever.retrieveNow', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage('No workspace folder opened.');
      return;
    }
    await openRetrieveModal(folder);
  });
  context.subscriptions.push(manual);
}

/**
 * Opens a small modal-like webview for retrieve confirmation
 */
async function openRetrieveModal(folder: vscode.WorkspaceFolder) {
  const panel = vscode.window.createWebviewPanel(
    'retrieveModal',
    'Salesforce Retrieve',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const updateHtml = (status: string = '', color: string = '#ccc') => {
    panel.webview.html = `
    <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', sans-serif;
            margin: 0;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: rgba(0, 0, 0, 0.75);
            color: #fff;
          }
          .modal {
            background-color: #2a2a2a;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6), 0 0 10px rgba(67,34,100,0.6);
            width: 360px;
            padding: 28px 24px 32px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            animation: fadeIn 0.25s ease-in-out;
            border: 1px solid rgba(255, 255, 255, 0.05);
          }
          h1 {
            color: #a874e3;
            font-size: 1.4em;
            font-weight: 600;
            margin-bottom: 22px;
            letter-spacing: 0.5px;
          }
          button {
            margin: 8px;
            padding: 10px 22px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease-in-out;
          }
          #retrieveBtn {
            background-color: #432264;
            color: white;
          }
          #retrieveBtn:hover {
            background-color: #5c3791;
          }
          #cancelBtn {
            background-color: #ff7800;
            color: white;
          }
          #cancelBtn:hover {
            background-color: #ff9540;
          }
          #status {
            margin-top: 18px;
            color: ${color};
            font-weight: 500;
            font-size: 13px;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
        </style>
      </head>
      <body>
        <div class="modal">
          <h1>Retrieve from Org</h1>
          <div style="display:flex; justify-content:center;">
            <button id="retrieveBtn">Retrieve</button>
            <button id="cancelBtn">Cancel</button>
          </div>
          ${status ? `<div id="status">${status}</div>` : ''}
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('retrieveBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'retrieve' });
            const s = document.getElementById('status');
            if (s) {
              s.textContent = 'Retrieving...';
              s.style.color = '#ff7800';
            }
          });
          document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
          });
        </script>
      </body>
    </html>`;
  };

  updateHtml();

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'retrieve') {
      await runRetrieveForFolder(folder, (msg: string, color?: string) => {
        updateHtml(msg, color);
      });
    } else if (msg.command === 'cancel') {
      panel.dispose();
    }
  });
}

/**
 * Executes the retrieve logic and updates status inside modal
 */
async function runRetrieveForFolder(
  folder: vscode.WorkspaceFolder,
  updateStatus: (msg: string, color?: string) => void
): Promise<void> {
  const cwd = folder.uri.fsPath;
  const targetOrg = await getWorkspaceTargetOrg(cwd);

  if (!targetOrg) {
    updateStatus('⚠️ No default org set. Please authorize or set default org.', '#ff7800');
    return;
  }

  const manifestUri = vscode.Uri.joinPath(folder.uri, 'manifest', 'package.xml');
  try {
    await vscode.workspace.fs.stat(manifestUri);
  } catch {
    updateStatus('❌ No manifest/package.xml found.', 'red');
    return;
  }

  try {
    updateStatus(`Retrieving from org: ${targetOrg} ...`, '#ff7800');
    const cmd = `sf project retrieve start --manifest manifest/package.xml --target-org ${targetOrg}`;
    await execPromise(cmd, cwd);
    updateStatus('✅ Successfully retrieved source!', 'lightgreen');
  } catch (err: any) {
    updateStatus(`❌ Retrieve failed: ${err.message || 'Unknown error'}`, 'red');
  }
}

/**
 * Reads workspace-level .sf/config.json for target-org
 */
async function getWorkspaceTargetOrg(workspaceFolder: string): Promise<string | undefined> {
  try {
    const configPath = path.join(workspaceFolder, '.sf', 'config.json');
    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
    const config = JSON.parse(content.toString());
    return config['target-org'];
  } catch {
    return undefined;
  }
}

/**
 * Executes CLI command
 */
function execPromise(cmd: string, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || stdout || err.message));
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

export function deactivate() { }
