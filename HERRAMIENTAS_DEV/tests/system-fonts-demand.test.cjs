const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture() {
  const h = loadAppModules(['js/app.core.js']);
  const reads = [], styles = [];
  h.windowObject.queryLocalFonts = async () => [
    ['Regular', 400], ['Thin', 100], ['Bold', 700], ['Black', 900]
  ].map(([style, weight]) => ({ family: 'Demand Font', style, fullName: `Demand Font ${style}`,
    postscriptName: `DemandFont-${style}`, blob: async () => {
      reads.push(weight); return { arrayBuffer: async () => new Uint8Array([weight % 256]).buffer };
    } }));
  h.documentObject.createElement = () => ({});
  h.documentObject.head = { appendChild: style => styles.push(style) };
  h.app.refreshFontSelectors = () => {};
  return { ...h, reads, styles };
}

test('font discovery reads zero font blobs; embedding loads and caches the requested weight only', async () => {
  const h = fixture();
  await h.app.loadSystemFonts();
  assert.deepEqual(h.reads, []);
  assert.match(h.styles[0].textContent, /src: local\("Demand Font Bold"\)/);
  const [first, second] = await Promise.all([
    h.app.fontRegistry.loadFontBytes('Demand Font-Bold'), h.app.fontRegistry.loadFontBytes('Demand Font-Bold')
  ]);
  assert.equal(first, second);
  assert.deepEqual(h.reads, [700]);
  await h.app.fontRegistry.loadFontBytes('Demand Font');
  assert.deepEqual(h.reads, [700, 400]);
});

test('concurrent automatic discovery runs once; explicit synchronization can refresh fonts', async () => {
  const h = fixture();
  let queries = 0;
  const query = h.windowObject.queryLocalFonts;
  h.windowObject.queryLocalFonts = () => { queries++; return query(); };
  await Promise.all([h.app.loadSystemFonts(), h.app.loadSystemFonts()]);
  await h.app.loadSystemFonts();
  assert.equal(queries, 1);
  await h.app.loadSystemFonts(true);
  assert.equal(queries, 2);
  assert.deepEqual(h.reads, []);
});

test('an unavailable local font remains retryable and does not cache an empty result', async () => {
  const h = fixture();
  let attempts = 0;
  h.app._systemFontSources.Test = { fontData: { blob: async () => {
    if (++attempts === 1) throw Error('Read denied');
    return { arrayBuffer: async () => new ArrayBuffer(2) };
  } } };
  assert.equal(await h.app.loadSystemFontBytes('Test'), null);
  assert.equal((await h.app.loadSystemFontBytes('Test')).byteLength, 2);
});

test('translation loads the exact local font on demand without reading other variants', async () => {
  const h = fixture();
  await h.app.loadSystemFonts();
  h.windowObject.location = { protocol: 'http:' };
  h.context.btoa = value => Buffer.from(value, 'binary').toString('base64');
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/python_manager.js'), 'utf8'), h.context);
  const manager = h.windowObject.PythonManager;
  assert.equal(await manager.resolveTranslationFont('Demand Font-Bold'), 'local:demandfontbold');
  assert.deepEqual(h.reads, [700]);
  assert.equal(await manager.resolveTranslationFont('Demand Font-Bold'), 'local:demandfontbold');
  assert.deepEqual(h.reads, [700]);
});
