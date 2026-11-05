// HERRAMIENTAS_DEV/tests/layers-ocg.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Layers Panel: Markup in BASE.html exists and is complete', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'BASE.html'), 'utf8');
    assert.ok(html.includes('id="layers-panel-sidebar"'), 'Missing #layers-panel-sidebar in BASE.html');
    assert.ok(html.includes('id="layers-empty-state"'), 'Missing #layers-empty-state in BASE.html');
    assert.ok(html.includes('id="layers-list"'), 'Missing #layers-list in BASE.html');
    assert.ok(html.includes('id="toggleSbLayers"'), 'Missing #toggleSbLayers in BASE.html');
});

test('Layers Panel: CSS rules in css/app.css exist', () => {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'css', 'app.css'), 'utf8');
    assert.ok(css.includes('#layers-panel-sidebar'), 'Missing #layers-panel-sidebar CSS');
    assert.ok(css.includes('#toggleSbLayers'), 'Missing #toggleSbLayers CSS');
    assert.ok(css.includes('body.h-layout #layers-panel-sidebar'), 'Missing h-layout rules for layers panel');
});

test('Layers Panel: Methods in js/app.panels.js exist', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.panels.js'), 'utf8');
    assert.ok(js.includes('toggleLayersPanel: function'), 'Missing toggleLayersPanel');
    assert.ok(js.includes('_loadLayers: async function'), 'Missing _loadLayers');
    assert.ok(js.includes('toggleLayerVisibility: async function'), 'Missing toggleLayerVisibility');
    assert.ok(js.includes('showAllLayers: async function'), 'Missing showAllLayers');
});

test('Layers Panel: Render integration in js/app.render.js passes optionalContentConfigPromise', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.render.js'), 'utf8');
    assert.ok(js.includes('renderParams.optionalContentConfigPromise = src.optionalContentConfigPromise'), 'Missing optionalContentConfig in main render');
    assert.ok(js.includes('thumbRenderParams.optionalContentConfigPromise = s.optionalContentConfigPromise'), 'Missing optionalContentConfig in thumbnail render');
    assert.ok(js.includes('taskParams.optionalContentConfigPromise = src.optionalContentConfigPromise'), 'Missing optionalContentConfig in continuous render');
});
