import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { appendTextNode, serializeCanvas } from './canvas';

type TransferMode = 'copy' | 'link';

interface BridgeConfig {
  vaultPath: string;
  canvasPath: string;
  defaultFolder: string;
  vaultName: string;
  companionServerUrl: string;
  companionToken: string;
  currentFileMode: 'ask' | TransferMode;
}

interface CompanionActiveFile {
  path?: string;
}

interface CompanionResponse {
  ok: boolean;
  path?: string;
  message?: string;
}

const OUTPUT_CHANNEL_NAME = 'Obsidian Bridge';
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('obsidianBridge.sendSelectionToNote', sendSelectionToNote),
    vscode.commands.registerCommand('obsidianBridge.appendSelectionToCurrentNote', appendSelectionToCurrentNote),
    vscode.commands.registerCommand('obsidianBridge.sendSelectionToCanvas', sendSelectionToCanvas),
    vscode.commands.registerCommand('obsidianBridge.sendCurrentMarkdownFile', sendCurrentMarkdownFile),
    vscode.commands.registerCommand('obsidianBridge.configureVault', configureVault),
    vscode.commands.registerCommand('obsidianBridge.configureCanvas', configureCanvas),
  );
}

export function deactivate(): void {
  output?.dispose();
}

function getConfig(): BridgeConfig {
  const config = vscode.workspace.getConfiguration('obsidianBridge');
  return {
    vaultPath: config.get<string>('vaultPath', '').trim(),
    canvasPath: config.get<string>('canvasPath', '').trim(),
    defaultFolder: config.get<string>('defaultFolder', 'Inbox').trim(),
    vaultName: config.get<string>('vaultName', '').trim(),
    companionServerUrl: config.get<string>('companionServerUrl', 'http://127.0.0.1:27124').trim().replace(/\/$/, ''),
    companionToken: config.get<string>('companionToken', '').trim(),
    currentFileMode: config.get<'ask' | TransferMode>('currentFileMode', 'ask'),
  };
}

async function requireVault(): Promise<BridgeConfig | undefined> {
  const config = getConfig();
  if (!config.vaultPath) {
    const configure = await vscode.window.showErrorMessage(
      'Obsidian Bridge: Set obsidianBridge.vaultPath before sending files.',
      'Configure Vault Path',
    );
    if (configure === 'Configure Vault Path') {
      await configureVault();
    }
    return undefined;
  }

  try {
    const stat = await fs.stat(config.vaultPath);
    if (!stat.isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    void vscode.window.showErrorMessage(`Obsidian Bridge: Vault path does not exist: ${config.vaultPath}`);
    return undefined;
  }

  return config;
}

function selectionOrThrow(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage('Obsidian Bridge: Select text in an editor first.');
    return undefined;
  }
  return editor.document.getText(editor.selection).trim();
}

function cleanFileStem(value: string): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').trim())
    .find(Boolean) ?? '';
  const cleaned = firstLine
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 72);
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function uniquePath(directory: string, stem: string, extension: string): Promise<string> {
  const safeStem = stem || `VS Code ${timestamp()}`;
  let candidate = path.join(directory, `${safeStem}${extension}`);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${safeStem} ${suffix}${extension}`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

async function ensureFolder(vaultPath: string, relativeFolder: string): Promise<string> {
  const folder = path.resolve(vaultPath, relativeFolder || '.');
  const relative = path.relative(vaultPath, folder);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('defaultFolder must stay inside the configured vault.');
  }
  await fs.mkdir(folder, { recursive: true });
  return folder;
}

function vaultRelative(vaultPath: string, absolutePath: string): string {
  const relative = path.relative(vaultPath, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The target file is outside the configured vault.');
  }
  return relative.split(path.sep).join('/');
}

async function openInObsidian(vaultPath: string, absolutePath: string, configuredVaultName: string): Promise<void> {
  const file = vaultRelative(vaultPath, absolutePath);
  const vault = configuredVaultName || path.basename(path.resolve(vaultPath));
  const uri = vscode.Uri.parse(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`);
  const opened = await vscode.env.openExternal(uri);
  if (!opened) {
    void vscode.window.showWarningMessage('Obsidian Bridge: File was written, but Obsidian did not accept the open request. Verify that Obsidian Desktop is installed and the vault name is correct.');
  }
}

async function sendSelectionToNote(): Promise<void> {
  const text = selectionOrThrow();
  if (!text) {
    return;
  }
  const config = await requireVault();
  if (!config) {
    return;
  }

  try {
    const folder = await ensureFolder(config.vaultPath, config.defaultFolder);
    const suggested = cleanFileStem(text) || `VS Code ${timestamp()}`;
    const entered = await vscode.window.showInputBox({
      title: 'New Obsidian note',
      prompt: 'Enter the Markdown file name (without .md).',
      value: suggested,
      validateInput: (value) => value.trim() ? undefined : 'A file name is required.',
    });
    if (entered === undefined) {
      return;
    }
    const notePath = await uniquePath(folder, cleanFileStem(entered) || `VS Code ${timestamp()}`, '.md');
    await fs.writeFile(notePath, `${text}\n`, 'utf8');
    await openInObsidian(config.vaultPath, notePath, config.vaultName);
    void vscode.window.showInformationMessage(`Obsidian Bridge: Created ${vaultRelative(config.vaultPath, notePath)}.`);
  } catch (error) {
    reportError('Could not create the Obsidian note', error);
  }
}

async function appendSelectionToCurrentNote(): Promise<void> {
  const text = selectionOrThrow();
  if (!text) {
    return;
  }
  const config = await requireVault();
  if (!config) {
    return;
  }

  try {
    const companionNote = await getCompanionPath(config, '/active-note');
    const target = companionNote ?? await chooseVaultMarkdownFile(config, 'Append selection to Obsidian note');
    if (!target) {
      return;
    }
    await fs.appendFile(target, `\n\n${text}\n`, 'utf8');
    await openInObsidian(config.vaultPath, target, config.vaultName);
    void vscode.window.showInformationMessage(`Obsidian Bridge: Appended to ${vaultRelative(config.vaultPath, target)}.`);
  } catch (error) {
    reportError('Could not append to the Obsidian note', error);
  }
}

async function chooseVaultMarkdownFile(config: BridgeConfig, title: string): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    prompt: 'Enter a Markdown path relative to the configured vault.',
    placeHolder: 'Projects/Meeting notes.md',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'A note path is required.';
      }
      return value.toLowerCase().endsWith('.md') ? undefined : 'The target must be a .md file.';
    },
  });
  if (input === undefined) {
    return undefined;
  }
  const absolute = path.resolve(config.vaultPath, input);
  vaultRelative(config.vaultPath, absolute);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      throw new Error('not a file');
    }
  } catch {
    throw new Error(`Note does not exist: ${input}`);
  }
  return absolute;
}

async function sendSelectionToCanvas(): Promise<void> {
  const text = selectionOrThrow();
  if (!text) {
    return;
  }
  const config = await requireVault();
  if (!config) {
    return;
  }

  try {
    const companionResult = await postToCompanion(config, '/append-text-node', { text });
    if (companionResult?.ok && companionResult.path) {
      const target = resolveVaultPath(config.vaultPath, companionResult.path);
      await openInObsidian(config.vaultPath, target, config.vaultName);
      void vscode.window.showInformationMessage(`Obsidian Bridge: Added a text node to ${companionResult.path}.`);
      return;
    }

    const companionCanvas = await getCompanionPath(config, '/active-canvas');
    const canvasPath = companionCanvas ?? await ensureCanvasConfigured(config);
    if (!canvasPath) {
      return;
    }

    try {
      const raw = await fs.readFile(canvasPath, 'utf8');
      const { canvas, node } = appendTextNode(raw, text);
      await fs.writeFile(canvasPath, serializeCanvas(canvas), 'utf8');
      await openInObsidian(config.vaultPath, canvasPath, config.vaultName);
      void vscode.window.showInformationMessage(`Obsidian Bridge: Added text node ${node.id} to ${vaultRelative(config.vaultPath, canvasPath)}.`);
    } catch (error) {
      if (isInvalidCanvasError(error)) {
        const action = await vscode.window.showErrorMessage(
          `Obsidian Bridge: ${errorMessage(error)} Select a valid .canvas file from the configured Vault.`,
          'Choose Another Canvas',
        );
        if (action === 'Choose Another Canvas') {
          await chooseCanvasFile(config);
          return;
        }
      }
      throw error;
    }
  } catch (error) {
    reportError('Could not add the selection to Canvas', error);
  }
}

function isInvalidCanvasError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('not valid json') || message.includes('must contain a json object') || message.includes('must be a json object');
}

function resolveConfiguredCanvas(config: BridgeConfig): string | undefined {
  if (!config.canvasPath) {
    return undefined;
  }
  const absolute = path.isAbsolute(config.canvasPath)
    ? path.resolve(config.canvasPath)
    : path.resolve(config.vaultPath, config.canvasPath);
  vaultRelative(config.vaultPath, absolute);
  return absolute;
}

async function ensureCanvasConfigured(config: BridgeConfig): Promise<string | undefined> {
  const configured = resolveConfiguredCanvas(config);
  if (configured) {
    try {
      const stat = await fs.stat(configured);
      if (stat.isFile() && path.extname(configured).toLowerCase() === '.canvas') {
        return configured;
      }
    } catch {
      // The configured path is stale; offer the picker below.
    }
    const choose = await vscode.window.showWarningMessage(
      `Obsidian Bridge: Canvas path is missing or invalid: ${config.canvasPath}`,
      'Choose Canvas',
    );
    if (choose !== 'Choose Canvas') {
      return undefined;
    }
  }
  return chooseCanvasFile(config);
}

async function chooseCanvasFile(config: BridgeConfig): Promise<string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title: 'Choose Obsidian Canvas',
    defaultUri: vscode.Uri.file(config.vaultPath),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Obsidian Canvas': ['canvas'] },
    openLabel: 'Use Canvas',
  });
  const chosen = selected?.[0]?.fsPath;
  if (!chosen) {
    return undefined;
  }
  try {
    const absolute = path.resolve(chosen);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || path.extname(absolute).toLowerCase() !== '.canvas') {
      throw new Error('Please choose a .canvas file.');
    }
    const relative = vaultRelative(config.vaultPath, absolute);
    await vscode.workspace.getConfiguration('obsidianBridge').update(
      'canvasPath',
      relative,
      vscode.ConfigurationTarget.Global,
    );
    void vscode.window.showInformationMessage(`Obsidian Bridge: Canvas saved as obsidianBridge.canvasPath = ${relative}`);
    return absolute;
  } catch (error) {
    reportError('Could not configure the Canvas', error);
    return undefined;
  }
}

async function configureCanvas(): Promise<void> {
  const config = await requireVault();
  if (!config) {
    return;
  }
  await chooseCanvasFile(config);
}

async function sendCurrentMarkdownFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file' || path.extname(editor.document.uri.fsPath).toLowerCase() !== '.md') {
    void vscode.window.showWarningMessage('Obsidian Bridge: Open a saved Markdown file first.');
    return;
  }
  const config = await requireVault();
  if (!config) {
    return;
  }

  try {
    if (editor.document.isDirty) {
      const saved = await editor.document.save();
      if (!saved) {
        throw new Error('The current Markdown file could not be saved.');
      }
    }

    const source = path.resolve(editor.document.uri.fsPath);
    const sourceRelative = path.relative(config.vaultPath, source);
    if (!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative)) {
      await openInObsidian(config.vaultPath, source, config.vaultName);
      void vscode.window.showInformationMessage('Obsidian Bridge: Current file is already in the configured vault.');
      return;
    }

    const mode = await chooseTransferMode(config.currentFileMode);
    if (!mode) {
      return;
    }
    const folder = await ensureFolder(config.vaultPath, config.defaultFolder);
    const target = await uniquePath(folder, cleanFileStem(path.basename(source, '.md')) || `VS Code ${timestamp()}`, '.md');

    if (mode === 'link') {
      try {
        await fs.link(source, target);
      } catch (error) {
        const choice = await vscode.window.showWarningMessage(
          `Obsidian Bridge: Could not create a hard link (${errorMessage(error)}). Copy the file instead?`,
          'Copy Instead',
        );
        if (choice !== 'Copy Instead') {
          return;
        }
        await fs.copyFile(source, target);
      }
    } else {
      await fs.copyFile(source, target);
    }

    await openInObsidian(config.vaultPath, target, config.vaultName);
    void vscode.window.showInformationMessage(`Obsidian Bridge: ${mode === 'link' ? 'Linked' : 'Copied'} ${vaultRelative(config.vaultPath, target)}.`);
  } catch (error) {
    reportError('Could not send the current Markdown file', error);
  }
}

async function chooseTransferMode(configuredMode: 'ask' | TransferMode): Promise<TransferMode | undefined> {
  if (configuredMode !== 'ask') {
    return configuredMode;
  }
  const picked = await vscode.window.showQuickPick([
    { label: 'Copy', description: 'Create an independent copy in the vault.', mode: 'copy' as const },
    { label: 'Hard link', description: 'Share file contents when both locations are on the same Windows drive.', mode: 'link' as const },
  ], {
    title: 'Send Current Markdown File to Obsidian',
    placeHolder: 'Choose how to transfer the file',
  });
  return picked?.mode;
}

function resolveVaultPath(vaultPath: string, suppliedPath: string): string {
  const absolute = path.isAbsolute(suppliedPath) ? path.resolve(suppliedPath) : path.resolve(vaultPath, suppliedPath);
  vaultRelative(vaultPath, absolute);
  return absolute;
}

async function getCompanionPath(config: BridgeConfig, endpoint: string): Promise<string | undefined> {
  if (!config.companionToken) {
    return undefined;
  }
  try {
    const response = await fetch(`${config.companionServerUrl}${endpoint}`, {
      headers: { 'x-obsidian-bridge-token': config.companionToken },
      signal: AbortSignal.timeout(700),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = await response.json() as CompanionActiveFile;
    return body.path ? resolveVaultPath(config.vaultPath, body.path) : undefined;
  } catch {
    return undefined;
  }
}

async function postToCompanion(config: BridgeConfig, endpoint: string, body: Record<string, string>): Promise<CompanionResponse | undefined> {
  if (!config.companionToken) {
    return undefined;
  }
  try {
    const response = await fetch(`${config.companionServerUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-obsidian-bridge-token': config.companionToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) {
      return undefined;
    }
    return await response.json() as CompanionResponse;
  } catch {
    return undefined;
  }
}

async function configureVault(): Promise<void> {
  const current = getConfig().vaultPath;
  const entered = await vscode.window.showInputBox({
    title: 'Configure Obsidian Bridge',
    prompt: 'Enter the absolute path to your Obsidian vault.',
    value: current,
    placeHolder: 'C:\\O\\others',
    validateInput: (value) => path.isAbsolute(value.trim()) ? undefined : 'Enter an absolute path, for example C:\\O\\others.',
  });
  if (entered === undefined) {
    return;
  }
  await vscode.workspace.getConfiguration('obsidianBridge').update('vaultPath', entered.trim(), vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage('Obsidian Bridge: Vault path saved in your user settings.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportError(prefix: string, error: unknown): void {
  const message = `${prefix}: ${errorMessage(error)}`;
  output.appendLine(message);
  output.show(true);
  void vscode.window.showErrorMessage(`Obsidian Bridge: ${message}`);
}
