const assert = require('node:assert/strict');
const path = require('node:path');

const canvas = require(path.join(__dirname, '../vscode-extension/out/canvas.js'));

const initial = JSON.stringify({
  nodes: [
    { id: 'old-text', type: 'text', text: 'Existing text', x: -150, y: 220, width: 300, height: 140 },
    { id: 'old-file', type: 'file', file: 'Inbox/existing.md', x: 400, y: 80, width: 500, height: 260 }
  ],
  edges: [{ id: 'edge-1', fromNode: 'old-text', toNode: 'old-file' }]
});

const { canvas: updated, node } = canvas.appendTextNode(initial, 'A new note sent from VS Code.');
assert.equal(updated.nodes.length, 3, 'A text node must be appended.');
assert.equal(updated.edges.length, 1, 'Existing edges must be retained.');
assert.equal(node.type, 'text', 'The new Canvas node must be a text node.');
assert.equal(node.text, 'A new note sent from VS Code.');
assert.equal(node.x, 980, 'The node must appear to the right of the rightmost existing node with a gap.');
assert.equal(node.y, 80, 'The node must align with the topmost existing node.');
assert.ok(node.width > 0 && node.height > 0, 'The node needs positive dimensions.');
assert.equal(canvas.parseCanvas('{}').nodes.length, 0, 'Missing nodes array must default to an empty array.');
assert.equal(canvas.parseCanvas('').edges.length, 0, 'An empty Canvas file must initialize with an empty edges array.');
assert.equal(canvas.parseCanvas('\ufeff{}').nodes.length, 0, 'A UTF-8 BOM must not break Canvas parsing.');
assert.throws(() => canvas.parseCanvas('{not JSON}'), /valid JSON/, 'Invalid JSON must be rejected.');
assert.throws(() => canvas.parseCanvas('{"nodes":{}}'), /nodes/, 'Invalid nodes field must be rejected.');

const serialized = canvas.serializeCanvas(updated);
const roundTrip = JSON.parse(serialized);
assert.equal(roundTrip.nodes.at(-1).id, node.id, 'Serialized Canvas must preserve the new node.');

console.log('Canvas logic tests passed.');
