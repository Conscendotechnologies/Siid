# SF Project Retriever - VS Code Extension

This extension detects when a new workspace folder is added (for example, when the Salesforce project creation command finishes) and asks whether you'd like to retrieve the entire org source into the `force-app` folder.

## How it works (best-effort)
- Listens for workspace folder additions and for VS Code startup.
- If a new folder looks like a Salesforce project (presence of `sfdx-project.json` or naming hints), shows a modal: _"Retrieve entire org source into force-app?"_
- If the user accepts, it checks whether there are authorized orgs (`sf org list --json`).
  - If no authorized orgs are found, it prompts the user to login first.
- Runs `sf project retrieve start --metadata "*" --target-dir force-app` (tries fallback to `sfdx` if `sf` fails).
- Shows progress and reports completion.

## Install / Build
1. Ensure you have Node.js and npm installed.
2. Unzip this extension, `cd` into the folder and run:
   ```bash
   npm install
   npm run compile
   ```
3. Package / install in VS Code:
   - Use `vsce package` to create a `.vsix` file (install `vsce` globally).
   - Or, for your forked VS Code, copy the extension folder into its extensions folder or run the extension in development mode.

## Notes / Limitations
- This is a lightweight, non-invasive approach — it does not modify the Salesforce extension code.
- It relies on `sf` or `sfdx` CLI being available in PATH.
- Retrieval command behavior may vary by CLI version. Adjust the command in `src/extension.ts` if needed.

## Manual command
- The extension exposes a command `sf-project-retriever.retrieveNow` to manually trigger the prompt and retrieval for the first workspace folder (useful for testing).

## License
MIT
