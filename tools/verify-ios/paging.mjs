// Copilot CLI writes any tool result larger than 20,480 bytes to a temp file and
// shows the model only a 500-character preview. The agent cannot open that file
// (shell and read tools are denied), so it would silently lose the data. Every
// MCP result must therefore stay below the threshold, with room for JSON framing.
export const RESULT_LIMIT_BYTES = 16000;
export const PAGE_BYTES = 12000;

const bytes = (value) => Buffer.byteLength(value, 'utf8');

function splitLongLine(line, size) {
  const parts = [];
  let current = '';
  for (const char of line) {
    if (bytes(current) + bytes(char) > size) {
      parts.push(current);
      current = '';
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

// Splits text into pages of at most `size` UTF-8 bytes at line boundaries.
// A single line longer than a page is split across pages.
export function paginateText(text, size = PAGE_BYTES) {
  const pages = [];
  let current = { startLine: 1, endLine: 1, text: '' };
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [''];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const part of bytes(line) > size ? splitLongLine(line, size) : [line]) {
      if (current.text && bytes(current.text) + bytes(part) > size) {
        pages.push(current);
        current = { startLine: lineNumber, endLine: lineNumber, text: '' };
      }
      if (!current.text) current.startLine = lineNumber;
      current.text += part;
      current.endLine = lineNumber;
    }
  });
  pages.push(current);
  return pages;
}

// Greedily groups items into pages whose serialized size stays within `size`.
export function paginateItems(items, size = PAGE_BYTES) {
  const pages = [[]];
  let used = 2;
  for (const item of items) {
    const cost = bytes(JSON.stringify(item)) + 1;
    if (pages.at(-1).length && used + cost > size) {
      pages.push([]);
      used = 2;
    }
    pages.at(-1).push(item);
    used += cost;
  }
  return pages;
}

export function selectPage(pages, page) {
  if (!Number.isSafeInteger(page) || page < 1 || page > pages.length)
    throw new Error(`Page ${page} does not exist; valid pages are 1-${pages.length}`);
  return pages[page - 1];
}

export function resultBytes(result) {
  return (result.content || []).reduce(
    (total, block) => total + (block.type === 'text' ? bytes(block.text) : 0),
    0,
  );
}

const MEANINGFUL = ['txt', 'a11y', 'rid', 'val', 'hint'];
const STATES = ['enabled', 'focused', 'selected', 'checked'];

// Flattens a Maestro hierarchy to the nodes an agent can target or read: those
// with text, identifiers, values, hints, or non-default state. Layout-only
// wrapper nodes are dropped; bounds are kept so siblings stay distinguishable.
export function flattenHierarchy(elements) {
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const entry = {};
    for (const key of MEANINGFUL) if (node[key]) entry[key] = node[key];
    for (const key of STATES) if (key in node) entry[key] = node[key];
    if (Object.keys(entry).length) nodes.push({ b: node.b, ...entry });
    for (const child of node.c || []) visit(child);
  };
  for (const element of elements || []) visit(element);
  return nodes;
}
