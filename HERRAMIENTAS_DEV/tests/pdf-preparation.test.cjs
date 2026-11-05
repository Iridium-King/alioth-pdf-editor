const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('image diagnostics do not reference a block-scoped embed after a failed draw', () => {
  assert.doesNotMatch(read('js/app.pdf.js'), /hasEmbeddedImage:\s*!!imgEmbed/);
});

function loadPdfApp(consoleObject = console) {
  const loader = { innerText: '', textContent: '', style: {} };
  const windowObject = { app: {} };
  const context = {
    window: windowObject,
    console: consoleObject,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    JSON,
    Math,
    Set,
    Map,
    Date,
    Promise,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => loader },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(`(function () {\n${read('js/app.pdf.js')}\n})();`, context, { filename: 'app.pdf.js' });
  return { app: windowObject.app, context };
}

test('vector drawings do not fall through to image embedding', async () => {
  const warnings = [];
  const consoleObject = Object.create(console);
  consoleObject.warn = (...args) => warnings.push(args);
  const { app, context } = loadPdfApp(consoleObject);
  const snapshot = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([200, 200]);
    const bytes = await source.save();
    return { schemaVersion: 1, docId: 'drawing', revision: 1, lifecycleEpoch: 0, payload: {
      document: { name: 'drawing.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
      pages: [{ sourceId: 'source', pageIndex: 0, rotation: 0, objects: [{
        type: 'drawing', x: 10, y: 10, width: 80, height: 40,
        path: [{ x: 10, y: 10 }, { x: 90, y: 50 }], color: '#000000', opacity: 1
      }] }],
      sources: [{ sourceId: 'source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: {} }]
    } };
  })()`, context);
  app.toggleLoader = () => {};
  app.showToast = () => {};

  const prepared = await app.prepareDocumentPdf(snapshot, { purpose: 'save', compression: 'none', protection: 'preserve' });

  assert.equal(prepared.validation.ok, true);
  assert.equal(warnings.some(args => args[0] === '[SavePDF] image/stamp omitted'), false);
});

test('preparing a snapshot compiles its bytes without reading the active document', async () => {
  const { app, context } = loadPdfApp();
  const fixture = await vm.runInNewContext(`(async () => {
    const first = await PDFLib.PDFDocument.create();
    first.addPage([211, 212]);
    const second = await PDFLib.PDFDocument.create();
    second.addPage([333, 334]);
    const firstBytes = await first.save();
    const secondBytes = await second.save();
    return {
      snapshot: {
        schemaVersion: 1,
        docId: 'first', revision: 3, lifecycleEpoch: 0,
        payload: {
          document: { name: 'first.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
          pages: [{ sourceId: 'first-source', pageIndex: 0, rotation: 0, objects: [] }],
          sources: [{ sourceId: 'first-source', buffer: firstBytes.buffer.slice(firstBytes.byteOffset, firstBytes.byteOffset + firstBytes.byteLength), metadata: {} }]
        }
      },
      active: { name: 'second.pdf', currentIndex: 0, pages: [{ sourceId: 'second-source', pageIndex: 0, rotation: 0, objects: [] }], sources: { 'second-source': { buffer: secondBytes } } }
    };
  })()`, context);
  app.getDoc = () => fixture.active;
  app.toggleLoader = () => {};
  app.showToast = () => {};
  const prepared = await app.prepareDocumentPdf(fixture.snapshot, { purpose: 'save', compression: 'none', protection: 'preserve' });
  const output = await context.PDFLib.PDFDocument.load(prepared.bytes);
  const size = output.getPages()[0].getSize();
  assert.equal(size.width, 211);
  assert.equal(size.height, 212);
  assert.equal(prepared.revision, 3);
  assert.equal(prepared.validation.ok, true);
});

test('preparation preserves generated index pages and accepts native compression levels', async () => {
  const { app, context } = loadPdfApp();
  const qualities = [];
  context.PythonManager.compressPDF = async (bytes, quality) => {
    qualities.push(quality);
    return bytes;
  };
  const snapshot = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([210, 220]);
    const bytes = await source.save();
    return { schemaVersion: 1, docId: 'index', revision: 1, lifecycleEpoch: 0, payload: {
      document: { name: 'index.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
      pages: [
        { sourceId: 'generated-index', pageIndex: 0, width: 320, height: 180, rotation: 0, objects: [] },
        { sourceId: 'source', pageIndex: 0, rotation: 0, objects: [] }
      ],
      sources: [
        { sourceId: 'generated-index', buffer: null, metadata: {} },
        { sourceId: 'source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: {} }
      ]
    } };
  })()`, context);
  app.toggleLoader = () => {};
  app.showToast = () => {};
  const prepared = await app.prepareDocumentPdf(snapshot, { purpose: 'save-as', compression: 'standard', protection: 'preserve' });
  const output = await context.PDFLib.PDFDocument.load(prepared.bytes);
  assert.equal(output.getPageCount(), 2);
  assert.equal(output.getPages()[0].getWidth(), 320);
  assert.equal(output.getPages()[0].getHeight(), 180);
  assert.equal(prepared.validation.ok, true);
  assert.deepEqual(qualities, [75]);
});

test('requested compression failure rejects preparation instead of saving original bytes', async () => {
  const { app, context } = loadPdfApp();
  context.PythonManager.compressPDF = async () => { throw new Error('COMPRESSOR_FAILED'); };
  const snapshot = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([210, 220]);
    const bytes = await source.save();
    return { schemaVersion: 1, docId: 'compress', revision: 1, lifecycleEpoch: 0, payload: {
      document: { name: 'compress.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
      pages: [{ sourceId: 'source', pageIndex: 0, rotation: 0, objects: [] }],
      sources: [{ sourceId: 'source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: {} }]
    } };
  })()`, context);
  app.toggleLoader = () => {};
  await assert.rejects(app.prepareDocumentPdf(snapshot, { purpose: 'save-as', compression: 'standard', protection: 'preserve' }), /COMPRESSION_FAILED/);
});

test('prepared PDF validation rejects a page count mismatch', async () => {
  const { app } = loadPdfApp();
  const result = await app.validatePreparedPdf(new Uint8Array([1]), { payload: { pages: [{}, {}] } }, {});
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, 'INVALID_PDF');
});

test('preparation preserves a native field and canonicalization drops prior buffers', async () => {
  const { app, context } = loadPdfApp();
  context.PythonManager.compressPDF = async bytes => bytes;
  const fixture = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    const page = source.addPage([300, 220]);
    const field = source.getForm().createTextField('nombre');
    field.setText('ORIGINAL');
    field.addToPage(page, { x: 20, y: 150, width: 160, height: 24 });
    const bytes = await source.save();
    return {
      schemaVersion: 1, docId: 'form', revision: 2, lifecycleEpoch: 0,
      payload: {
        document: { name: 'form.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
        pages: [{ sourceId: 'source', pageIndex: 0, rotation: 0, objects: [], nativeFormValues: { nombre: { kind: 'text', value: 'CAMBIO' } } }],
        sources: [{ sourceId: 'source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: {} }]
      }
    };
  })()`, context);
  app.toggleLoader = () => {};
  app.showToast = () => {};
  const prepared = await app.prepareDocumentPdf(fixture, { purpose: 'save', compression: 'lossless', protection: 'preserve' });
  const reopened = await context.PDFLib.PDFDocument.load(prepared.bytes);
  assert.equal(reopened.getForm().getTextField('nombre').getText(), 'CAMBIO');
  const doc = { id: 'form', pages: fixture.payload.pages, sources: { source: { buffer: fixture.payload.sources[0].buffer, originalBuffer: new Uint8Array([9]).buffer } } };
  app.docs = [doc];
  app.getDocumentById = id => id === doc.id ? doc : null;
  app.markDocumentChanged = () => {};
  await app.adoptCanonicalPdf(doc.id, prepared.bytes, { action: 'test' });
  const sourceIds = Object.keys(doc.sources);
  assert.equal(sourceIds.length, 1);
  assert.equal(doc.sources[sourceIds[0]].originalBuffer, undefined);
  assert.equal(doc.pages[0].sourceId, sourceIds[0]);
});

test('preparation rejects a source whose protection cannot be preserved', async () => {
  const { app, context } = loadPdfApp();
  app.toggleLoader = () => {};
  app.showToast = () => {};
  const snapshot = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([200, 200]);
    const bytes = await source.save();
    return { schemaVersion: 1, docId: 'locked', revision: 1, lifecycleEpoch: 0, payload: {
      document: { name: 'locked.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
      pages: [{ sourceId: 'locked-source', pageIndex: 0, rotation: 0, objects: [] }],
      sources: [{ sourceId: 'locked-source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: { protectionRequired: true } }]
    } };
  })()`, context);
  await assert.rejects(() => app.prepareDocumentPdf(snapshot, { purpose: 'save', compression: 'none', protection: 'preserve' }), /PROTECTION_REQUIRED/);
});

test('preparation rejects a cryptographically signed source before rewriting it', async () => {
  const { app, context } = loadPdfApp();
  app.toggleLoader = () => {};
  app.showToast = () => {};
  const snapshot = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([200, 200]);
    const signature = source.context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 16, 32, 48],
      Contents: PDFLib.PDFHexString.of('00')
    });
    const signatureRef = source.context.register(signature);
    source.catalog.set(PDFLib.PDFName.of('Perms'), source.context.obj({ DocMDP: signatureRef }));
    const bytes = await source.save();
    return { schemaVersion: 1, docId: 'signed', revision: 1, lifecycleEpoch: 0, payload: {
      document: { name: 'signed.pdf', currentIndex: 0, scale: 1, indexEntries: [], metadata: {} },
      pages: [{ sourceId: 'signed-source', pageIndex: 0, rotation: 0, objects: [] }],
      sources: [{ sourceId: 'signed-source', buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), metadata: {} }]
    } };
  })()`, context);

  await assert.rejects(
    () => app.prepareDocumentPdf(snapshot, { purpose: 'save', compression: 'none', protection: 'preserve' }),
    /SIGNATURE_INVALIDATION_REQUIRED/
  );
});
