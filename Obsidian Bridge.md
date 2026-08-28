# Obsidian Bridge

**Obsidian Bridge** is a fully local Windows workflow for sending VS Code selections and Markdown files to an Obsidian vault. It consists of a VS Code extension and an optional Obsidian desktop companion plugin for working with the currently active note or Canvas. No online API, cloud key, or external data transfer is required.

**Created by [Daryoush Alipour Tirotir](https://github.com/tirotir-ir)**  
**VS Code Marketplace publisher:** [daryoushalipourtirotir](https://marketplace.visualstudio.com/publishers/daryoushalipourtirotir)  
**GitHub repository:** [tirotir-ir/obsidian-bridge](https://github.com/tirotir-ir/obsidian-bridge)

> JSON Canvas stores `nodes` and `edges` arrays at the document root. Text nodes contain `text` in addition to their required position and size fields. This project preserves and generates that format. [1]

| Component | Location | Purpose |
|---|---|---|
| VS Code extension | `dist/obsidian-bridge-0.1.3.vsix` | Provides the four commands, context menus, keyboard shortcuts, and local file operations. |
| Optional Obsidian companion | `dist/obsidian-bridge-companion/` | Detects the active Canvas or Markdown note and adds text nodes to the active Canvas. |
| Extension source | `vscode-extension/` | TypeScript source, manifest contributions, settings, and file operations. |
| Companion source | `obsidian-plugin/` | TypeScript source and the bundled Obsidian desktop plugin. |

## Architecture and privacy

The note creation, note append, file copy/link, and configured Canvas operations use the local filesystem directly. To open the result, the extension launches the standard `obsidian://open` URI with the registered vault name and a vault-relative file path. Obsidian supports this URI for cross-application workflows, and URI values must be encoded. [2]

The optional companion listens only on `127.0.0.1`, using port `27124` by default. Requests must include the generated `x-obsidian-bridge-token` header. The listener is therefore not exposed to the local network or the Internet. If the companion is unavailable, the VS Code extension falls back to `obsidianBridge.canvasPath` for Canvas operations and prompts for a note path when appending to a note.

## Installation on Windows 11

### 1. Install the VS Code extension

In VS Code, press `Ctrl+Shift+P`, run **Extensions: Install from VSIX...**, and select `obsidian-bridge-0.1.3.vsix`. Alternatively, use PowerShell:

```powershell
code --install-extension .\obsidian-bridge-0.1.3.vsix
```

VS Code exposes contributed commands through the Command Palette and other user-interface locations. [3] After installation, run **Developer: Reload Window**.

### 2. Configure the vault

Open VS Code Settings and search for **Obsidian Bridge**, or open `settings.json` directly. At minimum, set the vault path. For the vault provided in the request, use:

```json
{
  "obsidianBridge.vaultPath": "C:\\O\\others",
  "obsidianBridge.defaultFolder": "Inbox",
  "obsidianBridge.canvasPath": "Boards/VS Code Inbox.canvas",
  "obsidianBridge.currentFileMode": "ask"
}
```

The extension settings are declared through the VS Code configuration contribution point and read from the user settings. [4]

| Setting | Required | Example | Behavior |
|---|---:|---|---|
| `obsidianBridge.vaultPath` | Yes | `C:\\O\\others` | Absolute path to the target vault. |
| `obsidianBridge.canvasPath` | For file-only Canvas mode | `Boards/VS Code Inbox.canvas` | Absolute or vault-relative Canvas path. |
| `obsidianBridge.defaultFolder` | No | `Inbox` | Destination folder for new notes and copied Markdown files. |
| `obsidianBridge.vaultName` | No | `others` | Use this if the registered Obsidian vault name differs from the folder name. |
| `obsidianBridge.companionServerUrl` | Companion only | `http://127.0.0.1:27124` | Local companion listener address. |
| `obsidianBridge.companionToken` | Companion only | Generated token | Shared local authentication token. |
| `obsidianBridge.currentFileMode` | No | `ask` | `ask`, `copy`, or `link` for the current Markdown file. |

### 3. Configure a Canvas directly from VS Code

You do not need to edit `settings.json` manually. Run **Obsidian Bridge: Choose Obsidian Canvas** from the Command Palette. A local file picker opens at the configured vault. Select a valid `.canvas` file; the extension verifies that it is inside the vault and saves its vault-relative path to `obsidianBridge.canvasPath`.

If `canvasPath` is empty or stale, running **Send Selection to Canvas** also opens the picker automatically. This is the recommended setup when the companion plugin is not installed.

### 4. Install the optional Obsidian companion

The companion is recommended when the command must target the **currently open Canvas** or the **currently active note**. Copy the folder `obsidian-bridge-companion` into:

```text
C:\O\others\.obsidian\plugins\obsidian-bridge-companion\
```

The folder must contain exactly:

```text
manifest.json
main.js
```

In Obsidian, open **Settings → Community plugins**, disable Restricted mode if necessary, and enable **Obsidian Bridge Companion**. Copy the token from the plugin settings into VS Code setting `obsidianBridge.companionToken`. If you change the port, update `obsidianBridge.companionServerUrl` and use **Restart local server** in the companion settings.

> The companion is optional. Creating a note, appending to a selected existing note, and writing to a configured Canvas can work through local files without it.

## Commands and shortcuts

The extension registers command handlers and contributes them to the VS Code manifest, making them available through the Command Palette, editor context menus, and keyboard shortcuts. [3]

| Command | Windows shortcut | Behavior |
|---|---|---|
| **Send Selection to Obsidian Note** | `Ctrl+Alt+O` | Creates a new Markdown note in `defaultFolder`. The suggested name comes from the first selected line or the timestamp, and the note is opened in Obsidian. |
| **Append Selection to Current Obsidian Note** | `Ctrl+Alt+A` | With the companion, appends to the active Markdown note. Without it, prompts for an existing vault-relative Markdown path. |
| **Send Selection to Canvas** | `Ctrl+Alt+C` | First attempts the active Canvas through the companion; otherwise writes to the configured Canvas. If the path is missing or invalid, it opens the Canvas picker. New nodes are placed to the right of the existing content with an 80-pixel gap. |
| **Choose Obsidian Canvas** | Command Palette | Opens the local Canvas picker and saves `obsidianBridge.canvasPath` as a vault-relative path. |
| **Send Current Markdown File to Obsidian** | `Ctrl+Alt+M` | Copies or hard-links the saved Markdown file. If it is already inside the vault, it only opens it in Obsidian. |

The three selection commands appear in the editor context menu, and the current-file command appears in the editor title area for Markdown files.

## Canvas behavior

Each new node is a JSON Canvas `text` node with a unique `id`, `x`, `y`, `width`, `height`, and `text`. Existing nodes and edges are preserved. Existing file nodes are preserved with their vault-relative `file` paths, as required by the JSON Canvas specification. [1]

```json
{
  "nodes": [
    {
      "id": "a1b2c3d4e5f6a7b8",
      "type": "text",
      "text": "Text selected in VS Code",
      "x": 980,
      "y": 80,
      "width": 420,
      "height": 140
    }
  ],
  "edges": []
}
```

## Troubleshooting

If you see `Set obsidianBridge.canvasPath...`, the old extension version is still installed. Install the current VSIX and run **Developer: Reload Window**. Then run **Obsidian Bridge: Choose Obsidian Canvas**, or select text and run **Send Selection to Canvas** to open the picker automatically.

If you see `The configured Canvas is not valid JSON`, the selected file may be a regular text file, a corrupted Canvas, or a file with a `.canvas` extension that does not contain JSON Canvas data. Select a real Canvas file that opens correctly in Obsidian. The current version handles a UTF-8 BOM and an empty Canvas file, and offers **Choose Another Canvas** for invalid JSON.

If a note is created but does not open, start Obsidian Desktop and verify that the target vault is registered. If the visible Obsidian vault name differs from the folder name, set `obsidianBridge.vaultName` to the visible name.

The `link` mode uses a filesystem hard link and works only when the source and destination are on the same volume. If hard-link creation fails, the extension offers to copy the file instead. Use `copy` when an independent vault copy is preferred.

For a Canvas that is open and being edited in Obsidian, the companion plugin is recommended because it applies the update through Obsidian's vault API. Keep a backup of important `.canvas` files before modifying them from multiple applications.

## Build from source

Install Node.js LTS, then run the following in `vscode-extension`:

```powershell
npm install
npm run compile
npm run package
```

This creates `dist/obsidian-bridge-0.1.3.vsix`. To build the companion, run the following in `obsidian-plugin`:

```powershell
npm install
npm run build
```

Copy the generated `main.js` together with `manifest.json` into the plugin directory inside the vault.

## Tests

The project has been compiled successfully. The Canvas logic tests cover appending a text node, preserving edges and existing file nodes, avoiding overlap, JSON round-tripping, BOM handling, empty Canvas files, and rejection of malformed JSON.

## References

[1]: https://jsoncanvas.org/spec/1.0/ "JSON Canvas Specification 1.0"
[2]: https://obsidian.md/help/uri "Obsidian URI — Obsidian Help"
[3]: https://code.visualstudio.com/api/extension-guides/command "Commands — Visual Studio Code Extension API"
[4]: https://code.visualstudio.com/api/references/contribution-points "Contribution Points — Visual Studio Code Extension API"
