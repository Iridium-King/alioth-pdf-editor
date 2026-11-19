const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('Two-Up View: Fit width uses the actual spread sizes, leaving the cover on its own', async () => {
    const listeners = new Map();
    const stack = {};
    const bounds = { left: 0, right: 1000, top: 0, bottom: 800 };
    let fitWidthLayout = false;
    const mainView = {
        clientWidth: 1000,
        clientHeight: 800,
        style: { setProperty() {} },
        classList: { toggle: (name, enabled) => { if (name === 'fit-width') fitWidthLayout = enabled; } },
        getBoundingClientRect: () => bounds,
        querySelector: () => stack
    };
    const doc = {
        sources: {},
        pages: [{ width: 500 }, { width: 600 }, { width: 300, height: 400, rotation: 90 }]
    };
    const state = { pageIndex: 1, scale: 1 };
    let searchBounds;
    const search = { getBoundingClientRect: () => searchBounds };
    let aiTabWidth = 28;
    const aiTab = { getBoundingClientRect: () => ({ width: aiTabWidth }) };
    let scale;
    const app = {
        splitView: { activePanel: 'primary', primary: state },
        viewMode: 'continuous',
        isTwoUpView: true,
        twoUpCoverAlone: true,
        getDoc: () => doc,
        getPanelElements: () => ({ mainView }),
        zoomPanel: delta => { scale = state.scale + delta; }
    };
    const document = {
        body: { classList: { contains: () => false } },
        getElementById: id => {
            if (id === 'ai-floating-btn') return aiTab;
            if (id === 'search-float-widget') return searchBounds ? search : null;
            return {
                addEventListener: (event, listener) => listeners.set(id + ':' + event, listener),
                getBoundingClientRect: () => ({ left: 450, right: 550, top: 750 }),
                querySelectorAll: () => []
            };
        }
    };
    function getComputedStyle(element) {
        if (element === search) return { getPropertyValue: () => '27px' };
        return element === stack
            ? { paddingLeft: '20px', paddingRight: '20px', columnGap: '24px' }
            : { paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px' };
    }
    vm.runInNewContext(fs.readFileSync(zoomWidgetPath, 'utf8'), {
        window: { __appReady: true }, document, app, getComputedStyle
    });

    const fit = listeners.get('zoomBtnFit:click');
    await fit();
    assert.equal(fitWidthLayout, true);
    assert.equal(scale, (1000 - 2 * aiTabWidth - 24) / (600 + 400));
    state.pageIndex = 0;
    await fit();
    assert.equal(scale, (1000 - 2 * aiTabWidth) / 500);

    searchBounds = { left: 880, right: 907, width: 27, top: 300, bottom: 327 };
    await fit();
    assert.equal(scale, (1000 - 2 * aiTabWidth) / 500);
    searchBounds = { ...searchBounds, left: 550, width: 357 };
    await fit();
    assert.equal(scale, (1000 - 2 * aiTabWidth) / 500);

    aiTabWidth = 34;
    await fit();
    assert.equal(scale, (1000 - 2 * aiTabWidth) / 500);
    await listeners.get('zoomBtnReset:click')();
    assert.equal(fitWidthLayout, false);
    assert.equal(scale, (800 - 12 - 53 - 2) / 792);
});

test('Two-Up View: Command Palette and i18n are registered', () => {
    const ui = fs.readFileSync(appUiPath, 'utf8');
    const i18n = fs.readFileSync(i18nPath, 'utf8');

    assert.ok(ui.includes('id: \'view_twoup\''), 'view_twoup must be registered in Command Palette');
    assert.ok(ui.includes('id: \'view_twoup_cover\''), 'view_twoup_cover must be registered in Command Palette');
    assert.ok(i18n.includes('"tit_two_up_view": "Vista de Dos Páginas (Modo Libro)"'), 'ES i18n key must exist');
    assert.ok(i18n.includes('"tit_two_up_view": "Two-Page View (Book Mode)"'), 'EN i18n key must exist');
});
