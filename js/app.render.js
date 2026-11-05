// app.render.js
// Extiende el objeto global `app` con métodos de render
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            loadSourcePdf: function (source) {
                if (source.doc) return Promise.resolve(source.doc);
                if (source._pdfLoadingPromise) return source._pdfLoadingPromise;
                const buffer = source.buffer;
                if (!buffer) return Promise.reject(new Error('PDF_SOURCE_CLOSED'));
                const task = pdfjsLib.getDocument({ data: buffer.slice(0) });
                source._pdfLoadingTask = task;
                const pending = task.promise.then(pdf => {
                    if (source.buffer !== buffer || source._pdfLoadingTask !== task) {
                        pdf.destroy()?.catch?.(() => {});
                        throw new Error('PDF_SOURCE_CHANGED');
                    }
                    source.doc = pdf;
                    return pdf;
                }).finally(() => {
                    if (source._pdfLoadingTask === task) {
                        delete source._pdfLoadingTask;
                        delete source._pdfLoadingPromise;
                    }
                });
                source._pdfLoadingPromise = pending;
                return pending;
            },

            releasePdfSource: function (source) {
                try { source._pdfLoadingTask?.destroy?.()?.catch?.(() => {}); } catch (_) {}
                try { source.doc?.destroy?.()?.catch?.(() => {}); } catch (_) {}
                source.doc = null;
                delete source._pdfLoadingTask;
                delete source._pdfLoadingPromise;
            },

            releaseBackgroundCanvas: function (canvas) {
                canvas._renderRequestToken = null;
                try { canvas._activeRenderTask?.cancel(); } catch (_) {}
                canvas._activeRenderTask = null;
                canvas._renderPromise = null;
                canvas._renderedSessionToken = null;
                canvas._renderedScale = null;
                canvas._pdfPage = null;
                canvas._pdfViewport = null;
                canvas.width = canvas.height = 0;
            },

            releasePageThumbnail: function (page) {
                const entry = this._thumbnailCache?.get(page);
                if (entry) {
                    this._thumbnailBytes -= entry.bytes;
                    this._thumbnailCache.delete(page);
                }
                try { (entry?.bitmap || page?._thumbCache)?.close?.(); } catch (_) {}
                if (page) { page._thumbCache = null; page._thumbCacheObjects = undefined; }
            },

            releaseDocumentThumbnails: function (doc) {
                for (const page of doc?.pages || []) this.releasePageThumbnail(page);
            },

            cacheThumbnail: function (page, bitmap, objects, doc) {
                this.releasePageThumbnail(page);
                const bytes = bitmap.width * bitmap.height * 4;
                const limit = 16 * 1024 * 1024;
                if (bytes > limit || (doc && (!this.docs.includes(doc) || !doc.pages.includes(page)))) {
                    bitmap.close();
                    return;
                }
                if (!this._thumbnailCache) this._thumbnailCache = new Map();
                this._thumbnailBytes = (this._thumbnailBytes || 0) + bytes;
                this._thumbnailCache.set(page, { bitmap, bytes });
                page._thumbCache = bitmap;
                page._thumbCacheObjects = objects;
                while (this._thumbnailBytes > limit) this.releasePageThumbnail(this._thumbnailCache.keys().next().value);
            },

            _getFormFieldPreviewFontSize: function (field, scale = 1, value = '', input = null) {
                const fixedSize = Number(field?.fontSize);
                if (!field?.autoSize && fixedSize > 0) return fixedSize * scale;

                const text = String(value ?? field?.textValue ?? field?.value ?? '');
                let availableWidth = Math.max(1, (Number(field?.width) || 80) * scale);
                let availableHeight = Math.max(1, (Number(field?.height) || 20) * scale);
                if (input) {
                    if (Number(input.clientWidth) > 0) availableWidth = input.clientWidth;
                    if (Number(input.clientHeight) > 0) availableHeight = input.clientHeight;
                    try {
                        const style = window.getComputedStyle(input);
                        availableWidth -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
                        availableHeight -= (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
                    } catch (_) { }
                } else {
                    const border = Math.max(0, Number(field?.borderWidth) || 0) * scale;
                    availableWidth -= border * 2 + 4;
                    availableHeight -= border * 2 + 4;
                }
                if (field?.fieldType === 'dropdown' || field?.fieldType === 'Ch') availableWidth -= 18 * scale;
                availableWidth = Math.max(1, availableWidth);
                availableHeight = Math.max(1, availableHeight);

                let context = null;
                try { context = document.createElement('canvas').getContext('2d'); } catch (_) { }
                const minSize = Math.max(1, 3 * scale);
                const maxSize = Math.max(minSize, availableHeight / 1.15);
                if (!context || !text) return maxSize;

                const fontStyle = `${field?.italic ? 'italic ' : ''}${field?.bold ? 'bold ' : ''}`;
                const fontFamily = field?.font || field?.fontName || 'Arial';
                const paragraphLines = field?.multiline ? text.split(/\r?\n/) : [text.replace(/\r?\n/g, ' ')];
                const fits = size => {
                    context.font = `${fontStyle}${size}px ${fontFamily}`;
                    let visualLineCount = 0;
                    let widest = 0;
                    for (const paragraph of paragraphLines) {
                        if (!field?.multiline) {
                            visualLineCount += 1;
                            widest = Math.max(widest, context.measureText(paragraph).width);
                            continue;
                        }
                        const tokens = paragraph.match(/\S+\s*|\s+/g) || [''];
                        let line = '';
                        let lines = 1;
                        for (const token of tokens) {
                            const candidate = line + token;
                            if (line && context.measureText(candidate).width > availableWidth) {
                                widest = Math.max(widest, context.measureText(line.trimEnd()).width);
                                line = token.trimStart();
                                lines += 1;
                            } else {
                                line = candidate;
                            }
                            if (context.measureText(line).width > availableWidth) {
                                const charsPerLine = Math.max(1, Math.floor(line.length * availableWidth / context.measureText(line).width));
                                lines += Math.max(0, Math.ceil(line.length / charsPerLine) - 1);
                                widest = availableWidth;
                                line = line.slice(-charsPerLine);
                            }
                        }
                        widest = Math.max(widest, context.measureText(line.trimEnd()).width);
                        visualLineCount += lines;
                    }
                    return widest <= availableWidth + 0.25 && visualLineCount * size * 1.15 <= availableHeight + 0.25;
                };

                let low = minSize;
                let high = maxSize;
                for (let i = 0; i < 12; i++) {
                    const mid = (low + high) / 2;
                    if (fits(mid)) low = mid;
                    else high = mid;
                }
                return Math.max(minSize, low);
            },

            _applyNativeFieldPreviewStyle: function (input, field, scale = 1) {
                if (!input || !field) return;
                input.style.fontSize = `${this._getFormFieldPreviewFontSize(field, scale, input.value, input)}px`;
                if (field.multiline) input.style.lineHeight = '1.15';
            },

            _resolveNativeChoiceValue: function (storedValue, fieldValue) {
                const value = storedValue !== undefined ? storedValue : fieldValue;
                return Array.isArray(value) ? (value[0] ?? '') : value;
            },

            _findNativeFieldOverlay: function (pageData, annotation, annotations = []) {
                if (!pageData || !annotation) return null;
                const objects = (pageData.objects || []).filter(object => object.fromFormField);
                const annotationId = String(annotation.id || '');
                if (annotationId) {
                    const exact = objects.find(object => object.nativeAnnotationId && String(object.nativeAnnotationId) === annotationId);
                    if (exact) return exact;
                }
                const fieldName = annotation.fieldName || '';
                const widgets = annotations.filter(item => item.subtype === 'Widget' && (item.fieldName || '') === fieldName);
                const widgetIndex = Math.max(0, widgets.findIndex(item => item === annotation || String(item.id || '') === annotationId));
                const indexed = objects.find(object =>
                    (object.nativeFieldName || object.fieldName) === fieldName &&
                    Number(object.nativeWidgetIndex || 0) === widgetIndex
                );
                if (indexed) return indexed;
                const named = objects.filter(object => (object.nativeFieldName || object.fieldName) === fieldName);
                return named.length === 1 ? named[0] : null;
            },

            renderCalendarGridProperties: function (state) {
                const grid = document.getElementById('prop-cal-grid');
                if (!grid) return;
                grid.innerHTML = '';
                const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
                for (let i = 1; i <= daysInMonth; i++) {
                    const cell = document.createElement('div');
                    cell.innerText = i;
                    cell.style.cssText = 'border: 1px solid var(--border); padding: 5px; text-align: center; cursor: pointer; font-size: 11px;';
                    if (state.selectedDays && state.selectedDays.includes(i)) {
                        cell.style.backgroundColor = 'var(--accent)';
                        cell.style.color = 'white';
                    }
                    cell.onclick = (e) => {
                        e.stopPropagation();
                        if (!state.selectedDays) state.selectedDays = [];
                        const idx = state.selectedDays.indexOf(i);
                        if (idx > -1) state.selectedDays.splice(idx, 1);
                        else state.selectedDays.push(i);
                        this.renderCalendarGridProperties(state);
                    };
                    grid.appendChild(cell);
                }
            },

            updateCollapsedLabels: function () {
                const bar = document.getElementById('ribbonCollapsedBar');
                bar.innerHTML = '';

                // Obtener la toolbar activa
                const activeToolbar = document.querySelector('.toolbar-area.active');
                if (!activeToolbar) return;

                // Obtener todos los group-title de la toolbar activa
                const groupTitles = activeToolbar.querySelectorAll('.group-title');

                const capsule = document.createElement('div');
                capsule.className = 'collapsed-group-capsule';

                groupTitles.forEach((title, index) => {
                    const section = title.closest('.tool-section');
                    if (!section) return;

                    const label = document.createElement('span');
                    label.className = 'collapsed-group-label';
                    label.innerText = title.innerText;
                    label.dataset.sectionIndex = index;
                    capsule.appendChild(label);
                });

                bar.appendChild(capsule);

                // Add mouseenter to the ENTIRE collapsed bar to expand ribbon
                bar.onmouseenter = () => {
                    if (this.ribbonCollapsed) {
                        this.showGroupPopup(null, null);
                    }
                };
            },

            updateGrid: function (panelId = null) {
                const targetPanel = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(targetPanel);
                const grid = elements.gridLayer;
                if (!grid) return;

                // Get scale from panel state
                const panelState = this.splitView[targetPanel];
                const scale = panelState?.scale || this.currentScale;
                // 1mm = 2.8346 pt (same as ruler)
                const mmToPt = 2.834645669;
                const mmToPx = mmToPt * scale;

                // 1cm = 10mm, with 4 subdivisions = 2.5mm each
                const cmPx = mmToPx * 10;        // Size of 1cm in pixels
                const subdivPx = cmPx / 4;       // Size of each subdivision (2.5mm)

                grid.style.backgroundImage = `
                linear - gradient(#666 1px, transparent 1px),
                    linear - gradient(90deg, #666 1px, transparent 1px),
                    linear - gradient(#bbb 0.5px, transparent 0.5px),
                    linear - gradient(90deg, #bbb 0.5px, transparent 0.5px)
                        `;
                grid.style.backgroundSize = `
                    ${cmPx}px ${cmPx} px,
                    ${cmPx}px ${cmPx} px,
                        ${subdivPx}px ${subdivPx} px,
                            ${subdivPx}px ${subdivPx} px
                `;
            },

            updateRulers: function (panelId = null) {
                const targetPanel = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(targetPanel);
                const panelState = this.splitView[targetPanel];
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const hRuler = elements.rulerH;
                const vRuler = elements.rulerV;
                if (!hRuler || !vRuler) return;
                hRuler.innerHTML = ''; vRuler.innerHTML = '';

                const scale = panelState?.scale || this.currentScale;
                // 1mm = 2.8346 pt (aprox)
                const mmToPt = 2.834645669;
                const mmToPx = mmToPt * scale;

                // Usamos el ancho del contenedor actual dibujado
                const container = elements.canvasContainer;
                if (!container) return;
                const widthPx = container.offsetWidth;
                const heightPx = container.offsetHeight;

                // Dibujar ticks horizontales
                const totalMmW = widthPx / mmToPx;

                for (let i = 0; i <= totalMmW; i++) {
                    const x = i * mmToPx;
                    const tick = document.createElement('div');
                    tick.className = 'ruler-tick';
                    tick.style.left = x + 'px';

                    if (i % 10 === 0) {
                        tick.style.height = '100%';
                        const num = document.createElement('div');
                        num.className = 'ruler-num';
                        num.innerText = (i / 10); // cm
                        num.style.left = (x + 2) + 'px';
                        num.style.bottom = '2px';
                        hRuler.appendChild(num);
                    } else if (i % 5 === 0) {
                        tick.style.height = '50%';
                    } else {
                        if (scale < 0.5) continue;
                        tick.style.height = '25%';
                    }
                    hRuler.appendChild(tick);
                }

                // Dibujar ticks verticales
                const totalMmH = heightPx / mmToPx;
                for (let i = 0; i <= totalMmH; i++) {
                    const y = i * mmToPx;
                    const tick = document.createElement('div');
                    tick.className = 'ruler-tick';
                    tick.style.top = y + 'px';

                    if (i % 10 === 0) {
                        tick.style.width = '100%';
                        const num = document.createElement('div');
                        num.className = 'ruler-num';
                        num.innerText = (i / 10);
                        num.style.top = (y + 2) + 'px';
                        num.style.right = '2px';
                        num.style.transform = 'rotate(-90deg)';
                        vRuler.appendChild(num);
                    } else if (i % 5 === 0) {
                        tick.style.width = '50%';
                    } else {
                        if (scale < 0.5) continue;
                        tick.style.width = '25%';
                    }
                    vRuler.appendChild(tick);
                }
            },

            // ============================================================
            // SECTION 3: SPLIT VIEW & PANEL MANAGEMENT
            // ============================================================

            isTwoUpView: false,
            twoUpCoverAlone: true,

            toggleTwoUpView: function (enable = null) {
                if (enable !== null) {
                    this.isTwoUpView = !!enable;
                } else {
                    this.isTwoUpView = !this.isTwoUpView;
                }
                const btn = document.getElementById('toggleTwoUp');
                if (btn) btn.classList.toggle('active-view', this.isTwoUpView);

                if (this.isTwoUpView && this.viewMode === 'single') {
                    this.viewMode = 'continuous';
                    const btnCont = document.getElementById('toggleContinuous');
                    if (btnCont) btnCont.classList.add('active-view');
                }

                this.renderPanelContent('primary');
                if (this.splitView && this.splitView.mode !== 'single') {
                    this.renderPanelContent('secondary');
                }

                if (this.isTwoUpView) {
                    setTimeout(() => {
                        this.fitToWidth?.();
                    }, 120);
                }

                this.showToast(this.isTwoUpView ? 'Vista Doble Página (Modo Libro) activada' : 'Vista Doble Página desactivada');
            },

            toggleTwoUpCoverAlone: function () {
                this.twoUpCoverAlone = !this.twoUpCoverAlone;
                if (this.isTwoUpView) {
                    this.renderPanelContent('primary');
                    if (this.splitView && this.splitView.mode !== 'single') {
                        this.renderPanelContent('secondary');
                    }
                }
                this.showToast(`Portada individual: ${this.twoUpCoverAlone ? 'Activada' : 'Desactivada'}`);
            },

            fitToWidth: function () {
                const btn = document.getElementById('zoomBtnFit');
                if (btn) btn.click();
            },

            /**
             * Sets the split view mode (single, horizontal, or vertical)
             * @param {string} mode - 'single' | 'horizontal' | 'vertical'
             */
            _rescueCanvasFromContinuous: function (panelId) {
                panelId = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(panelId);
                if (!elements.canvasContainer || !elements.mainView) return;

                // Invalidar token de sesión — cancela todos los renders en vuelo
                this._continuousSessionToken = Symbol();
                elements.canvasContainer._continuousRenderToken = Symbol();

                // Limpiar IntersectionObserver de la vista continua si existe
                if (this._continuousObservers && this._continuousObservers[panelId]) {
                    try { this._continuousObservers[panelId].disconnect(); } catch (e) {}
                    delete this._continuousObservers[panelId];
                }

                const c = elements.canvasContainer;
                const mainView = elements.mainView;

                // Antes de mover, mostrar el bgCanvas del wrapper activo (si cContainer vivía dentro)
                const parentWrapper = c.parentElement && c.parentElement.classList &&
                    c.parentElement.classList.contains('page-wrapper')
                    ? c.parentElement : null;
                if (parentWrapper) {
                    const bg = parentWrapper.querySelector('.bg-page-canvas');
                    if (bg) bg.style.display = '';
                }

                // Limpiar estilos inline del modo continuo y mover a mainView
                c.style.cssText = '';
                c.style.display = 'block';
                mainView.appendChild(c);   // siempre forzar reubicación limpia

                // Ahora es seguro eliminar el stack (cContainer ya está fuera)
                const stack = mainView.querySelector('.scroll-stack');
                if (stack) stack.remove();

                // Limpiar scroll handler
                mainView.onscroll = null;
            },

            renderPanelContent: function (panelId) {
                const panelState = this.splitView[panelId];
                const elements = this.getPanelElements(panelId);

                // Si el panel no existe en el DOM (ej: secundario en modo vista única), no hacer nada
                if (!elements.panel || !elements.mainView || !elements.canvasContainer) {
                    return;
                }

                // Handle case when no document is assigned to this panel
                if (!panelState || !panelState.docId) {
                    // Show empty message for this panel
                    if (elements.emptyMsg) elements.emptyMsg.style.display = 'block';
                    if (elements.canvasContainer) elements.canvasContainer.style.display = 'none';
                    // Clear any previous rendering to prevent showing wrong document
                    if (elements.canvas) {
                        const ctx = elements.canvas.getContext('2d');
                        ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
                    }
                    if (elements.overlayLayer) elements.overlayLayer.innerHTML = '';
                    if (elements.drawingLayer) {
                        const dCtx = elements.drawingLayer.getContext('2d');
                        dCtx.clearRect(0, 0, elements.drawingLayer.width, elements.drawingLayer.height);
                    }
                    if (elements.annotationLayer) elements.annotationLayer.innerHTML = '';
                    return;
                }

                const doc = this.docs.find(d => d.id === panelState.docId);

                if (!doc || doc.pages.length === 0) {
                    // Show empty message
                    if (elements.emptyMsg) elements.emptyMsg.style.display = 'block';
                    if (elements.canvasContainer) elements.canvasContainer.style.display = 'none';
                    return;
                }

                // Hide empty message
                if (elements.emptyMsg) elements.emptyMsg.style.display = 'none';

                if (this.viewMode === 'continuous') {
                    return this.renderContinuousContent(panelId);
                } else {
                    // Saliendo del modo continuo: usar helper que rescata el canvas y limpia el stack
                    this._rescueCanvasFromContinuous(panelId);
                }

                // Render in the specific panel
                return this.loadPage(panelState.pageIndex, panelId);
            },

            renderTabs: function () {
                const c = document.getElementById('docTabsWrapper'); c.innerHTML = '';
                this._updateAboutBtn();
                if (typeof this.updateWindowTitle === 'function') this.updateWindowTitle();
                this.docs.forEach((d, docIndex) => {
                    const el = document.createElement('div'); el.className = `doc-tab ${d.id === this.activeDocId ? 'active' : ''}`;
                    const isDirty = typeof this.isDocumentDirty === 'function' ? this.isDocumentDirty(d.id) : !!d.isDirty;
                    const dirtyDot = isDirty ? '<span class="doc-tab-dirty" title="Cambios sin guardar">●</span>' : '';
                    el.innerHTML = `${dirtyDot}<span class="doc-tab-name">${d.name}</span><span class="doc-tab-close" onclick="app.closeTab('${d.id}',event, false)">✕</span>`;
                    el.title = d.name; // Tooltip con nombre completo
                    if (this._translationReviewMinimized && this._translationReviewDocId === d.id) {
                        const indicator = document.createElement('span');
                        indicator.className = `doc-tab-translation${this._translationReviewPhase === 'ready' ? ' is-ready' : this._translationReviewPhase === 'error' ? ' is-error' : ''}`;
                        indicator.title = this._translationReviewPhase === 'ready' ? 'Revisión lista · abrir' :
                            this._translationReviewPhase === 'error' ? 'Traducción requiere atención · abrir' :
                            this._translationReviewProgress?.label || 'Traducción en segundo plano · abrir';
                        el.insertBefore(indicator, el.querySelector('.doc-tab-close'));
                        el.title = `${d.name} · ${indicator.title}`;
                    }

                    // Usar temporizador para distinguir click simple de doble click
                    let clickTimer = null;
                    el.onclick = (e) => {
                        if (e.target.classList.contains('doc-tab-close')) return;
                        if (clickTimer) {
                            clearTimeout(clickTimer);
                            clickTimer = null;
                            return; // Es doble click, no hacer nada aquí
                        }
                        clickTimer = setTimeout(() => {
                            clickTimer = null;
                            this.switchTab(d.id);
                            if (this._translationReviewMinimized && this._translationReviewDocId === d.id) this.restoreTextTranslationModal?.();
                        }, 250);
                    };

                    // Doble clic para editar nombre de documento
                    el.ondblclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (clickTimer) {
                            clearTimeout(clickTimer);
                            clickTimer = null;
                        }
                        const nameSpan = el.querySelector('.doc-tab-name');
                        if (!nameSpan) return;
                        const currentName = d.name;
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.value = currentName.replace('.pdf', '');
                        input.style.cssText = 'width: 100px; height: 16px; font-size: 11px; border: 1px solid var(--accent); border-radius: 4px; padding: 0 4px; background: white; color: black;';
                        nameSpan.replaceWith(input);
                        input.focus();
                        input.select();

                        const saveNewName = () => {
                            let newName = input.value.trim();
                            if (newName && newName !== currentName.replace('.pdf', '')) {
                                if (!newName.endsWith('.pdf')) newName += '.pdf';
                                d.name = newName;
                                app.showToast('Nombre actualizado');
                            }
                            app.renderTabs();
                        };

                        input.onblur = saveNewName;
                        input.onkeydown = (ke) => {
                            ke.stopPropagation();
                            if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                            if (ke.key === 'Escape') { d.name = currentName; app.renderTabs(); }
                        };
                        input.onclick = (ie) => ie.stopPropagation();
                    };

                    // Context menu para abrir en panel secundario
                    el.oncontextmenu = (e) => {
                        e.preventDefault();
                        this.showTabContextMenu(e, d.id, d.name);
                    };

                    // Drag and drop para reordenar pestañas de documento (local y cross-window)
                    el.draggable = !(this._translationReviewDocId === d.id && this._translationReviewPhase !== 'idle');
                    el.ondragstart = e => {
                        e.dataTransfer.effectAllowed = 'copyMove';
                        const token = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                        this._activeDraggedTabToken = token;
                        this._activeDraggedTabDocId = d.id;
                        this._tabTransferCompleted = false;

                        const sourcesBuffers = {};
                        for (const [srcId, src] of Object.entries(d.sources)) {
                            if (src && src.buffer) sourcesBuffers[srcId] = src.buffer;
                        }
                        const payload = {
                            type: 'tab_transfer',
                            token: token,
                            docId: d.id,
                            name: d.name,
                            pages: JSON.parse(JSON.stringify(d.pages)),
                            sourcesBuffers: sourcesBuffers,
                            sourceWindowId: window.__aliothWindowId
                        };
                        this._saveTransferPayload(token, payload);

                        e.dataTransfer.setData('text/plain', 'alioth-tab:' + token);
                        e.dataTransfer.setData('text/alioth-tab-token', token);
                        e.dataTransfer.setData('text/alioth-type', 'tab');
                        e.dataTransfer.setData('text/uri-list', 'http://alioth.local/tab/' + token);
                        e.dataTransfer.setData('text/doc-tab-id', d.id);
                        e.dataTransfer.setData('text/doc-tab-index', docIndex.toString());
                        el.classList.add('dragging');
                        this.draggingTabId = d.id;
                    };
                    el.ondragend = e => {
                        el.classList.remove('dragging');
                        document.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('drag-over', 'drag-left', 'drag-right'));
                        // NOTE: No borrar draggingTabId — el ACK de BroadcastChannel
                        // llega asíncrono y lo necesita. Se limpia en el handler del ACK.
                    };

                    el.ondragover = e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        // Mostrar indicador inmediatamente si es un arrastre de pestaña o página
                        const isTabDrag = e.dataTransfer.types.includes('text/alioth-tab-token') || e.dataTransfer.types.includes('text/doc-tab-id') || e.dataTransfer.types.includes('text/plain');
                        const isPageDrag = e.dataTransfer.types.includes('text/alioth-page-token') || e.dataTransfer.types.includes('json/pages');
                        if (isTabDrag || isPageDrag) {
                            document.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('drag-over', 'drag-left', 'drag-right'));
                            const rect = el.getBoundingClientRect();
                            const midX = rect.left + rect.width / 2;
                            if (e.clientX < midX) {
                                el.classList.add('drag-left');
                            } else {
                                el.classList.add('drag-right');
                            }
                            el.classList.add('drag-over');

                            // Auto-activar la pestaña al pasar el ratón por encima durante 350ms (permite soltar directamente en su barra lateral)
                            if (isPageDrag && this.activeDocId !== d.id && !el._tabHoverTimer) {
                                el._tabHoverTimer = setTimeout(() => {
                                    this.switchTab(d.id);
                                    el._tabHoverTimer = null;
                                }, 350);
                            }
                        }
                    };
                    el.ondragleave = e => {
                        el.classList.remove('drag-over', 'drag-left', 'drag-right');
                        if (el._tabHoverTimer) {
                            clearTimeout(el._tabHoverTimer);
                            el._tabHoverTimer = null;
                        }
                    };
                    el.ondrop = async e => {
                        e.preventDefault();
                        e.stopPropagation(); // <-- EVITA BURBUJEO HACIA c.ondrop o tabsParent.ondrop
                        el.classList.remove('drag-over', 'drag-left', 'drag-right');
                        if (el._tabHoverTimer) {
                            clearTimeout(el._tabHoverTimer);
                            el._tabHoverTimer = null;
                        }

                        const tabToken = e.dataTransfer.getData('text/alioth-tab-token') || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(tab|token):/, '');
                        const pageToken = e.dataTransfer.getData('text/alioth-page-token') || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(page|token):/, '');
                        const draggedTabId = e.dataTransfer.getData('text/doc-tab-id');

                        const rect = el.getBoundingClientRect();
                        const midX = rect.left + rect.width / 2;
                        const isLeft = e.clientX < midX;

                        // Caso 1: Reordenar pestañas dentro de la MISMA ventana (Tab to Tab local)
                        if (draggedTabId && this.docs.some(doc => doc.id === draggedTabId)) {
                            if (draggedTabId !== d.id) {
                                const fromIndex = this.docs.findIndex(doc => doc.id === draggedTabId);
                                let toIndex = this.docs.findIndex(doc => doc.id === d.id);
                                if (fromIndex > -1 && toIndex > -1 && fromIndex !== toIndex) {
                                    if (!isLeft && toIndex < this.docs.length - 1) toIndex++;
                                    const [movedDoc] = this.docs.splice(fromIndex, 1);
                                    this.docs.splice(toIndex, 0, movedDoc);
                                    this.renderTabs();
                                    this.showToast('Pestaña reordenada');
                                }
                            }
                            this.draggingTabId = null;
                            this._activeDraggedTabDocId = null;
                            return;
                        }

                        // Caso 2: Pestaña arrastrada desde OTRA VENTANA (Tab to Tab cross-window)
                        if (tabToken && tabToken.startsWith('tab_')) {
                            const payload = await this._fetchTransferPayload(tabToken);
                            if (payload && payload.pages && payload.pages.length) {
                                if (window.aliothChannel) {
                                    window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: tabToken });
                                }
                                const targetIdx = isLeft ? docIndex : docIndex + 1;
                                await this.loadDetachedDocument(payload, targetIdx);
                                return;
                            }
                        }

                        // Caso 3: Páginas soltadas sobre la pestaña (Page to Tab: permitir escoger posición de inserción)
                        if (pageToken && (pageToken.startsWith('page_') || pageToken.startsWith('local_'))) {
                            const payload = await this._fetchTransferPayload(pageToken);
                            if (payload && payload.pages && payload.pages.length) {
                                let insertIndex = -1;
                                // Si el documento tiene más de 1 página, permitir al usuario escoger la posición
                                if (d.pages.length > 1) {
                                    insertIndex = await this.showInsertPagePositionModal(payload, d);
                                    if (insertIndex === null) return; // Cancelado por el usuario
                                } else {
                                    insertIndex = d.pages.length;
                                }

                                const newPages = await this._clonePagesAndSources(payload, d, insertIndex);
                                this.switchTab(d.id);
                                this.renderTabs();
                                this.renderSidebar();
                                if (this.viewMode === 'continuous') {
                                    this.renderContinuousContent(this.splitView.activePanel);
                                } else {
                                    this.loadPage(insertIndex);
                                }
                                this.saveState();
                                this.showToast(`✅ ${newPages.length} pág(s) insertada(s) en posición ${insertIndex + 1} de "${d.name}"`);

                                if (payload.sourceWindowId === window.__aliothWindowId && payload.sourceDocId && payload.sourceDocId !== d.id) {
                                    const srcDoc = this.docs.find(doc => doc.id === payload.sourceDocId);
                                    if (srcDoc && payload.indices) {
                                        if (srcDoc.pages.length <= payload.pages.length) {
                                            this.closeTab(srcDoc.id, null, true);
                                        } else {
                                            [...payload.indices].sort((a, b) => b - a).forEach(idx => {
                                                srcDoc.pages.splice(idx, 1);
                                            });
                                            if (srcDoc.currentIndex >= srcDoc.pages.length) {
                                                srcDoc.currentIndex = Math.max(0, srcDoc.pages.length - 1);
                                            }
                                        }
                                    }
                                } else if (window.aliothChannel && payload.sourceWindowId !== window.__aliothWindowId) {
                                    window.aliothChannel.postMessage({ type: 'page_transfer_move_ack', token: pageToken });
                                }
                                return;
                            }
                        }

                        // Caso 4: Archivos soltados sobre la pestaña
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            this.switchTab(d.id);
                            this.handleSidebarDrop(Array.from(e.dataTransfer.files));
                            return;
                        }
                    };
                    c.appendChild(el);
                });

                // Permitir soltar pestaña o página en el espacio vacío del contenedor de pestañas
                c.ondragover = e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                };
                c.ondrop = async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rawToken = e.dataTransfer.getData('text/alioth-tab-token')
                                  || e.dataTransfer.getData('text/alioth-page-token')
                                  || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(tab|page|token):/, '');

                    if (rawToken && rawToken.startsWith('tab_')) {
                        const payload = await this._fetchTransferPayload(rawToken);
                        if (payload && payload.pages && payload.pages.length) {
                            if (payload.sourceWindowId === window.__aliothWindowId) {
                                const fromIdx = this.docs.findIndex(d => d.id === (payload.docId || payload.sourceDocId));
                                if (fromIdx > -1 && fromIdx !== this.docs.length - 1) {
                                    const [moved] = this.docs.splice(fromIdx, 1);
                                    this.docs.push(moved);
                                    this.renderTabs();
                                    this.showToast('Pestaña reordenada');
                                }
                                this.draggingTabId = null;
                                this._activeDraggedTabDocId = null;
                                return;
                            }
                            if (window.aliothChannel) window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawToken });
                            await this.loadDetachedDocument(payload);
                            return;
                        }
                    }

                    if (rawToken && (rawToken.startsWith('page_') || rawToken.startsWith('local_'))) {
                        await this.movePagesToNewTab(rawToken);
                        return;
                    }

                    if (this.draggedPageIndex !== null || (this.multiSelection && this.multiSelection.size > 0)) {
                        await this.movePagesToNewTab(null);
                    }
                };

                // Configurar contenedor padre .tabs-container o .app-titlebar
                const tabsParent = c.closest('.tabs-container') || c.closest('.app-titlebar') || c.parentElement;
                if (tabsParent && !tabsParent._aliothDropConfigured) {
                    tabsParent._aliothDropConfigured = true;
                    tabsParent.ondragover = e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                    };
                    tabsParent.ondrop = async e => {
                        if (e.target.closest('.doc-tab') && !e.target.closest('.doc-tab-add')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const rawToken = e.dataTransfer.getData('text/alioth-page-token')
                                      || e.dataTransfer.getData('text/alioth-tab-token')
                                      || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(tab|page|token):/, '');

                        if (rawToken && rawToken.startsWith('tab_')) {
                            const payload = await app._fetchTransferPayload(rawToken);
                            if (payload && payload.pages && payload.pages.length) {
                                if (payload.sourceWindowId === window.__aliothWindowId) {
                                    const fromIdx = app.docs.findIndex(d => d.id === (payload.docId || payload.sourceDocId));
                                    if (fromIdx > -1 && fromIdx !== app.docs.length - 1) {
                                        const [moved] = app.docs.splice(fromIdx, 1);
                                        app.docs.push(moved);
                                        app.renderTabs();
                                        app.showToast('Pestaña reordenada');
                                    }
                                    app.draggingTabId = null;
                                    app._activeDraggedTabDocId = null;
                                    return;
                                }
                                if (window.aliothChannel) window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawToken });
                                await app.loadDetachedDocument(payload);
                                return;
                            }
                        }
                        if (rawToken && (rawToken.startsWith('page_') || rawToken.startsWith('local_'))) {
                            await app.movePagesToNewTab(rawToken);
                            return;
                        }
                        if (app.draggedPageIndex !== null || (app.multiSelection && app.multiSelection.size > 0)) {
                            await app.movePagesToNewTab(null);
                        }
                    };
                }

                const addBtn = document.createElement('button');
                addBtn.className = 'doc-tab doc-tab-add';
                addBtn.textContent = '+';
                addBtn.title = 'Nueva Pestaña (o arrastra aquí una página o pestaña para extraerla/abrirla)';
                addBtn.onclick = () => app.createNewTab();

                addBtn.ondragover = e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    addBtn.classList.add('drag-over');
                };
                addBtn.ondragleave = () => addBtn.classList.remove('drag-over');
                addBtn.ondrop = async e => {
                    e.preventDefault();
                    e.stopPropagation();
                    addBtn.classList.remove('drag-over');

                    const rawToken = e.dataTransfer.getData('text/alioth-page-token')
                                  || e.dataTransfer.getData('text/alioth-tab-token')
                                  || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(tab|page|token):/, '');

                    if (rawToken && rawToken.startsWith('tab_')) {
                        const payload = await this._fetchTransferPayload(rawToken);
                        if (payload && payload.pages && payload.pages.length) {
                            if (payload.sourceWindowId === window.__aliothWindowId) {
                                const fromIdx = this.docs.findIndex(d => d.id === (payload.docId || payload.sourceDocId));
                                if (fromIdx > -1 && fromIdx !== this.docs.length - 1) {
                                    const [moved] = this.docs.splice(fromIdx, 1);
                                    this.docs.push(moved);
                                    this.renderTabs();
                                    this.showToast('Pestaña reordenada');
                                }
                                this.draggingTabId = null;
                                this._activeDraggedTabDocId = null;
                                return;
                            }
                            if (window.aliothChannel) window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawToken });
                            await this.loadDetachedDocument(payload);
                            return;
                        }
                    }

                    if (rawToken && (rawToken.startsWith('page_') || rawToken.startsWith('local_'))) {
                        await this.movePagesToNewTab(rawToken);
                        return;
                    }

                    if (this.draggedPageIndex !== null || (this.multiSelection && this.multiSelection.size > 0)) {
                        await this.movePagesToNewTab(null);
                    }
                };
                c.appendChild(addBtn);

                // Scroll horizontal intuitivo con la rueda del ratón
                if (!c._wheelConfigured) {
                    c._wheelConfigured = true;
                    c.addEventListener('wheel', (e) => {
                        if (e.deltaY !== 0) {
                            e.preventDefault();
                            c.scrollLeft += e.deltaY;
                        }
                    }, { passive: false });
                }

                // Asegurar que la pestaña activa quede visible automáticamente
                requestAnimationFrame(() => {
                    const activeEl = c.querySelector('.doc-tab.active');
                    if (activeEl) {
                        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                    }
                });
            },

            /**
             * Mueve páginas (locales o recibidas de otra ventana) a una NUEVA pestaña
             */
            movePagesToNewTab: async function (tokenOrPayload = null, localIndices = null, localSrcDocId = null) {
                let payload = null;
                let token = null;

                if (typeof tokenOrPayload === 'string') {
                    token = tokenOrPayload.replace(/^alioth-(page|token|tab):/, '');
                    payload = await this._fetchTransferPayload(token);
                } else if (tokenOrPayload && typeof tokenOrPayload === 'object') {
                    payload = tokenOrPayload;
                    token = payload.token;
                }

                // Caso 1: Arrastre local en la misma ventana si no vino por payload
                if (!payload) {
                    const srcDocId = localSrcDocId || this.draggedDocId;
                    const indices = (Array.isArray(localIndices) && localIndices.length > 0)
                        ? localIndices
                        : (this.multiSelection && this.multiSelection.size > 0 ? Array.from(this.multiSelection) : (typeof this.draggedPageIndex === 'number' ? [this.draggedPageIndex] : []));

                    if (srcDocId && indices.length > 0) {
                        const srcDoc = this.docs.find(d => d.id === srcDocId);
                        if (srcDoc && srcDoc.pages && srcDoc.pages.length > 0) {
                            const sortedIndices = [...indices].sort((a, b) => a - b);
                            const pagesToMove = sortedIndices.map(idx => srcDoc.pages[idx]).filter(Boolean);
                            if (pagesToMove.length > 0) {
                                const sourcesBuffers = {};
                                pagesToMove.forEach(p => {
                                    if (srcDoc.sources && srcDoc.sources[p.sourceId] && srcDoc.sources[p.sourceId].buffer) {
                                        sourcesBuffers[p.sourceId] = srcDoc.sources[p.sourceId].buffer;
                                    }
                                });
                                payload = {
                                    token: 'local_' + Date.now(),
                                    sourceDocId: srcDoc.id,
                                    docName: srcDoc.name,
                                    indices: sortedIndices,
                                    pages: pagesToMove,
                                    sourcesBuffers: sourcesBuffers,
                                    isLocalSameWindow: true,
                                    sourceWindowId: window.__aliothWindowId
                                };
                            }
                        }
                    }
                }

                if (!payload || !payload.pages || !payload.pages.length) return;

                let baseName = (payload.docName || payload.name || 'Documento').replace(/\.pdf$/i, '');
                let newName = `${baseName} - Extraído.pdf`;
                if (payload.indices && payload.indices.length === 1) {
                    newName = `${baseName} - Pág ${payload.indices[0] + 1}.pdf`;
                } else if (payload.indices && payload.indices.length > 1) {
                    newName = `${baseName} - Páginas (${payload.indices.map(x => x + 1).join(',')}).pdf`;
                }

                const newDocId = 'doc_' + Date.now() + Math.random().toString(36).substr(2, 5);
                const newDoc = {
                    id: newDocId,
                    name: newName,
                    pages: [],
                    sources: {},
                    currentIndex: 0,
                    scale: 1.0,
                    history: [],
                    historyIndex: -1
                };

                // Clonar fuentes y páginas
                await this._clonePagesAndSources(payload, newDoc, 0);

                // Registrar en la lista de documentos
                this.docs.push(newDoc);
                // Una pestaña extraída es un documento independiente: su estado
                // inicial debe quedar disponible antes de que se intente Guardar como.
                if (typeof this.setDocumentBaseline === 'function') {
                    try {
                        await this.setDocumentBaseline(newDocId);
                    } catch (error) {
                        console.warn('[MovePages] No se pudo crear la línea base de la pestaña extraída:', error);
                    }
                }

                // Si es local en la misma ventana, eliminar las páginas del documento origen
                if (payload.isLocalSameWindow || payload.sourceWindowId === window.__aliothWindowId) {
                    const srcDoc = this.docs.find(d => d.id === payload.sourceDocId);
                    if (srcDoc && payload.indices) {
                        if (srcDoc.pages.length <= payload.pages.length) {
                            this.closeTab(srcDoc.id, null, true);
                        } else {
                            [...payload.indices].sort((a, b) => b - a).forEach(idx => {
                                srcDoc.pages.splice(idx, 1);
                            });
                            if (srcDoc.currentIndex >= srcDoc.pages.length) {
                                srcDoc.currentIndex = Math.max(0, srcDoc.pages.length - 1);
                            }
                        }
                    }
                } else if (payload.token) {
                    // Notificar a la otra ventana
                    try { localStorage.setItem('alioth_page_ack_' + payload.token, '1'); } catch(e) {}
                    if (window.aliothChannel) {
                        window.aliothChannel.postMessage({ type: 'page_transfer_move_ack', token: payload.token });
                    }
                }

                this.multiSelection.clear();
                this.switchTab(newDocId);
                this.renderTabs();
                this.renderSidebar();
                await this.loadPage(0);
                this.saveState();
                this.showToast(`📄 ${newDoc.pages.length} página(s) extraída(s) a nueva pestaña`);
            },

            loadPage: async function (idx, panelId = null) {
                this.hideTranslationTooltip?.(true);
                // Determine target panel
                const targetPanel = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(targetPanel);
                const panelState = this.splitView[targetPanel];

                // Get document based on panel state or active doc
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (doc?._sessionSourcesPending) {
                    await this.hydrateSessionDocument(doc);
                    if ((panelState?.docId || this.activeDocId) !== docId) return;
                }
                const c = elements.canvasContainer;

                if (!doc || !doc.pages.length || idx < 0) {
                    if (c) c.style.display = 'none';
                    if (elements.emptyMsg) elements.emptyMsg.style.display = 'block';
                    return;
                }

                // Si el canvasContainer o mainView no existen en el DOM, abortar silenciosamente.
                // Ocurre cuando se intenta renderizar un panel que aún no está montado
                // (ej: vista paralela no activa, cambio de modo de vista durante carga).
                if (!c || !elements.mainView) {
                    return;
                }

                if (this.viewMode !== 'continuous') c.style.display = 'block';
                if (elements.emptyMsg) elements.emptyMsg.style.display = 'none';

                if (idx >= doc.pages.length) idx = 0; if (idx < 0) idx = doc.pages.length - 1;
                doc.currentIndex = idx;

                // Update panel state
                if (panelState) {
                    panelState.pageIndex = idx;
                }

                // --- CONTINUOUS VIEW ---
                if (this.viewMode === 'continuous') {
                    // El cContainer vive dentro del page-wrapper activo.
                    // Asegurar que está en el wrapper correcto (por si loadPage se llamó externamente)
                    if (c) {
                        const expectedWrapper = document.getElementById('page-wrapper-' + targetPanel + '-' + idx);
                        const isWrapperValid = expectedWrapper && (!expectedWrapper.dataset.pageId || expectedWrapper.dataset.pageId === (doc.pages[idx] && doc.pages[idx].id));
                        if (isWrapperValid) {
                            if (c.parentElement !== expectedWrapper) {
                                this._moveCContainerToWrapper(targetPanel, idx);
                            }
                            // Scroll main view to the selected page in continuous mode (skip if suppressed by real edit reload)
                            if (!this._suppressScrollIntoView) {
                                const _isHLay = document.body.classList.contains('h-layout');
                                const _mv = elements.mainView;
                                if (_isHLay) {
                                    // Generar nuevo token para invalidar RAF de renderContinuousContent
                                    const _navToken = Symbol();
                                    this._scrollRestoreToken = _navToken;
                                    this._userNavigating = true;
                                    this._suppressScrollTracking = true;
                                    const _snapWrapper = expectedWrapper;
                                    const _self = this;

                                    const _applyCenterScroll = (attempt) => {
                                        // Re-invalidate token on every attempt
                                        _self._scrollRestoreToken = _navToken;
                                        _self._suppressScrollTracking = true;

                                        // Spacers are already in the DOM — just read position directly
                                        const _mvRect = _mv.getBoundingClientRect();
                                        const _wRect = _snapWrapper.getBoundingClientRect();
                                        const _wLeft = _wRect.left - _mvRect.left + _mv.scrollLeft;
                                        const _wW = _snapWrapper.offsetWidth;
                                        const _mvW = _mv.clientWidth;
                                        const _targetSL = _wLeft + _wW / 2 - _mvW / 2;
                                        const _clampedSL = Math.max(0, Math.min(_targetSL, _mv.scrollWidth - _mvW));
                                        _mv.scrollLeft = _clampedSL;

                                        const _settled = Math.abs(_mv.scrollLeft - _clampedSL) <= 2;
                                        if (!_settled && attempt < 5) {
                                            setTimeout(() => _applyCenterScroll(attempt + 1), 60);
                                        } else {
                                            setTimeout(() => {
                                                _self._suppressScrollTracking = false;
                                            }, 100);
                                        }
                                    };

                                    // Spacers in DOM → wrappers have correct offsetLeft after first rAF
                                    setTimeout(() => {
                                        this._userNavigating = false;
                                        _applyCenterScroll(0);
                                    }, 50);
                                } else {
                                    expectedWrapper.scrollIntoView({ behavior: 'auto', block: 'start' });
                                }
                            }
                            this._suppressScrollIntoView = false;
                        } else {
                            // FIX: If the wrapper doesn't exist, the continuous stack is out of sync (e.g. after insert/delete)
                            // Re-render the whole panel to rebuild the stack.
                            console.warn(`[Continuous Sync] Wrapper not found for page ${idx} in panel ${targetPanel}. Rebuilding stack...`);
                            this.renderPanelContent(targetPanel);
                            return;
                        }
                    }
                } else {
                    // Single page mode: cContainer debe estar directamente en mainView
                    this._suppressScrollIntoView = false; // consumir flag en modo single también
                    if (c && elements.mainView) {
                        if (c.parentElement !== elements.mainView) {
                            // Restaurar bgCanvas si venía de un page-wrapper
                            const pw = c.parentElement;
                            if (pw && pw.classList && pw.classList.contains('page-wrapper')) {
                                const bg = pw.querySelector('.bg-page-canvas');
                                if (bg) bg.style.display = '';
                            }
                            c.style.cssText = '';
                            elements.mainView.appendChild(c);
                        }
                        c.style.display = 'block';
                        elements.mainView.scrollLeft = 0;
                        elements.mainView.scrollTop = 0;
                    }
                    if (elements.mainView) {
                        const stack = elements.mainView.querySelector('.scroll-stack');
                        if (stack) stack.remove();
                    }
                }
                // ----------------------------------------

                // Only update UI controls if this is the active panel
                if (targetPanel === this.splitView.activePanel) {
                    this.setPageCount(`${idx + 1} / ${doc.pages.length}`);

                    // --- DIRECT SIDEBAR UPDATE (More robust) ---
                    // Remove current selection
                    document.querySelectorAll('.thumb-wrap.selected').forEach(el => el.classList.remove('selected'));

                    // Add to new index directly
                    const thumb = document.getElementById('thumb-' + idx);
                    if (thumb) {
                        thumb.classList.add('selected');
                        thumb.scrollIntoView({ block: 'center', behavior: 'instant' });
                    }
                    // -------------------------------------------

                    // Actualizar resaltado del índice
                    // ✅ CORRECCIÓN: Validación defensiva
                    if (this.indexPanelOpen && this.indexEntries && this.indexEntries.length > 0) {
                        this.highlightActiveIndexEntry(idx + 1);
                    }
                }

                const pData = doc.pages[idx];

                if (this.viewMode === 'continuous') {
                    await this._renderContinuousActivePage(targetPanel, idx);
                    return;
                }

                // NUEVO: Manejar páginas con canvas pre-generado (como páginas de índice)
                if (pData.canvas) {
                    // Use panel-specific scale
                    const scale = panelState?.scale || this.currentScale;
                    const rot = pData.rotation || 0;

                    const cvs = elements.canvas;
                    if (!cvs) return;

                    // Escalar el canvas generado
                    const sourceWidth = pData.canvas.width;
                    const sourceHeight = pData.canvas.height;
                    cvs.width = sourceWidth * scale;
                    cvs.height = sourceHeight * scale;

                    const dlayer = elements.drawingLayer;
                    if (dlayer) {
                        dlayer.width = cvs.width;
                        dlayer.height = cvs.height;
                    }

                    c.style.width = cvs.width + 'px';
                    c.style.height = cvs.height + 'px';

                    let transformStr = "";
                    if (pData.flipH) transformStr += "scaleX(-1) ";
                    if (pData.flipV) transformStr += "scaleY(-1) ";
                    c.style.transform = transformStr.trim() || "none";
                    c.style.transformOrigin = "center center";

                    const ctx = cvs.getContext('2d', { alpha: false });
                    ctx.clearRect(0, 0, cvs.width, cvs.height);

                    // Dibujar el canvas pre-generado escalado
                    ctx.drawImage(pData.canvas, 0, 0, cvs.width, cvs.height);

                    // Renderizar overlays (objetos sobre la página)
                    this.renderOverlays(targetPanel);
                    this.redrawDrawings(false, targetPanel);
                    if (this.showRuler) this.updateRulers(targetPanel);
                    if (this.showGrid) this.updateGrid(targetPanel);

                    return;
                }

                // Código original para páginas PDF normales
                const src = doc.sources[pData.sourceId];

                // Página en blanco insertada manualmente
                if (pData._blank || !src) {
                    const scale = panelState?.scale || this.currentScale;
                    const cvs = elements.canvas;
                    if (!cvs) return;
                    const pw = Math.round((pData.width || 612) * scale);
                    const ph = Math.round((pData.height || 792) * scale);
                    cvs.width = pw; cvs.height = ph;
                    const dlayer = elements.drawingLayer;
                    if (dlayer) { dlayer.width = pw; dlayer.height = ph; }
                    c.style.width = pw + 'px'; c.style.height = ph + 'px';
                    let tf = '';
                    if (pData.flipH) tf += 'scaleX(-1) ';
                    if (pData.flipV) tf += 'scaleY(-1) ';
                    c.style.transform = tf.trim() || 'none';
                    c.style.transformOrigin = 'center center';
                    const rot = pData.rotation || 0;
                    if (rot === 90 || rot === 270) {
                        cvs.width = ph; cvs.height = pw;
                        if (dlayer) { dlayer.width = ph; dlayer.height = pw; }
                        c.style.width = ph + 'px'; c.style.height = pw + 'px';
                    }
                    const ctx = cvs.getContext('2d', { alpha: false });
                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cvs.width, cvs.height);
                    if (rot) {
                        ctx.translate(cvs.width / 2, cvs.height / 2);
                        ctx.rotate(rot * Math.PI / 180);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
                    }
                    ctx.restore();
                    this.renderOverlays(targetPanel);
                    this.redrawDrawings(false, targetPanel);
                    if (this.showRuler) this.updateRulers(targetPanel);
                    if (this.showGrid) this.updateGrid(targetPanel);
                    return;
                }

                if (!src || !src.buffer) return;
                let page;
                try {
                    await this.loadSourcePdf(src);
                    page = await src.doc.getPage(pData.pageIndex + 1);
                } catch (e) {
                    try {
                        if (!src.buffer) return;
                        this.releasePdfSource(src);
                        await this.loadSourcePdf(src);
                        page = await src.doc.getPage(pData.pageIndex + 1);
                    } catch (e2) { console.error("Error cargando página", e2); return; }
                }

                // Use panel-specific scale
                const scale = panelState?.scale || this.currentScale;
                const rot = (page.rotate + pData.rotation) % 360;
                const vp = page.getViewport({ scale: scale, rotation: rot });

                const cvs = elements.canvas;
                if (!cvs) return;

                const dlayer = elements.drawingLayer;

                // Render to offscreen canvas to avoid blank flash during zoom/scroll
                const offscreen = document.createElement('canvas');
                offscreen.width = vp.width;
                offscreen.height = vp.height;
                const offCtx = offscreen.getContext('2d', { alpha: false });

                // Use panel-specific render task tracking
                const renderTaskKey = 'renderTask_' + targetPanel;
                if (this[renderTaskKey]) {
                    try { await this[renderTaskKey].cancel(); } catch (e) { }
                }

                const renderParams = {
                    canvasContext: offCtx,
                    viewport: vp,
                    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS // ENABLE_FORMS renders forms but NOT comment icon annotations on canvas
                };
                if (src && src.optionalContentConfigPromise) {
                    renderParams.optionalContentConfigPromise = src.optionalContentConfigPromise;
                }
                this[renderTaskKey] = page.render(renderParams);

                try {
                    await this[renderTaskKey].promise;
                } catch (e) {
                    // Render was cancelled, skip overlays
                    if (e.name === 'RenderingCancelledException') return;
                }

                // Update visible canvas only after render completes — no blank flash
                cvs.width = vp.width; cvs.height = vp.height;
                if (dlayer) { dlayer.width = vp.width; dlayer.height = vp.height; }

                c.style.width = vp.width + 'px'; c.style.height = vp.height + 'px';

                if (pData) {
                    pData.width = vp.width / scale;
                    pData.height = vp.height / scale;
                }

                // Sincronizar wrapper padre en modo continuo
                const pw = c.parentElement && c.parentElement.classList && c.parentElement.classList.contains('page-wrapper') ? c.parentElement : null;
                if (pw) {
                    pw.style.width = vp.width + 'px';
                    pw.style.height = vp.height + 'px';
                    const bg = pw.querySelector('.bg-page-canvas');
                    if (bg) bg.style.display = 'none';
                }

                let transformStr = "";
                if (pData.flipH) transformStr += "scaleX(-1) ";
                if (pData.flipV) transformStr += "scaleY(-1) ";
                c.style.transform = transformStr.trim() || "none";
                c.style.transformOrigin = "center center"; // FIX: Flip desde el centro

                const ctx = cvs.getContext('2d', { alpha: false });
                ctx.drawImage(offscreen, 0, 0);

                // Render PDF form annotations (interactive fields)
                await this.renderAnnotationLayer(page, vp, elements, targetPanel, pData);

                // Render text layer for text selection
                await this.renderTextLayer(page, vp, elements, targetPanel);

                this.renderOverlays(targetPanel);
                this.redrawDrawings(false, targetPanel);
                if (this.showRuler) this.updateRulers(targetPanel);
                if (this.showGrid) this.updateGrid(targetPanel);

                // Re-aplicar filtros de documento si están activos
                const _activeDoc = this.docs.find(d => d.id === (this.splitView[targetPanel]?.docId || this.activeDocId));
                const _el = elements.canvasContainer;
                if (_activeDoc && _activeDoc._isInverted) {
                    if (_el) {
                        _el.style.filter = 'invert(100%)';
                        _el.querySelectorAll('canvas').forEach(cvs => cvs.style.filter = '');
                    }
                } else {
                    if (_el) {
                        _el.style.filter = '';
                        _el.querySelectorAll('canvas').forEach(cvs => cvs.style.filter = '');
                    }
                }
                // Bookmark ribbons
                if (window.BookmarkManager) BookmarkManager._renderRibbons(doc, idx, elements.canvasContainer);
            },

            goToPage: function (pageIndex, panelId = null) {
                this.loadPage(pageIndex, panelId);
            },


            /**
             * Renders the text layer for text selection functionality
             * Enhanced to detect and apply correct fonts from PDF metadata
             */
            renderTextLayer: async function (page, viewport, elements, panelId) {
                const container = elements.canvasContainer;
                if (!container) return;
                const continuousToken = container._continuousRenderToken;

                // Find or create text layer div
                let textLayerDiv = container.querySelector('.text-layer');
                if (!textLayerDiv) {
                    textLayerDiv = document.createElement('div');
                    textLayerDiv.className = 'text-layer';
                    if (elements.annotationLayer) {
                        container.insertBefore(textLayerDiv, elements.annotationLayer);
                    } else {
                        container.appendChild(textLayerDiv);
                    }
                }

                textLayerDiv.innerHTML = '';
                // Clean up any open annotation popups from previous page
                document.querySelectorAll('.pdf-annot-popup').forEach(p => p.remove());
                textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
                textLayerDiv.style.height = Math.floor(viewport.height) + 'px';
                if (!elements.textLayer) elements.textLayer = textLayerDiv;

                if (this.isTextSelectMode || document.body.classList.contains('text-select-mode')) {
                    textLayerDiv.style.display = 'block';
                    textLayerDiv.style.pointerEvents = 'auto';
                    textLayerDiv.style.zIndex = '10005';
                }

                // In text-select-mode, allow hovering over text to preview translation tooltips when not dragging
                textLayerDiv.onmousemove = (e) => {
                    if (!document.body.classList.contains('text-select-mode')) return;
                    if (e.buttons !== 0) {
                        this.hideTranslationTooltip?.();
                        return;
                    }
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) return;

                    const elementsUnder = document.elementsFromPoint(e.clientX, e.clientY);
                    const transEl = elementsUnder?.find(el => el.dataset?.translationNote === 'true');
                    if (transEl && (transEl._nativeCommentObj || transEl.id?.startsWith('thover-'))) {
                        const doc = this.getDoc?.();
                        const page = doc?.pages?.[doc.currentIndex];
                        let obj = transEl._nativeCommentObj;
                        if (!obj && page?.objects) {
                            const rawId = transEl.id.replace('thover-', '');
                            obj = page.objects.find(o => o.id === rawId);
                        }
                        if (obj) {
                            this.showTranslationTooltip(e, obj, transEl);
                            return;
                        }
                    }
                    this.hideTranslationTooltip?.();
                };

                textLayerDiv.onmouseleave = () => {
                    if (document.body.classList.contains('text-select-mode')) {
                        this.hideTranslationTooltip?.();
                    }
                };

                textLayerDiv.onmousedown = () => {
                    this.hideTranslationTooltip?.(true);
                };

                // ── Context menu (right-click on text layer) ──────────────────
                textLayerDiv.oncontextmenu = (e) => {
                    const selection = window.getSelection();
                    const selectedText = selection?.toString().trim();
                    if (!selectedText || !selection.rangeCount || !textLayerDiv.contains(selection.anchorNode) || !textLayerDiv.contains(selection.focusNode)) return;
                    const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
                    e.preventDefault();
                    e.stopPropagation();
                    app._showTextContextMenu(e, selectedText, selectionRect);
                };

                try {
                    const textContent = await page.getTextContent();
                    if (container._continuousRenderToken !== continuousToken) return;
                    const fontStyles = textContent.styles || {};

                    // Offscreen span for measuring natural browser text width
                    const _measurer = document.createElement('span');
                    _measurer.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
                    document.body.appendChild(_measurer);

                    textContent.items.forEach((item, itemIndex) => {
                        if (!item.str || !item.str.trim()) return;

                        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                        const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                        if (fontHeight < 1) return;

                        const fid = item.fontName || '';
                        const st  = fontStyles[fid] || {};

                        const fontFamily = (st.fontFamily && st.fontFamily !== 'sans-serif')
                            ? st.fontFamily
                            : 'Arial, sans-serif';
                        const isBold   = !!(st.fontWeight && (parseInt(st.fontWeight) >= 700 || st.fontWeight === 'bold'));
                        const isItalic = st.fontStyle === 'italic' || st.fontStyle === 'oblique';

                        const span = document.createElement('span');
                        span.textContent = item.str;
                        span.dataset.fontName     = fontFamily.replace(/^[A-Z]{6}\+/, '');
                        span.dataset.isBold       = String(isBold);
                        span.dataset.isItalic     = String(isItalic);
                        span.dataset.originalSize = fontHeight.toFixed(2);
                        span.dataset.itemIndex    = String(itemIndex);
                        span.dataset.itemStr      = item.str;

                        // Base styles (no width, no scaleX yet)
                        span.style.cssText = `
                            position:absolute;
                            left:${tx[4]}px;
                            top:${(tx[5] - fontHeight)}px;
                            font-size:${fontHeight}px;
                            font-family:${fontFamily};
                            line-height:1;
                            transform-origin:0% 0%;
                            ${isBold   ? 'font-weight:bold;'   : ''}
                            ${isItalic ? 'font-style:italic;'  : ''}
                            white-space:pre;
                            color:transparent;
                        `;

                        // Compute scaleX so glyphs match PDF width exactly
                        if (item.width > 0) {
                            const pdfWidth = item.width * viewport.scale;
                            // Measure natural browser render width
                            _measurer.style.fontSize   = fontHeight + 'px';
                            _measurer.style.fontFamily = fontFamily;
                            _measurer.style.fontWeight = isBold   ? 'bold'   : 'normal';
                            _measurer.style.fontStyle  = isItalic ? 'italic' : 'normal';
                            _measurer.textContent = item.str;
                            const naturalWidth = _measurer.getBoundingClientRect().width;
                            if (naturalWidth > 0.5) {
                                const scaleX = pdfWidth / naturalWidth;
                                span.style.transform = `scaleX(${scaleX.toFixed(4)})`;
                            }
                        }

                        textLayerDiv.appendChild(span);
                    });

                    _measurer.remove();

                } catch (error) {
                    console.error('Error rendering text layer:', error);
                }
            },

            // ── Shared text context menu ─────────────────────────────────────
            _showTextContextMenu: function(e, selectedText, selectionRect) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const oldMenu = document.getElementById('text-context-menu');
                if (oldMenu) oldMenu.remove();

                const menu = document.createElement('div');
                menu.id = 'text-context-menu';
                menu.style.cssText = `
                    position:fixed;display:flex;flex-direction:column;
                    background:rgba(26, 32, 53, 0.63);
                    -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
                    border:1px solid rgba(255, 255, 255, 0.18);
                    border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.6);
                    z-index:10001;padding:8px;min-width:230px;color:#f0f4ff;
                `;

                // Capture HTML for copy
                const sel = window.getSelection();
                let htmlToCopy = '';
                if (sel && sel.rangeCount > 0) {
                    try { ({ html: htmlToCopy } = app.processRichCopy(sel)); } catch(_) {}
                }
                const textToCopy = selectedText;

                // Copy item
                const copyItem = document.createElement('div');
                copyItem.className = 'ctx-item';
                copyItem.style.cssText = 'padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:inherit;';
                copyItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> <span>${t('ctx_copy_format', 'Copiar con formato')}</span>`;
                copyItem.onmouseover = function() { this.style.background='rgba(255,255,255,0.2)'; };
                copyItem.onmouseout = function() { this.style.background='transparent'; };
                copyItem.onclick = async () => {
                    menu.remove();
                    try {
                        const hc = `<!DOCTYPE html><html><body><!--StartFragment-->${htmlToCopy||textToCopy}<!--EndFragment--></body></html>`;
                        await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([hc],{type:'text/html'}),'text/plain':new Blob([textToCopy],{type:'text/plain'})})]);
                        app.showToast(t('ctx_toast_copy_format', '✓ Texto copiado con formato'));
                    } catch(_) {
                        try { await navigator.clipboard.writeText(textToCopy); app.showToast(t('ctx_toast_copy', 'Texto copiado')); } catch(__) { app.showToast(t('ctx_toast_copy_err', 'Error al copiar')); }
                    }
                };
                menu.appendChild(copyItem);

                // Search Web item
                const searchItem = document.createElement('div');
                searchItem.className = 'ctx-item';
                searchItem.style.cssText = copyItem.style.cssText;
                const searchProviderInfo = (app.getSearchProviderInfo ? app.getSearchProviderInfo() : { name: 'Google' });
                const searchLabel = `${t('ctx_search_web', 'Buscar en')} ${searchProviderInfo.name}`;
                searchItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> <span>${searchLabel}</span>`;
                searchItem.onmouseover = copyItem.onmouseover;
                searchItem.onmouseout = copyItem.onmouseout;
                searchItem.onclick = () => {
                    menu.remove();
                    if (app.openWebSearch) {
                        app.openWebSearch(textToCopy);
                    } else {
                        const q = encodeURIComponent((textToCopy || '').trim());
                        if (q) window.open(`https://www.google.com/search?q=${q}`, '_blank');
                    }
                };
                menu.appendChild(searchItem);

                const translateItem = document.createElement('div');
                translateItem.className = 'ctx-item';
                translateItem.style.cssText = copyItem.style.cssText;
                translateItem.textContent = t('ctx_translate_selection', 'Traducir selección');
                translateItem.onmouseover = copyItem.onmouseover;
                translateItem.onmouseout = copyItem.onmouseout;
                translateItem.onclick = () => {
                    menu.remove();
                    this._showSelectionTranslation(selectedText, selectionRect);
                };
                menu.appendChild(translateItem);

                // Separator
                const sep1 = document.createElement('div');
                sep1.style.cssText = 'height:1px;background:rgba(255,255,255,0.18);margin:3px 0;';
                menu.appendChild(sep1);

                // Highlight label
                const hlLabel = document.createElement('div');
                hlLabel.style.cssText = 'padding:5px 16px 2px;font-size:10px;opacity:0.55;color:inherit;font-weight:600;letter-spacing:0.3px;';
                hlLabel.textContent = t('ctx_highlight_label', 'RESALTAR');
                menu.appendChild(hlLabel);

                // Highlight color row
                const hlRow = document.createElement('div');
                hlRow.style.cssText = 'display:flex;gap:6px;padding:4px 16px 6px;';
                [
                    {label: t('color_yellow', 'Amarillo'), color:'rgba(255,235,59,0.5)'},
                    {label: t('color_green', 'Verde'),    color:'rgba(76,175,80,0.4)'},
                    {label: t('color_blue', 'Azul'),     color:'rgba(33,150,243,0.4)'},
                    {label: t('color_red', 'Rojo'),     color:'rgba(244,67,54,0.4)'},
                    {label: t('color_pink', 'Rosa'),    color:'rgba(233,30,99,0.35)'},
                ].forEach(({label,color}) => {
                    const dot = document.createElement('div');
                    dot.title = label;
                    dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:${color};cursor:pointer;border:2px solid rgba(0,0,0,0.18);flex-shrink:0;transition:transform 0.1s;`;
                    dot.onmouseover = function() { this.style.transform='scale(1.2)'; };
                    dot.onmouseout  = function() { this.style.transform=''; };
                    dot.onclick = () => {
                        menu.remove();
                        if (textToCopy.trim()) { app.pendingHighlightColor=color; app.highlightSelection(color); app.showToast('✓ Texto resaltado'); }
                    };
                    hlRow.appendChild(dot);
                });
                menu.appendChild(hlRow);

                // Separator
                const sep2 = document.createElement('div');
                sep2.style.cssText = 'height:1px;background:rgba(255,255,255,0.18);margin:3px 0;';
                menu.appendChild(sep2);

                // Add as bookmark
                const bmItem = document.createElement('div');
                bmItem.className = 'ctx-item';
                bmItem.style.cssText = 'padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;color:inherit;';
                bmItem.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> <span>${t('ctx_add_bm', 'Agregar como marcador')}</span>`;
                bmItem.onmouseover = function() { this.style.background='rgba(255,255,255,0.2)'; };
                bmItem.onmouseout  = function() { this.style.background='transparent'; };
                bmItem.onclick = () => {
                    menu.remove();
                    const doc = app.getDoc();
                    BookmarkManager.openModal(doc ? (doc.currentIndex||0) : 0);
                    setTimeout(() => {
                        const inp = document.getElementById('bm-modal-title-input');
                        if (inp && textToCopy.trim()) {
                            inp.value = textToCopy.trim().substring(0,60) + (textToCopy.trim().length>60?'…':'');
                            inp.select();
                        }
                    }, 80);
                };
                menu.appendChild(bmItem);

                document.body.appendChild(menu);

                // Position
                let mx = e.clientX, my = e.clientY;
                if (mx + 240 > window.innerWidth) mx = window.innerWidth - 245;
                if (my + 200 > window.innerHeight) my = window.innerHeight - 205;
                menu.style.left = mx + 'px';
                menu.style.top  = my + 'px';

                // Close on click outside
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 10);
            },
            _showSelectionTranslation: function(sourceText, selectionRect) {
                this._selectionTranslationClose?.();
                const doc = this.getDoc();
                if (!doc) return;
                const docId = doc.id, pageIndex = doc.currentIndex;
                const container = this.getPanelElements(this.splitView.activePanel)?.canvasContainer;
                const containerRect = container?.getBoundingClientRect();
                if (!containerRect) return;
                const scale = this.splitView[this.splitView.activePanel]?.scale || this.currentScale || 1;
                const anchorY = Math.max(0, (selectionRect.top - containerRect.top) / scale);
                const popup = document.createElement('section');
                popup.id = 'selection-translation-popup';
                popup.className = 'selection-translation-popup';
                popup.setAttribute('role', 'dialog');
                popup.setAttribute('aria-label', 'Traducir selección');
                const title = document.createElement('strong'); title.textContent = 'Traducir selección';
                const heading = document.createElement('div'); heading.className = 'selection-translation-heading';
                const language = document.createElement('select');
                language.setAttribute('aria-label', 'Idioma destino');
                const configured = document.getElementById('translation-review-language');
                for (const option of configured?.options || []) language.add(new Option(option.text, option.value));
                if (!language.options.length) for (const name of ['Español', 'Inglés', 'Francés', 'Alemán', 'Italiano', 'Portugués']) language.add(new Option(name, name));
                language.value = configured?.value || 'Español';
                const languageLabel = document.createElement('label'); languageLabel.textContent = 'Idioma destino'; languageLabel.appendChild(language);
                const translate = document.createElement('button'); translate.type = 'button'; translate.textContent = 'Traducir';
                const controls = document.createElement('div'); controls.className = 'selection-translation-controls'; controls.append(languageLabel, translate);
                const result = document.createElement('p'); result.className = 'selection-translation-result';
                const addNote = document.createElement('button'); addNote.type = 'button'; addNote.textContent = 'Agregar como nota'; addNote.hidden = true;
                const footer = document.createElement('div'); footer.className = 'selection-translation-footer'; footer.appendChild(addNote);
                const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Cerrar');
                heading.append(title, close);
                let translatedText = '', controller;
                const positionPopup = () => {
                    const { width, height } = popup.getBoundingClientRect();
                    const below = selectionRect.bottom + 8;
                    const above = selectionRect.top - height - 8;
                    popup.style.left = Math.max(12, Math.min(selectionRect.left, window.innerWidth - width - 12)) + 'px';
                    popup.style.top = (below + height <= window.innerHeight - 12 ? below : above >= 12 ? above : Math.max(12, window.innerHeight - height - 12)) + 'px';
                };
                const closePopup = () => {
                    controller?.abort();
                    document.removeEventListener('keydown', onKeyDown, true);
                    window.removeEventListener('resize', positionPopup);
                    popup.remove();
                    if (this._selectionTranslationClose === closePopup) this._selectionTranslationClose = null;
                };
                const onKeyDown = event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault(); event.stopPropagation(); closePopup();
                };
                this._selectionTranslationClose = closePopup;
                document.addEventListener('keydown', onKeyDown, true);
                window.addEventListener('resize', positionPopup);
                close.onclick = closePopup;
                language.onchange = () => { controller?.abort(); translatedText = ''; result.textContent = ''; addNote.hidden = true; translate.disabled = false; positionPopup(); };
                translate.onclick = async () => {
                    controller?.abort();
                    const requestController = new AbortController();
                    controller = requestController;
                    translatedText = ''; addNote.hidden = true; translate.disabled = true; result.textContent = 'Traduciendo…';
                    try {
                        const preview = await this.translateSelectedTextPreview(sourceText, language.value, requestController.signal, (partial, completed, total) => {
                            if (!popup.isConnected || requestController.signal.aborted || controller !== requestController || total === 1) return;
                            result.textContent = partial ? `${partial}\n\nTraduciendo… (${completed}/${total})` : `Traduciendo… (${completed}/${total})`;
                            positionPopup();
                        });
                        if (!popup.isConnected || requestController.signal.aborted || controller !== requestController) return;
                        translatedText = preview;
                        result.textContent = translatedText; addNote.hidden = false; positionPopup();
                    } catch (error) {
                        if (!requestController.signal.aborted && popup.isConnected && controller === requestController) {
                            result.textContent = error.message === 'PROVIDER_TIMEOUT'
                                ? 'El proveedor tardó demasiado. Intenta otra vez o selecciona menos texto.'
                                : `No se pudo traducir (${error.message}).`;
                            positionPopup();
                        }
                    } finally { if (controller === requestController) translate.disabled = false; }
                };
                addNote.onclick = () => {
                    const current = this.getDoc();
                    if (!translatedText || current?.id !== docId || current.currentIndex !== pageIndex) {
                        result.textContent = 'La página cambió. Selecciona el texto de nuevo.'; addNote.hidden = true; return;
                    }
                    const now = new Date();
                    this.addObject({ type: 'comment', x: Math.max(0, container.clientWidth / scale - 24), y: anchorY, width: 24, height: 24,
                        text: translatedText, color: '#3b82f6', author: `Traducción · ${language.value}`,
                        date: now.toLocaleDateString('es'), time: now.toLocaleTimeString('es'),
                        replies: [], resolved: false, reactions: {}, translationNote: true, sourceText });
                    closePopup();
                };
                popup.append(heading, controls, result, footer);
                document.body.appendChild(popup);
                positionPopup();
                language.focus();
            },
            /**
             * Renders interactive PDF form fields using pdfjsViewer.AnnotationLayer
             * @param {PDFPageProxy} page - The PDF.js page object
             * @param {PageViewport} viewport - The viewport with scale applied
             * @param {Object} elements - Panel elements from getPanelElements
             * @param {string} panelId - 'primary' or 'secondary'
             */
            renderAnnotationLayer: async function (page, viewport, elements, panelId, pData) {
                const annotationLayerDiv = elements.annotationLayer;
                if (!annotationLayerDiv) return;
                const continuousToken = elements.canvasContainer?._continuousRenderToken;
                const isCurrent = () => elements.canvasContainer?._continuousRenderToken === continuousToken;
                if (!annotationLayerDiv._externalLinkMenuBound) {
                    annotationLayerDiv.addEventListener('click', e => {
                        const link = e.target.closest?.('section.linkAnnotation a[href]');
                        if (link && this.showExternalLinkMenu(link.href, e)) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }, true);
                    annotationLayerDiv._externalLinkMenuBound = true;
                }

                // Native widgets stay intact. Hide them only while their structural edit overlays are active.
                if (this.isFieldEditMode && pData?.nativeFieldOverlaysDetected) {
                    annotationLayerDiv.style.display = 'none';
                    annotationLayerDiv.style.visibility = 'hidden';
                    annotationLayerDiv.style.pointerEvents = 'none';
                    return;
                }
                annotationLayerDiv.style.display = 'block';
                annotationLayerDiv.style.visibility = 'visible';
                annotationLayerDiv.style.pointerEvents = 'none'; // Background transparent to clicks

                // Clear existing annotations
                annotationLayerDiv.innerHTML = '';

                try {
                    // Get annotations from the page
                    const annotations = await page.getAnnotations({ intent: 'display' });
                    if (!isCurrent()) return;



                    if (!annotations || annotations.length === 0) {

                    }

                    // Style the annotation layer to match viewport
                    annotationLayerDiv.style.width = viewport.width + 'px';
                    annotationLayerDiv.style.height = viewport.height + 'px';

                    // Check if pdfjsViewer.AnnotationLayer is available
                    if (typeof pdfjsViewer === 'undefined' || !pdfjsViewer.AnnotationLayer) {
                        await this.renderAnnotationLayerFallback(page, viewport, elements, panelId, pData);
                        return;
                    }

                    // Create link service
                    const linkService = {
                        getDestinationHash: () => '#',
                        getAnchorUrl: (hash) => hash,
                        setHash: () => { },
                        executeNamedAction: () => { },
                        cachePageRef: () => { },
                        isPageVisible: () => true,
                        isPageCached: () => true,
                        externalLinkEnabled: true,
                        externalLinkTarget: 2, // BLANK
                    };

                    try {
                        // Create AnnotationLayer instance (PDF.js 3.x style)
                        const annotationLayer = new pdfjsViewer.AnnotationLayer({
                            div: annotationLayerDiv,
                            accessibilityManager: null,
                            annotationCanvasMap: null,
                            page: page,
                            viewport: viewport,
                        });

                        // Render the annotations
                        await annotationLayer.render({
                            annotations: annotations,
                            div: annotationLayerDiv,
                            page: page,
                            viewport: viewport,
                            linkService: linkService,
                            downloadManager: null,
                            imageResourcesPath: '',
                            renderForms: true,
                            enableScripting: false,
                            hasJSActions: false,
                        });
                        if (!isCurrent()) return;

                    } catch (instanceError) {
                        if (!isCurrent()) return;
                        console.warn('Instance-based AnnotationLayer failed:', instanceError);

                        // Try static render method as fallback
                        try {
                            pdfjsViewer.AnnotationLayer.render({
                                viewport: viewport.clone({ dontFlip: true }),
                                div: annotationLayerDiv,
                                annotations: annotations,
                                page: page,
                                linkService: linkService,
                                renderForms: true,
                            });

                        } catch (staticError) {
                            console.warn('Static AnnotationLayer.render also failed:', staticError);
                            throw staticError;
                        }
                    }

                    // Listen for changes on form fields to store values
                    annotationLayerDiv.querySelectorAll('input, textarea, select').forEach(input => {
                        const section = input.closest('section');
                        const annotId = section?.dataset?.annotationId;
                        const annotation = annotations.find(item => String(item.id) === String(annotId));
                        const nativeOverlay = this._findNativeFieldOverlay(pData, annotation, annotations);
                        if (nativeOverlay && section) {
                            const scale = viewport.scale || 1;
                            section.style.left = (nativeOverlay.x * scale) + 'px';
                            section.style.top = (nativeOverlay.y * scale) + 'px';
                            section.style.width = (nativeOverlay.width * scale) + 'px';
                            section.style.height = (nativeOverlay.height * scale) + 'px';
                            if (nativeOverlay.readOnly !== undefined) {
                                input.readOnly = !!nativeOverlay.readOnly;
                                input.disabled = !!nativeOverlay.readOnly;
                            }
                        }
                        const storedValue = annotation?.fieldName
                            ? pData?.nativeFormValues?.[annotation.fieldName]?.value
                            : undefined;
                        if (storedValue !== undefined) {
                            if (input.type === 'checkbox') input.checked = !!storedValue;
                            else if (input.type === 'radio') input.checked = storedValue === annotation.buttonValue;
                            else input.value = storedValue;
                        } else if ((input.tagName === 'SELECT' || input.type === 'select-one') && annotation?.fieldValue !== undefined) {
                            input.value = this._resolveNativeChoiceValue(undefined, annotation.fieldValue);
                        }
                        this._applyNativeFieldPreviewStyle(input, nativeOverlay, viewport.scale || 1);

                        const storeValue = () => {
                            this._applyNativeFieldPreviewStyle(input, nativeOverlay, viewport.scale || 1);
                            if (annotId) {
                                const isButton = input.type === 'checkbox' || input.type === 'radio';
                                this.storeAnnotationValue(panelId, annotId, isButton ? input.checked : input.value, pData, annotation);
                            }
                        };
                        input.addEventListener('input', storeValue);
                        input.addEventListener('change', storeValue);
                    });

                    // Post-process Text annotations: replace native PDF.js icon with our custom pin
                    const annotationsForPost = await page.getAnnotations({ intent: 'display' });
                    if (!isCurrent()) return;
                    const popupMapPost = {};
                    annotationsForPost.forEach(ann => {
                        if (ann.subtype === 'Popup' && ann.parentId != null) popupMapPost[ann.parentId] = ann;
                    });
                    annotationLayerDiv.querySelectorAll('section.textAnnotation, section[data-annotation-type="Text"]').forEach(section => {
                        if (section.classList.contains('native-comment-pin')) return;
                        const annotId = section.dataset.annotationId;
                        const annotation = annotationsForPost.find(a => String(a.id) === String(annotId));
                        if (!annotation) return;
                        const c = annotation.color || { r: 59, g: 130, b: 246 };
                        const r = c[0] !== undefined ? c[0] : (c.r || 59);
                        const g = c[1] !== undefined ? c[1] : (c.g || 130);
                        const b = c[2] !== undefined ? c[2] : (c.b || 246);
                        const hexColor = '#' + [r,g,b].map(x => { const h = Math.round(x||0).toString(16); return h.length===1?'0'+h:h; }).join('');
                        const getStr = (obj) => { if (!obj) return ''; if (typeof obj==='string') return obj; if (obj.str) return obj.str; return ''; };
                        const popupAnn = popupMapPost[annotation.id] || popupMapPost[String(annotation.id)];
                        const resolvedContent = getStr(annotation.contentsObj)||getStr(annotation.contents)||getStr(popupAnn?.contentsObj)||getStr(popupAnn?.contents)||getStr(annotation.subject)||'';
                        const resolvedAuthor = getStr(annotation.titleObj)||getStr(annotation.title)||getStr(annotation.author)||getStr(popupAnn?.titleObj)||getStr(popupAnn?.title)||getStr(popupAnn?.author)||'Usuario';
                        // Recover replies+reactions stored as JSON in subject field
                        const _subjectRaw = getStr(annotation.subject)||getStr(popupAnn?.subject)||'';
                        let _recoveredReplies = [], _recoveredReactions = {};
                        try {
                            if (_subjectRaw.startsWith('{')) {
                                const _sd = JSON.parse(_subjectRaw);
                                _recoveredReplies = _sd.r || [];
                                _recoveredReactions = _sd.rx || {};
                            } else if (_subjectRaw.startsWith('[')) {
                                _recoveredReplies = JSON.parse(_subjectRaw);
                            }
                        } catch(e) {}
                        // If subject was used as content fallback above but it's actually JSON, clear it from resolvedContent
                        const _cleanContent = (resolvedContent === _subjectRaw && (_recoveredReplies.length > 0 || _subjectRaw.startsWith('{'))) ? '' : resolvedContent;
                        section.classList.add('textAnnotation','comment-pin','native-comment-pin');
                        section.style.cssText += `width:32px!important;height:38px!important;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000!important;transform-origin:center center;transition:transform 0.18s,filter 0.18s ease;pointer-events:auto!important;`;
                        if (resolvedAuthor.startsWith('Traducción · ')) {
                            const noteSide = Number(annotation.rect?.[0]) < 0 ? 'left' : 'right';
                            section.style.left = noteSide === 'left' ? '-40px' : (viewport.width + 8) + 'px';
                            section.style.transform = 'none';
                            section.dataset.translationNote = 'true';
                            section.dataset.translationSide = noteSide;
                        }
                        section.innerHTML = this._buildPinSVG(hexColor, false);
                        const _docRef2 = this.docs.find(d => d.id === (this.splitView[panelId]?.docId || this.activeDocId));
                        const _pageIdx2 = _docRef2?.currentIndex;
                        const _annotRawId2 = String(annotation.id || '');
                        if (_docRef2?.hiddenNativeAnnotIds?.[_pageIdx2]?.[_annotRawId2]) { section.style.display='none'; return; }
                        const nativeId2 = 'native_' + (annotation.id || Math.random().toString(36).substr(2,9));
                        section.id = 'cpin-' + nativeId2;
                        const fakeObj2 = { id:nativeId2, type:'comment', x:0,y:0, text:_cleanContent, author:resolvedAuthor||'Lector', color:hexColor, time:'', replies:_recoveredReplies, resolved:false, locked:false, _isNative:true, _nativeRawId:_annotRawId2, reactions:_recoveredReactions };
                        section._nativeCommentObj = fakeObj2;
                        section.addEventListener('mouseenter',()=>{ section.style.transform='scale(1.18) translateY(-2px)'; section.style.filter='drop-shadow(0 5px 12px rgba(0,0,0,0.5))'; });
                        section.addEventListener('mouseleave',()=>{ section.style.transform=''; section.style.filter='drop-shadow(0 2px 6px rgba(0,0,0,0.4))'; });
                        section.addEventListener('click',(ev)=>{ ev.stopPropagation(); ev.preventDefault(); this.openCommentPopup(fakeObj2.id, section, section._nativeCommentObj); });
                        section.addEventListener('contextmenu',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); this.openCommentCtxMenu(ev, fakeObj2.id); });
                    });

                    // Post-process Highlight annotations: attach translation tooltips and interaction
                    annotationLayerDiv.querySelectorAll('section.highlightAnnotation, section[data-annotation-type="Highlight"], section.markupAnnotation').forEach(section => {
                        if (section.classList.contains('processed-translation-highlight')) return;
                        const annotId = section.dataset.annotationId;
                        const annotation = annotationsForPost.find(a => String(a.id) === String(annotId));
                        if (!annotation) return;

                        const getStr = (obj) => { if (!obj) return ''; if (typeof obj==='string') return obj; if (obj.str) return obj.str; return ''; };
                        const popupAnn = popupMapPost[annotation.id] || popupMapPost[String(annotation.id)];
                        const resolvedContent = getStr(annotation.contentsObj)||getStr(annotation.contents)||getStr(popupAnn?.contentsObj)||getStr(popupAnn?.contents)||getStr(annotation.subject)||'';
                        const resolvedAuthor = getStr(annotation.titleObj)||getStr(annotation.title)||getStr(annotation.author)||getStr(popupAnn?.titleObj)||getStr(popupAnn?.title)||getStr(popupAnn?.author)||'';

                        const isTranslation = resolvedAuthor.startsWith('Traducción') || resolvedAuthor.toLowerCase().includes('traducc') || (popupAnn && getStr(popupAnn.title).startsWith('Traducción'));

                        if ((resolvedContent || isTranslation) && this._isTranslatableText(resolvedContent)) {
                            section.classList.add('processed-translation-highlight', 'translation-highlight-annot');
                            const langMatch = resolvedAuthor.match(/Traducción\s*·\s*(.+)/i);
                            const targetLang = langMatch ? langMatch[1].trim() : (isTranslation ? 'Traducción' : (resolvedAuthor || 'Nota'));

                            const _subjectRaw = getStr(annotation.subject)||getStr(popupAnn?.subject)||'';
                            let _recoveredReplies = [], _recoveredReactions = {};
                            try {
                                if (_subjectRaw.startsWith('{')) {
                                    const _sd = JSON.parse(_subjectRaw);
                                    _recoveredReplies = _sd.r || [];
                                    _recoveredReactions = _sd.rx || {};
                                } else if (_subjectRaw.startsWith('[')) {
                                    _recoveredReplies = JSON.parse(_subjectRaw);
                                }
                            } catch(e) {}
                            const _cleanContent = (resolvedContent === _subjectRaw && (_recoveredReplies.length > 0 || _subjectRaw.startsWith('{'))) ? '' : resolvedContent;

                            const _docRef = this.docs.find(d => d.id === (this.splitView[panelId]?.docId || this.activeDocId));
                            const _pageIdx = _docRef?.currentIndex;
                            const _annotRawId = String(annotation.id || '');
                            if (_docRef?.hiddenNativeAnnotIds?.[_pageIdx]?.[_annotRawId]) {
                                section.style.display = 'none';
                                return;
                            }

                            const nativeId = 'native_hl_' + (annotation.id || Math.random().toString(36).substr(2, 9));
                            section.id = 'thover-' + nativeId;
                            section.dataset.translationNote = 'true';
                            section.dataset.translationLanguage = targetLang;

                            const c = annotation.color || [59, 130, 246];
                            let r = c[0] !== undefined ? c[0] : (c.r || 59);
                            let g = c[1] !== undefined ? c[1] : (c.g || 130);
                            let b = c[2] !== undefined ? c[2] : (c.b || 246);
                            if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
                                r = Math.round(r * 255); g = Math.round(g * 255); b = Math.round(b * 255);
                            }
                            const hexColor = '#' + [r, g, b].map(x => {
                                const h = Math.max(0, Math.min(255, Math.round(x || 0))).toString(16);
                                return h.length === 1 ? '0' + h : h;
                            }).join('');

                            const fakeObj = {
                                id: nativeId,
                                type: 'comment',
                                x: 0, y: 0,
                                width: section.offsetWidth || 80,
                                height: section.offsetHeight || 20,
                                text: _cleanContent,
                                author: resolvedAuthor || 'Traducción',
                                translationLanguage: targetLang,
                                translationNote: true,
                                color: hexColor,
                                time: '',
                                replies: _recoveredReplies,
                                resolved: false,
                                locked: false,
                                _isNative: true,
                                _nativeRawId: _annotRawId,
                                reactions: _recoveredReactions
                            };
                            section._nativeCommentObj = fakeObj;
                            section.style.cursor = 'help';
                            section.style.pointerEvents = 'auto';
                            section.style.background = 'transparent';
                            section.style.border = 'none';
                            section.style.outline = 'none';
                            section.style.boxShadow = 'none';

                            section.addEventListener('mouseenter', (ev) => {
                                if (document.body.classList.contains('text-select-mode') && ev.buttons !== 0) return;
                                this.showTranslationTooltip(ev, fakeObj, section);
                            });
                            section.addEventListener('mouseleave', () => {
                                this.hideTranslationTooltip();
                            });
                            section.addEventListener('click', (ev) => {
                                if (document.body.classList.contains('text-select-mode')) return;
                                ev.stopPropagation();
                                ev.preventDefault();
                                this.pinTranslationTooltip(ev, fakeObj, section);
                            });
                            section.addEventListener('contextmenu', (ev) => {
                                if (document.body.classList.contains('text-select-mode')) {
                                    const sel = window.getSelection();
                                    if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) return;
                                }
                                ev.preventDefault();
                                ev.stopPropagation();
                                this.openCommentCtxMenu(ev, fakeObj.id);
                            });
                        } else {
                            section.style.pointerEvents = 'none';
                            section.style.background = 'transparent';
                            section.style.border = 'none';
                            section.style.outline = 'none';
                            section.style.boxShadow = 'none';
                        }
                    });
                    this._layoutTranslationNotePins(panelId);

                } catch (e) {
                    if (!isCurrent()) return;
                    console.warn('renderAnnotationLayer main path error, using fallback:', e?.message || e);
                    // Fallback: try manual annotation rendering
                    await this.renderAnnotationLayerFallback(page, viewport, elements, panelId, pData);
                }
            },

            /**
             * Fallback manual annotation rendering for older pdf.js versions
             */
            renderAnnotationLayerFallback: async function (page, viewport, elements, panelId, pData = null) {
                const annotationLayerDiv = elements.annotationLayer;
                if (!annotationLayerDiv) return;
                const continuousToken = elements.canvasContainer?._continuousRenderToken;

                try {
                    const annotations = await page.getAnnotations({ intent: 'display' });
                    if (elements.canvasContainer?._continuousRenderToken !== continuousToken) return;
                    if (!annotations || annotations.length === 0) return;

                    const scale = viewport.scale;

                    // Pre-map Popup annotations by parentId so Text annotations can reference their content
                    const popupMap = {};
                    annotations.forEach(ann => {
                        if (ann.subtype === 'Popup' && ann.parentId != null) {
                            popupMap[ann.parentId] = ann;
                        }
                    });

                    annotations.forEach(annotation => {
                        if (!annotation.subtype) return;

                        // Helper to extract string from PDF.js annotation objects
                        const getStr = (obj) => {
                            if (!obj) return '';
                            if (typeof obj === 'string') return obj;
                            if (obj.str) return obj.str;
                            return '';
                        };

                        const rect = annotation.rect;
                        if (!rect || rect.length < 4) return;

                        // Use official PDF.js coordinate conversion (handles rotation, scale, etc.)
                        const viewRect = viewport.convertToViewportRectangle(annotation.rect);
                        const left = Math.min(viewRect[0], viewRect[2]);
                        const top = Math.min(viewRect[1], viewRect[3]);
                        const width = Math.abs(viewRect[2] - viewRect[0]);
                        const height = Math.abs(viewRect[3] - viewRect[1]);

                        const section = document.createElement('section');
                        section.style.position = 'absolute';
                        section.style.left = left + 'px';
                        section.style.top = top + 'px';
                        section.style.width = Math.max(width, 1) + 'px';
                        section.style.height = Math.max(height, 1) + 'px';
                        section.dataset.annotationType = annotation.subtype;
                        section.dataset.annotationId = annotation.id || '';
                        const nativeOverlay = this._findNativeFieldOverlay(pData, annotation, annotations);
                        if (nativeOverlay) {
                            section.style.left = (nativeOverlay.x * scale) + 'px';
                            section.style.top = (nativeOverlay.y * scale) + 'px';
                            section.style.width = Math.max(nativeOverlay.width * scale, 1) + 'px';
                            section.style.height = Math.max(nativeOverlay.height * scale, 1) + 'px';
                        }

                        if (annotation.subtype === 'Widget') {
                            const fieldType = annotation.fieldType;
                            section.classList.add('textWidgetAnnotation');

                            if (fieldType === 'Tx') {
                                const isMultiline = annotation.multiLine || false;
                                const element = isMultiline
                                    ? document.createElement('textarea')
                                    : document.createElement('input');

                                if (!isMultiline) element.type = 'text';
                                element.value = pData?.nativeFormValues?.[annotation.fieldName]?.value ?? annotation.fieldValue ?? '';
                                if (nativeOverlay) this._applyNativeFieldPreviewStyle(element, nativeOverlay, scale);
                                else element.style.fontSize = Math.max(10, Math.min(16, height * 0.7)) + 'px';

                                if (nativeOverlay?.readOnly ?? annotation.readOnly) {
                                    element.readOnly = true;
                                    element.style.backgroundColor = 'rgba(240, 240, 240, 0.5)';
                                }
                                if (annotation.maxLen) element.maxLength = annotation.maxLen;

                                const storeValue = () => {
                                    this._applyNativeFieldPreviewStyle(element, nativeOverlay, scale);
                                    this.storeAnnotationValue(panelId, annotation.id, element.value, pData, annotation);
                                };
                                element.addEventListener('input', storeValue);
                                element.addEventListener('change', storeValue);

                                section.appendChild(element);
                            }
                            else if (fieldType === 'Btn') {
                                section.classList.remove('textWidgetAnnotation');
                                section.classList.add('buttonWidgetAnnotation');

                                const element = document.createElement('input');
                                if (annotation.checkBox) {
                                    element.type = 'checkbox';
                                    element.checked = pData?.nativeFormValues?.[annotation.fieldName]?.value ?? (annotation.fieldValue === annotation.exportValue);
                                } else if (annotation.radioButton) {
                                    element.type = 'radio';
                                    element.name = annotation.fieldName;
                                    const storedValue = pData?.nativeFormValues?.[annotation.fieldName]?.value;
                                    element.checked = storedValue !== undefined
                                        ? storedValue === annotation.buttonValue
                                        : annotation.fieldValue === annotation.buttonValue;
                                } else {
                                    element.type = 'button';
                                    element.value = annotation.buttonCaption || 'Button';
                                }
                                element.disabled = !!(nativeOverlay?.readOnly ?? annotation.readOnly);

                                element.addEventListener('change', () => {
                                    this.storeAnnotationValue(panelId, annotation.id, element.checked, pData, annotation);
                                });

                                section.appendChild(element);
                            }
                            else if (fieldType === 'Ch') {
                                section.classList.remove('textWidgetAnnotation');
                                section.classList.add('choiceWidgetAnnotation');

                                const element = document.createElement('select');
                                element.disabled = !!(nativeOverlay?.readOnly ?? annotation.readOnly);
                                const storedValue = pData?.nativeFormValues?.[annotation.fieldName]?.value;
                                const selectedValue = this._resolveNativeChoiceValue(storedValue, annotation.fieldValue);
                                if (annotation.options) {
                                    annotation.options.forEach(opt => {
                                        const option = document.createElement('option');
                                        option.value = opt.exportValue || opt.displayValue;
                                        option.textContent = opt.displayValue;
                                        if (selectedValue === option.value) option.selected = true;
                                        element.appendChild(option);
                                    });
                                }

                                if (selectedValue !== undefined) element.value = selectedValue;
                                this._applyNativeFieldPreviewStyle(element, nativeOverlay, scale);

                                element.addEventListener('change', () => {
                                    this._applyNativeFieldPreviewStyle(element, nativeOverlay, scale);
                                    this.storeAnnotationValue(panelId, annotation.id, element.value, pData, annotation);
                                });

                                section.appendChild(element);
                            }
                        }
                        else if (annotation.subtype === 'Link') {
                            section.classList.add('linkAnnotation');
                            const link = document.createElement('a');
                            if (annotation.url) {
                                link.href = annotation.url;
                                link.target = '_blank';
                                link.rel = 'noopener noreferrer';
                            }
                            section.appendChild(link);
                        }
                        else if (annotation.subtype === 'Text') {
                            section.classList.add('textAnnotation', 'comment-pin', 'native-comment-pin');
                            
                            const c = annotation.color || [59, 130, 246];
                            let r = c[0] !== undefined ? c[0] : (c.r || 59);
                            let g = c[1] !== undefined ? c[1] : (c.g || 130);
                            let b = c[2] !== undefined ? c[2] : (c.b || 246);
                            
                            // Si los valores están en rango 0-1 (floats), normalizar a 0-255
                            if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
                                r = Math.round(r * 255);
                                g = Math.round(g * 255);
                                b = Math.round(b * 255);
                            }
                            
                            const hexColor = '#' + [r, g, b].map(x => {
                                const val = Math.max(0, Math.min(255, Math.round(x || 0)));
                                const hex = val.toString(16);
                                return hex.length === 1 ? '0' + hex : hex;
                            }).join('');
                            
                            // Modern circle comment icon
                            section.style.cssText += `
                                width:32px!important;height:32px!important;
                                margin-left:-16px; margin-top:-16px;
                                background:transparent;
                                cursor:pointer;display:flex;align-items:center;justify-content:center;
                                z-index:1000!important; transform-origin: center center;
                                transition:transform 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275), filter 0.18s ease;
                                pointer-events:auto!important;
                            `;
                            
                            section.innerHTML = `<svg class="cp-svg" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                              <circle cx="14" cy="14" r="12" fill="${hexColor}" stroke="white" stroke-width="2"/>
                              <line x1="8" y1="10" x2="20" y2="10" stroke="white" stroke-width="2" stroke-linecap="round"/>
                              <line x1="8" y1="14" x2="20" y2="14" stroke="white" stroke-width="2" stroke-linecap="round"/>
                              <line x1="8" y1="18" x2="16" y2="18" stroke="white" stroke-width="2" stroke-linecap="round"/>
                            </svg>`;
                            
                            const popupAnn = popupMap[annotation.id] || popupMap[String(annotation.id)];
                            const getStr = (obj) => {
                                if (!obj) return '';
                                if (typeof obj === 'string') return obj;
                                if (obj.str) return obj.str;
                                return '';
                            };
                            
                            const resolvedContent = getStr(annotation.contentsObj) || getStr(annotation.contents) || getStr(popupAnn?.contentsObj) || getStr(popupAnn?.contents) || getStr(annotation.subject) || '';
                            const resolvedAuthor = getStr(annotation.titleObj) || getStr(annotation.title) || getStr(annotation.author) || getStr(popupAnn?.titleObj) || getStr(popupAnn?.title) || getStr(popupAnn?.author) || 'Usuario';
                            if (resolvedAuthor.startsWith('Traducción · ')) {
                                const noteSide = Number(annotation.rect?.[0]) < 0 ? 'left' : 'right';
                                section.style.left = noteSide === 'left' ? '-40px' : (viewport.width + 8) + 'px';
                                section.style.marginLeft = '0';
                                section.dataset.translationNote = 'true';
                                section.dataset.translationSide = noteSide;
                            }
                            // Recover replies+reactions stored as JSON in subject
                            const _fbSubject = getStr(annotation.subject) || getStr(popupAnn?.subject) || '';
                            let _fbReplies = [], _fbReactions = {};
                            try {
                                if (_fbSubject.startsWith('{')) {
                                    const _fsd = JSON.parse(_fbSubject);
                                    _fbReplies = _fsd.r || [];
                                    _fbReactions = _fsd.rx || {};
                                } else if (_fbSubject.startsWith('[')) {
                                    _fbReplies = JSON.parse(_fbSubject);
                                }
                            } catch(e) {}
                            const _fbContent = (resolvedContent === _fbSubject && (_fbReplies.length > 0 || _fbSubject.startsWith('{'))) ? '' : resolvedContent;
                            
                            section.title = (resolvedAuthor ? resolvedAuthor + ': ' : '') + (_fbContent || 'Comentario');
                            
                            // Build the native annotation data object and store it on the element
                            const nativeId = 'native_' + (annotation.id || Math.random().toString(36).substr(2, 9));
                            section.id = 'cpin-' + nativeId;
                            // Check if annotation is hidden by user action
                            const _docRef = this.docs.find(d => d.id === (this.splitView[panelId]?.docId || this.activeDocId));
                            const _pageIdx = _docRef?.currentIndex;
                            const _annotRawId = String(annotation.id || '');
                            if (_docRef?.hiddenNativeAnnotIds?.[_pageIdx]?.[_annotRawId]) return;

                            const fakeObj = {
                                id: nativeId,
                                type: 'comment',
                                x: 0, y: 0,
                                text: _fbContent,
                                author: resolvedAuthor || 'Lector',
                                color: hexColor,
                                time: '',
                                replies: _fbReplies,
                                resolved: false,
                                locked: false,
                                _isNative: true,
                                _nativeRawId: _annotRawId,
                                reactions: _fbReactions
                            };
                            section._nativeCommentObj = fakeObj;
                            
                            // Hover effects
                            section.addEventListener('mouseenter', () => {
                                section.style.transform = 'scale(1.22)';
                                section.style.filter = 'drop-shadow(0 3px 10px rgba(0,0,0,0.45)) brightness(1.1)';
                            });
                            section.addEventListener('mouseleave', () => {
                                section.style.transform = '';
                                section.style.filter = '';
                            });

                            // Click event to open the comment popup
                            section.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                
                                this.openCommentPopup(fakeObj.id, section, section._nativeCommentObj);
                            });

                            // Right-click to open comment context menu
                            section.addEventListener('contextmenu', (ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                this.openCommentCtxMenu(ev, fakeObj.id);
                            });
                        }
                        else if (annotation.subtype === 'Highlight' || annotation.subtype === 'Underline' || annotation.subtype === 'StrikeOut' || annotation.subtype === 'Squiggly') {
                            // Markup annotations
                            section.classList.add('markupAnnotation');
                            if (annotation.subtype === 'Highlight') section.classList.add('highlightAnnotation');
                            const c = annotation.color || { r: 255, g: 235, b: 59 };
                            let r = c[0] !== undefined ? c[0] : (c.r || 255);
                            let g = c[1] !== undefined ? c[1] : (c.g || 235);
                            let b = c[2] !== undefined ? c[2] : (c.b || 59);
                            if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
                                r = Math.round(r * 255); g = Math.round(g * 255); b = Math.round(b * 255);
                            }
                            const colorStr = `rgba(${r},${g},${b},0.4)`;
                            if (annotation.subtype === 'Highlight') {
                                // Highlight color is already rendered on the PDF canvas;
                                // this section is only an invisible hover zone for tooltips
                                section.style.background = 'transparent';
                            } else if (annotation.subtype === 'Underline') {
                                section.style.borderBottom = `2px solid rgba(${r},${g},${b},0.9)`;
                            } else if (annotation.subtype === 'StrikeOut') {
                                section.style.borderTop = `2px solid rgba(${r},${g},${b},0.9)`;
                                section.style.marginTop = (height / 2) + 'px';
                            } else if (annotation.subtype === 'Squiggly') {
                                section.style.borderBottom = `2px dotted rgba(${r},${g},${b},0.9)`;
                            }

                            const popupAnn = popupMap[annotation.id] || popupMap[String(annotation.id)];
                            const resolvedContent = getStr(annotation.contentsObj) || getStr(annotation.contents) || getStr(popupAnn?.contentsObj) || getStr(popupAnn?.contents) || getStr(annotation.subject) || '';
                            const resolvedAuthor = getStr(annotation.titleObj) || getStr(annotation.title) || getStr(annotation.author) || getStr(popupAnn?.titleObj) || getStr(popupAnn?.title) || getStr(popupAnn?.author) || '';
                            const isTranslation = resolvedAuthor.startsWith('Traducción') || resolvedAuthor.toLowerCase().includes('traducc') || (popupAnn && getStr(popupAnn.title).startsWith('Traducción'));

                            if (annotation.subtype === 'Highlight' && (resolvedContent || isTranslation) && this._isTranslatableText(resolvedContent)) {
                                section.classList.add('processed-translation-highlight', 'translation-highlight-annot');
                                const langMatch = resolvedAuthor.match(/Traducción\s*·\s*(.+)/i);
                                const targetLang = langMatch ? langMatch[1].trim() : (isTranslation ? 'Traducción' : (resolvedAuthor || 'Nota'));

                                const _docRef = this.docs.find(d => d.id === (this.splitView[panelId]?.docId || this.activeDocId));
                                const _pageIdx = _docRef?.currentIndex;
                                const _annotRawId = String(annotation.id || '');
                                if (_docRef?.hiddenNativeAnnotIds?.[_pageIdx]?.[_annotRawId]) return;

                                const nativeId = 'native_hl_' + (annotation.id || Math.random().toString(36).substr(2, 9));
                                section.id = 'thover-' + nativeId;
                                section.dataset.translationNote = 'true';
                                section.dataset.translationLanguage = targetLang;

                                const hexColor = '#' + [r, g, b].map(x => {
                                    const h = Math.max(0, Math.min(255, Math.round(x || 0))).toString(16);
                                    return h.length === 1 ? '0' + h : h;
                                }).join('');

                                const fakeObj = {
                                    id: nativeId,
                                    type: 'comment',
                                    x: 0, y: 0,
                                    width: width,
                                    height: height,
                                    text: resolvedContent,
                                    author: resolvedAuthor || 'Traducción',
                                    translationLanguage: targetLang,
                                    translationNote: true,
                                    color: hexColor,
                                    time: '',
                                    replies: [],
                                    resolved: false,
                                    locked: false,
                                    _isNative: true,
                                    _nativeRawId: _annotRawId,
                                    reactions: {}
                                };
                                section._nativeCommentObj = fakeObj;
                                section.style.cursor = 'help';
                                section.style.pointerEvents = 'auto';
                                section.style.background = 'transparent';
                                section.style.border = 'none';
                                section.style.outline = 'none';
                                section.style.boxShadow = 'none';

                                section.addEventListener('mouseenter', (ev) => {
                                    if (document.body.classList.contains('text-select-mode') && ev.buttons !== 0) return;
                                    this.showTranslationTooltip(ev, fakeObj, section);
                                });
                                section.addEventListener('mouseleave', () => {
                                    this.hideTranslationTooltip();
                                });
                                section.addEventListener('click', (ev) => {
                                    if (document.body.classList.contains('text-select-mode')) return;
                                    ev.stopPropagation();
                                    ev.preventDefault();
                                    this.pinTranslationTooltip(ev, fakeObj, section);
                                });
                                section.addEventListener('contextmenu', (ev) => {
                                    if (document.body.classList.contains('text-select-mode')) {
                                        const sel = window.getSelection();
                                        if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) return;
                                    }
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    this.openCommentCtxMenu(ev, fakeObj.id);
                                });
                            } else {
                                section.style.pointerEvents = 'none';
                                section.style.background = 'transparent';
                                section.style.border = 'none';
                                section.style.outline = 'none';
                                section.style.boxShadow = 'none';
                                if (resolvedContent) section.title = resolvedContent;
                            }
                        }
                        else if (annotation.subtype === 'FreeText' || annotation.subtype === 'Stamp') {
                            section.classList.add('freeTextAnnotation');
                            const c = annotation.color || { r: 0, g: 0, b: 0 };
                            section.style.cssText += `
                                color:rgb(${c.r},${c.g},${c.b});
                                font-size:${Math.max(8, height * 0.5)}px;
                                overflow:hidden;display:flex;align-items:center;
                                pointer-events:none;
                            `;
                            section.textContent = annotation.contents || '';
                            if (annotation.defaultAppearance) {
                                try {
                                    const match = annotation.defaultAppearance.match(/\/(\S+)\s+([\d.]+)\s+Tf/);
                                    if (match) section.style.fontSize = Math.round(parseFloat(match[2]) * scale) + 'px';
                                } catch(e) {}
                            }
                        }

                        const markupTypes = ['Text','Highlight','Underline','StrikeOut','Squiggly','FreeText','Stamp'];
                        if (section.childNodes.length > 0 || markupTypes.includes(annotation.subtype)) {
                            annotationLayerDiv.appendChild(section);
                        }
                    });
                    this._layoutTranslationNotePins(panelId);

                } catch (e) {
                    console.warn('Error in fallback annotation rendering:', e);
                }
            },

            /**
             * Stores annotation form values for potential saving
             */
            updateSidebarSelection: function (explicitScrollIdx = null) {
                // Remove all selections first
                document.querySelectorAll('.thumb-wrap').forEach(el => {
                    el.classList.remove('selected');
                    const checkbox = el.querySelector('.thumb-select-checkbox');
                    if (checkbox) checkbox.checked = false;
                });

                const doc = this.getDoc();
                if (!doc) return;

                if (this.multiSelection.size > 0) {
                    // Mark all selected pages
                    this.multiSelection.forEach(idx => {
                        const el = document.getElementById('thumb-' + idx);
                        if (el) {
                            el.classList.add('selected');
                            const checkbox = el.querySelector('.thumb-select-checkbox');
                            if (checkbox) checkbox.checked = true;
                        }
                    });

                    // Scroll logic priority:
                    // 1. Explicit request (e.g. from Shift-Click)
                    // 2. Last clicked index (state)
                    // 3. Current document index (fallback)
                    let scrollTargetIdx = doc.currentIndex;

                    if (explicitScrollIdx !== null) {
                        scrollTargetIdx = explicitScrollIdx;
                    } else if (this.lastClickIndex !== null) {
                        scrollTargetIdx = this.lastClickIndex;
                    }

                    const isH = document.body.classList.contains('h-layout');
                    const scrollEl = document.getElementById('thumb-' + scrollTargetIdx);
                    if (scrollEl) {
                        if (isH) {
                            scrollEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
                        } else {
                            scrollEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                        }
                    }
                } else {
                    // En cuadrícula, una selección vacía debe mostrarse vacía: los
                    // checkboxes representan una selección explícita de páginas.
                    if (document.getElementById('sidebar')?.classList.contains('fullscreen-grid')) {
                        this._updateGridSelectAllButton?.();
                        return;
                    }
                    const idx = doc.currentIndex;
                    const el = document.getElementById('thumb-' + idx);
                    if (el) {
                        el.classList.add('selected');
                        const checkbox = el.querySelector('.thumb-select-checkbox');
                        if (checkbox) checkbox.checked = true;
                        const isH = document.body.classList.contains('h-layout');
                        if (isH) {
                            el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
                        } else {
                            el.scrollIntoView({ block: 'center', behavior: 'instant' });
                        }
                    }
                }
                this._updateGridSelectAllButton?.();
            },

            _sidebarDropIndex: function (event, doc) {
                const horizontal = document.body.classList.contains('h-layout');
                const position = horizontal ? event.clientX : event.clientY;
                const thumbs = document.querySelectorAll('#sidebarList .thumb-wrap');
                const target = event.target.closest('.thumb-wrap');
                const candidates = target ? [target] : thumbs;
                for (const thumb of candidates) {
                    const index = Number(thumb.dataset.index);
                    const rect = thumb.getBoundingClientRect();
                    const midpoint = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
                    if (position < midpoint) return index;
                    if (target) return index + 1;
                }
                return doc.pages.length;
            },

            renderSidebar: function () {
                const doc = this.getDoc();
                const l = document.getElementById('sidebarList');
                if (!l) return;

                const isH = document.body.classList.contains('h-layout');
                if (isH) {
                    this._thumbTargetHeight = 65;
                    this._thumbTargetWidth = null;
                } else {
                    this._thumbTargetHeight = null;
                    // Medir sidebar DESPUÉS de que el DOM tenga dimensiones correctas
                    const sb = document.getElementById('sidebar');
                    const sbW = sb ? (sb.offsetWidth || 150) : 150;
                    this._thumbTargetWidth = Math.max(60, Math.min(300, sbW - 32));
                }

                // Reset thumbnail queue on sidebar rebuild
                this._thumbQueue = [];
                this._thumbActive = 0;

                // Destruir observer anterior para que los nuevos elementos reciban el target correcto
                if (this._sidebarObserver) {
                    this._sidebarObserver.disconnect();
                    this._sidebarObserver = null;
                }

                l.innerHTML = '';
                if (!doc) return;

                // Invalidar caché de miniaturas cuando el modo de layout cambió
                const _currentMode = isH ? 'h' : 'v';
                if (this._lastSidebarMode && this._lastSidebarMode !== _currentMode) {
                    doc.pages.forEach(p => { p._thumbCache = null; p._thumbCacheObjects = undefined; });
                }
                this._lastSidebarMode = _currentMode;

                // Crear nuevo IntersectionObserver (el anterior fue destruido arriba)
                this._sidebarObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const el = entry.target;
                            if (!el.dataset.rendered) {
                                el.dataset.rendered = "true";
                                this._enqueueThumbnail(el);
                            }
                        }
                    });
                }, { root: l, rootMargin: '200px' });

                doc.pages.forEach((p, i) => {
                    const d = document.createElement('div');
                    d.className = 'thumb-wrap';
                    d.id = 'thumb-' + i;
                    d.dataset.index = i; // Store page index for lazy loading
                    d.innerHTML = `<label class="thumb-select" title="Seleccionar página ${i + 1}"><input class="thumb-select-checkbox" type="checkbox" aria-label="Seleccionar página ${i + 1}"></label><canvas width="100" height="130"></canvas><div class="thumb-num">${i + 1}</div>`;
                    // bookmark dot — will be set by BookmarkManager.refreshThumbDots()
                    if (window.BookmarkManager) BookmarkManager._injectThumbDot(d, i);

                    d.onclick = (e) => {
                        if (e.button !== 0) return; // Only left click
                        if (e.target.closest('.thumb-select')) {
                            const checkbox = e.target.closest('.thumb-select').querySelector('input');
                            if (checkbox.checked) this.multiSelection.add(i);
                            else this.multiSelection.delete(i);
                            this.lastClickIndex = i;
                            this.updateSidebarSelection(i);
                            return;
                        }
                        if (e.ctrlKey || e.metaKey) {
                            if (this.multiSelection.has(i)) this.multiSelection.delete(i);
                            else { this.multiSelection.add(i); this.lastClickIndex = i; }
                        }
                        else if (e.shiftKey && this.lastClickIndex !== null) {
                            const start = Math.min(this.lastClickIndex, i);
                            const end = Math.max(this.lastClickIndex, i);
                            this.multiSelection.clear();
                            for (let k = start; k <= end; k++) this.multiSelection.add(k);
                        }
                        else {
                            if (!this.multiSelection.has(i) || this.multiSelection.size === 1) {
                                this.multiSelection.clear();
                                this.multiSelection.add(i);
                                this.loadPage(i);
                                this.lastClickIndex = i;
                            } else {
                                this.loadPage(i);
                                this.lastClickIndex = i;
                            }
                        }
                        this.updateSidebarSelection(i);
                    };

                    d.oncontextmenu = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        this.sidebarCtxIndex = i;
                        const buildSubMenu = (action) => {
                            const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                            let html = '';
                            if (app.docs.length === 1) html += `<div class="ctx-item" onclick="app.sidebarAction('${action}', 'new')">${t('ctx_new_tab', 'Nueva Pestaña')}</div>`;
                            else {
                                app.docs.forEach((doc, idx) => { html += `<div class="ctx-item" onclick="app.sidebarAction('${action}', '${doc.id}')">${idx + 1}. ${doc.name}</div>`; });
                                html += `<div class="ctx-divider"></div><div class="ctx-item" onclick="app.sidebarAction('${action}', 'new')">${t('ctx_new_tab', 'Nueva Pestaña')}</div>`;
                            }
                            return html;
                        };
                        document.getElementById('ctx-copy-submenu').innerHTML = buildSubMenu('copy_to');
                        document.getElementById('ctx-move-submenu').innerHTML = buildSubMenu('move_to');
                        const ctxBmNum = document.getElementById('ctx-bm-page-num');
                        if (ctxBmNum) ctxBmNum.textContent = i + 1;

                        const cm = document.getElementById('sidebar-context-menu');
                        cm.style.display = 'flex';
                        cm.style.left = e.clientX + 'px';
                        cm.style.top = e.clientY + 'px';
                        const r = cm.getBoundingClientRect();
                        let left = e.clientX, top = e.clientY;
                        if (left + r.width > window.innerWidth) left = window.innerWidth - r.width - 4;
                        if (top + r.height > window.innerHeight) top = window.innerHeight - r.height - 4;
                        if (left < 0) left = 4;
                        if (top < 0) top = 4;
                        cm.style.left = left + 'px'; cm.style.top = top + 'px';
                    };

                    if (this.multiSelection.has(i)) d.classList.add('selected');

                    d.draggable = true;
                    d.ondragstart = e => {
                        this.isDraggingInternal = true;
                        this.draggedPageIndex = i; this.draggedDocId = doc.id;
                        if (!this.multiSelection.has(i)) {
                            this.multiSelection.clear();
                            this.multiSelection.add(i);
                            this.updateSidebarSelection();
                        }
                        const indices = Array.from(this.multiSelection).sort((a, b) => a - b);
                        const token = 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                        const pages = indices.map(idx => JSON.parse(JSON.stringify(doc.pages[idx])));
                        const sourcesBuffers = {};
                        pages.forEach(p => {
                            if (doc.sources && doc.sources[p.sourceId] && doc.sources[p.sourceId].buffer) {
                                sourcesBuffers[p.sourceId] = doc.sources[p.sourceId].buffer;
                            }
                        });
                        const payload = {
                            type: 'pages_transfer',
                            token: token,
                            sourceDocId: doc.id,
                            docName: doc.name,
                            indices: indices,
                            pages: pages,
                            sourcesBuffers: sourcesBuffers,
                            sourceWindowId: window.__aliothWindowId
                        };
                        this._saveTransferPayload(token, payload);

                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', 'alioth-page:' + token);
                        e.dataTransfer.setData('text/alioth-page-token', token);
                        e.dataTransfer.setData('text/alioth-type', 'page');
                        e.dataTransfer.setData('text/uri-list', 'http://alioth.local/page/' + token);
                        e.dataTransfer.setData('json/pages', JSON.stringify(indices));
                    };
                    d.ondragend = e => {
                        this.isDraggingInternal = false;
                        document.querySelectorAll('.thumb-wrap').forEach(t => t.classList.remove('drop-target-bottom', 'drop-target-top'));
                    };
                    d.ondragover = e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        document.querySelectorAll('.thumb-wrap').forEach(t => t.classList.remove('drop-target-bottom', 'drop-target-top'));
                        if (this._sidebarDropIndex(e, doc) === i) {
                            d.classList.add('drop-target-top');
                        } else {
                            d.classList.add('drop-target-bottom');
                        }

                        const scrollContainer = document.getElementById('sidebarList');
                        if (scrollContainer) {
                            const containerRect = scrollContainer.getBoundingClientRect();
                            const scrollThreshold = 40;
                            const scrollSpeed = 15;

                            if (e.clientY < containerRect.top + scrollThreshold) {
                                scrollContainer.scrollTop -= scrollSpeed;
                            } else if (e.clientY > containerRect.bottom - scrollThreshold) {
                                scrollContainer.scrollTop += scrollSpeed;
                            }
                        }
                    };
                    d.ondrop = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const isTop = this._sidebarDropIndex(e, doc) === i;
                        this.clearDropFeedback();
                        document.querySelectorAll('.thumb-wrap').forEach(t => t.classList.remove('drop-target-bottom', 'drop-target-top'));

                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            this.handleSidebarDrop(Array.from(e.dataTransfer.files), isTop ? i : i + 1);
                            return;
                        }

                        const rawToken = e.dataTransfer.getData('text/alioth-page-token')
                                      || e.dataTransfer.getData('text/alioth-tab-token')
                                      || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(page|tab|token):/, '');

                        // Caso A: Reordenar dentro del MISMO documento en la MISMA ventana (Page to Page local)
                        if (this.draggedDocId === doc.id && (!rawToken || !rawToken.startsWith('tab_'))) {
                            const pagesData = e.dataTransfer.getData('json/pages');
                            if (pagesData) {
                                const indices = JSON.parse(pagesData).sort((a, b) => b - a);
                                if (indices.includes(i)) return;
                                const items = [];
                                indices.forEach(idx => items.unshift(doc.pages.splice(idx, 1)[0]));
                                let targetIdx = isTop ? i : i + 1;
                                let adjustment = 0;
                                indices.forEach(idx => { if (idx < targetIdx) adjustment++; });
                                targetIdx -= adjustment;
                                doc.pages.splice(targetIdx, 0, ...items);
                                this.multiSelection.clear();
                                for (let k = 0; k < items.length; k++) this.multiSelection.add(targetIdx + k);
                                this.saveState(); this.renderSidebar(); this.loadPage(targetIdx);
                                return;
                            }
                        }

                        // Caso B: Páginas o Pestaña arrastradas desde OTRA VENTANA u OTRO DOCUMENTO (Page to Page / Tab to Page)
                        if (rawToken && (rawToken.startsWith('page_') || rawToken.startsWith('tab_') || rawToken.startsWith('local_'))) {
                            const payload = await this._fetchTransferPayload(rawToken);
                            if (payload && payload.pages && payload.pages.length) {
                                const insertIndex = isTop ? i : i + 1;
                                const newPages = await this._clonePagesAndSources(payload, doc, insertIndex);

                                this.multiSelection.clear();
                                for (let k = 0; k < newPages.length; k++) {
                                    this.multiSelection.add(insertIndex + k);
                                }
                                this.saveState();
                                this.renderSidebar();
                                if (this.viewMode === 'continuous') {
                                    this.renderContinuousContent(this.splitView.activePanel);
                                } else {
                                    this.loadPage(insertIndex);
                                }

                                if (rawToken.startsWith('tab_')) {
                                    this.showToast(`✅ ${newPages.length} página(s) de "${payload.name || 'Documento'}" insertada(s)`);
                                    if (payload.sourceWindowId === window.__aliothWindowId && (payload.docId || payload.sourceDocId)) {
                                        this.closeTab(payload.docId || payload.sourceDocId, null, true);
                                    } else if (window.aliothChannel) {
                                        window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawToken });
                                    }
                                } else {
                                    this.showToast(`✅ ${newPages.length} página(s) agregada(s)`);
                                    if (payload.sourceWindowId === window.__aliothWindowId && payload.sourceDocId && payload.sourceDocId !== doc.id) {
                                        const srcDoc = this.docs.find(d => d.id === payload.sourceDocId);
                                        if (srcDoc && payload.indices) {
                                            if (srcDoc.pages.length <= payload.pages.length) {
                                                this.closeTab(srcDoc.id, null, true);
                                            } else {
                                                [...payload.indices].sort((a, b) => b - a).forEach(idx => {
                                                    srcDoc.pages.splice(idx, 1);
                                                });
                                                if (srcDoc.currentIndex >= srcDoc.pages.length) {
                                                    srcDoc.currentIndex = Math.max(0, srcDoc.pages.length - 1);
                                                }
                                            }
                                        }
                                    } else if (window.aliothChannel && payload.sourceWindowId !== window.__aliothWindowId) {
                                        window.aliothChannel.postMessage({ type: 'page_transfer_move_ack', token: rawToken });
                                    }
                                }
                                return;
                            }
                        }
                    };

                    l.appendChild(d);
                    this._sidebarObserver.observe(d);
                });

                // Permitir soltar páginas o pestañas al final de la sidebar (espacio vacío)
                l.ondragover = e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (!e.target.closest('.thumb-wrap')) {
                        const index = this._sidebarDropIndex(e, doc);
                        document.querySelectorAll('.thumb-wrap').forEach(t => t.classList.remove('drop-target-bottom', 'drop-target-top'));
                        const thumb = document.getElementById('thumb-' + Math.max(0, index - 1));
                        thumb?.classList.add(index === 0 ? 'drop-target-top' : 'drop-target-bottom');
                    }
                };
                l.ondrop = async e => {
                    if (e.target.closest('.thumb-wrap')) return; // Ya manejado por el elemento individual
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        this.clearDropFeedback();
                        this.handleSidebarDrop(Array.from(e.dataTransfer.files), this._sidebarDropIndex(e, doc));
                        return;
                    }

                    const rawToken = e.dataTransfer.getData('text/alioth-page-token')
                                  || e.dataTransfer.getData('text/alioth-tab-token')
                                  || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(page|tab|token):/, '');

                    if (rawToken && (rawToken.startsWith('page_') || rawToken.startsWith('tab_') || rawToken.startsWith('local_'))) {
                        const payload = await this._fetchTransferPayload(rawToken);
                        if (payload && payload.pages && payload.pages.length) {
                            const insertIndex = doc.pages.length;
                            const newPages = await this._clonePagesAndSources(payload, doc, insertIndex);
                            this.multiSelection.clear();
                            for (let k = 0; k < newPages.length; k++) this.multiSelection.add(insertIndex + k);
                            this.saveState();
                            this.renderSidebar();
                            if (this.viewMode === 'continuous') {
                                this.renderContinuousContent(this.splitView.activePanel);
                            } else {
                                this.loadPage(insertIndex);
                            }

                            if (rawToken.startsWith('tab_')) {
                                this.showToast(`✅ ${newPages.length} página(s) de "${payload.name || 'Documento'}" agregada(s) al final`);
                                if (payload.sourceWindowId === window.__aliothWindowId && (payload.docId || payload.sourceDocId)) {
                                    this.closeTab(payload.docId || payload.sourceDocId, null, true);
                                } else if (window.aliothChannel) {
                                    window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawToken });
                                }
                            } else {
                                this.showToast(`✅ ${newPages.length} página(s) agregada(s) al final`);
                                if (payload.sourceWindowId === window.__aliothWindowId && payload.sourceDocId && payload.sourceDocId !== doc.id) {
                                    const srcDoc = this.docs.find(d => d.id === payload.sourceDocId);
                                    if (srcDoc && payload.indices) {
                                        if (srcDoc.pages.length <= payload.pages.length) {
                                            this.closeTab(srcDoc.id, null, true);
                                        } else {
                                            [...payload.indices].sort((a, b) => b - a).forEach(idx => {
                                                srcDoc.pages.splice(idx, 1);
                                            });
                                            if (srcDoc.currentIndex >= srcDoc.pages.length) {
                                                srcDoc.currentIndex = Math.max(0, srcDoc.pages.length - 1);
                                            }
                                        }
                                    }
                                } else if (window.aliothChannel && payload.sourceWindowId !== window.__aliothWindowId) {
                                    window.aliothChannel.postMessage({ type: 'page_transfer_move_ack', token: rawToken });
                                }
                            }
                        }
                    }
                };

                // Always sync page counter
                const count = doc.pages.length;
                this.setPageCount(count > 0 ? `${doc.currentIndex + 1} / ${count}` : '— / —');
            },

            /**
             * FIX (miniaturas lentas): actualiza SOLO la miniatura de una página, sin
             * reconstruir toda la lista de la sidebar. Antes, cualquier cambio menor
             * (cambiar color/negrita/fuente, mover un objeto, etc.) llamaba a
             * renderSidebar() completo, que hace l.innerHTML='' y recrea TODOS los
             * <div>+<canvas> del documento (uno por página) y reconecta el
             * IntersectionObserver entero — trabajo desperdiciado cuando solo cambió
             * una página. Además invalida el cache correctamente: antes _thumbCache
             * solo se invalidaba si cambiaba la CANTIDAD de objetos (p.objects.length),
             * así que editar el color/fuente de un objeto ya existente ni siquiera
             * regeneraba el bitmap cacheado.
             */
            refreshThumbnail: function (pageIndex) {
                const doc = this.getDoc();
                if (!doc || !doc.pages || !doc.pages[pageIndex]) return;
                const page = doc.pages[pageIndex];
                page._thumbCache = null;
                page._thumbCacheObjects = undefined;
                const el = document.getElementById('thumb-' + pageIndex);
                if (el) this.renderThumbnail(el);
            },

            /**
             * Thumbnail render queue (max 3 concurrent)
             */
            _thumbQueue: [],
            _thumbActive: 0,
            _thumbMaxConcurrent: 3,
            _enqueueThumbnail: function (el) {
                this._thumbQueue.push(el);
                this._runThumbQueue();
            },
            _runThumbQueue: function () {
                while (this._thumbActive < this._thumbMaxConcurrent && this._thumbQueue.length > 0) {
                    const el = this._thumbQueue.shift();
                    this._thumbActive++;
                    Promise.resolve(this.renderThumbnail(el)).finally(() => {
                        this._thumbActive--;
                        this._runThumbQueue();
                    });
                }
            },

            /**
             * Renders a single thumbnail on demand (Lazy Loading)
             */
            renderThumbnail: function (d) {
                const i = parseInt(d.dataset.index);
                const doc = this.getDoc();
                if (!doc || !doc.pages[i]) return;
                const p = doc.pages[i];
                const cvs = d.querySelector('canvas');
                if (!cvs) return;

                // NUEVO: Manejar páginas con canvas pre-generado
                if (p.canvas) {
                    const sourceWidth = p.canvas.width;
                    const sourceHeight = p.canvas.height;
                    let thumbScale = 1.0;
                    if (this._thumbTargetHeight) {
                        thumbScale = this._thumbTargetHeight / sourceHeight;
                    } else {
                        const tW = this._thumbTargetWidth || 100;
                        thumbScale = tW / sourceWidth;
                    }

                    cvs.width = sourceWidth * thumbScale;
                    cvs.height = sourceHeight * thumbScale;

                    const ctx = cvs.getContext('2d', { alpha: false });
                    ctx.clearRect(0, 0, cvs.width, cvs.height);

                    // Use cached bitmap if available and objects haven't changed
                    if (p._thumbCache instanceof ImageBitmap && p._thumbCacheObjects === p.objects.length) {
                        ctx.drawImage(p._thumbCache, 0, 0);
                    } else {
                        ctx.drawImage(p.canvas, 0, 0, cvs.width, cvs.height);

                    // Renderizar objetos encima
                    p.objects.forEach(obj => {
                        ctx.save();
                        let x = obj.x * thumbScale; let y = obj.y * thumbScale;
                        let w = obj.width * thumbScale; let h = obj.height * thumbScale;
                        let cx = x + w / 2; let cy = y + h / 2;
                        if (obj.rotation) {
                            ctx.translate(cx, cy); ctx.rotate(obj.rotation * Math.PI / 180); ctx.translate(-cx, -cy);
                        }
                        if (obj.type === 'text') {
                            const fontInfo = this.fontRegistry.fonts[obj.font];
                            const family = fontInfo ? fontInfo.family : obj.font;
                            const weight = obj.bold ? 'bold' : (fontInfo?.weight || 'normal');
                            const style = obj.italic ? 'italic' : (fontInfo?.style || 'normal');
                            ctx.font = `${style} ${weight} ${obj.size * thumbScale}px "${family}", Arial, sans-serif`;
                            ctx.fillStyle = obj.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText(obj.text, cx, cy);
                        } else if (obj.type === 'rect') {
                            ctx.fillStyle = obj.color || '#000000';
                            ctx.fillRect(x, y, w, h);
                        } else if (obj.type === 'drawing' && obj.drawType === 'line') {
                            ctx.strokeStyle = obj.color || '#000000';
                            ctx.lineWidth = (obj.lineWidth || 2) * thumbScale;
                            ctx.beginPath();
                            ctx.moveTo(x, y + h / 2);
                            ctx.lineTo(x + w, y + h / 2);
                            ctx.stroke();
                        }
                        ctx.restore();
                    });
                    // Save bitmap cache
                    createImageBitmap(cvs).then(bmp => this.cacheThumbnail(p, bmp, p.objects.length, doc)).catch(() => {});
                    }
                    return;
                }

                // Código original para páginas PDF normales
                const s = doc.sources[p.sourceId];

                // Página en blanco
                if (p._blank || !s) {
                    if (this._thumbTargetHeight) {
                        cvs.height = this._thumbTargetHeight;
                        const ratio = (p.width || 612) / (p.height || 792);
                        cvs.width = Math.round(this._thumbTargetHeight * ratio);
                    } else {
                        const tW = this._thumbTargetWidth || 100;
                        const ratio = (p.height || 792) / (p.width || 612);
                        cvs.width = tW;
                        cvs.height = Math.round(tW * ratio);
                    }
                    const ctx = cvs.getContext('2d', { alpha: false });
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, cvs.width, cvs.height);
                    return;
                }

                if (s && s.buffer) {
                    // Return cached bitmap immediately if valid
                    if (p._thumbCache instanceof ImageBitmap && p._thumbCacheObjects === p.objects.length) {
                        const ctx0 = cvs.getContext('2d', { alpha: false });
                        cvs.width = p._thumbCache.width; cvs.height = p._thumbCache.height;
                        ctx0.drawImage(p._thumbCache, 0, 0);
                        return;
                    }
                    const promise = this.loadSourcePdf(s).then(d => d.getPage(p.pageIndex + 1));
                    promise.then(pg => {
                        const standardVp = pg.getViewport({ scale: 1 });
                        if (!standardVp.width || !standardVp.height || isNaN(standardVp.width)) return; // guard
                        const rot = (pg.rotate + p.rotation) % 360;
                        const isRotated = rot === 90 || rot === 270;
                        const actualWidth = isRotated ? standardVp.height : standardVp.width;
                        const actualHeight = isRotated ? standardVp.width : standardVp.height;

                        let thumbScale = 1.0;
                        if (this._thumbTargetHeight) {
                            thumbScale = this._thumbTargetHeight / actualHeight;
                        } else {
                            const tW = this._thumbTargetWidth || 100;
                            thumbScale = tW / actualWidth;
                        }
                        if (!thumbScale || isNaN(thumbScale) || thumbScale <= 0) return; // guard
                        const vp = pg.getViewport({ scale: thumbScale, rotation: rot });
                        if (!vp.width || !vp.height || isNaN(vp.width)) return; // guard
                        cvs.width = vp.width; cvs.height = vp.height;
                        const ctx = cvs.getContext('2d', { alpha: false });
                        ctx.fillStyle = '#ffffff';
                        const thumbRenderParams = { canvasContext: ctx, viewport: vp };
                        if (s && s.optionalContentConfigPromise) {
                            thumbRenderParams.optionalContentConfigPromise = s.optionalContentConfigPromise;
                        }
                        const renderTask = pg.render(thumbRenderParams);
                        renderTask.promise.then(() => {
                            if (p.flipH || p.flipV) {
                                const tempCvs = document.createElement('canvas');
                                tempCvs.width = cvs.width;
                                tempCvs.height = cvs.height;
                                const tempCtx = tempCvs.getContext('2d', { alpha: false });
                                tempCtx.drawImage(cvs, 0, 0);

                                ctx.save();
                                ctx.translate(cvs.width / 2, cvs.height / 2);
                                ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
                                ctx.drawImage(tempCvs, -cvs.width / 2, -cvs.height / 2);
                                ctx.restore();
                            }
                            p.objects.forEach(obj => {
                                ctx.save();
                                let x = obj.x * thumbScale; let y = obj.y * thumbScale;
                                let w = obj.width * thumbScale; let h = obj.height * thumbScale;
                                let cx = x + w / 2; let cy = y + h / 2;
                                if (obj.rotation) {
                                    ctx.translate(cx, cy); ctx.rotate(obj.rotation * Math.PI / 180); ctx.translate(-cx, -cy);
                                }
                                if (obj.type === 'text') {
                                    const fontInfo = this.fontRegistry.fonts[obj.font];
                                    const family = fontInfo ? fontInfo.family : obj.font;
                                    const weight = obj.bold ? 'bold' : (fontInfo?.weight || 'normal');
                                    const style = obj.italic ? 'italic' : (fontInfo?.style || 'normal');
                                    ctx.font = `${style} ${weight} ${obj.size * thumbScale}px "${family}", Arial, sans-serif`;
                                    ctx.fillStyle = obj.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(obj.text, cx, cy);
                                } else if (obj.type === 'shape') {
                                    ctx.fillStyle = obj.noFill ? 'transparent' : obj.fill;
                                    ctx.strokeStyle = obj.noBorder ? 'transparent' : obj.stroke;
                                    ctx.lineWidth = (obj.strokeWidth || 1) * thumbScale;
                                    if (obj.shapeType === 'rect' || obj.shapeType === 'round_rect') {
                                        if (!obj.noFill) ctx.fillRect(x, y, w, h);
                                        if (!obj.noBorder) ctx.strokeRect(x, y, w, h);
                                    } else if (obj.shapeType === 'circle') {
                                        ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, 2 * Math.PI);
                                        if (!obj.noFill) ctx.fill(); if (!obj.noBorder) ctx.stroke();
                                    } else {
                                        ctx.beginPath(); ctx.rect(x, y, w, h);
                                        if (!obj.noFill) ctx.fill(); if (!obj.noBorder) ctx.stroke();
                                    }
                                } else if (obj.type === 'form-field') {
                                    const _thumbBg = obj.noBg ? 'transparent' : (obj.backgroundColor || '#f5f5f5');
                                    ctx.fillStyle = _thumbBg;
                                    ctx.strokeStyle = obj.borderColor || '#999999';
                                    ctx.lineWidth = Math.max(1, (obj.borderWidth || 1) * thumbScale);

                                    if (_thumbBg !== 'transparent') ctx.fillRect(x, y, w, h);
                                    if (obj.borderStyle !== 'none') {
                                        ctx.strokeRect(x, y, w, h);
                                    }

                                    if (obj.fieldType === 'calendar' && obj.calendarState) {
                                        const cs = obj.calendarState;
                                        const headerH = h * 0.15;
                                        ctx.fillStyle = cs.headerColor || '#e0e0e0';
                                        ctx.fillRect(x, y, w, headerH);

                                        ctx.strokeStyle = '#ddd';
                                        ctx.lineWidth = 0.5;
                                        const cellW = w / 7;
                                        const cellH = (h - headerH) / 6;
                                        for (let row = 0; row < 6; row++) {
                                            for (let col = 0; col < 7; col++) {
                                                ctx.strokeRect(x + col * cellW, y + headerH + row * cellH, cellW, cellH);
                                            }
                                        }
                                    }
                                }
                                ctx.restore();
                            });
                            // Save bitmap cache
                            createImageBitmap(cvs).then(bmp => this.cacheThumbnail(p, bmp, p.objects.length, doc)).catch(() => {});
                        });
                    }).catch(e => console.error(e));
                }
            },
            sidebarAction: function (action, targetId) {
                document.getElementById('sidebar-context-menu').style.display = 'none';
                const sourceDoc = this.getDoc(); if (!sourceDoc) return;
                this.saveState();

                let targets = [];
                if (this.multiSelection.size > 0) {
                    targets = Array.from(this.multiSelection).sort((a, b) => a - b); // ascendente = orden documental
                } else if (this.sidebarCtxIndex !== null) {
                    targets = [this.sidebarCtxIndex];
                }
                if (targets.length === 0) return;

                if (action === 'add_selection') {
                    if (this.sidebarCtxIndex !== null) {
                        this.multiSelection.add(this.sidebarCtxIndex);
                        this.updateSidebarSelection();
                    }
                    return;
                }

                if (action === 'copy_to' || action === 'move_to') {
                    let targetDoc;
                    let isNewTab = false;
                    if (targetId === 'new') {
                        const newId = this.createNewTab("Copia");
                        targetDoc = this.docs.find(d => d.id === newId);
                        isNewTab = true;
                    } else {
                        targetDoc = this.docs.find(d => d.id === targetId);
                    }

                    if (targetDoc) {
                        // Recolectar en orden ascendente (orden documental)
                        const itemsToMove = targets.map(idx => {
                            const p = JSON.parse(JSON.stringify(sourceDoc.pages[idx]));
                            p.id = Math.random().toString(36);
                            if (sourceDoc.sources[p.sourceId]) targetDoc.sources[p.sourceId] = sourceDoc.sources[p.sourceId];
                            return p;
                        });
                        // Para move_to: splice en reversa para no desplazar índices
                        if (action === 'move_to') {
                            [...targets].reverse().forEach(idx => sourceDoc.pages.splice(idx, 1));
                        }

                        targetDoc.pages.push(...itemsToMove);
                        this.showToast(`${itemsToMove.length} copiado`);

                        if (isNewTab) {
                            this.switchTab(targetDoc.id); this.loadPage(0); this.renderSidebar();
                        } else {
                            if (action === 'move_to' && targetId !== sourceDoc.id) {
                                this.switchTab(sourceDoc.id);
                                this.multiSelection.clear();
                                this.loadPage(Math.min(sourceDoc.currentIndex, sourceDoc.pages.length - 1));
                                this.renderSidebar();
                            } else if (targetId === app.activeDocId) {
                                this.renderSidebar();
                            }
                        }
                    }
                }
                else if (action === 'delete') {
                    [...targets].reverse().forEach(idx => sourceDoc.pages.splice(idx, 1)); // reversa para no desplazar índices
                    this.multiSelection.clear();
                    this.loadPage(Math.min(targets[0], sourceDoc.pages.length - 1));
                    this.renderSidebar();
                }
                else if (action === 'duplicate') {
                    [...targets].reverse().forEach(idx => { // reversa para no desplazar índices
                        const p = JSON.parse(JSON.stringify(sourceDoc.pages[idx]));
                        p.id = Math.random().toString(36);
                        sourceDoc.pages.splice(idx + 1, 0, p);
                    });
                    this.renderSidebar();
                }
                else if (action === 'rotate_r') {
                    targets.forEach(idx => sourceDoc.pages[idx].rotation = (sourceDoc.pages[idx].rotation + 90) % 360);
                    this.loadPage(sourceDoc.currentIndex);
                    this.renderSidebar();
                }
                else if (action === 'rotate_l') {
                    targets.forEach(idx => sourceDoc.pages[idx].rotation = (sourceDoc.pages[idx].rotation - 90 + 360) % 360);
                    this.loadPage(sourceDoc.currentIndex);
                    this.renderSidebar();
                }
            },

            // ============================================================
            // SECTION 4: OBJECTS (Text, Image, Shape, Stamp)
            // ============================================================

            /**
             * Adds a new text object to the current page
             * @param {string} initialText - Initial text content
             */
            /**
             * Si está en modo continuo, lo desactiva silenciosamente antes de usar una herramienta incompatible.
             * Guarda flag para restaurar al salir de la herramienta.
             */
            _exitContinuousIfNeeded: function () {
                if (this.viewMode === 'continuous') {
                    this._wasInContinuous = true;
                    const _exitPanel = this.splitView.activePanel || 'primary';
                    const _exitMV = this.getPanelElements(_exitPanel)?.mainView;
                    const _exitST = _exitMV ? _exitMV.scrollTop : 0;
                    const _exitSL = _exitMV ? _exitMV.scrollLeft : 0;

                    // Calcular offset dentro de la página activa (para restaurar en single)
                    const _doc0 = this.getDoc();
                    let _scrollOffsetInPage = 0;
                    if (_doc0 && _exitMV) {
                        const _pw = document.getElementById(`page-wrapper-${_exitPanel}-${_doc0.currentIndex}`);
                        if (_pw && _exitMV) {
                            const _mvRect = _exitMV.getBoundingClientRect();
                            const _pwRect = _pw.getBoundingClientRect();
                            const _pwTop = _pwRect.top - _mvRect.top + _exitMV.scrollTop;
                            _scrollOffsetInPage = _exitST - _pwTop;
                        }
                    }
                    this._exitContinuousScrollOffset = Math.max(0, _scrollOffsetInPage);
                    this._exitContinuousScrollLeft = Math.max(0, _exitSL);

                    if (_exitMV) {
                        _exitMV.style.overflow = 'hidden';
                        _exitMV.scrollTo({ top: _exitST, behavior: 'instant' });
                    }
                    this._rescueCanvasFromContinuous('primary');
                    this._rescueCanvasFromContinuous('secondary');
                    this.viewMode = 'single';
                    const btn = document.getElementById('toggleContinuous');
                    if (btn) btn.classList.remove('active-view');
                    const _doc = this.getDoc();
                    if (_doc) {
                        const _activePanel = this.splitView.activePanel || 'primary';
                        if (this.splitView[_activePanel]) {
                            this.splitView[_activePanel].pageIndex = _doc.currentIndex;
                        }
                    }
                    this._suppressScrollIntoView = true;
                    this.renderPanelContent('primary');
                    if (this.splitView.mode !== 'single') {
                        this._suppressScrollIntoView = true;
                        this.renderPanelContent('secondary');
                    }
                    // Restaurar scroll al mismo offset dentro de la página activa
                    if (_exitMV) {
                        const _mv = _exitMV;
                        const _offset = this._exitContinuousScrollOffset || 0;
                        const _left = this._exitContinuousScrollLeft || 0;
                        const _restoreScroll = () => {
                            _mv.scrollTo({ top: _offset, left: _left, behavior: 'instant' });
                            _mv.style.overflow = '';
                        };
                        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(_restoreScroll)));
                    }
                    this.showToast('Vista continua pausada — se restaurará al deseleccionar');
                }
            },

            /**
             * Restaura la vista continua si fue desactivada automáticamente por una herramienta incompatible.
             */
            _restoreContinuousIfNeeded: function () {
                if (!this._wasInContinuous) return;
                // Si hay objetos seleccionados, esperar
                if (this.selectedObj || (this.multiObjectSelection && this.multiObjectSelection.size > 0)) return;
                // Limpiar flag PRIMERO para evitar re-entradas
                this._wasInContinuous = false;
                if (this.viewMode === 'single') {
                    const _doc2 = this.getDoc();
                    const _ap2 = this.splitView.activePanel || 'primary';
                    const _ps2 = this.splitView[_ap2];
                    // Asegurar que panelState.pageIndex esté sincronizado antes de renderizar
                    if (_doc2 && _ps2) _ps2.pageIndex = _doc2.currentIndex;
                    this.viewMode = 'continuous';
                    this._pendingContinuousScrollOffset = {
                        panelId: _ap2,
                        offset: this._exitContinuousScrollOffset || 0,
                        wasHorizontal: document.body.classList.contains('h-layout')
                    };
                    const btn = document.getElementById('toggleContinuous');
                    if (btn) btn.classList.add('active-view');
                    this._suppressScrollIntoView = true;
                    this.renderPanelContent('primary');
                    if (this.splitView.mode !== 'single') {
                        this._suppressScrollIntoView = true;
                        this.renderPanelContent('secondary');
                    }
                    this.showToast('Vista continua restaurada');
                }
            },

            redrawDrawings: function (skipClear, panelId = null) {
                const targetPanel = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(targetPanel);
                const cvs = elements.drawingLayer;
                if (!cvs) return;
                const ctx = cvs.getContext('2d');
                if (!skipClear) ctx.clearRect(0, 0, cvs.width, cvs.height);

                // Get document for this panel
                const panelState = this.splitView[targetPanel];
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const scale = panelState?.scale || this.currentScale;

                // Guard: ensure page exists before accessing objects
                const currentPage = doc.pages[doc.currentIndex];
                if (!currentPage || !currentPage.objects) return;

                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                currentPage.objects.forEach(o => {
                    if (o.type === 'drawing' && o.isHighlighter) {
                        // ✅ CORRECCIÓN: Validar que path exista y tenga elementos
                        if (!o.path || !Array.isArray(o.path) || o.path.length === 0) return;

                        ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = o.width * scale;
                        const rgb = o.color.startsWith('#') ? hexToRgbVals(o.color) : { r: 255, g: 255, b: 0 };
                        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`;
                        if (o.path.length) {
                            ctx.moveTo(o.path[0].x * scale, o.path[0].y * scale);
                            for (let i = 1; i < o.path.length; i++) ctx.lineTo(o.path[i].x * scale, o.path[i].y * scale);
                            ctx.stroke();
                        }
                    }
                });
                ctx.restore();
                currentPage.objects.forEach(o => {
                    if (o.type === 'drawing' && !o.isHighlighter) {
                        // ✅ CORRECCIÓN: Validar que path exista y tenga elementos
                        if (!o.path || !Array.isArray(o.path) || o.path.length === 0) return;

                        ctx.beginPath(); ctx.lineWidth = o.width * scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                        if (o.isEraser) { ctx.globalCompositeOperation = 'destination-out'; }
                        else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = o.color; }
                        if (o.path.length) {
                            ctx.moveTo(o.path[0].x * scale, o.path[0].y * scale);
                            for (let i = 1; i < o.path.length; i++) ctx.lineTo(o.path[i].x * scale, o.path[i].y * scale);
                            ctx.stroke();
                        }
                        ctx.globalCompositeOperation = 'source-over';
                    }
                });
            },

            renderOverlays: function (panelId = null) {
                const targetPanel = panelId || this.splitView.activePanel;
                const elements = this.getPanelElements(targetPanel);
                const l = elements.overlayLayer;
                if (!l) return;
                l.querySelectorAll('.text-content[contenteditable="true"]').forEach(span => { span._overlayRebuilding = true; });
                l.innerHTML = '';

                // Get document for this panel
                const panelState = this.splitView[targetPanel];
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const scale = panelState?.scale || this.currentScale;

                // Only render search highlights on active panel
                if (targetPanel === this.splitView.activePanel) {
                    this.renderSearchHighlights();
                }

                // Guard: ensure page exists before accessing objects
                const currentPage = doc.pages[doc.currentIndex];
                if (!currentPage || !currentPage.objects) return;

                currentPage.objects.forEach(o => {
                    if (o.type === 'drawing') return;
                    if (o.fromFormField && !this.isFieldEditMode) return;
                    const el = document.createElement('div');
                    el.className = 'draggable'; el.id = o.id;
                    if (o.isRealEdit) el.classList.add('locked'); // Bloquear movimiento en edición real
                    // Bloquear arrastre de campos de formulario cuando el modo edición está OFF
                    if (o.fromFormField && !this.isFieldEditMode) el.classList.add('locked');
                    // En interact mode: bloquear drag de form-fields y tablas para permitir interacción
                    if ((o.type === 'form-field' || o.type === 'table') && this.isFieldInteractMode) {
                        el.classList.add('locked');
                        el.classList.add('field-interact');
                    }
                    el.style.position = 'absolute'; // FORCE POSITION ABSOLUTE
                    el.style.left = (o.x * scale) + 'px';
                    el.style.top = (o.y * scale) + 'px';
                    el.style.width = (o.width * scale) + 'px';
                    el.style.height = (o.height * scale) + 'px';

                    // ✅ AJUSTE: Sincronización de Baseline entre App y PDF
                    // Para texto normal, usamos centrado vertical (coincide con heuristic del PDF)
                    // Para Smart Patch, usamos alineación quirúrgica.
                    if (o.type === 'text') {
                        el.style.display = 'flex';
                        if (o.isSmartPatch && o.ascentPx && !o._pendingRealData) {
                            el.style.alignItems = 'flex-start'; // Surgical alignment
                        } else if (o._pendingRealData) {
                            el.style.alignItems = 'flex-start'; // Real edit: alinear arriba, sin padding
                            // No poner overflow:hidden — cliparía el span en surgical single-line (height=fontSize exacto)
                        } else {
                            el.style.alignItems = 'center'; // Normal centering (matches center - size/3)
                        }
                    }

                    const scX = o.scaleX || 1; const scY = o.scaleY || 1;
                    el.style.transform = `rotate(${o.rotation}deg)`;
                    if (o.bgColor && o.bgColor !== 'transparent' && o.bgAlpha > 0) el.style.backgroundColor = hexToRgba(o.bgColor, o.bgAlpha);
                    if (o.bgImage) {
                        el.style.backgroundImage = `url(${o.bgImage})`;
                        el.style.backgroundRepeat = 'repeat';
                        el.style.backgroundSize = 'auto';
                    }

                    // ── 🔵 V5: RENDERIZADO DE RUIDO (Scanned Look) ──
                    if (o.noise) {
                        const noiseDiv = document.createElement('div');
                        noiseDiv.className = 'noise-overlay';
                        noiseDiv.style.position = 'absolute';
                        noiseDiv.style.top = '0'; noiseDiv.style.left = '0';
                        noiseDiv.style.width = '100%'; noiseDiv.style.height = '100%';
                        // Generar patrón si no existe
                        const pattern = this.generateNoisePattern ? this.generateNoisePattern(0.08) : '';
                        if (pattern) noiseDiv.style.backgroundImage = `url(${pattern})`;
                        noiseDiv.style.opacity = '0.6';
                        noiseDiv.style.pointerEvents = 'none';
                        noiseDiv.style.mixBlendMode = 'multiply';
                        noiseDiv.style.borderRadius = 'inherit'; // Respetar bordes
                        el.appendChild(noiseDiv);
                    }

                    // GENERIC BORDER RENDERER (New: Supports Text/Images/Shapes etc.)
                    // Exclude form-field as it constructs its own internal border in contentWrapper
                    if (o.type !== 'form-field') {
                        if (o.borderRadius) {
                            el.style.borderRadius = o.borderRadius + 'px';
                        }
                        if (o.borderWidth || o.borderColor) {
                            // Use defaults if missing
                            const bw = o.borderWidth !== undefined ? o.borderWidth : 0;
                            const bs = o.borderStyle || 'solid';
                            const bc = o.borderColor || 'transparent'; // Transparent if not set
                            if (bw > 0) {
                                el.style.border = `${bw}px ${bs} ${bc}`;
                                el.style.boxSizing = 'border-box';
                            }
                        }
                    }

                    if (this.multiObjectSelection.has(o.id)) {
                        el.classList.add('selected');
                        if (this.multiObjectSelection.size > 1) el.classList.add('multi-selected');
                    }

                    // --- NUEVO: RENDERIZADO DE CAMPOS DE FORMULARIO ---
                    // --- NUEVO: RENDERIZADO DE CAMPOS DE FORMULARIO MEJORADO ---
                    if (o.type === 'form-field') {
                        el.classList.add('form-field-object');
                        el.style.display = 'flex';
                        el.style.alignItems = 'stretch';
                        el.style.justifyContent = 'stretch';
                        el.style.fontSize = (12 * scale) + 'px';
                        el.style.fontFamily = 'Arial, sans-serif';
                        // overflow: hidden REMOVED to allow handles to be visible outside
                        el.style.cursor = 'move'; // Indicate draggability

                        // Determine if content should be interactive based on form mode
                        // SIMPLIFIED: Make content NON-interactive so parent gets mouse events for drag
                        // Content is purely visual - interaction happens via double-click to open properties

                        // Build dynamic border style from object properties
                        const objBorderStyle = o.borderStyle || 'solid';
                        const objBorderWidth = o.borderWidth !== undefined ? o.borderWidth : 1;
                        const objBorderColor = o.borderColor || '#999999';
                        const objBgColor = o.noBg ? 'transparent' : (o.backgroundColor || 'rgba(255,255,255,0.8)');
                        const objBorderRadius = o.borderRadius || 0;
                        const objFontColor = o.fontColor || o.textColor || '#000000';
                        const borderPart = objBorderStyle === 'none' || objBorderWidth === 0
                            ? 'border: none;'
                            : `border: ${objBorderWidth}px ${objBorderStyle} ${objBorderColor};`;

                        // Estilo base para elementos HIJOS - transparent to show contentWrapper styling
                        const inputStyle = `width: 100%; height: 100%; pointer-events: none; border: none; background: transparent; box-sizing: border-box; color: ${objFontColor};`;

                        // WRAPPER for visual content - Apply border styles HERE for visibility
                        const contentWrapper = document.createElement('div');
                        contentWrapper.style.width = '100%';
                        contentWrapper.style.height = '100%';
                        contentWrapper.style.flex = '1';
                        contentWrapper.style.alignSelf = 'stretch';
                        contentWrapper.style.display = 'flex';
                        contentWrapper.style.flexDirection = 'column';
                        contentWrapper.style.justifyContent = 'center';
                        contentWrapper.style.alignItems = 'stretch';
                        contentWrapper.style.overflow = 'hidden'; // Move overflow clipping here
                        contentWrapper.className = 'field-content';

                        // Apply border styles directly to contentWrapper
                        contentWrapper.style.boxSizing = 'border-box';
                        contentWrapper.style.borderRadius = objBorderRadius + 'px';
                        // For calendars, DON'T apply objBgColor - use calendarState.bgColor instead
                        // For checkbox/radio, DON'T apply to wrapper - they manage their own internal bg
                        if (o.fieldType !== 'calendar' && o.fieldType !== 'checkbox' && o.fieldType !== 'radio') {
                            contentWrapper.style.background = objBgColor;
                        }
                        contentWrapper.style.color = objFontColor;
                        const _isSquareType = (o.fieldType === 'checkbox' || o.fieldType === 'radio');
                        if (_isSquareType || objBorderStyle === 'none' || objBorderWidth === 0) {
                            contentWrapper.style.border = 'none';
                        } else {
                            contentWrapper.style.border = `${objBorderWidth}px ${objBorderStyle} ${objBorderColor}`;
                        }

                        const isEdit = this.isFieldEditMode;
                        const isInteract = this.isFieldInteractMode;
                        contentWrapper.style.pointerEvents = isInteract ? 'auto' : 'none';
                        // En interact mode: todos los campos son clickeables (no draggables)
                        // En edit mode: solo mover/redimensionar
                        const pointerMode = (isEdit || !isInteract) ? 'none' : 'auto';
                        const interactionAttr = isEdit ? 'readonly disabled' : '';

                        if (o.fieldType === 'text') {
                            const displayValue = o.textValue || '';
                            const _textPE = (isEdit) ? 'none' : (isInteract ? 'auto' : 'none');
                            const textControl = document.createElement(o.multiline ? 'textarea' : 'input');
                            if (!o.multiline) textControl.type = 'text';
                            textControl.value = displayValue;
                            textControl.placeholder = 'Texto...';
                            textControl.readOnly = isEdit;
                            textControl.style.cssText = `${inputStyle} padding:2px; cursor:${isEdit ? 'move' : 'text'}; pointer-events:${_textPE}; font-family:${o.font || 'Arial'}; resize:none;`;
                            this._applyNativeFieldPreviewStyle(textControl, o, scale);
                            textControl.addEventListener('input', () => {
                                const obj = this.getObjectById(o.id);
                                if (!obj) return;
                                obj.textValue = textControl.value;
                                obj.value = textControl.value;
                                this._applyNativeFieldPreviewStyle(textControl, obj, scale);
                                this.saveState();
                            });
                            contentWrapper.appendChild(textControl);
                        } else if (o.fieldType === 'checkbox') {
                            const _cbBg    = o.noBg ? 'transparent' : (o.backgroundColor && o.backgroundColor !== 'rgba(0,0,0,0)' ? o.backgroundColor : '#ffffff');
                            const _cbBd    = (o.borderWidth > 0 && o.borderStyle !== 'none') ? `${o.borderWidth*scale}px solid ${o.borderColor||'#999'}` : `${scale}px solid #999`;
                            const _cbR     = (parseFloat(o.borderRadius)||4) * scale;
                            const _cbChk   = o.checked;
                            const _cbCkCol = o.checkColor || o.fontColor || '#000000';
                            const _cbSize  = Math.min(o.width, o.height) * scale;
                            const _cbChkSvg = _cbChk ? `<svg viewBox="0 0 100 100" style="width:65%;height:65%;display:block;" xmlns="http://www.w3.org/2000/svg">
                                <polyline points="15,50 40,75 85,25" stroke="${_cbCkCol}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>` : '';
                            contentWrapper.innerHTML = `<div style="${inputStyle} display:flex; align-items:center; justify-content:center; pointer-events: ${pointerMode}; cursor:${isEdit?'move':'pointer'};"
                                onclick="${isEdit ? '' : `const obj=app.getObjectById('${o.id}');if(obj){obj.checked=!obj.checked;if(obj.groupRule==='max1'&&obj.checked)app._applyCheckboxGroupRule(obj);}app.renderOverlays();app.saveState();`}">
                                <div style="width:${_cbSize}px;height:${_cbSize}px;background:${_cbBg};border:${_cbBd};border-radius:${_cbR}px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;">
                                    ${_cbChkSvg}
                                </div>
                            </div>`;
                        } else if (o.fieldType === 'radio') {
                            const _rdBg    = o.noBg ? 'transparent' : (o.backgroundColor && o.backgroundColor !== 'rgba(0,0,0,0)' ? o.backgroundColor : '#ffffff');
                            const _rdBdCol = o.borderColor || '#999999';
                            const _rdBdW   = (o.borderWidth || 1) * scale;
                            const _rdSel   = o.selected || o.checked;
                            const _rdDotCol = o.fontColor || o.textColor || '#333333';
                            const _rdSize  = Math.min(o.width, o.height) * scale;
                            const _rdDot   = _rdSel ? `<div style="width:40%;height:40%;background:${_rdDotCol};border-radius:50%;"></div>` : '';
                            contentWrapper.innerHTML = `<div style="${inputStyle} display:flex; align-items:center; justify-content:center; pointer-events: ${pointerMode}; cursor:${isEdit?'move':'pointer'};"
                                onclick="${isEdit ? '' : `const obj=app.getObjectById('${o.id}');if(obj){obj.selected=!obj.selected;obj.checked=obj.selected;if(obj.selected&&obj.groupName)app._applyRadioGroupExclusion(obj);}app.renderOverlays();app.saveState();`}">
                                <div style="width:${_rdSize}px;height:${_rdSize}px;background:${_rdBg};border:${_rdBdW}px solid ${_rdBdCol};border-radius:50%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;">
                                    ${_rdDot}
                                </div>
                            </div>`;
                        } else if (o.fieldType === 'dropdown') {
                            const ddFont = o.font || 'Arial';
                            const ddColor = o.textColor || '#000000';
                            const ddDisplay = o.selectedValue || 'Seleccionar...';
                            const ddFontSize = this._getFormFieldPreviewFontSize(o, scale, ddDisplay);
                            const _ddPE = isEdit ? 'none' : (isInteract ? 'auto' : 'none');
                            if (isInteract && o.options && o.options.length > 0) {
                                const select = document.createElement('select');
                                select.style.cssText = `${inputStyle} font-family:${ddFont}; color:${ddColor}; font-size:${ddFontSize}px; pointer-events:auto; cursor:pointer; background:transparent; border:none; width:100%; height:100%; padding:2px 4px;`;
                                o.options.forEach(optionValue => {
                                    const option = document.createElement('option');
                                    option.value = String(optionValue);
                                    option.textContent = String(optionValue);
                                    option.selected = optionValue === o.selectedValue;
                                    select.appendChild(option);
                                });
                                select.addEventListener('change', () => {
                                    const obj = this.getObjectById(o.id);
                                    if (!obj) return;
                                    obj.selectedValue = select.value;
                                    obj.value = select.value;
                                    this._applyNativeFieldPreviewStyle(select, obj, scale);
                                    this.saveState();
                                });
                                contentWrapper.appendChild(select);
                            } else {
                                const display = document.createElement('div');
                                display.style.cssText = `${inputStyle} cursor:${isEdit ? 'move' : 'pointer'}; pointer-events:${_ddPE}; font-family:${ddFont}; color:${ddColor}; font-size:${ddFontSize}px; display:flex; align-items:center; padding:2px 4px;`;
                                const label = document.createElement('span');
                                label.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                                label.textContent = ddDisplay;
                                const arrow = document.createElement('span');
                                arrow.style.fontSize = '0.7em';
                                arrow.textContent = '▼';
                                display.append(label, arrow);
                                contentWrapper.appendChild(display);
                            }
                        } else if (o.fieldType === 'signature') {
                            const _sigClickHandler = isInteract ? `onclick="app.selectedObj=app.getObjectById('${o.id}');app.multiObjectSelection.clear();app.multiObjectSelection.add('${o.id}');app.openProperties(app.selectedObj);"` : '';
                            const _sigPE = isInteract ? 'auto' : (isEdit ? 'none' : 'none');
                            if (o.signMode === 'image' && o.signImageData) {
                                const _sigOp = (o.signOpacity || 100) / 100;
                                contentWrapper.innerHTML = `<div style="${inputStyle} display:flex; align-items:center; justify-content:center; cursor:${isEdit?'move':(isInteract?'pointer':'default')}; overflow:hidden; pointer-events:${_sigPE};" ${_sigClickHandler}>
                                    <img src="${o.signImageData}" style="max-width:100%; max-height:100%; object-fit:contain; opacity:${_sigOp}; pointer-events:none;">
                                </div>`;
                            } else {
                                const _sigLabel = o.signMode === 'image' ? '🖼 Sin imagen' : (o.signed ? '✓ Firmado' : '✍ Zona de firma');
                                const _sigColor = o.signMode === 'image' ? 'var(--text-muted)' : objFontColor;
                                contentWrapper.innerHTML = `<div style="${inputStyle} display:flex; align-items:center; justify-content:center; cursor:${isEdit?'move':(isInteract?'pointer':'pointer')}; flex-direction:column; border:2px dashed ${_sigColor}40; border-radius:4px; pointer-events:${_sigPE};" ${_sigClickHandler}>
                                    <span style="font-size:0.75em; color:${_sigColor}; text-align:center; padding:4px;">${_sigLabel}</span>
                                    ${o.signerId ? `<span style="font-size:0.65em; color:${_sigColor}80;">${o.signerId}</span>` : ''}
                                </div>`;
                            }
                        } else if (o.fieldType === 'calendar') {
                            // Calendar Preview Logic
                            const monthNum = (o.calendarState?.month !== undefined) ? o.calendarState.month : new Date().getMonth();
                            const year = (o.calendarState?.year) || new Date().getFullYear();
                            const selectedDays = o.calendarState?.selectedDays || [];
                            const style = o.calendarState?.style || 'circle';
                            const format = o.calendarState?.format || 'MM/YYYY';
                            const align = o.calendarState?.align || 'center';
                            const headerColor = o.calendarState?.headerColor || '#f0f0f0';
                            const selectColor = o.calendarState?.selectColor || '#ff0000';
                            const bgColor = o.calendarState?.bgColor || '#ffffff';

                            // Dynamic font sizing based on box dimensions - base size 15
                            const baseFontSize = 15;
                            const minDimension = Math.min(o.width, o.height);
                            const fontScale = Math.max(0.4, minDimension / 150); // Scale factor based on size

                            // Calculate font sizes dynamically
                            const calcHeaderFontSize = Math.max(8, Math.round(baseFontSize * fontScale * 1.2));
                            const calcWeekdayFontSize = Math.max(6, Math.round(baseFontSize * fontScale * 0.7));
                            const calcDayFontSize = Math.max(6, Math.round(baseFontSize * fontScale * 0.8));

                            // Format header text
                            const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                            let headerText = '';
                            if (format === 'MM/YYYY') headerText = `${String(monthNum + 1).padStart(2, '0')}/${year}`;
                            else if (format === 'MM/YY') headerText = `${String(monthNum + 1).padStart(2, '0')}/${String(year).slice(-2)}`;
                            else if (format === 'MMMM YYYY') headerText = `${monthNames[monthNum]} ${year}`;
                            else if (format === 'MMMM YY') headerText = `${monthNames[monthNum]} ${String(year).slice(-2)}`;

                            // Calendar uses calendarState.bgColor for internal background
                            contentWrapper.style.flexDirection = 'column';
                            contentWrapper.style.justifyContent = 'flex-start';
                            // Always apply calendar's background color from calendarState
                            contentWrapper.style.backgroundColor = bgColor;

                            const header = document.createElement('div');
                            header.innerText = headerText;
                            // Use custom font size if set, otherwise use calculated
                            const headerFontSize = o.calendarState?.headerFontSize || calcHeaderFontSize;
                            header.style.fontSize = (headerFontSize * scale) + 'px';
                            header.style.borderBottom = '1px solid #ccc';
                            header.style.width = '100%';
                            header.style.textAlign = align;
                            header.style.padding = '2px 4px';
                            header.style.boxSizing = 'border-box';
                            header.style.backgroundColor = headerColor;
                            header.style.pointerEvents = 'none';
                            header.style.fontWeight = o.calendarState?.headerBold ? 'bold' : 'normal';
                            header.style.fontStyle = o.calendarState?.headerItalic ? 'italic' : 'normal';
                            const headerTextColor = o.calendarState?.headerTextColor || '#000000';
                            header.style.color = headerTextColor;
                            contentWrapper.appendChild(header);

                            const grid = document.createElement('div');
                            grid.style.display = 'grid';
                            grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
                            grid.style.width = '100%';
                            grid.style.flex = '1';
                            grid.style.pointerEvents = 'none';

                            // Text colors
                            const weekdayTextColor = o.calendarState?.weekdayTextColor || '#333333';
                            const dayTextColor = o.calendarState?.dayTextColor || '#000000';

                            // Weekday headers
                            const weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
                            const weekdayFontSize = o.calendarState?.weekdayFontSize || calcWeekdayFontSize;
                            weekdays.forEach(wd => {
                                const wdCell = document.createElement('div');
                                wdCell.innerText = wd;
                                wdCell.style.fontSize = (weekdayFontSize * scale) + 'px';
                                wdCell.style.textAlign = 'center';
                                wdCell.style.fontWeight = o.calendarState?.weekdayBold ? 'bold' : 'normal';
                                wdCell.style.fontStyle = o.calendarState?.weekdayItalic ? 'italic' : 'normal';
                                wdCell.style.borderBottom = '1px solid #ddd';
                                wdCell.style.color = weekdayTextColor;
                                grid.appendChild(wdCell);
                            });

                            // Calculate first day of month offset (0=Sunday, adjust for Monday start)
                            const firstDayOfMonth = new Date(year, monthNum, 1).getDay();
                            const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Monday = 0
                            for (let blank = 0; blank < offset; blank++) {
                                const emptyCell = document.createElement('div');
                                grid.appendChild(emptyCell);
                            }

                            const daysInMonth = new Date(year, monthNum + 1, 0).getDate();
                            const dayFontSize = o.calendarState?.dayFontSize || calcDayFontSize;
                            for (let i = 1; i <= daysInMonth; i++) {
                                const day = document.createElement('div');
                                day.style.fontSize = (dayFontSize * scale) + 'px';
                                day.innerText = i;
                                day.style.textAlign = 'center';
                                day.style.display = 'flex';
                                day.style.alignItems = 'center';
                                day.style.justifyContent = 'center';
                                day.style.fontWeight = o.calendarState?.dayBold ? 'bold' : 'normal';
                                day.style.fontStyle = o.calendarState?.dayItalic ? 'italic' : 'normal';
                                day.style.color = dayTextColor;
                                if (selectedDays.includes(i)) {
                                    if (style === 'fill') {
                                        day.style.backgroundColor = selectColor;
                                        day.style.color = 'white';
                                    } else { // circle
                                        day.style.border = `1px solid ${selectColor}`;
                                    }
                                    day.style.borderRadius = '50%';
                                }
                                grid.appendChild(day);
                            }
                            contentWrapper.appendChild(grid);
                        }

                        el.appendChild(contentWrapper);

                        // INTERACTION SHIELD - KEY FIX
                        // This invisible layer covers the content and captures ALL mouse events
                        // ensuring the parent draggable element always receives the events.
                        const shield = document.createElement('div');
                        shield.className = 'interaction-shield';
                        shield.style.position = 'absolute';
                        shield.style.top = '0';
                        shield.style.left = '0';
                        shield.style.width = '100%';
                        shield.style.height = '100%';
                        shield.style.zIndex = '10'; // Higher than content
                        shield.style.cursor = isEdit ? 'move' : (o.fieldType === 'text' ? 'text' : 'pointer');
                        // In Edit Mode, shield captures everything for drag.
                        // In Interaction Mode, shield is transparent to clicks so inputs below work.
                        shield.style.pointerEvents = isEdit ? 'auto' : 'none';
                        el.appendChild(shield);

                        // Eventos - Double click to open properties (SOLO si el modo edición está activo)
                        el.addEventListener('dblclick', (e) => {
                            if (!this.isFieldEditMode) return; // Ignorar si el toggle está OFF
                            e.preventDefault();
                            e.stopPropagation();
                            this.selectedObj = o;
                            this.openProperties(o);
                        });


                        const unusedContextMenu = (e) => {
                            e.preventDefault(); e.stopPropagation();
                            this.selectedObj = o;
                            this.multiObjectSelection.clear();
                            this.multiObjectSelection.add(o.id);
                            this.showContextMenu(e, o);
                        };

                        // Note: onclick removed - onmousedown handles selection to avoid renderOverlays conflict

                        // DRAG HANDLER - Enabled by Interaction Shield
                        // Handler removed - delegated
                        const unusedMouseHandler = (e) => {
                            if (this.isHandMode) return;

                            // CRITICAL FIX: Explicitly set active panel to ensure startDrag finds correct elements
                            // This prevents race condition where global mousedown hasn't updated activePanel yet
                            this.splitView.activePanel = targetPanel;

                            // Shield handles blocking, so we just propagate
                            e.preventDefault();
                            e.stopPropagation();

                            // Handle selection logic
                            if (e.shiftKey) {
                                if (this.multiObjectSelection.has(o.id)) {
                                    this.multiObjectSelection.delete(o.id);
                                    if (this.selectedObj && this.selectedObj.id === o.id) this.selectedObj = null;
                                } else {
                                    this.multiObjectSelection.add(o.id);
                                    this.selectedObj = o;
                                }
                            } else {
                                if (!this.multiObjectSelection.has(o.id)) {
                                    this.multiObjectSelection.clear();
                                    this.multiObjectSelection.add(o.id);
                                    this.selectedObj = o;
                                } else {
                                    this.selectedObj = o;
                                }
                            }

                            // Verify selection visually
                            document.querySelectorAll('.draggable.selected').forEach(d => d.classList.remove('selected'));
                            el.classList.add('selected');

                            this.startDrag(e, el, o);
                        };
                        console.log('Form field shield ready:', o.id);
                    }

                    else if (o.type === 'text') {
                        const span = document.createElement('div');
                        span.className = 'text-content';
                        span.innerText = o.text;
                        span.style.textAlign = o.alignment || 'left';
                        span.style.whiteSpace = o.isParagraph ? 'pre-wrap' : 'nowrap';
                        span.style.padding = '0';
                        span.style.margin = '0';
                        // Real edit: height auto elimina el hueco inferior (el .draggable ya tiene altura exacta)
                        if (o._pendingRealData) { span.style.height = 'auto'; span.style.overflow = 'visible'; if (!o.isParagraph) span.style.whiteSpace = 'nowrap'; if (o.isParagraph) { el.style.height = 'auto'; el.style.overflow = 'visible'; } }
                        // DEBUG PADDING
                        if (o.isSmartPatch) {
                        }

                        // ✅ AJUSTE DINÁMICO DE FLEX PARA ALINEACIÓN
                        // El contenedor (el) es flex row → justifyContent controla la alineación horizontal
                        {
                            const _jc = o.alignment === 'center' ? 'center'
                                      : o.alignment === 'right'  ? 'flex-end'
                                      : 'flex-start';
                            el.style.justifyContent = _jc;
                        }
                        // Para párrafos con wrapping, también aplicar text-align al span
                        if (o.isParagraph) {
                            if (o.alignment === 'justify') {
                                span.style.textAlign = 'justify';
                                span.style.width = '100%';
                                el.style.justifyContent = 'flex-start';
                            } else {
                                span.style.textAlign = o.alignment || 'left';
                                span.style.width = '100%';
                            }
                        }
                        // Conversión de letterSpacing de PDF units a CSS px (ajustado por escala)
                        const lsEm = (o.letterSpacing || 0) / 100; // Si es porcentaje
                        span.style.letterSpacing = (lsEm * o.size * scale) + 'px';

                        // ✅ ALINEACIÓN QUIRÚRGICA DE LÍNEA BASE (V6)
                        // Real edit: o.y ya apunta a la baseline correcta → sin marginTop (evita padding superior)
                        // Smart patch normal (no real edit): shift relativo para alinear baseline browser vs PDF
                        if (o.isSmartPatch && o.ascentPx && !o.isRealEdit && !o._pendingRealData) {
                            // En lugar de line-height:0 (que rompe párrafos), usamos un shift relativo
                            // browserBaseline es aprox 0.75-0.78 del font size con line-height:1
                            const browserBaseline = o.size * 0.77;
                            const shift = (o.ascentPx - browserBaseline) * scale;
                            span.style.marginTop = shift + 'px';
                            span.style.lineHeight = '1';
                        } else {
                            span.style.marginTop = '0';
                            span.style.lineHeight = '1'; // Forzar línea simple para parches precisos
                        }

                        if (o.isParagraph) {
                            span.style.lineHeight = o.lineHeight !== undefined ? o.lineHeight : 1.2;
                        }

                        // Use fontRegistry for proper font mapping
                        const fontInfo = this.fontRegistry.fonts[o.font];
                        if (fontInfo) {
                            span.style.fontFamily = `"${fontInfo.family}", sans-serif`;
                            // Only apply weight/style from fontInfo if no manual override via B/I buttons
                            span.style.fontWeight = o.bold ? 'bold' : (fontInfo.weight || 'normal');
                            span.style.fontStyle = o.italic ? 'italic' : (fontInfo.style || 'normal');
                        } else {
                            // Fallback for unknown fonts
                            span.style.fontFamily = `"${o.font}", Arial, sans-serif`;
                            span.style.fontWeight = o.bold ? 'bold' : 'normal';
                            span.style.fontStyle = o.italic ? 'italic' : 'normal';
                            if (o.isSmartPatch) console.warn(`⚠️ [renderOverlays font] id=${o.id} o.font="${o.font}" NO fontInfo → fontStyle="${span.style.fontStyle}"`);
                        }

                        span.style.fontSize = (o.size * this.currentScale) + 'px';
                        span.style.color = o.color;
                        if (o.underline) {
                            span.style.textDecoration = 'underline';
                        } else if (!o.isIndexLink) {
                            span.style.textDecoration = 'none';
                        }

                        // ── SMART PATCH: scaleX para que el texto llene exactamente el ancho original ──
                        // Igual que el charSpacing bidireccional en PDF-lib, pero para el canvas display.
                        // Esto elimina el desplazamiento visual causado por sustitución de fuentes.
                        let finalScX = scX;
                        if (o.isSmartPatch && o.text && o.width > 0) {
                            try {
                                const _mc = document.createElement('canvas').getContext('2d');
                                const _fw = o.bold ? 'bold ' : '';
                                const _fi = o.italic ? 'italic ' : '';
                                const _ff = span.style.fontFamily || '"Helvetica", Arial, sans-serif';
                                _mc.font = `${_fi}${_fw}${o.size * this.currentScale}px ${_ff}`;
                                const _natW = _mc.measureText(o.text).width;
                                const _targetW = o.width * this.currentScale;
                                if (_natW > 0 && Math.abs(_natW - _targetW) > 0.5) {
                                    finalScX = (_targetW / _natW) * scX;
                                    // Clamp to avoid extreme distortion (0.7x to 1.3x)
                                    finalScX = Math.min(Math.max(finalScX, 0.7), 1.3);
                                }
                            } catch (_e) {
                            }
                        }
                        span.style.transformOrigin = '0% 50%';
                        span.style.transform = `scale(${finalScX}, ${scY})`;

                        // HIPERVÍNCULOS DEL ÍNDICE
                        if (o.isIndexLink && o.linkTarget !== undefined) {
                            span.style.cursor = 'pointer';
                            span.style.textDecoration = 'underline';
                            span.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                this.goToPage(o.linkTarget);
                                this.showToast(`Navegando a página ${o.linkTarget + 1}`);
                            });
                        }

                        if (o.isEditing) {
                            el.classList.add('editing', 'selected');
                            span.contentEditable = "true";
                            el.draggable = false;
                            setTimeout(() => {
                                span.focus({ preventScroll: true });
                                // DEBUG POST-FOCUS: medir dimensiones reales del el y span
                                if (o._pendingRealData || o.isSmartPatch) {
                                    const elR = el.getBoundingClientRect();
                                    const spR = span.getBoundingClientRect();
                                    const elCS = getComputedStyle(el);
                                    const spCS = getComputedStyle(span);
                                    // Expandir el visualmente si span desborda
                                    if (spR.height > elR.height + 1) {
                                        el.style.height = spR.height + 'px';
                                        el.style.overflow = 'visible';
                                    }
                                }
                            }, 10);
                            this.selectedObj = o; this.editingObjId = o.id;
                        } else {
                            span.contentEditable = "false";
                        }

                        // FIX (bug #3): reajustar offsets de _styleRuns si el usuario sigue
                        // escribiendo después de aplicar un estilo por selección, antes de confirmar.
                        let _stylePendingEdit = null;
                        span.addEventListener('beforeinput', () => {
                            if (!(o._styleRuns || []).length) return;
                            const sel = window.getSelection();
                            if (!sel || sel.rangeCount === 0) return;
                            const r = sel.getRangeAt(0);
                            try {
                                _stylePendingEdit = {
                                    start: this._getPlainTextOffset(span, r.startContainer, r.startOffset),
                                    oldEnd: this._getPlainTextOffset(span, r.endContainer, r.endOffset),
                                    oldLen: (span.innerText || '').length
                                };
                            } catch (e) { _stylePendingEdit = null; }
                        });
                        span.addEventListener('input', () => {
                            if (_stylePendingEdit && (o._styleRuns || []).length > 0) {
                                const { start, oldEnd, oldLen } = _stylePendingEdit;
                                const delta = (span.innerText || '').length - oldLen;
                                o._styleRuns = this._reindexRunsForEdit(o._styleRuns, start, oldEnd, delta);
                            }
                            _stylePendingEdit = null;
                            o.text = span.innerText;
                            if (o._pendingRealData) return; // real edit: mantener dimensiones originales
                            el.style.width = 'auto'; el.style.height = 'auto';
                            const newW = el.offsetWidth / this.currentScale;
                            const newH = el.offsetHeight / this.currentScale;
                            o.width = newW; o.height = newH;
                            el.style.width = (o.width * this.currentScale) + 'px';
                            el.style.height = (o.height * this.currentScale) + 'px';
                        });

                        span.addEventListener('dblclick', (e) => {
                            if (this.isDrawingMode || this.isHandMode) return;
                            if (o._pendingRealData || o.isEditing) { e.stopPropagation(); return; }
                            e.stopPropagation(); e.preventDefault();
                            this.editText(o);
                        });
                        el.addEventListener('dblclick', (e) => {
                            if (this.isDrawingMode || this.isHandMode) return;
                            if (o._pendingRealData || o.isEditing || e.target.isContentEditable) { e.stopPropagation(); return; }
                            e.stopPropagation(); e.preventDefault();
                            this.editText(o);
                        });

                        // ── Real Edit: Ctrl+Enter o Enter (línea simple) confirma, Esc cancela ──
                        span.addEventListener('keydown', (e) => {
                            if (!o._pendingRealData) return;
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                o._realEditCancelled = true;
                                o._pendingRealData = null;
                                o.isEditing = false;
                                this.editingObjId = null;
                                this._cancelRealTextInlineEdit(o);
                            } else if ((e.key === 'Enter' && e.ctrlKey) || (e.key === 'Enter' && !o.isParagraph && !e.shiftKey)) {
                                e.preventDefault();
                                o._confirmOnBlur = true;
                                span.blur();
                            }
                        });

                        span.addEventListener('blur', (blurEvt) => {
                            if (span._overlayRebuilding || !span.isConnected) return;
                            const _diagTxnId = o._diagTxnId || `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                            o._diagTxnId = _diagTxnId;
                            window.__aliothDiag?.trace('TEXT-TXN', 'blur-enter', {
                                transactionId: _diagTxnId,
                                objectId: o.id,
                                relatedTarget: blurEvt.relatedTarget?.id || blurEvt.relatedTarget?.className || blurEvt.relatedTarget?.tagName || null,
                                pending: !!o._pendingRealData,
                                objectCommit: !!o._commitInProgress,
                                globalCommit: !!this._realTextCommitInProgress,
                                currentText: span.innerText,
                                view: window.__aliothDiag?.view(this.splitView?.activePanel)
                            });
                            if (o._realEditCancelled) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'cancelled' });
                                o._realEditCancelled = false; o.isEditing = false; this.editingObjId = null; return;
                            }
                            // Ignorar blur causado por renderOverlays re-creando spans (foco va a otro .text-content del overlay)
                            const rt = blurEvt.relatedTarget;
                            if (rt && (rt.classList.contains('text-content') || rt.closest('#overlay-layer, #overlay-layer-secondary'))) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'overlay-related-target' });
                                return;
                            }
                            // Si el editor RTIE flotante está abierto, ignorar el blur del span
                            if (document.getElementById('real-text-inline-editor')) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'floating-editor-open' });
                                return;
                            }
                            // ── Flag global: mousedown en ribbon → no hacer commit ──
                            if (window._ribbonInteracting) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'ribbon-interacting' });
                                setTimeout(() => {
                                    const activeEl = document.activeElement;
                                    const isInteractive = activeEl && (activeEl.tagName === 'SELECT' || activeEl.tagName === 'INPUT' || activeEl.closest('#ribbonContainer, #ribbon-capsule-wrapper'));
                                    if (!isInteractive && document.body.contains(span)) {
                                        span.focus();
                                    }
                                }, 50);
                                return;
                            }
                            // ── Ignorar blur causado por clic en herramientas del ribbon (fuente, color, tamaño, etc.) ──
                            if (rt && rt.closest('#ribbonContainer, #ribbon-capsule-wrapper, .header-tabs-wrapper, .ribbon-hover-popup')) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', {
                                    transactionId: _diagTxnId,
                                    reason: 'ribbon-related-target',
                                    relatedTarget: rt.id || rt.className || rt.tagName
                                });
                                const isInteractiveRt = rt.tagName === 'SELECT' || rt.tagName === 'INPUT';
                                if (!isInteractiveRt) setTimeout(() => { if (document.body.contains(span)) span.focus(); }, 0);
                                return;
                            }
                            // Fallback: si no hay relatedTarget (algunos inputs como color pickers no lo reportan),
                            // verificar si el clic activo está en el ribbon
                            if (!rt) {
                                const activeEl = document.activeElement;
                                if (activeEl && activeEl.closest('#ribbonContainer, #ribbon-capsule-wrapper, .header-tabs-wrapper, .ribbon-hover-popup')) {
                                    window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'ribbon-active-element' });
                                    setTimeout(() => { if (document.body.contains(span)) span.focus(); }, 0);
                                    return;
                                }
                            }
                            // Ignorar blur por Alt+Tab / cambio de ventana (documento sin foco)
                            if (!document.hasFocus()) {
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-ignored', { transactionId: _diagTxnId, reason: 'document-unfocused' });
                                const refocus = () => { span.focus(); document.removeEventListener('focus', refocus, true); };
                                document.addEventListener('focus', refocus, true);
                                return;
                            }
                            o.isEditing = false;
                            this.editingObjId = null;
                            o.text = span.innerText;
                            // ── Real Edit: blur (click fuera o Ctrl+Enter) → confirmar ──
                            if (o._pendingRealData) {
                                o._confirmOnBlur = false;
                                const realData = o._pendingRealData;
                                o._pendingRealData = null;
                                // Texto vacío → usar espacio (borrar contenido, no cancelar)
                                const _rawText = o.text;
                                const newText = _rawText.length > 0 ? _rawText : ' ';
                                if ((o._styleRuns || []).length > 0) {
                                    if (_rawText.length === 0) {
                                        o._styleRuns = [];
                                    }
                                }
                                const _domH = Math.max(el.offsetHeight || 0, span.offsetHeight || 0);
                                const _domHpt = _domH / (this.currentScale || 1);
                                if (_domHpt > (o.height || 0) + 0.5) o.height = _domHpt;
                                window.__aliothDiag?.trace('TEXT-TXN', 'blur-dispatch-commit', {
                                    transactionId: _diagTxnId,
                                    objectId: o.id,
                                    text: newText,
                                    font: o.font,
                                    bold: o.bold,
                                    size: o.size,
                                    alignment: o.alignment,
                                    rect: { x: o.x, y: o.y, width: o.width, height: o.height },
                                    dom: { width: el.offsetWidth, height: _domH, spanWidth: span.offsetWidth, spanHeight: span.offsetHeight }
                                });
                                this._applyRealTextInlineCommit(o, realData, newText);
                                return;
                            }
                            this.renderOverlays();
                            this.renderSidebar();
                            this.saveState();
                        });

                        span.addEventListener('mousedown', (e) => { if (o.isEditing) e.stopPropagation(); });
                        el.appendChild(span);
                    }
                    else if (o.type === 'link') {
                        // Link/hyperlink rendering (no emojis, scalable text)
                        const span = document.createElement('div');
                        span.className = 'link-content';
                        span.innerText = o.text;
                        span.style.fontFamily = o.font || 'Helvetica';
                        span.style.color = o.color || '#0066cc';
                        span.style.textDecoration = 'underline';
                        span.style.cursor = 'pointer';
                        span.style.width = '100%';
                        span.style.height = '100%';
                        span.style.display = 'flex';
                        span.style.alignItems = 'center';
                        span.style.justifyContent = 'center';
                        span.style.overflow = 'hidden';
                        span.style.textOverflow = 'ellipsis';
                        span.style.transform = `scale(${scX}, ${scY})`;

                        // Calculate font size to fit container
                        const baseFontSize = o.size || 14;
                        const scaledSize = Math.min(baseFontSize * this.currentScale, o.height * this.currentScale * 0.7);
                        span.style.fontSize = scaledSize + 'px';

                        // Bold and Italic
                        if (o.bold) span.style.fontWeight = 'bold';
                        if (o.italic) span.style.fontStyle = 'italic';

                        // ✅ NUEVO: Click simple para navegar (vínculos internos y externos)
                        span.addEventListener('click', (e) => {
                            if (this.isDrawingMode || this.isHandMode) return;
                            e.stopPropagation();
                            e.preventDefault();

                            // Manejar vínculo interno
                            if (o.linkType === 'internal' && o.internalPage) {
                                this.navigateToInternalLink(o);
                            } else {
                                if (o.url) {
                                    if (!this.showExternalLinkMenu(o.url, e) && /^(mailto:|tel:)/i.test(o.url)) {
                                        window.open(o.url, '_blank');
                                    }
                                }
                            }
                        });

                        // Double-click to edit
                        span.addEventListener('dblclick', (e) => {
                            if (this.isDrawingMode || this.isHandMode) return;
                            e.stopPropagation(); e.preventDefault();
                            this.editLink(o);
                        });

                        el.appendChild(span);
                    }
                    else if (o.type === 'table') {
                        // Create Table structure
                        // overflow:hidden on container clips borders that bleed outside
                        el.style.overflow = 'hidden';
                        const bwOuter = (o.borderWidth > 0 ? o.borderWidth : 0) * scale;
                        const table = document.createElement('table');
                        if (bwOuter > 0) {
                            table.style.width = 'calc(100% - ' + bwOuter + 'px)';
                            table.style.margin = (bwOuter / 2) + 'px';
                        } else {
                            table.style.width = '100%';
                        }
                        // No fixed height — let rows define their own heights
                        table.style.borderCollapse = 'collapse';
                        table.style.tableLayout = 'fixed';
                        table.style.boxSizing = 'border-box';
                        table.style.pointerEvents = 'none';

                        for (let r = 0; r < o.rows; r++) {
                            const tr = document.createElement('tr');
                            // Use rowHeight percentage if possible or fixed? Fixed is better for resizing.
                            // We must map rowHeights to percentage of total height or scale pixels?
                            // o.rowHeights[r] is in PDF units.
                            tr.style.height = (o.rowHeights[r] * scale) + 'px';

                            for (let c = 0; c < o.cols; c++) {
                                const td = document.createElement('td');
                                const bw = (o.borderWidth !== undefined ? o.borderWidth : 1);
                                const bc = o.borderColor || '#000000';
                                // Editor: show ghost dashed border when borderless so cells are visible for editing.
                                // The PDF renderer checks borderWidth > 0 independently (lines ~26109) and correctly omits borders there.
                                td.style.border = bw > 0 ? `${bw}px solid ${bc}` : '1px dashed rgba(100, 149, 237, 0.38)';
                                td.style.padding = '2px 4px';
                                td.style.boxSizing = 'border-box';
                                td.style.verticalAlign = 'top';
                                td.style.fontSize = (o.fontSize * scale) + 'px';
                                td.style.fontFamily = o.fontFamily;
                                td.style.color = o.textColor;
                                td.style.textAlign = o.textAlign || 'left';
                                td.style.overflow = 'hidden';
                                td.style.wordBreak = 'break-word';
                                td.style.whiteSpace = 'pre-wrap';
                                td.style.pointerEvents = 'auto'; // Allow interaction
                                td.style.cursor = 'text';
                                td.style.outline = 'none';

                                // Make cell editable directly on single click
                                try {
                                    td.contentEditable = 'plaintext-only';
                                } catch (err) {
                                    td.contentEditable = 'true';
                                }
                                if (td.contentEditable !== 'plaintext-only') {
                                    td.contentEditable = 'true';
                                }
                                td.spellcheck = false;

                                // Apply cell-specific styles from cellStyles
                                const cellStyle = o.cellStyles && o.cellStyles[r] && o.cellStyles[r][c] ? o.cellStyles[r][c] : null;
                                if (cellStyle) {
                                    // Background color
                                    if (cellStyle.bgColor) {
                                        td.style.backgroundColor = cellStyle.bgColor;
                                    }
                                    // Font family
                                    if (cellStyle.fontFamily) {
                                        td.style.fontFamily = cellStyle.fontFamily;
                                    }
                                    // Font size (override table default)
                                    if (cellStyle.fontSize) {
                                        td.style.fontSize = (cellStyle.fontSize * scale) + 'px';
                                    }
                                    // Text color
                                    if (cellStyle.textColor) {
                                        td.style.color = cellStyle.textColor;
                                    }
                                    // Bold
                                    if (cellStyle.bold) {
                                        td.style.fontWeight = 'bold';
                                    }
                                    // Italic
                                    if (cellStyle.italic) {
                                        td.style.fontStyle = 'italic';
                                    }
                                    // Alignment
                                    if (cellStyle.alignH) {
                                        td.style.textAlign = cellStyle.alignH;
                                    }
                                    if (cellStyle.alignV) {
                                        td.style.verticalAlign = cellStyle.alignV;
                                    }
                                }

                                // Set column width only on first row
                                if (r === 0) {
                                    td.style.width = (o.colWidths[c] * scale) + 'px';
                                }

                                td.innerText = (o.data && o.data[r] && o.data[r][c] !== undefined) ? o.data[r][c] : '';

                                // Single click interaction: focus cell and select table without dragging
                                td.addEventListener('mousedown', (e) => {
                                    e.stopPropagation();
                                    if (this.selectedObj !== o) {
                                        this.selectedObj = o;
                                        this.multiObjectSelection.clear();
                                        this.multiObjectSelection.add(o.id);
                                        document.querySelectorAll('.draggable.selected').forEach(d => d.classList.remove('selected'));
                                        el.classList.add('selected');
                                        if (!el.querySelector('.resize-handle')) {
                                            const handleClasses = ['rh-tl','rh-tr','rh-bl','rh-br','rh-tc','rh-bc','rh-ml','rh-mr'];
                                            handleClasses.forEach(h => {
                                                const rh = document.createElement('div');
                                                rh.className = 'resize-handle ' + h;
                                                el.appendChild(rh);
                                            });
                                            const rot = document.createElement('div');
                                            rot.className = 'rotate-handle';
                                            el.appendChild(rot);
                                        }
                                        this.renderSidebar();
                                    }
                                });

                                td.addEventListener('focus', () => {
                                    td.style.boxShadow = 'inset 0 0 0 2px var(--accent, #0066cc)';
                                    td.style.position = 'relative';
                                    td.style.zIndex = '5';
                                });

                                td.addEventListener('input', () => {
                                    if (!o.data) o.data = [];
                                    if (!o.data[r]) o.data[r] = [];
                                    o.data[r][c] = td.innerText;
                                });

                                td.addEventListener('blur', () => {
                                    td.style.boxShadow = 'none';
                                    td.style.position = '';
                                    td.style.zIndex = '';
                                    if (!o.data) o.data = [];
                                    if (!o.data[r]) o.data[r] = [];
                                    o.data[r][c] = td.innerText;
                                    this.saveState();
                                });

                                td.addEventListener('paste', (e) => {
                                    e.preventDefault();
                                    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
                                    document.execCommand('insertText', false, text);
                                });

                                td.addEventListener('keydown', (e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Tab') {
                                        e.preventDefault();
                                        const nextC = e.shiftKey ? c - 1 : c + 1;
                                        let targetR = r;
                                        let targetC = nextC;
                                        if (targetC < 0) {
                                            if (targetR > 0) {
                                                targetR--;
                                                targetC = o.cols - 1;
                                            } else {
                                                targetC = 0;
                                            }
                                        } else if (targetC >= o.cols) {
                                            if (targetR < o.rows - 1) {
                                                targetR++;
                                                targetC = 0;
                                            } else {
                                                targetC = o.cols - 1;
                                            }
                                        }
                                        const targetRow = table.rows[targetR];
                                        if (targetRow && targetRow.cells[targetC]) {
                                            targetRow.cells[targetC].focus();
                                        }
                                    } else if (e.key === 'Escape') {
                                        td.blur();
                                    }
                                });

                                td.addEventListener('dblclick', (e) => {
                                    e.stopPropagation(); // Prevent object properties or parent handlers
                                    e.preventDefault();
                                    if (!o.data) o.data = [];
                                    if (!o.data[r]) o.data[r] = [];
                                    o.data[r][c] = td.innerText;
                                    this.editTableCell(o, r, c);
                                });

                                tr.appendChild(td);
                            }
                            table.appendChild(tr);
                        }
                        el.appendChild(table);

                        el.addEventListener('dblclick', (e) => {
                            if (this.isDrawingMode || this.isHandMode) return;
                            if (e.target.tagName === 'TD' || e.target.isContentEditable) return;
                            e.stopPropagation();
                            e.preventDefault();
                            this.openTableProperties(o);
                        });

                        // Add handlers for resizing (delegated, but specific logic needed in startResize)

                        // Internal Resize Handles (only if selected)
                        if (this.multiObjectSelection.has(o.id) && !this.isHandMode && !o.isEditing) {
                            // Helper: create thin visual indicator line inside handle
                            const makeIndicator = (isCol) => {
                                const ind = document.createElement('div');
                                ind.style.position = 'absolute';
                                ind.style.pointerEvents = 'none';
                                ind.style.transition = 'background 0.12s';
                                ind.style.background = 'rgba(100,149,237,0)';
                                if (isCol) {
                                    ind.style.top = '0'; ind.style.bottom = '0';
                                    ind.style.left = '50%'; ind.style.transform = 'translateX(-50%)';
                                    ind.style.width = '2px';
                                } else {
                                    ind.style.left = '0'; ind.style.right = '0';
                                    ind.style.top = '50%'; ind.style.transform = 'translateY(-50%)';
                                    ind.style.height = '2px';
                                }
                                return ind;
                            };

                            // Column Handles — 16px wide hit area for easier targeting
                            let currentLeft = 0;
                            for (let c = 0; c < o.cols - 1; c++) {
                                currentLeft += o.colWidths[c];
                                const handle = document.createElement('div');
                                handle.className = 'internal-resize-handle col';
                                handle.style.position = 'absolute';
                                handle.style.top = '0';
                                handle.style.bottom = '0';
                                handle.style.width = '16px';
                                handle.style.left = (currentLeft * scale - 8) + 'px';
                                handle.style.cursor = 'col-resize';
                                handle.style.zIndex = '30';
                                handle.style.background = 'transparent';
                                const indCol = makeIndicator(true);
                                handle.appendChild(indCol);
                                handle.addEventListener('mouseenter', () => { indCol.style.background = 'rgba(100,149,237,0.65)'; });
                                handle.addEventListener('mouseleave', () => { indCol.style.background = 'rgba(100,149,237,0)'; });
                                handle.addEventListener('pointerdown', (e) => e.stopPropagation());
                                handle.addEventListener('mousedown', (e) => {
                                    e.stopPropagation();
                                    this.startInternalResize(e, o, 'col', c);
                                });
                                el.appendChild(handle);
                            }

                            // Row Handles — 16px tall hit area with visual indicator
                            let currentTop = 0;
                            for (let r = 0; r < o.rows - 1; r++) {
                                currentTop += o.rowHeights[r];
                                const handle = document.createElement('div');
                                handle.className = 'internal-resize-handle row';
                                handle.style.position = 'absolute';
                                handle.style.left = '0';
                                handle.style.right = '0';
                                handle.style.height = '16px';
                                handle.style.top = (currentTop * scale - 8) + 'px';
                                handle.style.cursor = 'row-resize';
                                handle.style.zIndex = '30';
                                handle.style.background = 'transparent';
                                const indRow = makeIndicator(false);
                                handle.appendChild(indRow);
                                handle.addEventListener('mouseenter', () => { indRow.style.background = 'rgba(100,149,237,0.65)'; });
                                handle.addEventListener('mouseleave', () => { indRow.style.background = 'rgba(100,149,237,0)'; });
                                handle.addEventListener('pointerdown', (e) => e.stopPropagation());
                                handle.addEventListener('mousedown', (e) => {
                                    e.stopPropagation();
                                    this.startInternalResize(e, o, 'row', r);
                                });
                                el.appendChild(handle);
                            }
                        }
                    }
                    else if (o.type === 'image') {
                        const i = document.createElement('img'); i.src = o.src;
                        i.style.width = '100%'; i.style.height = '100%';
                        // ✅ FIX: Detectar si opacity ya está normalizada (0-1) o en escala (0-100)
                        const opacityValue = o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100;
                        i.style.opacity = opacityValue;
                        i.style.transform = `scale(${scX}, ${scY})`;
                        let f = `brightness(${o.filters?.brightness || 100}%) contrast(${o.filters?.contrast || 100}%) saturate(${o.filters?.saturate || 100}%) hue-rotate(${o.filters?.hue || 0}deg) blur(${o.filters?.blur || 0}px)`;
                        if (o.filters?.grayscale) f += ' grayscale(100%)'; if (o.filters?.invert) f += ' invert(100%)'; if (o.filters?.sepia) f += ' sepia(100%)';
                        if (o.shadow) {
                            const sc = o.shadowColor || '#000000';
                            const sa = o.shadowOpacity !== undefined ? o.shadowOpacity : 0.4;
                            const sx = o.shadowX !== undefined ? o.shadowX : 3;
                            const sy = o.shadowY !== undefined ? o.shadowY : 3;
                            const sb = o.shadowBlur !== undefined ? o.shadowBlur : 6;
                            const hex2rgb = h => { const n=parseInt(h.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${sa})`; };
                            f += ` drop-shadow(${sx}px ${sy}px ${sb}px ${hex2rgb(sc)})`;
                        }
                        i.style.filter = f;
                        el.appendChild(i);
                    }
                    else if (o.type === 'shape' || o.type === 'connector') {
                        const svgNS = "http://www.w3.org/2000/svg";
                        const svg = document.createElementNS(svgNS, "svg");
                        svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
                        svg.style.overflow = "visible";
                        svg.style.transform = `scale(${scX}, ${scY})`;
                        // ── Shadow filter ────────────────────────────────────
                        if (o.shadow) {
                            const sfDefs = document.createElementNS(svgNS, "defs");
                            const sfFilt = document.createElementNS(svgNS, "filter");
                            const sfId   = 'shf_' + o.id;
                            sfFilt.setAttribute("id", sfId);
                            sfFilt.setAttribute("x","-40%"); sfFilt.setAttribute("y","-40%");
                            sfFilt.setAttribute("width","180%"); sfFilt.setAttribute("height","180%");
                            const sfBlur = document.createElementNS(svgNS, "feGaussianBlur");
                            sfBlur.setAttribute("in","SourceAlpha");
                            sfBlur.setAttribute("stdDeviation", (o.shadowBlur ?? 6) / 2);
                            sfBlur.setAttribute("result","blur");
                            const sfOff = document.createElementNS(svgNS, "feOffset");
                            sfOff.setAttribute("in","blur");
                            sfOff.setAttribute("dx", o.shadowX ?? 3);
                            sfOff.setAttribute("dy", o.shadowY ?? 3);
                            sfOff.setAttribute("result","offsetBlur");
                            const sfFlood = document.createElementNS(svgNS, "feFlood");
                            const sc = o.shadowColor || '#000000';
                            const sr2 = parseInt(sc.slice(1,3),16);
                            const sg2 = parseInt(sc.slice(3,5),16);
                            const sb2 = parseInt(sc.slice(5,7),16);
                            sfFlood.setAttribute("flood-color", `rgb(${sr2},${sg2},${sb2})`);
                            sfFlood.setAttribute("flood-opacity", o.shadowOpacity ?? 0.4);
                            sfFlood.setAttribute("result","flood");
                            const sfComp = document.createElementNS(svgNS, "feComposite");
                            sfComp.setAttribute("in","flood"); sfComp.setAttribute("in2","offsetBlur");
                            sfComp.setAttribute("operator","in"); sfComp.setAttribute("result","coloredBlur");
                            const sfMerge = document.createElementNS(svgNS, "feMerge");
                            const sfN1 = document.createElementNS(svgNS, "feMergeNode");
                            sfN1.setAttribute("in","coloredBlur");
                            const sfN2 = document.createElementNS(svgNS, "feMergeNode");
                            sfN2.setAttribute("in","SourceGraphic");
                            sfMerge.appendChild(sfN1); sfMerge.appendChild(sfN2);
                            sfFilt.appendChild(sfBlur); sfFilt.appendChild(sfOff);
                            sfFilt.appendChild(sfFlood); sfFilt.appendChild(sfComp);
                            sfFilt.appendChild(sfMerge);
                            sfDefs.appendChild(sfFilt);
                            svg.appendChild(sfDefs);
                            svg.setAttribute("filter","url(#" + sfId + ")");
                        }
                        let s;
                        if (o.shapeType === 'rect') {
                            s = document.createElementNS(svgNS, "rect");
                            s.setAttribute("width", "100%"); s.setAttribute("height", "100%");
                        }
                        else if (o.shapeType === 'round_rect') {
                            s = document.createElementNS(svgNS, "rect");
                            s.setAttribute("width", "100%"); s.setAttribute("height", "100%");
                            s.setAttribute("rx", 20 * this.currentScale); s.setAttribute("ry", 20 * this.currentScale);
                        }
                        else if (o.shapeType === 'circle') {
                            s = document.createElementNS(svgNS, "ellipse");
                            s.setAttribute("cx", "50%"); s.setAttribute("cy", "50%");
                            s.setAttribute("rx", "50%"); s.setAttribute("ry", "50%");
                        }
                        else if (o.shapeType === 'triangle') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "50,0 0,100 100,100");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'star') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'arrow') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M0 40 H60 V20 L100 50 L60 80 V60 H0 Z");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'arrow_line') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M0 50 L90 50 M90 50 L75 35 M90 50 L75 65");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                            s.style.fill = "none";
                        }
                        else if (o.shapeType === 'bracket') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M20 0 H5 V100 H20");
                            svg.setAttribute("viewBox", "0 0 20 100"); svg.setAttribute("preserveAspectRatio", "none");
                            s.style.fill = "none";
                        }
                        // ── Nuevas formas ──────────────────────────────────────
                        else if (o.shapeType === 'diamond') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "50,0 100,50 50,100 0,50");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'hexagon') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "25,0 75,0 100,50 75,100 25,100 0,50");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'pentagon') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "50,0 100,38 81,100 19,100 0,38");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'octagon') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "30,0 70,0 100,30 100,70 70,100 30,100 0,70 0,30");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'cross') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M35 0H65V35H100V65H65V100H35V65H0V35H35Z");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'double_arrow') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M0 50L20 20V40H80V20L100 50L80 80V60H20V80Z");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'chevron') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M0 0H70L100 50L70 100H0L30 50Z");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'parallelogram') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "20,0 100,0 80,100 0,100");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'trapezoid') {
                            s = document.createElementNS(svgNS, "polygon");
                            s.setAttribute("points", "20,0 80,0 100,100 0,100");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'no_entry') {
                            // Círculo con línea diagonal (prohibido)
                            const g2 = document.createElementNS(svgNS, "g");
                            const circle2 = document.createElementNS(svgNS, "circle");
                            circle2.setAttribute("cx","50"); circle2.setAttribute("cy","50"); circle2.setAttribute("r","48");
                            circle2.setAttribute("fill", o.noFill ? 'none' : (o.fill||'#ff0000'));
                            circle2.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke||'#cc0000'));
                            circle2.setAttribute("stroke-width", (o.strokeWidth||3));
                            const line2 = document.createElementNS(svgNS, "line");
                            line2.setAttribute("x1","10"); line2.setAttribute("y1","10");
                            line2.setAttribute("x2","90"); line2.setAttribute("y2","90");
                            line2.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke||'#cc0000'));
                            line2.setAttribute("stroke-width", (o.strokeWidth||4));
                            g2.appendChild(circle2); g2.appendChild(line2);
                            svg.setAttribute("viewBox","0 0 100 100"); svg.setAttribute("preserveAspectRatio","none");
                            svg.appendChild(g2); el.appendChild(svg); s = null;
                        }
                        else if (o.shapeType === 'heart') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M50 85C50 85 10 58 10 30a20 20 0 0140 0 20 20 0 0140 0C90 58 50 85 50 85Z");
                            svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'cloud') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M80 65a20 20 0 00-38-8 15 15 0 00-22 14 15 15 0 0015 14h45a15 15 0 000-20z");
                            svg.setAttribute("viewBox", "0 0 100 80"); svg.setAttribute("preserveAspectRatio", "none");
                        }
                        else if (o.shapeType === 'cylinder') {
                            const g3 = document.createElementNS(svgNS, "g");
                            const body3 = document.createElementNS(svgNS, "rect");
                            body3.setAttribute("x","5"); body3.setAttribute("y","18"); body3.setAttribute("width","90"); body3.setAttribute("height","70");
                            body3.setAttribute("fill", o.noFill ? 'none' : (o.fill||'#aaaaff'));
                            body3.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke||'#000'));
                            body3.setAttribute("stroke-width", o.strokeWidth||2);
                            const top3 = document.createElementNS(svgNS, "ellipse");
                            top3.setAttribute("cx","50"); top3.setAttribute("cy","18"); top3.setAttribute("rx","45"); top3.setAttribute("ry","15");
                            top3.setAttribute("fill", o.noFill ? 'none' : (o.fill||'#aaaaff'));
                            top3.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke||'#000'));
                            top3.setAttribute("stroke-width", o.strokeWidth||2);
                            const bot3 = document.createElementNS(svgNS, "ellipse");
                            bot3.setAttribute("cx","50"); bot3.setAttribute("cy","88"); bot3.setAttribute("rx","45"); bot3.setAttribute("ry","15");
                            bot3.setAttribute("fill", o.noFill ? 'none' : (o.fill||'#aaaaff'));
                            bot3.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke||'#000'));
                            bot3.setAttribute("stroke-width", o.strokeWidth||2);
                            g3.appendChild(body3); g3.appendChild(top3); g3.appendChild(bot3);
                            svg.setAttribute("viewBox","0 0 100 100"); svg.setAttribute("preserveAspectRatio","none");
                            svg.appendChild(g3); el.appendChild(svg); s = null;
                        }
                        else if (o.shapeType === 'burst') {
                            s = document.createElementNS(svgNS, "path");
                            s.setAttribute("d", "M50 0l8 30 22-22-12 28 30-5-25 18 25 18-30-5 12 28-22-22-8 30-8-30-22 22 12-28-30 5 25-18-25-18 30 5-12-28 22 22z");
                            svg.setAttribute("viewBox","0 0 100 100"); svg.setAttribute("preserveAspectRatio","none");
                        }
                        // ── Conectores ────────────────────────────────────────
                        else if (o.type === 'connector') {
                            // Connectors are rendered by _connRenderLayer after all objects.
                            // Skip normal div rendering — set minimal size so selection/sidebar still works.
                            el.style.pointerEvents = 'none';
                            el.style.opacity = '0';
                            el.style.width = '1px'; el.style.height = '1px';
                            s = null;
                        }
                        if (s) {
                            const fillColor = o.noFill ? 'none' : o.fill;
                            const fillOp    = o.fillOpacity !== undefined ? o.fillOpacity : 1;
                            s.setAttribute("fill", fillColor);
                            if (fillColor !== 'none' && fillOp < 1) s.setAttribute("fill-opacity", fillOp);
                            s.setAttribute("stroke", o.noBorder ? 'none' : (o.stroke || '#000000'));
                            s.setAttribute("stroke-width", (o.strokeWidth || 2) * this.currentScale);
                            // Stroke dash pattern
                            const dash = o.strokeDash && o.strokeDash !== 'none' ? o.strokeDash : null;
                            if (dash) {
                                const sw = (o.strokeWidth || 2) * this.currentScale;
                                s.setAttribute("stroke-dasharray", dash.split(',').map(v => parseFloat(v) * sw).join(','));
                            } else {
                                s.removeAttribute("stroke-dasharray");
                            }
                            // Corner radius for rect/round_rect
                            if ((o.shapeType === 'rect') && o.cornerRadius > 0) {
                                s.setAttribute("rx", o.cornerRadius * this.currentScale);
                                s.setAttribute("ry", o.cornerRadius * this.currentScale);
                            }
                            if (o.shapeType === 'arrow_line' || o.shapeType === 'bracket') s.setAttribute("fill", "none");
                            const shapeOpacity = o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100;
                            s.style.opacity = shapeOpacity;
                            svg.appendChild(s);
                            el.appendChild(svg);
                        }
                    }

                    // Skip generic handlers for form-fields - they have their own handlers defined above
                    // Skip generic handlers for form-fields - handled by delegation/above logic
                    if (o.type !== 'form-field') {
                        // Context menu and mousedown handled by delegation for ALL draggables now
                        // Keeping distinct block just in case logic differs, but delegation handles all types.
                        // We can remove this block safely or comment it out.
                        // Removed individual handlers.
                    }

                    if (this.multiObjectSelection.has(o.id) && this.editingObjId !== o.id && !this.isHandMode) {
                        el.classList.add('selected');

                        // Add all 8 resize handles
                        const handles = ['rh-tl', 'rh-tr', 'rh-bl', 'rh-br', 'rh-tc', 'rh-bc', 'rh-ml', 'rh-mr'];
                        handles.forEach(h => {
                            const rh = document.createElement('div');
                            rh.className = 'resize-handle ' + h;
                            el.appendChild(rh);
                        });

                        const rot = document.createElement('div'); rot.className = 'rotate-handle';
                        el.appendChild(rot);
                    }
                    // Attach data for interact.js easily
                    el.setAttribute('data-id', o.id);
                    el.setAttribute('data-type', o.type);
                    if (o.autoSize) el.setAttribute('data-auto-size', 'true');

                    // Los comentarios se renderizan aparte via renderCommentPins()
                    // Comments are handled in savePDFInternal
                    if (o.type === 'comment') return;

                    l.appendChild(el);
                });

                // Initialize Interact.js on newly created draggable elements
                if (this.interactEnabled && window.interact) {
                    this.setupInteractDraggables();
                }

                // Render connector SVG layer on top
                this._connRenderLayer(l, currentPage, scale);

                // Sincronizar barra de herramientas con la selección actual
                if (targetPanel === this.splitView.activePanel && this.selectedObj) {
                    this.syncToolbar();
                }

                // Renderizar pines de comentarios (fuera del overlay-layer)
                this.renderCommentPins(targetPanel);
            },

            renderSearchHighlights: function () {
                document.querySelectorAll('.search-highlight').forEach(e => e.remove());
                if (this.searchResults.length === 0) return;
                const doc = this.getDoc(); const currentScale = this.currentScale;
                const overlay = document.getElementById('overlay-layer');
                this.searchResults.filter(r => r.pageIdx === doc.currentIndex).forEach(r => {
                    const div = document.createElement('div'); div.className = 'search-highlight';
                    if (this.searchResults[this.currentSearchIdx] === r) div.classList.add('current');
                    div.style.left = (r.x * currentScale) + 'px'; div.style.top = (r.y * currentScale) + 'px';
                    div.style.width = (r.width * currentScale) + 'px'; div.style.height = (r.height * currentScale) + 'px';
                    overlay.appendChild(div);
                });
            },

            // ── Obtiene o crea el worker Tesseract persistente (con soporte PSM dinámico) ──
            renderCommentPins: function(panelId) {
                const panel     = panelId || this.splitView.activePanel;
                const elements  = this.getPanelElements(panel);
                const container = elements.canvasContainer;
                if (!container) return;

                // Limpiar pines anteriores y zonas de traducción
                container.querySelectorAll('.comment-pin:not(.native-comment-pin), .translation-hover-zone').forEach(p => p.remove());

                const panelState = this.splitView[panel];
                const docId = panelState?.docId || this.activeDocId;
                const doc   = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const page  = doc.pages[doc.currentIndex];
                if (!page?.objects) return;

                const scale = panelState?.scale || this.currentScale;

                page.objects.filter(o => o.type === 'comment').forEach(o => {
                    if (o.translationNote) {
                        if (!this._isTranslatableText(o.text) && !this._isTranslatableText(o.sourceText)) return;
                        const zone = document.createElement('div');
                        zone.className = 'translation-hover-zone';
                        zone.id = 'thover-' + o.id;
                        zone.dataset.translationNote = 'true';
                        zone.dataset.translationLanguage = o.translationLanguage || 'Traducción';
                        zone._nativeCommentObj = o;
                        const zoneW = Math.max(20, (o.width || 80) * scale);
                        const zoneH = Math.max(14, (o.height || 20) * scale);
                        zone.style.cssText = `
                            position:absolute;
                            left:${o.x * scale}px;
                            top:${o.y * scale}px;
                            width:${zoneW}px;
                            height:${zoneH}px;
                            z-index:450;
                            pointer-events:auto;
                            cursor:help;
                            background:transparent;
                            border:none;
                            outline:none;
                            box-shadow:none;
                            box-sizing:border-box;
                        `;
                        zone.addEventListener('mouseenter', (ev) => {
                            if (document.body.classList.contains('text-select-mode') && ev.buttons !== 0) return;
                            this.showTranslationTooltip(ev, o, zone);
                        });
                        zone.addEventListener('mouseleave', () => {
                            this.hideTranslationTooltip();
                        });
                        zone.addEventListener('click', (ev) => {
                            if (document.body.classList.contains('text-select-mode')) return;
                            ev.stopPropagation();
                            ev.preventDefault();
                            this.pinTranslationTooltip(ev, o, zone);
                        });
                        zone.addEventListener('contextmenu', (ev) => {
                            if (document.body.classList.contains('text-select-mode')) {
                                const sel = window.getSelection();
                                if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) return;
                            }
                            ev.preventDefault();
                            ev.stopPropagation();
                            this.openCommentCtxMenu(ev, o.id);
                        });
                        container.appendChild(zone);
                        return;
                    }
                    const pin = document.createElement('div');
                    const noteSide = o.translationSide === 'left' ? 'left' : 'right';
                    const noteX = noteSide === 'left' ? -40 : container.clientWidth + 8;
                    pin.className   = 'comment-pin';
                    pin.id          = 'cpin-' + o.id;
                    pin.style.cssText = `
                        position:absolute;
                        left:${o.x * scale}px;
                        top:${o.y * scale}px;
                        width:32px; height:38px;
                        z-index:500;
                        pointer-events:auto;
                        cursor:pointer;
                        user-select:none;
                        filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));
                        transition:transform 0.15s ease, filter 0.15s ease;
                    `;
                    pin.innerHTML = this._buildPinSVG(o.color, o.resolved);
                    if (o.translationNote) {
                        pin.dataset.translationNote = 'true';
                        pin.dataset.translationSide = noteSide;
                    }
                    const originalText = o.sourceText || o.translationReference;
                    pin.title = o.translationNote && originalText
                        ? `Original: ${originalText}` : (o.text || 'Comentario').substring(0, 80);

                    // Hover
                    pin.addEventListener('mouseenter', () => {
                        pin.style.transform = 'scale(1.18) translateY(-2px)';
                        pin.style.filter = 'drop-shadow(0 5px 12px rgba(0,0,0,0.5))';
                    });
                    pin.addEventListener('mouseleave', () => {
                        pin.style.transform = '';
                        pin.style.filter = 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))';
                    });

                    // Click → abrir popup
                    pin.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        this.openCommentPopup(o.id, pin);
                    });

                    // Clic derecho → menú contextual
                    pin.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        this.openCommentCtxMenu(ev, o.id);
                    });

                    // Drag para mover el pin
                    let dragging = false, dragStartX, dragStartY, origObjX, origObjY;
                    pin.addEventListener('mousedown', (ev) => {
                        if (o.translationNote) return;
                        if (ev.button !== 0) return;
                        ev.stopPropagation();
                        dragging = true;
                        dragStartX = ev.clientX; dragStartY = ev.clientY;
                        origObjX = o.x; origObjY = o.y;
                        pin.style.transition = 'none';

                        const onMove = (mv) => {
                            if (!dragging) return;
                            const dx = (mv.clientX - dragStartX) / scale;
                            const dy = (mv.clientY - dragStartY) / scale;
                            o.x = origObjX + dx;
                            o.y = origObjY + dy;
                            pin.style.left = (o.x * scale) + 'px';
                            pin.style.top  = (o.y * scale) + 'px';
                        };
                        const onUp = (mu) => {
                            if (!dragging) return;
                            dragging = false;
                            pin.style.transition = '';
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onUp);
                            // Solo guardar si se movió
                            const dx = Math.abs(mu.clientX - dragStartX);
                            const dy = Math.abs(mu.clientY - dragStartY);
                            if (dx > 3 || dy > 3) {
                                this.saveState();
                            } else {
                                // fue un click, abrir popup
                                this.openCommentPopup(o.id, pin);
                            }
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                    });

                    container.appendChild(pin);
                });
                this._layoutTranslationNotePins(panel);
            },
            _layoutTranslationNotePins: function(panelId) {
                const elements = this.getPanelElements(panelId);
                const pins = [
                    ...elements.annotationLayer?.querySelectorAll('.comment-pin[data-translation-note="true"]') || [],
                    ...elements.canvasContainer?.querySelectorAll('.comment-pin[data-translation-note="true"]') || []
                ].filter(pin => pin.getBoundingClientRect().height > 0);
                pins.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                let nextTop = -Infinity;
                for (const pin of pins) {
                    const rect = pin.getBoundingClientRect();
                    const targetTop = Math.max(rect.top, nextTop);
                    const parent = pin.offsetParent || pin.parentElement;
                    const factor = parent?.offsetHeight ? parent.getBoundingClientRect().height / parent.offsetHeight : 1;
                    if (targetTop > rect.top && Number.isFinite(factor) && factor > 0) {
                        pin.style.top = (parseFloat(getComputedStyle(pin).top) + (targetTop - rect.top) / factor) + 'px';
                    }
                    nextTop = targetTop + rect.height + 3;
                }
            },

            _isTranslatableText: function(text) {
                if (!text || typeof text !== 'string') return false;
                const cleaned = text.trim();
                if (cleaned.length < 2) return false;
                const letters = cleaned.match(/[\p{L}]/gu) || [];
                if (letters.length < 2) return false;
                const nonSpace = cleaned.replace(/\s/g, '');
                if (!nonSpace.length) return false;
                if (letters.length / nonSpace.length < 0.40) return false;
                const vowels = cleaned.match(/[aeiouáéíóúüAEIOUÁÉÍÓÚÜyY]/g) || [];
                if (cleaned.length <= 6 && vowels.length === 0) return false;
                const words = cleaned.split(/[\s\W_]+/).filter(Boolean);
                if (words.length >= 3) {
                    const avgLen = words.reduce((acc, w) => acc + w.length, 0) / words.length;
                    const maxLen = Math.max(...words.map(w => w.length));
                    if (avgLen < 1.7 && maxLen <= 2) return false;
                }
                return true;
            },

            _pinnedTranslationId: null,
            _hideTipTimer: null,

            _translationParagraphText: function(obj, zone) {
                const ownText = String(obj?.text || '').trim();
                if (!obj?.author?.startsWith('Traducción') || !zone?.parentElement) return ownText;
                const selector = zone.classList.contains('translation-highlight-annot')
                    ? '.translation-highlight-annot'
                    : zone.classList.contains('translation-hover-zone') ? '.translation-hover-zone' : null;
                if (!selector) return ownText;
                const language = obj.translationLanguage || zone.dataset.translationLanguage;
                const anchor = zone.getBoundingClientRect();
                const layer = zone.closest?.('.annotationLayer, .annotation-layer') || zone.parentElement;
                const lines = [...layer.querySelectorAll(selector)].map(element => {
                    const note = element._nativeCommentObj;
                    const rect = element.getBoundingClientRect();
                    const overlap = Math.min(anchor.right, rect.right) - Math.max(anchor.left, rect.left);
                    if (!note?.author?.startsWith('Traducción') ||
                        (note.translationLanguage || element.dataset.translationLanguage) !== language ||
                        rect.width < 4 || rect.height < 4 ||
                        Math.abs(anchor.left - rect.left) > Math.max(48, Math.min(anchor.height, rect.height) * 2.2) ||
                        overlap < Math.min(anchor.width, rect.width) * 0.55) return null;
                    return { element, rect, text: String(note.text || '').trim() };
                }).filter(line => line?.text).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
                const index = lines.findIndex(line => line.element === zone);
                if (index < 0) return ownText;
                const joins = (first, second) => {
                    const a = first.rect, b = second.rect;
                    const height = Math.min(a.height, b.height);
                    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const isListItem = text => /^(?:[•▪◦●‣*\-–—]|\d+[.)])\s/u.test(text);
                    const isTitle = text => /[\p{L}]/u.test(text) && text === text.toUpperCase();
                    if (isListItem(first.text) || isListItem(second.text) ||
                        isTitle(first.text) || isTitle(second.text) || first.text.length < 55 ||
                        (second.text.length < 55 && /[.!?]$/.test(first.text))) return false;
                    return Math.max(a.height, b.height) <= height * 1.5 &&
                        b.top - a.top > height * 0.55 && b.top - a.top <= height * 2.2 &&
                        b.top - a.bottom >= -height * 0.25 && b.top - a.bottom <= height * 0.95 &&
                        Math.abs(a.left - b.left) <= Math.max(48, height * 2.2) &&
                        overlap >= Math.min(a.width, b.width) * 0.55;
                };
                let first = index, last = index;
                while (first > 0 && joins(lines[first - 1], lines[first])) first--;
                while (last < lines.length - 1 && joins(lines[last], lines[last + 1])) last++;
                return lines.slice(first, last + 1).map(line => line.text).join(' ');
            },

            showTranslationTooltip: function(ev, obj, zone) {
                if (this._pinnedTranslationId && this._pinnedTranslationId !== obj.id) return;
                if (!this._isTranslatableText(obj?.text) && !this._isTranslatableText(obj?.sourceText)) return;
                let tip = document.getElementById('translation-hover-tooltip');
                if (!tip) {
                    tip = document.createElement('div');
                    tip.id = 'translation-hover-tooltip';
                    tip.className = 'translation-hover-tooltip';
                    tip.style.cssText = `
                        position:fixed;
                        z-index:99999;
                        max-width:min(560px, 92vw);
                        background:rgba(15, 23, 42, 0.96);
                        color:#f8fafc;
                        backdrop-filter:blur(12px);
                        -webkit-backdrop-filter:blur(12px);
                        border:1px solid rgba(255,255,255,0.16);
                        border-radius:8px;
                        padding:7px 11px;
                        box-shadow:0 12px 30px rgba(0,0,0,0.55);
                        font-family:system-ui, -apple-system, sans-serif;
                        font-size:12.5px;
                        line-height:1.4;
                        pointer-events:auto;
                        opacity:0;
                        transform:translateY(4px);
                        transition:opacity 0.15s ease, transform 0.15s ease;
                    `;
                    tip.addEventListener('mouseenter', () => {
                        clearTimeout(this._hideTipTimer);
                    });
                    tip.addEventListener('mouseleave', () => {
                        this.hideTranslationTooltip();
                    });
                    document.body.appendChild(tip);
                }
                clearTimeout(this._hideTipTimer);
                const targetLang = obj.translationLanguage || 'Traducción';
                const cleanText = this._translationParagraphText(obj, zone);
                const isPinned = this._pinnedTranslationId === obj.id;
                tip.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px;font-size:7px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.35px;line-height:1;">
                        <span style="display:inline-flex;align-items:center;gap:3px;">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;display:inline-block;vertical-align:middle;">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                            </svg>
                            Traducción · ${window.escapeHTML ? window.escapeHTML(targetLang) : targetLang}
                        </span>
                        <div style="display:flex;align-items:center;gap:3px;">
                            <button type="button" id="trans-copy-btn" title="Copiar traducción" style="background:none;border:none;color:#38bdf8;cursor:pointer;padding:1px 2px;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;line-height:1;transition:color 0.15s, transform 0.15s;">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                            ${isPinned ? `
                                <button type="button" id="trans-unpin-btn" title="Cerrar" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px 3px;display:inline-flex;align-items:center;justify-content:center;border-radius:3px;line-height:1;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                     <div style="color:#ffffff;word-break:break-word;white-space:pre-wrap;user-select:text;max-height:55vh;overflow-y:auto;">${window.escapeHTML ? window.escapeHTML(cleanText) : cleanText}</div>
                `;
                const copyBtn = tip.querySelector('#trans-copy-btn');
                if (copyBtn) {
                    copyBtn.onclick = (e) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText(cleanText).then(() => {
                            const originalHTML = copyBtn.innerHTML;
                            copyBtn.innerHTML = `
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            `;
                            copyBtn.title = '¡Copiado!';
                            setTimeout(() => {
                                if (copyBtn) {
                                    copyBtn.innerHTML = originalHTML;
                                    copyBtn.title = 'Copiar traducción';
                                }
                            }, 1500);
                        });
                    };
                }
                const unpinBtn = tip.querySelector('#trans-unpin-btn');
                if (unpinBtn) {
                    unpinBtn.onclick = (e) => {
                        e.stopPropagation();
                        this._pinnedTranslationId = null;
                        this.hideTranslationTooltip(true);
                    };
                }
                const rect = (zone && typeof zone.getBoundingClientRect === 'function') ? zone.getBoundingClientRect() : { top: ev?.clientY || 100, bottom: (ev?.clientY || 100) + 20, left: ev?.clientX || 100, width: 60 };
                tip.style.display = 'block';
                const tipH = tip.offsetHeight || 60;
                const tipW = tip.offsetWidth || 260;
                 const roomAbove = rect.top - 8;
                 const roomBelow = window.innerHeight - rect.bottom - 8;
                 let top = roomAbove >= tipH || roomAbove >= roomBelow ? rect.top - tipH - 8 : rect.bottom + 8;
                 top = Math.max(10, Math.min(window.innerHeight - tipH - 10, top));
                let left = (ev?.clientX && (rect.width > 300 || !rect.width)) ? ev.clientX - tipW / 2 : rect.left + (rect.width - tipW) / 2;
                left = Math.max(12, Math.min(window.innerWidth - tipW - 12, left));
                tip.style.top = top + 'px';
                tip.style.left = left + 'px';
                requestAnimationFrame(() => {
                    tip.style.opacity = '1';
                    tip.style.transform = 'translateY(0)';
                });
            },

            hideTranslationTooltip: function(force = false) {
                if (this._pinnedTranslationId && !force) return;
                const tip = document.getElementById('translation-hover-tooltip');
                if (!tip) return;
                clearTimeout(this._hideTipTimer);
                this._hideTipTimer = setTimeout(() => {
                    tip.style.opacity = '0';
                    tip.style.transform = 'translateY(4px)';
                    setTimeout(() => {
                        if (tip.style.opacity === '0') tip.style.display = 'none';
                    }, 150);
                }, 120);
            },

            pinTranslationTooltip: function(ev, obj, zone) {
                if (this._pinnedTranslationId === obj.id) {
                    this._pinnedTranslationId = null;
                    this.hideTranslationTooltip(true);
                } else {
                    this._pinnedTranslationId = obj.id;
                    this.showTranslationTooltip(ev, obj, zone);
                }
            },

            zoom: function (delta) {
                // Default zoom applies to active panel
                this.zoomPanel(delta, this.splitView.activePanel);
            },

            _zoomDebounceTimer: null,
            _zoomTargetScale: null,
            _zoomTargetPage: null,
            _zoomTargetPanel: null,

            _captureZoomAnchor: function (panelId, clientX, clientY) {
                const elements = this.getPanelElements(panelId);
                const mainView = elements && elements.mainView;
                if (!mainView || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

                let target = document.elementFromPoint(clientX, clientY);
                // El canvas activo se oculta y cambia de padre durante el render continuo.
                const selector = this.viewMode === 'continuous' ? '.page-wrapper' : '.canvas-container';
                target = target && target.closest ? target.closest(selector) : null;
                if (this.viewMode === 'continuous' && (!target || !mainView.contains(target))) {
                    const viewRect = mainView.getBoundingClientRect();
                    let nearestDistance = Infinity;
                    target = null;
                    mainView.querySelectorAll('.page-wrapper').forEach(wrapper => {
                        const r = wrapper.getBoundingClientRect();
                        if (!r.width || !r.height || r.bottom <= viewRect.top || r.top >= viewRect.bottom ||
                            r.right <= viewRect.left || r.left >= viewRect.right) return;
                        const dx = Math.max(r.left - clientX, 0, clientX - r.right);
                        const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
                        const distance = dx * dx + dy * dy;
                        if (distance < nearestDistance) {
                            nearestDistance = distance;
                            target = wrapper;
                        }
                    });
                }
                if (!target || !mainView.contains(target)) target = elements.canvasContainer;
                if (!target) return null;

                const rect = target.getBoundingClientRect();
                if (!rect.width || !rect.height) return null;
                const isHorizontalLayout = !!document.body?.classList?.contains('h-layout');
                const viewportWidth = mainView.clientWidth || 0;
                const preserveX = isHorizontalLayout ||
                    (mainView.scrollWidth || 0) > viewportWidth + 2 ||
                    rect.width > viewportWidth + 2;
                return {
                    token: Symbol('zoom-anchor'),
                    panelId,
                    targetId: target.id,
                    xRatio: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
                    yRatio: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
                    localX: Math.max(0, Math.min(rect.width, clientX - rect.left)),
                    localY: Math.max(0, Math.min(rect.height, clientY - rect.top)),
                    baseWidth: rect.width,
                    baseHeight: rect.height,
                    clientX,
                    clientY,
                    preserveX
                };
            },

            _restoreZoomAnchor: function (anchor) {
                if (!anchor) return false;
                const elements = this.getPanelElements(anchor.panelId);
                const mainView = elements && elements.mainView;
                const target = anchor.targetId ? document.getElementById(anchor.targetId) : elements && elements.canvasContainer;
                if (!mainView || !target || !mainView.contains(target)) return false;

                const rect = target.getBoundingClientRect();
                const currentX = rect.left + rect.width * anchor.xRatio;
                const currentY = rect.top + rect.height * anchor.yRatio;
                if (anchor.preserveX) {
                    mainView.scrollLeft += currentX - anchor.clientX;
                } else {
                    mainView.scrollLeft = 0;
                }
                mainView.scrollTop += currentY - anchor.clientY;
                return true;
            },

            zoomPanel: function (delta, panelId, pointer = null) {
                const targetPanel = panelId || this.splitView.activePanel;
                const panelState = this.splitView[targetPanel];
                if (!panelState) return;

                const docId = panelState.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                // Capture current page NOW before any async work
                // Only update target page if we don't already have a pending zoom
                if (!this._zoomDebounceTimer) {
                    this._zoomTargetPage  = doc.currentIndex;
                    this._zoomTargetPanel = targetPanel;
                    this._zoomBaseScale   = panelState.scale || 1.0;
                    this._pendingZoomAnchor = pointer
                        ? this._captureZoomAnchor(targetPanel, pointer.clientX, pointer.clientY)
                        : null;
                    // Al ampliar, conservar X aunque la página todavía quepa: durante este
                    // mismo gesto puede cruzar el umbral de overflow.
                    if (this._pendingZoomAnchor && delta > 0) this._pendingZoomAnchor.preserveX = true;
                    this._zoomDiagBatch = {
                        id: `zoom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        startedAt: performance.now(),
                        panel: targetPanel,
                        page: doc.currentIndex,
                        baseScale: this._zoomBaseScale,
                        anchor: this._pendingZoomAnchor ? {
                            targetId: this._pendingZoomAnchor.targetId,
                            clientX: this._pendingZoomAnchor.clientX,
                            clientY: this._pendingZoomAnchor.clientY,
                            xRatio: this._pendingZoomAnchor.xRatio,
                            yRatio: this._pendingZoomAnchor.yRatio,
                            preserveX: this._pendingZoomAnchor.preserveX
                        } : null,
                        startView: window.__aliothDiag?.view(targetPanel),
                        samples: []
                    };
                    window.__aliothDiag?.trace('ZOOM-TRACE', 'batch-start', this._zoomDiagBatch);
                }

                // Accumulate scale changes
                const base = this._zoomTargetScale !== null ? this._zoomTargetScale : (panelState.scale || 1.0);
                let newScale = base + delta;
                if (newScale < 0.2) newScale = 0.2;
                if (newScale > 5.0) newScale = 5.0;
                this._zoomTargetScale = newScale;
                if (this._zoomDiagBatch && this._zoomDiagBatch.samples.length < 30) {
                    this._zoomDiagBatch.samples.push({
                        atMs: Math.round((performance.now() - this._zoomDiagBatch.startedAt) * 10) / 10,
                        delta,
                        scale: newScale,
                        pointer: pointer ? { x: pointer.clientX, y: pointer.clientY } : null
                    });
                }

                // Update scale immediately for visual feedback
                panelState.scale = newScale;
                if (targetPanel === this.splitView.activePanel) {
                    this.currentScale = newScale;
                    doc.scale = newScale;
                    const zi = document.getElementById('zoomInput');
                    if (zi) zi.value = Math.round(newScale * 100) + '%';
                }

                // Immediate CSS transform for smooth real-time zoom preview
                const panelSuffixNow = targetPanel === 'secondary' ? 'Secondary' : 'Primary';
                const containerNow = document.getElementById('canvas-container' + (targetPanel === 'secondary' ? '-secondary' : ''));
                if (containerNow && this._zoomBaseScale > 0) {
                    const ratio = newScale / this._zoomBaseScale;
                    const anchor = this._pendingZoomAnchor;
                    if (anchor) {
                        // El origen pertenece a la caja SIN transformar. Recalcularlo desde
                        // getBoundingClientRect() después de cada wheel acumula el transform
                        // anterior y desplaza la vista horizontalmente.
                        const originX = anchor.preserveX
                            ? anchor.localX
                            : anchor.baseWidth / 2;
                        const originY = anchor.localY;
                        containerNow.style.transformOrigin = `${originX}px ${originY}px`;
                    }
                    containerNow.classList.add('zooming');
                    containerNow.style.transform = `scale(${ratio})`;
                }

                // Debounce: only render after user stops zooming (150ms)
                clearTimeout(this._zoomDebounceTimer);
                this._zoomDebounceTimer = setTimeout(async () => {
                    const page  = this._zoomTargetPage;
                    const panel = this._zoomTargetPanel;
                    const zoomAnchor = this._pendingZoomAnchor;
                    const zoomDiag = this._zoomDiagBatch;
                    this._zoomDiagBatch = null;
                    window.__aliothDiag?.trace('ZOOM-TRACE', 'render-start', {
                        id: zoomDiag?.id,
                        targetScale: panelState.scale,
                        viewMode: this.viewMode,
                        samples: zoomDiag?.samples,
                        beforeRender: window.__aliothDiag?.view(panel)
                    });
                    this._zoomDebounceTimer = null;
                    this._zoomTargetScale  = null;
                    this._zoomTargetPage   = null;
                    this._zoomTargetPanel  = null;
                    this._zoomBaseScale    = null;

                    if (this.viewMode === 'continuous') {
                        // Remove temporary transform before re-render
                        const containerEnd = document.getElementById('canvas-container' + (panel === 'secondary' ? '-secondary' : ''));
                        if (containerEnd) { containerEnd.classList.remove('zooming'); containerEnd.style.transform = ''; containerEnd.style.transformOrigin = ''; }
                        await this.renderPanelContent(panel);
                        if (zoomAnchor) this._restoreZoomAnchor(zoomAnchor);
                        window.__aliothDiag?.trace('ZOOM-TRACE', 'render-finish', {
                            id: zoomDiag?.id,
                            elapsedMs: zoomDiag ? Math.round((performance.now() - zoomDiag.startedAt) * 10) / 10 : null,
                            mode: 'continuous',
                            view: window.__aliothDiag?.view(panel)
                        });
                    } else {
                        const panelSuffix = panel === 'secondary' ? 'Secondary' : 'Primary';
                        const mainView = document.getElementById('mainView' + panelSuffix);
                        // Preserve scroll position ratio before reload
                        const scrollRatioX = mainView ? (mainView.scrollLeft + mainView.clientWidth / 2) / (mainView.scrollWidth || 1) : 0.5;
                        const scrollRatioY = mainView ? (mainView.scrollTop + mainView.clientHeight / 2) / (mainView.scrollHeight || 1) : 0;
                        // Block movePage for 500ms after zoom to prevent scroll edge triggering page change
                        this._zoomJustFinished = Date.now();
                        // Si hay un real edit activo, mantener CSS transform visible y no recargar DOM
                        const activeRealEdit = this.docs.flatMap(d => d.pages || [])
                            .flatMap(p => p.objects || [])
                            .find(o => o._pendingRealData && o.isEditing);
                        const rtieOpen = !!document.getElementById('real-text-inline-editor');
                        if (activeRealEdit || rtieOpen) {
                            this.currentScale = panelState.scale;
                            this._zoomBaseScale = panelState.scale;
                            window.__aliothDiag?.trace('ZOOM-TRACE', 'render-skipped-active-editor', {
                                id: zoomDiag?.id,
                                activeObjectId: activeRealEdit?.id || null,
                                rtieOpen,
                                view: window.__aliothDiag?.view(panel)
                            });
                            return;
                        }
                        // Remove temporary transform before re-render (solo si no hay real edit)
                        const containerEnd = document.getElementById('canvas-container' + (panel === 'secondary' ? '-secondary' : ''));
                        if (containerEnd) { containerEnd.classList.remove('zooming'); containerEnd.style.transform = ''; containerEnd.style.transformOrigin = ''; }
                        this.loadPage(page, panel).then(() => {
                            // Solo restaurar scroll proporcional si no hubo navegación manual durante el zoom
                            if (zoomAnchor) {
                                this._restoreZoomAnchor(zoomAnchor);
                            } else if (mainView && !this._userNavigating) {
                                mainView.scrollLeft = scrollRatioX * mainView.scrollWidth - mainView.clientWidth / 2;
                                mainView.scrollTop  = scrollRatioY * mainView.scrollHeight - mainView.clientHeight / 2;
                            }
                            this.updatePanelHeaders();
                            if (panel === this.splitView.activePanel) this.renderSidebar();
                            window.__aliothDiag?.trace('ZOOM-TRACE', 'render-finish', {
                                id: zoomDiag?.id,
                                elapsedMs: zoomDiag ? Math.round((performance.now() - zoomDiag.startedAt) * 10) / 10 : null,
                                mode: 'single',
                                view: window.__aliothDiag?.view(panel)
                            });
                        });
                        if (this._pendingZoomAnchor === zoomAnchor) this._pendingZoomAnchor = null;
                        return;
                    }
                    if (this._pendingZoomAnchor === zoomAnchor) this._pendingZoomAnchor = null;
                    this.updatePanelHeaders();
                    if (panel === this.splitView.activePanel) this.renderSidebar();
                }, 150);
            },

            zoomInputChanged: function (val) {
                const num = parseInt(val.replace('%', ''));
                if (!isNaN(num)) {
                    this.zoom((num / 100) - this.currentScale);
                }
            },

            /**
             * Shows continuous preview mode with all pages stacked vertically
             */
            showContinuousPreview: async function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) {
                    this.showToast("Abre un documento primero");
                    return;
                }

                const overlay = document.getElementById('continuous-preview-overlay');
                const container = document.getElementById('continuous-preview-container');
                const info = document.getElementById('continuous-preview-info');

                // Show overlay immediately with loading message
                container.innerHTML = '<div style="color:white; font-size:18px; padding:50px;">Cargando páginas...</div>';
                overlay.style.display = 'block';
                info.innerText = 'Generando vista...';

                // Force browser repaint before starting heavy work
                await new Promise(resolve => setTimeout(resolve, 50));

                try {
                    container.innerHTML = ''; // Clear loading message
                    const scale = 1.2; // Fixed scale for preview

                    for (let i = 0; i < doc.pages.length; i++) {
                        const p = doc.pages[i];
                        const src = doc.sources[p.sourceId];
                        if (!src || !src.buffer) continue;
                        if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                        const page = await src.doc.getPage(p.pageIndex + 1);

                        const rot = (page.rotate + p.rotation) % 360;
                        const vp = page.getViewport({ scale: scale, rotation: rot });

                        // Create page wrapper
                        const wrapper = document.createElement('div');
                        wrapper.style.cssText = `position:relative; background:white; box-shadow:0 0 20px rgba(0,0,0,0.5); border-radius:4px;`;
                        wrapper.dataset.pageIndex = i;

                        // Create canvas
                        const cvs = document.createElement('canvas');
                        cvs.width = vp.width;
                        cvs.height = vp.height;
                        cvs.style.display = 'block';

                        // Page number label
                        const label = document.createElement('div');
                        label.style.cssText = `position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,0.7); 
                            color:white; padding:4px 10px; border-radius:4px; font-size:12px;`;
                        label.innerText = `Página ${i + 1}`;

                        wrapper.appendChild(cvs);
                        wrapper.appendChild(label);
                        container.appendChild(wrapper);

                        // Render page
                        const ctx = cvs.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport: vp }).promise;

                        // Update info after each page
                        info.innerText = `Renderizando ${i + 1} de ${doc.pages.length}...`;
                    }

                    info.innerText = `${doc.pages.length} página(s) - Scroll para navegar`;

                    // Setup scroll tracking for current page indicator
                    overlay.onscroll = () => {
                        const wrappers = container.querySelectorAll('[data-page-index]');
                        let currentPage = 0;
                        const scrollTop = overlay.scrollTop + 100;

                        wrappers.forEach((w, idx) => {
                            if (w.offsetTop <= scrollTop) {
                                currentPage = idx;
                            }
                        });

                        info.innerText = `Página ${currentPage + 1} de ${doc.pages.length}`;
                    };

                } catch (e) {
                    console.error("Error en vista continua:", e);
                    this.showToast("Error: " + e.message);
                    overlay.style.display = 'none';
                }
            },

            /**
             * Closes the continuous preview mode
             */
            closeContinuousPreview: function () {
                const overlay = document.getElementById('continuous-preview-overlay');
                overlay.style.display = 'none';
                overlay.onscroll = null;
                document.getElementById('continuous-preview-container').innerHTML = '';
            },

            renderContinuousContent: async function (panelId) {
                const elements = this.getPanelElements(panelId);
                const panelState = this.splitView[panelId];
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);

                if (!doc || !doc.pages.length) return;
                const mainView = elements.mainView;
                const cContainer = elements.canvasContainer;
                if (!mainView || !cContainer) return;
                const pointerZoomAnchor = this._pendingZoomAnchor && this._pendingZoomAnchor.panelId === panelId
                    ? this._pendingZoomAnchor
                    : null;

                // ── Guardar estado de scroll ANTES de vaciar el stack ──
                const newScale = panelState?.scale || this.currentScale;
                const oldScale = doc._lastContinuousScale || newScale;
                const scaleRatio = oldScale > 0 ? newScale / oldScale : 1;
                doc._lastContinuousScale = newScale;

                const activeIdxBeforeZoom = Math.min(panelState?.pageIndex ?? doc.currentIndex, doc.pages.length - 1);

                const oldWrapperDims = {};
                let scrollOffsetInPage = 0;
                let scrollOffsetWasH = false;
                const prevStack = mainView.querySelector('.scroll-stack');
                const pendingReturnOffset = this._pendingContinuousScrollOffset &&
                    this._pendingContinuousScrollOffset.panelId === panelId
                    ? this._pendingContinuousScrollOffset
                    : null;
                if (pendingReturnOffset) {
                    scrollOffsetInPage = pendingReturnOffset.offset || 0;
                    scrollOffsetWasH = !!pendingReturnOffset.wasHorizontal;
                    this._pendingContinuousScrollOffset = null;
                } else if (prevStack) {
                    prevStack.querySelectorAll('.page-wrapper').forEach(w => {
                        const idx = parseInt(w.dataset.index);
                        if (!isNaN(idx)) oldWrapperDims[idx] = { w: w.offsetWidth, h: w.offsetHeight };
                    });
                    const activeWrapper = document.getElementById(`page-wrapper-${panelId}-${activeIdxBeforeZoom}`);
                    if (activeWrapper) {
                        const isH = document.body.classList.contains('h-layout');
                        scrollOffsetWasH = isH;
                        const mvRect = mainView.getBoundingClientRect();
                        const awRect = activeWrapper.getBoundingClientRect();
                        if (isH) {
                            const awLeft = awRect.left - mvRect.left + mainView.scrollLeft;
                            scrollOffsetInPage = mainView.scrollLeft - awLeft;
                        } else {
                            const awTop = awRect.top - mvRect.top + mainView.scrollTop;
                            scrollOffsetInPage = mainView.scrollTop - awTop;
                        }
                    }
                }

                // ── Invalidar sesión anterior ──
                const sessionToken = Symbol();
                this._continuousSessionToken = sessionToken;

                // ── Token para invalidar restauraciones de scroll obsoletas ──
                const scrollRestoreToken = Symbol();
                this._scrollRestoreToken = scrollRestoreToken;

                // ── Rescatar cContainer a mainView antes de vaciar stack ──
                if (cContainer.parentElement !== mainView) {
                    mainView.appendChild(cContainer);
                }

                // ── Crear o limpiar el stack ──
                const _isHLayout = document.body.classList.contains('h-layout');
                const _isTwoUp = !!this.isTwoUpView && !_isHLayout;
                // In h-layout, NO padding — use spacer elements instead so offsetLeft is correct immediately
                const _stackCSS = _isHLayout
                    ? `display:flex;flex-direction:row;align-items:center;gap:20px;padding:40px 0;min-height:100%;height:max-content;box-sizing:border-box;`
                    : _isTwoUp
                        ? `display:grid;grid-template-columns:repeat(2, minmax(0, auto));justify-content:center;align-items:start;gap:20px 24px;padding:40px;min-width:100%;box-sizing:border-box;margin:0 auto;`
                        : 'display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px;min-width:100%;width:max-content;box-sizing:border-box;margin:0 auto;';
                const _spacerW = _isHLayout ? Math.round(mainView.clientWidth / 2) : 0;
                let stack = mainView.querySelector('.scroll-stack');
                if (!stack) {
                    stack = document.createElement('div');
                    stack.className = 'scroll-stack' + (_isTwoUp ? ' two-up-grid' : '');
                    stack.style.cssText = _stackCSS;
                    mainView.appendChild(stack);
                } else {
                    stack.style.cssText = _stackCSS;
                    if (_isTwoUp) {
                        stack.classList.add('two-up-grid');
                    } else {
                        stack.classList.remove('two-up-grid');
                    }
                    stack.querySelectorAll('.scroll-spacer').forEach(s => s.remove());
                }

                // Comprobar si los wrappers actuales coinciden en cantidad y en IDs con doc.pages
                const existingWrappers = Array.from(stack.querySelectorAll(':scope > .page-wrapper'));
                const isStackInSync = existingWrappers.length === doc.pages.length &&
                    existingWrappers.every((w, idx) => w.dataset.pageId === (doc.pages[idx] && doc.pages[idx].id));

                if (!isStackInSync) {
                    existingWrappers.forEach(w => w.remove());
                    for (const k in oldWrapperDims) delete oldWrapperDims[k];
                }

                // ── Spacers para h-layout: permiten centrar primera/última página ──
                if (_isHLayout && _spacerW > 0) {
                    const _spacerStart = document.createElement('div');
                    _spacerStart.className = 'scroll-spacer scroll-spacer-start';
                    _spacerStart.style.cssText = `flex-shrink:0;width:${_spacerW}px;height:1px;`;
                    const _spacerEnd = document.createElement('div');
                    _spacerEnd.className = 'scroll-spacer scroll-spacer-end';
                    _spacerEnd.style.cssText = `flex-shrink:0;width:${_spacerW}px;height:1px;`;
                    stack.insertBefore(_spacerStart, stack.firstChild);
                    // End spacer added after wrappers are created
                    stack._pendingEndSpacer = _spacerEnd;
                }

                // ── Crear o actualizar page-wrappers con dimensiones exactas/estimadas ──
                for (let i = 0; i < doc.pages.length; i++) {
                    const p = doc.pages[i];
                    if (!p.id) p.id = 'page_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                    let wrapper = document.getElementById(`page-wrapper-${panelId}-${i}`);
                    let bgCanvas;
                    if (!wrapper) {
                        wrapper = document.createElement('div');
                        wrapper.className = 'page-wrapper';
                        wrapper.id = `page-wrapper-${panelId}-${i}`;
                        wrapper.dataset.index = i;
                        wrapper.dataset.pageId = p.id;
                        bgCanvas = document.createElement('canvas');
                        bgCanvas.className = 'bg-page-canvas';
                        wrapper.appendChild(bgCanvas);
                        stack.appendChild(wrapper);
                    } else {
                        wrapper.dataset.index = i;
                        wrapper.dataset.pageId = p.id;
                        bgCanvas = wrapper.querySelector('.bg-page-canvas');
                        if (!bgCanvas) {
                            bgCanvas = document.createElement('canvas');
                            bgCanvas.className = 'bg-page-canvas';
                            wrapper.insertBefore(bgCanvas, wrapper.firstChild);
                        }
                        bgCanvas.style.display = '';
                    }

                    if (_isTwoUp && i === 0 && this.twoUpCoverAlone) {
                        wrapper.style.gridColumn = '1 / -1';
                        wrapper.style.justifySelf = 'center';
                        wrapper.classList.add('two-up-cover-standalone');
                    } else {
                        wrapper.style.gridColumn = '';
                        wrapper.style.justifySelf = '';
                        wrapper.classList.remove('two-up-cover-standalone');
                    }

                    if (isStackInSync && oldWrapperDims[i] && oldWrapperDims[i].h > 0) {
                        wrapper.style.width  = (oldWrapperDims[i].w * scaleRatio) + 'px';
                        wrapper.style.height = (oldWrapperDims[i].h * scaleRatio) + 'px';
                    } else if (p.width && p.height) {
                        wrapper.style.width  = Math.round(p.width * newScale) + 'px';
                        wrapper.style.height = Math.round(p.height * newScale) + 'px';
                    } else {
                        wrapper.style.width  = Math.round(612 * newScale) + 'px';
                        wrapper.style.height = Math.round(792 * newScale) + 'px';
                    }
                }
                // ── Attach end spacer (after all wrappers) ──
                if (_isHLayout && stack._pendingEndSpacer) {
                    stack.appendChild(stack._pendingEndSpacer);
                    stack._pendingEndSpacer = null;
                }

                // Delegar clics en wrappers para activar la página seleccionada
                stack.onclick = (e) => {
                    const wrap = e.target && e.target.closest && e.target.closest('.page-wrapper');
                    if (!wrap) return;
                    const pIndex = parseInt(wrap.dataset.index);
                    if (!isNaN(pIndex) && pIndex !== doc.currentIndex) {
                        this.goToPage(pIndex, panelId);
                    }
                };

                // ── Desconectar observer anterior si existía para este panel ──
                if (this._continuousObservers && this._continuousObservers[panelId]) {
                    try { this._continuousObservers[panelId].disconnect(); } catch (e) {}
                }
                if (!this._continuousObservers) this._continuousObservers = {};

                const preload = Math.max(600, (_isHLayout ? mainView.clientWidth : mainView.clientHeight) * 2);
                const obsMargin = _isHLayout ? `0px ${preload}px` : `${preload}px 0px`;
                const contObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        const wrap = entry.target;
                        const pIndex = parseInt(wrap.dataset.index);
                        const bgC = wrap.querySelector('.bg-page-canvas');
                        if (!bgC || isNaN(pIndex)) return;

                        if (entry.isIntersecting) {
                            if (bgC._renderedSessionToken !== sessionToken || bgC._renderedScale !== newScale) {
                                this.renderBackgroundPage(doc, pIndex, bgC, newScale, wrap, sessionToken);
                            }
                        } else {
                            // Si el usuario scrolleó rápido y salió del viewport, cancelar tarea pendiente
                            if (pIndex !== (panelState?.pageIndex ?? doc.currentIndex)) this.releaseBackgroundCanvas(bgC);
                        }
                    });
                }, { root: mainView, rootMargin: obsMargin });

                this._continuousObservers[panelId] = contObserver;
                stack.querySelectorAll('.page-wrapper').forEach(w => contObserver.observe(w));

                // Renderizado inmediato prioritario de la página activa
                const activeWrap = document.getElementById(`page-wrapper-${panelId}-${activeIdxBeforeZoom}`);
                if (activeWrap) {
                    const activeBg = activeWrap.querySelector('.bg-page-canvas');
                    if (activeBg) {
                        this.renderBackgroundPage(doc, activeIdxBeforeZoom, activeBg, newScale, activeWrap, sessionToken);
                    }
                }

                // ── Mover cContainer al wrapper de la página activa ──
                this._moveCContainerToWrapper(panelId, activeIdxBeforeZoom);
                // Tras redimensionar wrappers, restaurar el ancla antes del primer await.
                // Así el navegador no alcanza a pintar una posición intermedia.
                if (pointerZoomAnchor) this._restoreZoomAnchor(pointerZoomAnchor);

                // ── Restaurar scroll al mismo punto dentro de la misma página ──
                // Helper: calcula scrollTop vertical para centrar o restaurar offset
                const _calcVerticalTarget = (targetWrapper) => {
                    const isH = document.body.classList.contains('h-layout');
                    const mvRect = mainView.getBoundingClientRect();
                    const wRect = targetWrapper.getBoundingClientRect();
                    const wTop = wRect.top - mvRect.top + mainView.scrollTop;
                    // Si el layout cambió (h→v o v→h), centrar la página en pantalla
                    if (scrollOffsetWasH !== isH) {
                        const centeredTarget = wTop - (mainView.clientHeight - targetWrapper.offsetHeight) / 2;
                        return Math.max(0, Math.min(centeredTarget, mainView.scrollHeight - mainView.clientHeight));
                    }
                    const _target = wTop + scrollOffsetInPage * scaleRatio;
                    return Math.max(0, Math.min(_target, mainView.scrollHeight - mainView.clientHeight));
                };

                // Primer intento (rápido, puede tener offsetTop/offsetLeft=0 si wrappers sin dimensiones)
                requestAnimationFrame(() => {
                    if (this._scrollRestoreToken !== scrollRestoreToken) return;
                    if (this._layoutChanging) return;
                    if (pointerZoomAnchor) return;
                    const targetWrapper = document.getElementById(`page-wrapper-${panelId}-${activeIdxBeforeZoom}`);
                    if (!targetWrapper) return;
                    const isH = document.body.classList.contains('h-layout');
                    if (isH) {
                        const mvRect = mainView.getBoundingClientRect();
                        const wRect = targetWrapper.getBoundingClientRect();
                        const wLeft = wRect.left - mvRect.left + mainView.scrollLeft;
                        const _clamped = Math.max(0, Math.min(wLeft + targetWrapper.offsetWidth / 2 - mainView.clientWidth / 2, mainView.scrollWidth - mainView.clientWidth));
                        mainView.scrollLeft = _clamped;
                    } else {
                        const mvRect = mainView.getBoundingClientRect();
                        const wRect = targetWrapper.getBoundingClientRect();
                        const wTop = wRect.top - mvRect.top + mainView.scrollTop;
                        if (wTop > 0) mainView.scrollTop = _calcVerticalTarget(targetWrapper);
                        // Centrar horizontalmente la página en modo vertical
                        mainView.scrollLeft = Math.max(0, (mainView.scrollWidth - mainView.clientWidth) / 2);
                    }
                });

                // ── Renderizar la página activa en el cContainer ──
                await this._renderContinuousActivePage(panelId, activeIdxBeforeZoom, sessionToken);

                // Segundo intento post-render: ahora los wrappers tienen tamaño real
                requestAnimationFrame(() => {
                    if (this._scrollRestoreToken !== scrollRestoreToken) return;
                    if (this._layoutChanging) return;
                    if (pointerZoomAnchor) return;
                    const targetWrapper = document.getElementById(`page-wrapper-${panelId}-${activeIdxBeforeZoom}`);
                    if (!targetWrapper) return;
                    const isH = document.body.classList.contains('h-layout');
                    if (isH) {
                        const mvRect = mainView.getBoundingClientRect();
                        const wRect = targetWrapper.getBoundingClientRect();
                        const wLeft = wRect.left - mvRect.left + mainView.scrollLeft;
                        const _clamped = Math.max(0, Math.min(wLeft + targetWrapper.offsetWidth / 2 - mainView.clientWidth / 2, mainView.scrollWidth - mainView.clientWidth));
                        mainView.scrollLeft = _clamped;
                    } else {
                        mainView.scrollTop = _calcVerticalTarget(targetWrapper);
                        // Centrar horizontalmente la página en modo vertical
                        mainView.scrollLeft = Math.max(0, (mainView.scrollWidth - mainView.clientWidth) / 2);
                    }
                });

                // ── Scroll tracking (activar DESPUÉS del segundo rAF para que los wrappers tengan tamaño real) ──
                // Tercer intento: garantía para h-layout donde offsetLeft puede ser 0 en los rAF anteriores
                setTimeout(() => {
                    if (this._scrollRestoreToken !== scrollRestoreToken) return;
                    if (this._layoutChanging) return;
                    if (pointerZoomAnchor) return;
                    const targetWrapper = document.getElementById(`page-wrapper-${panelId}-${activeIdxBeforeZoom}`);
                    if (!targetWrapper) return;
                    const isH = document.body.classList.contains('h-layout');
                    if (isH) {
                        if (this._suppressScrollTracking) return;
                        const mvRect = mainView.getBoundingClientRect();
                        const wRect = targetWrapper.getBoundingClientRect();
                        const wLeft = wRect.left - mvRect.left + mainView.scrollLeft;
                        const _clamped = Math.max(0, Math.min(wLeft + targetWrapper.offsetWidth / 2 - mainView.clientWidth / 2, mainView.scrollWidth - mainView.clientWidth));
                        mainView.scrollLeft = _clamped;
                        this._suppressScrollTracking = true;
                        clearTimeout(this._suppressScrollTimer);
                        let _snapAttempts = 0;
                        const _snapFn = () => {
                            if (this._scrollRestoreToken !== scrollRestoreToken) { this._suppressScrollTracking = false; return; }
                            if (Math.abs(mainView.scrollLeft - _clamped) > 2) mainView.scrollLeft = _clamped;
                            if (++_snapAttempts < 20) setTimeout(_snapFn, 50);
                            else this._suppressScrollTracking = false;
                        };
                        this._suppressScrollTimer = setTimeout(_snapFn, 16);
                    } else {
                        mainView.scrollTop = _calcVerticalTarget(targetWrapper);
                        // Centrar horizontalmente la página en modo vertical
                        mainView.scrollLeft = Math.max(0, (mainView.scrollWidth - mainView.clientWidth) / 2);
                    }
                }, 300);

                const _setupScroll = () => {
                    let _scrollRafPending = false;
                    mainView.onscroll = () => {
                        if (this.viewMode !== 'continuous') { mainView.onscroll = null; return; }
                        if (this._suppressScrollTracking) return;
                        if (this._layoutChanging) return;
                        if (_scrollRafPending) return;
                        _scrollRafPending = true;
                        requestAnimationFrame(() => {
                        _scrollRafPending = false;
                        if (this._suppressScrollTracking) return;
                        const wrappers = stack.querySelectorAll('.page-wrapper');
                        const isH = document.body.classList.contains('h-layout');
                        const scrollMid = isH
                            ? mainView.scrollLeft + mainView.clientWidth / 2
                            : mainView.scrollTop + mainView.clientHeight / 2;
                        let closestIdx = doc.currentIndex, minDiff = Infinity;
                        wrappers.forEach((w, i) => {
                            if (isH) {
                                if (w.offsetWidth === 0) return;
                                const wCenter = w.offsetLeft + w.offsetWidth / 2;
                                const diff = Math.abs(wCenter - scrollMid);
                                if (diff < minDiff) { minDiff = diff; closestIdx = i; }
                            } else if (_isTwoUp) {
                                if (w.offsetHeight === 0) return;
                                const wCenterY = w.offsetTop + w.offsetHeight / 2;
                                const diffY = Math.abs(wCenterY - scrollMid);
                                const wCenterX = w.offsetLeft + w.offsetWidth / 2;
                                const scrollMidX = mainView.scrollLeft + mainView.clientWidth / 2;
                                const diffX = Math.abs(wCenterX - scrollMidX);
                                const combinedDiff = diffY * 1000 + diffX;
                                if (combinedDiff < minDiff) { minDiff = combinedDiff; closestIdx = i; }
                            } else {
                                if (w.offsetHeight === 0) return;
                                const wCenter = w.offsetTop + w.offsetHeight / 2;
                                const diff = Math.abs(wCenter - scrollMid);
                                if (diff < minDiff) { minDiff = diff; closestIdx = i; }
                            }
                        });
                        if (closestIdx !== doc.currentIndex) {
                            this._moveCContainerToWrapper(panelId, closestIdx);
                            doc.currentIndex = closestIdx;
                            if (panelState) panelState.pageIndex = closestIdx;
                            this._renderContinuousActivePage(panelId, closestIdx);
                            if (panelId === this.splitView.activePanel) {
                                document.querySelectorAll('.thumb-wrap.selected').forEach(el => el.classList.remove('selected'));
                                const thumb = document.getElementById('thumb-' + closestIdx);
                                if (thumb) {
                                    thumb.classList.add('selected');
                                    if (isH) {
                                        thumb.scrollIntoView({ inline: 'center', block: 'nearest' });
                                    } else {
                                        thumb.scrollIntoView({ block: 'nearest' });
                                    }
                                }
                                const pc = document.getElementById('pageCountDisplay');
                                if (pc) app.setPageCount(`${closestIdx + 1} / ${doc.pages.length}`);
                            }
                        }
                        }); // end requestAnimationFrame
                    };
                };
                // Activar tracking después del segundo rAF (post-render), cuando los wrappers ya tienen tamaño
                requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(_setupScroll, 0)));
            },

            // La precarga permanece visible hasta que la página activa está lista.
            _moveCContainerToWrapper: function (panelId, idx) {
                const elements = this.getPanelElements(panelId);
                const cContainer = elements.canvasContainer;
                if (!cContainer) return;

                // Restaurar bgCanvas del wrapper anterior
                const prev = cContainer.closest('.page-wrapper');
                if (prev) {
                    const prevBg = prev.querySelector('.bg-page-canvas');
                    if (prevBg) prevBg.style.display = '';
                }

                const wrapper = document.getElementById(`page-wrapper-${panelId}-${idx}`);
                if (!wrapper) return;

                cContainer._continuousRenderToken = Symbol();
                // Mover cContainer al nuevo wrapper
                wrapper.appendChild(cContainer);
                cContainer.style.position = '';
                cContainer.style.display = 'none';

                const bg = wrapper.querySelector('.bg-page-canvas');
                if (bg) bg.style.display = '';
            },

            _renderContinuousActivePage: async function (panelId, idx, sessionToken = this._continuousSessionToken) {
                if (this._continuousSessionToken !== sessionToken) return;
                const elements = this.getPanelElements(panelId);
                const panelState = this.splitView[panelId];
                const doc = this.docs.find(d => d.id === (panelState?.docId || this.activeDocId));
                const p = doc?.pages[idx];
                const wrapper = document.getElementById(`page-wrapper-${panelId}-${idx}`);
                const bg = wrapper?.querySelector('.bg-page-canvas');
                const cContainer = elements.canvasContainer;
                if (!p || !bg || !cContainer || !elements.canvas) return;

                const requestToken = Symbol();
                cContainer._continuousRenderToken = requestToken;
                doc.currentIndex = idx;
                if (panelState) panelState.pageIndex = idx;
                const scale = panelState?.scale || this.currentScale;
                const isCurrent = () => this.viewMode === 'continuous' &&
                    this._continuousSessionToken === sessionToken &&
                    cContainer._continuousRenderToken === requestToken &&
                    this.docs.includes(doc) && doc.pages[idx] === p &&
                    (panelState?.docId || this.activeDocId) === doc.id &&
                    (panelState?.pageIndex ?? doc.currentIndex) === idx &&
                    cContainer.parentElement === wrapper;

                try {
                    await this.renderBackgroundPage(doc, idx, bg, scale, wrapper, sessionToken);
                    if (!isCurrent() || bg._renderedSessionToken !== sessionToken || bg._renderedScale !== scale) return;

                    const cvs = elements.canvas;
                    cvs.width = bg.width;
                    cvs.height = bg.height;
                    cvs.getContext('2d', { alpha: false }).drawImage(bg, 0, 0);
                    const dlayer = elements.drawingLayer;
                    if (dlayer) { dlayer.width = bg.width; dlayer.height = bg.height; }
                    cContainer.style.width = bg.width + 'px';
                    cContainer.style.height = bg.height + 'px';
                    cContainer.style.transform = `${p.flipH ? 'scaleX(-1) ' : ''}${p.flipV ? 'scaleY(-1)' : ''}`.trim() || 'none';
                    cContainer.style.transformOrigin = 'center center';
                    cContainer.style.filter = doc._isInverted ? 'invert(100%)' : '';
                    cContainer.querySelectorAll('canvas').forEach(canvas => canvas.style.filter = '');
                    if (elements.annotationLayer) elements.annotationLayer.innerHTML = '';
                    const textLayer = cContainer.querySelector('.text-layer');
                    if (textLayer) textLayer.innerHTML = '';
                    this.renderOverlays(panelId);
                    this.redrawDrawings(false, panelId);
                    cContainer.style.display = 'block';
                    bg.style.display = 'none';

                    if (bg._pdfPage) {
                        await this.renderAnnotationLayer(bg._pdfPage, bg._pdfViewport, elements, panelId, p);
                        if (!isCurrent()) return;
                        await this.renderTextLayer(bg._pdfPage, bg._pdfViewport, elements, panelId);
                        if (!isCurrent()) return;
                        this.renderOverlays(panelId);
                        this.redrawDrawings(false, panelId);
                    }
                    if (this.showRuler) this.updateRulers(panelId);
                    if (this.showGrid) this.updateGrid(panelId);
                    if (window.BookmarkManager) BookmarkManager._renderRibbons(doc, idx, cContainer);
                } catch (e) {
                    if (e.name !== 'RenderingCancelledException') console.error('Continuous render error:', e);
                }
            },

            renderBackgroundPage: function (doc, idx, canvas, scale, wrapper, sessionToken) {
                if (this._continuousSessionToken !== sessionToken) return Promise.resolve();
                if (canvas._renderedSessionToken === sessionToken && canvas._renderedScale === scale) return Promise.resolve();
                if (canvas._renderPromise && canvas._renderRequestToken &&
                    canvas._pendingSessionToken === sessionToken && canvas._pendingScale === scale) return canvas._renderPromise;

                if (canvas._activeRenderTask) {
                    try { canvas._activeRenderTask.cancel(); } catch (e) {}
                    canvas._activeRenderTask = null;
                }
                const requestToken = Symbol();
                canvas._renderRequestToken = requestToken;
                canvas._pendingSessionToken = sessionToken;
                canvas._pendingScale = scale;
                const p = doc.pages[idx];
                const isCurrent = () => this._continuousSessionToken === sessionToken &&
                    canvas._renderRequestToken === requestToken && doc.pages[idx] === p;

                const promise = (async () => {
                    try {
                        if (!p) return;
                        const buffer = document.createElement('canvas');
                        let page = null, vp = null;
                        if (p.canvas) {
                            buffer.width = p.canvas.width * scale;
                            buffer.height = p.canvas.height * scale;
                            buffer.getContext('2d', { alpha: false }).drawImage(p.canvas, 0, 0, buffer.width, buffer.height);
                        } else if (p._blank) {
                            const rotated = (p.rotation === 90 || p.rotation === 270);
                            buffer.width = Math.round((rotated ? (p.height || 792) : (p.width || 612)) * scale);
                            buffer.height = Math.round((rotated ? (p.width || 612) : (p.height || 792)) * scale);
                            const ctx = buffer.getContext('2d', { alpha: false });
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, buffer.width, buffer.height);
                        } else {
                            const src = doc.sources[p.sourceId];
                            if (!src?.buffer) return;
                            await this.loadSourcePdf(src);
                            if (!isCurrent()) return;
                            page = await src.doc.getPage(p.pageIndex + 1);
                            if (!isCurrent()) return;
                            const rot = (page.rotate + (p.rotation || 0)) % 360;
                            vp = page.getViewport({ scale, rotation: rot });
                            buffer.width = vp.width;
                            buffer.height = vp.height;
                            const taskParams = {
                                canvasContext: buffer.getContext('2d', { alpha: false }),
                                viewport: vp,
                                annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS
                            };
                            if (src && src.optionalContentConfigPromise) {
                                taskParams.optionalContentConfigPromise = src.optionalContentConfigPromise;
                            }
                            const task = page.render(taskParams);
                            canvas._activeRenderTask = task;
                            await task.promise;
                        }
                        if (!isCurrent()) return;
                        canvas.width = buffer.width;
                        canvas.height = buffer.height;
                        canvas.getContext('2d', { alpha: false }).drawImage(buffer, 0, 0);
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';
                        canvas.style.transform = `${p.flipH ? 'scaleX(-1) ' : ''}${p.flipV ? 'scaleY(-1)' : ''}`.trim() || 'none';
                        canvas.style.filter = doc._isInverted ? 'invert(100%)' : '';
                        wrapper.style.width = canvas.width + 'px';
                        wrapper.style.height = canvas.height + 'px';
                        if (vp) {
                            p.width = vp.width / scale;
                            p.height = vp.height / scale;
                        }
                        canvas._pdfPage = page;
                        canvas._pdfViewport = vp;
                        canvas._renderedScale = scale;
                        canvas._renderedSessionToken = sessionToken;
                    } catch (e) {
                        if (e.name !== 'RenderingCancelledException') console.error('Error rendering background page:', e);
                    } finally {
                        if (canvas._renderRequestToken === requestToken) {
                            canvas._activeRenderTask = null;
                            canvas._renderRequestToken = null;
                            canvas._renderPromise = null;
                        }
                    }
                })();
                canvas._renderPromise = promise;
                return promise;
            },

});
