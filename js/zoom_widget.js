(function () {
    function initZoomWidget() {
        const widget = document.getElementById('zoom-float-widget');
        const slider = document.getElementById('zoomSlider');
        const input = document.getElementById('zoomInput');
        if (!widget || !slider || !input) return;

        const extraControls = widget.querySelectorAll('.zoom-extra');
        let hovered = false;
        let fitRequest = 0;

        function syncExpansion() {
            const expanded = hovered || document.activeElement === input || !!widget.querySelector(':focus-visible');
            widget.classList.toggle('expanded', expanded);
            for (const group of extraControls) group.inert = !expanded;
        }

        widget.addEventListener('pointerenter', (event) => {
            if (event.pointerType === 'touch') return;
            hovered = true;
            syncExpansion();
        });
        widget.addEventListener('pointerleave', () => {
            hovered = false;
            syncExpansion();
        });
        widget.addEventListener('focusin', syncExpansion);
        widget.addEventListener('focusout', () => queueMicrotask(syncExpansion));
        widget.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'touch' || event.target.closest('button, input')) return;
            input.focus({ preventScroll: true });
        });

        function changeZoom(delta) {
            fitRequest++;
            app.zoom(delta);
        }

        slider.addEventListener('input', () => changeZoom(Number(slider.value) / 100 - app.currentScale));
        input.addEventListener('focus', () => input.select());
        input.addEventListener('change', () => {
            const raw = input.value.trim().replace(/%$/, '').trim().replace(',', '.');
            const pct = Number(raw);
            if (raw && Number.isFinite(pct) && pct > 0) changeZoom(pct / 100 - app.currentScale);
            input.value = Math.round(app.currentScale * 100) + '%';
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') input.value = Math.round(app.currentScale * 100) + '%';
                input.blur();
            }
        });

        document.getElementById('zoomBtnPlus').addEventListener('click', () => changeZoom(0.1));
        document.getElementById('zoomBtnMinus').addEventListener('click', () => changeZoom(-0.1));
        document.getElementById('zoomBtnFit').addEventListener('click', () => fitPage(false));
        document.getElementById('zoomBtnReset').addEventListener('click', () => fitPage(true));

        async function pageSize(doc, record) {
            if (record.canvas) return { width: record.canvas.width, height: record.canvas.height };
            const source = doc.sources[record.sourceId];
            const rotation = record.rotation || 0;
            if (source && !record._blank) {
                const pdf = await app.loadSourcePdf(source);
                const page = await pdf.getPage(record.pageIndex + 1);
                return page.getViewport({ scale: 1, rotation: page.rotate + rotation });
            }
            const width = record.width || 612;
            const height = record.height || 792;
            return Math.abs(rotation % 180) === 90 ? { width: height, height: width } : { width, height };
        }

        async function fitPage(fullPage) {
            const request = ++fitRequest;
            const panelId = app.splitView.activePanel;
            const state = app.splitView[panelId];
            const doc = app.getDoc();
            const index = state.pageIndex ?? doc?.currentIndex;
            const record = doc?.pages[index];
            const { mainView, canvasContainer } = app.getPanelElements(panelId);
            if (!record || !mainView?.clientWidth || !mainView.clientHeight) return;

            const horizontal = document.body.classList.contains('h-layout');
            const continuous = app.viewMode === 'continuous';
            const cover = app.twoUpCoverAlone ? 1 : 0;
            const spread = continuous && !horizontal && app.isTwoUpView && index >= cover;
            const partner = spread ? index + ((index - cover) % 2 === 0 ? 1 : -1) : -1;
            const otherIndex = partner >= 0 && doc.pages[partner] ? partner : -1;
            const current = () => request === fitRequest && app.getDoc() === doc
                && panelId === app.splitView.activePanel && (state.pageIndex ?? doc.currentIndex) === index
                && doc.pages[index] === record;
            let size, otherSize;
            try {
                [size, otherSize] = await Promise.all([
                    pageSize(doc, record),
                    otherIndex >= 0 ? pageSize(doc, doc.pages[otherIndex]) : null
                ]);
            } catch (error) {
                console.warn('No se pudo medir la página para ajustar el zoom.', error);
                return;
            }
            if (!current()) return;

            const wrapper = pageIndex => document.getElementById(`page-wrapper-${panelId}-${pageIndex}`);
            const target = () => continuous ? wrapper(index) : canvasContainer;
            const before = target()?.getBoundingClientRect();
            const beforeView = mainView.getBoundingClientRect();
            const yRatio = before?.height
                ? Math.max(0.02, Math.min(0.98, (beforeView.top + mainView.clientHeight / 2 - before.top) / before.height))
                : 0.5;
            const sideMargin = document.getElementById('ai-floating-btn')?.getBoundingClientRect().width || 1;
            if (!fullPage) mainView.style.setProperty('--fit-width-margin', sideMargin + 'px');
            mainView.classList.toggle('fit-width', !fullPage);
            const view = mainView.getBoundingClientRect();
            const capsule = widget.getBoundingClientRect();
            const padding = getComputedStyle(mainView);
            const left = parseFloat(padding.paddingLeft);
            const right = parseFloat(padding.paddingRight);
            const top = continuous ? 12 : parseFloat(padding.paddingTop);
            const bottom = Math.max(parseFloat(padding.paddingBottom),
                view.left < capsule.right && view.right > capsule.left ? view.bottom - capsule.top + 3 : 0);
            const stack = continuous ? mainView.querySelector('.scroll-stack') : null;
            const stackStyle = stack && getComputedStyle(stack);
            const gap = otherSize ? parseFloat(stackStyle?.columnGap) || 0 : 0;
            const stackPaddingX = stackStyle && !horizontal
                ? parseFloat(stackStyle.paddingLeft) + parseFloat(stackStyle.paddingRight) : 0;
            const horizontalSpace = fullPage ? left + right + stackPaddingX + 2 : sideMargin * 2;
            const width = mainView.clientWidth - horizontalSpace - gap;
            const height = mainView.clientHeight - top - bottom - 2;
            const widthScale = width / (size.width + (otherSize?.width || 0));
            const scale = fullPage ? Math.min(widthScale, height / Math.max(size.height, otherSize?.height || 0)) : widthScale;

            function framePage() {
                if (!current()) return;
                const page = target()?.getBoundingClientRect();
                if (!page?.height) return;
                const other = otherIndex >= 0 ? wrapper(otherIndex)?.getBoundingClientRect() : null;
                const centerX = (Math.min(page.left, other?.left ?? page.left) + Math.max(page.right, other?.right ?? page.right)) / 2;
                const centerY = (Math.min(page.top, other?.top ?? page.top) + Math.max(page.bottom, other?.bottom ?? page.bottom)) / 2;
                const viewport = mainView.getBoundingClientRect();
                mainView.scrollTo({
                    left: mainView.scrollLeft + centerX - viewport.left - mainView.clientWidth / 2,
                    top: mainView.scrollTop + (fullPage
                        ? centerY - viewport.top - (mainView.clientHeight + top - bottom) / 2
                        : page.top + page.height * yRatio - viewport.top - mainView.clientHeight / 2),
                    behavior: 'instant'
                });
            }

            if (Number.isFinite(scale) && scale > 0) app.zoomPanel(scale - state.scale, panelId, null, framePage);
        }
    }

    if (window.__appReady) initZoomWidget();
    else window.addEventListener('app:ready', initZoomWidget, { once: true });
})();
