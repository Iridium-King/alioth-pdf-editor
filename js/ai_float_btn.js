(function () {
    const btn = document.getElementById('ai-floating-btn');
    if (!btn) return;
    btn.addEventListener('click', () => app.toggleAIPanel());

    function syncPosition() {
        const visibleRect = id => {
            const element = document.getElementById(id);
            if (!element || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden') return null;
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
        const obstacles = ['reading-mode-float-widget', 'zoom-float-widget'].map(visibleRect).filter(box => overlaps(box) && box.top > upper);
        const lower = Math.min(window.innerHeight, ...obstacles.map(box => box.top));
        const min = upper + topSize + 8;
        const max = Math.max(min, lower - rect.height - bottomSize - 8);
        const top = Math.max(min, Math.min(max, (window.innerHeight - rect.height) / 2));
        if (btn.style.transform !== 'none' || Math.abs(top - rect.top) > .5) {
            btn.style.transform = 'none';
            btn.style.top = top + 'px';
            btn.style.bottom = 'auto';
            rect = btn.getBoundingClientRect();
        }
        topBtn.style.transform = bottomBtn.style.transform = 'none';
        topBtn.style.top = (rect.top - 4 - topSize) + 'px';
        bottomBtn.style.top = (rect.bottom + 4) + 'px';
        for (const arrow of [topBtn, bottomBtn]) {
            arrow.style.right = Math.max(0, window.innerWidth - rect.left - rect.width / 2 - arrow.getBoundingClientRect().width / 2) + 'px';
        }
    }

    let positionFrame;
    function schedulePosition() {
        if (positionFrame) return;
        positionFrame = requestAnimationFrame(() => { positionFrame = null; syncPosition(); });
    }
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(schedulePosition);
        for (const id of ['ai-floating-btn', 'ribbonContainer', 'reading-mode-float-widget', 'zoom-float-widget']) {
            const element = document.getElementById(id);
            if (element) observer.observe(element);
        }
    }
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(schedulePosition);
        observer.observe(btn, { attributes: true, attributeFilter: ['style', 'class'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('app:interface-ready', schedulePosition);
    window.addEventListener('app:dock-layout', schedulePosition);
    schedulePosition();
})();
