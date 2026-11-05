// app.pdf_ops.js
// Extiende el objeto global `app` con métodos de pdf_ops
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            getExternalURL: function (value) {
                try {
                    const text = String(value).trim();
                    const url = new URL(text);
                    return ['http:', 'https:'].includes(url.protocol) ? text : null;
                } catch (_) { return null; }
            },

            analyzeURLWithVirusTotal: function (value) {
                const url = this.getExternalURL(value);
                if (!url) return;
                const form = 'https://www.virustotal.com/gui/home/url';
                if (navigator.clipboard?.writeText) {
                    const copying = navigator.clipboard.writeText(url);
                    window.open(form, '_blank', 'noopener,noreferrer');
                    copying.then(
                        () => this.showToast('URL copiada. Pégala en VirusTotal con Ctrl+V y pulsa Buscar.'),
                        () => this.showToast('No se pudo copiar la URL; usa el botón Copiar.')
                    );
                    return;
                }
                const input = document.createElement('textarea');
                input.value = url;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                let copied = false;
                try { copied = document.execCommand('copy'); } catch (_) { }
                input.remove();
                if (!copied) {
                    this.showToast('No se pudo copiar la URL');
                    return;
                }
                this.showToast('URL copiada. Pégala en VirusTotal con Ctrl+V y pulsa Buscar.');
                window.open(form, '_blank', 'noopener,noreferrer');
            },

            showExternalLinkMenu: function (value, event) {
                const url = this.getExternalURL(value);
                if (!url) return false;
                this._closeExternalLinkMenu?.();
                const menu = document.createElement('div');
                menu.className = 'external-link-menu';
                menu.setAttribute('role', 'menu');
                const addAction = (label, action) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = label;
                    button.addEventListener('click', () => { this._closeExternalLinkMenu(); action(); });
                    menu.appendChild(button);
                };
                addAction('Abrir', () => window.open(url, '_blank', 'noopener,noreferrer'));
                addAction('Copiar y abrir VirusTotal', () => this.analyzeURLWithVirusTotal(url));
                document.body.appendChild(menu);
                menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
                menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
                const close = e => { if (!menu.contains(e.target)) this._closeExternalLinkMenu(); };
                const escape = e => { if (e.key === 'Escape') this._closeExternalLinkMenu(); };
                this._closeExternalLinkMenu = () => {
                    document.removeEventListener('pointerdown', close, true);
                    document.removeEventListener('keydown', escape, true);
                    menu.remove();
                    this._closeExternalLinkMenu = null;
                };
                document.addEventListener('pointerdown', close, true);
                document.addEventListener('keydown', escape, true);
                menu.querySelector('button').focus();
                return true;
            },

            showScanResults: function (results, type) {
                const list = document.getElementById('qr-results-list');
                list.replaceChildren();
                document.getElementById('scan-result-title').textContent = type === 'QR' ? 'Códigos QR detectados' : 'Códigos de barras detectados';
                results.forEach((result, index) => {
                    const data = String(result.data);
                    const url = this.getExternalURL(data);
                    const item = document.createElement('div');
                    item.className = 'scan-result-item';
                    const heading = document.createElement('div');
                    heading.className = 'scan-result-heading';
                    heading.textContent = type + ' ' + (index + 1) + (result.source ? ' (' + result.source + ')' : '');
                    const content = document.createElement('div');
                    content.className = 'scan-result-content';
                    content.textContent = data;
                    const actions = document.createElement('div');
                    actions.className = 'scan-result-actions';
                    const addButton = (label, action, primary = false) => {
                        const button = document.createElement('button');
                        button.className = 'capsule-btn ' + (primary ? 'primary' : 'secondary');
                        button.textContent = label;
                        button.addEventListener('click', action);
                        actions.appendChild(button);
                    };
                    if (url) {
                        addButton('Visitar', () => window.open(url, '_blank', 'noopener,noreferrer'));
                        addButton('Copiar y abrir VirusTotal', () => this.analyzeURLWithVirusTotal(url), true);
                    }
                    addButton('Copiar', () => this.copyQRData(data));
                    item.append(heading, content, actions);
                    list.appendChild(item);
                });
                const overlay = document.getElementById('modal-overlay');
                overlay.style.display = 'flex';
                overlay.classList.remove('anim-in'); void overlay.offsetWidth; overlay.classList.add('anim-in');
                const modal = document.getElementById('qr-result-modal');
                modal.style.display = 'block';
                modal.classList.remove('anim-in'); void modal.offsetWidth; modal.classList.add('anim-in');
                document.querySelectorAll('.glass-box').forEach(m => {
                    if (m.id !== 'qr-result-modal') m.style.display = 'none';
                });
            },

            showQRGeneratorModal: async function () {
                if (typeof QRCode === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('qrcode');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('qrcode');
                }
                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                document.getElementById('qr-gen-modal').style.display = 'block';
                document.getElementById('drop-modal-content').style.display = 'none';
                document.getElementById('qr-result-modal').style.display = 'none';
                const preview = document.getElementById('qr-gen-preview');
                preview.innerHTML = '';
                document.getElementById('qr-gen-input').oninput = (e) => {
                    preview.innerHTML = '';
                    if (e.target.value.trim() !== '') {
                        new QRCode(preview, { text: e.target.value, width: 128, height: 128 });
                    }
                };
            },

            insertGeneratedQR: function () {
                const preview = document.getElementById('qr-gen-preview');
                const img = preview.querySelector('img');
                const canvas = preview.querySelector('canvas');
                let src = null;
                if (img && img.src) src = img.src;
                else if (canvas) src = canvas.toDataURL("image/png");

                if (src) {
                    const newObj = {
                        id: 'qr_' + Date.now(), type: 'image', src: src,
                        x: 50, y: 50, width: 150, height: 150,
                        opacity: 1, scaleX: 1, scaleY: 1, rotation: 0, filters: {}
                    };
                    const doc = this.getDoc();
                    doc.pages[doc.currentIndex].objects.push(newObj);
                    this.selectedObj = newObj;
                    this.multiObjectSelection.clear();
                    this.multiObjectSelection.add(newObj.id);
                    this.saveState();
                    this.renderOverlays();
                    this.renderSidebar();
                    this.closeAllModals();
                    this.showToast("QR Insertado");
                } else {
                    alert("Genera un código primero");
                }
            },

            // ─── BLUR REGIÓN ──────────────────────────────────────────────────────
            highlightTableOnPage: function (bbox, pageH) {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                if (!page) return;

                const scale = this.currentScale;

                // PyMuPDF devuelve Y-down desde arriba — misma convención que nuestro overlay.
                // Solo hay que escalar por currentScale.
                const x0 = bbox[0] * scale;
                const y0 = bbox[1] * scale;
                const w = (bbox[2] - bbox[0]) * scale;
                const h = (bbox[3] - bbox[1]) * scale;

                // Crear overlay de resaltado temporal
                const overlayLayer = document.getElementById('overlay-layer');
                if (!overlayLayer) return;

                const highlightDiv = document.createElement('div');
                highlightDiv.style.cssText = `
                    position: absolute;
                    left: ${x0}px; top: ${y0}px;
                    width: ${w}px; height: ${h}px;
                    border: 2px solid #f59e0b;
                    background: rgba(245,158,11,0.15);
                    border-radius: 2px;
                    pointer-events: none !important;
                    z-index: 9000;
                    animation: tableHighlightFade 2.5s ease-out forwards;
                `;

                // Asegurar que la animación CSS existe
                if (!document.getElementById('table-highlight-style')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'table-highlight-style';
                    styleEl.textContent = `
                        @keyframes tableHighlightFade {
                            0%   { opacity: 1; box-shadow: 0 0 0 0 rgba(245,158,11,0.6); }
                            30%  { box-shadow: 0 0 0 6px rgba(245,158,11,0.2); }
                            100% { opacity: 0; box-shadow: 0 0 0 0 rgba(245,158,11,0); }
                        }
                    `;
                    document.head.appendChild(styleEl);
                }

                overlayLayer.appendChild(highlightDiv);

                // Eliminar tras la animación
                setTimeout(() => highlightDiv.remove(), 2600);

                // Cerrar modal y hacer scroll a la zona
                this.closeAllModals();
                this.showToast('📍 Tabla resaltada en la página');

                // Scroll suave hacia la tabla
                const mainView = document.getElementById('mainViewPrimary') || document.getElementById('mainView');
                if (mainView) {
                    mainView.scrollTo({ top: Math.max(0, y0 - 40), behavior: 'smooth' });
                }
            },

            _commitPdfLinkCleanup: function (doc, replacements, affectedPageKeys) {
                const activePage = doc.pages[doc.currentIndex];
                this._syncNativeOverlayValuesForSave?.(doc.pages, activePage);
                this.saveState();
                for (const [sourceId, buffer] of replacements) {
                    const src = doc.sources[sourceId];
                    if (!src) continue;
                    src.buffer = buffer;
                    if (Object.prototype.hasOwnProperty.call(src, 'originalBuffer')) src.originalBuffer = buffer;
                    src.doc = null;
                }
                for (const page of doc.pages) {
                    if (affectedPageKeys.has(`${page.sourceId}:${page.pageIndex}`)) page._thumbCache = null;
                }
            },

            _linkCleanupMessage: function (key, fallback, values = {}) {
                let message = this.t?.(key, fallback) || fallback;
                for (const [name, value] of Object.entries(values)) message = message.replace(`{${name}}`, value);
                return message;
            },

            _ensureLinkCleanupEngine: async function () {
                if (!PythonManager.isLoaded) await PythonManager.init();
                if (!PythonManager.isLoaded) throw new Error(this._linkCleanupMessage('link_cleanup_engine_error', 'No se pudo iniciar el motor PDF'));
            },

            _showRemoveLinksDialog: function (mode, records, doc) {
                const isStampMode = mode === 'stamps';
                const title = document.getElementById('remove-links-title');
                const description = document.getElementById('remove-links-description');
                const grid = document.getElementById('remove-links-grid');
                const count = document.getElementById('remove-links-count');
                const apply = document.getElementById('btn-apply-remove-links');
                title.textContent = this._linkCleanupMessage(
                    isStampMode ? 'remove_stamps_title' : 'remove_links_area_title',
                    isStampMode ? 'Quitar sellos del documento' : 'Quitar vínculos del área'
                );
                description.textContent = this._linkCleanupMessage(
                    isStampMode ? 'remove_stamps_desc' : 'remove_links_area_desc',
                    isStampMode
                        ? 'Se eliminarán el vínculo y el contenido visual de cada sello seleccionado en todo el documento.'
                        : 'Solo se quitará la acción del vínculo; el contenido visible permanecerá.'
                );
                grid.replaceChildren();

                for (const record of records) {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'remove-link-card selected';
                    card.dataset.linkId = record.uiId;
                    card.setAttribute('aria-pressed', 'true');
                    card.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;border:2px solid var(--accent);border-radius:8px;padding:8px 12px;background:var(--input-bg);color:inherit;text-align:left;cursor:pointer;transition:border-color .15s;';
                    card.addEventListener('click', () => this._toggleRemoveLinkCard(card));

                    if (record.preview) {
                        const image = document.createElement('img');
                        image.src = record.preview;
                        image.alt = '';
                        image.style.cssText = 'width:80px;height:60px;object-fit:contain;border-radius:4px;flex-shrink:0;pointer-events:none;';
                        card.appendChild(image);
                    } else {
                        const icon = document.createElement('span');
                        icon.textContent = '🔗';
                        icon.style.cssText = 'width:80px;text-align:center;font-size:24px;flex-shrink:0;pointer-events:none;';
                        card.appendChild(icon);
                    }

                    const details = document.createElement('span');
                    details.style.cssText = 'display:block;flex:1;min-width:0;pointer-events:none;';
                    const area = document.createElement('span');
                    area.style.cssText = 'display:block;font-size:11px;font-weight:600;margin-bottom:2px;';
                    const pageNumbers = record.documentPageNumbers?.join(', ') || String((record.documentPageIndex ?? doc.currentIndex) + 1);
                    area.textContent = this._linkCleanupMessage('remove_links_card_meta', 'Página {page} · Área: {width}×{height} pts', {
                        page: pageNumbers,
                        width: record.w,
                        height: record.h
                    });
                    const destination = document.createElement('span');
                    destination.style.cssText = 'display:block;font-size:10px;color:#888;word-break:break-all;max-height:36px;overflow:hidden;';
                    destination.textContent = record.label || record.uri || this._linkCleanupMessage('remove_links_internal', 'Vínculo interno');
                    details.append(area, destination);
                    card.appendChild(details);

                    const check = document.createElement('span');
                    check.className = 'remove-link-check';
                    check.textContent = '✓';
                    check.setAttribute('aria-hidden', 'true');
                    check.style.cssText = 'font-size:18px;color:var(--accent);font-weight:700;flex-shrink:0;pointer-events:none;';
                    card.appendChild(check);
                    grid.appendChild(card);
                }

                count.textContent = this._linkCleanupMessage('remove_links_count', '{count} vínculo(s) detectado(s)', { count: records.length });
                apply.disabled = records.length === 0;
                this._removeLinksData = { mode, records, recordsById: new Map(records.map(record => [record.uiId, record])), doc };

                this.closeAllModals();
                const overlay = document.getElementById('modal-overlay');
                overlay.style.display = 'flex';
                overlay.classList.remove('anim-in'); void overlay.offsetWidth; overlay.classList.add('anim-in');
                const modal = document.getElementById('remove-links-modal');
                modal.style.display = 'block';
                modal.classList.remove('anim-in'); void modal.offsetWidth; modal.classList.add('anim-in');
                setTimeout(() => document.getElementById('btn-cancel-remove-links')?.focus(), 0);
            },

            showRemoveLinksModal: async function () {
                const doc = this.getDoc();
                if (!doc?.pages?.length) {
                    this.showToast(this._linkCleanupMessage('link_cleanup_open_pdf', '⚠️ Abre un PDF primero'));
                    return;
                }
                this.toggleLoader(true, this._linkCleanupMessage('remove_stamps_scanning', 'Detectando sellos en todo el documento...'));
                try {
                    await this._ensureLinkCleanupEngine();
                    const records = [];
                    for (const sourcePlan of PDFLinkCleanup.buildSourceScanPlan(doc)) {
                        const links = await PythonManager.extractLinksWithPreview(sourcePlan.buffer, sourcePlan.pageIndexes);
                        for (const link of links) {
                            const documentPageNumbers = doc.pages
                                .map((page, index) => page.sourceId === sourcePlan.sourceId && page.pageIndex === link.pageIndex ? index + 1 : null)
                                .filter(Boolean);
                            records.push({
                                ...link,
                                recordType: 'pdf',
                                sourceId: sourcePlan.sourceId,
                                uiId: `pdf:${sourcePlan.sourceId}:${link.id}`,
                                documentPageNumbers
                            });
                        }
                    }
                    if (!records.length) {
                        this.showToast(this._linkCleanupMessage('remove_stamps_empty', 'No se detectaron sellos vinculados en el documento'));
                        return;
                    }
                    this._showRemoveLinksDialog('stamps', records, doc);
                } catch (error) {
                    console.error('Stamp scan failed:', error);
                    this.showToast(this._linkCleanupMessage('link_cleanup_error', '❌ Error: {error}', { error: error.message }));
                } finally {
                    this.toggleLoader(false);
                }
            },

            enableRemoveLinksAreaMode: function () {
                const doc = this.getDoc();
                if (!doc?.pages?.length) {
                    this.showToast(this._linkCleanupMessage('link_cleanup_open_pdf', '⚠️ Abre un PDF primero'));
                    return;
                }
                const linkedObject = this.selectedObj && (this.selectedObj.type === 'link' || this.selectedObj.actionLink) ? this.selectedObj : null;
                if (linkedObject?.width && linkedObject?.height) {
                    this.showRemoveLinksInAreaModal({
                        x0: linkedObject.x,
                        y0: linkedObject.y,
                        x1: linkedObject.x + linkedObject.width,
                        y1: linkedObject.y + linkedObject.height
                    });
                    return;
                }

                this._cancelRemoveLinksAreaSelection(false);
                const button = document.getElementById('btn-remove-links-area');
                const canvas = document.getElementById('the-canvas');
                const container = document.getElementById('canvas-container');
                if (!canvas || !container) return;
                this._removeLinksAreaMode = true;
                button?.classList.add('active');
                button?.setAttribute('aria-pressed', 'true');
                document.body.style.cursor = 'crosshair';
                this.showToast(this._linkCleanupMessage('remove_links_select_area', '🔗 Arrastra sobre el área · Esc para cancelar'));

                this._removeLinksAreaKeyDown = event => {
                    if (event.key === 'Escape') this._cancelRemoveLinksAreaSelection(true);
                };
                window.addEventListener('keydown', this._removeLinksAreaKeyDown);

                this._removeLinksAreaPointerDown = event => {
                    if (!this._removeLinksAreaMode || (event.button !== undefined && event.button !== 0)) return;
                    const canvasRect = canvas.getBoundingClientRect();
                    if (event.clientX < canvasRect.left || event.clientX > canvasRect.right || event.clientY < canvasRect.top || event.clientY > canvasRect.bottom) return;
                    event.preventDefault();
                    const containerRect = container.getBoundingClientRect();
                    const clampX = value => Math.max(0, Math.min(canvasRect.width, value - canvasRect.left));
                    const clampY = value => Math.max(0, Math.min(canvasRect.height, value - canvasRect.top));
                    const startX = clampX(event.clientX);
                    const startY = clampY(event.clientY);
                    const overlay = document.createElement('div');
                    overlay.id = 'remove-links-area-overlay';
                    overlay.style.cssText = `position:absolute;border:2px dashed var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent);pointer-events:none;z-index:9999;left:${startX + canvasRect.left - containerRect.left}px;top:${startY + canvasRect.top - containerRect.top}px;width:0;height:0;border-radius:6px;`;
                    container.appendChild(overlay);

                    const move = moveEvent => {
                        const x = clampX(moveEvent.clientX);
                        const y = clampY(moveEvent.clientY);
                        overlay.style.left = Math.min(startX, x) + canvasRect.left - containerRect.left + 'px';
                        overlay.style.top = Math.min(startY, y) + canvasRect.top - containerRect.top + 'px';
                        overlay.style.width = Math.abs(x - startX) + 'px';
                        overlay.style.height = Math.abs(y - startY) + 'px';
                    };
                    const up = async upEvent => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                        const endX = clampX(upEvent.clientX);
                        const endY = clampY(upEvent.clientY);
                        const width = Math.abs(endX - startX);
                        const height = Math.abs(endY - startY);
                        overlay.remove();
                        if (width < 5 || height < 5) {
                            this.showToast(this._linkCleanupMessage('remove_links_area_small', '⚠️ Selección muy pequeña'));
                            return;
                        }
                        try {
                            const page = doc.pages[doc.currentIndex];
                            const src = doc.sources[page.sourceId];
                            if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: (src.originalBuffer || src.buffer).slice(0) }).promise;
                            const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                            const viewport = pdfPage.getViewport({ scale: 1 });
                            const area = PDFLinkCleanup.canvasAreaToPageArea(
                                { x0: startX, y0: startY, x1: endX, y1: endY },
                                { width: canvasRect.width, height: canvasRect.height },
                                { width: viewport.width, height: viewport.height }
                            );
                            this._cancelRemoveLinksAreaSelection(false);
                            await this.showRemoveLinksInAreaModal(area);
                        } catch (error) {
                            this._cancelRemoveLinksAreaSelection(false);
                            console.error('Area link selection failed:', error);
                            this.showToast(this._linkCleanupMessage('link_cleanup_error', '❌ Error: {error}', { error: error.message }));
                        }
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                };
                window.addEventListener('pointerdown', this._removeLinksAreaPointerDown);
            },

            _cancelRemoveLinksAreaSelection: function (showFeedback = true) {
                if (this._removeLinksAreaPointerDown) window.removeEventListener('pointerdown', this._removeLinksAreaPointerDown);
                if (this._removeLinksAreaKeyDown) window.removeEventListener('keydown', this._removeLinksAreaKeyDown);
                this._removeLinksAreaPointerDown = null;
                this._removeLinksAreaKeyDown = null;
                this._removeLinksAreaMode = false;
                document.getElementById('remove-links-area-overlay')?.remove();
                const button = document.getElementById('btn-remove-links-area');
                button?.classList.remove('active');
                button?.setAttribute('aria-pressed', 'false');
                document.body.style.cursor = '';
                if (showFeedback) this.showToast(this._linkCleanupMessage('remove_links_area_cancelled', 'Selección cancelada'));
            },

            showRemoveLinksInAreaModal: async function (area) {
                const doc = this.getDoc();
                const page = doc?.pages?.[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src?.buffer) return;
                this.toggleLoader(true, this._linkCleanupMessage('remove_links_area_scanning', 'Buscando vínculos en el área...'));
                try {
                    await this._ensureLinkCleanupEngine();
                    const nativeLinks = await PythonManager.extractLinksWithPreview(src.originalBuffer || src.buffer, [page.pageIndex]);
                    const records = PDFLinkCleanup.selectLinksInArea(nativeLinks, area, page.pageIndex).map(link => ({
                        ...link,
                        recordType: 'pdf',
                        sourceId: page.sourceId,
                        uiId: `pdf:${page.sourceId}:${link.id}`,
                        documentPageIndex: doc.currentIndex
                    }));
                    for (const object of page.objects || []) {
                        if (object.type !== 'link' && !object.actionLink) continue;
                        const bounds = [object.x, object.y, object.x + (object.width || 0), object.y + (object.height || 0)];
                        if (!PDFLinkCleanup.intersects(bounds, area)) continue;
                        const action = object.actionLink || object;
                        records.push({
                            recordType: 'app',
                            objectId: object.id,
                            documentPageIndex: doc.currentIndex,
                            uiId: `app:${doc.currentIndex}:${object.id}`,
                            from: bounds,
                            w: Math.round((object.width || 0) * 10) / 10,
                            h: Math.round((object.height || 0) * 10) / 10,
                            label: action.url || (action.internalPage ? this._linkCleanupMessage('remove_links_internal_page', 'Página interna {page}', { page: action.internalPage }) : object.text || '')
                        });
                    }
                    if (!records.length) {
                        this.showToast(this._linkCleanupMessage('remove_links_area_empty', 'No hay vínculos en el área seleccionada'));
                        return;
                    }
                    this._showRemoveLinksDialog('area', records, doc);
                } catch (error) {
                    console.error('Area link scan failed:', error);
                    this.showToast(this._linkCleanupMessage('link_cleanup_error', '❌ Error: {error}', { error: error.message }));
                } finally {
                    this.toggleLoader(false);
                }
            },

            _toggleRemoveLinkCard: function (card) {
                const selected = card.classList.toggle('selected');
                card.setAttribute('aria-pressed', String(selected));
                card.style.borderColor = selected ? 'var(--accent)' : 'var(--border)';
                card.querySelector('.remove-link-check').style.visibility = selected ? 'visible' : 'hidden';
                document.getElementById('btn-apply-remove-links').disabled = !document.querySelector('#remove-links-grid .remove-link-card.selected');
            },

            _toggleAllRemoveLinks: function (select) {
                document.querySelectorAll('#remove-links-grid .remove-link-card').forEach(card => {
                    if (card.classList.contains('selected') !== select) this._toggleRemoveLinkCard(card);
                });
            },

            _applyRemoveLinks: async function () {
                const data = this._removeLinksData;
                if (!data) return;
                const selected = [...document.querySelectorAll('#remove-links-grid .remove-link-card.selected')]
                    .map(card => data.recordsById.get(card.dataset.linkId))
                    .filter(Boolean);
                if (!selected.length) {
                    this.showToast(this._linkCleanupMessage('remove_links_select_required', '⚠️ Selecciona al menos un vínculo'));
                    return;
                }

                this.closeAllModals();
                this.toggleLoader(true, this._linkCleanupMessage(
                    data.mode === 'stamps' ? 'remove_stamps_processing' : 'remove_links_area_processing',
                    data.mode === 'stamps' ? 'Quitando sellos...' : 'Quitando vínculos...'
                ));
                try {
                    const replacements = new Map();
                    const affectedPageKeys = new Set();
                    const pdfGroups = new Map();
                    for (const record of selected.filter(item => item.recordType === 'pdf')) {
                        if (!pdfGroups.has(record.sourceId)) pdfGroups.set(record.sourceId, []);
                        pdfGroups.get(record.sourceId).push(record);
                        affectedPageKeys.add(`${record.sourceId}:${record.pageIndex}`);
                    }
                    for (const [sourceId, targets] of pdfGroups) {
                        const src = data.doc.sources[sourceId];
                        const baseBuffer = src.originalBuffer || src.buffer;
                        const nextBuffer = await PythonManager.deleteLinks(baseBuffer, targets, data.mode === 'stamps');
                        replacements.set(sourceId, nextBuffer);
                    }

                    const appChanges = new Map();
                    for (const record of selected.filter(item => item.recordType === 'app')) {
                        if (!appChanges.has(record.documentPageIndex)) appChanges.set(record.documentPageIndex, new Set());
                        appChanges.get(record.documentPageIndex).add(record.objectId);
                    }
                    const stagedObjects = new Map();
                    for (const [pageIndex, objectIds] of appChanges) {
                        const targetPage = data.doc.pages[pageIndex];
                        stagedObjects.set(pageIndex, PDFLinkCleanup.unlinkAppObjectsById(targetPage.objects || [], objectIds).objects);
                        affectedPageKeys.add(`${targetPage.sourceId}:${targetPage.pageIndex}`);
                    }

                    this._commitPdfLinkCleanup(data.doc, replacements, affectedPageKeys);
                    for (const [pageIndex, objects] of stagedObjects) data.doc.pages[pageIndex].objects = objects;
                    this._removeLinksData = null;
                    await this.loadPage(data.doc.currentIndex);
                    this.renderSidebar?.();
                    document.querySelectorAll('.thumb-wrap').forEach(element => {
                        const index = Number(element.dataset.index);
                        const page = data.doc.pages[index];
                        if (page && affectedPageKeys.has(`${page.sourceId}:${page.pageIndex}`)) this._enqueueThumbnail(element);
                    });
                    this.showToast(this._linkCleanupMessage(
                        data.mode === 'stamps' ? 'remove_stamps_done' : 'remove_links_area_done',
                        data.mode === 'stamps' ? '✅ {count} sello(s) eliminado(s)' : '✅ {count} vínculo(s) eliminado(s)',
                        { count: selected.length }
                    ));
                } catch (error) {
                    console.error('PDF link cleanup failed:', error);
                    this.showToast(this._linkCleanupMessage('link_cleanup_error', '❌ Error: {error}', { error: error.message }));
                } finally {
                    this.toggleLoader(false);
                }
            },

            showRemoveImagesModal: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando...'); PythonManager.init(); return; }

                this.toggleLoader(true, 'Leyendo imágenes embebidas...');
                try {
                    // Extraer imágenes de la página actual para mostrar miniaturas
                    const images = await PythonManager.extractImages(src.buffer, page.pageIndex);
                    this.toggleLoader(false);

                    this._removeImagesData = { src, doc, images, pageIndex: page.pageIndex };

                    const grid = document.getElementById('remove-images-grid');
                    const countEl = document.getElementById('remove-images-count');
                    const applyBtn = document.getElementById('btn-apply-remove-images');

                    if (!images || images.length === 0) {
                        grid.innerHTML = '<p style="color:#888;text-align:center;width:100%;padding:20px;">No hay imágenes embebidas en esta página.</p>';
                        countEl.textContent = '';
                        applyBtn.disabled = true;
                    } else {
                        grid.innerHTML = images.map((img, i) => `
                            <div class="remove-img-card" data-xref="${img.xref}" data-idx="${i}"
                                style="display:flex;flex-direction:column;align-items:center;gap:6px;border:2px solid var(--border);border-radius:8px;padding:8px;background:var(--input-bg);cursor:pointer;transition:border-color .15s;"
                                onclick="app._toggleRemoveImageCard(this)">
                                <img src="${img.base64}" style="max-width:140px;max-height:140px;object-fit:contain;border-radius:3px;pointer-events:none;" alt="Img ${i+1}">
                                <span style="font-size:10px;color:#888;pointer-events:none;">${img.width}×${img.height}px · ${img.ext.toUpperCase()}</span>
                                <span class="remove-img-check" style="font-size:11px;color:var(--accent);font-weight:700;pointer-events:none;visibility:hidden;">✓ Seleccionada</span>
                            </div>
                        `).join('');
                        countEl.textContent = `${images.length} imagen(es) encontrada(s)`;
                        applyBtn.disabled = true;
                    }

                    this.closeAllModals();
                    const _mo = document.getElementById('modal-overlay');
                    _mo.style.display = 'flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    const modal = document.getElementById('remove-images-modal');
                    modal.style.display = 'block';
                    modal.classList.remove('anim-in'); void modal.offsetWidth; modal.classList.add('anim-in');
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error: ' + e.message);
                }
            },

            _toggleRemoveImageCard: function (card) {
                const sel = card.classList.toggle('selected');
                card.style.borderColor = sel ? 'var(--accent)' : 'var(--border)';
                card.querySelector('.remove-img-check').style.visibility = sel ? 'visible' : 'hidden';
                const anySelected = document.querySelectorAll('#remove-images-grid .remove-img-card.selected').length > 0;
                document.getElementById('btn-apply-remove-images').disabled = !anySelected;
            },

            _toggleAllRemoveImages: function (select) {
                document.querySelectorAll('#remove-images-grid .remove-img-card').forEach(card => {
                    const isSel = card.classList.contains('selected');
                    if (select !== isSel) this._toggleRemoveImageCard(card);
                });
            },

            _applyRemoveImages: async function () {
                const data = this._removeImagesData;
                if (!data) return;
                const selected = [...document.querySelectorAll('#remove-images-grid .remove-img-card.selected')];
                if (!selected.length) { this.showToast('⚠️ Selecciona al menos una imagen'); return; }

                const xrefs = selected.map(c => parseInt(c.dataset.xref));
                const scope = document.querySelector('input[name="remove-img-scope"]:checked')?.value || 'current';
                const pages = scope === 'all' ? 'all' : [data.pageIndex];

                this.closeAllModals();
                this.toggleLoader(true, 'Eliminando imágenes...');
                try {
                    const newBuffer = await PythonManager.deleteImagesByXref(data.src.buffer, xrefs, pages);
                    data.src.buffer = newBuffer;
                    data.src.doc = null; // Force PDF.js to re-parse the modified buffer
                    // Invalidate thumbnail caches for affected pages
                    if (data.doc && data.doc.pages) {
                        data.doc.pages.forEach(p => { p._thumbCache = null; });
                    }
                    // Re-renderizar páginas afectadas
                    this.goToPage(data.doc.currentIndex);
                    this.renderSidebar();
                    this.toggleLoader(false);
                    this.showToast(`✅ ${xrefs.length} imagen(es) eliminada(s)`);
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error eliminando imágenes: ' + e.message);
                }
            },

            extractEmbeddedImages: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando, intenta en unos segundos...'); PythonManager.init(); return; }

                this.toggleLoader(true, 'Extrayendo imágenes embebidas...');
                try {
                    const images = await PythonManager.extractImages(src.buffer, page.pageIndex);
                    this.toggleLoader(false);

                    const container = document.getElementById('images-modal-content');
                    if (!images || images.length === 0) {
                        container.innerHTML = '<p style="color:#888; text-align:center; padding:20px; width:100%;">No hay imágenes embebidas en esta página.</p>';
                    } else {
                        container.innerHTML = images.map((img, i) => `
                            <div style="display:flex; flex-direction:column; align-items:center; gap:6px; border:1px solid var(--border); border-radius:6px; padding:8px; background:var(--input-bg);">
                                <img src="${img.base64}" style="max-width:160px; max-height:160px; object-fit:contain; border-radius:3px;" alt="Imagen ${i + 1}">
                                <span style="font-size:10px; color:#888;">${img.width}×${img.height}px · ${img.ext.toUpperCase()}</span>
                                <a href="${img.base64}" download="imagen_${i + 1}.${img.ext}"
                                   style="font-size:10px; color:var(--accent); text-decoration:none; padding:2px 8px; border:1px solid var(--accent); border-radius:10px;">
                                   ⬇ Descargar
                                </a>
                            </div>
                        `).join('');
                    }

                    this.closeAllModals();
                    (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                    document.getElementById('images-modal').style.display = 'block';
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error extrayendo imágenes: ' + e.message);
                }
            },

            /** Muestra el panel de metadatos del PDF */
            _switchPropTab: function (tab) {
                const tabs = ['desc', 'sec', 'fonts', 'adv'];
                tabs.forEach(t => {
                    const btn = document.getElementById('proptab-' + t);
                    const panel = document.getElementById('proppanel-' + t);
                    if (btn) btn.classList.toggle('active', t === tab);
                    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
                });
                const saveBtn = document.getElementById('btn-save-metadata');
                if (saveBtn) {
                    saveBtn.style.display = (tab === 'desc') ? 'inline-block' : 'none';
                }
            },

            openDocumentProperties: function () {
                return this.showMetadataPanel();
            },

            showMetadataPanel: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando, intenta en unos segundos...'); PythonManager.init(); return; }

                this.toggleLoader(true, 'Inspeccionando propiedades del documento...');
                try {
                    const props = await PythonManager.inspectDocumentProperties(src.buffer);
                    this.toggleLoader(false);
                    this._currentMetaSource = src;

                    const meta = props?.metadata || {};
                    const pageSize = props?.page_size || {};
                    const sec = props?.security || {};
                    const fonts = props?.fonts || [];
                    const adv = props?.advanced || {};

                    // Tab 1: Descripción
                    document.getElementById('meta-title').value = meta.title || '';
                    document.getElementById('meta-author').value = meta.author || '';
                    document.getElementById('meta-subject').value = meta.subject || '';
                    document.getElementById('meta-keywords').value = meta.keywords || '';
                    document.getElementById('meta-creator').value = meta.creator || '';
                    document.getElementById('meta-producer').value = meta.producer || '';
                    document.getElementById('meta-created').value = meta.creationDate || '';
                    document.getElementById('meta-modified').value = meta.modDate || '';
                    
                    const metaPages = document.getElementById('meta-pages');
                    if (metaPages) metaPages.textContent = `${props?.page_count || 1} página(s)`;
                    const metaPageSize = document.getElementById('meta-pagesize');
                    if (metaPageSize) {
                        const paperStr = pageSize.paper_name ? ` (${pageSize.paper_name})` : '';
                        metaPageSize.textContent = `${pageSize.width_mm || 0} × ${pageSize.height_mm || 0} mm${paperStr} / ${pageSize.width_pt || 0} × ${pageSize.height_pt || 0} pt`;
                    }
                    const metaFileSize = document.getElementById('meta-filesize');
                    if (metaFileSize) {
                        const bytes = props?.file_size || src.buffer.byteLength || 0;
                        const sizeStr = bytes > 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
                        metaFileSize.textContent = sizeStr;
                    }

                    // Tab 2: Seguridad
                    const secMethod = document.getElementById('sec-method');
                    if (secMethod) secMethod.textContent = sec.method || 'Ninguno';
                    const secDesc = document.getElementById('sec-encrypted-desc');
                    if (secDesc) {
                        secDesc.textContent = sec.is_encrypted 
                            ? 'Este documento está protegido o cifrado. Ciertas acciones pueden estar restringidas.'
                            : 'Todas las funciones y permisos están habilitados (sin cifrar).';
                    }
                    const permsBody = document.getElementById('sec-perms-body');
                    if (permsBody) {
                        const perms = sec.permissions || {};
                        const permRows = [
                            { name: 'Impresión', val: perms.printing },
                            { name: 'Modificación del documento', val: perms.changing },
                            { name: 'Copiado de texto e imágenes', val: perms.copying },
                            { name: 'Comentarios y notas', val: perms.annotations },
                            { name: 'Relleno de campos de formulario', val: perms.forms },
                            { name: 'Extracción de contenido para accesibilidad', val: perms.accessibility },
                            { name: 'Ensamblado y combinación de páginas', val: perms.assembly }
                        ];
                        permsBody.innerHTML = permRows.map(r => {
                            const isAllowed = (r.val || '').toLowerCase().includes('permitido');
                            const badgeClass = isAllowed ? 'success' : 'danger';
                            return `<tr>
                                <td style="width:60%; font-weight:500;">${r.name}</td>
                                <td style="width:40%;"><span class="prop-badge ${badgeClass}">${r.val || 'Desconocido'}</span></td>
                            </tr>`;
                        }).join('');
                    }

                    // Tab 3: Fuentes
                    const fontsBody = document.getElementById('fonts-table-body');
                    if (fontsBody) {
                        if (fonts.length === 0) {
                            fontsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748b;">No se detectaron fuentes incrustadas</td></tr>`;
                        } else {
                            fontsBody.innerHTML = fonts.map(f => {
                                const embBadge = f.embedded 
                                    ? `<span class="prop-badge success">Incrustada${f.subset ? ' (Subconjunto)' : ''}</span>`
                                    : `<span class="prop-badge warning">No incrustada</span>`;
                                return `<tr>
                                    <td style="font-weight:500;">${f.name}</td>
                                    <td>${f.type}</td>
                                    <td>${embBadge}</td>
                                    <td style="font-family:monospace; font-size:10px;">${f.encoding}</td>
                                </tr>`;
                            }).join('');
                        }
                    }

                    // Tab 4: Avanzado
                    const advVer = document.getElementById('adv-pdf-version');
                    if (advVer) advVer.textContent = adv.pdf_version || 'PDF 1.7';
                    const advWeb = document.getElementById('adv-web-view');
                    if (advWeb) advWeb.innerHTML = adv.fast_web_view ? '<span class="prop-badge success">Sí (Linearizado)</span>' : '<span class="prop-badge">No</span>';
                    const advForm = document.getElementById('adv-is-form');
                    if (advForm) advForm.innerHTML = adv.is_form ? '<span class="prop-badge success">Sí (AcroForm)</span>' : '<span class="prop-badge">No</span>';
                    const advLayers = document.getElementById('adv-layers-count');
                    if (advLayers) advLayers.textContent = adv.layers_count > 0 ? `${adv.layers_count} capas detectadas` : 'Ninguna capa OCG';
                    
                    const boxesCont = document.getElementById('adv-boxes-container');
                    if (boxesCont && adv.page_boxes) {
                        const b = adv.page_boxes;
                        boxesCont.innerHTML = `
                            <div>MediaBox: [${(b.mediabox || []).join(', ')}]</div>
                            <div>CropBox:  [${(b.cropbox || []).join(', ')}]</div>
                            <div>BleedBox: [${(b.bleedbox || []).join(', ')}]</div>
                            <div>TrimBox:  [${(b.trimbox || []).join(', ')}]</div>
                            <div>ArtBox:   [${(b.artbox || []).join(', ')}]</div>
                        `;
                    }

                    // Activar Tab 1 por defecto
                    this._switchPropTab('desc');

                    this.closeAllModals();
                    (function(){ 
                        const _mo = document.getElementById('modal-overlay');
                        if (_mo) {
                            _mo.style.display = 'flex';
                            _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                        }
                    })();
                    document.getElementById('metadata-modal').style.display = 'block';
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error leyendo propiedades: ' + e.message);
                }
            },

            /** Guarda los metadatos editados en el PDF */
            saveDocumentMetadata: async function () {
                const src = this._currentMetaSource;
                if (!src || !src.buffer) { this.showToast('⚠️ Sin fuente PDF'); return; }

                const newMeta = {
                    title: document.getElementById('meta-title').value,
                    author: document.getElementById('meta-author').value,
                    subject: document.getElementById('meta-subject').value,
                    keywords: document.getElementById('meta-keywords').value,
                    creator: document.getElementById('meta-creator').value,
                };

                this.toggleLoader(true, 'Guardando metadatos...');
                try {
                    const newBuffer = await PythonManager.getSetMetadata(src.buffer, newMeta);
                    src.buffer = newBuffer;
                    this.toggleLoader(false);
                    this.closeAllModals();
                    this.showToast('✅ Metadatos guardados');
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error guardando metadatos: ' + e.message);
                }
            },

            // ── AVANZADO: HERRAMIENTAS PYTHON ──

            repairAndOptimizePDF: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                this.toggleLoader(true, 'Python: Reparando y optimizando estructura...');
                try {
                    const optimizedBuffer = await PythonManager.repairAndOptimize(src.buffer);
                    const blob = new Blob([optimizedBuffer], { type: 'application/pdf' });
                    const file = new File([blob], "optimizado_" + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    await this.openFile(file);
                    this.showToast('✅ Estructura reparada y optimizada');
                } catch (e) {
                    this.showToast('❌ Error en optimización: ' + e.message);
                }
                this.toggleLoader(false);
            },

            showCompressPDFModal: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                const originalSize = src.buffer.byteLength;
                const formatSize = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

                const level = await new Promise(resolve => {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
                    overlay.innerHTML = `
                      <form onsubmit="return false;" style="display:contents;">
                      <div style="background:rgba(26,32,53,0.63);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:28px 28px 24px;width:380px;max-width:92vw;color:#f0f4ff;font-family:inherit;box-shadow:0 16px 48px rgba(0,0,0,0.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);position:relative;">
                        <button class="modal-close-btn-round" onclick="document.getElementById('_compCancel')?.click();" style="position:absolute;top:14px;right:14px;">✕</button>
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#f0f4ff;flex-shrink:0;"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><rect x="4" y="17" width="16" height="3" rx="1"/></svg>
                          <span style="font-size:15px;font-weight:700;">Comprimir PDF</span>
                        </div>
                        <div style="font-size:11.5px;color:rgba(200,215,255,0.65);margin-bottom:20px;line-height:1.5;">
                          Tamaño actual: <strong style="color:#fff">${formatSize(originalSize)}</strong>
                        </div>
                        <label style="display:block;font-size:11px;font-weight:600;color:rgba(200,215,255,0.7);margin-bottom:10px;letter-spacing:0.4px;">NIVEL DE COMPRESIÓN</label>
                        
                        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px; font-size: 13px;">
                            <label style="cursor:pointer; display:flex; align-items:center; gap:8px; padding: 6px; border-radius: 6px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="radio" name="comp_lvl" value="-1">
                                <span><strong>Lossless</strong> (Solo estructura)</span>
                            </label>
                            <label style="cursor:pointer; display:flex; align-items:center; gap:8px; padding: 6px; border-radius: 6px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="radio" name="comp_lvl" value="0">
                                <span><strong>Rápida</strong> (Estructura + deflate)</span>
                            </label>
                            <label style="cursor:pointer; display:flex; align-items:center; gap:8px; padding: 6px; border-radius: 6px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="radio" name="comp_lvl" value="75" checked>
                                <span><strong>Estándar</strong> (JPEG 75%, redimensionar &gt; 2400px)</span>
                            </label>
                            <label style="cursor:pointer; display:flex; align-items:center; gap:8px; padding: 6px; border-radius: 6px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                                <input type="radio" name="comp_lvl" value="45">
                                <span><strong>Máxima</strong> (JPEG 45%, redimensionar &gt; 1600px)</span>
                            </label>
                        </div>
                        
                        <div style="display:flex;gap:10px;justify-content:flex-end;">
                          <button id="_compCancel" style="padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.07);color:#c8d7ff;cursor:pointer;font-size:12px;font-family:inherit;transition:background 0.15s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">Cancelar</button>
                          <button id="_compOk" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent,#185abd);color:white;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:background 0.15s;filter:brightness(1);"
                            onmouseover="this.style.filter='brightness(0.85)'" onmouseout="this.style.filter='brightness(1)'">Comprimir</button>
                        </div>
                      </div>
                      </form>`;
                    document.body.appendChild(overlay);
                    overlay.querySelector('#_compCancel').onclick = () => { document.body.removeChild(overlay); resolve(null); };
                    overlay.querySelector('#_compOk').onclick = () => {
                        const sel = overlay.querySelector('input[name="comp_lvl"]:checked');
                        document.body.removeChild(overlay);
                        resolve(sel ? parseInt(sel.value) : 75);
                    };
                    overlay.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('#_compOk').click(); if (e.key === 'Escape') { document.body.removeChild(overlay); resolve(null); } });
                });

                if (level === null) return;

                this.toggleLoader(true, 'Python: Comprimiendo PDF...');
                try {
                    const compressedBuffer = await PythonManager.compressPDF(src.buffer, level);
                    const newSize = compressedBuffer.byteLength;
                    
                    const blob = new Blob([compressedBuffer], { type: 'application/pdf' });
                    const file = new File([blob], (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    
                    src.buffer = compressedBuffer;
                    await this.openFile(file);
                    
                    if (newSize >= originalSize) {
                        this.showToast(`⚠️ Archivo comprimido sin reducción (antes: ${formatSize(originalSize)} -> ahora: ${formatSize(newSize)})`);
                    } else {
                        const pct = (((originalSize - newSize) / originalSize) * 100).toFixed(1);
                        this.showToast(`✅ Comprimido ${pct}% (antes: ${formatSize(originalSize)} -> ahora: ${formatSize(newSize)})`);
                    }
                } catch (e) {
                    this.showToast('❌ Error en compresión: ' + e.message);
                }
                this.toggleLoader(false);
            },

            // ── Seguridad PDF: toggles de bloqueo ────────────────────────
            // Estado global de los 3 bloqueos activos
            _pdfLocks: { edit: false, print: false, copy: false },

            togglePDFLock: async function (type) {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src  = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('🔐 Abre un PDF primero'); return; }

                // Si se va a ACTIVAR el bloqueo, pedir contraseña
                const willLock = !this._pdfLocks[type];
                let userPassword = '';
                if (willLock) {
                    const pw = await new Promise(resolve => {
                        // Modal de contraseña inline
                        const overlay = document.createElement('div');
                        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
                        const names = { edit: 'Edición', print: 'Impresión', copy: 'Copia' };
                        overlay.innerHTML = `
                          <form onsubmit="return false;" style="display:contents;">
                          <input type="text" name="username" autocomplete="username" style="display:none;" aria-hidden="true">
                          <div style="background:rgba(26,32,53,0.63);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:28px 28px 24px;width:340px;max-width:92vw;color:#f0f4ff;font-family:inherit;box-shadow:0 16px 48px rgba(0,0,0,0.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);position:relative;">
                            <button class="modal-close-btn-round" onclick="document.getElementById('_lockPwCancel')?.click();" style="position:absolute;top:14px;right:14px;">✕</button>
                            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#f0f4ff;flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" fill="none"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"/></svg>
                              <span style="font-size:15px;font-weight:700;">Bloquear ${names[type]}</span>
                            </div>
                            <div style="font-size:11.5px;color:rgba(200,215,255,0.65);margin-bottom:20px;line-height:1.5;">
                              Esta contraseña será requerida para ${type === 'edit' ? 'editar' : type === 'print' ? 'imprimir' : 'copiar'} el documento en otros editores como Acrobat o Nitro Pro.
                            </div>
                            <label style="display:block;font-size:11px;font-weight:600;color:rgba(200,215,255,0.7);margin-bottom:5px;letter-spacing:0.4px;">CONTRASEÑA</label>
                            <input id="_lockPwInput" type="password" placeholder="Ingresa una contraseña" autocomplete="new-password"
                              style="display:block;width:100%;box-sizing:border-box;padding:10px 13px;border-radius:8px;border:1.5px solid rgba(100,140,255,0.35);background:#0f1628;color:#e8eeff;font-size:13px;outline:none;margin-bottom:14px;font-family:inherit;transition:border-color 0.2s;"
                              onfocus="this.style.borderColor='rgba(100,140,255,0.8)'" onblur="this.style.borderColor='rgba(100,140,255,0.35)'">
                            <label style="display:block;font-size:11px;font-weight:600;color:rgba(200,215,255,0.7);margin-bottom:5px;letter-spacing:0.4px;">CONFIRMAR CONTRASEÑA</label>
                            <input id="_lockPwConfirm" type="password" placeholder="Repite la contraseña" autocomplete="new-password"
                              style="display:block;width:100%;box-sizing:border-box;padding:10px 13px;border-radius:8px;border:1.5px solid rgba(100,140,255,0.35);background:#0f1628;color:#e8eeff;font-size:13px;outline:none;margin-bottom:6px;font-family:inherit;transition:border-color 0.2s;"
                              onfocus="this.style.borderColor='rgba(100,140,255,0.8)'" onblur="this.style.borderColor='rgba(100,140,255,0.35)'">
                            <div id="_lockPwError" style="color:#f87171;font-size:11px;min-height:18px;margin-bottom:16px;display:none;"></div>
                            <div style="display:flex;gap:10px;justify-content:flex-end;">
                              <button id="_lockPwCancel" style="padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.07);color:#c8d7ff;cursor:pointer;font-size:12px;font-family:inherit;transition:background 0.15s;"
                                onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">Cancelar</button>
                              <button id="_lockPwOk" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent,#185abd);color:white;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:background 0.15s;filter:brightness(1);"
                                onmouseover="this.style.filter='brightness(0.85)'" onmouseout="this.style.filter='brightness(1)'">Aplicar bloqueo</button>
                            </div>
                          </div>
                          </form>`;
                        document.body.appendChild(overlay);
                        const inp = overlay.querySelector('#_lockPwInput');
                        const conf = overlay.querySelector('#_lockPwConfirm');
                        const err = overlay.querySelector('#_lockPwError');
                        inp.focus();
                        overlay.querySelector('#_lockPwCancel').onclick = () => { document.body.removeChild(overlay); resolve(null); };
                        overlay.querySelector('#_lockPwOk').onclick = () => {
                            if (inp.value.length === 0) { err.textContent = 'Ingresa una contraseña.'; err.style.display = 'block'; return; }
                            if (inp.value !== conf.value) { err.textContent = 'Las contraseñas no coinciden.'; err.style.display = 'block'; return; }
                            document.body.removeChild(overlay); resolve(inp.value);
                        };
                        overlay.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('#_lockPwOk').click(); if (e.key === 'Escape') { document.body.removeChild(overlay); resolve(null); } });
                    });
                    if (pw === null) return; // Cancelado
                    userPassword = pw;
                }

                // Alternar estado
                this._pdfLocks[type] = willLock;
                const locks = this._pdfLocks;

                // Actualizar apariencia del botón
                const btn   = document.getElementById(`btn-lock-${type}`);
                const slash = document.getElementById(`lock-${type}-slash`);
                const label = document.getElementById(`btn-lock-${type}-label`);
                const names = { edit: 'Edición', print: 'Impresión', copy: 'Copia' };
                if (locks[type]) {
                    btn.style.color    = 'var(--danger, #ef4444)';
                    btn.style.outline  = '2px solid var(--danger, #ef4444)';
                    if (slash) slash.style.display = 'none';
                    label.innerHTML = `<b>${names[type]}</b><br>Bloqueada`;
                } else {
                    btn.style.color    = '';
                    btn.style.outline  = '';
                    if (slash) slash.style.display = 'inline';
                    label.innerHTML = `Bloquear<br>${names[type]}`;
                }

                // Construir lista de permisos PERMITIDOS (todo menos lo bloqueado)
                const perms = [];
                if (!locks.print)  perms.push('print');
                if (!locks.edit)   perms.push('modify', 'annotate');
                if (!locks.copy)   perms.push('copy');

                // Aplicar cifrado con PyMuPDF
                this.toggleLoader(true, 'Aplicando restricciones de seguridad...');
                try {
                    const secured = await PythonManager.encryptPDF(src.buffer, userPassword, 'alioth-owner-' + Date.now(), perms);
                    src.buffer = secured;
                    const actionNames = { edit: locks.edit   ? '🔒 Edición bloqueada'     : '🔓 Edición desbloqueada',
                                          print: locks.print ? '🔒 Impresión bloqueada'   : '🔓 Impresión desbloqueada',
                                          copy:  locks.copy  ? '🔒 Copia bloqueada'        : '🔓 Copia desbloqueada' };
                    this.showToast(actionNames[type] + ' — guarda el PDF para que tenga efecto');
                } catch (e) {
                    this._pdfLocks[type] = !this._pdfLocks[type];
                    this.showToast('❌ Error al aplicar seguridad: ' + e.message);
                }
                this.toggleLoader(false);
            },

            flattenFormPDF: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                this.toggleLoader(true, 'Python: Aplanando formularios y anotaciones...');
                try {
                    const flattenedBuffer = await PythonManager.flattenPDF(src.buffer);
                    const blob = new Blob([flattenedBuffer], { type: 'application/pdf' });
                    const file = new File([blob], "aplanado_" + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    await this.openFile(file);
                    this.showToast('✅ Formularios aplanados permanentemente');
                } catch (e) {
                    this.showToast('❌ Error al aplanar: ' + e.message);
                }
                this.toggleLoader(false);
            },

            convertToGrayscalePDF: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (doc._originalColorBuffer) { this.showToast('⚠️ El documento ya está en escala de grises'); return; }

                this.toggleLoader(true, 'Python: Convirtiendo a escala de grises...');
                try {
                    const originalBuffer = src.buffer.slice(0);
                    const originalName = doc.name;

                    const grayBuffer = await PythonManager.convertToGrayscale(src.buffer);
                    if (!grayBuffer || grayBuffer.byteLength < 100) {
                        throw new Error('Buffer resultante inválido: ' + grayBuffer?.byteLength);
                    }
                    const blob = new Blob([grayBuffer], { type: 'application/pdf' });
                    const file = new File([blob], "grises_" + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    await this.openFile(file);

                    // Guardar original en el nuevo doc activo para poder revertir
                    const newDoc = this.getDoc();
                    if (newDoc) {
                        newDoc._originalColorBuffer = originalBuffer;
                        newDoc._originalColorName = originalName;
                    }
                    // Aplicar filtro CSS al contenedor
                    ['canvas-container', 'canvas-container-secondary'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.filter = 'grayscale(100%)';
                    });
                    // Mostrar botón de restaurar
                    const btnRestore = document.getElementById('btn-restore-color');
                    if (btnRestore) btnRestore.style.display = '';
                    this.showToast('✅ Documento convertido a escala de grises');
                } catch (e) {
                    this.showToast('❌ Error en conversión: ' + e.message);
                }
                this.toggleLoader(false);
            },

            restoreColorPDF: async function () {
                const doc = this.getDoc();
                if (!doc || !doc._originalColorBuffer) {
                    this.showToast('⚠️ No hay versión en color para restaurar');
                    return;
                }
                this.toggleLoader(true, 'Restaurando documento en color...');
                try {
                    const colorBuffer = doc._originalColorBuffer;
                    const colorName = doc._originalColorName || doc.name;

                    // Limpiar flags y filtro CSS ANTES de renderizar el nuevo doc
                    delete doc._originalColorBuffer;
                    delete doc._originalColorName;
                    ['canvas-container', 'canvas-container-secondary'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.filter = '';
                    });

                    const colorBlob = new Blob([colorBuffer], { type: 'application/pdf' });
                    const colorFile = new File([colorBlob], colorName, { type: 'application/pdf' });
                    await this.openFile(colorFile);
                    // Ocultar botón de restaurar
                    const btnRestore = document.getElementById('btn-restore-color');
                    if (btnRestore) btnRestore.style.display = 'none';
                    this.showToast('✅ Documento restaurado a color');
                } catch (e) {
                    this.showToast('❌ Error al restaurar: ' + e.message);
                }
                this.toggleLoader(false);
            },

            invertColorsPDF: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (doc._originalBeforeInvertBuffer) { this.showToast('⚠️ El documento ya tiene colores invertidos'); return; }

                this.toggleLoader(true, 'Python: Invirtiendo colores...');
                try {
                    const originalBuffer = src.buffer.slice(0);
                    const originalName = doc.name;

                    const uint8 = new Uint8Array(src.buffer);
                    const result = await PythonManager.run(`
import fitz, io
def invert_colors(data):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    src = fitz.open(stream=data, filetype="pdf")
    out_doc = fitz.open()
    for i in range(len(src)):
        page = src[i]
        pix = page.get_pixmap(alpha=False)
        pix.invert_irect(pix.irect)
        img_bytes = pix.tobytes("png")
        new_page = out_doc.new_page(width=pix.width, height=pix.height)
        new_page.insert_image(fitz.Rect(0, 0, pix.width, pix.height), stream=img_bytes)
    buf = io.BytesIO()
    out_doc.save(buf, garbage=4, deflate=True)
    src.close()
    out_doc.close()
    return bytes(buf.getvalue())
invert_colors(js_data)
                    `, { js_data: uint8 });

                    let invertBuffer;
                    if (result && result.toJs) {
                        const u8 = result.toJs();
                        invertBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                    } else if (result instanceof Uint8Array) {
                        invertBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    } else {
                        throw new Error('Resultado inesperado de Python');
                    }

                    const blob = new Blob([invertBuffer], { type: 'application/pdf' });
                    const file = new File([blob], "invertido_" + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    await this.openFile(file);

                    // Guardar original para revertir
                    const newDoc = this.getDoc();
                    if (newDoc) {
                        newDoc._originalBeforeInvertBuffer = originalBuffer;
                        newDoc._originalBeforeInvertName = originalName;
                        newDoc._isInverted = true;
                    }
                    // Aplicar filtro CSS — contenedor + canvas directamente
                    const _applyInvertFilter = () => {
                        ['canvas-container', 'canvas-container-secondary'].forEach(id => {
                            const el = document.getElementById(id);
                            if (el) {
                                el.style.filter = 'invert(100%)';
                                const cvs = el.querySelector('canvas');
                                if (cvs) cvs.style.filter = 'invert(100%)';
                            }
                        });
                    };
                    _applyInvertFilter();
                    setTimeout(_applyInvertFilter, 300);
                    // Mostrar botón de restaurar
                    const btnRestore = document.getElementById('btn-restore-invert');
                    if (btnRestore) btnRestore.style.display = '';
                    this.showToast('✅ Colores invertidos');
                } catch (e) {
                    this.showToast('❌ Error al invertir: ' + e.message);
                }
                this.toggleLoader(false);
            },

            restoreInvertPDF: async function () {
                const doc = this.getDoc();
                if (!doc || !doc._originalBeforeInvertBuffer) {
                    this.showToast('⚠️ No hay versión original para restaurar');
                    return;
                }
                this.toggleLoader(true, 'Restaurando documento original...');
                try {
                    // Guardar valores ANTES de limpiar
                    const origBuffer = doc._originalBeforeInvertBuffer;
                    const origName = doc._originalBeforeInvertName || doc.name;

                    // Limpiar flag ANTES de openFile para que el hook de loadPage no re-aplique el filtro
                    delete doc._isInverted;
                    delete doc._originalBeforeInvertBuffer;
                    delete doc._originalBeforeInvertName;

                    // Limpiar filtro CSS ANTES de renderizar el nuevo doc — contenedor y canvas hijo
                    ['canvas-container', 'canvas-container-secondary'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.style.filter = '';
                            el.querySelectorAll('canvas').forEach(cvs => cvs.style.filter = '');
                        }
                    });

                    const origBlob = new Blob([origBuffer], { type: 'application/pdf' });
                    const origFile = new File([origBlob], origName, { type: 'application/pdf' });
                    await this.openFile(origFile);
                    // Ocultar botón
                    const btnRestore = document.getElementById('btn-restore-invert');
                    if (btnRestore) btnRestore.style.display = 'none';
                    this.showToast('✅ Documento restaurado');
                } catch (e) {
                    this.showToast('❌ Error al restaurar: ' + e.message);
                }
                this.toggleLoader(false);
            },



            export300DPI: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                this.toggleLoader(true, 'Python: Renderizando imagen de alta resolución (300 DPI)...');
                try {
                    const dataUrl = await PythonManager.exportHighResImage(src.buffer, page.pageIndex);
                    if (dataUrl) {
                        const a = document.createElement('a');
                        a.href = dataUrl;
                        a.download = `${doc.name ? doc.name.replace('.pdf', '') : 'doc'}_p${page.pageIndex + 1}_300dpi.png`;
                        a.click();
                        this.showToast('✅ Imagen 300 DPI exportada');
                    }
                } catch (e) {
                    this.showToast('❌ Error en exportación: ' + e.message);
                }
                this.toggleLoader(false);
            },

            renderPageToCanvas: async function (pageObj, scale = 2.0) {
                const doc = this.getDoc();
                if (!doc || !pageObj) throw new Error("No hay página activa");
                const src = doc.sources[pageObj.sourceId];
                if (!src || !src.buffer) throw new Error("Fuente de PDF no disponible");
                if (!src.doc) {
                    src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                }
                const pdfPage = await src.doc.getPage(pageObj.pageIndex + 1);
                const viewport = pdfPage.getViewport({ scale: scale });
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = Math.round(viewport.width);
                tempCanvas.height = Math.round(viewport.height);
                const tempCtx = tempCanvas.getContext('2d');
                await pdfPage.render({ canvasContext: tempCtx, viewport: viewport }).promise;
                return tempCanvas;
            },

            makeSearchablePDF: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                this.toggleLoader(true, 'Iniciando OCR multicapa...');
                try {
                    const cvs = await this.renderPageToCanvas(page, 2.0);
                    const imageData = cvs.toDataURL('image/png');

                    document.getElementById('loader-msg').innerText = "OCR: Analizando texto de la imagen...";
                    const worker = await this._getOCRWorker(Tesseract.PSM.AUTO);
                    const ret = await worker.recognize(imageData);

                    const ocrResults = (ret.data.words || []).map(w => ({
                        text: w.text,
                        bbox: [w.bbox.x0 / 2.0, w.bbox.y0 / 2.0, w.bbox.x1 / 2.0, w.bbox.y1 / 2.0],
                        page: page.pageIndex,
                        fontsize: ((w.bbox.y1 - w.bbox.y0) / 2.0) * 0.75
                    }));

                    if (ocrResults.length === 0) {
                        this.showToast('⚠️ No se detectó texto para insertar');
                    } else {
                        document.getElementById('loader-msg').innerText = "Python: Insertando capa de texto invisible...";
                        const searchableBuffer = await PythonManager.createSearchablePDF(src.buffer, ocrResults);
                        const blob = new Blob([searchableBuffer], { type: 'application/pdf' });
                        const file = new File([blob], "detectable_" + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                        await this.openFile(file);
                        this.showToast('✅ PDF ahora tiene texto seleccionable (Searchable)');
                    }
                } catch (e) {
                    console.error(e);
                    this.showToast('❌ Error en proceso Searchable: ' + e.message);
                }
                this.toggleLoader(false);
            },

            activateRealTextEditor: function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) { this.showToast("⚠️ Abre un documento primero"); return; }

                this._exitContinuousIfNeeded();
                if (this.isTextSelectMode) this.toggleTextSelectMode();
                if (this.isHandMode) this.toggleHandMode();
                if (this.isDrawingMode) this.setDrawTool('none');

                this.smartPatchMode = true;
                this.smartPatchData = null;
                this._realEditMode = true;

                if (window.PythonManager && !window.PythonManager.isLoaded) {
                    window.PythonManager.init().catch(() => {});
                }

                document.body.classList.add('text-select-mode');
                // Restaurar text layers que pudieron quedar hidden por text-select/hand mode
                document.querySelectorAll('.text-layer').forEach(layer => {
                    layer.style.display = '';
                    layer.style.pointerEvents = 'none'; // hover visible pero sin interferir con clicks
                    layer.style.zIndex = '';
                });
                const canvas = document.getElementById('the-canvas');
                const overlayLayer = document.getElementById('overlay-layer');
                const annotationLayer = document.getElementById('annotation-layer');
                if (canvas) canvas.style.cursor = 'text';
                if (overlayLayer) overlayLayer.style.cursor = 'text';
                if (annotationLayer) annotationLayer.style.cursor = 'text';

                const btn = document.getElementById('btn-smart-patch');
                if (btn) btn.classList.add('active');

                this.showToast("✏️ Selecciona el texto que deseas editar", 5000);

                // Registrar mousedown para calcular el area de arrastre real
                this._realEditMouseDownPt = null;
                if (this._realEditMouseDownHandler) {
                    window.removeEventListener('mousedown', this._realEditMouseDownHandler);
                }
                if (this.smartPatchMouseUp) {
                    window.removeEventListener('mouseup', this.smartPatchMouseUp);
                }
                this._realEditSelectionPending = false;
                this._realEditMouseDownHandler = (ev) => {
                    const cvs = document.getElementById('the-canvas');
                    if (!cvs) return;
                    const r = cvs.getBoundingClientRect();
                    this._realEditMouseDownPt = { x: ev.clientX - r.left, y: ev.clientY - r.top };
                };
                window.addEventListener('mousedown', this._realEditMouseDownHandler);

                this.smartPatchMouseUp = (e) => {
                    if (!this.smartPatchMode) return;
                    if (e.target.closest('.modal') || e.target.closest('.toast')) return;

                    const cvs = document.getElementById('the-canvas');
                    const cvsRect = cvs ? cvs.getBoundingClientRect() : { left: 0, top: 0 };
                    const upX = e.clientX - cvsRect.left;
                    const upY = e.clientY - cvsRect.top;
                    const downPt = this._realEditMouseDownPt;

                    // Capturar texto seleccionado ANTES de limpiar la selección del browser
                    const selection = window.getSelection();
                    const browserSelectedText = selection ? selection.toString().trim() : '';
                    // Capturar domRect del range antes de limpiar la selección
                    let _selDomRect = null;
                    let _selLineCount = browserSelectedText ? 1 : 0;
                    if (selection && selection.rangeCount > 0 && browserSelectedText) {
                        try {
                            const _range = selection.getRangeAt(0);
                            // getBoundingClientRect() falla en spans con scaleX transform (PDF.js)
                            // usar getClientRects() y unir manualmente
                            const _rects = Array.from(_range.getClientRects()).filter(r => r.width > 0);
                            if (_rects.length > 0) {
                                const _lineTops = [];
                                _rects.slice().sort((a, b) => a.top - b.top).forEach(r => {
                                    const _sameLine = _lineTops.some(top => Math.abs(top - r.top) <= Math.max(2, r.height * 0.3));
                                    if (!_sameLine) _lineTops.push(r.top);
                                });
                                _selLineCount = Math.max(1, _lineTops.length);
                                const _l = Math.min(..._rects.map(r => r.left));
                                const _r = Math.max(..._rects.map(r => r.right));
                                const _t = Math.min(..._rects.map(r => r.top));
                                const _b = Math.max(..._rects.map(r => r.bottom));
                                _selDomRect = { left: _l, right: _r, top: _t, bottom: _b, width: _r - _l, height: _b - _t };
                            } else {
                                _selDomRect = _range.getBoundingClientRect();
                            }
                        } catch(e) {}
                    }
                    if (selection) selection.removeAllRanges();

                    let coords = null;
                    const isDrag = downPt && (Math.abs(upX - downPt.x) > 6 || Math.abs(upY - downPt.y) > 6);

                    if (!isDrag) {
                        // ── CLICK SIMPLE ──
                        // Si el browser seleccionó texto (doble-click en palabra), pasarlo con la posición
                        // del click para discriminar duplicados (mismo texto en distintas líneas).
                        if (browserSelectedText) {
                            coords = { x: upX, y: upY, w: 0, h: 0, text: browserSelectedText, domRect: _selDomRect, lineCount: _selLineCount };
                        } else {
                            coords = null;
                        }
                    } else {
                        // ── DRAG REAL ──
                        coords = {
                            x: Math.min(downPt.x, upX),
                            y: Math.min(downPt.y, upY),
                            w: Math.abs(upX - downPt.x),
                            h: Math.abs(upY - downPt.y),
                            text: browserSelectedText || undefined,
                            domRect: _selDomRect,
                            lineCount: _selLineCount
                        };
                    }

                    // Ajustar scroll para que el texto clickeado quede visible en el viewport
                    const _mv = this.getPanelElements(this.splitView.activePanel || 'primary')?.mainView;
                    if (_mv && downPt) {
                        const _cvsRect = document.getElementById('the-canvas')?.getBoundingClientRect();
                        if (_cvsRect) {
                            const _clickAbsY = downPt.y + _cvsRect.top;
                            const _mvRect = _mv.getBoundingClientRect();
                            const _relY = _clickAbsY - _mvRect.top;
                            const _margin = 80;
                            if (_relY < _margin) {
                                _mv.scrollTop = Math.max(0, _mv.scrollTop - (_margin - _relY));
                            } else if (_relY > _mvRect.height - _margin) {
                                _mv.scrollTop += (_relY - (_mvRect.height - _margin));
                            }
                        }
                    }

                    if (this._realEditSelectionPending) return;
                    this._realEditSelectionPending = true;
                    setTimeout(async () => {
                        try {
                            await this.captureTextAreaForPatch(e, coords);
                        } finally {
                            this._realEditSelectionPending = false;
                        }
                    }, 20);
                };

                window.addEventListener('mouseup', this.smartPatchMouseUp);
            },

            /**
             * Muestra un textarea flotante inline posicionado sobre el texto detectado.
             * Sin modal. Edición en tiempo real con reflow al confirmar.
             * @param {object} textObj - El objeto de texto ya creado en page.objects
             * @param {object} data    - smartPatchData original (coordenadas PDF, fuente, etc.)
             */
            showRealTextInlineEditor: function (textObj, data) {
                // Eliminar editor previo si existe
                const prev = document.getElementById('real-text-inline-editor');
                if (prev) prev.remove();

                const overlayLayer = document.getElementById('overlay-layer');
                if (!overlayLayer) return;
                const scale = this.currentScale || 1;

                // Coordenadas en pantalla sobre el texto detectado
                const elX = (data.x * scale);
                const elY = (data.y * scale);
                const elW = Math.max(180, data.width * scale);

                // Texto inicial: el detectado
                const initialText = data.text || '';
                const wordCount = initialText.trim().split(/\s+/).filter(Boolean).length;
                const lineCount = initialText.split('\n').length;
                const selSummary = lineCount > 1
                    ? `${lineCount} líneas · ${wordCount} palabras`
                    : `${wordCount} palabra${wordCount !== 1 ? 's' : ''}`;

                const editor = document.createElement('div');
                editor.id = 'real-text-inline-editor';
                editor.style.left = elX + 'px';
                editor.style.top = (elY - 54) + 'px'; // Aparece encima del texto
                editor.style.width = elW + 'px';

                editor.innerHTML = `
                    <div class="rtie-header">
                        <span>✏️ Reemplazar: ${selSummary}</span>
                        <select id="rtie-font-select" class="rtie-font-select" title="Fuente para el texto seleccionado en el textarea"></select>
                        <button class="rtie-confirm" id="rtie-btn-ok" title="Confirmar (Ctrl+Enter)">✓ OK</button>
                        <button id="rtie-btn-cancel" title="Cancelar (Esc)">✕</button>
                    </div>
                    <textarea id="rtie-textarea" rows="${Math.max(2, lineCount + 1)}" placeholder="Escribe el nuevo texto…" spellcheck="false">${initialText}</textarea>
                    <div class="rtie-hint">Click fuera o Ctrl+Enter confirma · Esc cancela <span id="rtie-runs-badge"></span></div>
                `;

                overlayLayer.appendChild(editor);

                const textarea = editor.querySelector('#rtie-textarea');
                textarea.style.width = '100%';

                // ── Bug1/OpciónB: fuente por palabra vía tabla de runs {start,end,font} ──
                let rtieRuns = [];
                const runsBadge = editor.querySelector('#rtie-runs-badge');
                const _updateRtieBadge = () => {
                    if (!runsBadge) return;
                    runsBadge.textContent = rtieRuns.length > 0 ? `🔤×${rtieRuns.length}` : '';
                    runsBadge.title = rtieRuns.length > 0 ? 'Partes del texto con fuente distinta a la principal' : '';
                };

                const fontSelect = editor.querySelector('#rtie-font-select');
                const _mainFontSelect = document.getElementById('fontFamily');
                const _baseRtieFont = textObj.font || data.fontName;
                if (fontSelect && _mainFontSelect) {
                    Array.from(_mainFontSelect.options).forEach(opt => {
                        fontSelect.appendChild(new Option(opt.textContent, opt.value));
                    });
                    fontSelect.value = _baseRtieFont || '';
                    if (fontSelect.value !== _baseRtieFont && _baseRtieFont) {
                        fontSelect.insertBefore(new Option('🔤 ' + _baseRtieFont, _baseRtieFont, true, true), fontSelect.firstChild);
                        fontSelect.value = _baseRtieFont;
                    }
                    fontSelect.addEventListener('mousedown', (e) => e.stopPropagation());
                    fontSelect.addEventListener('change', () => {
                        const _rs = textarea.selectionStart, _re = textarea.selectionEnd;
                        if (_rs === _re) return; // Sin selección: no se aplica fuente por rango
                        const _chosenFont = fontSelect.value;
                        const _next = [];
                        for (const r of rtieRuns) {
                            if (r.end <= _rs || r.start >= _re) { _next.push(r); continue; }
                            if (r.start < _rs) _next.push({ start: r.start, end: _rs, font: r.font });
                            if (r.end > _re) _next.push({ start: _re, end: r.end, font: r.font });
                        }
                        _next.push({ start: _rs, end: _re, font: _chosenFont });
                        rtieRuns = _next.filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
                        _updateRtieBadge();
                        textarea.focus({ preventScroll: true });
                        textarea.setSelectionRange(_rs, _re);
                    });
                }

                // Reflow visual en tiempo real: actualizar el objeto texto overlay
                const applyLiveReflow = () => {
                    const newText = textarea.value;
                    textObj.text = newText;
                    // Ajustar altura del overlay según contenido
                    const lineH = (data.fontSize || 12) * scale * 1.3;
                    const linesCount = newText.split('\n').length;
                    textObj.height = Math.max(data.height, linesCount * (data.fontSize || 12) * 1.3);
                    this.renderOverlays();
                };

                // Reajusta offsets de una lista de runs {start,end,...attrs} cuando el
                // texto cambia (typing/paste/delete). Genérico: sirve tanto para rtieRuns
                // (fuente) como para textObj._styleRuns (color/bold/italic/underline).
                const _reindexRunsForEdit = (runs, start, oldEnd, delta) => {
                    const newEnd = oldEnd + delta;
                    const _next = [];
                    for (const r of runs) {
                        const { start: rStart, end: rEnd, ...attrs } = r;
                        if (rEnd <= start) { _next.push(r); continue; }
                        if (rStart >= oldEnd) { _next.push({ start: rStart + delta, end: rEnd + delta, ...attrs }); continue; }
                        // El run se solapa con la región editada: conservar solo los tramos sobrevivientes
                        if (rStart < start) _next.push({ start: rStart, end: start, ...attrs });
                        if (rEnd > oldEnd) _next.push({ start: newEnd, end: newEnd + (rEnd - oldEnd), ...attrs });
                    }
                    return _next.filter(r => r.end > r.start);
                };

                // Reajustar offsets de rtieRuns cuando el texto cambia (typing/paste/delete)
                let _rtiePendingEdit = null;
                textarea.addEventListener('beforeinput', () => {
                    _rtiePendingEdit = {
                        start: textarea.selectionStart,
                        oldEnd: textarea.selectionEnd,
                        oldLen: textarea.value.length
                    };
                });
                textarea.addEventListener('input', () => {
                    if (_rtiePendingEdit && (rtieRuns.length > 0 || (textObj._styleRuns || []).length > 0)) {
                        const { start, oldEnd, oldLen } = _rtiePendingEdit;
                        const delta = textarea.value.length - oldLen;
                        if (rtieRuns.length > 0) {
                            rtieRuns = _reindexRunsForEdit(rtieRuns, start, oldEnd, delta);
                            _updateRtieBadge();
                        }
                        if ((textObj._styleRuns || []).length > 0) {
                            textObj._styleRuns = _reindexRunsForEdit(textObj._styleRuns, start, oldEnd, delta);
                        }
                    }
                    _rtiePendingEdit = null;
                    applyLiveReflow();
                });

                // Confirmar
                const confirm = async () => {
                    const newText = textarea.value;
                    editor.remove();
                    // Solo cancelar si el usuario no modificó el texto original en absoluto
                    if (newText === null || newText === undefined) {
                        this._cancelRealTextInlineEdit(textObj);
                        return;
                    }
                    // Conservar espacios iniciales y finales; solo una cadena realmente vacía borra.
                    const _commitText = newText.length > 0 ? newText : ' ';
                    if (newText.length === 0) {
                        rtieRuns = [];
                        textObj._styleRuns = [];
                    }
                    // Aplicar reflow permanente via Python
                    await this._applyRealTextInlineCommit(textObj, data, _commitText, rtieRuns);
                };

                // Cancelar
                const cancel = () => {
                    editor.remove();
                    this._cancelRealTextInlineEdit(textObj);
                };

                editor.querySelector('#rtie-btn-ok').addEventListener('click', confirm);
                editor.querySelector('#rtie-btn-cancel').addEventListener('click', cancel);

                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
                    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); confirm(); }
                });

                // Foco y seleccionar todo (preservar scroll)
                setTimeout(() => {
                    const _panelEls2 = this.getPanelElements(this.splitView.activePanel);
                    const _mv2 = _panelEls2 && _panelEls2.mainView;
                    const _st2 = _mv2 ? _mv2.scrollTop : 0;
                    const _sl2 = _mv2 ? _mv2.scrollLeft : 0;
                    textarea.focus({ preventScroll: true });
                    textarea.select();
                    if (_mv2) { _mv2.scrollTop = _st2; _mv2.scrollLeft = _sl2; }
                }, 60);

                // Drag del editor por el header
                const header = editor.querySelector('.rtie-header');
                header.style.cursor = 'move';
                header.addEventListener('mousedown', (e) => {
                    if (e.target.tagName === 'BUTTON') return;
                    e.preventDefault();
                    const startX = e.clientX - editor.offsetLeft;
                    const startY = e.clientY - editor.offsetTop;
                    const onMove = (ev) => {
                        editor.style.left = (ev.clientX - startX) + 'px';
                        editor.style.top  = (ev.clientY - startY) + 'px';
                    };
                    const onUp = () => {
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                });
            },

            _cancelRealTextInlineEdit: function (textObj) {
                const doc = this.getDoc();
                if (!doc) return;
                // ── FASE A: Limpiar coverDiv ──
                if (textObj && textObj._coverDivId) {
                    const _cover = document.getElementById(textObj._coverDivId);
                    if (_cover) _cover.remove();
                    textObj._coverDivId = null;
                }
                // Capturar flag ANTES de que el handler de click-fuera lo consuma
                const _wasContAtEntry = this._wasInContinuous;
                const page = doc.pages[doc.currentIndex];
                if (page) {
                    const idx = page.objects.indexOf(textObj);
                    if (idx !== -1) page.objects.splice(idx, 1);
                }
                // Restaurar buffer pre-erase si existe
                if (this._preEraseBuffer) {
                    const src = doc.sources[this._preEraseBuffer.sourceId];
                    if (src) {
                        src.buffer = this._preEraseBuffer.buffer;
                        src.doc = null;
                    }
                    this._preEraseBuffer = null;
                    this._pendingEraseRect = null;
                    this._realEditMode = false;
                    // Preservar scroll antes de recargar la página
                    const elements = this.getPanelElements(this.splitView.activePanel);
                    const mainView = elements && elements.mainView;
                    const savedScrollTop  = mainView ? mainView.scrollTop  : 0;
                    const savedScrollLeft = mainView ? mainView.scrollLeft : 0;
                    console.log(`🟠 [CANCEL-DEBUG] doc.currentIndex=${doc.currentIndex} savedScrollTop=${savedScrollTop} _wasInContinuous=${this._wasInContinuous} _wasContAtEntry=${_wasContAtEntry}`);
                    this._suppressScrollIntoView = true;
                    this.loadPage(doc.currentIndex).then(() => {
                        // Usar _wasContAtEntry (capturado al inicio) — inmune al handler de deselección
                        if (!_wasContAtEntry && mainView) {
                            console.log(`🟠 [CANCEL-DEBUG] restaurando scroll a ${savedScrollTop} (no continuo)`);
                            mainView.scrollTop  = savedScrollTop;
                            mainView.scrollLeft = savedScrollLeft;
                        } else {
                            console.log(`🟠 [CANCEL-DEBUG] era continuo — renderContinuousContent maneja scroll`);
                        }
                        this.showToast('❌ Edición cancelada');
                        console.log(`🟠 [CANCEL-DEBUG] viewMode=${this.viewMode} _wasInContinuous=${this._wasInContinuous}`);
                        // Solo restaurar si el handler de deselección no lo hizo ya
                        if (_wasContAtEntry && this.viewMode !== 'continuous') {
                            this._restoreContinuousIfNeeded();
                        }
                        console.log(`🟠 [CANCEL-DEBUG] FINAL scrollTop=${mainView?.scrollTop}`);
                    });
                    return;
                }
                this._realEditMode = false;
                this.renderOverlays();
                this.renderSidebar();
                this.showToast('❌ Edición cancelada');
                this._restoreContinuousIfNeeded();
            },

            // 🚀 Myers' diff / LCS para mapear rangos de estilo al editar texto (estilo PdfCraft edit_script)
            _diffStyleRuns: function (oldText, newText, oldRuns) {
                if (!oldRuns || oldRuns.length === 0) return [];
                if (!oldText || oldText === newText) return oldRuns.slice();
                try {
                    const n = oldText.length;
                    const m = newText.length;
                    if (n === 0 || m === 0) return [];
                    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
                    for (let i = 0; i < n; i++) {
                        for (let j = 0; j < m; j++) {
                            if (oldText[i] === newText[j]) {
                                dp[i + 1][j + 1] = dp[i][j] + 1;
                            } else {
                                dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                            }
                        }
                    }
                    const oldToNew = new Map();
                    let i = n, j = m;
                    while (i > 0 && j > 0) {
                        if (oldText[i - 1] === newText[j - 1]) {
                            oldToNew.set(i - 1, j - 1);
                            i--; j--;
                        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                            i--;
                        } else {
                            j--;
                        }
                    }
                    const newRuns = [];
                    for (const run of oldRuns) {
                        let newStart = null;
                        let newEnd = null;
                        for (let k = run.start; k < run.end; k++) {
                            if (oldToNew.has(k)) {
                                const mapped = oldToNew.get(k);
                                if (newStart === null || mapped < newStart) newStart = mapped;
                                if (newEnd === null || mapped + 1 > newEnd) newEnd = mapped + 1;
                            }
                        }
                        if (newStart !== null && newEnd !== null && newStart < newEnd) {
                            newRuns.push({ ...run, start: newStart, end: newEnd });
                        }
                    }
                    return newRuns;
                } catch (e) {
                    console.warn("⚠️ _diffStyleRuns error:", e);
                    return oldRuns;
                }
            },

            _applyRealTextInlineCommit: function (...args) {
                const docId = this.activeDocId;
                const task = this._applyRealTextInlineCommitNow(...args);
                return this.trackDocumentEdit ? this.trackDocumentEdit(docId, task) : task;
            },

            _applyRealTextInlineCommitNow: async function (textObj, data, newText, rtieRuns) {
                rtieRuns = rtieRuns || [];
                const _diagTxnId = textObj._diagTxnId || `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                textObj._diagTxnId = _diagTxnId;
                window.__aliothDiag?.trace('TEXT-TXN', 'commit-enter', {
                    transactionId: _diagTxnId,
                    objectId: textObj.id,
                    objectCommit: !!textObj._commitInProgress,
                    globalCommit: !!this._realTextCommitInProgress,
                    text: newText,
                    font: textObj.font,
                    bold: textObj.bold,
                    size: textObj.size,
                    alignment: textObj.alignment,
                    stack: new Error().stack?.split('\n').slice(1, 6),
                    view: window.__aliothDiag?.view(this.splitView?.activePanel)
                });
                const doc = this.getDoc();
                const pageNum = doc.currentIndex;
                const page = doc.pages[pageNum];
                const src = doc.sources[page.sourceId];
                if (!src || !src.buffer) {
                    this.showToast('⚠️ Sin buffer PDF');
                    this._realEditMode = false;
                    return;
                }
                if (textObj._commitInProgress) {
                    window.__aliothDiag?.trace('TEXT-TXN', 'commit-duplicate-blocked', {
                        transactionId: _diagTxnId,
                        objectId: textObj.id
                    });
                    return;
                }
                textObj._commitInProgress = true;
                this._realTextCommitInProgress = true;
                window.__aliothDiag?.trace('TEXT-TXN', 'commit-locked', {
                    transactionId: _diagTxnId,
                    objectId: textObj.id,
                    view: window.__aliothDiag?.view(this.splitView?.activePanel)
                });

                // La edición real modifica los bytes del PDF, por lo que su historial
                // debe conservar ambos extremos de la transacción. En modo quirúrgico
                // `_preEraseBuffer` es el único original limpio previo al borrado.
                const _transactionBeforeBuffer = (
                    this._preEraseBuffer &&
                    this._preEraseBuffer.sourceId === page.sourceId &&
                    this._preEraseBuffer.buffer
                ) ? this._preEraseBuffer.buffer.slice(0) : src.buffer.slice(0);
                let _transactionCommitted = false;

                // Mantener la máscara hasta que el canvas ya contenga el PDF actualizado.
                // Si se retira antes, el overlay editado queda momentáneamente sobre el texto original.
                const _coverDivId = textObj._coverDivId || null;
                const _removeCover = () => {
                    const _coverBefore = _coverDivId ? document.getElementById(_coverDivId) : null;
                    window.__aliothDiag?.trace('TEXT-TXN', 'cover-remove', {
                        transactionId: _diagTxnId,
                        coverId: _coverDivId,
                        existed: !!_coverBefore,
                        view: window.__aliothDiag?.view(this.splitView?.activePanel)
                    });
                    if (_coverDivId) {
                        const _cover = document.getElementById(_coverDivId);
                        if (_cover) _cover.remove();
                    }
                    textObj._coverDivId = null;
                };

                // Remover overlay visual antes de aplicar permanentemente
                const idx = page.objects.indexOf(textObj);
                if (idx !== -1) page.objects.splice(idx, 1);

                this.toggleLoader(true, 'Python: Aplicando reflow...');
                try {
                    // ── FASE A: Borrado previo garantizado (Splicing quirúrgico con fallback de borrado) ──
                    const _isSurgical = !!(textObj.isRealEdit && textObj.bgAlpha === 0);
                    const _useSplice = (window.ALIOTH_TEXT_ENGINE !== 'legacy');
                    let _didSplice = false;

                    // 1. Intentar splice a nivel de /Contents si _useSplice está activo y hay spans objetivo
                    if (_isSurgical && _useSplice && this._preEraseBuffer && this._preEraseBuffer.sourceId === page.sourceId) {
                        const _spansToSplice = data.targetSpans || (data.targetSpan ? [data.targetSpan] : null);
                        if (_spansToSplice && _spansToSplice.length > 0) {
                            try {
                                window.__aliothDiag?.trace('TEXT-TXN', 'splice-attempt-start', {
                                    transactionId: _diagTxnId,
                                    spansCount: _spansToSplice.length
                                });
                                const _splicedBuf = await PythonManager.removeTextSpans(
                                    this._preEraseBuffer.buffer,
                                    page.pageIndex,
                                    _spansToSplice
                                );
                                if (_splicedBuf && (_splicedBuf.byteLength || _splicedBuf.length)) {
                                    src.buffer = _splicedBuf;
                                    src.doc = null;
                                    _didSplice = true;
                                    this._pendingEraseRect = null;
                                    window.__aliothDiag?.trace('TEXT-TXN', 'splice-attempt-success', {
                                        transactionId: _diagTxnId,
                                        outputBytes: _splicedBuf.byteLength || _splicedBuf.length || null
                                    });
                                    console.log("🚀 [COMMIT] text_splice exitoso en JS pre-commit — glifos eliminados del stream");
                                }
                            } catch (_spliceErr) {
                                console.warn("⚠️ [COMMIT] text_splice falló en JS pre-commit, usando fallback garantizado:", _spliceErr?.message || _spliceErr);
                                _didSplice = false;
                            }
                        }
                    }

                    // 2. Red de seguridad garantizada: si no se pudo hacer splice (falló, no aplicaba o legacy),
                    // ejecutar INMEDIATAMENTE eraseTextRegion para que el texto viejo quede 100% borrado.
                    if (_isSurgical && !_didSplice && this._pendingEraseRect && this._preEraseBuffer &&
                        this._preEraseBuffer.sourceId === page.sourceId) {
                        try {
                            window.__aliothDiag?.trace('TEXT-TXN', 'lazy-erase-start', {
                                transactionId: _diagTxnId,
                                eraseRect: this._pendingEraseRect
                            });
                            const _erasedBuf = await PythonManager.eraseTextRegion(
                                this._preEraseBuffer.buffer,
                                page.pageIndex,
                                this._pendingEraseRect
                            );
                            // Actualizar buffer en src para que applyReflowEdit trabaje sobre él
                            // (pero _preEraseBuffer sigue apuntando al original pre-erase para undo)
                            src.buffer = _erasedBuf;
                            src.doc = null;
                            window.__aliothDiag?.trace('TEXT-TXN', 'lazy-erase-finish', {
                                transactionId: _diagTxnId,
                                outputBytes: _erasedBuf?.byteLength || _erasedBuf?.length || null
                            });
                            console.log("🛡️ [COMMIT] Fallback eraseTextRegion ejecutado con éxito");
                        } catch (_ee) {
                            console.warn('⚠️ Lazy erase falló, usando buffer limpio', _ee);
                        }
                        this._pendingEraseRect = null;
                    }

                    // Textura de fondo (solo para modo no-quirúrgico)
                    let texture = null;
                    if (!_isSurgical && this._pendingTextureSample) {
                        texture = await PythonManager.generateSmartTexture(this._pendingTextureSample);
                    }

                    // Para surgical+párrafo: recalcular h igual que eraseH para que add_redact_annot
                    // cubra exactamente el mismo área que el draw_rect previo.
                    let _commitH = Number.isFinite(textObj.height) ? textObj.height : data.height;
                    if (_isSurgical && data.isParagraph) {
                        const _nLines = (newText || '').split('\n').filter(l => l.trim()).length || 1;
                        const _lh = (data.fontSize || 11) * 1.2;
                        const _asc = data.ascentPx ? (data.ascentPx / data.fontSize) : 0.932;
                        const _calcH = data.fontSize * _asc + (_nLines - 1) * _lh + data.fontSize * (1 - _asc) + 2;
                        _commitH = Math.max(data.height || 0, textObj.height || 0, _calcH);
                        console.log(`🟣 [COMMIT-H] isParagraph surgical: nLines=${_nLines} calcH=${_calcH.toFixed(2)} dataH=${data.height?.toFixed(2)} objH=${textObj.height?.toFixed(2)} → commitH=${_commitH.toFixed(2)}`);
                    }
                    // La geometría visible es la fuente de verdad para la inserción; el rect original
                    // se conserva por separado únicamente para borrar el texto anterior.
                    const _cX = Number.isFinite(textObj.x) ? textObj.x : data.x;
                    const _cY = Number.isFinite(textObj.y) ? textObj.y : data.y;
                    const _cW = Number.isFinite(textObj.width) && textObj.width > 0 ? textObj.width : data.width;
                    const _draggedX = Math.abs(_cX - data.x) > 0.01;
                    const _draggedY = Math.abs(_cY - data.y) > 0.01;
                    // ── FIX (bug #2): fuente unificada dentro de textObj._styleRuns (mismo
                    // array que color/negrita/cursiva/subrayado, con atributo `font`). Se
                    // mantiene soporte legacy para `rtieRuns` (4to parámetro) por si algún
                    // llamador aún lo pasa por separado (ej. showRealTextInlineEditor) ──
                    let segments = [];
                    try {
                        const _origText = (data.text || '');
                        let _runsToUse = textObj._styleRuns || [];
                        if (_runsToUse.length > 0 && _origText && _origText !== newText) {
                            _runsToUse = this._diffStyleRuns(_origText, newText, _runsToUse);
                        }
                        const _allRuns = _runsToUse
                            .filter(r => r.start >= 0 && r.end <= newText.length && r.start < r.end);
                        const _legacyFontRuns = (rtieRuns || [])
                            .filter(r => r.start >= 0 && r.end <= newText.length && r.start < r.end);

                        if (_allRuns.length > 0 || _legacyFontRuns.length > 0) {
                            const _baseFont = textObj.font || data.fontName;
                            const _baseColor = textObj.color !== undefined ? textObj.color : data.textColor;
                            const _baseBold = textObj.bold !== undefined ? textObj.bold : (data.isBold || false);
                            const _baseItalic = textObj.italic !== undefined ? textObj.italic : (data.isItalic || false);
                            const _baseUnderline = textObj.underline !== undefined ? textObj.underline : (data.isUnderline || false);

                            // Puntos de corte combinados de ambas listas de runs
                            const _cuts = new Set([0, newText.length]);
                            for (const r of _allRuns) { _cuts.add(r.start); _cuts.add(r.end); }
                            for (const r of _legacyFontRuns) { _cuts.add(r.start); _cuts.add(r.end); }
                            const _points = Array.from(_cuts).sort((a, b) => a - b);

                            // FIX (italic/font no persisten en segmentos parciales): familia RAW en ese punto
                            // (run de fuente si existe, si no la familia base sin sufijo del objeto).
                            const _baseFamilyAt = (pos) => {
                                const r = _allRuns.find(r => pos >= r.start && pos < r.end && r.font !== undefined);
                                if (r) return r.font;
                                const rl = _legacyFontRuns.find(r => pos >= r.start && pos < r.end);
                                if (rl) return rl.font;
                                return textObj.fontFamilyBase || _baseFont;
                            };
                            const _styleAt = (pos) => {
                                const r = _allRuns.find(r => pos >= r.start && pos < r.end);
                                return {
                                    color: r && r.color !== undefined ? r.color : _baseColor,
                                    isBold: r && r.isBold !== undefined ? r.isBold : _baseBold,
                                    isItalic: r && r.isItalic !== undefined ? r.isItalic : _baseItalic,
                                    isUnderline: r && r.isUnderline !== undefined ? r.isUnderline : _baseUnderline,
                                };
                            };
                            // Compone family+Bold+Italic para ese punto (mismo helper que toggleStyle/updateStyle)
                            const _fontAt = (pos) => {
                                const _fam = _baseFamilyAt(pos);
                                const _st = _styleAt(pos);
                                return this._composeFontKey
                                    ? this._composeFontKey(_fam, _st.isBold, _st.isItalic, textObj.isFallbackFont)
                                    : _fam;
                            };

                            for (let i = 0; i < _points.length - 1; i++) {
                                const start = _points[i], end = _points[i + 1];
                                if (end <= start) continue;
                                const text = newText.slice(start, end);
                                if (!text) continue;
                                segments.push({ text, font: _fontAt(start), ..._styleAt(start) });
                            }

                            // Fusionar segmentos adyacentes con exactamente los mismos atributos
                            const merged = [];
                            for (const s of segments) {
                                const last = merged[merged.length - 1];
                                if (last && last.font === s.font && last.color === s.color &&
                                    last.isBold === s.isBold && last.isItalic === s.isItalic &&
                                    last.isUnderline === s.isUnderline) {
                                    last.text += s.text;
                                } else {
                                    merged.push({ ...s });
                                }
                            }
                            segments = merged;
                        }
                    } catch(e) { console.warn("Error construyendo segments desde styleRuns:", e); segments = []; }

                    const editData = {
                        x: _cX,
                        y: _cY,
                        w: _cW,
                        h: _commitH,
                        text: newText,
                        segments: segments.length > 1 ? segments : null,
                        size: textObj.size !== undefined ? textObj.size : data.fontSize,
                        color: textObj.color !== undefined ? textObj.color : data.textColor,
                        bgColor: _isSurgical ? 'transparent' : (textObj.bgColor || data.bgColor || '#ffffff'),
                        eraseBgColor: data.bgColor || '#ffffff',
                        bgImage: (!_isSurgical && texture && !texture.startsWith('solid:')) ? texture : null,
                        font: textObj.font || data.fontName,
                        origin: data.origin,
                        lineOrigins: data.lineOrigins,
                        targetSpan: data.targetSpan,
                        targetSpans: data.targetSpans || (data.targetSpan ? [data.targetSpan] : null),
                        useSplice: _useSplice && !_didSplice,
                        skipErase: _didSplice,
                        draggedX: _draggedX,
                        draggedY: _draggedY,
                        expandIfNeeded: true,
                        isBold: textObj.bold !== undefined ? textObj.bold : (data.isBold || false),
                        isItalic: textObj.italic !== undefined ? textObj.italic : (data.isItalic || false),
                        isUnderline: textObj.underline || false,
                        letterSpacing: textObj.letterSpacing !== undefined ? textObj.letterSpacing : (data.letterSpacing || 0),
                        lineHeight: textObj.lineHeight !== undefined ? textObj.lineHeight : 1.2,
                        alignment: textObj.alignment || data.textAlign || 'left',
                        isSurgical: _isSurgical,
                        isParagraph: data.isParagraph,
                        ascentRatio: data.ascentPx ? (data.ascentPx / data.fontSize) : null,
                        // Rect completo del span original para add_redact_annot (borra todo el texto del span, no solo el sub-span)
                        eraseFullX: data.pdfFullSpanX !== undefined ? data.pdfFullSpanX : _cX,
                        eraseFullW: data.pdfFullSpanW !== undefined ? data.pdfFullSpanW : data.width,
                        // Cuando hay drag, preservar Y original del span para que Python borre en la posición correcta
                        eraseFullY: (_draggedY || _draggedX) ? data.y : undefined
                    };
                    window.__aliothDiag?.trace('FONT-DIAG', 'commit-payload', {
                        transactionId: _diagTxnId,
                        detected: {
                            pdfJsFont: data.baseFontFamily || null,
                            pythonFont: data.fontName || null,
                            pythonEnhanced: !!data.pythonEnhanced,
                            bold: !!data.isBold,
                            italic: !!data.isItalic
                        },
                        resolved: {
                            font: textObj.font,
                            fontFamilyBase: textObj.fontFamilyBase,
                            originalPdfFont: textObj.originalPdfFont,
                            fallback: !!textObj.isFallbackFont,
                            bold: !!textObj.bold,
                            italic: !!textObj.italic
                        },
                        editData: {
                            font: editData.font,
                            size: editData.size,
                            bold: editData.isBold,
                            italic: editData.isItalic,
                            alignment: editData.alignment,
                            rect: { x: editData.x, y: editData.y, width: editData.w, height: editData.h }
                        }
                    });
                    // Pasar bytes de fuente resuelta siempre — incluso si es fallback.
                    // Python usa isFallback para decidir: insert principal → emb_reuse del PDF;
                    // retry de leftover (chars acentuados fuera del subset) → fontfile TrueType.
                    try {
                        const _resolvedFontKey = textObj.font; // ej. "Arial-Bold"
                        const _isFallbackFont = !!textObj.isFallbackFont;
                        const _sysBytes = (this._systemFontBytes && this._systemFontBytes[_resolvedFontKey]) ||
                            await this.loadSystemFontBytes?.(_resolvedFontKey);
                        let _regBytes = this.fontRegistry && this.fontRegistry.loadedFonts && this.fontRegistry.loadedFonts[_resolvedFontKey];
                        const _registeredInfo = this.fontRegistry && this.fontRegistry.fonts && this.fontRegistry.fonts[_resolvedFontKey];
                        // Las fuentes incluidas en la app son canónicas. Cargarlas directamente
                        // evita que Local Font Access entregue Arial Black bajo la clave Arial-Bold.
                        if (_registeredInfo?.path && !_regBytes) {
                            try {
                                const _fontResponse = await fetch(_registeredInfo.path);
                                if (_fontResponse.ok) {
                                    _regBytes = await _fontResponse.arrayBuffer();
                                    this.fontRegistry.loadedFonts[_resolvedFontKey] = _regBytes;
                                }
                            } catch (_canonicalFontError) {
                                console.warn(`🟣 [FONT-DEBUG] No se pudo cargar fuente canónica "${_resolvedFontKey}":`, _canonicalFontError);
                            }
                        }
                        const _fontBytes = _regBytes || _sysBytes || null;
                        console.log(`🟣 [FONT-DEBUG] resolvedKey="${_resolvedFontKey}" isFallback=${_isFallbackFont} sysBytes=${_sysBytes ? _sysBytes.byteLength + 'B' : 'null'} regBytes=${_regBytes ? _regBytes.byteLength + 'B' : 'null'}`);
                        if (_fontBytes) {
                            const _u8 = new Uint8Array(_fontBytes);
                            // Verificar magic bytes del TTF (0x00010000 o 'OTTO' para OTF)
                            const _magic = Array.from(_u8.slice(0, 4)).map(b => b.toString(16).padStart(2,'0')).join(' ');
                            console.log(`🟣 [FONT-DEBUG] bytes[0..3]=${_magic} (TTF=00 01 00 00, OTF=4F 54 54 4F)`);
                            let _b64 = '';
                            const _chunk = 8190; // múltiplo de 3: evita padding = intermedios que rompen b64decode
                            for (let _i = 0; _i < _u8.length; _i += _chunk) {
                                _b64 += btoa(String.fromCharCode(..._u8.subarray(_i, _i + _chunk)));
                            }
                            editData.fontBuffer = _b64;
                            editData.fontBufferName = _resolvedFontKey;
                            console.log(`🟣 [FONT-DEBUG] fontBuffer enviado: ${_b64.length} chars b64`);
                            // Capa 3: enviar fuente TTF pura como fallback para glifos fuera del subset CID.
                            // Verdana/Trebuchet son TrueType puras (no CFF-in-TTF) → PyMuPDF no las clasifica como Type0.
                            try {
                                const _isBoldFb = textObj.bold || data.isBold;
                                const _isItalicFb = data.isItalic;
                                let _fbKey = 'Verdana';
                                if (_isBoldFb && _isItalicFb) _fbKey = 'Verdana-BoldItalic';
                                else if (_isBoldFb) _fbKey = 'Verdana-Bold';
                                else if (_isItalicFb) _fbKey = 'Verdana-Italic';
                                const _fbBytes = await this.fontRegistry.loadFontBytes.call(this.fontRegistry, _fbKey);
                                if (_fbBytes) {
                                    const _fbU8 = new Uint8Array(_fbBytes);
                                    let _fbB64 = '';
                                    for (let _i = 0; _i < _fbU8.length; _i += _chunk) {
                                        _fbB64 += btoa(String.fromCharCode(..._fbU8.subarray(_i, _i + _chunk)));
                                    }
                                    editData.fontBufferFallback = _fbB64;
                                    editData.fontBufferFallbackName = _fbKey;
                                    console.log(`🟣 [FONT-DEBUG] fontBufferFallback enviado: ${_fbKey} ${_fbB64.length} chars b64`);
                                }
                            } catch(_fbe) { console.warn('🟣 [FONT-DEBUG] fontBufferFallback error:', _fbe); }
                        } else {
                            console.warn(`🟣 [FONT-DEBUG] NO hay bytes para "${_resolvedFontKey}" — Python usará helv`);
                        }
                    } catch(_fe) { console.error('🟣 [FONT-DEBUG] error:', _fe); }

                    // ── Bug1/OpciónB: bytes de fuente EXACTA para segmentos con fuente distinta a la principal ──
                    // (evita el mapeo Base-14 en Python cuando sí tenemos los bytes reales de la fuente elegida)
                    if (segments.length > 1) {
                        const _mainFontKey = textObj.font || data.fontName;
                        const _uniqueSegFonts = [...new Set(segments.map(s => s.font).filter(f => f && f !== _mainFontKey))];
                        if (_uniqueSegFonts.length > 0) {
                            const _segFontBuffers = {};
                            for (const _sfKey of _uniqueSegFonts) {
                                try {
                                    let _sfBytes = (this._systemFontBytes && this._systemFontBytes[_sfKey]) ||
                                        await this.loadSystemFontBytes?.(_sfKey);
                                    if (!_sfBytes && this.fontResolutionPipeline) {
                                        const _sfRes = await this.fontResolutionPipeline(_sfKey, (this.fontRegistry && this.fontRegistry.fonts[_sfKey]) || null);
                                        if (_sfRes && _sfRes.bytes) {
                                            _sfBytes = _sfRes.bytes;
                                            if (!this._systemFontBytes) this._systemFontBytes = {};
                                            this._systemFontBytes[_sfKey] = _sfBytes;
                                        }
                                    }
                                    if (!_sfBytes && this.fontRegistry && this.fontRegistry.loadFontBytes) {
                                        _sfBytes = await this.fontRegistry.loadFontBytes.call(this.fontRegistry, _sfKey);
                                    }
                                    if (_sfBytes) {
                                        const _sfU8 = new Uint8Array(_sfBytes);
                                        let _sfB64 = '';
                                        const _chunkSf = 8190;
                                        for (let _i = 0; _i < _sfU8.length; _i += _chunkSf) {
                                            _sfB64 += btoa(String.fromCharCode(..._sfU8.subarray(_i, _i + _chunkSf)));
                                        }
                                        _segFontBuffers[_sfKey] = _sfB64;
                                        console.log(`🔤 [SEG-FONT] bytes resueltos para segmento "${_sfKey}": ${_sfB64.length} chars b64`);
                                    } else {
                                        console.warn(`🔤 [SEG-FONT] sin bytes para "${_sfKey}" — Python usará mapeo Base-14`);
                                    }
                                } catch (_sfe) {
                                    console.warn(`🔤 [SEG-FONT] error resolviendo "${_sfKey}":`, _sfe);
                                }
                            }
                            if (Object.keys(_segFontBuffers).length > 0) {
                                editData.segmentFontBuffers = _segFontBuffers;
                            }
                        }
                    }
                    // ── DEBUG: coordenadas enviadas a Python ──
                    console.log(`🟣 [COMMIT-editData] x=${editData.x?.toFixed(2)} y=${editData.y?.toFixed(2)} w=${editData.w?.toFixed(2)} h=${editData.h?.toFixed(2)} size=${editData.size?.toFixed(2)} font="${editData.font}" bgColor="${editData.bgColor}"`);
                    console.log(`🟣 [COMMIT-data.raw] data.x=${data.x?.toFixed(2)} data.y=${data.y?.toFixed(2)} data.width=${data.width?.toFixed(2)} data.height=${data.height?.toFixed(2)} data.fontSize=${data.fontSize?.toFixed(2)} data.ascentPx=${data.ascentPx?.toFixed(2)} data.jsY=${data.jsY?.toFixed(2)}`);
                    console.log(`🟣 [COMMIT-textObj] textObj.x=${textObj.x?.toFixed(2)} textObj.y=${textObj.y?.toFixed(2)} textObj.w=${textObj.width?.toFixed(2)} textObj.h=${textObj.height?.toFixed(2)} textObj.size=${textObj.size?.toFixed(2)}`);
                    console.log(`🟣 [COMMIT-scale] currentScale=${this.currentScale} | data.y/scale=${(data.y/this.currentScale)?.toFixed(2)} | textObj.y/scale=${(textObj.y/this.currentScale)?.toFixed(2)}`);

                    // Para surgical: src.buffer ya tiene el erase aplicado (lazy erase al inicio del commit).
                    const _srcBuffer = src.buffer;
                    console.log(`🟣 [COMMIT-BUF] isSurgical=${_isSurgical} using=src.buffer (post-lazy-erase)`);
                    window.__aliothDiag?.trace('TEXT-TXN', 'python-start', {
                        transactionId: _diagTxnId,
                        inputBytes: _srcBuffer?.byteLength || _srcBuffer?.length || null
                    });
                    const result = await PythonManager.applyReflowEdit(_srcBuffer, page.pageIndex, editData);
                    window.__aliothDiag?.trace('TEXT-TXN', 'python-finish', {
                        transactionId: _diagTxnId,
                        outputBytes: result.buffer?.byteLength || result.buffer?.length || null,
                        overflow: !!result.overflow,
                        expandedH: result.expandedH
                    });

                    src.buffer = result.buffer;
                    this.releasePdfSource?.(src);
                    src.doc = null;
                    this.saveState();
                    if (!doc._historyBuffers) doc._historyBuffers = {};
                    doc._historyBuffers[doc.historyIndex] = {
                        sourceId: page.sourceId,
                        beforeBuffer: _transactionBeforeBuffer,
                        afterBuffer: result.buffer.slice(0),
                        // Compatibilidad con snapshots antiguos y otras operaciones.
                        buffer: _transactionBeforeBuffer
                    };
                    this.trimDocumentHistory(doc);
                    _transactionCommitted = true;

                    // Diagnóstico profundo opcional; evita reabrir y analizar el PDF en cada edición normal.
                    if (this.debugTextEditing === true) {
                        try {
                            const _dbgDoc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                            const _dbgPage = await _dbgDoc.getPage(page.pageIndex + 1);
                            const _dbgTC = await _dbgPage.getTextContent();
                            const _dbgItems = _dbgTC.items.filter(it => {
                                const tx = pdfjsLib.Util.transform(_dbgPage.getViewport({scale:1}).transform || [1,0,0,-1,0,792], it.transform);
                                return Math.abs(tx[4] - editData.x) < 60 && Math.abs(tx[5] - editData.y) < 20;
                            });
                            console.log(`🔍 [POST-COMMIT TEXT] items near edit area: ${_dbgItems.length}`);
                            _dbgItems.forEach(it => console.log(`  str="${it.str}" font=${it.fontName} transform=${JSON.stringify(it.transform.map(v=>+v.toFixed(2)))}`));
                        } catch(_de) { console.log('🔍 [POST-COMMIT TEXT] error:', _de); }
                    }

                    // Preservar scroll al recargar la página
                    const _panelEls = this.getPanelElements(this.splitView.activePanel);
                    const _mv = _panelEls && _panelEls.mainView;
                    const _savedST = _mv ? _mv.scrollTop  : 0;
                    const _savedSL = _mv ? _mv.scrollLeft : 0;
                    if (_mv && this._wasInContinuous) {
                        const _pageEl = _panelEls && _panelEls.canvasContainer;
                        if (_pageEl) {
                            const _mvRect = _mv.getBoundingClientRect();
                            const _pageRect = _pageEl.getBoundingClientRect();
                            const _isH = document.body.classList.contains('h-layout');
                            this._exitContinuousScrollOffset = Math.max(0,
                                _isH ? _mvRect.left - _pageRect.left : _mvRect.top - _pageRect.top
                            );
                        }
                    }
                    this._suppressScrollIntoView = true;
                    window.__aliothDiag?.trace('TEXT-TXN', 'load-page-start', {
                        transactionId: _diagTxnId,
                        savedScroll: { left: _savedSL, top: _savedST },
                        view: window.__aliothDiag?.view(this.splitView?.activePanel)
                    });
                    await this.loadPage(doc.currentIndex);
                    window.__aliothDiag?.trace('TEXT-TXN', 'load-page-finish', {
                        transactionId: _diagTxnId,
                        view: window.__aliothDiag?.view(this.splitView?.activePanel)
                    });
                    // Solo restaurar si no volvemos a continuo (renderContinuousContent maneja el scroll)
                    if (_mv && !this._wasInContinuous) { _mv.scrollTop = _savedST; _mv.scrollLeft = _savedSL; }
                    _removeCover();
                    this.updateUndoRedoUI();

                    if (result.overflow) {
                        this.showToast('⚠️ Reflow aplicado — texto recortado (límite de página)', 5000);
                    } else if (result.expandedH > result.originalH) {
                        this.showToast(`✅ Reflow aplicado — bbox +${Math.round(result.expandedH - result.originalH)}pt`);
                    } else {
                        this.showToast('✅ Edición permanente aplicada');
                    }
                } catch (e) {
                    console.error('❌ Error en reflow:', e);
                    window.__aliothDiag?.error('TEXT-TXN', 'commit-exception', {
                        transactionId: _diagTxnId,
                        error: e.message || String(e),
                        stack: e.stack
                    });
                    _removeCover();
                    if (!_transactionCommitted) {
                        src.buffer = _transactionBeforeBuffer;
                        src.doc = null;
                        // Evitar texto fantasma superpuesto: si la edición física falló y restauramos
                        // el objeto como anotación visual, NO debe ser transparente para no solaparse.
                        textObj.bgColor = data.bgColor || '#ffffff';
                        textObj.bgAlpha = 1;
                        if (!page.objects.includes(textObj)) {
                            page.objects.splice(Math.max(0, idx), 0, textObj);
                        }
                    }
                    this.showToast('❌ Error en reflow: ' + e.message, 5000);
                    this.renderOverlays();
                }
                this.toggleLoader(false);
                this._realEditMode = false;
                this._preEraseBuffer = null;
                this._pendingEraseRect = null;
                if (this.selectedObj === textObj) this.selectedObj = null;
                if (this.multiObjectSelection) this.multiObjectSelection.delete(textObj.id);
                textObj._commitInProgress = false;
                this._realTextCommitInProgress = false;
                window.__aliothDiag?.trace('TEXT-TXN', 'commit-finalize', {
                    transactionId: _diagTxnId,
                    committed: _transactionCommitted,
                    view: window.__aliothDiag?.view(this.splitView?.activePanel)
                });
                // FIX (miniaturas lentas): antes renderSidebar() completo — reconstruye TODOS los
                // <div>+<canvas> de la sidebar y reconecta el IntersectionObserver del documento
                // entero, en cada "Aceptar" de una edición real de texto (la acción más frecuente
                // del editor). Ahora solo se refresca la miniatura de la página que en verdad cambió.
                // refreshThumbnail() está definido en app_render.js.
                this.refreshThumbnail(doc.currentIndex);
                this._restoreContinuousIfNeeded();
            },

            scanQR: async function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) { alert("No hay documento."); return; }

                if (typeof jsQR === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('jsqr');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('jsqr');
                }

                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Escaneando QRs...";

                try {
                    // 1. Get Base PDF Page
                    const p = doc.pages[doc.currentIndex];
                    const src = doc.sources[p.sourceId];
                    if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const page = await src.doc.getPage(p.pageIndex + 1);

                    // 2. Render Base PDF to Canvas (Scale 2.0 for better resolution)
                    const scale = 2.0;
                    const viewport = page.getViewport({ scale: scale });
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = viewport.width;
                    tempCanvas.height = viewport.height;
                    const tempCtx = tempCanvas.getContext('2d');

                    await page.render({ canvasContext: tempCtx, viewport: viewport }).promise;

                    // 3. Render User-Inserted Objects (Images/Icons) onto the same canvas
                    // This fixes the issue where inserted images were ignored
                    if (p.objects && p.objects.length > 0) {
                        for (const obj of p.objects) {
                            if (obj.type === 'image' && obj.src) {
                                try {
                                    const img = await new Promise((resolve, reject) => {
                                        const i = new Image();
                                        i.onload = () => resolve(i);
                                        i.onerror = reject;
                                        i.src = obj.src;
                                    });

                                    // Calculate position on the scaled canvas
                                    // obj.x/y/width/height are in PDF point units (72 DPI usually)
                                    // We need to map them to the canvas viewport
                                    // PDFJS viewport.transform gives [scaleX, 0, 0, -scaleY, offsetX, offsetY]
                                    // But simpler approach: coordinate * scale (since we used scale 2.0)

                                    // Note: PDF coordinates are usually bottom-left origin in PDF structure, 
                                    // but app seems to track top-left visually? 
                                    // Based on 'renderSearchHighlights': x * currentScale.
                                    // Here we are using PDFJS render which handles the transform. 
                                    // If 'obj' coordinates are consistent with how the app renders overlays, we can scale them.

                                    // App renders overlays simply with absolute positioning.
                                    // Let's assume obj.x and obj.y are relative to the page top-left at scale 1.0.

                                    const objX = obj.x * scale;
                                    const objY = obj.y * scale;
                                    const objW = obj.width * scale;
                                    const objH = obj.height * scale;

                                    tempCtx.drawImage(img, objX, objY, objW, objH);
                                } catch (err) {
                                    console.warn("Could not render object for QR scan:", obj, err);
                                }
                            }
                        }
                    }

                    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                    const foundQRs = [];
                    const foundData = new Set(); // To avoid duplicates

                    // Helper to add unique QRs
                    const addResult = (code, sourceStr) => {
                        if (code && code.data && !foundData.has(code.data)) {
                            foundData.add(code.data);
                            foundQRs.push({ data: code.data, location: code.location, source: sourceStr });
                        }
                    };

                    // 4. SCAN STRATEGY A: Full Canvas (Combined PDF + Images)
                    const fullCode = jsQR(imageData.data, imageData.width, imageData.height);
                    addResult(fullCode, "Escaneo Completo");

                    // 4b. SCAN STRATEGY A+: PIL preprocess si no se encontró nada aún
                    // Solo para PDFs escaneados o QRs de bajo contraste — no afecta QRs ya detectados
                    if (foundQRs.length === 0 && window.PythonManager && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "Escaneando QRs (mejora PIL)...";
                            const rawDataUrl = tempCanvas.toDataURL('image/png');
                            const preprocessed = await PythonManager.preprocessForOCR(rawDataUrl);
                            // Cargar imagen procesada en canvas temporal para obtener ImageData
                            const procImg = await new Promise((res, rej) => {
                                const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = preprocessed;
                            });
                            const procCanvas = document.createElement('canvas');
                            procCanvas.width = procImg.width; procCanvas.height = procImg.height;
                            procCanvas.getContext('2d').drawImage(procImg, 0, 0);
                            const procData = procCanvas.getContext('2d').getImageData(0, 0, procCanvas.width, procCanvas.height);
                            const procCode = jsQR(procData.data, procData.width, procData.height);
                            addResult(procCode, "Escaneo PIL Enhanced");
                            console.log(`🐍 QR PIL scan: ${procCode ? 'encontrado' : 'no encontrado'}`);
                        } catch (pilErr) {
                            console.warn('🐍 QR PIL preprocess falló:', pilErr);
                        }
                    }

                    // 5. SCAN STRATEGY B: Quadrants (Good for multiple QRs)
                    const halfW = Math.floor(tempCanvas.width / 2);
                    const halfH = Math.floor(tempCanvas.height / 2);
                    const regions = [
                        { x: 0, y: 0, w: halfW, h: halfH },
                        { x: halfW, y: 0, w: halfW, h: halfH },
                        { x: 0, y: halfH, w: halfW, h: halfH },
                        { x: halfW, y: halfH, w: halfW, h: halfH }
                    ];

                    for (const r of regions) {
                        const regionData = tempCtx.getImageData(r.x, r.y, r.w, r.h);
                        const code = jsQR(regionData.data, r.w, r.h);
                        addResult(code, "Cuadrante");
                    }

                    // 6. SCAN STRATEGY C: "Aggressive" Object Scan (Source Resolution)
                    // Extract exact image data from inserted objects and scan them individually 
                    // without scaling artifacts.
                    if (p.objects) {
                        for (const obj of p.objects) {
                            if (obj.type === 'image' && obj.src) {
                                try {
                                    const img = await new Promise((resolve) => {
                                        const i = new Image();
                                        i.onload = () => resolve(i);
                                        i.onerror = () => resolve(null);
                                        i.src = obj.src;
                                    });

                                    if (img) {
                                        const objCanvas = document.createElement('canvas');
                                        objCanvas.width = img.width;
                                        objCanvas.height = img.height;
                                        const objCtx = objCanvas.getContext('2d');
                                        objCtx.drawImage(img, 0, 0);

                                        const objData = objCtx.getImageData(0, 0, objCanvas.width, objCanvas.height);

                                        // Standard Scan on Object
                                        let code = jsQR(objData.data, objCanvas.width, objCanvas.height);
                                        addResult(code, "Objeto (Directo)");

                                        // Inverted Color Scan (for white-on-black QRs)
                                        if (!code) {
                                            for (let i = 0; i < objData.data.length; i += 4) {
                                                objData.data[i] = 255 - objData.data[i];     // R
                                                objData.data[i + 1] = 255 - objData.data[i + 1]; // G
                                                objData.data[i + 2] = 255 - objData.data[i + 2]; // B
                                            }
                                            code = jsQR(objData.data, objCanvas.width, objCanvas.height);
                                            addResult(code, "Objeto (Invertido)");
                                        }
                                    }
                                } catch (e) { console.warn("Error scanning individual object", e); }
                            }
                        }
                    }

                    this.toggleLoader(false);

                    if (foundQRs.length === 0) {
                        this.showToast("No se encontraron códigos QR");
                        return;
                    }

                    this.showScanResults(foundQRs, 'QR');

                } catch (e) {
                    this.toggleLoader(false);
                    console.error("Error escaneando QR:", e);
                    this.showToast("Error al escanear: " + e.message);
                }
            },

            copyQRData: function (data) {
                const temp = document.createElement("textarea");
                temp.value = data;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand("copy");
                document.body.removeChild(temp);
                this.showToast("✓ Copiado al portapapeles");
            },

            copyQRText: function () {
                // Legacy support - deprecated
                this.showToast("Use copyQRData");
            },

            // ─── BARCODE SCAN ────────────────────────────────────────────
            scanBarcode: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { this.showToast('⚠️ Abre un PDF primero'); return; }
                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = 'Escaneando códigos de barras...';
                try {
                    const p = doc.pages[doc.currentIndex];
                    const src = doc.sources[p.sourceId];
                    if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const page = await src.doc.getPage(p.pageIndex + 1);
                    const scale = 2.5;
                    const viewport = page.getViewport({ scale });
                    const cvs = document.createElement('canvas');
                    cvs.width = viewport.width; cvs.height = viewport.height;
                    const ctx = cvs.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    for (const obj of (p.objects || [])) {
                        if (obj.type === 'image' && obj.src) {
                            try {
                                const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = obj.src; });
                                ctx.drawImage(img, obj.x * scale, obj.y * scale, obj.width * scale, obj.height * scale);
                            } catch(e) {}
                        }
                    }
                    if (!window.ZXing) await this.lazyLoad('zxing');
                    let results = [];
                    if (window.ZXing) {
                        try {
                            const hints = new Map();
                            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
                            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
                                ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
                                ZXing.BarcodeFormat.CODE_93, ZXing.BarcodeFormat.EAN_13,
                                ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A,
                                ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.ITF,
                                ZXing.BarcodeFormat.CODABAR
                            ]);
                            const reader = new ZXing.MultiFormatReader();
                            reader.setHints(hints);
                            const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
                            const gray = new Uint8ClampedArray(cvs.width * cvs.height);
                            for (let i = 0; i < gray.length; i++) {
                                const pixel = i * 4;
                                gray[i] = (imgData.data[pixel] + 2 * imgData.data[pixel + 1] + imgData.data[pixel + 2]) / 4;
                            }
                            const lum = new ZXing.RGBLuminanceSource(gray, cvs.width, cvs.height);
                            const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
                            try { const r = reader.decode(bmp); if (r) results.push({ text: r.getText(), format: String(r.getBarcodeFormat()) }); } catch(e) {}
                        } catch(e) { console.warn('ZXing barcode scan error:', e); }
                    }
                    this.toggleLoader(false);
                    if (!results.length) { this.showToast('No se encontraron códigos de barras'); return; }
                    this.showScanResults(results.map(r => ({ data: r.text, source: r.format })), 'Código');
                } catch(e) {
                    this.toggleLoader(false);
                    console.error('scanBarcode error:', e);
                    this.showToast('❌ Error al escanear: ' + e.message);
                }
            },

            // ─── BARCODE GENERATOR ───────────────────────────────────────
            showBarcodeGeneratorModal: async function () {
                if (typeof JsBarcode === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('jsbarcode');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('jsbarcode');
                }
                const existing = document.getElementById('_alioth_barcode_modal');
                if (existing) existing.remove();
                const modal = document.createElement('div');
                modal.id = '_alioth_barcode_modal';
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px;box-sizing:border-box;';

                // Helper: color row with square swatch + hex input
                const colorRow = (id, label, defVal) => `
                    <div style="flex:1;">
                        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">${label}</label>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <div style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);overflow:hidden;flex-shrink:0;cursor:pointer;" onclick="document.getElementById('${id}').click()">
                                <input type="color" id="${id}" value="${defVal}" style="width:200%;height:200%;margin:-25%;border:none;padding:0;cursor:pointer;" oninput="document.getElementById('${id}_hex').value=this.value; app._previewBarcode()">
                            </div>
                            <input id="${id}_hex" type="text" value="${defVal}" maxlength="7"
                                style="width:70px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text-main);font-size:11px;font-family:monospace;"
                                oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value)){document.getElementById('${id}').value=this.value;app._previewBarcode();}">
                        </div>
                    </div>`;

                modal.innerHTML = `
                <div style="background:rgba(26,32,53,0.63);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:20px;width:480px;max-width:100%;box-shadow:0 16px 48px rgba(0,0,0,0.6);color:#f0f4ff;--text-main:#e8eeff;--input-bg:rgba(10,15,35,0.7);--border:rgba(100,140,255,0.35);--bg-tools:rgba(255,255,255,0.08);position:relative;">
                    <!-- Header -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                        <strong style="font-size:14px;">&#128290; Generador de Código de Barras</strong>
                        <button class="modal-close-btn-round" onclick="document.getElementById('_alioth_barcode_modal').remove()" style="position:absolute;top:14px;right:14px;">✕</button>
                    </div>

                    <!-- Texto + Formato -->
                    <div style="display:flex;gap:10px;margin-bottom:10px;">
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Texto / Número</label>
                            <input id="_bc_text" type="text" value="1234567890"
                                style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:13px;"
                                oninput="app._previewBarcode()">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Formato</label>
                            <select id="_bc_format"
                                style="width:100%;padding:7px 8px;height:34px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                onchange="app._previewBarcode()">
                                <option value="CODE128">CODE 128 (Universal)</option>
                                <option value="CODE39">CODE 39</option>
                                <option value="EAN13">EAN-13 (13 dígitos)</option>
                                <option value="EAN8">EAN-8 (8 dígitos)</option>
                                <option value="UPC">UPC-A (12 dígitos)</option>
                                <option value="ITF14">ITF-14 (14 dígitos)</option>
                                <option value="MSI">MSI</option>
                                <option value="pharmacode">Pharmacode</option>
                            </select>
                        </div>
                    </div>

                    <!-- Ancho línea + Alto -->
                    <div style="display:flex;gap:10px;margin-bottom:10px;">
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Ancho línea</label>
                            <input id="_bc_lw" type="number" value="2" min="1" max="6"
                                style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                oninput="app._previewBarcode()">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Alto (px)</label>
                            <input id="_bc_h" type="number" value="80" min="20" max="200"
                                style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                oninput="app._previewBarcode()">
                        </div>
                    </div>

                    <!-- Mostrar valor + Colores -->
                    <div style="display:flex;gap:10px;margin-bottom:10px;align-items:center;">
                        ${colorRow('_bc_fg','Color barras','#000000')}
                        ${colorRow('_bc_bg','Fondo','#ffffff')}
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Mostrar texto</label>
                            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px;">
                                <input type="checkbox" id="_bc_dv" checked onchange="app._previewBarcode()"
                                    style="width:16px;height:16px;cursor:pointer;">
                                <span style="font-size:11px;">Visible</span>
                            </label>
                        </div>
                    </div>

                    <!-- Borde -->
                    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px;">
                        <div style="font-size:11px;font-weight:700;margin-bottom:8px;text-transform:uppercase;opacity:0.7;">Borde</div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <div style="flex:1;min-width:80px;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Grosor (px)</label>
                                <input id="_bc_bw" type="number" value="0" min="0" max="20"
                                    style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                    oninput="app._previewBarcode()">
                            </div>
                            <div style="flex:1;min-width:80px;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Radio (px)</label>
                                <input id="_bc_br" type="number" value="0" min="0" max="30"
                                    style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                    oninput="app._previewBarcode()">
                            </div>
                            <div style="flex:1;min-width:80px;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Estilo</label>
                                <select id="_bc_bs" style="width:100%;padding:5px 8px;height:32px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:11px;" onchange="app._previewBarcode()">
                                    <option value="solid">Sólido</option>
                                    <option value="dashed">Guiones</option>
                                    <option value="dotted">Puntos</option>
                                    <option value="double">Doble</option>
                                </select>
                            </div>
                            ${colorRow('_bc_bc','Color borde','#000000')}
                        </div>
                    </div>

                    <!-- Título / Etiqueta -->
                    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px;">
                        <div style="font-size:11px;font-weight:700;margin-bottom:8px;text-transform:uppercase;opacity:0.7;">Título del código</div>
                        <div style="display:flex;gap:10px;margin-bottom:8px;">
                            <div style="flex:2;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Texto del título</label>
                                <input id="_bc_title" type="text" value="" placeholder="(opcional)"
                                    style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                    oninput="app._previewBarcode()">
                            </div>
                            <div style="flex:1;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Tamaño fuente</label>
                                <input id="_bc_tfs" type="number" value="13" min="8" max="32"
                                    style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:12px;"
                                    oninput="app._previewBarcode()">
                            </div>
                        </div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <div style="flex:2;min-width:120px;">
                                <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px;">Fuente</label>
                                <select id="_bc_tf" style="width:100%;padding:5px 8px;height:32px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text-main);font-size:11px;" onchange="app._previewBarcode()">
                                    <option value="Arial, sans-serif">Arial</option>
                                    <option value="Helvetica, sans-serif">Helvetica</option>
                                    <option value="'Times New Roman', serif">Times New Roman</option>
                                    <option value="'Courier New', monospace">Courier New</option>
                                    <option value="Georgia, serif">Georgia</option>
                                    <option value="Verdana, sans-serif">Verdana</option>
                                    <option value="Tahoma, sans-serif">Tahoma</option>
                                </select>
                            </div>
                            ${colorRow('_bc_tfc','Color fuente','#000000')}
                            ${colorRow('_bc_tbg','Fondo título','#ffffff')}
                        </div>
                    </div>

                    <!-- Preview -->
                    <canvas id="_bc_preview" style="display:block;margin:0 auto 12px;max-width:100%;border:1px solid var(--border);border-radius:4px;"></canvas>

                    <!-- Botones -->
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button onclick="app._previewBarcode()" style="padding:7px 14px;background:var(--bg-tools);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;color:var(--text-main);">Vista Previa</button>
                        <button onclick="app._insertBarcodeFromModal()" style="padding:7px 16px;background:var(--accent);color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">Insertar en PDF</button>
                    </div>
                </div>`;
                document.body.appendChild(modal);
                // Click outside does NOT close modal (intentional)
                
                // ESC key listener to close barcode modal
                const _barcodeEscHandler = (e) => {
                    const m = document.getElementById('_alioth_barcode_modal');
                    if (!m) {
                        window.removeEventListener('keydown', _barcodeEscHandler);
                        return;
                    }
                    if (e.key === 'Escape') {
                        m.remove();
                        window.removeEventListener('keydown', _barcodeEscHandler);
                    }
                };
                window.addEventListener('keydown', _barcodeEscHandler);

                setTimeout(() => this._previewBarcode(), 120);
            },

            _previewBarcode: function () {
                const g = id => document.getElementById(id);
                const v = id => (g(id) || {}).value || '';
                const n = (id, def) => parseInt(v(id)) || def;

                const text  = v('_bc_text');
                const cvs   = g('_bc_preview');
                if (!cvs || !text.trim()) return;

                if (typeof JsBarcode === 'undefined') {
                    const ctx = cvs.getContext('2d'); cvs.width = 340; cvs.height = 50;
                    ctx.clearRect(0,0,cvs.width,cvs.height);
                    ctx.fillStyle = '#ff6600'; ctx.font = '12px sans-serif';
                    ctx.fillText('JsBarcode no cargado (requiere libs/JsBarcode.all.min.js)', 8, 30);
                    return;
                }

                const format = v('_bc_format') || 'CODE128';
                const lw     = n('_bc_lw', 2);
                const h      = n('_bc_h', 80);
                const fg     = v('_bc_fg') || '#000000';
                const bg     = v('_bc_bg') || '#ffffff';
                const bw     = n('_bc_bw', 0);
                const br     = n('_bc_br', 0);
                const bs     = v('_bc_bs') || 'solid';
                const bc     = v('_bc_bc') || '#000000';
                const title  = v('_bc_title');
                const tfs    = n('_bc_tfs', 13);
                const tf     = v('_bc_tf') || 'Arial, sans-serif';
                const tfc    = v('_bc_tfc') || '#000000';
                const tbg    = v('_bc_tbg') || '#ffffff';

                // Step 1: render barcode to temp canvas
                const tmp = document.createElement('canvas');
                try {
                    JsBarcode(tmp, text, {
                        format, lineColor: fg, background: bg,
                        width: lw, height: h,
                        displayValue: !!(document.getElementById('_bc_dv') && document.getElementById('_bc_dv').checked), fontSize: 12, margin: 8
                    });
                } catch(e) {
                    const ctx = cvs.getContext('2d'); cvs.width = 340; cvs.height = 50;
                    ctx.fillStyle = '#ff4444'; ctx.font = '12px sans-serif';
                    ctx.fillText('Error: ' + e.message, 8, 28);
                    return;
                }

                // Step 2: compose onto final canvas with border + title
                const titleH = title ? tfs + 10 : 0;
                const pad = bw;
                cvs.width  = tmp.width  + pad * 2;
                cvs.height = tmp.height + pad * 2 + titleH;
                const ctx = cvs.getContext('2d');

                // Background
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, cvs.width, cvs.height);

                // Title bar
                if (title) {
                    ctx.fillStyle = tbg;
                    ctx.fillRect(pad, pad, tmp.width, titleH);
                    ctx.fillStyle = tfc;
                    ctx.font = 'bold ' + tfs + 'px ' + tf;
                    ctx.textAlign = 'center';
                    ctx.fillText(title, cvs.width / 2, pad + titleH - 4);
                }

                // Barcode
                ctx.drawImage(tmp, pad, pad + titleH);

                // Border
                if (bw > 0) {
                    ctx.strokeStyle = bc;
                    ctx.lineWidth = bw;
                    if (bs === 'dashed') ctx.setLineDash([8, 4]);
                    else if (bs === 'dotted') ctx.setLineDash([2, 3]);
                    else if (bs === 'double') { ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeRect(1,1,cvs.width-2,cvs.height-2); ctx.strokeRect(bw+1,bw+1,cvs.width-bw*2-2,cvs.height-bw*2-2); }
                    else ctx.setLineDash([]);
                    if (br > 0) {
                        ctx.beginPath();
                        ctx.roundRect(bw/2, bw/2, cvs.width-bw, cvs.height-bw, br);
                        ctx.stroke();
                    } else if (bs !== 'double') {
                        ctx.strokeRect(bw/2, bw/2, cvs.width-bw, cvs.height-bw);
                    }
                    ctx.setLineDash([]);
                }
            },

            _insertBarcodeFromModal: function () {
                const text = (document.getElementById('_bc_text') || {}).value || '';
                if (!text.trim()) { this.showToast('⚠️ Ingresa el texto del código'); return; }
                this._previewBarcode();
                const cvs = document.getElementById('_bc_preview');
                if (!cvs || !cvs.width) { this.showToast('⚠️ Error al generar vista previa'); return; }
                const dataUrl = cvs.toDataURL('image/png');
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { this.showToast('⚠️ Abre un PDF primero'); return; }
                const center = this.getVisibleCenter();
                const w = Math.min(cvs.width / 2, 320), h = Math.min(cvs.height / 2, 130);
                const newObj = {
                    id: 'barcode' + Date.now(), type: 'image', src: dataUrl,
                    x: center.x - w / 2, y: center.y - h / 2,
                    width: w, height: h, opacity: 1, scaleX: 1, scaleY: 1, rotation: 0, filters: {}
                };
                doc.pages[doc.currentIndex].objects.push(newObj);
                this.selectedObj = newObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(newObj.id);
                this.renderOverlays();
                this.renderSidebar();
                this.saveStateDebounced(500);
                const modal = document.getElementById('_alioth_barcode_modal');
                if (modal) modal.remove();
                this.showToast('✅ Código de barras insertado');
            },

            // ============================================================
            // SECTION 8: PAGE OPERATIONS (Rotate, Flip, Delete, Extract)
            // ============================================================

            /**
             * Rotates selected page(s) by specified degrees
             * @param {number} deg - Rotation angle (90, -90, 180, etc.)
             */
            compressImageData: async function (source, quality = 0.75) {
                if (source.includes('image/svg+xml')) return source;

                return new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = async () => {
                        try {
                            let canvas, ctx;
                            if (typeof OffscreenCanvas !== 'undefined') {
                                canvas = new OffscreenCanvas(img.width, img.height);
                                ctx = canvas.getContext('2d');
                            } else {
                                canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                ctx = canvas.getContext('2d');
                            }

                            ctx.fillStyle = 'white';
                            ctx.fillRect(0, 0, img.width, img.height);
                            ctx.drawImage(img, 0, 0);

                            if (typeof OffscreenCanvas !== 'undefined') {
                                const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
                                const buffer = await blob.arrayBuffer();
                                resolve(new Uint8Array(buffer));
                            } else {
                                canvas.toBlob(async (blob) => {
                                    if (!blob) return resolve(source);
                                    const buffer = await blob.arrayBuffer();
                                    resolve(new Uint8Array(buffer));
                                }, 'image/jpeg', quality);
                            }
                        } catch (e) {
                            console.warn('Compression failed, using original', e);
                            resolve(source);
                        }
                    };
                    img.onerror = () => {
                        console.warn('Image load failed for compression, using original source');
                        resolve(source);
                    };
                    img.src = source;
                });
            },

            // OPACITY NORMALIZATION FUNCTION: Ensure all opacity values are in 0-1 range for PDF-lib
            normalizeAllOpacity: function (doc) {
                if (!doc || !doc.pages) return;
                doc.pages.forEach(page => {
                    if (page.objects && Array.isArray(page.objects)) {
                        page.objects.forEach(obj => {
                            // Normalize opacity: if > 1 (old format 0-100), divide by 100
                            if (obj.opacity !== undefined) {
                                if (obj.opacity > 1) {
                                    obj.opacity = obj.opacity / 100;
                                }
                                // Ensure it's never outside 0-1 range
                                obj.opacity = Math.max(0, Math.min(1, obj.opacity));
                            } else {
                                // Default to fully opaque
                                obj.opacity = 1;
                            }

                            // NORMALIZE BACKGROUND OPACITY (bgAlpha)
                            if (obj.bgAlpha !== undefined) {
                                if (obj.bgAlpha > 1) {
                                    obj.bgAlpha = obj.bgAlpha / 100;
                                }
                                obj.bgAlpha = Math.max(0, Math.min(1, obj.bgAlpha));
                            }

                            // NORMALIZE FILTERS OPACITY
                            if (obj.filters && typeof obj.filters === 'object') {
                                if (obj.filters.opacity !== undefined && obj.filters.opacity > 1) {
                                    obj.filters.opacity = obj.filters.opacity / 100;
                                }
                            }
                        });
                    }
                });
            },

            saveWithEncryption: async function (filename, userPassword, ownerPassword, compress) {
                const doc = this.getDoc();

                // Get permissions
                const permissions = [];
                if (document.getElementById('perm-print').checked) permissions.push('print');
                if (document.getElementById('perm-modify').checked) permissions.push('modify');
                if (document.getElementById('perm-copy').checked) permissions.push('copy');
                if (document.getElementById('perm-annotate').checked) permissions.push('annotate');

                document.getElementById('loader-msg').innerText = "Generando PDF base...";

                // Generate PDF bytes first reusing the robust savePDFInternal
                // Compression is applied here if requested
                const pdfBytes = await this.savePDFInternal(false, null, compress, true);

                if (!pdfBytes) {
                    throw new Error('No se pudo generar el PDF');
                }

                document.getElementById('loader-msg').innerText = "Aplicando protección AES-256...";

                let finalBytes = pdfBytes;
                let encryptionMethod = 'none';

                // ── MÉTODO 1: PyMuPDF (AES-256 nativo — preserva vectores, texto, formularios) ──
                if (window.PythonManager) {
                    try {
                        console.log('🔒 Intentando encriptación con PyMuPDF (AES-256)...');
                        finalBytes = await PythonManager.encryptPDF(pdfBytes, userPassword, ownerPassword, permissions);
                        encryptionMethod = 'PyMuPDF AES-256';
                        console.log('✅ Encriptación PyMuPDF exitosa — vectores y texto preservados');
                    } catch (pyErr) {
                        console.warn('🐍 PyMuPDF encryption failed, trying jsPDF fallback:', pyErr);
                    }
                }

                // ── MÉTODO 2 (Fallback): jsPDF — re-renderiza como JPEG (pierde calidad vectorial) ──
                if (encryptionMethod === 'none' && typeof jspdf !== 'undefined' && jspdf.jsPDF) {
                    try {
                        console.log('🔒 Fallback: Encriptación con jsPDF (rendimiento JPEG)...');
                        document.getElementById('loader-msg').innerText = "Protegiendo el PDF...";

                        const pdf = new jspdf.jsPDF({
                            encryption: {
                                userPassword: userPassword,
                                ownerPassword: ownerPassword,
                                userPermissions: permissions
                            }
                        });

                        const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);
                        const pageCount = srcDoc.getPageCount();

                        for (let i = 0; i < pageCount; i++) {
                            document.getElementById('loader-msg').innerText = `Encriptando página ${i + 1}/${pageCount} (jsPDF)...`;

                            const page = srcDoc.getPage(i);
                            const { width, height } = page.getSize();

                            const canvas = document.createElement('canvas');
                            const scale = compress ? 1.5 : 2;

                            const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
                            const pdfPage = await pdfDoc.getPage(i + 1);
                            const viewport = pdfPage.getViewport({ scale: scale });

                            canvas.width = viewport.width;
                            canvas.height = viewport.height;

                            const ctx = canvas.getContext('2d');
                            await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;

                            const imgData = canvas.toDataURL('image/jpeg', compress ? 0.8 : 0.95);

                            if (i > 0) {
                                pdf.addPage([width, height]);
                            } else {
                                pdf.internal.pageSize.width = width;
                                pdf.internal.pageSize.height = height;
                            }

                            pdf.addImage(imgData, 'JPEG', 0, 0, width, height, undefined, compress ? 'FAST' : 'NONE');
                        }

                        finalBytes = pdf.output('arraybuffer');
                        encryptionMethod = 'jsPDF (JPEG fallback)';

                    } catch (encryptError) {
                        console.warn('jsPDF encryption also failed:', encryptError);
                        this.showToast('⚠️ Protección fallida. Guardando sin encriptación.');
                    }
                }

                const blob = new Blob([finalBytes], { type: 'application/pdf' });
                saveAs(blob, filename + '.pdf');

                if (encryptionMethod !== 'none') {
                    const method = encryptionMethod.includes('PyMuPDF') ? '🔒 AES-256' : '🔒 jsPDF';
                    this.showToast(`PDF guardado (${method})`);
                } else {
                    this.showToast('PDF guardado (sin protección)');
                }
            },

});
