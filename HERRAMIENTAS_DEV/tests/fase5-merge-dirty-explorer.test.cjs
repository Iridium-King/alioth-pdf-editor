// HERRAMIENTAS_DEV/tests/fase5-merge-dirty-explorer.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Fase 5: Proxy exposes /api/files/reveal endpoint and explorer invocation', () => {
    const py = fs.readFileSync(path.join(ROOT_DIR, '_proxy.py'), 'utf8');
    assert.ok(py.includes("self.path == '/api/files/reveal'"), 'Missing route /api/files/reveal in _proxy.py');
    assert.ok(py.includes('def _reveal_file_in_explorer(self):'), 'Missing _reveal_file_in_explorer in _proxy.py');
    assert.ok(py.includes('explorer.exe'), 'Missing explorer.exe invocation');
});

test('Fase 5: PythonManager.mergePDFs builds nested bookmarks', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'python_manager.js'), 'utf8');
    assert.ok(js.includes('mergePDFs: async function (buffers, docNames = [])'), 'Missing docNames parameter in mergePDFs');
    assert.ok(js.includes('combined_toc.append([1, doc_name, root_pno])'), 'Missing root bookmark creation');
    assert.ok(js.includes('out.set_toc(combined_toc)'), 'Missing set_toc call on merged output');
});

test('Fase 5: app.pdf.js passes docNames into mergePDFs', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.pdf.js'), 'utf8');
    assert.ok(js.includes('PythonManager.mergePDFs(buffers, docNames)'), 'Missing docNames pass to mergePDFs');
});

test('Fase 5: Tab dirty indicator rendered in app.render.js and styled in css/app.css', () => {
    const renderJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.render.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT_DIR, 'css', 'app.css'), 'utf8');
    assert.ok(renderJs.includes('isDocumentDirty(d.id)'), 'Missing isDocumentDirty call in renderTabs');
    assert.ok(renderJs.includes('doc-tab-dirty'), 'Missing doc-tab-dirty class in renderTabs');
    assert.ok(css.includes('.doc-tab-dirty'), 'Missing .doc-tab-dirty in css/app.css');
});

test('Fase 5: Closed tabs stack and explorer reveal in app.ui.js', () => {
    const uiJs = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.ui.js'), 'utf8');
    assert.ok(uiJs.includes('_closedTabsStack'), 'Missing _closedTabsStack in app.ui.js');
    assert.ok(uiJs.includes('reopenLastClosedTab: async function'), 'Missing reopenLastClosedTab in app.ui.js');
    assert.ok(uiJs.includes('revealCurrentFileInExplorer: async function'), 'Missing revealCurrentFileInExplorer in app.ui.js');
    assert.ok(uiJs.includes("key === 't' && e.shiftKey"), 'Missing Ctrl+Shift+T keyboard shortcut');
    assert.ok(uiJs.includes('Mostrar en el Explorador'), 'Missing context menu item in showTabContextMenu');
});
