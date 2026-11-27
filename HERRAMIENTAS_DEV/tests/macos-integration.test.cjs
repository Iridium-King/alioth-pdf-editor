const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { File } = require('node:buffer');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture(fetch) {
    const h = loadAppModules(['js/app.core.js', 'js/app.pdf.js'], {
        fetch, Blob, File, crypto: { randomUUID }, navigator: {},
        localStorage: { getItem() { return null; } }
    });
    const messages = [];
    h.windowObject.webkit = { messageHandlers: { alioth: { async postMessage(body) {
        messages.push(body);
        return { ok: true, platform: 'darwin', defaultIsAlioth: true };
    } } } };
    h.app.showToast = () => {};
    h.app.toggleLoader = () => {};
    h.app.closeAllModals = () => {};
    h.app._readSaveEncryption = () => ({});
    h.app.resolveNativeSaveEncryption = () => ({});
    h.app.captureDocumentSnapshot = async () => ({});
    h.app.prepareDocumentPdf = async () => ({ bytes: new TextEncoder().encode('%PDF-1.7\nfixture') });
    h.documentObject.querySelector = () => null;
    return { ...h, messages };
}

test('Mac sharing passes the current generated PDF to the native sheet', async () => {
    const requests = [];
    const { app, messages } = fixture(async (...args) => { requests.push(args); return { ok: true }; });
    await app.sharePDF();
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].body.type, 'application/pdf');
    assert.match(await requests[0][1].body.text(), /^%PDF-/);
    assert.equal(messages[0].action, 'sharePDF');
    assert.ok(requests[0][0].endsWith(messages[0].token));
    assert.match(messages[0].filename, /\.pdf$/);
});

test('Mac sharing stops when transfer storage fails', async () => {
    const { app, messages } = fixture(async () => ({ ok: false }));
    const errors = [];
    app.showToast = message => errors.push(message);
    await app.sharePDF();
    assert.equal(messages.length, 0);
    assert.match(errors[0], /No se pudo preparar el PDF/);
});

test('Mac integration uses native status and never invokes Windows registration', async () => {
    const { app, messages, documentObject } = fixture(() => { throw new Error('Unexpected HTTP request'); });
    const element = {};
    documentObject.getElementById = () => element;
    await app.refreshWindowsIntegrationStatus();
    assert.match(element.textContent, /predeterminado: Alioth/);
    await app.associatePdfAsDefault();
    assert.ok(messages.some(message => message.action === 'associatePDF'));
});
