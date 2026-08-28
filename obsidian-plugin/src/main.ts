import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import * as http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

interface BridgeSettings {
  port: number;
  token: string;
}

interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  [key: string]: unknown;
}

interface JsonCanvas {
  nodes: CanvasNode[];
  edges: unknown[];
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: BridgeSettings = {
  port: 27124,
  token: '',
};

export default class ObsidianBridgeCompanion extends Plugin {
  settings: BridgeSettings = DEFAULT_SETTINGS;
  private server: http.Server | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (!this.settings.token) {
      this.settings.token = createToken();
      await this.saveSettings();
    }

    this.addSettingTab(new ObsidianBridgeSettingTab(this.app, this));
    this.addCommand({
      id: 'show-connection-details',
      name: 'Show connection details',
      callback: () => this.showConnectionDetails(),
    });
    this.addCommand({
      id: 'restart-local-server',
      name: 'Restart local server',
      callback: async () => {
        await this.restartServer();
        new Notice('Obsidian Bridge Companion local server restarted.');
      },
    });

    await this.startServer();
  }

  onunload(): void {
    this.stopServer();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async restartServer(): Promise<void> {
    this.stopServer();
    await this.startServer();
  }

  showConnectionDetails(): void {
    const message = `Obsidian Bridge Companion is listening on http://127.0.0.1:${this.settings.port}. Copy token from its Settings tab into VS Code setting obsidianBridge.companionToken.`;
    new Notice(message, 8000);
  }

  private async startServer(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve();
      };
      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(this.settings.port, '127.0.0.1');
    }).catch((error: unknown) => {
      new Notice(`Obsidian Bridge Companion could not start: ${errorMessage(error)}`, 10000);
      console.error('Obsidian Bridge Companion server error', error);
    });
  }

  private stopServer(): void {
    if (!this.server) {
      return;
    }
    this.server.close();
    this.server = null;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    try {
      if (!this.isAuthorized(request)) {
        this.respond(response, 401, { ok: false, message: 'Unauthorized' });
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        this.respond(response, 200, { ok: true, activeCanvas: this.activeCanvasPath(), activeNote: this.activeNotePath() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/active-canvas') {
        this.respond(response, 200, { ok: true, path: this.activeCanvasPath() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/active-note') {
        this.respond(response, 200, { ok: true, path: this.activeNotePath() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/append-text-node') {
        const body = await readJsonBody(request);
        if (typeof body.text !== 'string' || !body.text.trim()) {
          this.respond(response, 400, { ok: false, message: 'A non-empty text property is required.' });
          return;
        }
        const canvas = this.activeCanvasFile();
        if (!canvas) {
          this.respond(response, 409, { ok: false, message: 'No Canvas is active in Obsidian.' });
          return;
        }
        const node = await this.appendTextNode(canvas, body.text.trim());
        this.respond(response, 200, { ok: true, path: canvas.path, nodeId: node.id });
        return;
      }

      this.respond(response, 404, { ok: false, message: 'Not found' });
    } catch (error) {
      console.error('Obsidian Bridge Companion request error', error);
      this.respond(response, 500, { ok: false, message: errorMessage(error) });
    }
  }

  private isAuthorized(request: http.IncomingMessage): boolean {
    const value = request.headers['x-obsidian-bridge-token'];
    const token = Array.isArray(value) ? value[0] : value;
    return Boolean(token) && token === this.settings.token;
  }

  private respond(response: http.ServerResponse, status: number, body: Record<string, unknown>): void {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }

  private activeCanvasFile(): TFile | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view.getViewType() === 'canvas' && leaf.view.file instanceof TFile) {
      return leaf.view.file;
    }
    const canvasLeaf = this.app.workspace.getLeavesOfType('canvas').find((item) => item.view.file instanceof TFile);
    return canvasLeaf?.view.file instanceof TFile ? canvasLeaf.view.file : null;
  }

  private activeCanvasPath(): string | null {
    return this.activeCanvasFile()?.path ?? null;
  }

  private activeNotePath(): string | null {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view.getViewType() === 'markdown' && leaf.view.file instanceof TFile) {
      return leaf.view.file.path;
    }
    const markdownLeaf = this.app.workspace.getLeavesOfType('markdown').find((item: WorkspaceLeaf) => item.view.file instanceof TFile);
    return markdownLeaf?.view.file instanceof TFile ? markdownLeaf.view.file.path : null;
  }

  private async appendTextNode(file: TFile, text: string): Promise<CanvasNode> {
    const raw = await this.app.vault.read(file);
    const canvas = parseCanvas(raw);
    const node = makeTextNode(text, canvas.nodes);
    canvas.nodes.push(node);
    await this.app.vault.modify(file, `${JSON.stringify(canvas, null, 2)}\n`);
    return node;
  }
}

class ObsidianBridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianBridgeCompanion) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian Bridge Companion' });
    containerEl.createEl('p', {
      text: 'This plugin accepts authenticated requests only from 127.0.0.1. Copy the token below to the matching VS Code setting.',
    });

    new Setting(containerEl)
      .setName('Local port')
      .setDesc('The listener binds only to 127.0.0.1. Restart the local server after changing this value.')
      .addText((text) => text
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const port = Number.parseInt(value, 10);
          if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
            this.plugin.settings.port = port;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Shared token')
      .setDesc('Set this exact token in VS Code setting obsidianBridge.companionToken. Keep it private.')
      .addText((text) => text
        .setValue(this.plugin.settings.token)
        .onChange(async (value) => {
          const token = value.trim();
          if (token.length >= 16) {
            this.plugin.settings.token = token;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Generate new token')
      .setDesc('Generating a token invalidates the existing VS Code connection until its setting is updated.')
      .addButton((button) => button.setButtonText('Generate').onClick(async () => {
        this.plugin.settings.token = createToken();
        await this.plugin.saveSettings();
        this.display();
        new Notice('A new Obsidian Bridge token was generated. Update VS Code settings.');
      }));

    new Setting(containerEl)
      .setName('Restart local server')
      .setDesc(`Current address: http://127.0.0.1:${this.plugin.settings.port}`)
      .addButton((button) => button.setButtonText('Restart').onClick(async () => {
        await this.plugin.restartServer();
        new Notice('Obsidian Bridge Companion local server restarted.');
      }));
  }
}

function parseCanvas(raw: string): JsonCanvas {
  const normalized = raw.replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return { nodes: [], edges: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`The active Canvas is not valid JSON.${detail}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The active Canvas must be a JSON object.');
  }
  const canvas = parsed as Partial<JsonCanvas>;
  if (canvas.nodes !== undefined && !Array.isArray(canvas.nodes)) {
    throw new Error('Canvas field "nodes" must be an array.');
  }
  if (canvas.edges !== undefined && !Array.isArray(canvas.edges)) {
    throw new Error('Canvas field "edges" must be an array.');
  }
  return {
    ...canvas,
    nodes: Array.isArray(canvas.nodes) ? canvas.nodes : [],
    edges: Array.isArray(canvas.edges) ? canvas.edges : [],
  } as JsonCanvas;
}

function makeTextNode(text: string, nodes: CanvasNode[]): CanvasNode {
  const width = 420;
  const height = estimateHeight(text);
  const position = nextPosition(nodes);
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    type: 'text',
    text,
    x: position.x,
    y: position.y,
    width,
    height,
  };
}

function nextPosition(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  let maxRight = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const x = finiteNumber(node.x, 0);
    const y = finiteNumber(node.y, 0);
    const width = finiteNumber(node.width, 420);
    maxRight = Math.max(maxRight, x + width);
    top = Math.min(top, y);
  }
  return {
    x: Math.round(maxRight + 80),
    y: Math.round(Number.isFinite(top) ? top : 0),
  };
}

function estimateHeight(text: string): number {
  const visualLines = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 55)), 0);
  return Math.max(140, Math.min(600, 72 + visualLines * 24));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createToken(): string {
  return randomBytes(24).toString('base64url');
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error('Request payload is too large.');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
