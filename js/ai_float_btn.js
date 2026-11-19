(function () {
    const btn = document.getElementById('ai-floating-btn');
    if (!btn) return;
    btn.addEventListener('click', () => app.toggleAIPanel());
    const search = document.getElementById('search-float-widget');
    const zoom = document.getElementById('zoom-float-widget');
    const reading = document.getElementById('reading-mode-float-widget');
    const viewer = document.getElementById('splitContainer');
    const voice = document.getElementById('tts-widget');
    const ribbonWrapper = document.getElementById('ribbon-capsule-wrapper');
    const scroll = document.getElementById('autoscroll-widget');
    const sidePanels = ['index-panel-sidebar', 'bookmark-panel', 'attach-panel-sidebar', 'fields-panel-sidebar', 'layers-panel-sidebar']
        .map(id => document.getElementById(id)).filter(Boolean);

    function positionViewerWidgets(view, bottom) {
        const center = view.left + view.width / 2;
        const panelBounds = sidePanels.map(panel => panel.getBoundingClientRect())
            .filter(rect => rect.width && rect.height && rect.right > view.left);
        const availableLeft = (top, bottom) => Math.max(view.left, ...panelBounds
            .filter(rect => rect.top < bottom && rect.bottom > top).map(rect => rect.right));

        if (voice && ribbonWrapper) {
            const anchor = ribbonWrapper.getBoundingClientRect();
            const left = availableLeft(anchor.bottom, view.bottom);
            voice.style.setProperty('--tts-view-center', ((left + view.right) / 2 - anchor.left) + 'px');
            voice.style.setProperty('--tts-view-width', (view.right - left) + 'px');
        }
        if (scroll) {
            scroll.style.setProperty('--viewer-widget-bottom', bottom + 'px');
            const bounds = scroll.getBoundingClientRect();
            if (bounds.height) {
                const left = availableLeft(bounds.top, bounds.bottom);
                // Shorten the slider first so Auto can stay centered beside a panel.
                const centeredWidth = Math.max(224, 2 * (center - left));
                scroll.style.setProperty('--autoscroll-view-width', Math.min(centeredWidth, view.right - left) + 'px');
                const inset = scroll.offsetWidth / 2 + 8;
                const position = Math.max(left + inset, Math.min(center, view.right - inset));
                scroll.style.setProperty('--autoscroll-center', position + 'px');
            }
        }
    }

    function syncPosition() {
        if (zoom && viewer) {
            const view = viewer.getBoundingClientRect();
            const bottom = Math.max(0, window.innerHeight - view.bottom);
            zoom.style.setProperty('--zoom-anchor-x', (view.left + view.width / 2) + 'px');
            zoom.style.setProperty('--viewer-widget-bottom', bottom + 'px');
            zoom.style.setProperty('--zoom-view-width', view.width + 'px');
            if (reading) {
                reading.style.setProperty('--viewer-widget-bottom', bottom + 'px');
                reading.style.setProperty('--reading-view-right', Math.max(0, window.innerWidth - view.right) + 'px');
                const expandedZoomWidth = parseFloat(getComputedStyle(zoom).maxWidth);
                reading.classList.toggle('above-zoom', view.width < expandedZoomWidth + 2 * (reading.offsetWidth + 20));
            }
            positionViewerWidgets(view, bottom);
        }
        const visibleRect = (id, includeHidden = false) => {
            const element = document.getElementById(id);
            if (!element) return null;
            const style = getComputedStyle(element);
            if (style.display === 'none' || (!includeHidden && style.visibility === 'hidden')) return null;
            const rect = element.getBoundingClientRect();
            return rect.width && rect.height ? rect : null;
        };
        let rect = btn.getBoundingClientRect();
        const topBtn = document.getElementById('ai-nav-btn-top');
        const bottomBtn = document.getElementById('ai-nav-btn-bottom');
        if (!topBtn || !bottomBtn) return;
        const topSize = topBtn.getBoundingClientRect().height || 25;
        const bottomSize = bottomBtn.getBoundingClientRect().height || 25;
        const overlaps = box => box && box.left < rect.right && box.right > rect.left;
        const ribbon = visibleRect('ribbonContainer'), toggles = visibleRect('view-toggle-widget');
        const upper = Math.max(ribbon?.bottom || 0, overlaps(toggles) ? toggles.bottom : 0);
        // Keep the zoom's space reserved while Auto temporarily hides it.
        const obstacles = [visibleRect('reading-mode-float-widget'), visibleRect('zoom-float-widget', true)]
            .filter(overlaps).map(box => box.top).filter(top => top > upper);
        const lower = Math.min(window.innerHeight, ...obstacles);
        const min = upper + topSize + 8;
        const max = Math.max(min, lower - rect.height - bottomSize - 8);
        const top = Math.max(min, Math.min(max, (window.innerHeight - rect.height) / 2));
        if (btn.style.transform !== 'none' || Math.abs(top - rect.top) > .5) {
            btn.style.transform = 'none';
            btn.style.top = top + 'px';
            btn.style.bottom = 'auto';
            rect = btn.getBoundingClientRect();
        }
        if (search) {
            search.style.setProperty('--search-widget-right', (window.innerWidth - rect.left + 2) + 'px');
            search.style.setProperty('--search-widget-center', (rect.top + rect.height / 2) + 'px');
        }
        topBtn.style.transform = bottomBtn.style.transform = 'none';
        topBtn.style.top = (rect.top - 4 - topSize) + 'px';
        bottomBtn.style.top = (rect.bottom + 4) + 'px';
        for (const arrow of [topBtn, bottomBtn]) {
            arrow.style.right = Math.max(0, window.innerWidth - rect.left - rect.width / 2 - arrow.getBoundingClientRect().width / 2) + 'px';
        }
    }

    let positionFrame;
    const movingAnchors = new Set();
    function schedulePosition() {
        if (positionFrame) return;
        positionFrame = requestAnimationFrame(() => {
            positionFrame = null;
            syncPosition();
            if (movingAnchors.size) schedulePosition();
        });
    }
    function syncDockTransition(event) {
        const anchor = event.currentTarget;
        if (event.target !== anchor || event.propertyName !== (anchor === btn ? 'right' : 'transform')) return;
        if (event.type === 'transitionrun') movingAnchors.add(anchor);
        else movingAnchors.delete(anchor);
        schedulePosition();
    }
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel']) {
        btn.addEventListener(event, syncDockTransition);
        for (const panel of sidePanels) panel.addEventListener(event, syncDockTransition);
    }
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(schedulePosition);
        for (const id of ['ai-floating-btn', 'ribbonContainer', 'reading-mode-float-widget', 'zoom-float-widget', 'autoscroll-widget', 'splitContainer']) {
            const element = document.getElementById(id);
            if (element) observer.observe(element);
        }
    }
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(schedulePosition);
        observer.observe(btn, { attributes: true, attributeFilter: ['style', 'class'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        for (const panel of sidePanels) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('app:interface-ready', schedulePosition);
    window.addEventListener('app:dock-layout', schedulePosition);
    schedulePosition();
})();
