"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCanvas = parseCanvas;
exports.createTextNode = createTextNode;
exports.appendTextNode = appendTextNode;
exports.serializeCanvas = serializeCanvas;
const node_crypto_1 = require("node:crypto");
const NODE_WIDTH = 420;
const NODE_GAP = 80;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 600;
const LINE_HEIGHT = 24;
function parseCanvas(raw) {
    const normalized = raw.replace(/^\uFEFF/, '').trim();
    if (!normalized) {
        return { nodes: [], edges: [] };
    }
    let parsed;
    try {
        parsed = JSON.parse(normalized);
    }
    catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new Error(`The configured Canvas is not valid JSON.${detail}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('The configured Canvas must contain a JSON object.');
    }
    const canvas = parsed;
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
    };
}
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function nextPosition(nodes, width, height) {
    if (nodes.length === 0) {
        return { x: 0, y: 0 };
    }
    let maxRight = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
        const x = numberOr(node.x, 0);
        const y = numberOr(node.y, 0);
        const nodeWidth = numberOr(node.width, NODE_WIDTH);
        maxRight = Math.max(maxRight, x + nodeWidth);
        top = Math.min(top, y);
    }
    return {
        x: Math.round(maxRight + NODE_GAP),
        y: Math.round(Number.isFinite(top) ? top : 0),
    };
}
function estimateHeight(text) {
    const visualLines = text.split(/\r?\n/).reduce((total, line) => {
        return total + Math.max(1, Math.ceil(line.length / 55));
    }, 0);
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, 72 + visualLines * LINE_HEIGHT));
}
function createTextNode(text, existingNodes) {
    const width = NODE_WIDTH;
    const height = estimateHeight(text);
    const position = nextPosition(existingNodes, width, height);
    return {
        id: (0, node_crypto_1.randomUUID)().replace(/-/g, '').slice(0, 16),
        type: 'text',
        text,
        x: position.x,
        y: position.y,
        width,
        height,
    };
}
function appendTextNode(raw, text) {
    const canvas = parseCanvas(raw);
    const node = createTextNode(text, canvas.nodes);
    canvas.nodes.push(node);
    return { canvas, node };
}
function serializeCanvas(canvas) {
    return `${JSON.stringify(canvas, null, 2)}\n`;
}
//# sourceMappingURL=canvas.js.map