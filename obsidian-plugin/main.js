var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianBridgeCompanion
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var http = __toESM(require("node:http"));
var import_node_crypto = require("node:crypto");
var DEFAULT_SETTINGS = {
  port: 27124,
  token: ""
};
var ObsidianBridgeCompanion = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "settings", DEFAULT_SETTINGS);
    __publicField(this, "server", null);
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.token) {
      this.settings.token = createToken();
      await this.saveSettings();
    }
    this.addSettingTab(new ObsidianBridgeSettingTab(this.app, this));
    this.addCommand({
      id: "show-connection-details",
      name: "Show connection details",
      callback: () => this.showConnectionDetails()
    });
    this.addCommand({
      id: "restart-local-server",
      name: "Restart local server",
      callback: async () => {
        await this.restartServer();
        new import_obsidian.Notice("Obsidian Bridge Companion local server restarted.");
      }
    });
    await this.startServer();
  }
  onunload() {
    this.stopServer();
  }
  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async restartServer() {
    this.stopServer();
    await this.startServer();
  }
  showConnectionDetails() {
    const message = `Obsidian Bridge Companion is listening on http://127.0.0.1:${this.settings.port}. Copy token from its Settings tab into VS Code setting obsidianBridge.companionToken.`;
    new import_obsidian.Notice(message, 8e3);
  }
  async startServer() {
    if (this.server) {
      return;
    }
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off("listening", onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server?.once("error", onError);
      this.server?.once("listening", onListening);
      this.server?.listen(this.settings.port, "127.0.0.1");
    }).catch((error) => {
      new import_obsidian.Notice(`Obsidian Bridge Companion could not start: ${errorMessage(error)}`, 1e4);
      console.error("Obsidian Bridge Companion server error", error);
    });
  }
  stopServer() {
    if (!this.server) {
      return;
    }
    this.server.close();
    this.server = null;
  }
  async handleRequest(request, response) {
    try {
      if (!this.isAuthorized(request)) {
        this.respond(response, 401, { ok: false, message: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        this.respond(response, 200, { ok: true, activeCanvas: this.activeCanvasPath(), activeNote: this.activeNotePath() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/active-canvas") {
        this.respond(response, 200, { ok: true, path: this.activeCanvasPath() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/active-note") {
        this.respond(response, 200, { ok: true, path: this.activeNotePath() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/append-text-node") {
        const body = await readJsonBody(request);
        if (typeof body.text !== "string" || !body.text.trim()) {
          this.respond(response, 400, { ok: false, message: "A non-empty text property is required." });
          return;
        }
        const canvas = this.activeCanvasFile();
        if (!canvas) {
          this.respond(response, 409, { ok: false, message: "No Canvas is active in Obsidian." });
          return;
        }
        const node = await this.appendTextNode(canvas, body.text.trim());
        this.respond(response, 200, { ok: true, path: canvas.path, nodeId: node.id });
        return;
      }
      this.respond(response, 404, { ok: false, message: "Not found" });
    } catch (error) {
      console.error("Obsidian Bridge Companion request error", error);
      this.respond(response, 500, { ok: false, message: errorMessage(error) });
    }
  }
  isAuthorized(request) {
    const value = request.headers["x-obsidian-bridge-token"];
    const token = Array.isArray(value) ? value[0] : value;
    return Boolean(token) && token === this.settings.token;
  }
  respond(response, status, body) {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(body));
  }
  activeCanvasFile() {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view.getViewType() === "canvas" && leaf.view.file instanceof import_obsidian.TFile) {
      return leaf.view.file;
    }
    const canvasLeaf = this.app.workspace.getLeavesOfType("canvas").find((item) => item.view.file instanceof import_obsidian.TFile);
    return canvasLeaf?.view.file instanceof import_obsidian.TFile ? canvasLeaf.view.file : null;
  }
  activeCanvasPath() {
    return this.activeCanvasFile()?.path ?? null;
  }
  activeNotePath() {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view.getViewType() === "markdown" && leaf.view.file instanceof import_obsidian.TFile) {
      return leaf.view.file.path;
    }
    const markdownLeaf = this.app.workspace.getLeavesOfType("markdown").find((item) => item.view.file instanceof import_obsidian.TFile);
    return markdownLeaf?.view.file instanceof import_obsidian.TFile ? markdownLeaf.view.file.path : null;
  }
  async appendTextNode(file, text) {
    const raw = await this.app.vault.read(file);
    const canvas = parseCanvas(raw);
    const node = makeTextNode(text, canvas.nodes);
    canvas.nodes.push(node);
    await this.app.vault.modify(file, `${JSON.stringify(canvas, null, 2)}
`);
    return node;
  }
};
var ObsidianBridgeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Bridge Companion" });
    containerEl.createEl("p", {
      text: "This plugin accepts authenticated requests only from 127.0.0.1. Copy the token below to the matching VS Code setting."
    });
    new import_obsidian.Setting(containerEl).setName("Local port").setDesc("The listener binds only to 127.0.0.1. Restart the local server after changing this value.").addText((text) => text.setValue(String(this.plugin.settings.port)).onChange(async (value) => {
      const port = Number.parseInt(value, 10);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
        this.plugin.settings.port = port;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Shared token").setDesc("Set this exact token in VS Code setting obsidianBridge.companionToken. Keep it private.").addText((text) => text.setValue(this.plugin.settings.token).onChange(async (value) => {
      const token = value.trim();
      if (token.length >= 16) {
        this.plugin.settings.token = token;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Generate new token").setDesc("Generating a token invalidates the existing VS Code connection until its setting is updated.").addButton((button) => button.setButtonText("Generate").onClick(async () => {
      this.plugin.settings.token = createToken();
      await this.plugin.saveSettings();
      this.display();
      new import_obsidian.Notice("A new Obsidian Bridge token was generated. Update VS Code settings.");
    }));
    new import_obsidian.Setting(containerEl).setName("Restart local server").setDesc(`Current address: http://127.0.0.1:${this.plugin.settings.port}`).addButton((button) => button.setButtonText("Restart").onClick(async () => {
      await this.plugin.restartServer();
      new import_obsidian.Notice("Obsidian Bridge Companion local server restarted.");
    }));
  }
};
function parseCanvas(raw) {
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    return { nodes: [], edges: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`The active Canvas is not valid JSON.${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The active Canvas must be a JSON object.");
  }
  const canvas = parsed;
  if (canvas.nodes !== void 0 && !Array.isArray(canvas.nodes)) {
    throw new Error('Canvas field "nodes" must be an array.');
  }
  if (canvas.edges !== void 0 && !Array.isArray(canvas.edges)) {
    throw new Error('Canvas field "edges" must be an array.');
  }
  return {
    ...canvas,
    nodes: Array.isArray(canvas.nodes) ? canvas.nodes : [],
    edges: Array.isArray(canvas.edges) ? canvas.edges : []
  };
}
function makeTextNode(text, nodes) {
  const width = 420;
  const height = estimateHeight(text);
  const position = nextPosition(nodes);
  return {
    id: (0, import_node_crypto.randomUUID)().replace(/-/g, "").slice(0, 16),
    type: "text",
    text,
    x: position.x,
    y: position.y,
    width,
    height
  };
}
function nextPosition(nodes) {
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
    y: Math.round(Number.isFinite(top) ? top : 0)
  };
}
function estimateHeight(text) {
  const visualLines = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 55)), 0);
  return Math.max(140, Math.min(600, 72 + visualLines * 24));
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function createToken() {
  return (0, import_node_crypto.randomBytes)(24).toString("base64url");
}
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1e6) {
      throw new Error("Request payload is too large.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
