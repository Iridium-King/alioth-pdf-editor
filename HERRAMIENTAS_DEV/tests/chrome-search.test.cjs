const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const runtime = { window: { app: {} } };
vm.createContext(runtime);
vm.runInContext(fs.readFileSync(path.join(root, 'js/search_normalization.js'), 'utf8'), runtime);
const search = runtime.window.AliothSearch;

test('search ignores accents and case, preserving ñ as a distinct letter', () => {
    assert.equal(search.fold('Configuración ÁÉÍÓÚ Ü'), 'configuracion aeiou u');
    assert.equal(search.fold('NIN\u0303O'), 'niño');
    assert.notEqual(search.fold('año'), search.fold('ano'));
    assert.equal(search.fold('ÁRBOL'), search.fold('a\u0301rbol'));
});

test('decomposed accents map matches to the full original glyph range', () => {
    const text = 'xx configuracio\u0301n yy';
    const mapped = search.offsets(text);
    const index = mapped.text.indexOf('configuracion');
    assert.equal(text.slice(mapped.starts[index], mapped.ends[index + 12]), 'configuracio\u0301n');
});

test('PDF fallback finds words across adjacent spans and retains exact character offsets', () => {
    const item = (str, x, width) => ({ str, width, transform: [12, 0, 0, 12, x, 100] });
    const items = [item('xx configu', 0, 60), item('racio\u0301n yy', 60, 60)];
    const hits = search.pdfMatches(items, 'configuracion');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].map(piece => piece.item.str.slice(piece.start, piece.end)).join(''), 'configuracio\u0301n');
    assert.equal(search.pdfMatches([item('año ano AÑO', 0, 60)], 'ano').length, 1);
});

test('function palette matches accented titles using the same comparison', () => {
    const list = {};
    const context = { window: { app: {}, AliothSearch: search }, document: { getElementById: () => list }, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/app.ui.js'), 'utf8'), context);
    const app = context.window.app;
    app._getPaletteCommandList = () => [{ title: 'Configuración de página', category: 'Páginas' }, { title: 'Año', category: 'Documento' }];
    app._renderCommandPaletteResults = () => {};
    app.filterCommandPalette('CONFIGURACION');
    assert.equal(app._paletteFilteredCommands.length, 1);
    app.filterCommandPalette('paginas');
    assert.equal(app._paletteFilteredCommands.length, 1);
    app.filterCommandPalette('ano');
    assert.equal(app._paletteFilteredCommands.length, 0);
});
