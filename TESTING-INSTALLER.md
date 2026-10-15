# Testing the Installer Dependency Page

How to build and run the Windows installer to test the **"Required Dependencies"**
wizard page (Salesforce CLI / Node.js / Java JDK detection + install flow).

There are two ways to build, depending on what you need to test.

---

## Option A — Fast UI test (recommended for iterating)

Compiles **only** the installer wizard (`build/win32/code.iss`) with a stub
payload. Takes a couple of seconds. Use this to test the dependency page and
install flow. **It does NOT contain a real IDE** — the wizard runs, but there's
no product inside.

### Build

```powershell
powershell -ExecutionPolicy Bypass -File .\test-installer.ps1
```

### Build and launch in one step

```powershell
powershell -ExecutionPolicy Bypass -File .\test-installer.ps1 -Run
```

### Output location

```
C:\Users\<you>\AppData\Local\Temp\siid-installer-test\out\SIIDSetup.exe
```

The script prints this path when it finishes. The `siid-installer-test` folder
is **wiped and rebuilt on every run** — don't keep anything in it.

> **Note:** Close any previously-run `SIIDSetup.exe` before rebuilding, or the
> compile fails with *"The process cannot access the file… used by another
> process"* (a file lock, not a code error).

### Requirements

- `node_modules\innosetup\bin\ISCC.exe` must exist (run `npm install` if missing).

---

## Option B — Real, installable IDE (full build)

Produces the actual shippable installer with the real IDE inside. Slow
(requires the app to be built first).

```
npx gulp vscode-win32-x64-user-setup
```

This is also what the **GitHub Actions "Build SIID (Testing)"** workflow runs.

---

## Testing on GitHub Actions builds

If you download an installer from GitHub Actions, **match the artifact label to
the branch you want**:

| Artifact / filename label | Branch | Has the new dependency page? |
| ------------------------- | ------ | ---------------------------- |
| `installer-flow`          | `add-salesforce-cli` | ✅ Yes |
| `siid-forge-main`         | `siid-forge` branch  | ❌ No |

> ⚠️ Common mistake: running the `siid-forge-main` build and thinking the page
> is missing. It's on the **`installer-flow`** build. Check the filename.

---

## What you'll see on the Required Dependencies page

Three rows — **Salesforce CLI**, **Java JDK 17**, **Node.js LTS** — each with a
colour-coded status tag and glyph:

| State | Colour | Glyph | Meaning |
| ----- | ------ | ----- | ------- |
| `Installed (version)` | green | ✓ | Already present |
| `Not found – will be installed` | amber | • | Missing, will install on Next |
| `Installing via winget/npm… (Ns)` | navy | — | In progress (live counter) |
| `Failed …` | red | ✗ | Install failed (with manual command) |

### To see the *install* flow (not just green rows)

If everything is already installed you'll only see three green ✓ rows. To
exercise the live install path, remove one dependency first:

```powershell
npm uninstall -g @salesforce/cli    # then run the installer -> watch it reinstall
```

- **Salesforce CLI** installs via `npm install -g @salesforce/cli`.
- **Java JDK** installs via winget (`Azul.Zulu.17.JDK`).
- **Node.js** installs via winget (`OpenJS.NodeJS.LTS`).

> Java and Node are machine-scope MSIs, so Windows will show a **UAC /
> administrator prompt**. The installer warns about this up front — that's
> expected, not a bug.

---

## Recovering the script if it "disappears"

`test-installer.ps1` only exists on the **`add-salesforce-cli`** branch. If you
switch branches it won't be in the folder. It is committed, so restore it with:

```powershell
git checkout add-salesforce-cli -- test-installer.ps1
```
