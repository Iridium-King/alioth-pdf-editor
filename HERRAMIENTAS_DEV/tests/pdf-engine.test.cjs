const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(respond) {
    const calls = [];
    const context = {
        window: {}, AbortSignal,
        fetch: async (url, options) => {
            calls.push({ url, ...options, body: JSON.parse(options.body) });
            return respond();
        }
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/pdf-engine.js'), 'utf8'), context);
    return { api: context.window.AliothPDFEngine, calls };
}

test('file operations call the shared engine route and return its result', async () => {
    const { api, calls } = fixture(() => ({ ok: true, json: async () => ({ ok: true, result: { page_count: 2 } }) }));
    const result = await api.fileTool('pdf_get_info', { filepath: 'C:/document.pdf' });
    assert.equal(result.page_count, 2);
    assert.equal(calls[0].url, '/api/pdf-tools');
    assert.equal(calls[0].body.operation, 'pdf_get_info');
    assert.equal(calls[0].body.arguments.filepath, 'C:/document.pdf');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
});

test('unsupported functions are rejected before sending a request', async () => {
    const { api, calls } = fixture(() => { throw new Error('Network must remain unused'); });
    await assert.rejects(api.fileTool('eval', {}), /INVALID_PDF_TOOL_OPERATION/);
    assert.equal(calls.length, 0);
});

test('live text extraction sends document bytes without reading its disk path', async () => {
    const { api, calls } = fixture(() => ({ ok: true, json: async () => ({ ok: true, pages: [] }) }));
    await api.extractText('JVBERi0=', [1]);
    assert.equal(calls[0].url, '/api/pdf/text');
    assert.equal(calls[0].body.pdfBase64, 'JVBERi0=');
    assert.deepEqual(Array.from(calls[0].body.pageIndices), [1]);
    assert.equal('filepath' in calls[0].body, false);
});

test('HTTP errors retain status for the existing WASM fallback', async () => {
    const { api } = fixture(() => ({ ok: false, status: 404, json: async () => { throw new Error('not JSON'); } }));
    await assert.rejects(api.extractText('JVBERi0='), error =>
        error.status === 404 && error.code === 'PDF_ENGINE_REQUEST_FAILED');
});
