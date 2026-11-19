const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

test('the viewer forces Mozilla’s safe configuration for all document input forms', () => {
  const requests = [];
  const originalViewer = { version: '3.11.174', getDocument: options => requests.push(options) };
  const window = { pdfjsLib: originalViewer };
  const script = fs.readFileSync(path.join(root, 'js/pdfjs-safety.js'), 'utf8');
  vm.runInNewContext(script, { window, URL, ArrayBuffer });

  const url = new URL('https://example.invalid/test.pdf');
  const buffer = new ArrayBuffer(2);
  const typed = new Uint8Array(2);
  const settings = { data: typed, isEvalSupported: true, stopAtErrors: true };
  for (const source of ['local.pdf', url, buffer, typed, settings]) {
    window.pdfjsLib.getDocument(source);
  }
  assert.equal(window.pdfjsLib.version, originalViewer.version);
  assert.equal(requests[0].url, 'local.pdf');
  assert.equal(requests[1].url, url);
  assert.equal(requests[2].data, buffer);
  assert.equal(requests[3].data, typed);
  assert.equal(requests[4].stopAtErrors, true);
  assert.equal(settings.isEvalSupported, true);
  assert.ok(requests.every(request => request.isEvalSupported === false));

  const html = fs.readFileSync(path.join(root, 'BASE.html'), 'utf8');
  assert.match(html, /src="libs\/pdf\.js"[^>]*><\/script>\s*<script src="js\/pdfjs-safety\.js"/);
});
