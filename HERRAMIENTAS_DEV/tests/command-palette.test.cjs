// HERRAMIENTAS_DEV/tests/command-palette.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('Command Palette: Markup in BASE.html exists and is complete', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'BASE.html'), 'utf8');
    assert.ok(html.includes('id="command-palette-modal"'), 'Missing #command-palette-modal in BASE.html');
    assert.ok(html.includes('id="command-palette-input"'), 'Missing #command-palette-input in BASE.html');
    assert.ok(html.includes('id="command-palette-results"'), 'Missing #command-palette-results in BASE.html');
    assert.ok(html.includes('class="command-palette-trigger-btn"'), 'Missing trigger button in BASE.html');
});

test('Command Palette: CSS rules exist in css/app.css', () => {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'css', 'app.css'), 'utf8');
    assert.ok(css.includes('#command-palette-modal'), 'Missing #command-palette-modal CSS');
    assert.ok(css.includes('.command-palette-trigger-btn'), 'Missing .command-palette-trigger-btn CSS');
    assert.ok(css.includes('.palette-item'), 'Missing .palette-item CSS');
    assert.ok(css.includes('.palette-item.active'), 'Missing active palette item style');
});

test('Command Palette: i18n keys exist for es and en', () => {
    const i18n = fs.readFileSync(path.join(ROOT_DIR, 'js', 'i18n.js'), 'utf8');
    assert.ok(i18n.includes('"tit_cmd_palette": "Paleta de Comandos (Ctrl+K)"'), 'Missing Spanish i18n');
    assert.ok(i18n.includes('"tit_cmd_palette": "Command Palette (Ctrl+K)"'), 'Missing English i18n');
});

test('Command Palette: Logic and methods exist in js/app.ui.js', () => {
    const js = fs.readFileSync(path.join(ROOT_DIR, 'js', 'app.ui.js'), 'utf8');
    assert.ok(js.includes('toggleCommandPalette: function'), 'Missing toggleCommandPalette');
    assert.ok(js.includes('openCommandPalette: function'), 'Missing openCommandPalette');
    assert.ok(js.includes('closeCommandPalette: function'), 'Missing closeCommandPalette');
    assert.ok(js.includes('filterCommandPalette: function'), 'Missing filterCommandPalette');
    assert.ok(js.includes('_getPaletteCommandList: function'), 'Missing _getPaletteCommandList');
    assert.match(js, /_executePaletteCommand:\s*(?:async\s+)?function/, 'Missing _executePaletteCommand');
});

test('Command Palette: Ctrl+K remains registered in the shortcut manager', () => {
    const manager = fs.readFileSync(path.join(ROOT_DIR, 'js', 'shortcut_manager.js'), 'utf8');
    assert.match(manager, /id: 'cmd_palette',[\s\S]*?defaultKey: 'Ctrl\+K',[\s\S]*?action: \(\) => app\.toggleCommandPalette\?\.\(\)/);
});
