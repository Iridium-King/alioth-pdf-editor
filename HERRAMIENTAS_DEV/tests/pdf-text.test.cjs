const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(respond) {
  const calls = [];
  const context = {
    window: { location: { protocol: 'http:' } }, Uint8Array, AbortSignal,
    btoa: text => Buffer.from(text, 'binary').toString('base64'),
    fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return respond(calls.length); },
    console: { log() {}, warn() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/python_manager.js'), 'utf8'), context);
  const manager = context.window.PythonManager;
  manager.init = async () => { manager.isLoaded = true; };
  manager.run = async () => JSON.stringify([{ page: 1, total: 1, text: 'Respaldo', hasText: true }]);
  return { manager, calls };
}
const response = pages => ({ ok: true, json: async () => ({ ok: true, pages }) });

test('native extraction preserves page order, empty pages and short text without loading WASM', async () => {
  const { manager } = fixture(() => response([
    { page: 1, total: 3, text: 'Sí' }, { page: 2, total: 3, text: '' }, { page: 3, total: 3, text: 'Final' }
  ]));
  manager.init = async () => { throw new Error('WASM must remain unloaded'); };
  const text = await manager.extractDocumentText(new Uint8Array([1, 2, 3]).buffer);
  assert.match(text, /PÁGINA 1 DE 3[\s\S]*Sí[\s\S]*PÁGINA 2 DE 3[\s\S]*formato imagen[\s\S]*PÁGINA 3 DE 3[\s\S]*Final/);
});

test('base64 survives multiple encoding chunks and page extraction selects the requested source page', async () => {
  const { manager, calls } = fixture(() => response([{ page: 2, total: 3, text: 'Página dos' }]));
  const bytes = Uint8Array.from({ length: 150001 }, (_, i) => i % 256);
  assert.equal(await manager.extractPageText(bytes.buffer, 1), 'Página dos');
  assert.deepEqual(Buffer.from(calls[0].pdfBase64, 'base64'), Buffer.from(bytes));
  assert.deepEqual(calls[0].pageIndices, [1]);
});

test('an older server falls back to WASM and avoids repeatedly requesting a missing endpoint', async () => {
  const { manager, calls } = fixture(() => ({ ok: false, status: 404 }));
  assert.match(await manager.extractDocumentText(new ArrayBuffer(3)), /Respaldo/);
  assert.match(await manager.extractDocumentText(new ArrayBuffer(3)), /Respaldo/);
  assert.equal(calls.length, 1);
});

test('transient errors are retried on the next extraction', async () => {
  const { manager, calls } = fixture(count => count === 1 ? { ok: false, status: 503 } :
    response([{ page: 1, total: 1, text: 'Recuperado' }]));
  assert.match(await manager.extractDocumentText(new ArrayBuffer(3)), /Respaldo/);
  assert.match(await manager.extractDocumentText(new ArrayBuffer(3)), /Recuperado/);
  assert.equal(calls.length, 2);
});

test('truncated or incorrectly numbered results cannot silently omit source pages', async () => {
  for (const pages of [[], [{ page: 1, total: 2, text: 'Incompleto' }], [{ page: 2, total: 2, text: 'Fuera de orden' }]]) {
    const { manager } = fixture(() => response(pages));
    assert.match(await manager.extractDocumentText(new ArrayBuffer(3)), /Respaldo/);
  }
});
