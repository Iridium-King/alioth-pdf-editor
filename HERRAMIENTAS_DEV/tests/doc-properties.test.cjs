// HERRAMIENTAS_DEV/tests/doc-properties.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Document Properties: 4 Tabs and Panels in BASE.html exist', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'BASE.html'), 'utf8');
    assert.ok(html.includes('id="metadata-modal"'), 'Missing #metadata-modal');
    assert.ok(html.includes('id="proptab-desc"'), 'Missing proptab-desc');
    assert.ok(html.includes('id="proptab-sec"'), 'Missing proptab-sec');
    assert.ok(html.includes('id="proptab-fonts"'), 'Missing proptab-fonts');
    assert.ok(html.includes('id="proptab-adv"'), 'Missing proptab-adv');
    assert.ok(html.includes('id="proppanel-desc"'), 'Missing proppanel-desc');
    assert.ok(html.includes('id="proppanel-sec"'), 'Missing proppanel-sec');
    assert.ok(html.includes('id="proppanel-fonts"'), 'Missing proppanel-fonts');
    assert.ok(html.includes('id="proppanel-adv"'), 'Missing proppanel-adv');
});

test('Document Properties: CSS rules in css/app.css exist', () => {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'css', 'app.css'), 'utf8');
    assert.ok(css.includes('.prop-tab-btn'), 'Missing .prop-tab-btn CSS');
    assert.ok(css.includes('.prop-info-table'), 'Missing .prop-info-table CSS');
    assert.ok(css.includes('.prop-badge'), 'Missing .prop-badge CSS');
});

test('Document Properties: PythonManager exposes inspectDocumentProperties', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'python_manager.js'), 'utf8');
    assert.ok(js.includes('inspectDocumentProperties: async function'), 'Missing inspectDocumentProperties in python_manager.js');
    assert.ok(js.includes('doc.get_page_fonts'), 'Missing get_page_fonts call in python code');
    assert.ok(js.includes('is_subset'), 'Missing font subset detection in python code');
});

test('Document Properties: UI logic in js/app.pdf_ops.js is complete', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.pdf_ops.js'), 'utf8');
    assert.ok(js.includes('_switchPropTab: function'), 'Missing _switchPropTab in app.pdf_ops.js');
    assert.ok(js.includes('openDocumentProperties: function'), 'Missing openDocumentProperties in app.pdf_ops.js');
    assert.ok(js.includes('inspectDocumentProperties(src.buffer)'), 'Missing call to inspectDocumentProperties in showMetadataPanel');
});
