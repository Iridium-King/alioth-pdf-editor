const app = window.app;
const byId = id => document.getElementById(id);
const panels = ['index-panel-sidebar', 'bookmark-panel', 'attach-panel-sidebar', 'fields-panel-sidebar', 'layers-panel-sidebar'];
const panelButtons = ['toggleSbIndex', 'toggleSbBookmark', 'toggleSbAttach', 'toggleSbFields', 'toggleSbLayers'];
const panelActions = ['toggleIndexPanel', null, 'toggleAttachPanel', 'toggleFieldsPanel', 'toggleLayersPanel'];
const stateKey = 'alioth_ui_state';
let ready = false, applying = false, mounted = false;
let saved;
try { saved = JSON.parse(localStorage.getItem(stateKey) || 'null'); } catch (_) {}
let windowPlacement = saved?.window || null;

function capture() {
    return {
        version: 1,
        split: app.splitView.mode, divider: app.splitView.dividerRatio,
        view: app.viewMode, twoUp: app.isTwoUpView, cover: app.twoUpCoverAlone,
        grid: app.showGrid, ruler: app.showRuler, guides: app.smartGuidesEnabled,
        hand: app.isHandMode, measure: app.measureMode,
        measureCalibration: app._measureCalib?.calibrated ? app._measureCalib : null,
        sidebarHidden: byId('sidebar').classList.contains('hidden'),
        downbarHidden: byId('sidebarContainer').classList.contains('hidden'),
        sidebarWidth: byId('sidebar').style.width,
        panel: panels.findIndex(id => byId(id)?.classList.contains('visible')),
        ribbon: app._currentRibbonTab,
        zoom: app.currentScale,
        window: windowPlacement,
        autoscroll: byId('autoscroll-widget')?.style.display === 'flex',
        searchOpen: byId('search-float-widget')?.classList.contains('expanded')
    };
}

function persist() {
    if (!ready || applying) return;
    const state = JSON.stringify(capture());
    if (state !== localStorage.getItem(stateKey)) localStorage.setItem(stateKey, state);
}

function syncControls() {
    document.querySelectorAll('#view-toggle-widget button').forEach(button => {
        const active = button.classList.contains('active') || button.classList.contains('active-view') || button.classList.contains('measure-active');
        button.setAttribute('aria-pressed', String(active));
    });
    panelButtons.forEach((id, index) => {
        const selected = !!byId(panels[index])?.classList.contains('visible');
        byId(id)?.classList.toggle('panel-selected', selected);
        byId(id)?.setAttribute('aria-pressed', String(selected));
    });
    syncSidebarNavigation();
    byId('btn-reading-mode')?.setAttribute('aria-pressed', String(!!app._readingMode));
    const scrolling = byId('toggleAutoScroll')?.classList.contains('active');
    byId('toggleAutoScrollReading')?.classList.toggle('active', !!scrolling);
    byId('toggleAutoScrollReading')?.setAttribute('aria-pressed', String(!!scrolling));
}

let sidebarFrame;
function syncSidebarNavigation() {
    if (sidebarFrame) return;
    sidebarFrame = requestAnimationFrame(() => {
        sidebarFrame = null;
        const sidebar = byId('sidebar'), row = byId('sidebar-panel-tabs');
        if (!sidebar || !row) return;
        const horizontal = document.body.classList.contains('h-layout');
        const target = horizontal ? byId('sidebarContainer') : row;
        for (const id of panelButtons) {
            const button = byId(id);
            if (button.parentElement !== target) target.appendChild(button);
        }
        if (horizontal || !sidebar.clientWidth) return;
        const header = sidebar.querySelector('.sidebar-header-row');
        sidebar.classList.toggle('narrow', sidebar.clientWidth < 130);
        header.classList.remove('page-count-compact');
        header.classList.toggle('page-count-compact', sidebar.clientWidth < 130 || header.scrollWidth > header.clientWidth + 1);
    });
}

function mountTabNavigation(titlebar) {
    const tabs = byId('docTabsWrapper');
    const strip = document.createElement('div');
    strip.className = 'chrome-tab-strip';
    const arrow = (direction, label, path) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chrome-tab-nav';
        button.dataset.direction = direction;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-controls', tabs.id);
        button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + path + '"/></svg>';
        button.addEventListener('click', () => tabs.scrollBy({ left: direction * Math.max(120, tabs.clientWidth * .7), behavior: 'smooth' }));
        return button;
    };
    const previous = arrow(-1, 'Desplazar pestañas a la izquierda', 'm10 3-5 5 5 5');
    const next = arrow(1, 'Desplazar pestañas a la derecha', 'm6 3 5 5-5 5');
    titlebar.insertBefore(strip, titlebar.querySelector('.chrome-drag-space'));
    strip.append(previous, tabs, next);
    let scheduled = false;
    const sync = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            previous.disabled = tabs.scrollLeft <= 1;
            next.disabled = tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 1;
        });
    };
    tabs.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(tabs);
    new MutationObserver(sync).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync();
}

function mount() {
    if (mounted) return;
    mounted = true;
    document.body.classList.add('compact-chrome');
    const titlebar = document.createElement('div');
    titlebar.className = 'app-titlebar';
    titlebar.innerHTML = '<div class="chrome-brand"><img src="favicon.ico" alt=""><span>ALIOTH PDF EDITOR</span></div><div class="chrome-drag-space"></div><div class="chrome-window-controls" hidden><button type="button" data-window="minimize" aria-label="Minimizar"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5h11"/></svg></button><button type="button" data-window="toggle-maximize" aria-label="Maximizar"><svg viewBox="0 0 16 16" aria-hidden="true"><rect class="chrome-maximize-glyph" x="3" y="3" width="10" height="10" rx=".5"/><g class="chrome-restore-glyph"><path d="M5.5 5.5V2.5h8v8h-3"/><rect x="2.5" y="5.5" width="8" height="8" rx=".5"/></g></svg></button><button type="button" data-window="close" aria-label="Cerrar ventana"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M3 13 13 3"/></svg></button></div>';
    document.querySelector('.app-header').before(titlebar);
    mountTabNavigation(titlebar);
    const search = document.querySelector('.command-palette-trigger-btn');
    search.parentElement.classList.add('chrome-search-tools');
    for (const id of ['darkToggle', 'themeBtn', 'preferencesBtn']) search.parentElement.appendChild(byId(id));
    const toggles = document.querySelector('.links-bar-right');
    toggles.id = 'view-toggle-widget';
    byId('ribbon-capsule-wrapper').appendChild(toggles);
    for (const button of document.querySelectorAll('.header-right .header-btn:not(.btn-danger)')) {
        button.classList.add('chrome-file-button');
        button.setAttribute('aria-label', button.title);
        for (const node of [...button.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
    }
    byId('btn-header-save-as').querySelector('svg').outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v4M7 3v6h9V3M7 21v-7h5"/><path d="m14 18 6-6 3 3-6 6-4 1zM19 13l3 3"/></svg>';
    panelButtons.forEach(id => {
        const button = byId(id);
        button.setAttribute('role', 'button');
        button.setAttribute('aria-controls', panels[panelButtons.indexOf(id)]);
        button.tabIndex = 0;
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
        });
    });
    byId('toggleSb').setAttribute('role', 'button');
    byId('toggleSb').tabIndex = 0;
    byId('toggleSb').addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); app.toggleSidebar(); }
    });
    const observer = new MutationObserver(() => { syncControls(); persist(); });
    const observed = [byId('sidebar'), byId('sidebarContainer'), byId('view-toggle-widget'), byId('autoscroll-widget'), byId('search-float-widget'), ...panels.map(byId)];
    observed.filter(Boolean).forEach(element => observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'], subtree: element.id === 'view-toggle-widget' }));
    new ResizeObserver(syncSidebarNavigation).observe(byId('sidebar'));
    new MutationObserver(syncSidebarNavigation).observe(byId('pageCountDisplay'), { childList: true, subtree: true });
    document.fonts?.addEventListener('loadingdone', syncSidebarNavigation);
    app.setPageCount(byId('pageCountDisplay').textContent);
    syncControls();
    initNativeChrome(titlebar);
}

async function initNativeChrome(titlebar) {
    if (!window.chrome?.webview) {
        document.body.classList.add('browser-chrome');
        return;
    }
    const pending = new Map();
    let sequence = 0;
    window.chrome.webview.addEventListener('message', event => {
        if (event.data.channel !== 'alioth-window') return;
        const resolve = pending.get(event.data.id);
        if (resolve) { pending.delete(event.data.id); resolve(event.data); }
    });
    const request = (action, body) => new Promise(resolve => {
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); resolve(null); }, 5000);
        pending.set(id, value => { clearTimeout(timer); resolve(value); });
        window.chrome.webview.postMessage({ channel: 'alioth-window', id, action, body, edge: body?.edge });
    });
    const result = await request('init-frameless');
    if (!result?.ok) return;
    document.body.classList.add('native-chrome');
    titlebar.querySelector('.chrome-window-controls').hidden = false;
    const maximize = titlebar.querySelector('[data-window="toggle-maximize"]');
    const update = state => {
        if (!state?.ok) return;
        if (state.placement) windowPlacement = state.placement;
        maximize.setAttribute('aria-label', state.is_maximized ? 'Restaurar' : 'Maximizar');
        maximize.title = maximize.getAttribute('aria-label');
        maximize.classList.toggle('is-maximized', state.is_maximized);
    };
    update(result);
    if (saved?.window) update(await request('restore-placement', saved.window));
    titlebar.addEventListener('click', async event => {
        const button = event.target.closest('[data-window]');
        if (!button) return;
        persist();
        update(await request(button.dataset.window));
    });
    const dragArea = event => !event.target.closest('button,.doc-tab,.doc-tab-add,input,[contenteditable="true"]');
    let start;
    titlebar.addEventListener('pointerdown', event => {
        if (event.button === 0 && dragArea(event)) start = { x: event.screenX, y: event.screenY };
    });
    titlebar.addEventListener('pointermove', event => {
        if (start && event.buttons === 1 && Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4) {
            start = null;
            request('drag');
        }
    });
    window.addEventListener('pointerup', () => { start = null; });
    titlebar.addEventListener('dblclick', async event => { if (dragArea(event)) update(await request('toggle-maximize')); });
    window.addEventListener('pointerdown', event => {
        if (event.button !== 0 || maximize.classList.contains('is-maximized')) return;
        const left = event.clientX <= 4, right = event.clientX >= innerWidth - 4;
        const top = event.clientY <= 4, bottom = event.clientY >= innerHeight - 4;
        const edge = top ? (left ? 13 : right ? 14 : 12) : bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 0;
        if (edge) { event.preventDefault(); event.stopPropagation(); request('resize', { edge }); }
    }, true);
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(async () => { update(await request('state')); persist(); }, 150);
    });
}

function restore() {
    if (!saved || saved.version !== 1) return;
    applying = true;
    try {
        if (['single', 'horizontal', 'vertical'].includes(saved.split) && app.splitView.mode !== saved.split) app.setSplitView(saved.split);
        if (Number.isFinite(saved.divider) && saved.divider > 0.1 && saved.divider < 0.9) {
            app.splitView.dividerRatio = saved.divider;
            app.applySplitRatio();
        }
        if (['single', 'continuous'].includes(saved.view) && saved.view !== app.viewMode) app.toggleViewMode();
        if (typeof saved.twoUp === 'boolean' && app.isTwoUpView !== saved.twoUp) app.toggleTwoUpView(saved.twoUp);
        if (typeof saved.cover === 'boolean') app.twoUpCoverAlone = saved.cover;
        const calibration = saved.measureCalibration;
        if (calibration?.calibrated && Number.isFinite(calibration.pxPerUnit) && calibration.pxPerUnit > 0 &&
            ['page', 'scale', 'known'].includes(calibration.mode) && ['cm', 'mm', 'm', 'in', 'ft', 'pt'].includes(calibration.unit)) {
            app._measureCalib = { ...calibration, _calibrating: false };
        }
        for (const [key, property, action] of [
            ['grid', 'showGrid', 'toggleGrid'], ['ruler', 'showRuler', 'toggleRuler'],
            ['guides', 'smartGuidesEnabled', 'toggleSmartGuides'], ['hand', 'isHandMode', 'toggleHandMode'],
            ['measure', 'measureMode', 'toggleMeasure']
        ]) if (typeof saved[key] === 'boolean' && !!app[property] !== saved[key] &&
            (key !== 'measure' || !saved[key] || app._measureCalib?.calibrated)) app[action]();
        if (typeof saved.sidebarWidth === 'string' && /^\d+(\.\d+)?px$/.test(saved.sidebarWidth)) {
            const width = Math.min(400, Math.max(100, parseFloat(saved.sidebarWidth)));
            byId('sidebar').style.width = width + 'px';
            byId('sidebar').classList.toggle('narrow', width < 130);
        }
        if (Number.isInteger(saved.panel) && saved.panel >= 0 && saved.panel < panels.length && !byId(panels[saved.panel]).classList.contains('visible')) {
            if (saved.panel === 1) window.BookmarkManager.togglePanel();
            else app[panelActions[saved.panel]]();
        }
        const horizontal = document.body.classList.contains('h-layout');
        const hidden = byId(horizontal ? 'sidebarContainer' : 'sidebar').classList.contains('hidden');
        const wanted = horizontal ? saved.downbarHidden : saved.sidebarHidden;
        if (typeof wanted === 'boolean' && hidden !== wanted) app.toggleSidebar();
        if (typeof saved.ribbon === 'string' && byId('tab-btn-' + saved.ribbon) && !app._readingMode) app.switchRibbon(saved.ribbon);
        if (saved.autoscroll && byId('autoscroll-widget')?.style.display !== 'flex') app.toggleAutoScrollWidget();
        if (saved.searchOpen) app.expandSearchWidget?.();
        if (!app.getDoc()?.pages?.length && Number.isFinite(saved.zoom) && saved.zoom >= .2 && saved.zoom <= 5) {
            app.zoom(saved.zoom - app.currentScale);
        }
    } finally {
        applying = false;
        syncControls();
    }
}

const originalInit = app.init;
app.init = async function (...args) {
    const result = await originalInit.apply(this, args);
    mount();
    restore();
    ready = true;
    for (const name of ['toggleReadingMode', 'toggleGrid', 'toggleRuler', 'toggleSmartGuides', 'toggleHandMode', 'toggleMeasure', 'setSplitView', 'toggleViewMode', 'toggleTwoUpView', 'toggleTwoUpCoverAlone', 'setHorizontalLayout', 'toggleSidebar', 'switchRibbon', 'toggleAutoScrollWidget', 'zoom']) {
        const original = app[name];
        if (typeof original !== 'function') continue;
        app[name] = function (...parameters) {
            const value = original.apply(this, parameters);
            syncControls();
            persist();
            return value;
        };
    }
    window.addEventListener('pagehide', persist);
    window.addEventListener('alioth:before-close', persist);
    document.addEventListener('pointerup', () => { persist(); });
    window.dispatchEvent(new Event('app:interface-ready'));
    return result;
};

document.addEventListener('DOMContentLoaded', mount, { once: true });
