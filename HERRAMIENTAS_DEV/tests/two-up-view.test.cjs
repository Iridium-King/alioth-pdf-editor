const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseHtmlPath = path.resolve(__dirname, '../../BASE.html');
const appCssPath = path.resolve(__dirname, '../../css/app.css');
const appCorePath = path.resolve(__dirname, '../../js/app.core.js');
const appRenderPath = path.resolve(__dirname, '../../js/app.render.js');
const appUiPath = path.resolve(__dirname, '../../js/app.ui.js');
const zoomWidgetPath = path.resolve(__dirname, '../../js/zoom_widget.js');
const i18nPath = path.resolve(__dirname, '../../js/i18n.js');

test('Two-Up View: Markup in BASE.html and styles in css/app.css exist', () => {
    const html = fs.readFileSync(baseHtmlPath, 'utf8');
    const css = fs.readFileSync(appCssPath, 'utf8');

    assert.ok(html.includes('id="toggleTwoUp"'), 'toggleTwoUp button must exist in BASE.html');
    assert.ok(html.includes('app.toggleTwoUpView()'), 'toggleTwoUp must trigger app.toggleTwoUpView()');
    assert.ok(html.includes('data-i18n-title="tit_two_up_view"'), 'toggleTwoUp must reference tit_two_up_view');

    assert.ok(css.includes('.scroll-stack.two-up-grid'), 'two-up-grid class must exist in css/app.css');
    assert.ok(css.includes('two-up-cover-standalone'), 'two-up-cover-standalone class must exist in css/app.css');
});

test('Two-Up View: State and keyboard navigation in app.core.js', () => {
    const core = fs.readFileSync(appCorePath, 'utf8');

    assert.ok(core.includes('isTwoUpView: false'), 'app.core.js must initialize isTwoUpView');
    assert.ok(core.includes('twoUpCoverAlone: true'), 'app.core.js must initialize twoUpCoverAlone');
    assert.ok(core.includes('if (this.isTwoUpView)'), 'Keyboard arrow handlers must check isTwoUpView');
});

test('Two-Up View: Methods and layout integration in app.render.js', () => {
    const render = fs.readFileSync(appRenderPath, 'utf8');

    assert.ok(render.includes('toggleTwoUpView: function'), 'toggleTwoUpView must be defined in app.render.js');
    assert.ok(render.includes('toggleTwoUpCoverAlone: function'), 'toggleTwoUpCoverAlone must be defined in app.render.js');
    assert.ok(render.includes('fitToWidth: function'), 'fitToWidth must be defined in app.render.js');
    assert.ok(render.includes('const _isTwoUp = !!this.isTwoUpView && !_isHLayout;'), '_isTwoUp check must exist in renderContinuousContent');
    assert.ok(render.includes('stack.classList.add(\'two-up-grid\')'), 'two-up-grid must be added to stack');
    assert.ok(render.includes('two-up-cover-standalone'), 'standalone cover must be assigned');
});

test('Two-Up View: Zoom widget adjusts width for 2-page spread', () => {
    const zoom = fs.readFileSync(zoomWidgetPath, 'utf8');

    assert.ok(zoom.includes('app.isTwoUpView'), 'zoom_widget.js must check app.isTwoUpView');
    assert.ok(zoom.includes('actualWidth * 2 + 24'), 'zoom_widget.js must calculate spread width');
});

test('Two-Up View: Command Palette and i18n are registered', () => {
    const ui = fs.readFileSync(appUiPath, 'utf8');
    const i18n = fs.readFileSync(i18nPath, 'utf8');

    assert.ok(ui.includes('id: \'view_twoup\''), 'view_twoup must be registered in Command Palette');
    assert.ok(ui.includes('id: \'view_twoup_cover\''), 'view_twoup_cover must be registered in Command Palette');
    assert.ok(i18n.includes('"tit_two_up_view": "Vista de Dos Páginas (Modo Libro)"'), 'ES i18n key must exist');
    assert.ok(i18n.includes('"tit_two_up_view": "Two-Page View (Book Mode)"'), 'EN i18n key must exist');
});
