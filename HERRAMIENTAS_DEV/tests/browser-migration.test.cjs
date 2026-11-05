const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function migrationEntry(search, marker, blocked = false) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../browser-migration.html'), 'utf8');
  const redirects = [], scripts = [], panel = { style: {} };
  const context = {
    URLSearchParams,
    location: { search, replace: target => redirects.push(target) },
    localStorage: { getItem: () => { if (blocked) throw new Error('SecurityError'); return marker; } },
    document: {
      documentElement: { dataset: {} },
      querySelector: () => panel,
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script.src) }
    }
  };
  vm.createContext(context);
  for (const [, code] of source.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, context);
  return { redirects, scripts, panel };
}

test('completed migration redirects before displaying the panel or loading transfer code', () => {
  const target = '/BASE.html?openfile=C%3A%5Cdocumento.pdf';
  const { redirects, scripts, panel } = migrationEntry('?mode=import&target=' + encodeURIComponent(target), '1');
  assert.deepEqual(redirects, [target]);
  assert.deepEqual(scripts, []);
  assert.equal(panel.style.display, undefined);
});

test('first migration, export and unavailable storage retain the transfer interface', () => {
  for (const args of [['?mode=import', null], ['?mode=export', '1'], ['?mode=import', '1', true]]) {
    const { redirects, scripts, panel } = migrationEntry(...args);
    assert.deepEqual(redirects, []);
    assert.deepEqual(scripts, ['js/browser_migration.js']);
    assert.equal(panel.style.display, 'block');
  }
});

test('completed migration never bypasses target validation', () => {
  const { redirects, scripts, panel } = migrationEntry('?mode=import&target=https%3A%2F%2Fexample.com', '1');
  assert.deepEqual(redirects, []);
  assert.deepEqual(scripts, ['js/browser_migration.js']);
  assert.equal(panel.style.display, 'block');
});

function recoveryContext(storage = new Map()) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/browser_migration.js'), 'utf8');
  const context = { URLSearchParams, ArrayBuffer, Uint8Array, Blob, File, atob, btoa,
    location: { search: '' }, document: { getElementById: () => ({}) },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, window: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('    const work =')) +
    'window.preserve = preserveEmptyRecord; window.allowed = allowedKey; window.pack=pack; window.unpack=unpack; })();', context);
  return context;
}

test('empty inline records retain their exact packed key and value without duplicating retries', () => {
  const storage = new Map(), context = recoveryContext(storage);
  const row = { store: 'recents', key: { type: 'primitive', value: 42 }, value: { type: 'primitive', value: null } };
  assert.equal(context.window.preserve('AliothPDFEditor', { keyPath: 'id' }, row, null), true);
  assert.equal(context.window.preserve('AliothPDFEditor', { keyPath: 'id' }, row, null), true);
  const saved = JSON.parse(storage.get('alioth_native_migration_recovery'));
  assert.deepEqual(saved, [{ database: 'AliothPDFEditor', ...row }]);
  assert.equal(context.window.allowed('alioth_native_migration_recovery'), false);
  row.value = { type: 'undefined' };
  context.window.preserve('AliothPDFEditor', { keyPath: 'id' }, row, undefined);
  assert.equal(JSON.parse(storage.get('alioth_native_migration_recovery')).length, 2);
});

test('out of line null records and valid inline objects keep the ordinary write path', () => {
  const storage = new Map(), context = recoveryContext(storage);
  assert.equal(context.window.preserve('AliothPDFEditor', { keyPath: null }, {}, null), false);
  assert.equal(context.window.preserve('AliothPDFEditor', { keyPath: 'id' }, {}, { id: 1 }), false);
  assert.equal(storage.size, 0);
});

test('a failed recovery backup stops migration instead of silently dropping the record', () => {
  const context = recoveryContext();
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => context.window.preserve('AliothPDFEditor', { keyPath: 'id' },
    { store: 'recents', key: { type: 'primitive', value: 1 }, value: { type: 'primitive', value: null } }, null), /QuotaExceededError/);
});

test('binary decoding preserves every byte, typed offsets and blob content', async () => {
  const { window } = recoveryContext();
  const bytes = Uint8Array.from({ length: 1024 * 1024 }, (_, i) => i % 256);
  assert.equal(Buffer.compare(Buffer.from(window.unpack(await window.pack(bytes.buffer))), Buffer.from(bytes)), 0);
  const typed = new Uint16Array([7, 255, 65535]).subarray(1);
  assert.deepEqual(Array.from(window.unpack(await window.pack(typed))), [255, 65535]);
  const blob = new Blob(['Índice y configuración'], { type: 'text/plain' });
  assert.equal(await window.unpack(await window.pack(blob)).text(), await blob.text());
});

test('a blocked target database fails explicitly and closes a late connection', async () => {
  const call = {}, status = {}, closed = [], aborted = [];
  const source = fs.readFileSync(path.resolve(__dirname, '../../js/browser_migration.js'), 'utf8');
  const context = { URLSearchParams, location: { search: '' }, document: { getElementById: () => status },
    indexedDB: { open: () => call }, window: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('    const work =')) + 'window.openTarget = createTarget; })();', context);
  const opening = context.window.openTarget('AliothPDFEditor', { version: 30, stores: [] });
  const rejected = assert.rejects(opening, /MIGRATION_DATABASE_BUSY/);
  call.onblocked();
  await rejected;
  call.transaction = { abort: () => aborted.push(true) };
  call.onupgradeneeded();
  call.result = { close: () => closed.push(true) };
  call.onsuccess();
  assert.equal(aborted.length, 1);
  assert.equal(closed.length, 1);
});
