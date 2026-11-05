const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function engine(fetch, abortSignal = AbortSignal) {
  const context = { window: { location: { protocol: 'http:' } }, performance, console: { info() {} },
    ArrayBuffer, Uint8Array, Map, Set, AbortSignal: abortSignal, fetch,
    btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../js/python_manager.js'), 'utf8'), context);
  const manager = context.window.PythonManager;
  manager.init = async () => { throw Error('Unnecessary WASM initialization'); };
  manager.run = async () => { throw Error('Unnecessary WASM execution'); };
  return manager;
}

test('native extraction avoids initializing WASM and sends only the selected pages', async () => {
  const pdf = Uint8Array.from({ length: 16387 }, (_, index) => index % 251);
  const manager = engine(async (url, options) => {
    assert.equal(url, '/api/pdf/translation/v2');
    const body = JSON.parse(options.body);
    assert.equal(body.operation, 'extract');
    assert.deepEqual(body.pageIndices, [2]);
    assert.deepEqual(Buffer.from(body.pdfBase64, 'base64'), Buffer.from(pdf));
    return { ok: true, json: async () => ({ ok: true, result: [] }) };
  });
  assert.equal((await manager.extractTranslatableText(pdf.buffer, { pageIndices: [2] })).length, 0);
});

test('native reconstruction returns binary PDF bytes without WASM', async () => {
  const manager = engine(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer }));
  const result = await manager._runTranslation('reconstruct', new ArrayBuffer(1), { occurrences: [], fonts: {} });
  assert.deepEqual([...result], [37, 80, 68, 70]);
});

test('notes extraction uses the lightweight operation and never resolves fonts', async () => {
  const manager = engine(async (_, options) => {
    assert.equal(JSON.parse(options.body).operation, 'extract-notes');
    return { ok: true, json: async () => ({ ok: true, result: [{ text: 'Title', fontName: 'Custom' }] }) };
  });
  manager.resolveTranslationFont = async () => { throw new Error('Notes must not resolve fonts'); };
  const spans = await manager.extractTranslatableText(new ArrayBuffer(1), { pageIndices: [0], forNotes: true });
  assert.equal(spans[0].text, 'Title');
});

test('large native reconstruction has a scaled timeout and never repeats timed-out work in WASM', async () => {
  let nativeCalls = 0, wasmCalls = 0;
  let timeoutMs = 0;
  const manager = engine(async (url, options) => {
    nativeCalls++;
    assert.equal(url, '/api/pdf/translation/v2');
    assert.ok(options.signal);
    throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
  }, { timeout(ms) { timeoutMs = ms; return AbortSignal.timeout(ms); } });
  manager.run = async () => { wasmCalls++; return undefined; };
  await assert.rejects(manager._runTranslation('reconstruct', new ArrayBuffer(1), { occurrences: new Array(504).fill(null), fonts: {} }),
    /TRANSLATION_NATIVE_TIMEOUT/);
  assert.equal(nativeCalls, 1);
  assert.equal(wasmCalls, 0);
  assert.ok(timeoutMs > 312000 && timeoutMs <= 900000);
});

test('a reconstruction connection failure does not duplicate the native operation in WASM', async () => {
  let wasmCalls = 0;
  const manager = engine(async () => { throw Object.assign(new Error('network disconnected'), { name: 'TypeError' }); });
  manager.run = async () => { wasmCalls++; return undefined; };
  await assert.rejects(manager._runTranslation('reconstruct', new ArrayBuffer(1), { occurrences: [], fonts: {} }),
    /TRANSLATION_NATIVE_CONNECTION_FAILED/);
  assert.equal(wasmCalls, 0);
});

test('an older server falls back to the shared Python module and does not retry its missing endpoint', async () => {
  let nativeCalls = 0, sourceCalls = 0, runs = 0;
  const manager = engine(async url => {
    if (url === '/api/pdf/translation/v2') { nativeCalls++; return { ok: false, status: 404 }; }
    assert.equal(url, 'js/pdf_translation.py');
    sourceCalls++;
    return { ok: true, text: async () => '# shared kernel' };
  });
  manager.run = async (code, globals) => {
    runs++;
    assert.match(code, /^# shared kernel\nextract_translatable_text/);
    assert.equal(globals.js_translation_operation, 'extract');
    return '[]';
  };
  await manager.extractTranslatableText(new ArrayBuffer(1));
  await manager.extractTranslatableText(new ArrayBuffer(1));
  assert.deepEqual({ nativeCalls, sourceCalls, runs }, { nativeCalls: 1, sourceCalls: 1, runs: 2 });
});

test('origin denial and actual PDF errors are surfaced without fallback or duplicate work', async () => {
  for (const status of [403, 422]) {
    const manager = engine(async () => ({ ok: false, status, json: async () => ({ error: 'TRANSLATION_OUTPUT_UNVERIFIED' }) }));
    await assert.rejects(manager.extractTranslatableText(new ArrayBuffer(1)), /TRANSLATION_OUTPUT_UNVERIFIED/);
  }
});

test('native overflow preserves the failed occurrence identifier for review', async () => {
  const manager = engine(async () => ({ ok: false, status: 422, json: async () => ({
    error: 'TRANSLATION_OVERFLOW', failedOccurrenceId: 'native:source_123:6:1425', failedPageIndex: 6, failedStage: 'plan'
  }) }));
  await assert.rejects(manager._runTranslation('reconstruct', new ArrayBuffer(1), { occurrences: [], fonts: {} }), error => {
    assert.equal(error.message, 'TRANSLATION_OVERFLOW');
    assert.equal(error.failedOccurrenceId, 'native:source_123:6:1425');
    assert.equal(error.failedPageIndex, 6);
    assert.equal(error.failedStage, 'plan');
    return true;
  });
});

test('native verification failure preserves page and stage without an occurrence', async () => {
  const manager = engine(async () => ({ ok: false, status: 422, json: async () => ({
    error: 'TRANSLATION_OUTPUT_UNVERIFIED', failedPageIndex: 3, failedStage: 'redaction_verify'
  }) }));
  await assert.rejects(manager._runTranslation('reconstruct', new ArrayBuffer(1), { occurrences: [], fonts: {} }), error => {
    assert.equal(error.failedPageIndex, 3);
    assert.equal(error.failedStage, 'redaction_verify');
    return true;
  });
});

test('a native size limit permits local fallback without disabling native for later smaller PDFs', async () => {
  let nativeCalls = 0;
  const manager = engine(async url => url === '/api/pdf/translation/v2'
    ? (++nativeCalls, { ok: false, status: 413 })
    : { ok: true, text: async () => '# shared kernel' });
  manager.run = async () => '[]';
  await manager.extractTranslatableText(new ArrayBuffer(1));
  await manager.extractTranslatableText(new ArrayBuffer(1));
  assert.equal(nativeCalls, 2);
});

test('an absent local extraction result is an engine error, not an empty PDF', async () => {
  const manager = engine(async url => url === '/api/pdf/translation/v2'
    ? { ok: false, status: 404 }
    : { ok: true, text: async () => '# shared kernel' });
  manager.run = async () => undefined;
  await assert.rejects(manager.extractTranslatableText(new ArrayBuffer(1)), /TRANSLATION_SOURCE_EXTRACTION_INVALID/);
});
