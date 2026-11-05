const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');
const root = path.resolve(__dirname, '../..');

function storageFixture(initial = {}) {
  class Storage {
    getItem(key) { return Object.hasOwn(this, key) ? String(this[key]) : null; }
    setItem(key, value) { this[key] = String(value); }
    removeItem(key) { delete this[key]; }
    clear() { Object.keys(this).forEach(key => delete this[key]); }
    key(index) { return Object.keys(this)[index] ?? null; }
    get length() { return Object.keys(this).length; }
  }
  return { Storage, storage: Object.assign(new Storage(), initial) };
}

function bridge(initial, seed = {}, send) {
  const { Storage, storage } = storageFixture(initial), calls = [], events = {};
  const window = { localStorage: storage, __aliothPreferences: seed, addEventListener: (name, fn) => events[name] = fn };
  const context = { window, Storage, location: { protocol: 'http:' }, navigator: { sendBeacon() {} }, Blob,
    setTimeout: () => 1, clearTimeout() {}, Map, JSON, Object,
    fetch: async (url, options) => { calls.push({ url, ...JSON.parse(options.body) }); return send ? send() : { ok: true }; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/preferences.js'), 'utf8'), context);
  return { storage, calls, window, events };
}

test('server settings restore on a fresh origin and migrate other existing preferences', async () => {
  const h = bridge({ app_language: 'es', gemini_api_key: 'private' }, { alioth_theme: 'dark', customAccentColor: '#aa0088' });
  assert.equal(h.storage.getItem('alioth_theme'), 'dark');
  assert.equal(h.storage.getItem('customAccentColor'), '#aa0088');
  await h.window.aliothPreferences.flush();
  assert.equal(h.calls[0].app_language, 'es');
  assert.equal('gemini_api_key' in h.calls[0], false);
});

test('closing waits for an in-flight save and persists the latest reading state', async () => {
  let complete, sends = 0, settled = false;
  const h = bridge({}, {}, () => ++sends === 1 ? new Promise(resolve => { complete = resolve; }) : { ok: true });
  h.storage.setItem('alioth_reading_mode', 'false');
  const first = h.window.aliothPreferences.flush();
  h.storage.setItem('alioth_reading_mode', 'true');
  const closing = h.window.aliothPreferences.flush().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  complete({ ok: true });
  await Promise.all([first, closing]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].alioth_reading_mode, 'true');
});

test('changed settings, removals and clear are persisted while session secrets stay local', async () => {
  const h = bridge({}, { alioth_theme: 'dark', customAccentColor: '#aa0088' });
  h.storage.setItem('alioth_default_zoom', 'page-width');
  h.storage.setItem('dex_profiles', '[{"id":"local"}]');
  h.storage.setItem('alioth_transfer_meta_tmp', 'temporary');
  h.storage.removeItem('customAccentColor');
  await h.window.aliothPreferences.flush();
  assert.equal(h.calls[0].alioth_default_zoom, 'page-width');
  assert.equal(h.calls[0].customAccentColor, null);
  assert.equal('alioth_transfer_meta_tmp' in h.calls[0], false);
  h.storage.clear();
  await h.window.aliothPreferences.flush();
  assert.equal(h.calls[1].alioth_theme, null);
});

test('deleted server values remove stale copies from another origin', () => {
  const h = bridge({ customAccentColor: '#old' }, { customAccentColor: null });
  assert.equal(h.storage.getItem('customAccentColor'), null);
});

function colors(initial) {
  const { storage } = storageFixture(initial), styles = new Map(), classes = new Set();
  const body = { style: { setProperty: (k, v) => styles.set(k, v), getPropertyValue: k => styles.get(k) || '', removeProperty: k => styles.delete(k) },
    classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) } };
  const app = {}, window = { app };
  const document = { body, readyState: 'complete', getElementById: () => null, querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/color_picker.js'), 'utf8'), {
    app, window, document, localStorage: storage, console, setTimeout() {}, getComputedStyle: () => body.style
  });
  return { app, storage, styles, body };
}

test('custom accent and other builtin preset colors survive reloading in both modes', () => {
  for (const theme of ['light', 'dark']) {
    let h = colors({ alioth_theme: theme, alioth_last_preset: 'original' });
    for (const [type, color] of [['accent', '#dd1188'], ['header', '#445566'], ['ribbon', '#112233'], ['bgApp', '#778899']]) h.app.setCustomColor(type, color);
    h = colors({ ...h.storage });
    assert.equal(h.styles.get('--accent'), '#dd1188');
    assert.equal(h.styles.get('--primary'), '#445566');
    assert.equal(h.styles.get('--bg-ribbon'), '#112233');
    assert.equal(h.styles.get('--bg-app'), '#778899');
  }
});

test('legacy saved accent is recovered and repeatedly applying an inverted custom theme is stable', () => {
  const h = colors({ alioth_last_preset: 'original', customAccentColor: '#ff0099' });
  assert.equal(h.styles.get('--accent'), '#ff0099');
  h.app.presets.test = { id: 'test', name: 'test', isCustom: true, header: '#112233', ribbon: '#aabbcc', invertColors: true };
  h.app.applyThemePreset('test', true);
  h.app.applyThemePreset('test', true);
  assert.equal(h.styles.get('--primary'), '#aabbcc');
  assert.equal(h.app.presets.test.header, '#112233');
});

test('document defaults apply numeric zoom, page width and page fit with the actual viewport', async () => {
  for (const [selected, width, height, expected] of [['1.5', 600, 800, 1.5], ['page-width', 632, 848, 1], ['page-fit', 1232, 448, 0.5]]) {
    const h = loadAppModules(['js/app.ui.js'], { localStorage: { getItem: () => selected } });
    h.app.splitView = { activePanel: 'primary' };
    h.app.getPanelElements = () => ({ mainView: { clientWidth: width, clientHeight: height } });
    await h.app.applyDefaultDocumentZoom(h.first, { getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }) });
    assert.equal(h.first.scale, expected);
  }
});

test('the fixed AI button ignores former draggable positions', () => {
  for (const saved of [300, 50, 10000]) {
    const box = (top, width, height) => ({ top, bottom: top + height, left: 960, right: 960 + width, width, height });
    const button = { style: {}, addEventListener() {}, getBoundingClientRect() { return box(parseFloat(this.style.top) || 200, 40, 25); } };
    const arrow = () => ({ style: {}, getBoundingClientRect: () => box(0, 25, 25) });
    const elements = { 'ai-floating-btn': button, 'ribbonContainer': { getBoundingClientRect: () => box(0, 40, 220) }, 'ai-nav-btn-top': arrow(), 'ai-nav-btn-bottom': arrow() };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/ai_float_btn.js'), 'utf8'), {
      document: { getElementById: id => elements[id], addEventListener() {} },
      window: { innerHeight: 700, addEventListener() {} }, requestAnimationFrame: callback => callback(),
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      localStorage: { getItem: () => JSON.stringify({ y: saved, version: 2 }) }
    });
    assert.equal(button.style.top, '337.5px');
    assert.equal(button.style.transform, 'none');
  }
});
