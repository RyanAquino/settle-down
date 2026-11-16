import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_BYTES,
  flattenHierarchy,
  paginateItems,
  paginateText,
  selectPage,
} from '../paging.mjs';

test('text pages split at line boundaries, track line numbers, and reassemble exactly', () => {
  const text = Array.from({ length: 2000 }, (_, i) => `line ${i + 1} ✓`).join('\n');
  const pages = paginateText(text, 1000);
  assert.ok(pages.length > 1);
  assert.equal(pages.map((p) => p.text).join(''), text);
  assert.equal(pages[0].startLine, 1);
  assert.equal(pages.at(-1).endLine, 2000);
  for (const [i, page] of pages.entries()) {
    assert.ok(Buffer.byteLength(page.text) <= 1000);
    if (i) assert.equal(page.startLine, pages[i - 1].endLine + 1);
    assert.match(page.text, new RegExp(`^line ${page.startLine} `));
  }
});

test('a line longer than a page is split without breaking multibyte characters', () => {
  const line = 'ア'.repeat(5000);
  const pages = paginateText(`short\n${line}\nend`, 1000);
  assert.equal(pages.map((p) => p.text).join(''), `short\n${line}\nend`);
  for (const page of pages) assert.ok(Buffer.byteLength(page.text) <= 1000);
  assert.ok(pages.filter((p) => p.startLine === 2 && p.endLine === 2).length > 1);
});

test('empty text is one empty page', () => {
  assert.deepEqual(paginateText(''), [{ startLine: 1, endLine: 1, text: '' }]);
});

test('items are grouped within the page budget and invalid pages are rejected', () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'x'.repeat(50) }));
  const pages = paginateItems(items);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.flat(), items);
  for (const page of pages) assert.ok(Buffer.byteLength(JSON.stringify(page)) <= PAGE_BYTES);
  assert.deepEqual(paginateItems([]), [[]]);
  assert.throws(() => selectPage(pages, 0));
  assert.throws(() => selectPage(pages, pages.length + 1));
  assert.equal(selectPage(pages, 1), pages[0]);
});

test('hierarchy flattening keeps targetable nodes and drops layout wrappers', () => {
  const tree = [
    {
      b: '[0,0][402,874]',
      c: [
        {
          b: '[0,0][402,874]',
          c: [
            { b: '[10,10][50,50]', rid: 'zoom-in', a11y: 'Zoom in' },
            { b: '[60,10][90,50]', a11y: 'Zoom out', enabled: false },
            { b: '[0,0][1,1]' },
          ],
        },
      ],
    },
  ];
  assert.deepEqual(flattenHierarchy(tree), [
    { b: '[10,10][50,50]', rid: 'zoom-in', a11y: 'Zoom in' },
    { b: '[60,10][90,50]', a11y: 'Zoom out', enabled: false },
  ]);
});
