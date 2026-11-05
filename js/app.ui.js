// app.ui.js
// Extiende el objeto global `app` con métodos de ui
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            isHandMode: false, isPanning: false, isBoxSelectMode: false,
            panStart: { x: 0, y: 0 }, panScroll: { left: 0, top: 0 },
            showGrid: false, showRuler: false, measureMode: false,
            splitView: {
                mode: 'single',  // 'single' | 'horizontal' | 'vertical'
                activePanel: 'primary',  // 'primary' | 'secondary'
                primary: { docId: null, pageIndex: 0, scale: 1.0 },
                secondary: { docId: null, pageIndex: 0, scale: 1.0 },
                dividerRatio: 0.5
            },
            _sidebarObserver: null,

            // ============================================================
            // FONT SYSTEM - Registry & Recognition
            // ============================================================

            /**
             * Font Registry: Maps selector values to font properties
             * Used for canvas rendering and PDF embedding
             */

            // ============================================================
            // MODAL & PROPERTIES MANAGEMENT
            // ============================================================

            closeAllModals: function () {
                // MODAL MASTER CLEANUP: Robustly hide and reset all UI overlays
                try {
                    this.cancelPendingSignature?.();
                    if (document.getElementById('translation-review-modal')?.style.display === 'flex') {
                        this._translationReviewAbortController?.abort();
                        this._translationReviewAbortController = null;
                        if (this._translationReviewDocId) {
                            this._translationApplyAbortController?.abort();
                            this._translationApplyAbortController = null;
                            if (this._activeTranslationReviewId) this.discardTextTranslationReview?.(this._activeTranslationReviewId);
                            this._activeTranslationReviewId = null;
                            this._translationReviewDocId = null;
                            this._translationReviewPhase = null;
                            this._translationReviewMinimized = false;
                        }
                    }
                    const selectors = [
                        '.glass-box',
                        '.modal-overlay',
                        '.glass-overlay',
                        '#modal-overlay',
                        '#loading-overlay',
                        '#properties-modal',
                        '#field-props-modal',
                        '#table-props-modal',
                        '#custom-alert-overlay',
                        '#qr-result-modal',
                        '#qr-gen-modal',
                        '#link-modal',
                        '#emoji-modal',
                        '#ocr-result-modal',
                        '#tables-modal',
                        '#remove-links-modal',
                        '#remove-images-modal',
                        '#images-modal',
                        '#metadata-modal',
                        '#page-num-modal',
                        '#highlight-color-modal',
                        '#save-modal',
                        '#theme-modal',
                        '#ai-image-preview-modal',
                        '#shortcut-picker-modal',
                        '#measure-calibration-modal',
                        '#drop-overlay',
                        '#ttf-props-dialog',
                        '#about-modal',
                        '#preferences-modal',
                        '#form-console-modal',
                        '#modal-data-extraction',
                        '#shape-properties-modal',
                        '#firmas-dropdown',
                        '#command-palette-modal'
                    ];

                    selectors.forEach(sel => {
                        document.querySelectorAll(sel).forEach(el => {
                            if (el) {
                                // .glass-overlay are dynamic modals (appended to body) — remove from DOM
                                if (el.classList && el.classList.contains('glass-overlay')) {
                                    el.remove();
                                } else {
                                    el.style.display = 'none';
                                }
                            }
                        });
                    });

                    // Ensure main overlay and loader are hidden
                    const mainOverlay = document.getElementById('modal-overlay');
                    if (mainOverlay) {
                        mainOverlay.style.display = 'none';
                        mainOverlay.style.visibility = '';
                        mainOverlay.classList.remove('anim-in','anim-out');
                    }
                    document.querySelectorAll('.glass-box').forEach(el => el.classList.remove('anim-in'));

                    const loader = document.getElementById('loader');
                    if (loader) loader.style.display = 'none';

                    // Clear global interaction states
                    this.editingObjId = null;
                    if (this.isDrawingMode) this.setDrawTool('none');

                    // Reset scroll for modals that might have it
                    document.querySelectorAll('.glass-box').forEach(el => el.scrollTop = 0);
                } catch (err) {
                    console.warn('⚠ Error in closeAllModals:', err);
                }
            },

            setupInteractDraggables: function () {
                if (!window.interact || !this.interactEnabled) {
                    console.log('Interact.js not available or disabled');
                    return;
                }

                const self = this;

                // Configure Interact.js for all elements with class 'draggable' that are not locked
                // Elements are locked when field edit mode is OFF
                interact('.draggable:not(.locked)')
                    .draggable({
                        // Removed inertia - it causes elements to overshoot target position
                        inertia: false,
                        // Ignore interactions from resize/rotate handles and internal table resize handles
                        ignoreFrom: '.internal-resize-handle, .rotate-handle, .resize-handle',
                        modifiers: [
                            // Snap to grid when enabled
                            interact.modifiers.snap({
                                targets: [
                                    interact.snappers.grid({
                                        x: self.snapGridSize,
                                        y: self.snapGridSize
                                    })
                                ],
                                range: Infinity,
                                relativePoints: [{ x: 0, y: 0 }],
                                enabled: self.snapToGrid
                            }),
                            // Keep within parent container
                            interact.modifiers.restrict({
                                restriction: 'parent',
                                endOnly: false
                            })
                        ],
                        autoScroll: true,
                        listeners: {
                            start: function (event) {
                                event.target.classList.add('interact-dragging');
                                self._sgClear();
                                self._sgSnapped = { x: null, y: null };
                            },
                            move: function (event) {
                                const target = event.target;
                                const panelId = target.closest('[id^="overlay-layer"]')?.id.includes('secondary') ? 'secondary' : 'primary';
                                const scale = (self.splitView[panelId]?.scale) || self.currentScale || 1;

                                const currentX = parseFloat(target.getAttribute('data-x')) || (parseFloat(target.style.left) / scale) || 0;
                                const currentY = parseFloat(target.getAttribute('data-y')) || (parseFloat(target.style.top) / scale) || 0;

                                let x = currentX + event.dx / scale;
                                let y = currentY + event.dy / scale;

                                // ── SMART GUIDES ──────────────────────────────────────
                                if (self.smartGuidesEnabled) {
                                    const obj = self.getObjectById(target.id, panelId);
                                    if (obj) {
                                        const movingRect = {
                                            id: obj.id,
                                            x: x, y: y,
                                            width:  obj.width  || parseFloat(target.style.width)  / scale || 50,
                                            height: obj.height || parseFloat(target.style.height) / scale || 50,
                                        };
                                        const { snapX, snapY } = self._sgCompute(movingRect, panelId);
                                        x += snapX;
                                        y += snapY;
                                    }
                                }
                                // ─────────────────────────────────────────────────────

                                target.style.left = (x * scale) + 'px';
                                target.style.top  = (y * scale) + 'px';
                                target.setAttribute('data-x', x);
                                target.setAttribute('data-y', y);

                                // ── MULTI-SELECTION: move all other selected objects ──
                                if (self.multiObjectSelection.size > 1 && self.multiObjectSelection.has(target.id)) {
                                    // Use post-snap delta (actual displacement applied) instead of raw event.dx
                                    const appliedDx = x - currentX;
                                    const appliedDy = y - currentY;
                                    const overlayLayer = target.closest('[id^="overlay-layer"]');
                                    self.multiObjectSelection.forEach(id => {
                                        if (id === target.id) return;
                                        const peer = overlayLayer ? overlayLayer.querySelector('#' + id) : null;
                                        const peerObj = self.getObjectById(id, panelId);
                                        if (peerObj) {
                                            peerObj.x += appliedDx;
                                            peerObj.y += appliedDy;
                                            if (peer) {
                                                peer.style.left = (peerObj.x * scale) + 'px';
                                                peer.style.top  = (peerObj.y * scale) + 'px';
                                                peer.setAttribute('data-x', peerObj.x);
                                                peer.setAttribute('data-y', peerObj.y);
                                            }
                                        }
                                    });
                                }
                                // ── LIVE CONNECTOR UPDATE ─────────────────────────────
                                {
                                    const movingObj = self.getObjectById(target.id, panelId);
                                    if (movingObj) {
                                        // Temporarily update position so _connUpdateAnchored computes correctly
                                        const prevX = movingObj.x, prevY = movingObj.y;
                                        movingObj.x = x; movingObj.y = y;
                                        self._connUpdateAnchored(target.id);
                                        // Lightweight: update only SVG paths, no DOM rebuild
                                        const overlayLayer2 = target.closest('[id^="overlay-layer"]');
                                        if (overlayLayer2) self._connUpdatePaths(overlayLayer2, scale);
                                    }
                                }
                                // ─────────────────────────────────────────────────────
                            },
                            end: function (event) {
                                event.target.classList.remove('interact-dragging');
                                // Limpiar guías al soltar
                                self._sgClear();
                                self._sgSnapped = { x: null, y: null };

                                const panelId = event.target.closest('[id^="overlay-layer"]')?.id.includes('secondary') ? 'secondary' : 'primary';

                                // Commit position of dragged object
                                const objId = event.target.id;
                                const obj = self.getObjectById(objId, panelId);
                                if (obj) {
                                    obj.x = parseFloat(event.target.getAttribute('data-x')) || obj.x;
                                    obj.y = parseFloat(event.target.getAttribute('data-y')) || obj.y;
                                    // Update any connectors anchored to this object
                                    self._connUpdateAnchored(objId);
                                }

                                // Commit positions of all other multi-selected objects (already updated live in move)
                                // data-x/data-y on peers are already in sync — just ensure obj model matches
                                if (self.multiObjectSelection.size > 1) {
                                    const overlayLayer = event.target.closest('[id^="overlay-layer"]');
                                    const scale = (self.splitView[panelId]?.scale) || self.currentScale || 1;
                                    self.multiObjectSelection.forEach(id => {
                                        if (id === objId) return;
                                        const peer = overlayLayer ? overlayLayer.querySelector('#' + id) : null;
                                        const peerObj = self.getObjectById(id, panelId);
                                        if (peerObj && peer) {
                                            peerObj.x = parseFloat(peer.getAttribute('data-x')) || peerObj.x;
                                            peerObj.y = parseFloat(peer.getAttribute('data-y')) || peerObj.y;
                                        }
                                    });
                                }

                                self.saveState();
                            }
                        }
                    })
                    .resizable({
                        autoScroll: true,
                        invert: 'none', // Specificly recommended to avoid 'jumps' when crossing edges
                        // Enable resizing from all 8 handles with specific edge mapping
                        edges: {
                            left: '.rh-ml, .rh-tl, .rh-bl',
                            right: '.rh-mr, .rh-tr, .rh-br',
                            top: '.rh-tc, .rh-tl, .rh-tr',
                            bottom: '.rh-bc, .rh-bl, .rh-br'
                        },
                        listeners: {
                            move: function (event) {
                                const target = event.target;
                                const scale = self.currentScale || 1;

                                // Use Cached Parent Rect to avoid Layout Thrashing
                                // Guard: if resize:start never fired (e.g. interact re-init mid-drag), compute fallback
                                const parentRect = self._cachedParentRect || event.target.parentNode.getBoundingClientRect();

                                let w = event.rect.width;
                                let h = event.rect.height;
                                // STABLE ANCHOR: Use start coords for edges not being dragged to avoid jitter.
                                const sL = parseFloat(target.getAttribute('data-start-x')) * scale;
                                const sT = parseFloat(target.getAttribute('data-start-y')) * scale;
                                const sR = parseFloat(target.getAttribute('data-start-r')) * scale;
                                const sB = parseFloat(target.getAttribute('data-start-b')) * scale;

                                let l = event.edges.left ? (event.rect.left - parentRect.left) : sL;
                                let t = event.edges.top ? (event.rect.top - parentRect.top) : sT;

                                // ASPECT RATIO PRESERVATION: 
                                // If Shift is held OR it's a corner handle, force proportional
                                const isCorner = (event.edges.left && event.edges.top) || (event.edges.right && event.edges.top) || (event.edges.left && event.edges.bottom) || (event.edges.right && event.edges.bottom);

                                if (event.shiftKey || isCorner) {
                                    const type = target.getAttribute('data-type');
                                    // FIX: Text objects should NOT force aspect ratio on corners unless Shift is held.
                                    const isSmartPatch = target.id && target.id.startsWith('smart_patch_');

                                    // FIX: Smart Patches should NEVER force aspect ratio, even if logic thinks otherwise.
                                    // Text objects only preserve ratio with Shift.
                                    let shouldPreserveRatio = type === 'image' || (type === 'text' && event.shiftKey);

                                    if (isSmartPatch) shouldPreserveRatio = false;

                                    if (shouldPreserveRatio) {
                                        const startW = parseFloat(target.getAttribute('data-start-width')) || (w / scale);
                                        const startH = parseFloat(target.getAttribute('data-start-height')) || (h / scale);
                                        const ratio = startW / startH;

                                        // Clamp to minimum size to avoid calculation errors
                                        const minSize = 0.5 * scale;

                                        if (w / h > ratio) {
                                            w = Math.max(minSize, h * ratio);
                                            h = w / ratio;
                                        } else {
                                            h = Math.max(minSize, w / ratio);
                                            w = h * ratio;
                                        }

                                        // RE-CALCULATE L/T to keep fixed anchor steady
                                        if (event.edges.left) l = sR - w;
                                        if (event.edges.top) t = sB - h;
                                    }
                                }

                                // Apply values to DOM via requestAnimationFrame for max smoothness
                                requestAnimationFrame(() => {
                                    target.style.width = w + 'px';
                                    target.style.height = h + 'px';
                                    target.style.left = l + 'px';
                                    target.style.top = t + 'px';
                                });

                                // Store UNSCALED values for state
                                const x = l / scale;
                                const y = t / scale;
                                const newWidth = w / scale;
                                const newHeight = h / scale;

                                target.setAttribute('data-x', x);
                                target.setAttribute('data-y', y);
                                target.setAttribute('data-width', newWidth);
                                target.setAttribute('data-height', newHeight);

                                // LIVE FONT RESIZING: If auto-size is enabled, update font-size in real-time
                                // FIX: Disable for smart patches to prevent explosion
                                const isSmartPatch = target.id && target.id.startsWith('smart_patch_');
                                if (target.getAttribute('data-auto-size') === 'true' && !isSmartPatch) {
                                    const textSpan = target.querySelector('.text-content, .link-content');
                                    if (textSpan) {
                                        // Calculate font size proportional to height
                                        const fontSize = newHeight * 0.7;
                                        textSpan.style.fontSize = (fontSize * scale) + 'px';
                                        target.setAttribute('data-font-size', fontSize);
                                    }
                                }
                            },
                            start: function (event) {
                                // Add class to disable transitions
                                event.target.classList.add('interact-resizing');

                                const scale = self.currentScale || 1;
                                const pr = event.target.parentNode.getBoundingClientRect();
                                // Cache the parent rect to avoid layout thrashing in the move listener
                                self._cachedParentRect = pr;

                                // Record start coordinates (unscaled)
                                event.target.setAttribute('data-start-x', (event.rect.left - pr.left) / scale);
                                event.target.setAttribute('data-start-y', (event.rect.top - pr.top) / scale);
                                event.target.setAttribute('data-start-r', (event.rect.right - pr.left) / scale);
                                event.target.setAttribute('data-start-b', (event.rect.bottom - pr.top) / scale);

                                // Store starting dimensions
                                event.target.setAttribute('data-start-width', event.rect.width / scale);
                                event.target.setAttribute('data-start-height', event.rect.height / scale);
                            },
                            end: function (event) {
                                // Remove class
                                event.target.classList.remove('interact-resizing');

                                const scale = self.currentScale || 1;
                                // Update the object in the data model with UNSCALED values
                                const objId = event.target.id;
                                const panelId = event.target.closest('[id^="overlay-layer"]')?.id.includes('secondary') ? 'secondary' : 'primary';
                                const obj = self.getObjectById(objId, panelId);
                                if (obj) {
                                    const prevW = obj.width;
                                    const prevH = obj.height;

                                    // Read UNSCALED values from data attributes
                                    obj.x = parseFloat(event.target.getAttribute('data-x')) || obj.x;
                                    obj.y = parseFloat(event.target.getAttribute('data-y')) || obj.y;
                                    obj.width  = parseFloat(event.target.getAttribute('data-width'))  || obj.width;
                                    obj.height = parseFloat(event.target.getAttribute('data-height')) || obj.height;

                                    // FIX: Proportionally scale colWidths/rowHeights for tables
                                    // Interact.js only updates obj.width/height, leaving colWidths stale
                                    if (obj.type === 'table' && prevW > 0 && prevH > 0) {
                                        const wRatio = obj.width  / prevW;
                                        const hRatio = obj.height / prevH;
                                        if (obj.colWidths)  obj.colWidths  = obj.colWidths.map(w => w * wRatio);
                                        if (obj.rowHeights) obj.rowHeights = obj.rowHeights.map(h => h * hRatio);
                                    }

                                    // Persist UNSCALED Font Size if Auto-Size was active
                                    if (obj.autoSize) {
                                        obj.size = parseFloat(event.target.getAttribute('data-font-size')) || obj.size;
                                    }

                                    self.saveState();
                                }
                            }
                        },
                        modifiers: [
                            // Keep within parent container
                            interact.modifiers.restrict({
                                restriction: 'parent',
                                endOnly: true // ONLY restrict at the end to avoid "stiff" feeling during move
                            }),
                            /* Snap to grid disabled during resize for maximum smoothness
                            interact.modifiers.snap({
                                targets: [
                                    interact.snappers.grid({
                                        x: self.snapGridSize,
                                        y: self.snapGridSize
                                    })
                                ],
                                range: Infinity,
                                relativePoints: [{ x: 0, y: 0 }],
                                enabled: self.snapToGrid
                            }), */
                            // Minimum size - ultra-low to prevent any 'limit' feel
                            interact.modifiers.restrictSize({
                                min: { width: 0.1, height: 0.1 }
                            })
                        ]
                    });

                console.log('✨ Interact.js draggables initialized');
            },

            /**
             * Toggle snap-to-grid functionality
             */
            toggleSnapToGrid: function () {
                this.snapToGrid = !this.snapToGrid;
                this.showToast(this.snapToGrid ? '📐 Snap a cuadrícula: ON' : '📐 Snap a cuadrícula: OFF');
            },

            // ══════════════════════════════════════════════════════
            //  MODO LECTURA / LECTURA
            // ══════════════════════════════════════════════════════
            _readingMode: false,
            toggleReadingMode: function () {
                this._readingMode = !this._readingMode;
                const body = document.body;
                const btn  = document.getElementById('btn-reading-mode');

                body.classList.toggle('reading-mode', this._readingMode);

                const docTabs = document.getElementById('docTabsWrapper');
                const appHeader = document.querySelector('.app-header');
                const tabsContainer = document.querySelector('.tabs-container');

                if (this._readingMode) {
                    // Move docTabsWrapper into app-header
                    if (docTabs && appHeader && !docTabs.closest('.app-titlebar')) {
                        this._docTabsOriginalParent = docTabs.parentNode;
                        this._docTabsNextSibling = docTabs.nextSibling;
                        appHeader.appendChild(docTabs);
                    }
                    this._readingModeSidebarWidth =
                        document.getElementById('sidebarContainer')?.style.width || '';
                    if (btn) btn.onmouseout = null;
                    // Desactivar resaltado de campos en modo lectura
                    this._readingModeHighlightWasOn = this.isFieldHighlightMode;
                    if (this.isFieldHighlightMode) {
                        this.isFieldHighlightMode = false;
                        document.body.classList.remove('fields-highlighted');
                        const swH = document.getElementById('switch-highlight-fields');
                        if (swH) swH.checked = false;
                    }
                    // Sincronizar estado del botón de layout horizontal en modo lectura
                    const isH = document.body.classList.contains('h-layout');
                    const btnReadingH = document.getElementById('btn-reading-hlayout');
                    if (btnReadingH) {
                        btnReadingH.classList.toggle('active', isH);
                        btnReadingH.classList.toggle('active-view', isH);
                    }
                    localStorage.setItem('alioth_reading_mode', 'true');
                    this.showToast('📖 Modo Lectura activado');
                } else {
                    // Restore docTabsWrapper to original parent
                    if (docTabs && this._docTabsOriginalParent) {
                        this._docTabsOriginalParent.insertBefore(
                            docTabs, this._docTabsNextSibling || null
                        );
                    }
                    const sc = document.getElementById('sidebarContainer');
                    if (sc && this._readingModeSidebarWidth && !document.body.classList.contains('h-layout'))
                        sc.style.width = this._readingModeSidebarWidth;
                    if (btn) {
                        btn.onmouseout = () => {
                            btn.style.background = 'rgba(255,255,255,0.15)';
                        };
                    }
                    // Restaurar resaltado si estaba activo antes de modo lectura
                    if (this._readingModeHighlightWasOn) {
                        this.isFieldHighlightMode = true;
                        document.body.classList.add('fields-highlighted');
                        const swH = document.getElementById('switch-highlight-fields');
                        if (swH) swH.checked = true;
                    }
                    localStorage.removeItem('alioth_reading_mode');
                    this.showToast('✏️ Modo normal restaurado');
                }
                // Force re-render overlays and keep scale after layout shift
                setTimeout(() => this.renderOverlays(), 100);
                // Reposicionar widget TTS si está visible
                if (this._ttsVisible) setTimeout(() => this._ttsUpdatePosition(), 50);
            },

            toggleSmartGuides: function () {
                this.smartGuidesEnabled = !this.smartGuidesEnabled;
                this.snapToGuidesEnabled = this.smartGuidesEnabled;
                const btn = document.getElementById('toggleSmartGuides');
                if (btn) btn.classList.toggle('active', this.smartGuidesEnabled);
                if (!this.smartGuidesEnabled) this._sgClear();
                this.showToast(this.smartGuidesEnabled
                    ? '🧲 Guías inteligentes: ON'
                    : '🧲 Guías inteligentes: OFF');
            },

            // ══════════════════════════════════════════════════════════
            //  SMART GUIDES ENGINE
            // ══════════════════════════════════════════════════════════
            _sgContainer: null,   // overlay-layer reference
            _sgLines: [],         // DOM guide elements
            _sgLabels: [],        // DOM label elements

            /** Inicializa/reutiliza el contenedor de guías en el overlay */
            _sgInit: function (panelId) {
                const layerId = panelId === 'secondary' ? 'overlay-layer-secondary' : 'overlay-layer';
                this._sgContainer = document.getElementById(layerId);
            },

            /** Crea o reutiliza un elemento de guía */
            _sgMakeLine: function (type) {
                const el = document.createElement('div');
                el.className = 'smart-guide ' + type;
                this._sgContainer.appendChild(el);
                this._sgLines.push(el);
                return el;
            },

            _sgMakeLabel: function () {
                const el = document.createElement('div');
                el.className = 'smart-guide-label';
                this._sgContainer.appendChild(el);
                this._sgLabels.push(el);
                return el;
            },

            /** Elimina todas las guías del DOM */
            _sgClear: function () {
                this._sgLines.forEach(el => el.remove());
                this._sgLabels.forEach(el => el.remove());
                this._sgLines = [];
                this._sgLabels = [];
            },

            /**
             * Calcula guías y snap para un objeto que se está moviendo.
             * @param {object} movingObj  - el objeto que se arrastra {x,y,width,height}
             * @param {string} panelId
             * @returns {object} {snapX, snapY} — deltas de corrección (0 si no hay snap)
             */
            _sgCompute: function (movingObj, panelId) {
                if (!this.smartGuidesEnabled) return { snapX: 0, snapY: 0 };

                const doc = this.getDoc();
                if (!doc || !doc.pages.length) return { snapX: 0, snapY: 0 };

                this._sgInit(panelId);
                this._sgClear();

                const scale    = (this.splitView[panelId]?.scale) || this.currentScale || 1;
                const thresh   = this.snapThreshold;  // unscaled pixels
                const page     = doc.pages[doc.currentIndex];

                // Dimensiones de la página del canvas
                const container = this._sgContainer;
                const pageW = container.offsetWidth  / scale;
                const pageH = container.offsetHeight / scale;

                // Bordes y centros del objeto en movimiento
                const mL = movingObj.x;
                const mT = movingObj.y;
                const mR = movingObj.x + movingObj.width;
                const mB = movingObj.y + movingObj.height;
                const mCX = movingObj.x + movingObj.width  / 2;
                const mCY = movingObj.y + movingObj.height / 2;

                // ── Líneas de referencia: página ──
                const pageAnchors = {
                    v: [0, pageW / 2, pageW],          // izquierda, centro, derecha
                    h: [0, pageH / 2, pageH],           // arriba, centro, abajo
                };

                // ── Líneas de referencia: otros objetos ──
                const otherObjs = (page.objects || []).filter(o =>
                    o.id !== movingObj.id && o.x !== undefined
                );

                const vAnchors = [...pageAnchors.v]; // X positions
                const hAnchors = [...pageAnchors.h]; // Y positions

                otherObjs.forEach(o => {
                    vAnchors.push(o.x, o.x + o.width / 2, o.x + o.width);
                    hAnchors.push(o.y, o.y + o.height / 2, o.y + o.height);
                    // Table: add internal column and row lines as SmartGuide anchors
                    if (o.type === 'table' && o.colWidths && o.rowHeights) {
                        const sumCW = o.colWidths.reduce((a, b) => a + b, 0);
                        const sumRH = o.rowHeights.reduce((a, b) => a + b, 0);
                        let cx = o.x;
                        for (let ci = 0; ci < o.colWidths.length - 1; ci++) {
                            cx += o.colWidths[ci] * (sumCW > 0 ? o.width / sumCW : 1);
                            vAnchors.push(cx);
                        }
                        let ry = o.y;
                        for (let ri = 0; ri < o.rowHeights.length - 1; ri++) {
                            ry += o.rowHeights[ri] * (sumRH > 0 ? o.height / sumRH : 1);
                            hAnchors.push(ry);
                        }
                    }
                });

                let snapX = 0, snapY = 0;
                const activeV = []; // guías verticales a mostrar {pos, isSnapped}
                const activeH = []; // guías horizontales

                // Histéresis: zona de captura pequeña, zona de liberación 2x mayor
                const RELEASE = thresh * 2;
                if (!this._sgSnapped) this._sgSnapped = { x: null, y: null };

                // ── Comprobar snap horizontal (X) ──
                const mEdgesX = [
                    { val: mL,  label: 'L' },
                    { val: mCX, label: 'C' },
                    { val: mR,  label: 'R' },
                ];
                {
                    let bestDX = Infinity, bestSnapX = 0, bestAnchorX = null;
                    mEdgesX.forEach(edge => {
                        vAnchors.forEach(anchor => {
                            const d = Math.abs(edge.val - anchor);
                            if (d < thresh && d < Math.abs(bestDX)) {
                                bestDX = edge.val - anchor;
                                bestSnapX = -bestDX;
                                bestAnchorX = anchor;
                                activeV.push({ pos: anchor, snapped: true });
                            } else if (d < thresh * 3) {
                                activeV.push({ pos: anchor, snapped: false });
                            }
                        });
                    });
                    if (this.snapToGuidesEnabled) {
                        if (this._sgSnapped.x !== null) {
                            // Verificar si sigue dentro de la zona de liberación del ancla previa
                            const distFromPrev = Math.min(...mEdgesX.map(e => Math.abs(e.val - this._sgSnapped.x)));
                            if (distFromPrev < RELEASE) {
                                // Mantener snap al ancla previa
                                const closest = mEdgesX.reduce((best, e) =>
                                    Math.abs(e.val - this._sgSnapped.x) < Math.abs(best.val - this._sgSnapped.x) ? e : best);
                                snapX = this._sgSnapped.x - closest.val;
                            } else {
                                // Liberar ancla previa; capturar nueva si la hay
                                this._sgSnapped.x = bestAnchorX;
                                snapX = bestSnapX;
                            }
                        } else {
                            this._sgSnapped.x = bestAnchorX;
                            snapX = bestSnapX;
                        }
                    }
                }

                // ── Comprobar snap vertical (Y) ──
                const mEdgesY = [
                    { val: mT,  label: 'T' },
                    { val: mCY, label: 'C' },
                    { val: mB,  label: 'B' },
                ];
                {
                    let bestDY = Infinity, bestSnapY = 0, bestAnchorY = null;
                    mEdgesY.forEach(edge => {
                        hAnchors.forEach(anchor => {
                            const d = Math.abs(edge.val - anchor);
                            if (d < thresh && d < Math.abs(bestDY)) {
                                bestDY = edge.val - anchor;
                                bestSnapY = -bestDY;
                                bestAnchorY = anchor;
                                activeH.push({ pos: anchor, snapped: true });
                            } else if (d < thresh * 3) {
                                activeH.push({ pos: anchor, snapped: false });
                            }
                        });
                    });
                    if (this.snapToGuidesEnabled) {
                        if (this._sgSnapped.y !== null) {
                            const distFromPrev = Math.min(...mEdgesY.map(e => Math.abs(e.val - this._sgSnapped.y)));
                            if (distFromPrev < RELEASE) {
                                const closest = mEdgesY.reduce((best, e) =>
                                    Math.abs(e.val - this._sgSnapped.y) < Math.abs(best.val - this._sgSnapped.y) ? e : best);
                                snapY = this._sgSnapped.y - closest.val;
                            } else {
                                this._sgSnapped.y = bestAnchorY;
                                snapY = bestSnapY;
                            }
                        } else {
                            this._sgSnapped.y = bestAnchorY;
                            snapY = bestSnapY;
                        }
                    }
                }

                // ── Dibujar guías visibles ──
                // Deduplicar
                const uniqV = [...new Map(activeV.map(g => [Math.round(g.pos), g])).values()];
                const uniqH = [...new Map(activeH.map(g => [Math.round(g.pos), g])).values()];

                uniqV.forEach(g => {
                    const el = this._sgMakeLine('vertical');
                    el.style.left = (g.pos * scale) + 'px';
                    el.style.opacity = g.snapped ? '1' : '0.35';
                    el.classList.toggle('visible', true);
                });

                uniqH.forEach(g => {
                    const el = this._sgMakeLine('horizontal');
                    el.style.top = (g.pos * scale) + 'px';
                    el.style.opacity = g.snapped ? '1' : '0.35';
                    el.classList.toggle('visible', true);
                });

                return { snapX, snapY };
            },

            /**
             * Initializes Lucide icons throughout the interface
             */
            showHighlightModal: function () {
                this.closeAllModals();
                const modal = document.getElementById('highlight-color-modal');
                const overlay = document.getElementById('modal-overlay');
                if (modal && overlay) {
                    overlay.style.display = 'flex';
                    modal.style.display = 'block';
                }
            },

            /**
             * Sets the highlight color and triggers highlighting or enters highlight mode
             * @param {string} color Hex color string
             */
            setHighlightColor: function (color) {
                this.closeAllModals();
                this.pendingHighlightColor = color;

                // Ensure we are in text selection mode
                if (!this.isTextSelectMode) {
                    this.toggleTextSelectMode();
                }

                this.showToast('🖍️ Auto-resaltado activado. Selecciona texto para resaltar.');
            },

            /**
             * Applies highlight to the current text selection
             * @param {string} color Hex color string
             */
            highlightSelection: function (color) {
                const selection = window.getSelection();
                if (selection.rangeCount === 0 || selection.toString().trim().length === 0) return;

                this.saveState();
                const doc = this.getDoc();
                if (!doc) return;

                const pageIdx = doc.currentIndex;
                const page = doc.pages[pageIdx];
                if (!page) return;

                const range = selection.getRangeAt(0);
                const rects = range.getClientRects();
                const scale = this.currentScale;

                const container = document.getElementById('canvas-container');
                if (!container) return;
                const containerRect = container.getBoundingClientRect();

                let count = 0;
                for (let i = 0; i < rects.length; i++) {
                    const r = rects[i];
                    if (r.width < 1 || r.height < 1) continue;

                    // Convert screen to PDF coordinates
                    // Coords must be relative to the page content origin in our app's internal coordinate system
                    // Use app's robust coordinate conversion
                    const tl = this.getClientToPDFCoords(r.left, r.top, pageIdx);
                    const br = this.getClientToPDFCoords(r.right, r.bottom, pageIdx);

                    const x = tl.x;
                    const y = tl.y;
                    const w = br.x - tl.x;
                    const h = br.y - tl.y;

                    // Create a horizontal line stroke that covers the text height
                    const path = [
                        { x: x, y: y + h / 2 },
                        { x: x + w, y: y + h / 2 }
                    ];

                    page.objects.push({
                        type: 'drawing',
                        path: path,
                        color: color,
                        width: h,
                        isHighlighter: true
                    });
                    count++;
                }

                if (count > 0) {
                    this.redrawDrawings();
                    this.renderSidebar();
                    this.showToast('✨ ' + count + ' líneas resaltadas');
                    selection.removeAllRanges();

                    // Auto-save
                    if (this.db) this.saveSession();
                }
            },

            /**
             * Toggles text selection mode for selecting text from the PDF
             * When active, the annotation layer becomes interactive and overlay layer is dimmed
             */
            toggleTextSelectMode: function () {
                this.isTextSelectMode = !this.isTextSelectMode;
                const btn = document.getElementById('btn-text-select');
                const overlayLayer = document.getElementById('overlay-layer');
                const textLayers = document.querySelectorAll('.text-layer');

                // Global MouseUp Handler for Auto-Highlight
                if (!this._boundMouseUpHandler) {
                    this._boundMouseUpHandler = ((e) => {
                        if (this.isTextSelectMode && this.pendingHighlightColor) {
                            setTimeout(() => {
                                const selection = window.getSelection();
                                if (selection.rangeCount > 0 && selection.toString().trim().length > 0) {
                                    this.highlightSelection(this.pendingHighlightColor);
                                }
                            }, 50);
                        }
                    }).bind(this);
                }

                // Global Copy Handler for Text Mode (Ctrl+C Support)
                if (!this._boundCopyHandler) {
                    this._boundCopyHandler = ((e) => {
                        console.log('[GlobalCopy] Event Triggered');
                        if (this.isTextSelectMode) {
                            const selection = window.getSelection();
                            console.log('[GlobalCopy] Selection Range:', selection.rangeCount);

                            if (selection.rangeCount > 0) {
                                e.preventDefault();
                                const { html, text } = this.processRichCopy(selection);
                                if (html) {
                                    e.clipboardData.setData('text/html', html);
                                    e.clipboardData.setData('text/plain', text);
                                    this.showToast('Texto copiado (Ctrl+C)');
                                }
                            }
                        }
                    }).bind(this);
                }

                // Context Menu Handler for Text Mode
                if (!this._boundContextMenuHandler) {
                    this._boundContextMenuHandler = ((e) => {
                        if (!this.isTextSelectMode) return;

                        // Only trigger if we have a selection
                        const selection = window.getSelection();
                        if (selection.rangeCount === 0 || selection.toString().length === 0) return;

                        e.preventDefault();

                        // ============================================================
                        // PRE-CAPTURE: Capture ALL data NOW, before menu click clears it
                        // ============================================================
                        const range = selection.getRangeAt(0);
                        const capturedText = selection.toString();
                        const capturedRect = range.getBoundingClientRect();
                        const capturedClone = range.cloneContents();

                        // Pre-compute optical color sampling
                        let capturedColor = '#000000';
                        try {
                            let anchor = range.startContainer;
                            if (anchor && anchor.nodeType === 3) anchor = anchor.parentElement;
                            let pageEl = anchor ? anchor.closest('.page') : null;
                            let canvas = pageEl ? pageEl.querySelector('canvas') : null;

                            // Geometric fallback for canvas
                            if (!canvas) {
                                const canvases = document.querySelectorAll('canvas');
                                const centerX = capturedRect.left + capturedRect.width / 2;
                                const centerY = capturedRect.top + capturedRect.height / 2;
                                for (const c of canvases) {
                                    const cRect = c.getBoundingClientRect();
                                    if (centerX >= cRect.left && centerX <= cRect.right &&
                                        centerY >= cRect.top && centerY <= cRect.bottom) {
                                        canvas = c;
                                        break;
                                    }
                                }
                            }

                            if (canvas && capturedRect.width > 0 && capturedRect.height > 0) {
                                const canvasRect = canvas.getBoundingClientRect();
                                const scaleX = canvas.width / canvasRect.width;
                                const scaleY = canvas.height / canvasRect.height;
                                const startX = Math.floor((capturedRect.left - canvasRect.left) * scaleX);
                                const startY = Math.floor((capturedRect.top - canvasRect.top) * scaleY);
                                const width = Math.floor(capturedRect.width * scaleX);
                                const height = Math.floor(capturedRect.height * scaleY);

                                if (width > 0 && height > 0) {
                                    const ctx = canvas.getContext('2d');
                                    const imgData = ctx.getImageData(startX, startY, width, height).data;
                                    const colorCounts = {};
                                    let maxCount = 0, bestColor = null;
                                    for (let i = 0; i < imgData.length; i += 16) {
                                        const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2], a = imgData[i + 3];
                                        if (a > 100 && !(r > 200 && g > 200 && b > 200)) {
                                            const key = `${r},${g},${b} `;
                                            colorCounts[key] = (colorCounts[key] || 0) + 1;
                                            if (colorCounts[key] > maxCount) { maxCount = colorCounts[key]; bestColor = key; }
                                        }
                                    }
                                    if (bestColor) {
                                        const [r, g, b] = bestColor.split(',').map(Number);
                                        capturedColor = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                                    }
                                }
                            }
                        } catch (err) { console.warn('[CtxMenu] Color pre-capture failed', err); }

                        console.log('[CtxMenu] Pre-captured:', { text: capturedText.substring(0, 30), color: capturedColor, spans: capturedClone.querySelectorAll('span').length });

                        // ============================================================
                        // BUILD MENU — delegate to shared helper
                        // ============================================================
                        this._showTextContextMenu(e, capturedText);
                    }).bind(this);
                }

                if (this.isTextSelectMode) {
                    // Enable text selection mode
                    btn?.classList.add('active');
                    document.body.classList.add('text-select-mode');
                    document.addEventListener('copy', this._boundCopyHandler);
                    document.addEventListener('contextmenu', this._boundContextMenuHandler); // Attach Context Menu
                    document.addEventListener('mouseup', this._boundMouseUpHandler); // Attach MouseUp for Auto-Highlight
                    console.log('[GlobalCopy] Listeners Attached');

                    // Show and enable all text layers
                    textLayers.forEach(layer => {
                        layer.style.pointerEvents = 'auto';
                        layer.style.zIndex = '10005';
                        layer.style.display = 'block';
                    });

                    // Hide overlay layer to prevent interference
                    if (overlayLayer) {
                        overlayLayer.style.pointerEvents = 'none';
                        overlayLayer.style.opacity = '0.3';
                    }

                    // Disable other modes
                    this.isHandMode = false;
                    document.body.classList.remove('hand-mode');
                    document.getElementById('btn-hand')?.classList.remove('active');

                    this.showToast('📝 Modo selección de texto activado');
                } else {
                    // Disable text selection mode
                    btn?.classList.remove('active');
                    document.body.classList.remove('text-select-mode');
                    document.removeEventListener('copy', this._boundCopyHandler);
                    document.removeEventListener('contextmenu', this._boundContextMenuHandler); // Detach Context Menu
                    document.removeEventListener('mouseup', this._boundMouseUpHandler); // Detach MouseUp

                    // Hide and disable all text layers
                    textLayers.forEach(layer => {
                        layer.style.pointerEvents = 'none';
                        layer.style.zIndex = '';
                        layer.style.display = 'none';
                    });

                    // Restore overlay layer
                    if (overlayLayer) {
                        overlayLayer.style.pointerEvents = 'auto';
                        overlayLayer.style.opacity = '1';
                    }

                    this.pendingHighlightColor = null; // Reset pending color when manually disabling
                    this.showToast('📝 Modo selección de texto desactivado');
                }
            },

            processRichCopy: function (selectionOrRange) {
                if (!selectionOrRange) return { html: null, text: '' };

                let text = selectionOrRange.toString();
                if (!text) return { html: null, text: '' };

                let range;
                if (selectionOrRange instanceof Selection) {
                    if (selectionOrRange.rangeCount === 0) return { html: null, text: '' };
                    range = selectionOrRange.getRangeAt(0);
                } else {
                    range = selectionOrRange;
                }

                let htmlToCopy = '';

                try {
                    // 1. OPTICAL COLOR SAMPLING (Grid Histogram Strategy)
                    let globalSampledColor = '#000000'; // Default Black
                    const rect = range.getBoundingClientRect();

                    try {
                        let anchor = range.startContainer;
                        if (anchor && anchor.nodeType === 3) anchor = anchor.parentElement;
                        let pageEl = anchor ? anchor.closest('.page') : null;

                        let canvas = null;
                        if (pageEl) {
                            canvas = pageEl.querySelector('canvas');
                        }

                        // FALLBACK: Geometric Canvas Discovery
                        if (!canvas) {
                            const canvases = document.querySelectorAll('canvas');
                            const centerX = rect.left + rect.width / 2;
                            const centerY = rect.top + rect.height / 2;

                            for (const c of canvases) {
                                const cRect = c.getBoundingClientRect();
                                if (centerX >= cRect.left && centerX <= cRect.right &&
                                    centerY >= cRect.top && centerY <= cRect.bottom) {
                                    canvas = c;
                                    break;
                                }
                            }
                        }

                        if (canvas && rect.width > 0 && rect.height > 0) {
                            const canvasRect = canvas.getBoundingClientRect();
                            const scaleX = canvas.width / canvasRect.width;
                            const scaleY = canvas.height / canvasRect.height;

                            const startX = Math.floor((rect.left - canvasRect.left) * scaleX);
                            const startY = Math.floor((rect.top - canvasRect.top) * scaleY);
                            const width = Math.floor(rect.width * scaleX);
                            const height = Math.floor(rect.height * scaleY);

                            if (width > 0 && height > 0 && startX >= 0 && startY >= 0) {
                                const ctx = canvas.getContext('2d');
                                const imgData = ctx.getImageData(startX, startY, width, height).data;

                                const colorCounts = {};
                                let maxCount = 0;
                                let bestColor = null;

                                // Sample every Nth pixel for performance
                                const sampleRate = 4;
                                for (let i = 0; i < imgData.length; i += 4 * sampleRate) {
                                    const r = imgData[i];
                                    const g = imgData[i + 1];
                                    const b = imgData[i + 2];
                                    const a = imgData[i + 3];

                                    // Ignore transparent & near-white background
                                    if (a > 100 && !(r > 200 && g > 200 && b > 200)) {
                                        const key = `${r},${g},${b} `;
                                        colorCounts[key] = (colorCounts[key] || 0) + 1;

                                        if (colorCounts[key] > maxCount) {
                                            maxCount = colorCounts[key];
                                            bestColor = key;
                                        }
                                    }
                                }

                                if (bestColor) {
                                    const [r, g, b] = bestColor.split(',').map(Number);
                                    globalSampledColor = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Optical sampling failed', e);
                    }

                    // 2. CLONE SELECTION AND PROCESS SPANS
                    const cloned = range.cloneContents();
                    const div = document.createElement('div');
                    div.appendChild(cloned);

                    // Add to DOM temporarily to get computed styles
                    div.style.cssText = 'position: absolute; left: -9999px; top: 0; visibility: hidden;';
                    document.body.appendChild(div);

                    const spans = div.querySelectorAll('span');

                    if (spans.length > 0) {
                        spans.forEach(s => {
                            // Read font metadata from data attributes (set during renderTextLayer)
                            const fontName = s.dataset.fontName || '';
                            const isBold = s.dataset.isBold === 'true';
                            const isItalic = s.dataset.isItalic === 'true';

                            // Use fontRecognition to get proper CSS font-family
                            let fontFamily = 'Arial, sans-serif';
                            let finalIsBold = isBold;
                            let finalIsItalic = isItalic;

                            if (fontName && this.fontRecognition) {
                                const fontInfo = this.fontRecognition.analyzeFontName(fontName);
                                fontFamily = this.fontRecognition.getCSSFontFamily(fontInfo);
                                finalIsBold = fontInfo.isBold || isBold;
                                finalIsItalic = fontInfo.isItalic || isItalic;
                            } else {
                                // Fallback: read from computed styles
                                const computed = window.getComputedStyle(s);
                                fontFamily = computed.fontFamily || fontFamily;
                                finalIsBold = finalIsBold || computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 700;
                                finalIsItalic = finalIsItalic || computed.fontStyle === 'italic';
                            }

                            // Get font size from computed style or dataset (PDf points)
                            const computed = window.getComputedStyle(s);
                            let fontSize = computed.fontSize;

                            // 1. Prefer original PDF size (points) if available
                            if (s.dataset.originalSize) {
                                fontSize = s.dataset.originalSize + 'pt';
                            }
                            // 2. Fallback: Check for transform scaling issues
                            else {
                                const transform = computed.transform;
                                if (transform && transform !== 'none') {
                                    const matrix = transform.match(/matrix\(([^)]+)\)/);
                                    if (matrix && matrix[1]) {
                                        const values = matrix[1].split(',').map(parseFloat);
                                        if (values.length >= 4) {
                                            const scaleY = Math.abs(values[3]);
                                            const currentSize = parseFloat(fontSize) || 1;
                                            if (currentSize < 5 && scaleY > 1) {
                                                fontSize = Math.round(scaleY) + 'px';
                                            }
                                        }
                                    }
                                }
                            }

                            // Construct style string
                            let styleStr = `color: ${globalSampledColor}; `;
                            styleStr += `font-family: ${fontFamily}; `;
                            styleStr += `font-size: ${fontSize}; `;

                            // Semantic wrapping for better compatibility (Word/Office prefers tags over CSS)
                            // We still keep CSS for browsers
                            if (finalIsBold) styleStr += ' font-weight: bold;';
                            if (finalIsItalic) styleStr += ' font-style: italic;';

                            s.style.cssText = styleStr;

                            // Compatibility WRAPPER: Wrap in <b> and <i> tags
                            // This forces external apps to recognize the style
                            try {
                                let target = s;
                                if (finalIsBold) {
                                    const b = document.createElement('b');
                                    if (target.parentNode) {
                                        target.parentNode.insertBefore(b, target);
                                        b.appendChild(target);
                                    }
                                }
                                if (finalIsItalic) {
                                    const i = document.createElement('i');
                                    if (target.parentNode) {
                                        target.parentNode.insertBefore(i, target);
                                        i.appendChild(target);
                                    }
                                }
                            } catch (e) { console.warn('Wrapping error', e); }
                        });
                        htmlToCopy = div.innerHTML;
                    } else {
                        // Plain text fallback with inline CSS
                        const fontSize = Math.max(12, Math.round((rect?.height || 16) * 0.75));
                        htmlToCopy = `<span style="color: ${globalSampledColor}; font-family: Arial, sans-serif; font-size: ${fontSize}px;">${text}</span>`;
                    }

                    // Cleanup: Remove temp div from DOM
                    if (div.parentNode) {
                        document.body.removeChild(div);
                    }
                } catch (e) {
                    console.error('Rich Copy Processing Failed', e);
                    // Return plain text fallback
                    htmlToCopy = `< span style = "color: #000000; font-family: Arial, sans-serif;" > ${text}</span > `;
                }

                return { html: htmlToCopy || text, text: text };
            },


            toggleTheme: function () {
                document.body.classList.toggle('dark-mode');
                const isDark = document.body.classList.contains('dark-mode');
                localStorage.setItem('alioth_theme', isDark ? 'dark' : 'light');
                const sunSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-sun"><circle cx="12" cy="12" r="4" fill="#fbbf24" fill-opacity="0.3" stroke="#f59e0b"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
                const moonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#818cf8" fill-opacity="0.25" stroke="#818cf8"/></svg>';
                const iconHtml = isDark ? moonSvg : sunSvg;
                const darkToggle = document.getElementById('darkToggle');
                if (darkToggle) darkToggle.innerHTML = iconHtml;
                const readingThemeBtn = document.getElementById('btn-reading-theme');
                if (readingThemeBtn) readingThemeBtn.innerHTML = iconHtml;

                if (this._syncToggleUI) {
                    this._syncToggleUI('toggleDarkModeModal', isDark);
                }

                // Repintar el tema actual si existe uno seleccionado
                const last = localStorage.getItem('alioth_last_preset');
                if (last && this.applyThemePreset) {
                    this.applyThemePreset(last);
                } else if (this._syncRibbonTheme) {
                    this._syncRibbonTheme();
                }

                if (this._syncModalColorPickers) {
                    this._syncModalColorPickers();
                }
            },

            switchRibbon: function (t) {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('tab-btn-' + t).classList.add('active');
                document.querySelectorAll('.toolbar-area').forEach(x => x.classList.remove('active'));
                const tb = document.getElementById('toolbar-' + t);
                if (tb) tb.classList.add('active');
                this._currentRibbonTab = t;

                if (t !== 'draw') {
                    this.isDrawingMode = false;
                    document.body.classList.remove('drawing-mode');
                    this.setDrawTool('none');
                }

                // Exit form mode if not in form tab (optional, depends on UX)
                // For now we just reset the tool selection
                if (t !== 'form') {
                    this.setFormTool('none');
                }

                // Actualizar labels si el ribbon está colapsado
                if (this.ribbonCollapsed) {
                    this.updateCollapsedLabels();
                    document.getElementById('ribbonHoverPopup').classList.remove('visible');
                }
            },

            toggleHandMode: function () {
                this.isHandMode = !this.isHandMode;
                document.body.classList.toggle('hand-mode', this.isHandMode);
                const btn = document.getElementById('btn-hand');
                const toggleBtn = document.getElementById('toggleHand');
                if (this.isHandMode) {
                    btn.classList.add('active');
                    if (toggleBtn) toggleBtn.classList.add('active');
                    this.selectedObj = null;
                    this.multiObjectSelection.clear();
                    this.pendingHighlightColor = null; // Clear pending highlight
                    this.renderOverlays();
                } else {
                    btn.classList.remove('active');
                    if (toggleBtn) toggleBtn.classList.remove('active');
                    // Forzar reset del cursor al desactivar la mano
                    const mainView = document.querySelector('.main-view');
                    const canvasContainer = document.querySelector('.canvas-container');
                    if (mainView) mainView.style.cursor = '';
                    if (canvasContainer) canvasContainer.style.cursor = '';
                    document.querySelectorAll('.canvas-container').forEach(el => el.style.cursor = '');
                }
            },

            toggleBoxSelectMode: function () {
                this.isBoxSelectMode = !this.isBoxSelectMode;
                const btn = document.getElementById('btn-box-select');
                if (this.isBoxSelectMode) {
                    // Desactivar modos incompatibles
                    if (this.isHandMode) this.toggleHandMode();
                    if (btn) btn.classList.add('active');
                    // Cursor crosshair en todos los canvas-container
                    document.querySelectorAll('.canvas-container').forEach(el => el.style.cursor = 'crosshair');
                    this.showToast('Arrastra para seleccionar objetos. ESC para cancelar.');
                    // Listener ESC para cancelar
                    this._boxSelectEscHandler = (e) => { if (e.key === 'Escape') this.toggleBoxSelectMode(); };
                    document.addEventListener('keydown', this._boxSelectEscHandler);
                    this._setupBoxSelectDrag();
                } else {
                    if (btn) btn.classList.remove('active');
                    document.querySelectorAll('.canvas-container').forEach(el => el.style.cursor = '');
                    if (this._boxSelectEscHandler) {
                        document.removeEventListener('keydown', this._boxSelectEscHandler);
                        this._boxSelectEscHandler = null;
                    }
                    if (this._boxSelectCleanup) {
                        this._boxSelectCleanup();
                        this._boxSelectCleanup = null;
                    }
                    // Limpiar overlay de selección si quedó visible
                    const sel = document.getElementById('box-select-rect');
                    if (sel) sel.remove();
                    if (this.isFieldEditMode) this._setupBoxSelectDrag();
                }
            },

            _setupBoxSelectDrag: function () {
                const self = this;

                if (this._boxSelectCleanup) {
                    this._boxSelectCleanup();
                    this._boxSelectCleanup = null;
                }

                // Usamos la overlay-layer del panel activo como superficie de eventos
                const getOverlay = (panelId = self.splitView.activePanel || 'primary') => {
                    return panelId === 'secondary'
                        ? document.getElementById('overlay-layer-secondary')
                        : document.getElementById('overlay-layer');
                };

                // Crear o reusar el rectángulo de selección visual
                const getSelRect = (overlay) => {
                    let el = document.getElementById('box-select-rect');
                    if (!el) {
                        el = document.createElement('div');
                        el.id = 'box-select-rect';
                        el.className = 'box-select-rect';
                    }
                    overlay.appendChild(el);
                    return el;
                };

                let gesture = null;
                let _suppressNextClick = false;

                // Suprimir el click que el browser dispara tras el mouseup del drag
                const onClickCapture = (e) => {
                    if (_suppressNextClick) {
                        _suppressNextClick = false;
                        e.stopPropagation();
                        e.preventDefault();
                    }
                };
                document.addEventListener('click', onClickCapture, true);

                // Guardar este listener en cleanup
                const _removeClickSuppressor = () => document.removeEventListener('click', onClickCapture, true);

                const restorePreviousSelection = () => {
                    if (!gesture) return;
                    self.multiObjectSelection = new Set(gesture.previousIds);
                    self.selectedObj = gesture.previousSelected && self.multiObjectSelection.has(gesture.previousSelected.id)
                        ? gesture.previousSelected
                        : null;
                };

                const finishGesture = (restore = false) => {
                    if (!gesture) return;
                    if (restore) restorePreviousSelection();
                    const selRect = document.getElementById('box-select-rect');
                    if (selRect) selRect.remove();
                    gesture.overlay.releasePointerCapture?.(gesture.pointerId);
                    gesture = null;
                };

                const onPointerDown = (e) => {
                    if (!self.isBoxSelectMode && !self.isFieldEditMode) return;
                    // Solo botón izquierdo, solo sobre overlay-layer
                    if (e.button !== 0) return;
                    const panelId = self.splitView.activePanel || 'primary';
                    const overlay = getOverlay(panelId);
                    if (!overlay) return;
                    // Verificar que el click es sobre el canvas (no sobre un draggable)
                    if (e.target.closest('.draggable')) return;
                    if (!e.target.closest('[id^="overlay-layer"]') && !e.target.closest('.canvas-container')) return;

                    const panelState = self.splitView[panelId] || {};
                    const docId = panelState.docId || self.activeDocId;
                    const doc = self.docs.find(item => item.id === docId);
                    const pageIndex = Number.isInteger(panelState.pageIndex) ? panelState.pageIndex : doc?.currentIndex;
                    const page = doc?.pages?.[pageIndex];
                    if (!page) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const rect = overlay.getBoundingClientRect();
                    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    gesture = {
                        pointerId: e.pointerId,
                        panelId,
                        page,
                        scale: panelState.scale || self.currentScale || 1,
                        overlay,
                        overlayRect: rect,
                        start,
                        current: start,
                        startClient: { x: e.clientX, y: e.clientY },
                        currentClient: { x: e.clientX, y: e.clientY },
                        append: !!e.shiftKey,
                        fieldOnly: self.isFieldEditMode && !self.isBoxSelectMode,
                        confirmed: false,
                        previousIds: new Set(self.multiObjectSelection || []),
                        previousSelected: self.selectedObj || null
                    };
                    overlay.setPointerCapture?.(e.pointerId);
                };

                const onPointerMove = (e) => {
                    if (!gesture || e.pointerId !== gesture.pointerId) return;
                    gesture.current = {
                        x: e.clientX - gesture.overlayRect.left,
                        y: e.clientY - gesture.overlayRect.top
                    };
                    gesture.currentClient = { x: e.clientX, y: e.clientY };
                    if (!self.isMarqueeDrag(gesture.start, gesture.current)) return;
                    gesture.confirmed = true;
                    const selRect = getSelRect(gesture.overlay);
                    const x = Math.min(gesture.current.x, gesture.start.x);
                    const y = Math.min(gesture.current.y, gesture.start.y);
                    const w = Math.abs(gesture.current.x - gesture.start.x);
                    const h = Math.abs(gesture.current.y - gesture.start.y);

                    selRect.style.left   = x + 'px';
                    selRect.style.top    = y + 'px';
                    selRect.style.width  = w + 'px';
                    selRect.style.height = h + 'px';
                    selRect.style.display = 'block';
                };

                const onPointerUp = (e) => {
                    if (!gesture || e.pointerId !== gesture.pointerId) return;
                    if (!gesture.confirmed) {
                        finishGesture(true);
                        return;
                    }

                    const activeGesture = gesture;
                    const elementRects = new Map(
                        Array.from(activeGesture.overlay.querySelectorAll?.('.draggable') || [])
                            .map(element => [element.id, element.getBoundingClientRect()])
                    );
                    const usesViewportRects = elementRects.size > 0;
                    const selectionRect = self.normalizeMarqueeRect(
                        usesViewportRects ? activeGesture.startClient : activeGesture.start,
                        usesViewportRects ? activeGesture.currentClient : activeGesture.current,
                        usesViewportRects ? 1 : activeGesture.scale
                    );
                    let count;
                    if (activeGesture.fieldOnly) {
                        count = self.applyFormFieldMarqueeSelection(activeGesture.page, selectionRect, {
                            append: activeGesture.append,
                            elementRects: usesViewportRects ? elementRects : undefined
                        });
                    } else {
                        if (!activeGesture.append) {
                            self.multiObjectSelection.clear();
                            self.selectedObj = null;
                        }
                        (activeGesture.page.objects || []).forEach(object => {
                            if (object.type === 'drawing') return;
                            const rendered = elementRects.get(object.id);
                            const objectRect = rendered || {
                                left: object.x,
                                top: object.y,
                                right: object.x + object.width,
                                bottom: object.y + object.height
                            };
                            if (objectRect.right > selectionRect.left && objectRect.left < selectionRect.right && objectRect.bottom > selectionRect.top && objectRect.top < selectionRect.bottom) {
                                self.multiObjectSelection.add(object.id);
                                if (!self.selectedObj) self.selectedObj = object;
                            }
                        });
                        count = self.multiObjectSelection.size;
                    }

                    self._boxSelectJustFinished = true;
                    _suppressNextClick = true;
                    finishGesture(false);

                    if (self.isBoxSelectMode) self.toggleBoxSelectMode();

                    if (count === 0) {
                        self.showToast('Sin objetos en esa área');
                        return;
                    }

                    // Renderizar overlays con selección aplicada
                    self.renderOverlays(activeGesture.panelId);

                    self.showToast(`✅ ${count} objeto${count > 1 ? 's' : ''} seleccionado${count > 1 ? 's' : ''} — Mover, Agrupar (Ctrl+G) o Eliminar (Del)`);
                    self.syncToolbar && self.syncToolbar();
                };

                const onPointerCancel = (e) => {
                    if (!gesture || e.pointerId !== gesture.pointerId) return;
                    const panelId = gesture.panelId;
                    finishGesture(true);
                    self.renderOverlays(panelId);
                };

                const onKeyDown = (e) => {
                    if (e.key !== 'Escape' || !gesture) return;
                    const panelId = gesture.panelId;
                    finishGesture(true);
                    self.renderOverlays(panelId);
                    e.preventDefault();
                    e.stopPropagation();
                };

                // Registrar con captura para interceptar antes que el delegado de objetos
                document.addEventListener('pointerdown', onPointerDown, true);
                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
                document.addEventListener('pointercancel', onPointerCancel);
                document.addEventListener('keydown', onKeyDown, true);

                // Guardar cleanup para ESC y desactivación manual
                this._boxSelectCleanup = () => {
                    finishGesture(true);
                    _suppressNextClick = false;
                    document.removeEventListener('pointerdown', onPointerDown, true);
                    document.removeEventListener('pointermove', onPointerMove);
                    document.removeEventListener('pointerup', onPointerUp);
                    document.removeEventListener('pointercancel', onPointerCancel);
                    document.removeEventListener('keydown', onKeyDown, true);
                    _removeClickSuppressor();
                    const sel = document.getElementById('box-select-rect');
                    if (sel) sel.remove();
                };
            },

            // ─── IGUALAR PÁGINAS ───────────────────────────────────────────────
            equalizePageSizes: async function () {
                const doc = this.getDoc();
                if (!doc) return;
                if (!PythonManager.isLoaded) {
                    this.showToast("🐍 Cargando motor...");
                    await PythonManager.init();
                }

                this.toggleLoader(true, "⚙️ Leyendo dimensiones...");
                try {
                    // Step 1: Read actual page dimensions from each source PDF via Python
                    const pageDims = []; // [{sourceId, pageIndex, docIdx, w, h}]
                    for (const [docIdx, p] of doc.pages.entries()) {
                        const src = doc.sources[p.sourceId];
                        if (!src || !src.buffer) continue;
                        const uint8 = new Uint8Array(src.buffer);
                        const dimResult = await PythonManager.run(`
import fitz, io, json
def get_page_dim(data, page_idx):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    d = fitz.open(stream=data, filetype="pdf")
    pg = d[int(page_idx)]
    r = {"w": pg.rect.width, "h": pg.rect.height}
    d.close()
    return json.dumps(r)
get_page_dim(js_data, js_idx)
                        `, { js_data: uint8, js_idx: p.pageIndex });
                        const dimStr = typeof dimResult === 'string' ? dimResult : dimResult?.toString?.() || '{}';
                        const dim = JSON.parse(dimStr.replace(/^'|'$/g,''));
                        pageDims.push({ sourceId: p.sourceId, pageIndex: p.pageIndex, docIdx, w: dim.w, h: dim.h });
                    }

                    if (!pageDims.length) { this.showToast("⚠️ No hay páginas con tamaño válido"); this.toggleLoader(false); return; }

                    // Step 2: Determine dominant size
                    const freq = {};
                    pageDims.forEach(d => {
                        const key = `${Math.round(Math.min(d.w, d.h))}x${Math.round(Math.max(d.w, d.h))}`;
                        freq[key] = (freq[key] || 0) + 1;
                    });
                    const [targetKey] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
                    const [tMin, tMax] = targetKey.split('x').map(Number);

                    const needsChange = pageDims.some(d => {
                        return !(Math.round(Math.min(d.w,d.h)) === tMin && Math.round(Math.max(d.w,d.h)) === tMax);
                    });
                    if (!needsChange) { this.showToast("✅ Todas las páginas ya tienen el mismo tamaño"); this.toggleLoader(false); return; }

                    this.toggleLoader(true, `⚙️ Igualando páginas a ${tMin}×${tMax}pt...`);

                    // Step 3: Group pages to change by sourceId
                    const bySource = {};
                    pageDims.forEach(d => {
                        const rMin = Math.round(Math.min(d.w, d.h)), rMax = Math.round(Math.max(d.w, d.h));
                        if (rMin === tMin && rMax === tMax) return;
                        const isLandscape = d.w > d.h;
                        const targetW = isLandscape ? tMax : tMin;
                        const targetH = isLandscape ? tMin : tMax;
                        if (!bySource[d.sourceId]) bySource[d.sourceId] = [];
                        bySource[d.sourceId].push({ pageIndex: d.pageIndex, targetW, targetH, docIdx: d.docIdx, origW: d.w, origH: d.h });
                    });

                    // Step 4: Apply equalization per source
                    for (const [sourceId, pages] of Object.entries(bySource)) {
                        const src = doc.sources[sourceId];
                        if (!src || !src.buffer) continue;
                        const uint8 = new Uint8Array(src.buffer);
                        const paramsJson = JSON.stringify(pages.map(p => ({
                            pageIndex: p.pageIndex, targetW: p.targetW, targetH: p.targetH
                        })));

                        const result = await PythonManager.run(`
import fitz, io, json
def equalize_pages(data, params_json):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    params = json.loads(params_json)
    src_doc = fitz.open(stream=data, filetype="pdf")
    for item in params:
        i = int(item['pageIndex'])
        target_w = float(item['targetW'])
        target_h = float(item['targetH'])
        page = src_doc[i]
        orig_w = page.rect.width
        orig_h = page.rect.height
        if abs(orig_w - target_w) < 0.5 and abs(orig_h - target_h) < 0.5:
            continue
        scale_x = target_w / orig_w
        scale_y = target_h / orig_h
        page.clean_contents()
        xrefs = page.get_contents()
        if xrefs:
            stream = src_doc.xref_stream(xrefs[0])
            prefix = ("q %.8f 0 0 %.8f 0 0 cm" % (scale_x, scale_y) + chr(10)).encode()
            new_stream = prefix + stream + (chr(10) + "Q" + chr(10)).encode()
            src_doc.update_stream(xrefs[0], new_stream)
        page.set_mediabox(fitz.Rect(0, 0, target_w, target_h))
    buf = io.BytesIO()
    src_doc.save(buf, garbage=4, deflate=True)
    src_doc.close()
    return bytes(buf.getvalue())
equalize_pages(js_data, js_params_json)
                        `, { js_data: uint8, js_params_json: paramsJson });

                        let newBuffer;
                        if (result && result.toJs) {
                            const u8 = result.toJs();
                            newBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                        } else if (result instanceof Uint8Array) {
                            newBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                        } else {
                            throw new Error('Resultado inesperado de Python');
                        }

                        src.buffer = newBuffer;
                        src.doc = null;

                        pages.forEach(p => {
                            const page = doc.pages[p.docIdx];
                            const scaleX = p.targetW / p.origW;
                            const scaleY = p.targetH / p.origH;
                            if (page.objects) {
                                page.objects.forEach(obj => {
                                    obj.x = (obj.x || 0) * scaleX;
                                    obj.y = (obj.y || 0) * scaleY;
                                    obj.w = (obj.w || 0) * scaleX;
                                    obj.h = (obj.h || 0) * scaleY;
                                    if (obj.fontSize) obj.fontSize *= Math.min(scaleX, scaleY);
                                });
                            }
                        });
                    }

                    this.loadPage(doc.currentIndex);
                    this.renderSidebar();
                    this.showToast(`✅ Páginas igualadas a ${tMin}×${tMax}pt`);
                } catch (e) {
                    this.showToast('❌ Error al igualar páginas: ' + e.message);
                    console.error(e);
                }
                this.toggleLoader(false);
            },

            // ─── ACCESO RÁPIDO (+) ────────────────────────────────────────────
            _customShortcut: null,

            executeCustomShortcut: function () {
                if (!this._customShortcut) { this.openShortcutPicker(); return; }
                try { this._customShortcut.fn(); } catch (e) {}
            },

            _customShortcut2: null,

            executeCustomShortcut2: function () {
                if (!this._customShortcut2) { this.openShortcutPicker2(); return; }
                try { this._customShortcut2.fn(); } catch (e) {}
            },

            openShortcutPicker2: function () {
                this._shortcutPickerTarget = 2;
                this.openShortcutPicker();
            },

            openShortcutContextMenu: function (e) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const existing = document.getElementById('shortcut-ctx-menu');
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = 'shortcut-ctx-menu';
                menu.style.cssText = `position:fixed;z-index:99999;
                    background:rgba(14,14,18,0.65);
                    border:1px solid rgba(255,255,255,0.12);
                    border-radius:9px;
                    padding:4px 0;min-width:180px;
                    box-shadow:0 8px 32px rgba(0,0,0,0.7);
                    font-size:12px;
                    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                const items = [
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>', label: t('ctx_change_shortcut', 'Cambiar Atajo'), fn: () => this.openShortcutPicker() },
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: t('btn_delete', 'Eliminar'), fn: () => this.removeCustomShortcut(), disabled: !this._customShortcut },
                ];
                items.forEach(item => {
                    const d = document.createElement('div');
                    d.innerHTML = (item.icon ? item.icon + ' ' : '') + '<span>' + item.label + '</span>'; d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '8px';
                    d.style.cssText = `padding:8px 16px;cursor:${item.disabled ? 'default' : 'pointer'};color:${item.disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.92)'};`;
                    if (!item.disabled) {
                        d.onmouseenter = () => d.style.background = 'rgba(99,102,241,0.25)';
                        d.onmouseleave = () => d.style.background = '';
                        d.onclick = () => { menu.remove(); item.fn(); };
                    }
                    menu.appendChild(d);
                });
                document.body.appendChild(menu);
                // Smart positioning: keep fully inside viewport
                const mw = menu.offsetWidth || 185;
                const mh = menu.offsetHeight || 100;
                let left = e.clientX;
                let top = e.clientY;
                if (left + mw > window.innerWidth - 8)  left = window.innerWidth  - mw - 8;
                if (top  + mh > window.innerHeight - 8) top  = window.innerHeight - mh - 8;
                if (left < 8) left = 8;
                if (top  < 8) top  = 8;
                menu.style.left = left + 'px';
                menu.style.top  = top  + 'px';
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 50);
            },

            openShortcutContextMenu2: function (e) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const existing = document.getElementById('shortcut-ctx-menu');
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = 'shortcut-ctx-menu';
                menu.style.cssText = `position:fixed;z-index:99999;
                    background:rgba(14,14,18,0.65);
                    border:1px solid rgba(255,255,255,0.12);
                    border-radius:9px;
                    padding:4px 0;min-width:180px;
                    box-shadow:0 8px 32px rgba(0,0,0,0.7);
                    font-size:12px;
                    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                const items = [
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>', label: t('ctx_change_shortcut', 'Cambiar Atajo'), fn: () => this.openShortcutPicker2() },
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: t('btn_delete', 'Eliminar'), fn: () => this.removeCustomShortcut2(), disabled: !this._customShortcut2 },
                ];
                items.forEach(item => {
                    const d = document.createElement('div');
                    d.innerHTML = (item.icon ? item.icon + ' ' : '') + '<span>' + item.label + '</span>'; d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '8px';
                    d.style.cssText = `padding:8px 16px;cursor:${item.disabled ? 'default' : 'pointer'};color:${item.disabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.92)'};`;
                    if (!item.disabled) {
                        d.onmouseenter = () => d.style.background = 'rgba(99,102,241,0.25)';
                        d.onmouseleave = () => d.style.background = '';
                        d.onclick = () => { menu.remove(); item.fn(); };
                    }
                    menu.appendChild(d);
                });
                document.body.appendChild(menu);
                const mw = menu.offsetWidth || 185;
                const mh = menu.offsetHeight || 100;
                let left = e.clientX;
                let top = e.clientY;
                if (left + mw > window.innerWidth - 8)  left = window.innerWidth  - mw - 8;
                if (top  + mh > window.innerHeight - 8) top  = window.innerHeight - mh - 8;
                if (left < 8) left = 8;
                if (top  < 8) top  = 8;
                menu.style.left = left + 'px';
                menu.style.top  = top  + 'px';
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 50);
            },

            _buildShortcutGroups: function () {
                const S = (p,a='')=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a}>${p}</svg>`;
                this._shortcutPickerGroups = [
                    {
                        tab: 'INICIO', items: [
                            { id: 'addText',          label: 'Añadir Texto',       icon: `<svg viewBox="0 0 24 24"><path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z"/></svg>`, fn: () => this.addText?.() },
                            { id: 'addComment',       label: 'Añadir Comentario',  icon: S('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'), fn: () => this.addComment?.() },
                            { id: 'showHighlight',    label: 'Resaltar',           icon: S('<path d="M8 4h8 M12 4v16 M8 20h8" stroke-linecap="square"/><rect x="17" y="2" width="5" height="5" fill="#10b981" stroke="none" rx="0.5"/>'), fn: () => this.showHighlightModal?.() },
                            { id: 'savePDF',          label: 'Guardar PDF',        icon: S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'), fn: () => this.savePDF?.() },
                            { id: 'extractText',      label: 'Extraer Texto',      icon: `<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4V5zm2 2v2h12V7H6zm0 4v2h12v-2H6zm0 4v2h8v-2H6z"/></svg>`, fn: () => this.extractText?.() },
                            { id: 'startCapture',     label: 'Capturar Selección', icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4z"/><path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>`, fn: () => this.startCaptureSelection?.() },
                            { id: 'insertBlankPage',  label: 'Insertar Página',    icon: `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`, fn: () => this.insertBlankPage?.() },
                            { id: 'deletePage',       label: 'Eliminar Página',    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`, fn: () => this.deletePage?.() },
                            { id: 'rotatePage',       label: 'Rotar Página',       icon: `<svg viewBox="0 0 24 24"><path d="M15.55 5.55L11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11c-.17-1.39-.72-2.73-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.17 2.74-.71 3.9-1.61l-1.44-1.44c-.75.54-1.59.89-2.46 1.03zm3.89-2.42l1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z"/></svg>`, fn: () => this.rotatePage?.() },
                            { id: 'flipPage',         label: 'Voltear Página',     icon: `<svg viewBox="0 0 24 24"><path d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z"/></svg>`, fn: () => this.flipPage?.() },
                            { id: 'extractPage',      label: 'Extraer Página',     icon: `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`, fn: () => this.extractPage?.() },
                            { id: 'showPageNum',      label: 'Numeración Páginas', icon: `<svg viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="16" font-weight="900" font-style="italic" font-family="Georgia,serif" fill="currentColor" stroke="none">8</text></svg>`, fn: () => this.showPageNumModal?.() },
                            { id: 'scanQR',           label: 'Escanear QR',        icon: `<svg viewBox="0 0 24 24"><path d="M3 3h6v6H3V3zm2 2v2h2V5H5zm8-2h6v6h-6V3zm2 2v2h2V5h-2zM3 15h6v6H3v-6zm2 2v2h2v-2H5zm8 6h6v-6h-6v6zm2-4v2h2v-2h-2zM15 9h-2v2h-4v2h2v2h2v-2h2V9zm2 2h2v-2h-2v2zm-2-2v2h-2V9h2zm-2 2h-2v2h2v-2zm2 2h-2v2h2v-2zm-2 2v2h-2v-2h2zm2-2h2v-2h-2v2z"/></svg>`, fn: () => this.scanQR?.() },
                            { id: 'showQRGen',        label: 'Generar QR',         icon: `<svg viewBox="0 0 24 24"><path d="M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zm0 3H19V19h-1.5v-1.5zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 7V2h5v2H4v3H2zm0 10v5h5v-2H4v-3H2z"/></svg>`, fn: () => this.showQRGeneratorModal?.() },
                            { id: 'smartPatch',       label: 'Editar Texto Real',  icon: S('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/>'), fn: () => this.activateRealTextEditor?.() },
                            { id: 'toggleHand',       label: 'Modo Mano',          icon: `<svg viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M7,21 L5.5,11 L5.5,7 A1.5,1.5 0 0 1 8.5,7 L8.5,11 L8.5,5 A1.5,1.5 0 0 1 11.5,5 L11.5,11 L11.5,2.45 A1.5,1.5 0 0 1 14.5,2.45 L14.5,11 L14.5,5 A1.5,1.5 0 0 1 17.5,5 L17.5,12 L20.5,10 A1.5,1.5 0 0 1 22,12.5 L18.5,15.5 Q17.5,16.5 17.5,18 L16,21 Q11.5,23 7,21 Z"/></svg>`, fn: () => this.toggleHandMode?.() },
                            { id: 'toggleSelect',     label: 'Modo Texto',         icon: S('<path d="M8 4h8 M12 4v16 M8 20h8" stroke-linecap="square"/>'), fn: () => this.toggleTextSelectMode?.() },
                            { id: 'toggleBox',        label: 'Seleccionar Objetos', icon: S('<line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><rect x="5" y="5" width="9" height="9" rx="0.5" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.6"/>'), fn: () => this.toggleBoxSelectMode?.() },
                        ]
                    },
                    {
                        tab: 'IMAGEN', items: [
                            { id: 'scanBarcode',      label: 'Escanear Barras',    icon: `<svg viewBox="0 0 24 24"><path d="M2 4v16h2V4H2zm3 0v16h1V4H5zm2 0v16h2V4H7zm3 0v16h1V4h-1zm2 0v16h1V4h-1zm2 0v16h2V4h-2zm3 0v16h1V4h-1zm2 0v16h1V4h-1z"/></svg>`, fn: () => this.scanBarcode?.() },
                            { id: 'genBarcode',       label: 'Generar Barras',     icon: `<svg viewBox="0 0 24 24"><path d="M2 4v16h2V4H2zm3 0v16h1V4H5zm2 0v16h2V4H7zm3 0v16h1V4h-1zm2 0v16h1V4h-1zm2 0v16h2V4h-2zm3 0v16h1V4h-1zm2 0v16h1V4h-1z"/><circle cx="19" cy="19" r="5" fill="var(--accent)"/><path d="M17 19h4M19 17v4" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>`, fn: () => this.showBarcodeGeneratorModal?.() },
                            { id: 'editImage',        label: 'Editar Imagen',      icon: S('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'), fn: () => this.enableImageEdit?.() },
                            { id: 'extractImgs',      label: 'Extraer Imágenes',   icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/>'), fn: () => this.extractEmbeddedImages?.() },
                            { id: 'removeImgs',       label: 'Eliminar Imágenes',  icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/><line x1="18" y1="6" x2="22" y2="10"/><line x1="22" y1="6" x2="18" y2="10"/>'), fn: () => this.showRemoveImagesModal?.() },
                            { id: 'removeLinks',      label: 'Quitar Sellos',      icon: S('<circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><path d="M10 13a2 2 0 0 0 3 .1M14 11a2 2 0 0 0-3-.1"/>'), fn: () => this.showRemoveLinksModal?.() },
                            { id: 'removeLinksArea',  label: 'Quitar Vínculos por Área', icon: S('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><path d="M9.5 14.5l5-5M8 11l-1.5 1.5a2.1 2.1 0 0 0 3 3L11 14M13 10l1.5-1.5a2.1 2.1 0 0 1 3 3L16 13"/>'), fn: () => this.enableRemoveLinksAreaMode?.() },
                            { id: 'emoji',            label: 'Emoji / Iconos',     icon: S('<circle cx="12" cy="12" r="10" fill="none"/><circle cx="8" cy="10" r="1.5" fill="currentColor"/><circle cx="16" cy="10" r="1.5" fill="currentColor"/><path d="M8 14s1.5 3 4 3 4-3 4-3" stroke-width="1.5"/>'), fn: () => this.showEmojiModal?.() },
                            { id: 'cropImage',        label: 'Recortar Imagen',    icon: S('<polyline points="6 2 6 18 22 18"/><polyline points="2 6 18 6 18 22"/>'), fn: () => this.cropImage?.() },
                            { id: 'imageEffects',     label: 'Efectos de Imagen',  icon: S('<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>'), fn: () => this.openImageEffectsModal?.() },
                            { id: 'enableCensorMode', label: 'Censurar Región',    icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="9" width="10" height="6" rx="1" fill="currentColor" opacity="0.8"/>'), fn: () => this.enableCensorMode?.() },
                            { id: 'deleteObject',     label: 'Eliminar Objeto',    icon: S('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'), fn: () => this.deleteObject?.() },
                            { id: 'showFirmas',       label: 'Firmas',             icon: S('<path d="M2 15 C4 11 6 8 8 10 C9.5 11.5 9 13.5 11 12.5 C13 11.5 13 9 15 10 C16.2 10.6 16 12.5 17.2 12" stroke-width="1.7"/><path d="M4 18 Q8 16.5 12 18 Q15 19 17.2 17.8" stroke-width="1.3" opacity="0.65"/><g transform="translate(19,9) rotate(45)"><path d="M-1.1,-8 L1.1,-8 L1.1,1 L0,3 L-1.1,1 Z" stroke-width="1.3" fill="none"/><line x1="-1.1" y1="-5.5" x2="1.1" y2="-5.5" stroke-width="1"/></g>'), fn: () => this.showFirmasModal?.() },
                        ]
                    },
                    {
                        tab: 'DIBUJAR', items: [
                            { id: 'clearDrawings',    label: 'Borrar Dibujos',     icon: S('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'), fn: () => this.clearDrawings?.() },
                            { id: 'groupObjects',     label: 'Agrupar Objetos',    icon: `<svg viewBox="0 0 24 24"><path d="M4 18h16v2H4zm0-6h16v2H4zm0-6h16v2H4z"/></svg>`, fn: () => this.toggleGroupObjects?.() },
                            { id: 'deleteObj',        label: 'Borrar Objeto',      icon: `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`, fn: () => this.deleteObject?.() },
                            { id: 'addStamp',         label: 'Añadir Sello',       icon: S('<rect x="3" y="8" width="18" height="10" rx="1"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><line x1="8" y1="13" x2="16" y2="13" stroke-width="2"/>'), fn: () => this.addStamp?.() },
                            { id: 'moveToFront',      label: 'Al Frente',          icon: `<svg viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z"/></svg>`, fn: () => this.moveObjectZ?.('front') },
                            { id: 'moveToBack',       label: 'Al Fondo',           icon: `<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>`, fn: () => this.moveObjectZ?.('back') },
                            { id: 'rotateObj90',      label: 'Rotar Objeto +90°',  icon: `<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`, fn: () => this.rotateSelectedObject?.(90) },
                            { id: 'flipObjH',         label: 'Espejo Horizontal',  icon: S('<path d="M12 3v18"/><path d="M5 7l-3 5 3 5"/><path d="M19 7l3 5-3 5"/>'), fn: () => this.flipObject?.('h') },
                            { id: 'flipObjV',         label: 'Espejo Vertical',    icon: S('<path d="M3 12h18"/><path d="M7 5l5-3 5 3"/><path d="M7 19l5 3 5-3"/>'), fn: () => this.flipObject?.('v') },
                        ]
                    },
                    {
                        tab: 'INPUTS', items: [
                            { id: 'formText',         label: 'Campo de Texto',     icon: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h10"/>'), fn: () => this.setFormTool?.('text') },
                            { id: 'formCheckbox',     label: 'Checkbox',           icon: S('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M8 12l3 3 5-5"/>'), fn: () => this.setFormTool?.('checkbox') },
                            { id: 'formRadio',        label: 'Radio',              icon: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'), fn: () => this.setFormTool?.('radio') },
                            { id: 'formDropdown',     label: 'Lista Desplegable',  icon: S('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M16 10l-4 4-4-4"/>'), fn: () => this.setFormTool?.('dropdown') },
                            { id: 'formSignature',    label: 'Campo de Firma',     icon: S('<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/><path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/><path d="M18 18H6v2h12v-2z"/>'), fn: () => this.setFormTool?.('signature') },
                            { id: 'formCalendar',     label: 'Calendario',         icon: S('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'), fn: () => this.setFormTool?.('calendar') },
                            { id: 'formTable',        label: 'Insertar Tabla',     icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'), fn: () => this.setFormTool?.('table') },
                            { id: 'linkModal',        label: 'Vínculo Web',        icon: S('<circle cx="10" cy="11" r="7"/><path d="M10 4c-2 2-3 4.5-3 7s1 5 3 7"/><path d="M10 4c2 2 3 4.5 3 7s-1 5-3 7"/><path d="M3 11h14"/><path d="M18 16 l-1 5 l2-2 l2 3 l1.2-.8 l-2-3 l2.8-.4z" stroke="none" fill="currentColor"/>'), fn: () => this.showLinkModal?.() },
                            { id: 'redactReal',       label: 'Redactar Real',      icon: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="currentColor" stroke="none"/><line x1="7" y1="10" x2="17" y2="10" stroke="white" stroke-width="1.5"/><line x1="7" y1="14" x2="13" y2="14" stroke="white" stroke-width="1.5"/></svg>`, fn: () => this.enableCensorMode?.() },
                            { id: 'tabOrder',         label: 'Orden Tab',          icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/><path d="M13 8l4 4-4 4"/><path d="M7 8v1"/>'), fn: () => this.showTabOrderPanel?.() },
                            { id: 'detectTables',     label: 'Detectar Tablas',    icon: S('<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'), fn: () => this.detectAndShowTables?.() },
                            { id: 'detectTableSel',   label: 'Detectar Tabla Sel.',icon: S('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><path d="M12 8v8M8 12h8"/>'), fn: () => this.detectTableInSelection?.() },
                            { id: 'metadata',         label: 'Metadatos PDF',      icon: S('<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>'), fn: () => this.showMetadataPanel?.() },
                            { id: 'groupObjectsInputs', label: 'Agrupar / Desagrupar', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/><line x1="10" y1="6" x2="14" y2="6"/><line x1="10" y1="18" x2="14" y2="18"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="18" y1="10" x2="18" y2="14"/></svg>`, fn: () => { app.multiObjectSelection&&app.multiObjectSelection.size>0?app.groupSelectedObjects():app.ungroupObject(app.selectedObj); } },
                            { id: 'equalFieldWidth', label: 'Igualar ancho de campos', keywords: ['igualar', 'width'], icon: S('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M3 12h18"/>'), fn: () => this.equalSelectedFieldSize?.('width') },
                            { id: 'equalFieldHeight', label: 'Igualar alto de campos', keywords: ['igualar', 'height'], icon: S('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M12 3v18"/>'), fn: () => this.equalSelectedFieldSize?.('height') },
                            { id: 'alignFieldsRows', label: 'Alinear campos por filas', keywords: ['alinear', 'rows'], icon: S('<path d="M3 8h18M3 16h18"/><rect x="6" y="6" width="4" height="4" rx="1"/><rect x="14" y="14" width="4" height="4" rx="1"/>'), fn: () => this.alignSelectedObjects?.('horizontal') },
                            { id: 'alignFieldsColumns', label: 'Alinear campos por columnas', keywords: ['alinear', 'columns'], icon: S('<path d="M8 3v18M16 3v18"/><rect x="6" y="6" width="4" height="4" rx="1"/><rect x="14" y="14" width="4" height="4" rx="1"/>'), fn: () => this.alignSelectedObjects?.('vertical') },
                            { id: 'fieldGrid', label: 'Cuadrícula de campos', keywords: ['cuadrícula', 'grid'], icon: S('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>'), fn: () => this.applySelectedFieldGrid?.(2) },
                        ]
                    },
                    {
                        tab: 'OTROS', items: [
                            { id: 'compressPDF',      label: 'Comprimir PDF',      icon: S('<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><rect x="4" y="17" width="16" height="3" rx="1"/>'), fn: () => this.showCompressPDFModal?.() },
                            { id: 'compress',         label: 'Reparar y Optimizar',icon: S('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"/>'), fn: () => this.repairAndOptimizePDF?.() },
                            { id: 'flatten',          label: 'Aplanar Documento',  icon: S('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'), fn: () => this.flattenFormPDF?.() },
                            { id: 'export300',        label: 'PNG 300 DPI',        icon: S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'), fn: () => this.export300DPI?.() },
                            { id: 'equalize',         label: 'Igualar PÁGs',       icon: S('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>'), fn: () => this.equalizePageSizes?.() },
                            { id: 'grayscale',        label: 'Escala de Grises',   icon: S('<circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="12" y1="7" x2="16" y2="7" stroke-width="1"/><line x1="12" y1="10" x2="18" y2="10" stroke-width="1"/><line x1="12" y1="13" x2="16" y2="13" stroke-width="1"/><line x1="12" y1="16" x2="18" y2="16" stroke-width="1"/>'), fn: () => this.convertToGrayscalePDF?.() },
                            { id: 'invert',           label: 'Invertir Colores',   icon: S('<circle cx="12" cy="12" r="9"/><path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" stroke="none"/>'), fn: () => this.invertColorsPDF?.() },
                            { id: 'searchable',       label: 'PDF Buscable',       icon: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="11" y2="13"/><circle cx="11" cy="16" r="2"/><line x1="13" y1="18" x2="15" y2="20"/>'), fn: () => this.makeSearchablePDF?.() },
                            { id: 'realText',         label: 'Editar Texto Real',  icon: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'), fn: () => this.activateRealTextEditor?.() },
                            { id: 'lockEdit',         label: 'Bloquear Edición',   icon: S('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'), fn: () => this.togglePDFLock?.('edit') },
                            { id: 'lockPrint',        label: 'Bloquear Impresión', icon: S('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'), fn: () => this.togglePDFLock?.('print') },
                            { id: 'lockCopy',         label: 'Bloquear Copia',     icon: S('<line x1="4" y1="4" x2="20" y2="20"/><path d="M14 8H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><path d="M10 4h6a2 2 0 0 1 2 2v6"/>'), fn: () => this.togglePDFLock?.('copy') },
                            { id: 'officeImport',     label: 'Office → PDF',       icon: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/>'), fn: () => this.showOfficeImportModal?.() },
                            { id: 'word',             label: 'PDF → Word',         icon: `<svg viewBox="0 0 24 24"><path d="M4 3H14L20 9V21H4V3Z" stroke="#2b579a" stroke-width="1.5" stroke-linejoin="round" fill="none"/><rect x="2" y="7" width="11" height="10" rx="1" fill="#2b579a"/><text x="7.5" y="15" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial" fill="white">W</text></svg>`, fn: () => this.exportToWord?.() },
                            { id: 'excel',            label: 'PDF → Excel',        icon: `<svg viewBox="0 0 24 24"><path d="M4 3H14L20 9V21H4V3Z" stroke="#217346" stroke-width="1.5" stroke-linejoin="round" fill="none"/><rect x="2" y="7" width="11" height="10" rx="1" fill="#217346"/><text x="7.5" y="15" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial" fill="white">X</text></svg>`, fn: () => this.exportToExcel?.() },
                            { id: 'toggleMeasure',    label: 'Herramienta Medición',icon: S('<line x1="3" y1="21" x2="21" y2="3"/><line x1="3" y1="21" x2="7" y2="21"/><line x1="3" y1="17" x2="5" y2="17"/><line x1="3" y1="13" x2="7" y2="13"/><line x1="7" y1="3" x2="7" y2="7"/><line x1="11" y1="3" x2="11" y2="5"/><line x1="15" y1="3" x2="15" y2="7"/>'), fn: () => this.toggleMeasure?.() },
                            { id: 'applyPageNum',     label: 'Numeración Páginas', icon: `<svg viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="16" font-weight="900" font-style="italic" font-family="Georgia,serif" fill="currentColor" stroke="none">8</text></svg>`, fn: () => this.applyPageNumbering?.() },
                            { id: 'exportCSV',        label: 'Exportar Tablas CSV',icon: S('<rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'), fn: () => this.exportTablesCSV?.() },
                            { id: 'exportXLSX',       label: 'Exportar Tablas XLSX',icon: `<svg viewBox="0 0 24 24"><path d="M4 3H14L20 9V21H4V3Z" stroke="#217346" stroke-width="1.5" stroke-linejoin="round" fill="none"/><rect x="2" y="7" width="11" height="10" rx="1" fill="#217346"/><text x="7.5" y="15" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial" fill="white">X</text></svg>`, fn: () => this.exportTablesXLSX?.() },
                            { id: 'toggleAI',         label: 'Panel de IA',        icon: S('<path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4"/><path d="M20 20c0-4.4-3.6-8-8-8s-8 3.6-8 8"/><circle cx="12" cy="6" r="1" fill="currentColor" stroke="none"/><path d="M9 12l1.5 4 1.5-2 1.5 2 1.5-4"/>'), fn: () => this.toggleAIPanel?.() },
                            { id: 'toggleIndex',      label: 'Panel de Índice',    icon: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'), fn: () => this.toggleIndexPanel?.() },
                            { id: 'toggleAttach',     label: 'Panel Adjuntos',     icon: S('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'), fn: () => this.toggleAttachPanel?.() },
                            { id: 'toggleTTS',        label: 'Lectura por Voz',    icon: S('<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'), fn: () => this.toggleTTSWidget?.() },
                        ]
                    },
                    {
                        tab: 'IA', items: [
                            { id: 'tableToFormAI', label: 'Formularios Automáticos', keywords: ['formularios', 'forms'], icon: S('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18"/>'), fn: () => this.tableToFormAI?.() },
                            { id: 'redact_email', label: 'Tachar Emails', keywords: ['privacidad', 'email', 'redacción'], icon: S('<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 1-2 2v12c0 1.1.9 2 2 2h8"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/><path d="m17 17 5 5m0-5-5 5"/>'), fn: () => this.showSensitiveReview?.('email') },
                            { id: 'redact_phone', label: 'Tachar Teléfonos', keywords: ['privacidad', 'teléfono', 'phone', 'redacción'], icon: S('<path d="M2 2l20 20"/><path d="M10.7 13.3a16 16 0 0 0 3.4 2.6"/>'), fn: () => this.showSensitiveReview?.('phone') },
                            { id: 'dataExtractionAI', label: 'Data Extraction AI', keywords: ['extracción', 'extraction', 'datos'], icon: S('<rect x="3" y="3" width="13" height="18" rx="2"/><path d="M7 8h6M7 12h4M17 15l3 3-3 3M20 18H14"/>'), fn: () => this.showDataExtractionModal?.() },
                            { id: 'dexExtractDirect', label: 'Extracción Directa AI', keywords: ['extracción', 'extraction', 'directo'], icon: S('<rect x="3" y="3" width="13" height="18" rx="2"/><path d="M7 8h6M7 12h4M20 12v6"/>'), fn: () => this.dexExtractDirect?.() },
                            { id: 'generateIndexAI', label: 'Índice IA', keywords: ['índice', 'index', 'estructura'], icon: S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 13h8M8 17h5"/>'), fn: () => this.generateIndexWithAI?.() },
                            { id: 'saveAs', label: 'Guardar como', keywords: ['save as', 'guardar'], icon: S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11"/>'), fn: () => this.showSaveModal?.() },
                        ]
                    },
                ];
                this._shortcutPickerGroups.forEach(group => group.items.forEach(item => {
                    item.icon = this._getShortcutRibbonIcon(item, group.tab) || this._normalizeShortcutPickerIcon(item.icon);
                }));
            },

            _getShortcutRibbonIcon: function (item, tab) {
                const special = {
                    savePDF: '#btn-header-save',
                    saveAs: '#btn-header-save-as',
                    groupObjects: '#btn-group-objects-draw',
                    redactReal: '#btn-redact',
                    applyPageNum: '#toolbar-home button[onclick="app.showPageNumModal()"]',
                    toggleIndex: '#btn-index-panel-reading'
                };
                let source = special[item.id] && document.querySelector(special[item.id]);
                if (!source) {
                    const toolbar = document.getElementById({
                        INICIO: 'toolbar-home', IMAGEN: 'toolbar-image', DIBUJAR: 'toolbar-draw',
                        INPUTS: 'toolbar-form', OTROS: 'toolbar-magic', IA: 'toolbar-ai'
                    }[tab]);
                    const action = item.fn.toString().match(/this\.([A-Za-z0-9_]+)\?\.\(([^)]*)\)/);
                    if (action) {
                        const [, method, args] = action;
                        const local = toolbar ? [...toolbar.querySelectorAll('button[onclick]')] : [];
                        const all = [...document.querySelectorAll('.toolbar-area button[onclick]')];
                        const find = buttons => buttons.find(button => {
                            const call = button.getAttribute('onclick').match(new RegExp(`\\bapp\\.${method}\\s*\\(([^)]*)\\)`));
                            return call && (!args.trim() || call[1].replace(/\s/g, '') === args.replace(/\s/g, ''));
                        });
                        source = find(local) || find(all);
                    }
                }
                const svg = source?.querySelector('svg')?.cloneNode(true);
                if (!svg) return null;
                svg.removeAttribute('id');
                svg.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
                svg.style.width = '20px';
                svg.style.height = '20px';
                return svg.outerHTML;
            },

            openShortcutPicker: function () {
                const savedTarget = this._shortcutPickerTarget;
                this.closeAllModals();
                this._shortcutPickerTarget = savedTarget; // restore after closeAllModals
                const overlay = document.getElementById('modal-overlay');
                const modal = document.getElementById('shortcut-picker-modal');
                if (!overlay || !modal) return;

                this._buildShortcutGroups();
                this._renderShortcutPickerList('');
                const search = document.getElementById('shortcut-picker-search');
                if (search) search.value = '';

                overlay.style.display = 'flex';
                overlay.classList.remove('anim-in'); void overlay.offsetWidth; overlay.classList.add('anim-in');
                modal.style.display = 'flex';
                modal.classList.remove('anim-in'); void modal.offsetWidth; modal.classList.add('anim-in');

                document.querySelectorAll('#modal-overlay .glass-box').forEach(el => {
                    if (el.id !== 'shortcut-picker-modal') el.style.display = 'none';
                });
                modal.style.display = 'flex';
                if (!this._shortcutPickerTarget) this._shortcutPickerTarget = 1;
            },

            _normalizeShortcutPickerIcon: function (icon) {
                const template = document.createElement('template');
                template.innerHTML = icon;
                template.content.querySelectorAll('svg').forEach(svg => {
                    svg.setAttribute('width', '20');
                    svg.setAttribute('height', '20');
                    svg.setAttribute('fill', 'none');
                    svg.setAttribute('stroke', 'currentColor');
                    svg.setAttribute('stroke-width', '1.8');
                    svg.setAttribute('stroke-linecap', 'round');
                    svg.setAttribute('stroke-linejoin', 'round');
                    svg.querySelectorAll('[fill="black"], [fill="#000"], [fill="#000000"]').forEach(shape => shape.setAttribute('fill', 'none'));
                    svg.querySelectorAll('[stroke="black"], [stroke="#000"], [stroke="#000000"]').forEach(shape => shape.setAttribute('stroke', 'currentColor'));
                });
                return template.innerHTML;
            },

            _renderShortcutPickerList: function (filter) {
                const list = document.getElementById('shortcut-picker-list');
                if (!list || !this._shortcutPickerGroups) return;
                const q = String(filter || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                list.innerHTML = '';
                this._shortcutPickerGroups.forEach(group => {
                    const items = group.items.filter(item => {
                        if (item.available === false) return false;
                        const searchText = [item.id, item.label, group.tab, ...(item.keywords || [])].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                        return !q || searchText.includes(q);
                    });
                    if (!items.length) return;
                    const header = document.createElement('div');
                    header.style.cssText = 'font-size:10px;font-weight:700;color:var(--text-secondary,#aaa);letter-spacing:0.08em;padding:4px 2px 2px;';
                    header.textContent = group.tab;
                    list.appendChild(header);
                    const grid = document.createElement('div');
                    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px;';
                    items.forEach(item => {
                        const btn = document.createElement('button');
                        const isCurrent = this._customShortcut && this._customShortcut.id === item.id;
                        btn.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isCurrent ? 'rgba(99,102,241,0.25)' : 'var(--bg-ribbon)'};border:1px solid ${isCurrent ? 'var(--accent,#6366f1)' : 'var(--border)'};border-radius:8px;cursor:pointer;color:var(--text-main);font-size:11px;text-align:left;transition:background 0.15s;`;
                        btn.innerHTML = `<span style="width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">${item.icon}</span><span style="line-height:1.3;">${item.label}</span>`;
                        btn.onmouseenter = () => { if (!isCurrent) btn.style.background = 'rgba(99,102,241,0.15)'; };
                        btn.onmouseleave = () => { if (!isCurrent) btn.style.background = 'var(--bg-ribbon)'; };
                        btn.onclick = () => {
                            const t = this._shortcutPickerTarget;
                            if (t === 'form1') { this._applyShortcutForm(1, item); }
                            else if (t === 'form2') { this._applyShortcutForm(2, item); }
                            else { this._setCustomShortcutFromGroup(item); }
                            this.closeAllModals();
                        };
                        grid.appendChild(btn);
                    });
                    list.appendChild(grid);
                });
            },

            _filterShortcutPicker: function (val) {
                this._renderShortcutPickerList(val);
            },

            _setCustomShortcutFromGroup: function (item) {
                const t = this._shortcutPickerTarget;
                this._shortcutPickerTarget = 1;
                // Tab shortcuts
                if (typeof t === 'string' && t.startsWith('tab_')) {
                    const key = t.slice(4); // e.g. "image_1"
                    const parts = key.split('_');
                    const tab = parts[0]; const slot = parseInt(parts[1])||1;
                    if (!this._customShortcutTabs) this._customShortcutTabs = {};
                    this._customShortcutTabs[key] = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                    localStorage.setItem('alioth_shortcut_tab_' + key, JSON.stringify({ id: item.id, label: item.label, icon: item.icon }));
                    const icoId = 'custom-shortcut-icon-' + tab + slot;
                    const lblId = 'custom-shortcut-label-' + tab + slot;
                    const btnId = 'btn-custom-shortcut-' + tab + slot;
                    const lbl = document.getElementById(lblId);
                    const ico = document.getElementById(icoId);
                    const btn = document.getElementById(btnId);
                    if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                    if (ico) ico.outerHTML = `<span id="${icoId}" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                    if (btn) btn.title = item.label;
                    return;
                }
                const slot = t === 2 ? 2 : t === 3 ? 3 : 1;
                if (slot === 3) {
                    this._customShortcut3 = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                    localStorage.setItem('alioth_custom_shortcut3', JSON.stringify({ id: item.id, label: item.label, icon: item.icon }));
                    const lbl = document.getElementById('custom-shortcut-label3');
                    const icoEl = document.getElementById('custom-shortcut-icon3');
                    const btn = document.getElementById('btn-custom-shortcut3');
                    if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                    if (icoEl) icoEl.outerHTML = `<span id="custom-shortcut-icon3" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                    if (btn) btn.title = item.label;
                } else if (slot === 2) {
                    this._customShortcut2 = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                    localStorage.setItem('alioth_custom_shortcut2', JSON.stringify({ id: item.id, label: item.label, icon: item.icon }));
                    const lbl = document.getElementById('custom-shortcut-label2');
                    const icoEl = document.getElementById('custom-shortcut-icon2');
                    const btn = document.getElementById('btn-custom-shortcut2');
                    if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                    if (icoEl) icoEl.outerHTML = `<span id="custom-shortcut-icon2" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                    if (btn) btn.title = item.label;
                } else {
                    this._customShortcut = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                    localStorage.setItem('alioth_custom_shortcut', JSON.stringify({ id: item.id, label: item.label, icon: item.icon }));
                    const lbl = document.getElementById('custom-shortcut-label');
                    const icoEl = document.getElementById('custom-shortcut-icon');
                    const btn = document.getElementById('btn-custom-shortcut');
                    if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                    if (icoEl) icoEl.outerHTML = `<span id="custom-shortcut-icon" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                    if (btn) btn.title = item.label;
                }
            },

            _shortcutCatalog: {}, // Kept for compatibility; catalog now lives in _shortcutPickerGroups

            _setCustomShortcut: function (id) {
                if (!this._shortcutPickerGroups) this._buildShortcutGroups();
                for (const group of this._shortcutPickerGroups) {
                    const item = group.items.find(i => i.id === id);
                    if (item) { this._setCustomShortcutFromGroup(item); return; }
                }
            },

            removeCustomShortcut: function () {
                this._customShortcut = null;
                localStorage.removeItem('alioth_custom_shortcut');
                const lbl = document.getElementById('custom-shortcut-label');
                const icoEl = document.getElementById('custom-shortcut-icon');
                const btn = document.getElementById('btn-custom-shortcut');
                if (lbl) lbl.innerHTML = 'Agregar<br>Atajo';
                if (icoEl) icoEl.outerHTML = `<svg id="custom-shortcut-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                if (btn) btn.title = 'Atajo personalizado (clic derecho para configurar)';
                this.showToast('Acceso rápido eliminado');
            },

            removeCustomShortcut2: function () {
                this._customShortcut2 = null;
                localStorage.removeItem('alioth_custom_shortcut2');
                const lbl = document.getElementById('custom-shortcut-label2');
                const icoEl = document.getElementById('custom-shortcut-icon2');
                const btn = document.getElementById('btn-custom-shortcut2');
                if (lbl) lbl.innerHTML = 'Agregar<br>Atajo';
                if (icoEl) icoEl.outerHTML = `<svg id="custom-shortcut-icon2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                if (btn) btn.title = 'Atajo personalizado 2 (clic derecho para configurar)';
                this.showToast('Acceso rápido 2 eliminado');
            },

            // ── Shortcut 3 para INICIO ──────────────────────────────────────
            _customShortcut3: null,

            executeCustomShortcut3: function () {
                if (!this._customShortcut3) { this._shortcutPickerTarget = 3; this.openShortcutPicker(); return; }
                try { this._customShortcut3.fn(); } catch(e) {}
            },

            openShortcutContextMenu3: function (e) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const existing = document.getElementById('shortcut-ctx-menu');
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = 'shortcut-ctx-menu';
                menu.style.cssText = `position:fixed;z-index:99999;background:rgba(14,14,18,0.65);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:4px 0;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-size:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                const items = [
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>', label: t('ctx_change_shortcut', 'Cambiar Atajo'), fn: () => { this._shortcutPickerTarget = 3; this.openShortcutPicker(); } },
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: t('btn_delete', 'Eliminar'), fn: () => this.removeCustomShortcut3(), disabled: !this._customShortcut3 },
                ];
                items.forEach(item => {
                    const d = document.createElement('div');
                    d.innerHTML = (item.icon ? item.icon + ' ' : '') + '<span>' + item.label + '</span>'; d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '8px';
                    d.style.cssText = `padding:8px 16px;cursor:${item.disabled?'default':'pointer'};color:${item.disabled?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.92)'};`;
                    if (!item.disabled) {
                        d.onmouseenter = () => d.style.background = 'rgba(99,102,241,0.25)';
                        d.onmouseleave = () => d.style.background = '';
                        d.onclick = () => { menu.remove(); item.fn(); };
                    }
                    menu.appendChild(d);
                });
                document.body.appendChild(menu);
                const mw = menu.offsetWidth||185, mh = menu.offsetHeight||100;
                let left = e.clientX, top = e.clientY;
                if (left+mw > window.innerWidth-8) left = window.innerWidth-mw-8;
                if (top+mh > window.innerHeight-8) top = window.innerHeight-mh-8;
                if (left<8) left=8; if (top<8) top=8;
                menu.style.left = left+'px'; menu.style.top = top+'px';
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 50);
            },

            removeCustomShortcut3: function () {
                this._customShortcut3 = null;
                localStorage.removeItem('alioth_custom_shortcut3');
                const lbl = document.getElementById('custom-shortcut-label3');
                const icoEl = document.getElementById('custom-shortcut-icon3');
                const btn = document.getElementById('btn-custom-shortcut3');
                if (lbl) lbl.innerHTML = 'Agregar<br>Atajo';
                if (icoEl) icoEl.outerHTML = `<svg id="custom-shortcut-icon3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                if (btn) btn.title = 'Atajo personalizado 3 (clic derecho para configurar)';
                this.showToast('Acceso rápido 3 eliminado');
            },

            // ── Shortcuts universales por pestaña ───────────────────────────
            _customShortcutTabs: {},

            executeCustomShortcutTab: function (tab, slot) {
                const key = tab + '_' + slot;
                const sc = this._customShortcutTabs[key];
                if (!sc) { this._shortcutPickerTarget = 'tab_' + key; this.openShortcutPicker(); return; }
                try { sc.fn(); } catch(e) {}
            },

            openShortcutContextMenuTab: function (e, tab, slot) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const existing = document.getElementById('shortcut-ctx-menu');
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = 'shortcut-ctx-menu';
                menu.style.cssText = `position:fixed;z-index:99999;background:rgba(14,14,18,0.65);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:4px 0;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-size:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                const key = tab + '_' + slot;
                const sc = this._customShortcutTabs[key];
                const items = [
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>', label: t('ctx_change_shortcut', 'Cambiar Atajo'), fn: () => { this._shortcutPickerTarget = 'tab_' + key; this.openShortcutPicker(); } },
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: t('btn_delete', 'Eliminar'), fn: () => this._removeCustomShortcutTab(tab, slot), disabled: !sc },
                ];
                items.forEach(item => {
                    const d = document.createElement('div');
                    d.innerHTML = (item.icon ? item.icon + ' ' : '') + '<span>' + item.label + '</span>'; d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '8px';
                    d.style.cssText = `padding:8px 16px;cursor:${item.disabled?'default':'pointer'};color:${item.disabled?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.92)'};`;
                    if (!item.disabled) {
                        d.onmouseenter = () => d.style.background = 'rgba(99,102,241,0.25)';
                        d.onmouseleave = () => d.style.background = '';
                        d.onclick = () => { menu.remove(); item.fn(); };
                    }
                    menu.appendChild(d);
                });
                document.body.appendChild(menu);
                const mw = menu.offsetWidth||185, mh = menu.offsetHeight||100;
                let left = e.clientX, top = e.clientY;
                if (left+mw > window.innerWidth-8) left = window.innerWidth-mw-8;
                if (top+mh > window.innerHeight-8) top = window.innerHeight-mh-8;
                if (left<8) left=8; if (top<8) top=8;
                menu.style.left = left+'px'; menu.style.top = top+'px';
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 50);
            },

            _removeCustomShortcutTab: function (tab, slot) {
                const key = tab + '_' + slot;
                delete this._customShortcutTabs[key];
                localStorage.removeItem('alioth_shortcut_tab_' + key);
                const icoId = 'custom-shortcut-icon-' + tab + slot;
                const lblId = 'custom-shortcut-label-' + tab + slot;
                const btnId = 'btn-custom-shortcut-' + tab + slot;
                const lbl = document.getElementById(lblId);
                const ico = document.getElementById(icoId);
                const btn = document.getElementById(btnId);
                if (lbl) lbl.innerHTML = 'Agregar<br>Atajo';
                if (ico) ico.outerHTML = `<svg id="${icoId}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                if (btn) btn.title = 'Atajo personalizado (clic derecho para configurar)';
                this.showToast('Acceso rápido eliminado');
            },

            // ── Shortcuts independientes para pestaña Inputs ──────────────────
            _customShortcutForm1: null,
            _customShortcutForm2: null,

            executeCustomShortcutForm: function (slot) {
                const sc = slot === 2 ? this._customShortcutForm2 : this._customShortcutForm1;
                if (!sc) { slot === 2 ? this.openShortcutPickerForm2() : this.openShortcutPickerForm1(); return; }
                try { sc.fn(); } catch (e) {}
            },

            openShortcutPickerForm1: function () {
                this._shortcutPickerTarget = 'form1';
                this.openShortcutPicker();
            },

            openShortcutPickerForm2: function () {
                this._shortcutPickerTarget = 'form2';
                this.openShortcutPicker();
            },

            openShortcutContextMenuForm: function (e, slot) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const existing = document.getElementById('shortcut-ctx-menu');
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = 'shortcut-ctx-menu';
                menu.style.cssText = `position:fixed;z-index:99999;background:rgba(14,14,18,0.65);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:4px 0;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-size:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                const sc = slot === 2 ? this._customShortcutForm2 : this._customShortcutForm1;
                const openFn = slot === 2 ? () => this.openShortcutPickerForm2() : () => this.openShortcutPickerForm1();
                const items = [
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>', label: t('ctx_change_shortcut', 'Cambiar Atajo'), fn: openFn },
                    { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', label: t('btn_delete', 'Eliminar'), fn: () => this.removeCustomShortcutForm(slot), disabled: !sc },
                ];
                items.forEach(item => {
                    const d = document.createElement('div');
                    d.innerHTML = (item.icon ? item.icon + ' ' : '') + '<span>' + item.label + '</span>'; d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.gap = '8px';
                    d.style.cssText = `padding:8px 16px;cursor:${item.disabled?'default':'pointer'};color:${item.disabled?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.92)'};`;
                    if (!item.disabled) {
                        d.onmouseenter = () => d.style.background = 'rgba(99,102,241,0.25)';
                        d.onmouseleave = () => d.style.background = '';
                        d.onclick = () => { menu.remove(); item.fn(); };
                    }
                    menu.appendChild(d);
                });
                document.body.appendChild(menu);
                const mw = menu.offsetWidth || 185, mh = menu.offsetHeight || 100;
                let left = e.clientX, top = e.clientY;
                if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
                if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
                if (left < 8) left = 8; if (top < 8) top = 8;
                menu.style.left = left + 'px'; menu.style.top = top + 'px';
                const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
                setTimeout(() => document.addEventListener('mousedown', close), 50);
            },

            _applyShortcutForm: function (slot, item) {
                const key   = slot === 2 ? 'alioth_custom_shortcut_form2' : 'alioth_custom_shortcut_form1';
                const scKey = slot === 2 ? '_customShortcutForm2' : '_customShortcutForm1';
                const lblId = slot === 2 ? 'custom-shortcut-label-form2' : 'custom-shortcut-label-form1';
                const icoId = slot === 2 ? 'custom-shortcut-icon-form2' : 'custom-shortcut-icon-form1';
                const btnId = slot === 2 ? 'btn-custom-shortcut-form2' : 'btn-custom-shortcut-form1';
                this[scKey] = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                localStorage.setItem(key, JSON.stringify({ id: item.id, label: item.label, icon: item.icon }));
                const lbl = document.getElementById(lblId);
                const icoEl = document.getElementById(icoId);
                const btn = document.getElementById(btnId);
                if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                if (icoEl) icoEl.outerHTML = `<span id="${icoId}" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                if (btn) btn.title = item.label;
            },

            removeCustomShortcutForm: function (slot) {
                const key   = slot === 2 ? 'alioth_custom_shortcut_form2' : 'alioth_custom_shortcut_form1';
                const scKey = slot === 2 ? '_customShortcutForm2' : '_customShortcutForm1';
                const lblId = slot === 2 ? 'custom-shortcut-label-form2' : 'custom-shortcut-label-form1';
                const icoId = slot === 2 ? 'custom-shortcut-icon-form2' : 'custom-shortcut-icon-form1';
                const btnId = slot === 2 ? 'btn-custom-shortcut-form2' : 'btn-custom-shortcut-form1';
                this[scKey] = null;
                localStorage.removeItem(key);
                const lbl = document.getElementById(lblId);
                const icoEl = document.getElementById(icoId);
                const btn = document.getElementById(btnId);
                if (lbl) lbl.innerHTML = 'Agregar<br>Atajo';
                if (icoEl) icoEl.outerHTML = `<svg id="${icoId}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
                if (btn) btn.title = 'Atajo personalizado Inputs (clic derecho para configurar)';
                this.showToast('Acceso rápido eliminado');
            },

            /**
             * Detects native PDF form fields (widgets) using Python PyMuPDF
             */
            ribbonCollapsed: false,

            toggleRibbon: function () {
                if (this.ribbonCollapsed) {
                    this.expandRibbon();
                } else {
                    this.collapseRibbon();
                }
            },

            collapseRibbon: function () {
                if (this.ribbonCollapsed) return;
                this.ribbonCollapsed = true;
                const ribbon = document.getElementById('ribbonContainer');
                ribbon.classList.add('collapsed');
                document.body.classList.add('ribbon-is-collapsed');
                document.body.classList.remove('ribbon-is-hovering');
                const tab = document.getElementById('ribbonTab');
                if (tab) tab.innerText = '▼';
                this.updateCollapsedLabels();
                localStorage.setItem('ribbonCollapsed', 'true');
                this.showToast('Cinta contraída');
            },

            expandRibbon: function () {
                if (!this.ribbonCollapsed) return;
                this.ribbonCollapsed = false;
                const ribbon = document.getElementById('ribbonContainer');
                ribbon.classList.remove('collapsed');
                ribbon.classList.remove('collapsed-hover');
                document.body.classList.remove('ribbon-is-collapsed');
                document.body.classList.remove('ribbon-is-hovering');
                // Cancelar cualquier timeout pendiente
                if (this.popupHideTimeout) {
                    clearTimeout(this.popupHideTimeout);
                    this.popupHideTimeout = null;
                }
                // Limpiar event handlers
                ribbon.onmouseleave = null;
                ribbon.onmouseenter = null;
                const tab = document.getElementById('ribbonTab');
                if (tab) tab.innerText = '▲';
                localStorage.setItem('ribbonCollapsed', 'false');
                this.showToast('Cinta expandida');
            },

            showGroupPopup: function (originalSection, groupName) {
                const ribbon = document.getElementById('ribbonContainer');

                // Cancelar cualquier timeout pendiente
                if (this.popupHideTimeout) {
                    clearTimeout(this.popupHideTimeout);
                    this.popupHideTimeout = null;
                }

                // Quitar clase collapsed temporalmente para mostrar las herramientas
                ribbon.classList.remove('collapsed');
                ribbon.classList.add('collapsed-hover');
                document.body.classList.add('ribbon-is-hovering');

                // Handler para colapsar de nuevo con delay
                const scheduleCollapse = () => {
                    this.popupHideTimeout = setTimeout(() => {
                        if (!ribbon.matches(':hover')) {
                            ribbon.classList.add('collapsed');
                            ribbon.classList.remove('collapsed-hover');
                            document.body.classList.remove('ribbon-is-hovering');
                        }
                    }, 400);
                };

                ribbon.onmouseleave = scheduleCollapse;

                // Cancelar colapso si vuelve a entrar
                ribbon.onmouseenter = () => {
                    if (this.popupHideTimeout) {
                        clearTimeout(this.popupHideTimeout);
                        this.popupHideTimeout = null;
                    }
                };
            },

            toggleGrid: function () {
                this.showGrid = !this.showGrid;
                const activePanel = this.splitView.activePanel;
                const elements = this.getPanelElements(activePanel);
                if (elements.gridLayer) {
                    elements.gridLayer.style.display = this.showGrid ? 'block' : 'none';
                }
                if (this.showGrid) this.updateGrid(activePanel);
                const btn = document.getElementById('toggleGrid');
                if (btn) btn.classList.toggle('active', this.showGrid);
            },

            // Form Mode Toggle - enables/disables interactive form fields
            toggleFormMode: function () {
                this.isFormMode = !this.isFormMode;
                const btn = document.getElementById('formToggle');
                if (btn) {
                    btn.classList.toggle('active', this.isFormMode);
                    btn.title = this.isFormMode ? 'Modo Formulario: ACTIVO' : 'Modo Formulario: INACTIVO';
                }

                // Toggle annotation layer visibility for both panels
                ['primary', 'secondary'].forEach(panelId => {
                    const elements = this.getPanelElements(panelId);
                    if (elements.annotationLayer) {
                        // Don't restore annotation layer if field edit mode is active
                        if (this.isFieldEditMode) {
                            elements.annotationLayer.style.display = 'none';
                            elements.annotationLayer.style.pointerEvents = 'none';
                        } else {
                            // Always show annotation layer (for native comments)
                            elements.annotationLayer.style.display = 'block';
                            // Crucial: background transparent to clicks, children will override
                            elements.annotationLayer.style.pointerEvents = 'none';
                            
                            // Hide/show form widgets based on form mode, but keep comment pins visible
                            elements.annotationLayer.querySelectorAll('.textWidgetAnnotation, .buttonWidgetAnnotation, .choiceWidgetAnnotation').forEach(w => {
                                w.style.display = this.isFormMode ? '' : 'none';
                                w.style.pointerEvents = this.isFormMode ? 'auto' : 'none';
                            });
                            elements.annotationLayer.querySelectorAll('.native-comment-pin').forEach(p => {
                                p.style.display = 'flex';
                                p.style.pointerEvents = 'auto';
                            });
                        }
                    }
                });

                this.showToast(this.isFormMode ? 'Modo Formulario Activado' : 'Modo Formulario Desactivado');

                // Re-render current page to apply changes
                if (this.isFormMode) {
                    const doc = this.getDoc();
                    if (doc && doc.pages.length > 0) {
                        this.loadPage(doc.currentIndex);
                    }
                }
            },

            // ===================== EVENT DELEGATION HELPERS =====================
            setupDelegatedEvents: function () {
                if (this.delegatedEventsSetup) return;
                this.delegatedEventsSetup = true;
                console.log('Setting up delegated events for Drag/Drop (DEBUG MODE)');
                const handler = (e) => {
                    // console.log('Global Mousedown Check (FORCE):', e.target.tagName, e.target.className);
                    // DEBUG TRACE
                    // console.log('Global Mousedown Check:', e.target, 'Tool:', this.drawTool, 'Hand:', this.isHandMode);

                    if (this.isHandMode) return;
                    if (this.isBoxSelectMode) return;

                    // Si el RTIE está abierto y el clic NO es dentro del editor, ignorar para no abrir otro editor
                    const rtieEditor = document.getElementById('real-text-inline-editor');
                    if (rtieEditor) return;

                    // Si hay un span en modo real-edit activo, ignorar clicks que no sean sobre él
                    if (this._realEditMode || this.editingObjId) {
                        const editingSpan = this.editingObjId ? document.getElementById(this.editingObjId) : null;
                        if (editingSpan && !editingSpan.contains(e.target)) return;
                    }

                    // Tool Check: Allow select, cursor, or 'none' (default)
                    if (this.drawTool && this.drawTool !== 'select' && this.drawTool !== 'cursor' && this.drawTool !== 'none') {
                        return;
                    }

                    // FIX: Exclude internal-resize-handle for tables - let their own events handle it
                    if (e.target.classList.contains('internal-resize-handle')) {
                        return;
                    }

                    // Filter: Only care if clicking on overlay layer contents
                    const overlayLayer = e.target.closest('[id^="overlay-layer"]');
                    if (!overlayLayer) return;

                    console.log('DEBUG: Valid Click Context. Panel:', overlayLayer.id);

                    // Identify Panel
                    const isSecondary = overlayLayer.id.includes('secondary');
                    const panelId = isSecondary ? 'secondary' : 'primary';
                    this.splitView.activePanel = panelId;

                    // 1. Resize Handle
                    let target = e.target;
                    if (target.classList.contains('resize-handle')) {
                        console.log('DELEGATION: Resize Handle Clicked');
                        const draggable = target.closest('.draggable');
                        if (draggable) {
                            const obj = this.getObjectById(draggable.id, panelId);
                            if (obj) {
                                // FIX: Conflict resolution. Interact.js handles text resizing.
                                // Manual startResize creates a feedback loop and "exploding" text size.
                                if (obj.type === 'text') {
                                    console.log('🛑 Skipping manual resize for Text (handled by Interact.js)');
                                    return;
                                }

                                e.stopPropagation(); e.preventDefault();
                                console.log('DELEGATION: Resize Handle Clicked');
                                // Extract direction from handle class (rh-tl, rh-br, etc.)
                                const handleDir = [...target.classList].find(c => c.startsWith('rh-')) || 'rh-br';
                                this.startResize(e, draggable, obj, handleDir);
                            }
                        }
                        return;
                    }

                    // 2. Rotate Handle
                    if (target.classList.contains('rotate-handle')) {
                        const draggable = target.closest('.draggable');
                        if (draggable) {
                            const obj = this.getObjectById(draggable.id, panelId);
                            if (obj) {
                                e.stopPropagation(); e.preventDefault();
                                this.startRotate(e, draggable, obj);
                            }
                        }
                        return;
                    }

                    // 3. Draggable Object (including Interaction Shield)
                    const draggable = target.closest('.draggable');
                    if (draggable) {
                        // CRITICAL: If object is in editing mode (contentEditable), allow default behavior (text selection)
                        if (draggable.classList.contains('editing') || target.isContentEditable) {
                            return;
                        }

                        // Locked form fields (field edit mode OFF) → block all interaction
                        if (draggable.classList.contains('locked')) {
                            return;
                        }

                        const obj = this.getObjectById(draggable.id, panelId);
                        if (obj) {
                            // --- MANUAL DOUBLE CLICK DETECTION ---
                            const now = Date.now();
                            if (this.lastClickTarget === obj.id && (now - (this.lastClickTime || 0) < 300)) {
                                console.log('Manual Double Click Detected:', obj.id);
                                e.preventDefault(); e.stopPropagation();
                                this.lastClickTime = 0; // Reset

                                if (obj.type === 'text') {
                                    // Check if this was a converted form field - show properties instead of edit
                                    if (obj.fromFormField) {
                                        this.openProperties(obj);
                                    } else {
                                        this.editText(obj);
                                    }
                                    return;
                                } else if (obj.type === 'form-field') {
                                    this.openProperties(obj);
                                    return;
                                } else if (obj.type === 'link') {
                                    this.editLink(obj);
                                    return;
                                } else if (obj.type === 'table') {
                                    if (e.target.tagName === 'TD' || e.target.isContentEditable) return;
                                    this.openTableProperties(obj);
                                    return;
                                }
                            }

                            this.lastClickTarget = obj.id;
                            this.lastClickTime = now;
                            // -------------------------------------

                            e.preventDefault(); e.stopPropagation();
                            console.log('Delegated drag start:', obj.id, panelId);
                            this.handleObjectSelection(e, obj, draggable);
                            // Add resize/rotate handles directly to selected element (no full re-render)
                            document.querySelectorAll('.draggable .resize-handle, .draggable .rotate-handle').forEach(h => h.remove());
                            if (!draggable.classList.contains('locked') && (this.multiObjectSelection.size === 1 || (this.multiObjectSelection.size > 1 && this.multiObjectSelection.has(obj.id)))) {
                                const handleClasses = ['rh-tl','rh-tr','rh-bl','rh-br','rh-tc','rh-bc','rh-ml','rh-mr'];
                                handleClasses.forEach(h => {
                                    const rh = document.createElement('div');
                                    rh.className = 'resize-handle ' + h;
                                    draggable.appendChild(rh);
                                });
                                const rot = document.createElement('div');
                                rot.className = 'rotate-handle';
                                draggable.appendChild(rot);
                            }
                            // Don't start drag on Ctrl/Shift+Click — just add to selection
                            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                            this.startDrag(e, draggable, obj);
                        }
                    }
                };

                // Attach to document (delegation root)
                document.addEventListener('mousedown', handler, true);

                // Double Click Delegation (Properties)
                document.addEventListener('dblclick', (e) => {
                    if (this.isHandMode) return;
                    // Si el editor RTIE está abierto, no procesar dblclick (evita cerrar el textarea)
                    if (document.getElementById('real-text-inline-editor')) return;
                    const overlayLayer = e.target.closest('[id^="overlay-layer"]');
                    if (!overlayLayer) return;

                    const isSecondary = overlayLayer.id.includes('secondary');
                    const panelId = isSecondary ? 'secondary' : 'primary';
                    const draggable = e.target.closest('.draggable');

                    if (draggable) {
                        const obj = this.getObjectById(draggable.id, panelId);
                        if (obj) {
                            if (obj.type === 'form-field') {
                                e.preventDefault(); e.stopPropagation();
                                this.openProperties(obj);
                            } else if (obj.type === 'text') {
                                if (obj.isEditing) return; // Allow native double-click text selection
                                e.preventDefault(); e.stopPropagation();
                                // Check if this was a converted form field
                                if (obj.fromFormField) {
                                    this.openProperties(obj);
                                } else {
                                    this.editText(obj);
                                }
                            } else if (obj.type === 'image') {
                                e.preventDefault(); e.stopPropagation();
                                this.selectedObj = obj;
                                this.switchRibbon('image');
                            } else if (obj.type === 'table') {
                                if (e.target.tagName === 'TD' || e.target.isContentEditable) return;
                                e.preventDefault(); e.stopPropagation();
                                this.openTableProperties(obj);
                            } else if (obj.type === 'shape' || obj.type === 'connector') {
                                e.preventDefault(); e.stopPropagation();
                                this.selectedObj = obj;
                                this.openShapeProperties(obj);
                            }
                        }
                        // Edit text optimization could go here too
                    }
                }, true);

                // Context Menu Delegation
                document.addEventListener('contextmenu', (e) => {
                    const overlayLayer = e.target.closest('[id^="overlay-layer"]');
                    if (!overlayLayer) {
                        // Bloquear clic derecho en el área principal si no hay documento abierto
                        const inMainView = e.target.closest('#mainViewPrimary, #mainViewSecondary, #splitContainer, .workspace-area');
                        if (inMainView && !this.getDoc()) {
                            e.preventDefault();
                            return;
                        }
                        return;
                    }

                    const isSecondary = overlayLayer.id.includes('secondary');
                    const panelId = isSecondary ? 'secondary' : 'primary';
                    const draggable = e.target.closest('.draggable');

                    if (draggable) {
                        const obj = this.getObjectById(draggable.id, panelId);
                        if (obj) {
                            e.preventDefault(); e.stopPropagation();
                            // Preserve multi-selection if right-clicking within it
                            if (!this.multiObjectSelection.has(obj.id)) {
                                this.multiObjectSelection.clear();
                                this.multiObjectSelection.add(obj.id);
                            }
                            this.selectedObj = obj;
                            this.showContextMenu(e, obj);
                        }
                    }
                }, true); // Capture context menu
            },

            setupScrollNavigation: function () {
                const handleScroll = (e) => {
                    if (e.ctrlKey) return;
                    // Block page navigation briefly after zoom
                    if (this._zoomJustFinished && Date.now() - this._zoomJustFinished < 800) return;

                    const target = e.currentTarget;
                    if (!target) return;

                    // 1. Identify Panel
                    const panelId = target.id === 'mainViewSecondary' ? 'secondary' : 'primary';

                    // 2. Auto-activate panel on scroll (fixes sidebar sync issues)
                    if (this.splitView.activePanel !== panelId) {
                        this.setActivePanel(panelId);
                    }

                    const panelState = this.splitView[panelId];
                    const docId = panelState?.docId || this.activeDocId;
                    const doc = this.docs.find(d => d.id === docId);

                    if (!doc) return;

                    // 3. Stabilize Debounce
                    const now = Date.now();
                    if (this.scrollDebounce && (now - this.scrollDebounce < 300)) return;

                    const delta = e.deltaY;
                    const isH = document.body.classList.contains('h-layout');
                    if (isH) {
                        const scrollLeft = target.scrollLeft;
                        const scrollWidth = target.scrollWidth;
                        const clientWidth = target.clientWidth;
                        const threshold = 20;

                        if (delta > 0) {
                            if (Math.ceil(scrollLeft + clientWidth) >= Math.floor(scrollWidth - threshold)) {
                                if (doc.currentIndex < doc.pages.length - 1) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    this.scrollDebounce = now;
                                    target.scrollLeft = 0;
                                    console.log('📜 handleScroll: going to page', doc.currentIndex + 1, 'scrollLeft=', scrollLeft, 'scrollWidth=', scrollWidth, 'clientWidth=', clientWidth);
                                    this.loadPage(doc.currentIndex + 1, panelId);
                                }
                            }
                        } else if (delta < 0) {
                            if (scrollLeft <= threshold) {
                                if (doc.currentIndex > 0) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    this.scrollDebounce = now;
                                    target.scrollLeft = 0;
                                    console.log('📜 handleScroll: going to page', doc.currentIndex - 1, 'scrollLeft=', scrollLeft);
                                    this.loadPage(doc.currentIndex - 1, panelId);
                                }
                            }
                        }
                    } else {
                        const scrollTop = target.scrollTop;
                        const scrollHeight = target.scrollHeight;
                        const clientHeight = target.clientHeight;
                        const threshold = 20;

                        if (delta > 0) {
                            if (Math.ceil(scrollTop + clientHeight) >= Math.floor(scrollHeight - threshold)) {
                                if (doc.currentIndex < doc.pages.length - 1) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    this.scrollDebounce = now;
                                    target.scrollTop = 0;
                                    console.log('📜 handleScroll: going to page', doc.currentIndex + 1, 'scrollTop=', scrollTop, 'scrollHeight=', scrollHeight, 'clientHeight=', clientHeight);
                                    this.loadPage(doc.currentIndex + 1, panelId);
                                }
                            }
                        } else if (delta < 0) {
                            if (scrollTop <= threshold) {
                                if (doc.currentIndex > 0) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    this.scrollDebounce = now;
                                    target.scrollTop = 0;
                                    console.log('📜 handleScroll: going to page', doc.currentIndex - 1, 'scrollTop=', scrollTop);
                                    this.loadPage(doc.currentIndex - 1, panelId);
                                }
                            }
                        }
                    }
                };

                const mainPrimary = document.getElementById('mainViewPrimary');
                const mainSecondary = document.getElementById('mainViewSecondary');

                if (mainPrimary) mainPrimary.addEventListener('wheel', handleScroll);
                if (mainSecondary) mainSecondary.addEventListener('wheel', handleScroll);
            },
            getPanelElements: function (panelId = 'primary') {
                const suffix = panelId === 'secondary' ? '-secondary' : '';
                return {
                    canvas: document.getElementById('the-canvas' + suffix),
                    drawingLayer: document.getElementById('drawing-layer' + suffix),
                    overlayLayer: document.getElementById('overlay-layer' + suffix),
                    canvasContainer: document.getElementById('canvas-container' + suffix),
                    gridLayer: document.getElementById('grid-layer' + suffix),
                    annotationLayer: document.getElementById('annotation-layer' + suffix),
                    rulerH: document.getElementById('ruler-top' + suffix),
                    rulerV: document.getElementById('ruler-left' + suffix),
                    mainView: document.getElementById(panelId === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary'),
                    emptyMsg: panelId === 'secondary'
                        ? document.querySelector('.workspace-empty-msg-secondary')
                        : document.getElementById('workspace-empty-msg'),
                    panel: document.getElementById(panelId === 'secondary' ? 'panelSecondary' : 'panelPrimary')
                };
            },

            toggleRuler: function () {
                this.showRuler = !this.showRuler;
                const activePanel = this.splitView.activePanel;
                const elements = this.getPanelElements(activePanel);
                if (elements.rulerH) elements.rulerH.style.display = this.showRuler ? 'block' : 'none';
                if (elements.rulerV) elements.rulerV.style.display = this.showRuler ? 'block' : 'none';
                if (this.showRuler) this.updateRulers(activePanel);

                // Update active states on ruler toggle buttons
                const btn = document.getElementById('toggleRuler');
                if (btn) btn.classList.toggle('active', this.showRuler);
                const ribbonBtn = document.getElementById('toggleRulerRibbon');
                if (ribbonBtn) ribbonBtn.classList.toggle('active', this.showRuler);
            },

            setSplitView: function (mode) {
                if (document.body.classList.contains('h-layout') && mode !== 'single') {
                    mode = 'single';
                }

                const container = document.getElementById('splitContainer');
                const btns = [
                    'btn-view-single', 'btn-view-horizontal', 'btn-view-vertical',
                    'btn-view-single-ribbon', 'btn-view-horizontal-ribbon', 'btn-view-vertical-ribbon'
                ];

                // Remove all mode classes
                container.classList.remove('single', 'horizontal', 'vertical');
                btns.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.remove('active-view');
                });

                // Apply new mode
                this.splitView.mode = mode;
                container.classList.add(mode);

                // Preserve current scale of active doc
                const activeDoc = this.getDoc();
                const currentActiveScale = this.currentScale || (activeDoc && activeDoc.scale) || 1.0;
                if (activeDoc) activeDoc.scale = currentActiveScale;

                // Update button states
                const activeIds = [];
                if (mode === 'single') {
                    activeIds.push('btn-view-single', 'btn-view-single-ribbon');
                    this.splitView.activePanel = 'primary';
                    document.getElementById('panelPrimary').style.flex = '1';
                    document.getElementById('panelSecondary').style.flex = '1';
                    if (this.splitView.primary) {
                        this.splitView.primary.scale = currentActiveScale;
                    }
                    this.currentScale = currentActiveScale;
                    const zi = document.getElementById('zoomInput');
                    if (zi) zi.value = Math.round(currentActiveScale * 100) + '%';
                    const zs = document.getElementById('zoomSlider');
                    if (zs) zs.value = Math.max(20, Math.min(500, Math.round(currentActiveScale * 100)));
                } else if (mode === 'horizontal') {
                    activeIds.push('btn-view-horizontal', 'btn-view-horizontal-ribbon');
                } else if (mode === 'vertical') {
                    activeIds.push('btn-view-vertical', 'btn-view-vertical-ribbon');
                }

                activeIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('active-view');
                });

                // SMART DOCUMENT DISTRIBUTION:
                // If we have 2+ documents with pages, automatically distribute them
                const docsWithPages = this.docs.filter(d => d.pages && d.pages.length > 0);

                if (docsWithPages.length >= 2) {
                    // Find the current active document
                    const currentDoc = docsWithPages.find(d => d.id === this.activeDocId);
                    // Find a different document for the secondary panel
                    const secondaryDoc = docsWithPages.find(d => d.id !== this.activeDocId);

                    if (currentDoc && secondaryDoc) {
                        // Set primary to active document
                        this.splitView.primary = {
                            docId: currentDoc.id,
                            pageIndex: currentDoc.currentIndex || 0,
                            scale: currentDoc.scale || this.currentScale || 1.0
                        };

                        // Set secondary to the other document
                        this.splitView.secondary = {
                            docId: secondaryDoc.id,
                            pageIndex: secondaryDoc.currentIndex || 0,
                            scale: secondaryDoc.scale || 1.0
                        };
                    }
                } else {
                    // Only one document or no documents with pages
                    // Clear secondary panel if it has the same document or no document
                    if (!this.splitView.secondary.docId ||
                        this.splitView.secondary.docId === this.splitView.primary.docId) {
                        this.splitView.secondary = { docId: null, pageIndex: 0, scale: 1.0 };
                    }
                }

                this.renderPanelContent('primary');
                this.renderPanelContent('secondary');

                this.updatePanelFocus();
                this.applySplitRatio();
                this.updatePanelHeaders();
                this.showToast(`Vista: ${mode === 'single' ? 'Única' : mode === 'horizontal' ? 'Paralela' : 'Arriba/Abajo'} `);
            },

            // Rescata el canvasContainer de dentro del scroll-stack y lo devuelve a mainView.
            // Debe llamarse ANTES de eliminar el stack o de cambiar de documento en modo continuo.
            toggleViewMode: function () {
                // Preservar escala actual antes del cambio de modo
                const savedScale = this.currentScale || (this.getDoc() && this.getDoc().scale) || 1.0;
                const activeDoc = this.getDoc();
                if (activeDoc) activeDoc.scale = savedScale;
                if (this.splitView && this.splitView.primary) {
                    this.splitView.primary.scale = savedScale;
                }

                // Si salimos del modo continuo, rescatar el canvas antes de cambiar
                if (this.viewMode === 'continuous') {
                    this._rescueCanvasFromContinuous('primary');
                    this._rescueCanvasFromContinuous('secondary');
                }
                // Limpiar flag de auto-restauración para que el toggle manual sea definitivo
                this._wasInContinuous = false;
                this.viewMode = this.viewMode === 'single' ? 'continuous' : 'single';
                if (this.viewMode === 'single' && this.isTwoUpView) {
                    this.isTwoUpView = false;
                    const btnTwoUp = document.getElementById('toggleTwoUp');
                    if (btnTwoUp) btnTwoUp.classList.remove('active-view');
                }
                const btn = document.getElementById('toggleContinuous');
                if (btn) btn.classList.toggle('active-view', this.viewMode === 'continuous');

                this.currentScale = savedScale;
                const zi = document.getElementById('zoomInput');
                if (zi) zi.value = Math.round(savedScale * 100) + '%';
                const zs = document.getElementById('zoomSlider');
                if (zs) zs.value = Math.max(20, Math.min(500, Math.round(savedScale * 100)));

                this.renderPanelContent('primary');
                if (this.splitView.mode !== 'single') {
                    this.renderPanelContent('secondary');
                }

                this.showToast(`Modo de vista: ${this.viewMode === 'single' ? 'Página Única' : 'Vista Continua'}`);
            },

            setActivePanel: function (panel) {
                this.splitView.activePanel = panel;
                this.updatePanelFocus();

                // Update sidebar to show docs of active panel
                const panelState = this.splitView[panel];
                if (panelState && panelState.docId) {
                    // Switch main activeDocId to match focused panel
                    this.activeDocId = panelState.docId;
                    this.currentScale = panelState.scale || 1.0;
                    const doc = this.getDoc();
                    if (doc) {
                        doc.currentIndex = panelState.pageIndex;
                        // Update UI controls without re-rendering (content already rendered)
                        this.setPageCount(`${panelState.pageIndex + 1} / ${doc.pages.length}`);
                        const zi = document.getElementById('zoomInput');
                        if (zi) zi.value = Math.round(this.currentScale * 100) + '%';
                        const zs = document.getElementById('zoomSlider');
                        if (zs) zs.value = Math.max(20, Math.min(500, Math.round(this.currentScale * 100)));
                        this.renderSidebar();
                        this.updateUndoRedoUI();
                        this.updateWindowTitle();
                    }
                }
            },

            updatePanelFocus: function () {
                const primaryPanel = document.getElementById('panelPrimary');
                const secondaryPanel = document.getElementById('panelSecondary');

                primaryPanel.classList.toggle('focused', this.splitView.activePanel === 'primary');
                secondaryPanel.classList.toggle('focused', this.splitView.activePanel === 'secondary');
            },

            swapPanels: function () {
                if (this.splitView.mode === 'single') return;

                // Swap the panel states
                const temp = { ...this.splitView.primary };
                this.splitView.primary = { ...this.splitView.secondary };
                this.splitView.secondary = temp;

                // Re-render BOTH panels
                this.renderPanelContent('primary');
                this.renderPanelContent('secondary');

                // Update headers and active doc
                this.updatePanelHeaders();

                // Sync activeDocId with current active panel
                const activeState = this.splitView[this.splitView.activePanel];
                if (activeState && activeState.docId) {
                    this.activeDocId = activeState.docId;
                    this.currentScale = activeState.scale || 1.0;
                    this.renderSidebar();
                }

                this.showToast('Paneles intercambiados');
            },

            closePrimaryPanel: function () {
                // Transfer secondary panel state to primary
                this.splitView.primary = {
                    docId: this.splitView.secondary.docId,
                    pageIndex: this.splitView.secondary.pageIndex,
                    scale: this.splitView.secondary.scale
                };
                this.splitView.secondary = { docId: null, pageIndex: 0, scale: 1.0 };
                this.setSplitView('single');
                // Set focus back to primary panel
                this.splitView.activePanel = 'primary';
                // Sync activeDocId with primary panel
                const primaryState = this.splitView.primary;
                if (primaryState && primaryState.docId) {
                    this.activeDocId = primaryState.docId;
                    this.currentScale = primaryState.scale || 1.0;
                    const doc = this.getDoc();
                    if (doc) {
                        this.setPageCount(`${primaryState.pageIndex + 1} / ${doc.pages.length}`);
                        const zoomInput = document.getElementById('zoomInput');
                        if (zoomInput) {
                            zoomInput.value = Math.round(this.currentScale * 100) + '%';
                        }
                    }
                }
                this.renderSidebar();
                this.updatePanelHeaders();
                this.renderPanelContent('primary');
            },

            closeSecondaryPanel: function () {
                this.splitView.secondary = { docId: null, pageIndex: 0, scale: 1.0 };
                this.setSplitView('single');
                // Set focus back to primary panel
                this.splitView.activePanel = 'primary';
                // Sync activeDocId with primary panel
                const primaryState = this.splitView.primary;
                if (primaryState && primaryState.docId) {
                    this.activeDocId = primaryState.docId;
                    this.currentScale = primaryState.scale || 1.0;
                    const doc = this.getDoc();
                    if (doc) {
                        this.setPageCount(`${primaryState.pageIndex + 1} / ${doc.pages.length}`);
                        document.getElementById('zoomInput').value =
                            Math.round(this.currentScale * 100) + '%';
                    }
                }
                this.renderSidebar();
                this.updatePanelHeaders();
            },

            updatePanelHeaders: function () {
                // Primary panel header
                const primaryDoc = this.docs.find(d => d.id === this.splitView.primary.docId);
                document.getElementById('panelPrimaryDocName').textContent = primaryDoc ? primaryDoc.name : 'Sin documento';
                document.getElementById('panelPrimaryZoom').textContent = Math.round(this.splitView.primary.scale * 100) + '%';

                // Secondary panel header
                const secondaryDoc = this.docs.find(d => d.id === this.splitView.secondary.docId);
                document.getElementById('panelSecondaryDocName').textContent = secondaryDoc ? secondaryDoc.name : 'Sin documento';
                document.getElementById('panelSecondaryZoom').textContent = Math.round(this.splitView.secondary.scale * 100) + '%';
            },

            applySplitRatio: function () {
                if (this.splitView.mode === 'single') return;

                const primaryPanel = document.getElementById('panelPrimary');
                const secondaryPanel = document.getElementById('panelSecondary');
                const ratio = this.splitView.dividerRatio;

                if (this.splitView.mode === 'horizontal') {
                    primaryPanel.style.flex = `0 0 ${ratio * 100}%`;
                    secondaryPanel.style.flex = `0 0 ${(1 - ratio) * 100}%`;
                } else if (this.splitView.mode === 'vertical') {
                    primaryPanel.style.flex = `0 0 ${ratio * 100}%`;
                    secondaryPanel.style.flex = `0 0 ${(1 - ratio) * 100}%`;
                }
            },

            setupSplitDivider: function () {
                const divider = document.getElementById('splitDivider');
                let isDragging = false;

                divider.addEventListener('mousedown', (e) => {
                    if (e.target.classList.contains('swap-btn')) return;
                    isDragging = true;
                    divider.classList.add('dragging');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging || this.splitView.mode === 'single') return;

                    const container = document.getElementById('splitContainer');
                    const rect = container.getBoundingClientRect();
                    const isVertical = this.splitView.mode === 'vertical';

                    let ratio;
                    if (isVertical) {
                        ratio = (e.clientY - rect.top) / rect.height;
                    } else {
                        ratio = (e.clientX - rect.left) / rect.width;
                    }

                    // Limit ratio between 20% and 80%
                    this.splitView.dividerRatio = Math.max(0.2, Math.min(0.8, ratio));
                    this.applySplitRatio();
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        divider.classList.remove('dragging');
                    }
                });
            },

            openDocumentInPanel: function (docId, panelId) {
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                // IMPORTANT: Activate split mode FIRST, before setting panel state
                // This prevents setSplitView from resetting secondary panel's docId
                if (panelId === 'secondary' && this.splitView.mode === 'single') {
                    this.setSplitView('horizontal');
                }

                // NOW set the panel state (after split mode is active)
                this.splitView[panelId] = {
                    docId: docId,
                    pageIndex: doc.currentIndex || 0,
                    scale: doc.scale || 1.0
                };

                this.renderPanelContent(panelId);
                this.updatePanelHeaders();
                this.setActivePanel(panelId);
            },

            showPanelSelectionModal: function (docId) {
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const overlay = document.createElement('div');
                overlay.className = 'glass-overlay';
                overlay.style.cssText = 'display:flex; z-index:13000;';

                const modal = document.createElement('div');
                modal.className = 'glass-box';
                modal.style.cssText = 'min-width:320px; text-align:left; padding:24px;';

                const btnStyle = `
                    display:block; width:100%; padding:14px 16px; border-radius:10px;
                    background:rgba(255,255,255,0.06); cursor:pointer; text-align:left;
                    color:#f0f4ff; font-family:inherit; font-size:13px;
                    transition:background 0.15s, transform 0.1s;
                    border:1px solid rgba(255,255,255,0.18);
                `;

                modal.innerHTML = `
                    <h3 style="margin:0 0 6px;font-size:15px;font-weight:600;color:#fff;">📄 ${doc.name}</h3>
                    <p style="margin:0 0 18px;font-size:12px;color:rgba(200,215,255,0.55);">¿Dónde deseas abrir este documento?</p>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        <button id="psel-new" style="${btnStyle} border-color:rgba(255,255,255,0.22);">
                            <div style="font-size:16px;margin-bottom:4px;">🪟</div>
                            <strong style="color:#fff;font-size:13px;">Abrir en Nueva Ventana</strong><br>
                            <small style="color:rgba(200,215,255,0.5);font-size:11px;">Abre una instancia separada de la aplicación</small>
                        </button>
                        <button id="psel-secondary" style="${btnStyle} border-color:rgba(99,102,241,0.5);">
                            <div style="font-size:16px;margin-bottom:4px;">🗂️</div>
                            <strong style="color:#fff;font-size:13px;">Vista Paralela</strong><br>
                            <small style="color:rgba(147,150,255,0.75);font-size:11px;">Abrir en panel junto al actual</small>
                        </button>
                    </div>
                    <button id="psel-cancel" style="
                        margin-top:16px;padding:8px 16px;border:none;
                        background:transparent;cursor:pointer;color:rgba(200,215,255,0.4);
                        width:100%;font-size:12px;font-family:inherit;transition:color 0.15s;
                    ">Cancelar</button>
                `;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const btnN = modal.querySelector('#psel-new');
                const btnS = modal.querySelector('#psel-secondary');
                const btnC = modal.querySelector('#psel-cancel');
                [btnN, btnS].forEach(b => {
                    b.onmouseenter = () => { b.style.background='rgba(255,255,255,0.13)'; b.style.transform='translateY(-1px)'; };
                    b.onmouseleave = () => { b.style.background='rgba(255,255,255,0.06)'; b.style.transform=''; };
                });
                btnC.onmouseenter = () => btnC.style.color = 'rgba(200,215,255,0.75)';
                btnC.onmouseleave = () => btnC.style.color = 'rgba(200,215,255,0.4)';

                const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
                btnN.onclick = () => { this.detachTabToNewWindow(docId); close(); };
                btnS.onclick = () => { this.openDocumentInPanel(docId, 'secondary'); close(); };
                btnC.onclick = close;
                overlay.onclick = (e) => { if (e.target === overlay) close(); };
                const onKey = (e) => { if (e.key==='Escape') { close(); document.removeEventListener('keydown', onKey); } };
                document.addEventListener('keydown', onKey);
            },
            clearDropFeedback: function () {
                const overlay = document.getElementById('drop-overlay');
                if (overlay) overlay.style.display = 'none';
                document.querySelectorAll('.view-panel.drag-over').forEach(panel => panel.classList.remove('drag-over'));
                document.querySelectorAll('.thumb-wrap').forEach(thumb => thumb.classList.remove('drop-target-top', 'drop-target-bottom'));
            },

            setupPanelEvents: function () {
                if (this.panelEventsSetup) return;
                this.panelEventsSetup = true;
                // MEMORY LEAK FIX: Prevent re-attaching listeners on re-init
                if (this._panelEventsSetup) {
                    console.log('⚠ Panel events already setup, skipping duplicate attachment');
                    return;
                }
                this._panelEventsSetup = true;
                document.addEventListener('drop', e => {
                    this.clearDropFeedback();
                    const files = Array.from(e?.dataTransfer?.files || []);
                    files.forEach(file => this.resolveFileOriginPath?.(file));
                    const modal = document.getElementById('drop-modal-content');
                    if (files.length && modal && modal.style.display !== 'none') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        this.handleSidebarDrop(files, null, e.target.closest?.('#drop-zone-secondary') ? 'secondary' : 'primary');
                    }
                }, true);
                document.addEventListener('dragend', () => this.clearDropFeedback(), true);
                window.addEventListener('blur', () => this.clearDropFeedback());
                document.addEventListener('dragover', e => {
                    const modal = document.getElementById('drop-modal-content');
                    if (modal && modal.style.display !== 'none' && e.dataTransfer?.types.includes('Files')) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    document.querySelectorAll('.view-panel.drag-over').forEach(panel => {
                        if (!panel.contains(e.target)) panel.classList.remove('drag-over');
                    });
                }, true);

                // Click on panels to set focus
                const primaryPanel = document.getElementById('panelPrimary');
                const secondaryPanel = document.getElementById('panelSecondary');
                const primaryMainView = document.getElementById('mainViewPrimary');
                const secondaryMainView = document.getElementById('mainViewSecondary');

                // NULL SAFETY: Handle missing elements gracefully
                if (!primaryPanel || !secondaryPanel) {
                    console.warn('⚠ Panel elements not found in setupPanelEvents');
                    return;
                }

                primaryPanel.addEventListener('click', (e) => {
                    if (this.splitView.mode !== 'single') {
                        this.setActivePanel('primary');
                    }
                });

                secondaryPanel.addEventListener('click', (e) => {
                    if (this.splitView.mode !== 'single') {
                        this.setActivePanel('secondary');
                    }
                });

                // Drag and drop on panels - using capture phase to intercept events first
                const setupPanelDrop = (panel, mainView, panelId) => {
                    const handleDragOver = (e) => {
                        // Check for document tab drag or file drag
                        const isTabDrag = e.dataTransfer.types.includes('text/doc-tab-id');
                        const isFileDrag = e.dataTransfer.types.includes('Files');
                        if (isTabDrag || isFileDrag) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            panel.classList.add('drag-over');
                        }
                    };

                    const handleDragLeave = (e) => {
                        // Only remove if leaving the panel entirely
                        const rect = panel.getBoundingClientRect();
                        if (e.clientX < rect.left || e.clientX > rect.right ||
                            e.clientY < rect.top || e.clientY > rect.bottom) {
                            panel.classList.remove('drag-over');
                        }
                    };

                    const handleDrop = (e) => {
                        panel.classList.remove('drag-over');
                        const docId = e.dataTransfer.getData('text/doc-tab-id');
                        if (docId && this.docs.some(d => d.id === docId)) {
                            if (this.splitView.mode !== 'single') {
                                e.preventDefault();
                                e.stopPropagation();
                                this.openDocumentInPanel(docId, panelId);
                                return false;
                            }
                            if (this.docs.length > 1) {
                                e.preventDefault();
                                e.stopPropagation();
                                this.detachTabToNewWindow(docId);
                                return false;
                            }
                        }
                    };

                    // Add to panel with capture
                    panel.addEventListener('dragover', handleDragOver, true);
                    panel.addEventListener('dragleave', handleDragLeave, true);
                    panel.addEventListener('drop', handleDrop, true);

                    // Also add to main-view inside panel
                    if (mainView) {
                        mainView.addEventListener('dragover', handleDragOver, true);
                        mainView.addEventListener('drop', handleDrop, true);
                    }
                };

                setupPanelDrop(primaryPanel, primaryMainView, 'primary');
                setupPanelDrop(secondaryPanel, secondaryMainView, 'secondary');
            },

            detachTabToNewWindow: function(docId) {
                if (this._translationReviewDocId === docId && this._translationReviewPhase !== 'idle') {
                    this.showToast?.('Cancela la traducción antes de mover esta pestaña a otra ventana.');
                    return;
                }
                const doc = this.docs.find(d => d.id === docId);
                if (!doc || doc.pages.length === 0) {
                    this.showToast('⚠️ El documento está vacío');
                    return;
                }
                const sourcesBuffers = {};
                for (const [srcId, src] of Object.entries(doc.sources)) {
                    if (src && src.buffer) sourcesBuffers[srcId] = (src.buffer instanceof ArrayBuffer) ? src.buffer.slice(0) : src.buffer;
                }
                const token = 'detach_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                const payload = {
                    type: 'tab_transfer',
                    token: token,
                    name: doc.name,
                    originalPath: doc.originalPath || doc.filePath || null,
                    pages: JSON.parse(JSON.stringify(doc.pages)),
                    sourcesBuffers: sourcesBuffers,
                    sourceWindowId: window.__aliothWindowId,
                    indexEntries: doc.indexEntries ? JSON.parse(JSON.stringify(doc.indexEntries)) : [],
                    documentState: doc.documentState ? JSON.parse(JSON.stringify(doc.documentState)) : undefined
                };
                window._pendingDetach = window._pendingDetach || {};
                window._pendingDetach[token] = payload;
                this._saveTransferPayload(token, payload);
                const base = location.href.split('?')[0];
                window.open(base + '?detach=' + token, '_blank', 'popup,width=1280,height=900');
                this.closeTab(docId, null, true);
                this.showToast('📂 Documento abierto en nueva ventana');
            },

            loadDetachedDocument: async function(data, insertIndex = -1) {
                if (!data) return null;
                const docName = data.name || 'Documento Importado.pdf';
                const newDocId = 'doc_' + Date.now() + Math.random().toString(36).substr(2, 5);
                const newDoc = {
                    id: newDocId,
                    name: docName,
                    originalPath: data.originalPath || null,
                    pages: [],
                    sources: {},
                    currentIndex: 0,
                    scale: 1.0,
                    history: [],
                    historyIndex: -1,
                    indexEntries: data.indexEntries || [],
                    documentState: data.documentState || undefined
                };

                await this._clonePagesAndSources(data, newDoc, 0);

                // Si todas las pestañas existentes están vacías (sin páginas) o solo había una pestaña vacía por defecto,
                // eliminarlas para que la ventana solo contenga la pestaña transferida
                if (this.docs.length > 0 && this.docs.every(d => !d.pages || d.pages.length === 0)) {
                    this.docs = [];
                } else if (this.docs.length === 1 && (!this.docs[0].pages || this.docs[0].pages.length === 0)) {
                    this.docs = [];
                } else {
                    this.docs = this.docs.filter(d => d.pages && d.pages.length > 0);
                }

                if (insertIndex >= 0 && insertIndex <= this.docs.length) {
                    this.docs.splice(insertIndex, 0, newDoc);
                } else {
                    this.docs.push(newDoc);
                }

                this.renderTabs();
                this.switchTab(newDocId);
                this.renderSidebar();
                await this.loadPage(0);
                this.saveState();
                if (typeof this.updateWindowTitle === 'function') this.updateWindowTitle();
                this.showToast('📂 ' + docName);
                return newDocId;
            },

            sendDocToTab: function(fromDocId, toDocId) {
                if (this._translationReviewDocId === fromDocId && this._translationReviewPhase !== 'idle') {
                    this.showToast?.('Cancela la traducción antes de mover este documento.');
                    return;
                }
                const fromDoc = this.docs.find(d => d.id === fromDocId);
                const toDoc   = this.docs.find(d => d.id === toDocId);
                if (!fromDoc || !toDoc || fromDocId === toDocId) return;
                // Merge sources
                for (const [srcId, src] of Object.entries(fromDoc.sources)) {
                    toDoc.sources[srcId] = src;
                }
                // Append pages
                toDoc.pages = [...toDoc.pages, ...fromDoc.pages];
                // Remove origin tab
                this.closeTab(fromDocId, null, true);
                this.switchTab(toDocId);
                this.renderSidebar();
                this.showToast('📎 Páginas movidas a ' + toDoc.name);
            },

            showTabContextMenu: function (e, docId, docName) {
                e.preventDefault();
                e.stopPropagation();

                const menu = document.getElementById('context-menu');
                const content = document.getElementById('ctx-dynamic-content');
                window.closeFloatingSubmenus?.(menu);
                content.innerHTML = '';

                const addItem = (icon, text, action, danger = false, submenuItems = null) => {
                    const div = document.createElement('div');
                    div.className = 'ctx-item';
                    if (danger) div.style.color = '#ff7070';
                    if (submenuItems && submenuItems.length) {
                        // Build submenu HTML
                        let subHtml = '';
                        submenuItems.forEach(si => {
                            subHtml += `<div class="ctx-item" data-subid="${si.id}" style="white-space:nowrap;min-width:140px;">${si.label}</div>`;
                        });
                        div.innerHTML = `<span>${icon}</span> ${text} <span style="margin-left:auto;opacity:0.5;font-size:10px;">▶</span>
                            <div class="ctx-submenu">${subHtml}</div>`;
                        // Attach actions after insertion
                        setTimeout(() => {
                            div.querySelectorAll('.ctx-item[data-subid]').forEach(el => {
                                const si = submenuItems.find(s => s.id === el.dataset.subid);
                                if (si) el.addEventListener('mousedown', ev => {
                                    ev.preventDefault(); ev.stopPropagation();
                                    si.action();
                                    menu.style.display = 'none';
                                });
                            });
                        }, 0);
                    } else {
                        div.innerHTML = `<span>${icon}</span> ${text}`;
                        div.addEventListener('mousedown', ev => {
                            ev.preventDefault(); ev.stopPropagation();
                            action();
                            menu.style.display = 'none';
                        });
                    }
                    content.appendChild(div);
                };

                const addDivider = () => {
                    const d = document.createElement('div');
                    d.className = 'ctx-divider';
                    content.appendChild(d);
                };

                const docIndex = this.docs.findIndex(d => d.id === docId);

                // 1. Mover pestaña a una ventana nueva
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
                    this.t('ctx_move_to_new_win', 'Mover a una ventana nueva'),
                    () => this.detachTabToNewWindow(docId)
                );

                // 2. Abrir en panel secundario (Vista Paralela)
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
                    this.t('ctx_parallel', 'Abrir en panel secundario'),
                    () => this.openDocumentInPanel(docId, 'secondary')
                );

                // Other open tabs for "Enviar páginas a:"
                const otherTabs = this.docs
                    .filter(d => d.id !== docId && d.pages.length > 0)
                    .map(d => ({ id: d.id, label: '📄 ' + d.name, action: () => this.sendDocToTab(docId, d.id) }));

                if (otherTabs.length) {
                    addItem(
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
                        this.t('ctx_send_to', 'Enviar páginas a:'),
                        null,
                        false,
                        otherTabs
                    );
                }

                addDivider();

                // 4. Renombrar documento
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
                    this.t('ctx_rename_tab', 'Renombrar documento'),
                    () => setTimeout(() => this.startTabRename(docId), 50)
                );

                // 5. Duplicar pestaña
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
                    this.t('ctx_dup_doc', 'Duplicar documento'),
                    () => this.duplicateTab(docId)
                );

                // Mostrar en el Explorador de Windows (PdfCraft style)
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
                    'Mostrar en el Explorador',
                    () => this.revealCurrentFileInExplorer(docId)
                );

                // Reabrir pestaña cerrada
                if (this._closedTabsStack && this._closedTabsStack.length > 0) {
                    const lastClosed = this._closedTabsStack[this._closedTabsStack.length - 1];
                    addItem(
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
                        `Reabrir pestaña cerrada (${lastClosed.name})`,
                        () => this.reopenLastClosedTab()
                    );
                }

                addDivider();

                // 6. Cerrar pestaña
                addItem(
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
                    this.t('ctx_close_doc', 'Cerrar pestaña'),
                    () => this.closeTab(docId, null, true),
                    true
                );

                // 7. Cerrar las demás pestañas
                if (this.docs.length > 1) {
                    addItem(
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
                        this.t('ctx_close_other_tabs', 'Cerrar las demás pestañas'),
                        () => this.closeOtherTabs(docId),
                        true
                    );
                }

                // 8. Cerrar pestañas a la derecha
                if (docIndex >= 0 && docIndex < this.docs.length - 1) {
                    addItem(
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
                        this.t('ctx_close_right_tabs', 'Cerrar pestañas a la derecha'),
                        () => this.closeTabsToTheRight(docId),
                        true
                    );
                }

                // Position menu
                let x = e.clientX, y = e.clientY;
                menu.style.left = x + 'px';
                menu.style.top  = y + 'px';
                menu.style.display = 'flex';
                window.bindFloatingSubmenus?.(menu);
                requestAnimationFrame(() => window.positionFloatingMenu?.(menu, { x, y }));
            },

            hideContextMenu: function () {
                document.getElementById('context-menu').style.display = 'none';
            },

            // ===================== OBJECT CONTEXT MENU =====================
            setupObjectContextMenu: function () {
                // MEMORY LEAK FIX: Store handler and use flag to prevent duplicate listeners
                if (this._objectContextMenuSetup) {
                    console.log('⚠ Context menu already setup, skipping duplicate');
                    return;
                }
                this._objectContextMenuSetup = true;

                const handler = (e) => {
                    const target = e.target.closest('.draggable');
                    if (!target) return;

                    // Don't override text selection context menu if active
                    if (this.isTextSelectMode) return;

                    e.preventDefault();
                    e.stopPropagation();

                    // Find object data with null-safety check
                    const overlayId = target.closest('[id^="overlay-layer"]')?.id;
                    if (!overlayId) return;

                    const panelId = overlayId.includes('secondary') ? 'secondary' : 'primary';
                    const obj = this.getObjectById(target.id, panelId);
                    if (obj) {
                        this.showObjectContextMenu(e, obj, panelId);
                    }
                };

                this._contextMenuHandler = handler;
                document.addEventListener('contextmenu', handler);
            },

            showObjectContextMenu: function (e, obj, panelId) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const menu = document.getElementById('context-menu');
                const content = document.getElementById('ctx-dynamic-content');
                window.closeFloatingSubmenus?.(menu);
                content.innerHTML = '';

                // Header
                const header = document.createElement('div');
                header.className = 'ctx-divider';
                header.style.marginTop = '0';
                header.style.color = '#888';
                header.style.fontSize = '12px';
                header.innerText = t('ctx_obj_options', 'Opciones de Objeto');
                content.appendChild(header);

                // 1. Auto-Size Toggle (Only for text)
                if (obj.type === 'text') {
                    const div = document.createElement('div');
                    div.className = 'ctx-item';
                    const isAuto = obj.autoSize === true;
                    div.innerHTML = `<span>${isAuto ? '☑' : '☐'}</span> ${t('ctx_auto_size_txt', 'Auto-Ajustar Texto')}`;
                    div.onclick = () => {
                        obj.autoSize = !isAuto;
                        this.saveState();
                        this.renderOverlays(panelId);
                        menu.style.display = 'none';
                        this.showToast('Auto-Ajuste: ' + (obj.autoSize ? 'ACTIVADO' : 'DESACTIVADO'));
                    };
                    content.appendChild(div);
                }

                // 2. Propiedades (Toolbar Focus or Modal for form-fields)
                const divProps = document.createElement('div');
                divProps.className = 'ctx-item';
                divProps.innerHTML = `<span>⚙</span> ${t('btn_properties', 'Propiedades')}`;
                divProps.onclick = () => {
                    this.selectedObj = obj;
                    menu.style.display = 'none';

                    // For form-fields and tables, open the properties modal directly
                    if (obj.type === 'form-field') {
                        this.openProperties(obj);
                    } else if (obj.type === 'table') {
                        menu.style.display = 'none';
                        this.openTableProperties(obj);
                    } else if (obj.type === 'shape' || obj.type === 'connector') {
                        menu.style.display = 'none';
                        this.openShapeProperties(obj);
                    } else {
                        // For other types, switch to appropriate ribbon
                        this.renderOverlays(panelId);
                        if (obj.type === 'text') this.switchRibbon('home');
                        else if (obj.type === 'image') this.switchRibbon('image');
                    }
                };
                content.appendChild(divProps);

                if (obj.type !== 'link') {
                    const divLink = document.createElement('div');
                    divLink.className = 'ctx-item';
                    divLink.innerHTML = `<span>🔗</span> ${obj.actionLink ? 'Editar vínculo' : 'Agregar vínculo'}`;
                    divLink.onclick = () => {
                        this.selectedObj = obj;
                        menu.style.display = 'none';
                        this.showObjectLinkModal(obj);
                    };
                    content.appendChild(divLink);
                    if (obj.actionLink) {
                        const removeLink = document.createElement('div');
                        removeLink.className = 'ctx-item';
                        removeLink.innerHTML = '<span>⛓</span> Eliminar vínculo';
                        removeLink.onclick = () => this.removeObjectLink(obj);
                        content.appendChild(removeLink);
                    }
                }

                // Show menu
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
                menu.style.display = 'flex';
                requestAnimationFrame(() => window.positionFloatingMenu?.(menu, { x: e.clientX, y: e.clientY }));

                // Close handler
                const closeMenu = () => {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closeMenu);
                };
                setTimeout(() => document.addEventListener('click', closeMenu), 10);
            },

            // Context menu is initialized by DOMContentLoaded listener at end of file

            duplicateTab: function (docId) {
                const doc = this.docs.find(d => d.id === docId);
                if (!doc) return;

                const newId = this.createNewTab(doc.name + ' (copia)');
                const newDoc = this.docs.find(d => d.id === newId);
                if (newDoc && doc.pages) {
                    newDoc.pages = doc.pages.map(p => ({ ...p, objects: p.objects ? [...p.objects] : [] }));
                    newDoc.sources = { ...doc.sources };
                    this.switchTab(newId);
                    this.showToast('Documento duplicado');
                }
            },

            startTabRename: function (docId) {
                const tabEl = document.querySelector(`.doc-tab[data-doc-id="${docId}"]`) ||
                              Array.from(document.querySelectorAll('.doc-tab')).find(t => t.querySelector(`.doc-tab-close[onclick*="${docId}"]`));
                if (tabEl) {
                    const dblEvent = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
                    tabEl.dispatchEvent(dblEvent);
                }
            },

            closeOtherTabs: function (docId) {
                const toClose = this.docs.filter(d => d.id !== docId).map(d => d.id);
                if (!toClose.length) return;
                this.switchTab(docId);
                toClose.forEach(id => this.closeTab(id, null, true));
                this.showToast('Otras pestañas cerradas');
            },

            closeTabsToTheRight: function (docId) {
                const idx = this.docs.findIndex(d => d.id === docId);
                if (idx === -1 || idx >= this.docs.length - 1) return;
                const toClose = this.docs.slice(idx + 1).map(d => d.id);
                toClose.forEach(id => this.closeTab(id, null, true));
                this.switchTab(docId);
                this.showToast('Pestañas a la derecha cerradas');
            },
            // ===================== END SPLIT VIEW FUNCTIONS =====================

            applyDefaultDocumentZoom: async function (doc, pdf) {
                const selected = localStorage.getItem('alioth_default_zoom');
                if (!selected) return;
                let scale = Number(selected);
                if (selected === 'page-fit' || selected === 'page-width') {
                    const view = this.getPanelElements(this.splitView.activePanel)?.mainView;
                    if (!view?.clientWidth || !view.clientHeight) return;
                    const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
                    const widthScale = (view.clientWidth - 32) / viewport.width;
                    scale = selected === 'page-width' ? widthScale : Math.min(widthScale, (view.clientHeight - 48) / viewport.height);
                }
                if (Number.isFinite(scale) && scale > 0) doc.scale = Math.max(0.2, Math.min(5, scale));
            },

            createNewTab: function (name = "Sin Título") {
                const id = 'doc_' + Date.now() + Math.random().toString(36).substr(2, 5);
                this.docs.push({
                    id, name, pages: [], sources: {}, currentIndex: 0, scale: 1.0,
                    history: [], historyIndex: -1
                });
                this.switchTab(id);
                this.updateUndoRedoUI();
                return id;
            },

            switchTab: function (id) {
                const epoch = this._sessionSwitchEpoch = (this._sessionSwitchEpoch || 0) + 1;
                const pendingDoc = this.docs.find(doc => doc.id === id);
                if (pendingDoc?._sessionSourcesPending) {
                    this.activeDocId = id;
                    this.renderTabs();
                    this.toggleLoader(true);
                    this.hydrateSessionDocument(pendingDoc).then(() => {
                        if (this._sessionSwitchEpoch === epoch && this.docs.includes(pendingDoc)) {
                            this.toggleLoader(false);
                            this.switchTab(id);
                        }
                    }).catch(error => {
                        if (this._sessionSwitchEpoch === epoch) this.toggleLoader(false);
                        console.error('Session tab could not be loaded:', error);
                        this.showToast('No se pudo cargar esta pestaña. Los datos guardados se conservan.', 5000, 'warning');
                    });
                    return;
                }
                if (id !== this.activeDocId) this.cancelPendingSignature?.();
                // Guardar indexEntries del doc actual antes de cambiar
                const prevDoc = this.docs.find(d => d && d.id === this.activeDocId);
                if (prevDoc) prevDoc.indexEntries = this.indexEntries.slice();

                // En modo continuo solo rescatamos si el doc cambia (evitar destruir vista)
                const prevDocId = this.activeDocId;
                const preferredMode = typeof localStorage !== 'undefined' && localStorage.getItem('alioth_default_page-mode') === 'single' ? 'single' : 'continuous';
                if (this.viewMode === 'continuous' && (prevDocId !== id || preferredMode === 'single')) {
                    this._rescueCanvasFromContinuous('primary');
                    this._rescueCanvasFromContinuous('secondary');
                }
                this.activeDocId = id;
                // Cargar indexEntries del nuevo doc
                const newDoc = this.getDoc();
                this.indexEntries = (newDoc && newDoc.indexEntries) ? newDoc.indexEntries.slice() : [];
                this.renderTabs();
                const doc = this.getDoc();
                if (doc) {
                    this.currentScale = doc.scale || 1.0;
                    const zi = document.getElementById('zoomInput');
                    if (zi) zi.value = Math.round(this.currentScale * 100) + '%';
                    const zs = document.getElementById('zoomSlider');
                    if (zs) zs.value = Math.max(20, Math.min(500, Math.round(this.currentScale * 100)));
                    this.multiSelection.clear();
                    this.renderSidebar();

                    if (preferredMode === 'single' && this.isTwoUpView) {
                        this.isTwoUpView = false;
                        document.getElementById('toggleTwoUp')?.classList.remove('active-view');
                    }
                    if (this.viewMode !== preferredMode) {
                        this.viewMode = preferredMode;
                        const _btnC = document.getElementById('toggleContinuous');
                        if (_btnC) _btnC.classList.toggle('active-view', preferredMode === 'continuous');
                    }

                    // Sync with the currently active panel
                    const activePanel = this.splitView.activePanel;
                    this.splitView[activePanel].docId = id;
                    this.splitView[activePanel].pageIndex = doc.currentIndex;
                    this.splitView[activePanel].scale = doc.scale;

                    // Render respetando viewMode
                    this.renderPanelContent(activePanel);
                    this.updateUndoRedoUI();
                    this.setPageCount(doc.pages.length > 0 ? `${doc.currentIndex + 1} / ${doc.pages.length}` : "— / —");
                    const rpc = document.getElementById('reading-page-count');
                    if (rpc) rpc.textContent = doc.pages.length > 0 ? `${doc.currentIndex + 1} / ${doc.pages.length}` : '— / —';
                    if (this.showRuler) this.updateRulers(activePanel);
                    this.updatePanelHeaders();
                    this.updateWindowTitle();
                }
            },

            closeTab: function (id, e, force = false) {
                if (e) e.stopPropagation();
                if (this._translationReviewDocId === id && this._translationReviewPhase !== 'idle') {
                    this.showToast?.('Abre la revisión y cancela la traducción antes de cerrar esta pestaña.');
                    return;
                }
                if (this.docs.length <= 1 && this.docs[0].pages.length === 0 && !force) return;

                const idx = this.docs.findIndex(d => d && d.id === id);
                if (idx === -1) return;

                const closedDoc = this.docs[idx];
                if (closedDoc._sessionSourcesPending || this._pendingDocumentEdits?.get(id)?.size) {
                    Promise.resolve(this.flushDocumentEdits?.(id)).then(() => this.hydrateSessionDocument(closedDoc))
                        .then(() => this.closeTab(id, null, force))
                        .catch(() => this.showToast('No se pudo confirmar la edición. La pestaña permanece abierta.', 5000, 'warning'));
                    return;
                }
                this._nativeSaveTargets?.delete(id);
                if (this._saveStateTimers?.has(id)) {
                    const pending = this._saveStateTimers.get(id);
                    clearTimeout(pending.timer ?? pending);
                    this._saveStateTimers.delete(id);
                }

                // Guardar en pila de pestañas cerradas para Ctrl+Shift+T (PdfCraft style)
                this._closedTabsStack = this._closedTabsStack || [];
                const src = closedDoc?.sources && closedDoc.pages?.[0] ? closedDoc.sources[closedDoc.pages[0].sourceId] : null;
                if (src && src.buffer) {
                    const closed = {
                        name: closedDoc.name,
                        buffer: src.buffer,
                        filePath: closedDoc.originalPath || closedDoc.filePath || closedDoc.path || closedDoc._nativePath || null,
                        currentIndex: closedDoc.currentIndex || 0
                    };
                    this._closedTabsStack.push(closed);
                    if (this.persistClosedTab) closed.persisting = this.persistClosedTab(closed);
                    if (this._closedTabsStack.length > 15) this.releaseClosedTab?.(this._closedTabsStack.shift());
                }

                // Splice BEFORE switchTab so the new active doc is resolved correctly
                this.docs.splice(idx, 1);
                this.removeDocumentFromSession(id);

                if (this.activeDocId === id) {
                    this.indexEntries = [];
                    this.renderIndexEntries();
                    this.updateIndexCount();
                    this.showIndexEmptyState(true);
                    const indexPanel = document.getElementById('index-panel');
                    if (indexPanel && indexPanel.classList.contains('open')) indexPanel.classList.remove('open');
                    this.clearAIChat();
                }

                if (this.docs.length === 0) {
                    this.createNewTab();
                } else if (this.activeDocId === id) {
                    this.switchTab(this.docs[Math.max(0, idx - 1)]?.id);
                } else {
                    this.renderTabs();
                }
                if (this.docs.length === 0) {
                    this.setPageCount("— / —");
                    this.updateWindowTitle();
                }

                // Defer buffer cleanup until AFTER the new doc has rendered
                // to avoid null-buffer crash in renderContinuousContent / loadPage
                setTimeout(() => {
                    if (closedDoc && closedDoc.sources) {
                        Object.values(closedDoc.sources).forEach(s => {
                            if (this.releasePdfSource) this.releasePdfSource(s);
                            else { try { s.doc?.destroy?.()?.catch?.(() => {}); } catch (_) {} }
                            s.doc = null;
                            s.buffer = null;
                        });
                    }
                    // Solo nulificar canvas, NO objects[], para no invalidar thumbs del doc activo
                    // en caso de páginas compartidas por referencia (copiar páginas entre docs)
                    if (closedDoc && closedDoc.pages) {
                        closedDoc.pages.forEach(p => { p.canvas = null; });
                    }
                    this.releaseDocumentThumbnails?.(closedDoc);
                }, 500);
            },

            closeDocument: function () {
                if (this._translationReviewDocId === this.activeDocId && this._translationReviewPhase !== 'idle') {
                    this.showToast?.('Abre la revisión y cancela la traducción antes de cerrar esta pestaña.');
                    return;
                }
                // Guardar si estábamos en continuo para restaurarlo al abrir el siguiente doc
                this._precloseWasContinuous = (this.viewMode === 'continuous');
                if (this.viewMode === 'continuous') {
                    this._rescueCanvasFromContinuous('primary');
                    this._rescueCanvasFromContinuous('secondary');
                    this.viewMode = 'single';
                    const btn = document.getElementById('toggleContinuous');
                    if (btn) btn.classList.remove('active-view');
                }
                this._wasInContinuous = false; // Evitar restauración fantasma post-cierre
                if (this.activeDocId) this.closeTab(this.activeDocId, null, true);
            },

            showEmojiModal: function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) {
                    this.showToast("Abre un documento primero");
                    return;
                }

                // Initialize multi-selection array
                this.emojiSelection = [];
                this.updateEmojiSelectionUI();

                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                document.getElementById('emoji-modal').style.display = 'block';
                document.querySelectorAll('.glass-box').forEach(m => {
                    if (m.id !== 'emoji-modal') m.style.display = 'none';
                });

                // Reset monochrome options
                document.getElementById('emoji-monochrome').checked = false;
                document.getElementById('emoji-color').value = '#000000';

                // Populate emojis
                const emojisContainer = document.getElementById('emoji-content-emojis');
                const emojis = [
                    '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '🥰', '😘', '😗',
                    '😙', '😚', '🙂', '🤗', '🤩', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐',
                    '😯', '😪', '😫', '🥱', '😴', '😌', '😛', '😜', '😝', '🤤', '😒', '😓', '😔', '😕', '🙃', '🤑',
                    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💗', '💖', '💝', '💘', '💔', '❣️', '💕', '💞',
                    '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏',
                    '✅', '❌', '⭐', '🌟', '💫', '⚡', '🔥', '💥', '💯', '🎉', '🎊', '🏆', '🥇', '🥈', '🥉', '🎯',
                    '📱', '💻', '🖥️', '⌨️', '🖱️', '📷', '📹', '🎬', '📺', '📻', '🎵', '🎶', '🎤', '🎧', '🎸', '🎹',
                    '📁', '📂', '📄', '📝', '✏️', '📌', '📎', '📐', '📏', '✂️', '🗑️', '📤', '📥', '📧', '📨', '💼'
                ];

                emojisContainer.innerHTML = '';
                emojis.forEach(emoji => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'font-size:24px; border:2px solid transparent; background:none; cursor:pointer; padding:5px; border-radius:6px; transition:all 0.2s;';
                    btn.innerText = emoji;
                    btn.dataset.emoji = emoji;
                    btn.dataset.type = 'emoji';
                    btn.onmouseover = () => { if (!btn.classList.contains('emoji-selected')) btn.style.background = 'var(--btn-hover)'; };
                    btn.onmouseout = () => { if (!btn.classList.contains('emoji-selected')) btn.style.background = 'none'; };
                    btn.onclick = (e) => this.handleEmojiClick(e, { type: 'emoji', data: emoji }, btn);
                    emojisContainer.appendChild(btn);
                });

                // Populate social icons
                const socialContainer = document.getElementById('emoji-content-social');
                const socialIcons = [
                    // Social Media
                    { name: 'WhatsApp', color: '#25D366', svg: '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>' },
                    { name: 'Facebook', color: '#1877F2', svg: '<path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>' },
                    { name: 'Instagram', color: '#E4405F', svg: '<path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>' },
                    { name: 'Twitter/X', color: '#000000', svg: '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>' },
                    { name: 'YouTube', color: '#FF0000', svg: '<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>' },
                    { name: 'TikTok', color: '#000000', svg: '<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>' },
                    { name: 'LinkedIn', color: '#0A66C2', svg: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>' },
                    { name: 'Telegram', color: '#26A5E4', svg: '<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>' },
                    // Google
                    { name: 'Google', color: '#4285F4', svg: '<path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>' },
                    { name: 'Gmail', color: '#EA4335', svg: '<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>' },
                    { name: 'Drive', color: '#4285F4', svg: '<path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.828 0 0 0-3.63 6.319L0 15.868l1.89 3.298 3.76-.01c2.08-.01 3.76-.02 3.76-.04 0-.03-1.69-2.98-3.76-6.56-2.07-3.58-3.76-6.53-3.76-6.56 0-.04.03-.05.18-.05.1-.01 1.15-.01 2.34-.01zm8.33 9.88l-1.893 3.29L9.93 23.99c-.01.04 1.68.05 3.76.05 2.08 0 3.77-.01 3.76-.05l-1.893-3.29-3.76-6.56z"/>' },
                    // Microsoft
                    { name: 'Microsoft', color: '#00A4EF', svg: '<path d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z"/>' },
                    { name: 'Outlook', color: '#0078D4', svg: '<path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.158.154-.352.232-.58.232h-8.547v-6.959l1.6 1.229c.102.078.213.116.337.116.123 0 .235-.04.337-.116l6.873-5.29v-.264l-7.21 5.545-1.937-1.49V5.06h8.766c.228 0 .42.076.58.23.158.152.237.346.237.576v1.52h.001zM14.635 5.06v7.247l-1.9-1.46-.962.74-3.27-2.516V5.06h6.132zm-7.132 0v4.298L0 15.39V5.06h7.503zM24 5.06v1.037l-7.418 5.707-1.947-1.497V5.06H24zM8.503 4.06H0v16h15.635V12.01l-1.584 1.22-5.548-4.27V4.06z"/>' },
                    { name: 'OneDrive', color: '#0078D4', svg: '<path d="M19.456 10.111a4.793 4.793 0 0 0-4.478-3.093c-2.033 0-3.753 1.259-4.477 3.036A3.556 3.556 0 0 0 7.5 11.25c-1.795 0-3.268 1.334-3.494 3.064A2.998 2.998 0 0 0 0 17.25c0 1.654 1.346 3 3 3h17.25a3.753 3.753 0 0 0 3.75-3.75 3.72 3.72 0 0 0-4.544-3.639z"/>' },
                    // Office
                    { name: 'Word', color: '#2B579A', svg: '<path d="M23.004 1.5q.41 0 .703.293t.293.703v19.008q0 .41-.293.703t-.703.293H6.996q-.41 0-.703-.293T6 21.504V18H.996q-.41 0-.703-.293T0 17.004V6.996q0-.41.293-.703T.996 6H6V2.496q0-.41.293-.703t.703-.293zM6.035 11.203l1.442 4.735h1.64l1.57-7.876H9.036l-.937 4.653-1.325-4.5H5.38l-1.406 4.523-.855-4.676H1.312l1.418 7.876h1.664zM22.5 21V18h-15v3zm0-4.5v-3.75h-12v3.75zm0-5.25V7.5h-12v3.75zm0-5.25V3h-15v3z"/>' },
                    { name: 'Excel', color: '#217346', svg: '<path d="M23.004 1.5q.41 0 .703.293t.293.703v19.008q0 .41-.293.703t-.703.293H6.996q-.41 0-.703-.293T6 21.504V18H.996q-.41 0-.703-.293T0 17.004V6.996q0-.41.293-.703T.996 6H6V2.496q0-.41.293-.703t.703-.293zM8.2 17h2.2l-2.062-3.5 1.98-3.5H8.36l-1.172 2.312L6.016 10H4.038l1.937 3.5L3.92 17h1.98l1.289-2.625zm14.3 4V18h-15v3zm0-4.5v-3.75h-3.75v3.75zm0-5.25V7.5h-3.75v3.75zm0-5.25V3h-15v3zm-5.25 10.5v-3.75h-3.75v3.75zm0-5.25V7.5h-3.75v3.75z"/>' },
                    { name: 'PowerPoint', color: '#D24726', svg: '<path d="M23.004 1.5q.41 0 .703.293t.293.703v19.008q0 .41-.293.703t-.703.293H6.996q-.41 0-.703-.293T6 21.504V18H.996q-.41 0-.703-.293T0 17.004V6.996q0-.41.293-.703T.996 6H6V2.496q0-.41.293-.703t.703-.293zM7.5 10.5v3h1.852q.586 0 .914-.36t.328-.89-.328-.898-.914-.352zm-1.5 6.5h1.5v-2h1.688q1.266 0 2.039-.727t.773-1.898-.773-1.883-2.04-.742H6zm16.5 4V18h-15v3zm0-4.5v-3.75h-12v3.75zm0-5.25V7.5h-12v3.75zm0-5.25V3h-15v3z"/>' },
                    // AI Apps
                    { name: 'ChatGPT', color: '#10A37F', svg: '<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>' },
                    { name: 'Gemini', color: '#8E75B2', svg: '<path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 2.4a9.6 9.6 0 0 1 9.6 9.6 9.6 9.6 0 0 1-9.6 9.6A9.6 9.6 0 0 1 2.4 12 9.6 9.6 0 0 1 12 2.4zm0 2.4c-1.988 0-3.6 3.224-3.6 7.2s1.612 7.2 3.6 7.2 3.6-3.224 3.6-7.2-1.612-7.2-3.6-7.2zm-7.2 7.2c0 1.988 3.224 3.6 7.2 3.6s7.2-1.612 7.2-3.6-3.224-3.6-7.2-3.6-7.2 1.612-7.2 3.6z"/>' },
                    { name: 'Copilot', color: '#6264A7', svg: '<path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.5 6h3a.75.75 0 0 1 .75.75v4.5h3a.75.75 0 0 1 .53 1.28l-5.25 5.25a.75.75 0 0 1-1.06 0l-5.25-5.25a.75.75 0 0 1 .53-1.28h3v-4.5A.75.75 0 0 1 10.5 6z"/>' },
                    // Other Apps
                    { name: 'Spotify', color: '#1DB954', svg: '<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>' },
                    { name: 'Discord', color: '#5865F2', svg: '<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/>' },
                    { name: 'Slack', color: '#4A154B', svg: '<path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>' },
                    { name: 'Zoom', color: '#2D8CFF', svg: '<path d="M4.585 9.185a.782.782 0 0 0-.782.782v4.066c0 .43.35.782.782.782h7.23a.782.782 0 0 0 .782-.782V9.967a.782.782 0 0 0-.782-.782zm13.587 0l-3.13 2.425v2.78l3.13 2.425a.782.782 0 0 0 1.243-.63V9.815a.782.782 0 0 0-1.243-.63zM24 6v12a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6z"/>' }
                ];

                socialContainer.innerHTML = '';
                socialIcons.forEach(icon => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px; border:2px solid var(--border); background:var(--input-bg); border-radius:8px; cursor:pointer; transition:all 0.2s;';
                    btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:32px; height:32px; fill:${icon.color};">${icon.svg}</svg><span style="font-size:10px; color:var(--text-main);">${icon.name}</span>`;
                    btn.dataset.iconName = icon.name;
                    btn.dataset.type = 'icon';
                    btn.onmouseover = () => { if (!btn.classList.contains('emoji-selected')) btn.style.transform = 'scale(1.05)'; };
                    btn.onmouseout = () => { if (!btn.classList.contains('emoji-selected')) btn.style.transform = 'scale(1)'; };
                    btn.onclick = (e) => this.handleEmojiClick(e, { type: 'icon', data: icon }, btn);
                    socialContainer.appendChild(btn);
                });

                // Populate generic icons
                const iconsContainer = document.getElementById('emoji-content-icons');
                const genericIcons = [
                    // Warning & Safety
                    { name: 'Stop', color: '#DC2626', svg: '<polygon points="7,2 17,2 22,7 22,17 17,22 7,22 2,17 2,7" fill="#DC2626" stroke="white" stroke-width="1"/><text x="12" y="14" text-anchor="middle" font-size="6" fill="white" font-weight="bold">STOP</text>' },
                    { name: 'Peligro', color: '#F59E0B', svg: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>' },
                    { name: 'Prohibido', color: '#DC2626', svg: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>' },
                    { name: 'Precaución', color: '#F59E0B', svg: '<path d="M12 2L1 21h22L12 2z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="1" fill="currentColor"/>' },
                    // Herramientas
                    { name: 'Borrador', color: '#EC4899', svg: '<path d="M22 3l-1.5-1.5c-.8-.8-2-.8-2.8 0L3 16.2v4.8h4.8L22 6.8c.8-.8.8-2 0-2.8L22 3zM6.8 19H5v-1.8L16.5 5.7l1.8 1.8L6.8 19z" fill="#EC4899"/><rect x="2" y="19" width="8" height="3" fill="#F9A8D4"/>' },
                    { name: 'Basura', color: '#6B7280', svg: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z" fill="#6B7280"/><line x1="10" y1="10" x2="10" y2="18" stroke="white" stroke-width="0.5"/><line x1="14" y1="10" x2="14" y2="18" stroke="white" stroke-width="0.5"/>' },
                    { name: 'Precaución', color: '#F59E0B', svg: '<path d="M12 2L1 21h22L12 2z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17" r="1" fill="currentColor"/>' },
                    // Transportation
                    { name: 'Avión', color: '#3B82F6', svg: '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>' },
                    { name: 'Auto', color: '#6366F1', svg: '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>' },
                    { name: 'Tren', color: '#8B5CF6', svg: '<path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-6H6V6h5v5zm2 0V6h5v5h-5zm3.5 6c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>' },
                    { name: 'Barco', color: '#0EA5E9', svg: '<path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/>' },
                    // People & Health
                    { name: 'Embarazada', color: '#EC4899', svg: '<circle cx="12" cy="5" r="3" fill="#F9A8D4"/><path d="M12 8c-2 0-3.5 1-4 3l-1 6c0 1 .5 2 1.5 2h1l.5 3h4l.5-3h1c1 0 1.5-1 1.5-2l-1-6c-.5-2-2-3-4-3z" fill="#EC4899"/><ellipse cx="12" cy="14" rx="3" ry="3.5" fill="#F9A8D4"/>' },
                    { name: 'Persona', color: '#6366F1', svg: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' },
                    { name: 'Urgencias', color: '#DC2626', svg: '<path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/>' },
                    { name: 'Hospital', color: '#DC2626', svg: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1"/>' },
                    // Food & Drink  
                    { name: 'Comida', color: '#F59E0B', svg: '<path d="M8.1 13.34l2.83-2.83L3.91 3.5c-1.56 1.56-1.56 4.09 0 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.20-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z"/>' },
                    { name: 'Café', color: '#92400E', svg: '<path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>' },
                    { name: 'Bebida', color: '#3B82F6', svg: '<path d="M3 2l2.01 18.23C5.13 21.23 5.97 22 7 22h10c1.03 0 1.87-.77 1.99-1.77L21 2H3zm9 17c-1.66 0-3-1.34-3-3 0-2 3-5.4 3-5.4s3 3.4 3 5.4c0 1.66-1.34 3-3 3zm6.33-11H5.67l-.44-4h13.53l-.43 4z"/>' },
                    // Documents & Office
                    { name: 'Expediente', color: '#6366F1', svg: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' },
                    { name: 'Carpeta', color: '#F59E0B', svg: '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>' },
                    { name: 'Impresora', color: '#6B7280', svg: '<path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>' },
                    { name: 'Lápiz', color: '#10B981', svg: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>' },
                    // Miscellaneous
                    { name: 'Información', color: '#3B82F6', svg: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4m0-4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
                    { name: 'Llamada', color: '#10B981', svg: '<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>' },
                    { name: 'Ubicación', color: '#DC2626', svg: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>' },
                    { name: 'Hora', color: '#6366F1', svg: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
                    // Connectivity & Technology
                    { name: 'WiFi', color: '#10B981', svg: '<path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9z" fill="#10B981"/><path d="M5 13l2 2c2.76-2.76 7.24-2.76 10 0l2-2c-3.87-3.87-10.14-3.87-14 0z" fill="#34D399"/><path d="M9 17l3 3 3-3c-1.66-1.66-4.34-1.66-6 0z" fill="#6EE7B7"/>' },
                    { name: 'WiFi Fuerte', color: '#3B82F6', svg: '<path d="M12 3C7.46 3 3.34 4.78.29 7.67l1.41 1.41C4.38 6.55 8.03 5 12 5s7.62 1.55 10.29 4.08l1.41-1.41C20.66 4.78 16.54 3 12 3z" fill="#3B82F6"/><path d="M12 7c-3.33 0-6.37 1.24-8.7 3.27l1.41 1.41C6.79 9.95 9.27 9 12 9s5.21.95 7.29 2.69l1.41-1.41C18.37 8.24 15.33 7 12 7z" fill="#60A5FA"/><path d="M12 11c-2.2 0-4.21.81-5.77 2.15l1.41 1.41C8.96 13.58 10.4 13 12 13s3.04.58 4.36 1.56l1.41-1.41C16.21 11.81 14.2 11 12 11z" fill="#93C5FD"/><circle cx="12" cy="18" r="2.5" fill="#BFDBFE"/>' },
                    { name: 'Red', color: '#8B5CF6', svg: '<circle cx="12" cy="6" r="2.5" fill="#8B5CF6"/><circle cx="6" cy="18" r="2.5" fill="#A78BFA"/><circle cx="18" cy="18" r="2.5" fill="#C4B5FD"/><path d="M12 8.5v4.5M8 16.5l4-4M16 16.5l-4-4" stroke="#8B5CF6" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="#DDD6FE"/>' },
                    { name: 'Servidor', color: '#0EA5E9', svg: '<rect x="2" y="2" width="20" height="6" rx="1" fill="#0EA5E9"/><circle cx="6" cy="5" r="1" fill="#7DD3FC"/><rect x="9" y="4" width="8" height="2" rx="0.5" fill="#38BDF8"/><rect x="2" y="9" width="20" height="6" rx="1" fill="#0284C7"/><circle cx="6" cy="12" r="1" fill="#7DD3FC"/><rect x="9" y="11" width="8" height="2" rx="0.5" fill="#38BDF8"/><rect x="2" y="16" width="20" height="6" rx="1" fill="#0369A1"/><circle cx="6" cy="19" r="1" fill="#7DD3FC"/><rect x="9" y="18" width="8" height="2" rx="0.5" fill="#38BDF8"/>' },
                    { name: 'Herramientas', color: '#F59E0B', svg: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" fill="#F59E0B"/><path d="M5.5 4L2 7.5V4h3.5z" fill="#FCD34D"/><circle cx="7" cy="7" r="1" fill="#FBBF24"/>' },
                    { name: 'Llave Inglesa', color: '#6B7280', svg: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" fill="#9CA3AF"/><path d="M5 3L2 6V3h3z" fill="#D1D5DB"/>' },
                    { name: 'Configuración', color: '#6366F1', svg: '<path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="#6366F1"/><circle cx="12" cy="12" r="2" fill="#A5B4FC"/>' },
                    { name: 'Engranaje', color: '#9CA3AF', svg: '<path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z" fill="#9CA3AF"/><circle cx="12" cy="12" r="2.5" fill="#D1D5DB"/>' },
                    { name: 'Correo', color: '#EF4444', svg: '<rect x="2" y="4" width="20" height="16" rx="2" fill="#EF4444"/><path d="M2 6l10 7 10-7" stroke="#FCA5A5" stroke-width="2" fill="none"/><path d="M2 6l10 7 10-7" fill="#FECACA"/>' },
                    { name: 'Email Nuevo', color: '#10B981', svg: '<rect x="1" y="4" width="18" height="14" rx="2" fill="#10B981"/><path d="M1 6l9 6 9-6" stroke="#6EE7B7" stroke-width="1.5" fill="none"/><circle cx="19" cy="6" r="4" fill="#EF4444"/><text x="19" y="8" text-anchor="middle" font-size="5" fill="white" font-weight="bold">!</text>' },
                    { name: 'Bandeja', color: '#3B82F6', svg: '<path d="M4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3z" fill="#3B82F6"/><path d="M3 15h5l2 2h4l2-2h5" stroke="#93C5FD" stroke-width="2" fill="#60A5FA"/><rect x="6" y="7" width="12" height="2" rx="1" fill="#BFDBFE"/><rect x="6" y="10" width="8" height="2" rx="1" fill="#DBEAFE"/>' },
                    { name: 'Email@', color: '#8B5CF6', svg: '<rect x="2" y="4" width="20" height="16" rx="2" fill="#8B5CF6"/><path d="M2 6l10 7 10-7" stroke="#C4B5FD" stroke-width="2" fill="none"/><circle cx="17" cy="15" r="4" fill="#DDD6FE"/><text x="17" y="17" text-anchor="middle" font-size="6" fill="#8B5CF6" font-weight="bold">@</text>' },
                    // Medicina & Salud
                    { name: 'Asclepio', color: '#10B981', svg: '<path d="M12 2v20" stroke="#10B981" stroke-width="2"/><path d="M12 4c2 0 3 1 3 2.5S14 9 12 9c-2 0-3 1-3 2.5s1 2.5 3 2.5c2 0 3 1 3 2.5S14 19 12 19" stroke="#34D399" stroke-width="2" fill="none"/><circle cx="12" cy="2" r="1.5" fill="#6EE7B7"/>' },
                    { name: 'Caduceo', color: '#F59E0B', svg: '<path d="M12 4v16" stroke="#F59E0B" stroke-width="2"/><circle cx="12" cy="3" r="2" fill="#FCD34D"/><path d="M8 5c0 0 0 3 4 5c-4 2-4 5-4 5" stroke="#FBBF24" stroke-width="1.5" fill="none"/><path d="M16 5c0 0 0 3-4 5c4 2 4 5 4 5" stroke="#FBBF24" stroke-width="1.5" fill="none"/><path d="M7 4l2 2M17 4l-2 2M7 4l2-1M17 4l-2-1" stroke="#F59E0B" stroke-width="1.5"/>' },
                    { name: 'Doctor', color: '#3B82F6', svg: '<circle cx="12" cy="6" r="4" fill="#93C5FD"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" fill="#3B82F6"/><circle cx="12" cy="6" r="2.5" fill="#BFDBFE"/><rect x="10" y="14" width="4" height="6" rx="1" fill="#60A5FA"/><circle cx="12" cy="15" r="1" fill="white"/>' },
                    { name: 'Enfermera', color: '#EC4899', svg: '<circle cx="12" cy="6" r="4" fill="#F9A8D4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" fill="#EC4899"/><rect x="9" y="2" width="6" height="4" rx="1" fill="white" stroke="#EC4899" stroke-width="0.5"/><path d="M12 3v2M11 4h2" stroke="#EC4899" stroke-width="1"/>' },
                    { name: 'Estetoscopio', color: '#6366F1', svg: '<path d="M6 4v6c0 3.5 2.5 6 6 6s6-2.5 6-6V4" stroke="#6366F1" stroke-width="2" fill="none"/><circle cx="12" cy="18" r="3" fill="#A5B4FC"/><circle cx="12" cy="18" r="1.5" fill="#6366F1"/><circle cx="6" cy="4" r="2" fill="#818CF8"/><circle cx="18" cy="4" r="2" fill="#818CF8"/>' },
                    { name: 'Pastillas', color: '#EF4444', svg: '<ellipse cx="8" cy="12" rx="5" ry="3" fill="#EF4444" transform="rotate(-45 8 12)"/><ellipse cx="16" cy="12" rx="5" ry="3" fill="#3B82F6" transform="rotate(45 16 12)"/><line x1="6" y1="10" x2="10" y2="14" stroke="#FCA5A5" stroke-width="1"/><line x1="14" y1="10" x2="18" y2="14" stroke="#93C5FD" stroke-width="1"/>' },
                    { name: 'Corazón Médico', color: '#EF4444', svg: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#EF4444"/><path d="M9 10h6M12 7v6" stroke="white" stroke-width="2"/>' },
                    { name: 'Ambulancia', color: '#DC2626', svg: '<rect x="1" y="9" width="18" height="10" rx="2" fill="#DC2626"/><rect x="14" y="6" width="8" height="13" rx="2" fill="#EF4444"/><circle cx="6" cy="19" r="2.5" fill="#1F2937"/><circle cx="6" cy="19" r="1" fill="#9CA3AF"/><circle cx="18" cy="19" r="2.5" fill="#1F2937"/><circle cx="18" cy="19" r="1" fill="#9CA3AF"/><rect x="16" y="9" width="4" height="4" rx="1" fill="#BFDBFE"/><path d="M4 12h4M6 10v4" stroke="white" stroke-width="1.5"/>' },
                    { name: 'Jeringa', color: '#0EA5E9', svg: '<rect x="10" y="1" width="4" height="3" rx="0.5" fill="#0EA5E9"/><rect x="8" y="4" width="8" height="2" fill="#7DD3FC"/><rect x="9" y="6" width="6" height="12" fill="#E0F2FE" stroke="#0EA5E9" stroke-width="0.5"/><rect x="10" y="7" width="4" height="8" fill="#0EA5E9"/><path d="M11 18L12 22L13 18" fill="#9CA3AF"/><line x1="9" y1="9" x2="10" y2="9" stroke="#0EA5E9" stroke-width="0.3"/><line x1="9" y1="11" x2="10" y2="11" stroke="#0EA5E9" stroke-width="0.3"/><line x1="9" y1="13" x2="10" y2="13" stroke="#0EA5E9" stroke-width="0.3"/>' },
                    { name: 'Termómetro', color: '#EF4444', svg: '<rect x="10" y="2" width="4" height="14" rx="2" fill="#FCA5A5"/><circle cx="12" cy="19" r="4" fill="#EF4444"/><rect x="11" y="10" width="2" height="7" fill="#EF4444"/><circle cx="12" cy="19" r="2" fill="#DC2626"/>' },
                    { name: 'Vacuna', color: '#10B981', svg: '<rect x="10" y="1" width="4" height="3" rx="0.5" fill="#10B981"/><rect x="8" y="4" width="8" height="2" fill="#6EE7B7"/><rect x="9" y="6" width="6" height="12" fill="#D1FAE5" stroke="#10B981" stroke-width="0.5"/><rect x="10" y="7" width="4" height="8" fill="#10B981"/><path d="M11 18L12 22L13 18" fill="#9CA3AF"/><line x1="9" y1="9" x2="10" y2="9" stroke="#10B981" stroke-width="0.3"/><line x1="9" y1="11" x2="10" y2="11" stroke="#10B981" stroke-width="0.3"/><line x1="9" y1="13" x2="10" y2="13" stroke="#10B981" stroke-width="0.3"/>' },
                    { name: 'Botiquín', color: '#DC2626', svg: '<rect x="3" y="6" width="18" height="14" rx="2" fill="#DC2626"/><rect x="9" y="3" width="6" height="4" rx="1" fill="#FECACA" stroke="#DC2626" stroke-width="1"/><path d="M12 10v6M9 13h6" stroke="white" stroke-width="2"/>' },
                    { name: 'Electrocardiograma', color: '#EF4444', svg: '<rect x="2" y="6" width="20" height="12" rx="2" fill="#1F2937"/><path d="M3 12h3l1-4 2 8 2-6 1 4 2-2 1 2h6" stroke="#22C55E" stroke-width="1.5" fill="none"/><circle cx="19" cy="9" r="1.5" fill="#EF4444"/>' },
                    { name: 'Monitor Cardíaco', color: '#10B981', svg: '<rect x="3" y="4" width="18" height="14" rx="2" fill="#374151"/><rect x="5" y="6" width="14" height="10" rx="1" fill="#1F2937"/><path d="M6 11h2l1-3 1.5 6 1.5-4 1 2 1-1 1 1h3" stroke="#10B981" stroke-width="1" fill="none"/><rect x="6" y="19" width="4" height="2" rx="0.5" fill="#6B7280"/><rect x="14" y="19" width="4" height="2" rx="0.5" fill="#6B7280"/>' },
                    { name: 'Cubrebocas', color: '#6366F1', svg: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="#6366F1"/><path d="M7 9c0 0 2 4 5 4s5-4 5-4" fill="white" stroke="#E5E7EB" stroke-width="0.5"/><line x1="8" y1="10" x2="16" y2="10" stroke="#D1D5DB" stroke-width="0.3"/><line x1="8" y1="11" x2="16" y2="11" stroke="#D1D5DB" stroke-width="0.3"/>' },
                    // Industria y Seguridad
                    { name: 'Plataforma Petrolera', color: '#374151', svg: '<rect x="3" y="18" width="18" height="3" rx="0.5" fill="#4B5563"/><rect x="1" y="17" width="3" height="6" fill="#6B7280"/><rect x="20" y="17" width="3" height="6" fill="#6B7280"/><path d="M5 18L3 21M19 18L21 21" stroke="#4B5563" stroke-width="1"/><rect x="6" y="13" width="12" height="5" fill="#374151"/><rect x="8" y="14" width="3" height="3" fill="#0EA5E9" opacity="0.5"/><rect x="13" y="14" width="3" height="3" fill="#0EA5E9" opacity="0.5"/><rect x="11" y="4" width="2" height="9" fill="#1F2937"/><path d="M7 13L12 4L17 13" stroke="#1F2937" stroke-width="1.5" fill="none"/><path d="M8 13L12 6M16 13L12 6" stroke="#4B5563" stroke-width="0.8"/><path d="M9 13L12 8M15 13L12 8" stroke="#6B7280" stroke-width="0.5"/><rect x="10" y="1" width="4" height="3" rx="0.5" fill="#F59E0B"/><path d="M11 0L12 1L13 0" fill="#EF4444"/><ellipse cx="12" cy="2.5" rx="1" ry="0.8" fill="#FCD34D"/><path d="M0 23c3-1.5 6-1 9 0s6 1.5 9 0s6-1 6 0" stroke="#0EA5E9" stroke-width="2" fill="none"/><path d="M0 24c3-1 6-0.5 9 0.5s6 1 6 0.5" stroke="#7DD3FC" stroke-width="1" fill="none"/>' },
                    { name: 'Minería', color: '#92400E', svg: '<line x1="6" y1="6" x2="18" y2="18" stroke="#8B4513" stroke-width="3" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="#8B4513" stroke-width="3" stroke-linecap="round"/><g transform="rotate(-45 6 6)"><rect x="2.5" y="3" width="7" height="3" fill="#4B5563" stroke="#333" stroke-width="0.8"/><polygon points="0.5,4.5 2.5,3 2.5,6" fill="#4B5563" stroke="#333" stroke-width="0.5"/><rect x="3.5" y="3.5" width="5" height="1.5" fill="#6B7280"/></g><g transform="rotate(45 18 6)"><rect x="14" y="3" width="8" height="3" fill="#4B5563" stroke="#333" stroke-width="0.8"/><rect x="15" y="3.5" width="6" height="1" fill="#6B7280"/><rect x="15" y="4.5" width="6" height="0.5" fill="#555"/></g>' },
                    { name: 'Casco Seguridad', color: '#F59E0B', svg: '<path d="M3 16c0-6 4-12 9-12s9 6 9 12" fill="#F59E0B"/><rect x="2" y="14" width="20" height="4" rx="1" fill="#FBBF24"/><path d="M2 16h20" stroke="#D97706" stroke-width="0.5"/><path d="M6 14v-2c0-3.5 2.5-6 6-6s6 2.5 6 6v2" fill="none" stroke="#FCD34D" stroke-width="0.5"/>' },
                    // Deportes y Ejercicio
                    { name: 'Pesas', color: '#6366F1', svg: '<rect x="2" y="8" width="4" height="8" rx="1" fill="#6366F1"/><rect x="18" y="8" width="4" height="8" rx="1" fill="#6366F1"/><rect x="4" y="10" width="2" height="4" fill="#818CF8"/><rect x="18" y="10" width="2" height="4" fill="#818CF8"/><rect x="6" y="11" width="12" height="2" rx="0.5" fill="#4B5563"/>' },
                    { name: 'Mancuerna', color: '#1F2937', svg: '<circle cx="5" cy="12" r="4" fill="#374151"/><circle cx="19" cy="12" r="4" fill="#374151"/><rect x="5" y="10" width="14" height="4" rx="1" fill="#6B7280"/><circle cx="5" cy="12" r="2" fill="#1F2937"/><circle cx="19" cy="12" r="2" fill="#1F2937"/>' },
                    { name: 'Corriendo', color: '#EF4444', svg: '<circle cx="12" cy="4" r="2.5" fill="#EF4444"/><line x1="12" y1="6" x2="12" y2="12" stroke="#EF4444" stroke-width="2"/><line x1="12" y1="12" x2="6" y2="22" stroke="#EF4444" stroke-width="2"/><line x1="12" y1="12" x2="18" y2="20" stroke="#EF4444" stroke-width="2"/><line x1="12" y1="8" x2="5" y2="12" stroke="#EF4444" stroke-width="2"/><line x1="12" y1="8" x2="20" y2="6" stroke="#EF4444" stroke-width="2"/>' },
                    { name: 'Fútbol', color: '#1F2937', svg: '<circle cx="12" cy="12" r="10" fill="white" stroke="#1F2937" stroke-width="1"/><polygon points="12,6 15,9 14,13 10,13 9,9" fill="#1F2937"/><path d="M12 6L12 2M15 9L19 7M14 13L17 17M10 13L7 17M9 9L5 7" stroke="#1F2937" stroke-width="1"/>' },
                    { name: 'Básquetbol', color: '#F97316', svg: '<circle cx="12" cy="12" r="10" fill="#F97316" stroke="#C2410C" stroke-width="0.5"/><path d="M12 2v20M2 12h20" stroke="#1F2937" stroke-width="0.5"/><path d="M5 5c4 2 4 6 0 10M19 5c-4 2-4 6 0 10" stroke="#1F2937" stroke-width="0.5" fill="none"/>' },
                    { name: 'Tenis', color: '#84CC16', svg: '<circle cx="12" cy="12" r="9" fill="#84CC16" stroke="white" stroke-width="1.5"/><path d="M5 8c3 4 9 4 14 0M5 16c3-4 9-4 14 0" stroke="white" stroke-width="1.2" fill="none"/>' },
                    { name: 'Natación', color: '#0EA5E9', svg: '<circle cx="7" cy="6" r="2.5" fill="#0EA5E9"/><path d="M10 7l8-2" stroke="#0EA5E9" stroke-width="2" stroke-linecap="round"/><path d="M9 9l3 2" stroke="#0EA5E9" stroke-width="1.5"/><path d="M2 15c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 5 0 3 1.5 5 0" stroke="#0EA5E9" stroke-width="2" fill="none"/><path d="M2 19c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 5 0 3 1.5 5 0" stroke="#7DD3FC" stroke-width="1.5" fill="none"/>' },
                    { name: 'Ciclismo', color: '#8B5CF6', svg: '<circle cx="6" cy="16" r="4" fill="none" stroke="#8B5CF6" stroke-width="1.5"/><circle cx="18" cy="16" r="4" fill="none" stroke="#8B5CF6" stroke-width="1.5"/><path d="M6 16L10 10L14 10L18 16" stroke="#8B5CF6" stroke-width="1" fill="none"/><path d="M10 10L12 6" stroke="#8B5CF6" stroke-width="1"/><circle cx="12" cy="5" r="2" fill="#8B5CF6"/>' },
                    // Naturaleza
                    { name: 'Árbol', color: '#16A34A', svg: '<path d="M12 2L5 10h3l-3 5h3l-3 5h14l-3-5h3l-3-5h3L12 2z" fill="#16A34A"/><rect x="10" y="20" width="4" height="3" fill="#92400E"/>' },
                    { name: 'Flor', color: '#EC4899', svg: '<circle cx="12" cy="5" r="3" fill="#F472B6"/><circle cx="7" cy="10" r="3" fill="#F472B6"/><circle cx="17" cy="10" r="3" fill="#F472B6"/><circle cx="8" cy="16" r="3" fill="#F472B6"/><circle cx="16" cy="16" r="3" fill="#F472B6"/><circle cx="12" cy="12" r="3" fill="#FCD34D"/><path d="M12 15v7" stroke="#16A34A" stroke-width="2"/>' },
                    { name: 'Rosa', color: '#E11D48', svg: '<ellipse cx="12" cy="8" rx="5" ry="4" fill="#FB7185"/><ellipse cx="10" cy="10" rx="4" ry="3" fill="#E11D48"/><ellipse cx="14" cy="10" rx="4" ry="3" fill="#E11D48"/><path d="M12 14c0 0-2 2-2 5s2 3 2 3" stroke="#16A34A" stroke-width="1.5" fill="none"/><path d="M10 16l-3 2M14 16l3 2" stroke="#16A34A" stroke-width="1"/>' },
                    { name: 'Sol', color: '#F59E0B', svg: '<circle cx="12" cy="12" r="5" fill="#FCD34D"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" stroke="#F59E0B" stroke-width="2" stroke-linecap="round"/>' },
                    { name: 'Luna', color: '#6366F1', svg: '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z" fill="#818CF8"/><circle cx="8" cy="10" r="1" fill="#C7D2FE"/><circle cx="12" cy="8" r="1" fill="#C7D2FE"/><circle cx="16" cy="11" r="1" fill="#C7D2FE"/>' },
                    { name: 'Nubes', color: '#60A5FA', svg: '<path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#60A5FA"/><ellipse cx="8" cy="16" rx="4" ry="2" fill="#93C5FD"/>' }
                ];

                iconsContainer.innerHTML = '';
                genericIcons.forEach(icon => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:5px; padding:10px; border:2px solid var(--border); background:var(--input-bg); border-radius:8px; cursor:pointer; transition:all 0.2s;';
                    btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:32px; height:32px; fill:${icon.color};">${icon.svg}</svg><span style="font-size:10px; color:var(--text-main);">${icon.name}</span>`;
                    btn.dataset.iconName = icon.name;
                    btn.dataset.type = 'icon';
                    btn.onmouseover = () => { if (!btn.classList.contains('emoji-selected')) btn.style.transform = 'scale(1.05)'; };
                    btn.onmouseout = () => { if (!btn.classList.contains('emoji-selected')) btn.style.transform = 'scale(1)'; };
                    btn.onclick = (e) => this.handleEmojiClick(e, { type: 'icon', data: icon }, btn);
                    iconsContainer.appendChild(btn);
                });

                this.switchEmojiTab('icons');
            },

            /**
             * Switches between emoji tabs
             */
            switchEmojiTab: function (tab) {
                document.getElementById('emoji-content-emojis').style.display = tab === 'emojis' ? 'grid' : 'none';
                document.getElementById('emoji-content-social').style.display = tab === 'social' ? 'grid' : 'none';
                document.getElementById('emoji-content-icons').style.display = tab === 'icons' ? 'grid' : 'none';
                document.getElementById('emoji-content-lucide').style.display = tab === 'lucide' ? 'grid' : 'none';
                document.getElementById('emoji-tab-emojis').className = tab === 'emojis' ? 'capsule-btn primary' : 'capsule-btn secondary';
                document.getElementById('emoji-tab-social').className = tab === 'social' ? 'capsule-btn primary' : 'capsule-btn secondary';
                document.getElementById('emoji-tab-icons').className = tab === 'icons' ? 'capsule-btn primary' : 'capsule-btn secondary';
                // Special styling for Lucide tab
                if (tab === 'lucide') {
                    document.getElementById('emoji-tab-lucide').className = 'capsule-btn primary';
                    document.getElementById('emoji-tab-lucide').style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    // Populate Lucide icons on first access
                    this.populateLucideIcons();
                } else {
                    document.getElementById('emoji-tab-lucide').className = 'capsule-btn secondary';
                    document.getElementById('emoji-tab-lucide').style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                }
            },

            /**
             * Populates the Lucide icons grid with curated SVG icons
             */
            populateLucideIcons: function () {
                const container = document.getElementById('emoji-content-lucide');
                if (container.dataset.populated === 'true') return; // Only populate once
                container.dataset.populated = 'true';

                // Curated list of useful Lucide icons
                const lucideIcons = [
                    // Files & Documents
                    'file', 'file-text', 'file-check', 'file-x', 'file-plus', 'file-minus', 'files', 'folder', 'folder-open',
                    // Actions
                    'check', 'x', 'plus', 'minus', 'edit', 'trash-2', 'copy', 'clipboard', 'save', 'download', 'upload',
                    // Communication
                    'mail', 'message-circle', 'message-square', 'phone', 'video', 'send', 'share', 'share-2',
                    // Navigation
                    'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
                    // Media
                    'image', 'camera', 'video', 'music', 'play', 'pause', 'stop', 'volume-2', 'mic',
                    // UI Elements
                    'menu', 'search', 'settings', 'user', 'users', 'home', 'star', 'heart', 'thumbs-up', 'thumbs-down',
                    // Status & Info
                    'info', 'alert-circle', 'alert-triangle', 'check-circle', 'x-circle', 'help-circle', 'bell',
                    // Tools
                    'wrench', 'hammer', 'key', 'lock', 'unlock', 'link', 'unlink', 'zap', 'target',
                    // Time & Calendar
                    'clock', 'calendar', 'timer', 'hourglass', 'alarm-clock',
                    // Devices
                    'monitor', 'smartphone', 'tablet', 'laptop', 'printer', 'wifi', 'bluetooth',
                    // Shapes
                    'circle', 'square', 'triangle', 'hexagon', 'octagon', 'diamond',
                    // Charts & Data
                    'bar-chart', 'pie-chart', 'trending-up', 'trending-down', 'activity',
                    // Nature & Weather
                    'sun', 'moon', 'cloud', 'cloud-rain', 'snowflake', 'wind', 'thermometer', 'droplet',
                    // Travel & Location
                    'map', 'map-pin', 'navigation', 'compass', 'globe', 'plane', 'car', 'truck',
                    // People & Body
                    'user', 'user-plus', 'user-minus', 'user-check', 'user-x', 'users', 'hand', 'eye', 'eye-off',
                    // Buildings
                    'home', 'building', 'store', 'warehouse', 'hospital', 'school', 'church',
                    // Finance
                    'dollar-sign', 'credit-card', 'wallet', 'gift', 'shopping-cart', 'shopping-bag', 'receipt',
                    // Security
                    'shield', 'shield-check', 'shield-off', 'lock', 'unlock', 'key', 'fingerprint',
                    // Misc
                    'flag', 'bookmark', 'award', 'badge', 'tag', 'hash', 'at-sign', 'code', 'terminal'
                ];

                container.innerHTML = '';
                lucideIcons.forEach(iconName => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:8px; border:2px solid transparent; background:rgba(255,255,255,0.1); border-radius:8px; cursor:pointer; transition:all 0.2s; min-height:60px;';
                    btn.innerHTML = `<i data-lucide="${iconName}" style="width:28px; height:28px; stroke:var(--text-main);"></i><span style="font-size:8px; color:var(--text-main); text-transform:capitalize; overflow:hidden; text-overflow:ellipsis; max-width:50px;">${iconName.replace(/-/g, ' ')}</span>`;
                    btn.dataset.iconName = iconName;
                    btn.dataset.type = 'lucide';
                    btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; btn.style.borderColor = 'var(--accent)'; };
                    btn.onmouseout = () => { btn.style.transform = 'scale(1)'; btn.style.borderColor = 'transparent'; };
                    btn.onclick = () => this.insertLucideIcon(iconName);
                    container.appendChild(btn);
                });

                // Render Lucide icons
                if (window.lucide) {
                    lucide.createIcons();
                }
            },

            /**
             * Inserts a Lucide icon as an SVG image object
             */
            insertLucideIcon: function (iconName) {
                this.saveState();
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) return;

                const isMonochrome = document.getElementById('emoji-monochrome')?.checked ?? false;
                const customColor = document.getElementById('emoji-color')?.value || '#000000';
                const center = this.getVisibleCenter();

                // Get the SVG from Lucide
                const iconElement = document.querySelector(`[data-lucide="${iconName}"]`);
                let svgContent = '';
                if (iconElement && iconElement.tagName === 'svg') {
                    svgContent = iconElement.outerHTML;
                } else if (window.lucide && window.lucide.icons && window.lucide.icons[iconName]) {
                    // Fallback: build SVG from Lucide icon data
                    const iconData = window.lucide.icons[iconName];
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${customColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconData[1].map(d => `<path d="${d}"/>`).join('')}</svg>`;
                } else {
                    // Simple fallback
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${customColor}" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
                }

                // Apply color if monochrome
                if (isMonochrome) {
                    svgContent = svgContent.replace(/stroke="[^"]*"/g, `stroke="${customColor}"`);
                }

                const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgContent)));

                const iconObj = {
                    id: 'lucide' + Date.now() + Math.random().toString().substr(2, 5),
                    type: 'image',
                    x: center.x - 30,
                    y: center.y - 30,
                    width: 60,
                    height: 60,
                    src: svgDataUrl,
                    opacity: 1,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    filters: {},
                    lucideIcon: iconName // Store icon name for reference
                };
                doc.pages[doc.currentIndex].objects.push(iconObj);
                this.closeAllModals();
                this.renderOverlays();
                this.renderSidebar();
                this.showToast(`✨ Icono "${iconName}" insertado`);
            },

            /**
             * Searches across all emoji/icon tabs
             */
            searchEmojis: function (query) {
                const lowerQuery = query.toLowerCase().trim();

                // Search in emojis
                const emojiContainer = document.getElementById('emoji-content-emojis');
                emojiContainer.querySelectorAll('button').forEach(btn => {
                    const title = btn.getAttribute('title') || btn.textContent || '';
                    btn.style.display = lowerQuery === '' || title.toLowerCase().includes(lowerQuery) ? '' : 'none';
                });

                // Search in social/apps
                const socialContainer = document.getElementById('emoji-content-social');
                socialContainer.querySelectorAll('button').forEach(btn => {
                    const name = btn.querySelector('span')?.textContent || '';
                    btn.style.display = lowerQuery === '' || name.toLowerCase().includes(lowerQuery) ? '' : 'none';
                });

                // Search in icons
                const iconsContainer = document.getElementById('emoji-content-icons');
                iconsContainer.querySelectorAll('button').forEach(btn => {
                    const name = btn.querySelector('span')?.textContent || '';
                    btn.style.display = lowerQuery === '' || name.toLowerCase().includes(lowerQuery) ? '' : 'none';
                });

                // If searching, show all tabs content so results are visible
                if (lowerQuery !== '') {
                    emojiContainer.style.display = 'grid';
                    socialContainer.style.display = 'grid';
                    iconsContainer.style.display = 'grid';
                    // Update tab buttons to show all are active during search
                    document.getElementById('emoji-tab-emojis').className = 'capsule-btn secondary';
                    document.getElementById('emoji-tab-social').className = 'capsule-btn secondary';
                    document.getElementById('emoji-tab-icons').className = 'capsule-btn secondary';
                } else {
                    // Reset to icons tab when search is cleared
                    this.switchEmojiTab('icons');
                }
            },

            /**
             * Updates emoji preview based on monochrome settings
             */
            updateEmojiPreview: function () {
                // Preview update could be added here for real-time preview
                // Currently just logs the state
                const isMono = document.getElementById('emoji-monochrome').checked;
                const color = document.getElementById('emoji-color').value;
                if (isMono) {
                    this.showToast(`Monocromático: ${color}`);
                }
            },

            /**
             * Inserts an image as a full page, automatically sized to Letter or Legal
             * @param {File} file - The image file to insert
             */
            handleEmojiClick: function (e, item, btn) {
                if (e.ctrlKey || e.metaKey) {
                    // Multi-select mode
                    const idx = this.emojiSelection.findIndex(s =>
                        s.type === item.type &&
                        (item.type === 'emoji' ? s.data === item.data : s.data.name === item.data.name)
                    );

                    if (idx >= 0) {
                        // Remove from selection
                        this.emojiSelection.splice(idx, 1);
                        btn.classList.remove('emoji-selected');
                        btn.style.borderColor = 'var(--border)';
                        btn.style.background = 'var(--input-bg)';
                    } else {
                        // Add to selection
                        this.emojiSelection.push(item);
                        btn.classList.add('emoji-selected');
                        btn.style.borderColor = 'var(--accent)';
                        btn.style.background = 'rgba(24, 90, 189, 0.2)';
                    }
                    this.updateEmojiSelectionUI();
                } else {
                    // Normal click - insert immediately
                    if (item.type === 'emoji') {
                        this.insertEmoji(item.data);
                    } else {
                        this.insertSocialIcon(item.data);
                    }
                }
            },

            /**
             * Updates the selection count UI
             */
            updateEmojiSelectionUI: function () {
                const count = this.emojiSelection ? this.emojiSelection.length : 0;
                const countEl = document.getElementById('emoji-selection-count');
                const clearBtn = document.getElementById('emoji-clear-btn');
                const insertBtn = document.getElementById('emoji-insert-btn');

                if (count > 0) {
                    countEl.textContent = `${count} seleccionado${count > 1 ? 's' : ''}`;
                    countEl.style.display = 'inline-block';
                    clearBtn.style.display = 'inline-block';
                    insertBtn.style.display = 'inline-block';
                } else {
                    countEl.style.display = 'none';
                    clearBtn.style.display = 'none';
                    insertBtn.style.display = 'none';
                }
            },

            /**
             * Clears all emoji/icon selections
             */
            clearEmojiSelection: function () {
                this.emojiSelection = [];
                // Remove visual selection from all buttons
                document.querySelectorAll('#emoji-content-emojis button, #emoji-content-social button, #emoji-content-icons button').forEach(btn => {
                    btn.classList.remove('emoji-selected');
                    btn.style.borderColor = btn.dataset.type === 'emoji' ? 'transparent' : 'var(--border)';
                    btn.style.background = btn.dataset.type === 'emoji' ? 'none' : 'var(--input-bg)';
                });
                this.updateEmojiSelectionUI();
            },

            /**
             * Inserts all selected emojis/icons
             */
            insertSelectedEmojis: function () {
                if (!this.emojiSelection || this.emojiSelection.length === 0) {
                    this.showToast("No hay elementos seleccionados");
                    return;
                }

                // Insert each selected item with offset
                let offsetX = 0;
                let offsetY = 0;

                this.emojiSelection.forEach((item, index) => {
                    if (item.type === 'emoji') {
                        this.insertEmojiAtOffset(item.data, offsetX, offsetY);
                    } else {
                        this.insertSocialIconAtOffset(item.data, offsetX, offsetY);
                    }
                    // Offset each subsequent item
                    offsetX += 35;
                    if (offsetX > 140) {
                        offsetX = 0;
                        offsetY += 35;
                    }
                });

                this.clearEmojiSelection();
                this.closeAllModals();
                this.showToast(`${this.emojiSelection?.length || 0 + 1} elementos insertados`);
            },

            /**
             * Inserts emoji at specific offset from center
             */
            insertEmojiAtOffset: function (emoji, offsetX, offsetY) {
                this.saveState();
                const doc = this.getDoc();
                const isMonochrome = document.getElementById('emoji-monochrome').checked;
                const customColor = document.getElementById('emoji-color').value;
                const center = this.getVisibleCenter();

                const emojiObj = {
                    id: 'emoji' + Date.now() + Math.random().toString().substr(2, 5),
                    type: 'text',
                    x: center.x - 30 + offsetX,
                    y: center.y - 30 + offsetY,
                    width: 60,
                    height: 60,
                    text: emoji,
                    font: 'Arial',
                    size: 48,
                    color: isMonochrome ? customColor : '#000000',
                    bold: false,
                    italic: false,
                    align: 'center',
                    bgColor: 'transparent',
                    bgAlpha: 0,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    isMonochrome: isMonochrome
                };
                doc.pages[doc.currentIndex].objects.push(emojiObj);
                this.renderOverlays();
                this.renderSidebar();
            },

            /**
             * Inserts icon at specific offset from center
             */
            insertSocialIconAtOffset: function (icon, offsetX, offsetY) {
                this.saveState();
                const doc = this.getDoc();
                const isMonochrome = document.getElementById('emoji-monochrome').checked;
                const customColor = document.getElementById('emoji-color').value;
                const hasRoundedBorder = document.getElementById('emoji-rounded-border').checked;
                const borderColor = document.getElementById('emoji-border-color').value;
                const borderWidth = document.getElementById('emoji-border-width').value || '2';
                const center = this.getVisibleCenter();

                // Process SVG content
                let iconSvg = icon.svg;

                if (isMonochrome) {
                    iconSvg = iconSvg.replace(/fill="([^"]+)"/gi, (match, color) => {
                        const lowerColor = color.toLowerCase();
                        if (lowerColor === 'none' || lowerColor === 'transparent' ||
                            lowerColor === 'white' || lowerColor === '#fff' || lowerColor === '#ffffff') {
                            return match;
                        }
                        return `fill="${customColor}"`;
                    });
                    iconSvg = iconSvg.replace(/stroke="([^"]+)"/gi, (match, color) => {
                        const lowerColor = color.toLowerCase();
                        if (lowerColor === 'none' || lowerColor === 'transparent' ||
                            lowerColor === 'white' || lowerColor === '#fff' || lowerColor === '#ffffff') {
                            return match;
                        }
                        return `stroke="${customColor}"`;
                    });
                    iconSvg = iconSvg.replace(/currentColor/gi, customColor);
                }

                let svgContent;
                if (hasRoundedBorder) {
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="${15 - (parseFloat(borderWidth) / 2)}" fill="white" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                        <g transform="translate(4, 4)" ${isMonochrome ? '' : `fill="${icon.color}"`}>${iconSvg}</g>
                    </svg>`;
                } else {
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${isMonochrome ? '' : `fill="${icon.color}"`}>${iconSvg}</svg>`;
                }
                const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgContent)));

                const iconObj = {
                    id: 'icon' + Date.now() + Math.random().toString().substr(2, 5),
                    type: 'image',
                    x: center.x - 30 + offsetX,
                    y: center.y - 30 + offsetY,
                    width: 60,
                    height: 60,
                    src: svgDataUrl,
                    opacity: 1,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    filters: {}
                };
                doc.pages[doc.currentIndex].objects.push(iconObj);
                this.renderOverlays();
                this.renderSidebar();
            },

            /**
             * Toggles ribbon collapse/expand state
             */
            toggleRibbonCollapse: function () {
                const ribbon = document.getElementById('ribbonContainer');
                const icon = document.getElementById('ribbonCollapseIcon');
                const isCollapsed = ribbon.classList.toggle('collapsed');

                // Update icon direction
                if (isCollapsed) {
                    icon.innerHTML = '<path d="M7 10l5 5 5-5z"/>'; // Arrow down (expand)
                } else {
                    icon.innerHTML = '<path d="M7 14l5-5 5 5z"/>'; // Arrow up (collapse)
                }
            },

            /**
             * Inserts an emoji as a resizable text object
             */
            insertEmoji: function (emoji) {
                this.saveState();
                const doc = this.getDoc();
                const isMonochrome = document.getElementById('emoji-monochrome').checked;
                const customColor = document.getElementById('emoji-color').value;
                const center = this.getVisibleCenter();

                const emojiObj = {
                    id: 'emoji' + Date.now() + Math.random().toString().substr(2, 5),
                    type: 'text',
                    x: center.x - 30,
                    y: center.y - 30,
                    width: 60,
                    height: 60,
                    text: emoji,
                    font: 'Arial',
                    size: 48,
                    color: isMonochrome ? customColor : '#000000',
                    bold: false,
                    italic: false,
                    align: 'center',
                    bgColor: 'transparent',
                    bgAlpha: 0,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    isMonochrome: isMonochrome
                };
                doc.pages[doc.currentIndex].objects.push(emojiObj);
                this.selectedObj = emojiObj;
                this.closeAllModals();
                this.renderOverlays();
                this.renderSidebar();
                this.showToast("Emoji insertado");
            },

            /**
             * Inserts a social media icon as resizable SVG image
             */
            insertSocialIcon: function (icon) {
                this.saveState();
                const doc = this.getDoc();
                const isMonochrome = document.getElementById('emoji-monochrome').checked;
                const customColor = document.getElementById('emoji-color').value;
                const hasRoundedBorder = document.getElementById('emoji-rounded-border').checked;
                const borderColor = document.getElementById('emoji-border-color').value;
                const borderWidth = document.getElementById('emoji-border-width').value || '2';
                const center = this.getVisibleCenter();

                // Process SVG content
                let iconSvg = icon.svg;

                // If monochrome, replace all color references in the SVG with the custom color
                // Only preserve: white and transparent (used for highlights/shadows)
                if (isMonochrome) {
                    // Replace fill colors - preserve only: none, transparent, white variants
                    iconSvg = iconSvg.replace(/fill="([^"]+)"/gi, (match, color) => {
                        const lowerColor = color.toLowerCase();
                        if (lowerColor === 'none' || lowerColor === 'transparent' ||
                            lowerColor === 'white' || lowerColor === '#fff' || lowerColor === '#ffffff') {
                            return match; // Keep original
                        }
                        return `fill="${customColor}"`;
                    });
                    // Replace stroke colors - preserve only: none, transparent, white variants
                    iconSvg = iconSvg.replace(/stroke="([^"]+)"/gi, (match, color) => {
                        const lowerColor = color.toLowerCase();
                        if (lowerColor === 'none' || lowerColor === 'transparent' ||
                            lowerColor === 'white' || lowerColor === '#fff' || lowerColor === '#ffffff') {
                            return match; // Keep original
                        }
                        return `stroke="${customColor}"`;
                    });
                    // Handle currentColor
                    iconSvg = iconSvg.replace(/currentColor/gi, customColor);
                }

                // Create SVG data URL with optional rounded border
                let svgContent;
                const fillAttr = isMonochrome ? customColor : icon.color;

                if (hasRoundedBorder) {
                    // Add circular background with customizable border
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                        <circle cx="16" cy="16" r="${15 - (parseFloat(borderWidth) / 2)}" fill="white" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                        <g transform="translate(4, 4)" ${isMonochrome ? '' : `fill="${icon.color}"`}>${iconSvg}</g>
                    </svg>`;
                } else {
                    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${isMonochrome ? '' : `fill="${icon.color}"`}>${iconSvg}</svg>`;
                }
                const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgContent)));

                const iconObj = {
                    id: 'icon' + Date.now() + Math.random().toString().substr(2, 5),
                    type: 'image',
                    x: center.x - 30,
                    y: center.y - 30,
                    width: 60,
                    height: 60,
                    src: svgDataUrl,
                    opacity: 1,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    filters: {}
                };
                doc.pages[doc.currentIndex].objects.push(iconObj);
                this.selectedObj = iconObj;
                this.closeAllModals();
                this.renderOverlays();
                this.renderSidebar();
                this.showToast(`Icono ${icon.name} insertado`);
            },

            // ============================================================
            // SECTION 7: SEARCH, OCR & QR
            // ============================================================

            /**
             * Searches for text in the current document
             * @param {boolean} next - If true, moves to next result; if false, moves to previous
             */
            searchText: async function (next = true) {
                const term = document.getElementById('searchInput').value.trim();
                const statusEl = document.getElementById('searchStatusMini');
                if (!term) { this.clearSearch(); return; }
                if (this.lastSearchTerm !== term) {
                    this.searchResults = []; this.currentSearchIdx = -1; this.lastSearchTerm = term;
                    statusEl.innerText = "Buscando...";
                    const doc = this.getDoc(); if (!doc) return;

                    // ── 🆕 MEJORA 2: Motor de búsqueda PyMuPDF (search_for) ──────────────────
                    // PyMuPDF maneja kerning, spans partidos, ligaduras y codificaciones especiales
                    // que PDF.js no puede encontrar con getTextContent().
                    // Si el motor Python no está listo o falla, cae al loop JS como fallback.
                    let usedPython = false;
                    try {
                        if (PythonManager.isLoaded) {
                            // Reunir todos los buffers únicos del documento
                            // (un doc puede tener páginas de múltiples fuentes PDF)
                            const sourceIds = [...new Set(doc.pages.map(p => p.sourceId))];
                            const pyResults = [];

                            for (const sid of sourceIds) {
                                const src = doc.sources[sid];
                                if (!src || !src.buffer) continue;

                                const hits = await PythonManager.searchInDocument(src.buffer, term, false);
                                if (hits === null) { usedPython = false; break; } // fallo Python → fallback JS
                                usedPython = true;

                                for (const hit of hits) {
                                    // Mapear pageIdx de PyMuPDF (relativo al source) al pageIdx del documento
                                    const docPageIdx = doc.pages.findIndex(
                                        p => p.sourceId === sid && p.pageIndex === hit.pageIdx
                                    );
                                    if (docPageIdx < 0) continue;

                                    // Convertir coordenadas PDF (puntos, Y-down) a coordenadas de viewport (px, Y-down)
                                    // En PDF.js a escala 1.0: 1pt = 1px. Y en PDF (Y-down) === Y en viewport (Y-down).
                                    // No necesitamos flip porque PyMuPDF Y0 está medido desde arriba igual que el viewport de PDF.js.
                                    this.searchResults.push({
                                        pageIdx: docPageIdx,
                                        text: term,
                                        x: hit.x0,
                                        y: hit.y0,
                                        width: hit.x1 - hit.x0,
                                        height: hit.y1 - hit.y0,
                                        _source: 'python'
                                    });
                                }
                            }
                            if (usedPython) {
                                console.log(`🐍 PyMuPDF Search: ${this.searchResults.length} resultados para "${term}"`);
                            }
                        }
                    } catch (pySearchErr) {
                        console.warn("🐍 Python search error, using JS fallback:", pySearchErr);
                        usedPython = false;
                        this.searchResults = [];
                    }

                    // ── Fallback JS: PDF.js getTextContent ──────────────────────────────────
                    if (!usedPython) {
                        console.log("🔍 Búsqueda JS (PDF.js fallback)...");
                        for (let i = 0; i < doc.pages.length; i++) {
                            const pData = doc.pages[i]; const src = doc.sources[pData.sourceId];
                            try {
                                if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                                const page = await src.doc.getPage(pData.pageIndex + 1);
                                const textContent = await page.getTextContent();
                                const viewport = page.getViewport({ scale: 1.0 });
                                for (const match of window.AliothSearch.pdfMatches(textContent.items, term)) {
                                    const rectangles = match.map(({ item, start, end }) => {
                                        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                                        const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                                        const width = item.width * viewport.scale || fontHeight * item.str.length * .5;
                                        const from = (item.dir === 'rtl' ? item.str.length - end : start) / Math.max(1, item.str.length);
                                        return { x: tx[4] + width * from, y: tx[5] - fontHeight,
                                            width: width * (end - start) / Math.max(1, item.str.length), height: fontHeight };
                                    });
                                    if (rectangles.length) {
                                        const x = Math.min(...rectangles.map(rect => rect.x));
                                        const y = Math.min(...rectangles.map(rect => rect.y));
                                        this.searchResults.push({ pageIdx: i, text: term, x, y,
                                            width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x,
                                            height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y,
                                            _source: 'js' });
                                    }
                                }
                            } catch (e) { console.error("Error buscando", e); }
                        }
                    }
                }
                if (this.searchResults.length === 0) { statusEl.innerText = "0/0"; return; }
                if (next) { this.currentSearchIdx++; if (this.currentSearchIdx >= this.searchResults.length) this.currentSearchIdx = 0; }
                else { this.currentSearchIdx--; if (this.currentSearchIdx < 0) this.currentSearchIdx = this.searchResults.length - 1; }
                statusEl.innerText = `${this.currentSearchIdx + 1}/${this.searchResults.length}`;
                const result = this.searchResults[this.currentSearchIdx];
                if (this.getDoc().currentIndex !== result.pageIdx) { await this.loadPage(result.pageIdx); } else { this.renderSearchHighlights(); }
            },

            clearSearch: function () {
                document.getElementById('searchInput').value = '';
                document.getElementById('searchStatusMini').innerText = '';
                this.searchResults = []; this.currentSearchIdx = -1; this.lastSearchTerm = '';
                this.renderSearchHighlights();
            },

            _activeCommentId: null,

            // Construye el SVG del pin según color y estado
            _buildPinSVG: function(color, resolved) {
                const c = resolved ? '#22c55e' : (color || '#f59e0b');
                // Circular icon matching the original "embebido" style but with modern aesthetics
                return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:32px;height:32px;display:block;">
                  <!-- Base Circle -->
                  <circle cx="16" cy="16" r="14" fill="${c}" stroke="white" stroke-width="1.5" 
                    style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/>
                  
                  <!-- Three horizontal lines (typical "comment" icon) -->
                  <g transform="translate(8, 10)">
                    <line x1="2" y1="3" x2="14" y2="3" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                    <line x1="2" y1="7.5" x2="14" y2="7.5" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                    <line x1="2" y1="12" x2="9" y2="12" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                  </g>

                  ${resolved ? `
                  <circle cx="25" cy="7" r="6" fill="#22c55e" stroke="white" stroke-width="1.5"/>
                  <polyline points="22,7 24,9 28,5" stroke="white" stroke-width="2" fill="none" 
                    stroke-linecap="round" stroke-linejoin="round"/>` : ''}
                </svg>`;
            },

            // Renderiza todos los pines de comentario directamente en canvas-container
            addComment: function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { this.showToast('Abre un documento primero'); return; }

                this.showToast('💬 Haz clic en la página para colocar el comentario');
                const panel      = this.splitView.activePanel;
                const panelSuffix = panel === 'secondary' ? 'Secondary' : 'Primary';
                const mainView   = document.getElementById('mainView' + panelSuffix);
                if (!mainView) return;

                const handler = (e) => {
                    // Ignorar clicks en pines o popup
                    if (e.target.closest('.comment-pin') || e.target.closest('#comment-popup')) return;
                    mainView.removeEventListener('click', handler, true);

                    const panelState = this.splitView[panel];
                    const scale  = panelState?.scale || this.currentScale;
                    const elements = this.getPanelElements(panel);
                    const cRect  = elements.canvasContainer?.getBoundingClientRect();
                    if (!cRect) return;

                    const rawX = (e.clientX - cRect.left) / scale;
                    const rawY = (e.clientY - cRect.top)  / scale;

                    const text = prompt('Escribe tu comentario:');
                    if (!text || !text.trim()) return;

                    // Color picker
                    const colors = ['#f59e0b','#3b82f6','#ec4899','#8b5cf6','#14b8a6','#f97316','#ef4444'];
                    const color  = colors[Math.floor(Math.random() * colors.length)];
                    const now    = new Date();

                    this.addObject({
                        type: 'comment', x: rawX, y: rawY,
                        width: 32 / scale, height: 38 / scale,
                        text: text.trim(), color, author: localStorage.getItem('alioth_comment_author') || 'Usuario',
                        date: now.toLocaleDateString('es', { day:'2-digit', month:'2-digit', year:'numeric' }),
                        time: now.toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' }),
                        replies: [], resolved: false, reactions: {},
                    });
                    this.showToast('✅ Comentario agregado');
                };
                mainView.addEventListener('click', handler, true);
            },

            _commentAvatarColor: function (author) {
                // Extended premium palette for avatars to avoid overlap with pin colors
                const palette = [
                    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', 
                    '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#d946ef', '#f43f5e',
                    '#14b8a6', '#7c3aed', '#fbbf24', '#2dd4bf'
                ];
                let h = 0;
                const name = (author || 'Usuario').trim();
                for (let i = 0; i < name.length; i++) {
                    h = ((h << 5) - h) + name.charCodeAt(i);
                    h |= 0; // Convert to 32bit integer
                }
                return palette[Math.abs(h) % palette.length];
            },

            _markNativeCommentModified: function(obj) {
                if (!obj || !obj._isNative) return;
                const doc = this.getDoc();
                if (!doc) return;
                if (!doc.modifiedNativeComments) doc.modifiedNativeComments = {};
                const pIdx = doc.currentIndex;
                if (!doc.modifiedNativeComments[pIdx]) doc.modifiedNativeComments[pIdx] = {};
                doc.modifiedNativeComments[pIdx][obj._nativeRawId] = {
                    author: obj.author,
                    text: obj.text,
                    color: obj.color,
                    resolved: obj.resolved,
                    replies: obj.replies,
                    reactions: obj.reactions,
                    partReactions: obj.partReactions
                };
                this.saveState(); // Save to local history as well
            },

            openCommentPopup: function (commentId, pinEl, forceObj) {
                const doc  = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                const obj  = forceObj || page?.objects?.find(o => o.id === commentId);
                if (!obj) return;

                this._activeCommentId = commentId;
                this._activeCommentPinEl = pinEl;
                const popup   = document.getElementById('comment-popup');
                const avatar  = document.getElementById('comment-popup-avatar');
                const authorEl= document.getElementById('comment-popup-author');
                const time    = document.getElementById('comment-popup-time');
                const textEl  = document.getElementById('comment-popup-text');
                const replies = document.getElementById('comment-popup-replies');
                const lockBtn = document.getElementById('comment-popup-lock');

                // Header
                const aColor = this._commentAvatarColor(obj.author || 'U');
                avatar.style.background = aColor;
                avatar.textContent = (obj.author || 'U')[0].toUpperCase();
                authorEl.textContent = obj.author || 'Usuario';

                // Format date+time
                let timeStr = obj.time || '';
                if (obj.date) { timeStr = obj.date + (timeStr ? ' ' + timeStr : ''); }
                time.textContent = timeStr;

                // Lock button state
                if (lockBtn) {
                    lockBtn.classList.toggle('locked', !!obj.locked);
                    lockBtn.title = obj.locked ? 'Desbloquear comentario' : 'Bloquear comentario';
                    lockBtn.onclick = (ev) => { ev.stopPropagation(); this.commentCtxAction('lock'); };
                }

                // Edit name helper
                const editName = () => {
                    if (obj.locked) { this.showToast('🔒 Comentario bloqueado'); return; }
                    const n = prompt('Nombre del autor:', obj.author || 'Usuario');
                    if (n && n.trim()) {
                        obj.author = n.trim();
                        if (obj._isNative) this._markNativeCommentModified(obj);
                        else this.saveState();
                        this.openCommentPopup(commentId, pinEl, obj._isNative ? obj : undefined);
                    }
                };
                avatar.onclick   = (ev) => { ev.stopPropagation(); editName(); };
                authorEl.onclick = (ev) => { ev.stopPropagation(); editName(); };

                // ── Renderizado Estilo Chat ──
                textEl.innerHTML = '';
                replies.innerHTML = '';
                popup.querySelectorAll('.comment-resolved-badge').forEach(b => b.remove());

                if (obj.resolved) {
                    const badge = document.createElement('div');
                    badge.className = 'comment-resolved-badge';
                    badge.textContent = '✓ Resuelto';
                    badge.style.marginBottom = '12px';
                    textEl.appendChild(badge);
                }

                const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🎉','👏','🔥'];
                const REACTION_PICKER_ID = 'comment-reaction-picker-global';

                const createReactionRow = (targetType, targetIdx) => {
                    const row = document.createElement('div');
                    row.className = 'comment-reaction-row';
                    
                    const reactBtn = document.createElement('button');
                    reactBtn.className = 'comment-reaction-btn-add';
                    reactBtn.innerHTML = '+';
                    reactBtn.title = 'Reaccionar';
                    
                    let reactionsObj = {};
                    if (targetType === 'main') reactionsObj = obj.reactions || {};
                    else if (targetType === 'part') reactionsObj = (obj.partReactions && obj.partReactions[targetIdx]) || {};
                    else if (targetType === 'reply') reactionsObj = (obj.replies && obj.replies[targetIdx] && obj.replies[targetIdx].reactions) || {};

                    reactBtn.onclick = (ev) => {
                        ev.stopPropagation();
                        const picker = document.getElementById(REACTION_PICKER_ID);
                        if (!picker) return;
                        
                        // Close if clicking same button
                        if (picker.classList.contains('visible') && picker._lastBtn === reactBtn) {
                            picker.classList.remove('visible');
                            return;
                        }

                        picker.innerHTML = '';
                        picker._lastBtn = reactBtn;
                        REACTION_EMOJIS.forEach(emoji => {
                            const b = document.createElement('button');
                            b.textContent = emoji;
                            b.onclick = (ev2) => {
                                ev2.stopPropagation();
                                if (targetType === 'main') {
                                    if (!obj.reactions) obj.reactions = {};
                                    obj.reactions[emoji] = (obj.reactions[emoji] || 0) + 1;
                                } else if (targetType === 'part') {
                                    if (!obj.partReactions) obj.partReactions = {};
                                    if (!obj.partReactions[targetIdx]) obj.partReactions[targetIdx] = {};
                                    obj.partReactions[targetIdx][emoji] = (obj.partReactions[targetIdx][emoji] || 0) + 1;
                                } else if (targetType === 'reply') {
                                    if (!obj.replies[targetIdx].reactions) obj.replies[targetIdx].reactions = {};
                                    obj.replies[targetIdx].reactions[emoji] = (obj.replies[targetIdx].reactions[emoji] || 0) + 1;
                                }

                                if (obj._isNative) this._markNativeCommentModified(obj);
                                else this.saveState();
                                picker.classList.remove('visible');
                                this.openCommentPopup(commentId, pinEl, obj._isNative ? obj : undefined);
                            };
                            picker.appendChild(b);
                        });

                        // Position logic
                        picker.style.display = 'flex'; // Temporarily show to get offsetHeight
                        picker.style.visibility = 'hidden';
                        const rect = reactBtn.getBoundingClientRect();
                        const pHeight = picker.offsetHeight || 44;
                        const pWidth = picker.offsetWidth || 160;
                        picker.style.visibility = 'visible';
                        picker.style.display = '';

                        let left = rect.left;
                        if (left + pWidth > window.innerWidth - 10) left = window.innerWidth - pWidth - 10;
                        
                        let pTop = rect.top - pHeight - 8;
                        if (pTop < 10) pTop = rect.bottom + 8; // Flip to bottom if no space on top

                        picker.style.left = left + 'px';
                        picker.style.top  = pTop + 'px';
                        picker.classList.add('visible');

                        // Global click away listener (added only once)
                        if (!window._reactionPickerGlobalHandler) {
                            window.addEventListener('mousedown', (e) => {
                                if (picker.classList.contains('visible') && !picker.contains(e.target) && !e.target.closest('.comment-reaction-btn-add')) {
                                    picker.classList.remove('visible');
                                }
                            });
                            window._reactionPickerGlobalHandler = true;
                        }
                    };
                    row.appendChild(reactBtn);

                    if (reactionsObj) {
                        const counts = document.createElement('div');
                        counts.className = 'comment-reaction-counts';
                        Object.entries(reactionsObj).forEach(([emoji, count]) => {
                            if (count > 0) {
                                const s = document.createElement('span');
                                s.className = 'comment-reaction-count';
                                s.textContent = emoji + ' ' + count;
                                s.onclick = (ev) => {
                                    ev.stopPropagation();
                                    reactionsObj[emoji]--;
                                    if (reactionsObj[emoji] <= 0) delete reactionsObj[emoji];
                                    if (obj._isNative) this._markNativeCommentModified(obj);
                                    else this.saveState();
                                    this.openCommentPopup(commentId, pinEl, obj._isNative ? obj : undefined);
                                };
                                counts.appendChild(s);
                            }
                        });
                        if (counts.childNodes.length > 0) row.appendChild(counts);
                    }
                    return row;
                };

                // ── Parsing de Texto Principal ──
                let textBubbles = [];
                if (obj._isNative && obj.text) {
                    // Split more robustly by common separators
                    const parts = obj.text.split(/\[\]\s*Respuestas\s*\[\]|--\s*Respuestas\s*--|__\s*Respuestas\s*__|\n\s*\n/i);
                    parts.forEach((p, idx) => {
                        let t = p.trim();
                        if (!t) return;
                        
                        let a = (idx === 0) ? (obj.author || 'Usuario') : 'Usuario';
                        // Detect "Usuario: Name" or "Autor: Name" at start
                        const uMatch = t.match(/^(?:Usuario|Autor):\s*([^\n]+)\n?([\s\S]*)$/i);
                        if (uMatch) {
                            a = uMatch[1].trim();
                            t = uMatch[2].trim();
                        }
                        
                        // Clean up trailing reaction counts often found in native PDF exports
                        t = t.replace(/\[\p{Emoji_Presentation}\s*\d+\]/gu, '').trim();
                        
                        if (t) textBubbles.push({ author: a, text: t, idx: idx, isMain: (idx === 0) });
                    });
                } else {
                    textBubbles.push({ author: obj.author || 'Usuario', text: obj.text || '', idx: 0, isMain: true });
                }
                if (obj.translationNote && !obj._isNative) {
                    textBubbles = [
                        { author: obj.author || 'Traducción', text: obj.text || '', idx: 0, isMain: true }
                    ];
                }

                textBubbles.forEach(b => {
                    const item = document.createElement('div');
                    item.className = 'comment-reply-item';
                    const av = document.createElement('div');
                    av.className = 'comment-reply-avatar';
                    av.style.background = this._commentAvatarColor(b.author);
                    av.textContent = b.author[0].toUpperCase();
                    const bubble = document.createElement('div');
                    bubble.className = 'comment-reply-bubble';
                    const auth = document.createElement('div');
                    auth.className = 'comment-reply-author';
                    auth.textContent = b.author;
                    const txt = document.createElement('div');
                    txt.className = 'comment-reply-text';
                    txt.textContent = b.text;
                    bubble.appendChild(auth);
                    bubble.appendChild(txt);
                    if (b.isMain && (obj.date || obj.time)) {
                        const ts = document.createElement('div');
                        ts.className = 'comment-bubble-timestamp';
                        ts.textContent = [obj.date, obj.time].filter(Boolean).join(' ');
                        bubble.appendChild(ts);
                    }
                    
                    const actionCol = document.createElement('div');
                    actionCol.className = 'comment-item-actions';
                    actionCol.appendChild(createReactionRow(b.isMain ? 'main' : 'part', b.idx));

                    item.appendChild(av);
                    item.appendChild(bubble);
                    item.appendChild(actionCol);
                    textEl.appendChild(item);
                });

                // ── Renderizar Respuestas ──
                (obj.replies || []).forEach((r, idx) => {
                    const isRight = (r.author || 'Usuario') !== (obj.author || 'Usuario');
                    const item = document.createElement('div');
                    item.className = 'comment-reply-item' + (isRight ? ' reply-right' : '');
                    const av = document.createElement('div');
                    av.className = 'comment-reply-avatar';
                    av.style.background = this._commentAvatarColor(r.author || 'U');
                    av.textContent = (r.author || 'U')[0].toUpperCase();
                    const bubble = document.createElement('div');
                    bubble.className = 'comment-reply-bubble';
                    const auth = document.createElement('div');
                    auth.className = 'comment-reply-author';
                    auth.textContent = r.author || 'Usuario';
                    auth.onclick = (ev) => {
                        ev.stopPropagation();
                        if (obj.locked) return;
                        const n = prompt('Autor:', r.author || 'Usuario');
                        if (n && n.trim()) {
                            r.author = n.trim();
                            if (obj._isNative) this._markNativeCommentModified(obj);
                            else this.saveState();
                            this.openCommentPopup(commentId, pinEl, obj._isNative ? obj : undefined);
                        }
                    };
                    const txt = document.createElement('div');
                    txt.className = 'comment-reply-text';
                    txt.textContent = r.text;
                    bubble.appendChild(auth);
                    bubble.appendChild(txt);
                    if (r.date || r.time) {
                        const ts = document.createElement('div');
                        ts.className = 'comment-bubble-timestamp';
                        ts.textContent = [r.date, r.time].filter(Boolean).join(' ');
                        bubble.appendChild(ts);
                    }

                    const actionCol = document.createElement('div');
                    actionCol.className = 'comment-item-actions';
                    actionCol.appendChild(createReactionRow('reply', idx));

                    item.appendChild(av);
                    item.appendChild(bubble);
                    item.appendChild(actionCol);
                    replies.appendChild(item);
                });

                const input = document.getElementById('comment-popup-input');
                if (input) {
                    input.disabled = !!obj.locked;
                    input.placeholder = obj.locked ? '🔒 Bloqueado' : 'Responder…';
                    input.value = '';
                    if (!obj.locked) setTimeout(() => input.focus(), 50);
                }
                // Initialize author name input with saved name
                const authorInput = document.getElementById('comment-author-name');
                if (authorInput) {
                    authorInput.value = localStorage.getItem('alioth_comment_author') || '';
                    authorInput.disabled = !!obj.locked;
                }
                const sendBtn = popup.querySelector('.comment-popup-send');
                if (sendBtn) sendBtn.style.opacity = obj.locked ? '0.4' : '1';

                popup.style.display = 'flex';
                popup.classList.remove('visible');
                const pw = popup.offsetWidth || 300, ph = popup.offsetHeight || 300;
                const pinRect = pinEl.getBoundingClientRect();
                let left = pinRect.right + 10, top = pinRect.top;
                if (left + pw > window.innerWidth - 10) left = pinRect.left - pw - 10;
                if (top + ph > window.innerHeight - 10) top = window.innerHeight - ph - 10;
                popup.style.left = left + 'px'; popup.style.top = top + 'px';
                popup.classList.add('visible');

                this._updateCommentPopupLine(pinEl, popup, obj.color || '#f59e0b');
                this._makeCommentPopupDraggable(popup, pinEl, obj.color || '#f59e0b');

                document.getElementById('comment-popup-close').onclick = () => this.closeCommentPopup();
                document.getElementById('comment-popup-menu-btn').onclick = (ev) => {
                    ev.stopPropagation();
                    this.openCommentCtxMenu(ev, commentId);
                };
            },

            closeCommentPopup: function () {
                const popup = document.getElementById('comment-popup');
                if (popup) { popup.classList.remove('visible'); popup.style.display = 'none'; }
                const lineEl = document.getElementById('comment-popup-line');
                if (lineEl) lineEl.style.display = 'none';
                this._activeCommentId = null;
                this._activeCommentPinEl = null;
            },

            sendCommentReply: function () {
                const input = document.getElementById('comment-popup-input');
                const text  = (input?.value || '').trim();
                if (!text) return;
                const doc  = this.getDoc();
                const page = doc?.pages[doc.currentIndex];
                let obj  = page?.objects?.find(o => o.id === this._activeCommentId);
                if (!obj && this._activeCommentId) {
                    const pinEl = document.getElementById('cpin-' + this._activeCommentId);
                    obj = pinEl?._nativeCommentObj || null;
                }
                if (!obj) return;
                if (obj.locked) { this.showToast('🔒 Comentario bloqueado'); return; }
                if (!obj.replies) obj.replies = [];
                const now = new Date();
                const authorNameInput = document.getElementById('comment-author-name');
                const authorName = (authorNameInput?.value || '').trim() || localStorage.getItem('alioth_comment_author') || 'Usuario';
                // Persist the author name for future use
                if (authorName && authorName !== 'Usuario') localStorage.setItem('alioth_comment_author', authorName);
                obj.replies.push({
                    author: authorName, text,
                    date: now.toLocaleDateString('es', { day:'2-digit', month:'2-digit', year:'numeric' }),
                    time: now.toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' }),
                });
                if (input) input.value = '';
                if (obj._isNative) this._markNativeCommentModified(obj);
                else this.saveState();
                const pinEl = document.getElementById('cpin-' + obj.id);
                if (pinEl) this.openCommentPopup(obj.id, pinEl, obj._isNative ? obj : undefined);
            },

            _updateCommentPopupLine: function(pinEl, popup, color) {
                const lineSvg = document.getElementById('comment-popup-line');
                const lineEl  = document.getElementById('comment-popup-line-el');
                if (!lineSvg || !lineEl || !pinEl || !popup) return;
                const pinR  = pinEl.getBoundingClientRect();
                const popR  = popup.getBoundingClientRect();
                const x1 = pinR.left + pinR.width / 2;
                const y1 = pinR.top  + pinR.height / 2;
                const x2 = popR.left;
                const y2 = popR.top  + popR.height / 2;
                const minX = Math.min(x1, x2) - 4;
                const minY = Math.min(y1, y2) - 4;
                const w = Math.abs(x2 - x1) + 8;
                const h = Math.abs(y2 - y1) + 8;
                lineSvg.style.cssText = `position:fixed;z-index:10499;pointer-events:none;left:${minX}px;top:${minY}px;width:${w}px;height:${h}px;overflow:visible;display:block;`;
                lineEl.setAttribute('x1', x1 - minX);
                lineEl.setAttribute('y1', y1 - minY);
                lineEl.setAttribute('x2', x2 - minX);
                lineEl.setAttribute('y2', y2 - minY);
                lineEl.setAttribute('stroke', color || '#f59e0b');
            },

            _makeCommentPopupDraggable: function(popup, pinEl, color) {
                const handle = document.getElementById('comment-popup-drag-handle');
                if (!handle) return;
                if (handle._dragSetup) { handle._dragSetup = null; }
                let dragging = false, startX, startY, origLeft, origTop;
                handle.style.cursor = 'grab';
                const onDown = (ev) => {
                    if (ev.target.closest('button')) return;
                    dragging = true;
                    startX = ev.clientX; startY = ev.clientY;
                    origLeft = parseInt(popup.style.left) || 0;
                    origTop  = parseInt(popup.style.top)  || 0;
                    handle.style.cursor = 'grabbing';
                    ev.preventDefault();
                    const onMove = (mv) => {
                        if (!dragging) return;
                        popup.style.left = (origLeft + mv.clientX - startX) + 'px';
                        popup.style.top  = (origTop  + mv.clientY - startY) + 'px';
                        this._updateCommentPopupLine(pinEl, popup, color);
                    };
                    const onUp = () => {
                        dragging = false;
                        handle.style.cursor = 'grab';
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                };
                handle.removeEventListener('mousedown', handle._dragHandler);
                handle._dragHandler = onDown;
                handle.addEventListener('mousedown', onDown);
                handle._dragSetup = true;
            },

            openCommentCtxMenu: function (e, commentId) {
                this._activeCommentId = commentId;
                const menu = document.getElementById('comment-ctx-menu');
                menu.classList.remove('visible');
                void menu.offsetWidth;
                menu.classList.add('visible');
                let left = e.clientX, top = e.clientY;
                if (left + 210 > window.innerWidth)  left = window.innerWidth  - 215;
                if (top  + 260 > window.innerHeight) top  = window.innerHeight - 265;
                menu.style.left = left + 'px';
                menu.style.top  = top  + 'px';

                // Fill pin colors in ctx menu
                const pinRow = document.getElementById('comment-ctx-pin-colors');
                if (pinRow) {
                    pinRow.innerHTML = '';
                    const doc  = this.getDoc();
                    const page = doc?.pages[doc.currentIndex];
                    let obj  = page?.objects?.find(o => o.id === commentId);
                    // For native annotations not in page.objects
                    if (!obj) {
                        const pinEl = document.getElementById('cpin-' + commentId) || document.getElementById('thover-' + commentId);
                        obj = pinEl?._nativeCommentObj || null;
                    }
                    const PIN_COLORS = ['#f59e0b','#3b82f6','#ec4899','#8b5cf6','#14b8a6','#f97316','#ef4444','#000000'];
                    PIN_COLORS.forEach(c => {
                        const sw = document.createElement('div');
                        sw.className = 'comment-color-swatch' + (obj?.color === c ? ' active' : '');
                        sw.style.cssText = `width:17px;height:17px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;border:2px solid ${obj?.color===c?'#fff':'transparent'};transition:transform 0.12s;`;
                        sw.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            if (!obj) return;
                            if (obj.locked) { this.showToast('🔒 Bloqueado'); return; }
                            
                            obj.color = c;
                            if (obj._isNative) {
                                this._markNativeCommentModified(obj);
                            } else {
                                this.saveState();
                            }
                            
                            // Update the pin SVG immediately (works for both native and manual pins)
                            const pinEl = document.getElementById('cpin-' + commentId) || document.getElementById('thover-' + commentId);
                            if (pinEl && pinEl.classList.contains('comment-pin')) {
                                pinEl.innerHTML = this._buildPinSVG(obj.color, obj.resolved);
                            }
                            
                            this.renderCommentPins(this.splitView.activePanel);
                            this.closeCommentCtxMenu();
                            if (pinEl && pinEl.classList.contains('comment-pin')) this.openCommentPopup(commentId, pinEl, obj._isNative ? obj : undefined);
                        });
                        pinRow.appendChild(sw);
                    });
                }
            },

            closeCommentCtxMenu: function () {
                document.getElementById('comment-ctx-menu')?.classList.remove('visible');
            },

            commentCtxAction: function (action) {
                this.closeCommentCtxMenu();
                const doc  = this.getDoc();
                const page = doc?.pages[doc.currentIndex];
                let obj  = page?.objects?.find(o => o.id === this._activeCommentId);
                // For native PDF annotations (not in page.objects), retrieve from DOM element
                if (!obj && this._activeCommentId) {
                    const pinEl = document.getElementById('cpin-' + this._activeCommentId) || document.getElementById('thover-' + this._activeCommentId);
                    obj = pinEl?._nativeCommentObj || null;
                }
                if (!obj) return;
                const panel = this.splitView.activePanel;

                if (action === 'delete') {
                    if (obj._isNative) {
                        const docRef = this.getDoc();
                        if (docRef) {
                            if (!docRef.hiddenNativeAnnotIds) docRef.hiddenNativeAnnotIds = {};
                            const pIdx = docRef.currentIndex;
                            if (!docRef.hiddenNativeAnnotIds[pIdx]) docRef.hiddenNativeAnnotIds[pIdx] = {};
                            docRef.hiddenNativeAnnotIds[pIdx][obj._nativeRawId] = true;
                        }
                        this.closeCommentPopup();
                        this.hideTranslationTooltip?.(true);
                        this.saveState();
                        this.loadPage(this.getDoc().currentIndex);
                        this.showToast('🗑️ Comentario eliminado');
                    } else {
                        page.objects = page.objects.filter(o => o.id !== this._activeCommentId);
                        this.closeCommentPopup();
                        this.hideTranslationTooltip?.(true);
                        this.saveState();
                        this.renderCommentPins(panel);
                        this.showToast('🗑️ Comentario eliminado');
                    }
                } else if (action === 'resolve') {
                    if (obj.locked) { this.showToast('🔒 Desbloquea primero'); return; }
                    obj.resolved = !obj.resolved;
                    if (obj._isNative) this._markNativeCommentModified(obj);
                    else { this.saveState(); this.renderCommentPins(panel); }
                    const pinEl = document.getElementById('cpin-' + obj.id);
                    if (pinEl) {
                        pinEl.innerHTML = this._buildPinSVG(obj.color, obj.resolved);
                        this.openCommentPopup(obj.id, pinEl, obj._isNative ? obj : undefined);
                    }
                    this.showToast(obj.resolved ? '✅ Marcado como resuelto' : '🔁 Reabierto');
                } else if (action === 'lock') {
                    obj.locked = !obj.locked;
                    if (!obj._isNative) { this.saveState(); this.renderCommentPins(panel); }
                    const pinEl = document.getElementById('cpin-' + obj.id);
                    if (pinEl) this.openCommentPopup(obj.id, pinEl, obj._isNative ? obj : undefined);
                    this.showToast(obj.locked ? '🔒 Comentario bloqueado' : '🔓 Comentario desbloqueado');
                } else if (action === 'edit') {
                    const newText = prompt('Editar comentario:', obj.text || '');
                    if (newText !== null && newText.trim()) {
                        obj.text = newText.trim();
                        if (!obj._isNative) this.saveState();
                        const pinEl = document.getElementById('cpin-' + obj.id);
                        if (pinEl) this.openCommentPopup(obj.id, pinEl, obj._isNative ? obj : undefined);
                    }
                } else if (action === 'copy') {
                    navigator.clipboard.writeText(obj.text || '').then(() => this.showToast('📋 Texto copiado'));
                }
            },

            showContextMenu: function (e, obj) {
                const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                const menu = document.getElementById('context-menu');
                const content = document.getElementById('ctx-dynamic-content');
                content.innerHTML = '';
                let html = '';
                const multiCount = this.multiObjectSelection ? this.multiObjectSelection.size : 0;

                const doc = this.getDoc();
                const page = doc ? doc.pages[doc.currentIndex] : null;
                const anyGrouped = page && multiCount > 0 && (page.objects || []).some(o =>
                    this.multiObjectSelection.has(o.id) && o._groupId
                );

                const item = (svg, label, onclick, extra = '') => {
                    return `<div class="ctx-item" ${onclick ? `onclick="${onclick}"` : ''} ${extra}>${svg}<span>${label}</span></div>`;
                };

                const I = {
                    text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
                    image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
                    paste_text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/></svg>',
                    bookmark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
                    index: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
                    properties: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
                    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
                    crop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
                    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
                    paste: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
                    copy_props: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><circle cx="12" cy="13" r="2"/></svg>',
                    paste_props: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11v4M10 13h4"/></svg>',
                    size: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>',
                    group: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="2 2"/><rect width="5" height="5" x="6" y="6" rx="1"/><rect width="5" height="5" x="13" y="13" rx="1"/></svg>',
                    ungroup: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="6" height="6" x="3" y="3" rx="1"/><rect width="6" height="6" x="15" y="15" rx="1"/></svg>',
                    align_h: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="21" y1="12" x2="3" y2="12"/><rect width="6" height="4" x="5" y="10" rx="1"/><rect width="6" height="4" x="13" y="10" rx="1"/></svg>',
                    align_v: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><line x1="12" y1="3" x2="12" y2="21"/><rect width="4" height="6" x="10" y="5" rx="1"/><rect width="4" height="6" x="10" y="13" rx="1"/></svg>',
                    order: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
                    transform: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
                    delete: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
                    shape: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
                    fill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M19 11l-8-8-8 8a5.5 5.5 0 0 0 7.78 7.78l.22-.22.22.22A5.5 5.5 0 0 0 19 11z"/><path d="m5 2 5 5"/></svg>',
                    stroke: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/></svg>',
                    shadow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 8h11a2 2 0 0 1 2 2v11" opacity="0.5"/></svg>',
                    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/></svg>'
                };

                if (obj) {
                    const sameTypeCount = multiCount > 1 ? (() => {
                        const page2 = doc ? doc.pages[doc.currentIndex] : null;
                        return page2 ? (page2.objects||[]).filter(o => this.multiObjectSelection.has(o.id) && o.type === obj.type && (!obj.fieldType || o.fieldType === obj.fieldType)).length : 1;
                    })() : 1;
                    if (sameTypeCount > 1) {
                        html += `<div style="padding:4px 12px 2px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:rgba(99,180,255,0.7);">${I.group}<span>${t('ctx_group_edit', 'Edición en grupo')} (${sameTypeCount} ${t('ctx_objects', 'objetos')})</span></div><div class="ctx-divider"></div>`;
                    }
                    if (obj.type === 'form-field' || (obj.type === 'text' && obj.fromFormField) || obj.type === 'table') {
                        html += item(I.properties, t('btn_properties', 'Propiedades'), 'app.openProperties(app.selectedObj)') + `<div class="ctx-divider"></div>`;
                    }
                    if (obj.type === 'shape' || obj.type === 'connector') {
                        html += `<div style="padding:6px 12px 2px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.45);display:flex;align-items:center;gap:6px;">${I.properties}<span>Opciones de Forma</span></div><div class="ctx-divider"></div>`;
                        
                        // Submenú: Cambiar Forma
                        html += `<div class="ctx-item">${I.shape}<span>${t('ctx_change_shape', 'Cambiar Forma...')}</span><div class="ctx-submenu">`
                            + `<div class="ctx-item" onclick="app.setShapeType('rect')"><span>⬜ Rectángulo</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('round_rect')"><span>▢ Rect. Redondeado</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('circle')"><span>⚪ Círculo / Óvalo</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('triangle')"><span>▲ Triángulo</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('arrow')"><span>➔ Flecha Gruesa</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('double_arrow')"><span>⬄ Flecha Doble</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('arrow_line')"><span>⟶ Línea con Flecha</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('star')"><span>★ Estrella</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('heart')"><span>♥ Corazón</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('cloud')"><span>☁ Nube</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('diamond')"><span>◆ Diamante</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('hexagon')"><span>⬡ Hexágono</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('pentagon')"><span>⬟ Pentágono</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('cross')"><span>✚ Cruz</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('no_entry')"><span>⊘ Prohibido</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('cylinder')"><span>⌸ Cilindro</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeType('burst')"><span>💥 Destello</span></div>`
                            + `</div></div>`;

                        // Submenú: Relleno
                        const isNoFill = obj.noFill === true;
                        html += `<div class="ctx-item">${I.fill}<span>${t('ctx_shape_fill', 'Relleno...')}</span><div class="ctx-submenu">`
                            + `<div class="ctx-item" onclick="app.toggleShapeNoFill()"><span>${isNoFill ? '☑' : '☐'} ${t('shape_no_fill', 'Sin Relleno')}</span></div>`
                            + `<div class="ctx-divider"></div>`
                            + `<div style="padding:2px 8px;font-size:9px;color:rgba(255,255,255,0.6);text-transform:uppercase;font-weight:600;">Color Rápido</div>`
                            + `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px 6px;">`
                            + `  <div onclick="app.setShapeFillColor('#ef4444')" title="Rojo" style="width:20px;height:20px;border-radius:50%;background:#ef4444;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#3b82f6')" title="Azul" style="width:20px;height:20px;border-radius:50%;background:#3b82f6;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#10b981')" title="Verde" style="width:20px;height:20px;border-radius:50%;background:#10b981;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#f59e0b')" title="Amarillo" style="width:20px;height:20px;border-radius:50%;background:#f59e0b;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#8b5cf6')" title="Morado" style="width:20px;height:20px;border-radius:50%;background:#8b5cf6;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#f97316')" title="Naranja" style="width:20px;height:20px;border-radius:50%;background:#f97316;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#ffffff')" title="Blanco" style="width:20px;height:20px;border-radius:50%;background:#ffffff;cursor:pointer;border:1px solid rgba(0,0,0,0.3);"></div>`
                            + `  <div onclick="app.setShapeFillColor('#000000')" title="Negro" style="width:20px;height:20px;border-radius:50%;background:#000000;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `</div>`
                            + `<div class="ctx-divider"></div>`
                            + `<div style="padding:2px 8px;font-size:9px;color:rgba(255,255,255,0.6);text-transform:uppercase;font-weight:600;">Opacidad Relleno</div>`
                            + `<div class="ctx-item" onclick="app.setShapeFillOpacity(1.0)"><span>100% (Opaco)</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeFillOpacity(0.75)"><span>75%</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeFillOpacity(0.5)"><span>50%</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeFillOpacity(0.25)"><span>25%</span></div>`
                            + `</div></div>`;

                        // Submenú: Borde / Contorno
                        const isNoBorder = obj.noBorder === true;
                        html += `<div class="ctx-item">${I.stroke}<span>${t('ctx_shape_border', 'Borde / Trazo...')}</span><div class="ctx-submenu">`
                            + `<div class="ctx-item" onclick="app.toggleShapeNoBorder()"><span>${isNoBorder ? '☑' : '☐'} ${t('shape_no_border', 'Sin Borde')}</span></div>`
                            + `<div class="ctx-divider"></div>`
                            + `<div style="padding:2px 8px;font-size:9px;color:rgba(255,255,255,0.6);text-transform:uppercase;font-weight:600;">Grosor</div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeWidth(1)"><span>1 px (Fino)</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeWidth(2)"><span>2 px (Normal)</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeWidth(4)"><span>4 px (Medio)</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeWidth(8)"><span>8 px (Grueso)</span></div>`
                            + `<div class="ctx-divider"></div>`
                            + `<div style="padding:2px 8px;font-size:9px;color:rgba(255,255,255,0.6);text-transform:uppercase;font-weight:600;">Tipo de Línea</div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeDash('none')"><span>──── Continua</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeDash('4,4')"><span>- - - Discontinua</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeDash('2,3')"><span>····· Punteada</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeStrokeDash('8,4,2,4')"><span>-·-·- Guión-Punto</span></div>`
                            + `<div class="ctx-divider"></div>`
                            + `<div style="padding:2px 8px;font-size:9px;color:rgba(255,255,255,0.6);text-transform:uppercase;font-weight:600;">Color Borde</div>`
                            + `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px 6px;">`
                            + `  <div onclick="app.setShapeStrokeColor('#000000')" title="Negro" style="width:20px;height:20px;border-radius:50%;background:#000000;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeStrokeColor('#ef4444')" title="Rojo" style="width:20px;height:20px;border-radius:50%;background:#ef4444;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeStrokeColor('#3b82f6')" title="Azul" style="width:20px;height:20px;border-radius:50%;background:#3b82f6;cursor:pointer;border:1px solid rgba(255,255,255,0.3);"></div>`
                            + `  <div onclick="app.setShapeStrokeColor('#ffffff')" title="Blanco" style="width:20px;height:20px;border-radius:50%;background:#ffffff;cursor:pointer;border:1px solid rgba(0,0,0,0.3);"></div>`
                            + `</div>`
                            + `</div></div>`;

                        // Submenú: Sombra
                        html += `<div class="ctx-item">${I.shadow}<span>${t('ctx_shape_shadow', 'Sombra...')}</span><div class="ctx-submenu">`
                            + `<div class="ctx-item" onclick="app.setShapeShadowPreset('none')"><span>${!obj.shadow ? '☑' : '☐'} Sin Sombra</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeShadowPreset('soft')"><span>${obj.shadow && obj.shadowBlur <= 6 ? '☑' : '☐'} Sombra Suave</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeShadowPreset('medium')"><span>${obj.shadow && obj.shadowBlur > 6 && obj.shadowBlur <= 12 ? '☑' : '☐'} Sombra Media</span></div>`
                            + `<div class="ctx-item" onclick="app.setShapeShadowPreset('hard')"><span>${obj.shadow && obj.shadowBlur > 12 ? '☑' : '☐'} Sombra Fuerte</span></div>`
                            + `</div></div>`;

                        // Toolbar sync
                        html += item(I.edit, t('ctx_edit_in_draw', 'Editar en Barra de Dibujo'), 'app.switchRibbon(\'draw\'); app.syncShapeControls(app.selectedObj);');
                        html += `<div class="ctx-divider"></div>`;
                    }
                    if (obj.type === 'text') {
                        html += item(I.edit, t('ctx_edit_text', 'Editar Texto'), 'app.editText(app.selectedObj)') + `<div class="ctx-divider"></div>`;
                    }
                    if (obj.type === 'image') {
                        html += item(I.crop, t('ctx_crop_img', 'Recortar Imagen'), 'app.cropImage(app.selectedObj)') + `<div class="ctx-divider"></div>`;
                    }
                    if (obj.type !== 'link') {
                        html += item(I.link, obj.actionLink ? 'Editar vínculo' : 'Agregar vínculo', 'app.showObjectLinkModal(app.selectedObj)');
                        if (obj.actionLink) html += item(I.link, 'Eliminar vínculo', 'app.removeObjectLink(app.selectedObj)');
                        html += `<div class="ctx-divider"></div>`;
                    }
                    html += item(I.copy, `${t('btn_copy', 'Copiar')}${multiCount > 1 ? ' (' + multiCount + ')' : ''}`, 'app.copyObject()');
                    html += item(I.copy_props, t('ctx_copy_props', 'Copiar propiedades'), 'app.copyObjectProperties()');
                    if (this._propClipboard) html += item(I.paste_props, t('ctx_paste_props', 'Pegar propiedades'), 'app.pasteObjectProperties()');
                    
                    html += `<div class="ctx-item">${I.size}<span>${t('ctx_copy_size', 'Copiar tamaño...')}</span><div class="ctx-submenu"><div class="ctx-item" onclick="app.copyObjectSize()">${I.size}<span>${t('ctx_size_wh', 'Ancho y Alto')}</span></div><div class="ctx-item" onclick="app.copyObjectWidth()">${I.size}<span>${t('ctx_size_w', 'Solo Ancho')}</span></div><div class="ctx-item" onclick="app.copyObjectHeight()">${I.size}<span>${t('ctx_size_h', 'Solo Alto')}</span></div></div></div>`;
                    if (this._sizeClipboard && this._sizeClipboard._sourceType === obj.type) html += item(I.size, t('ctx_paste_size', 'Pegar tamaño'), 'app.pasteObjectSize()');
                    html += `<div class="ctx-divider"></div>`;

                    if (multiCount > 1) {
                        html += item(I.group, t('ctx_group_sel', 'Agrupar selección'), 'app.groupSelectedObjects()');
                    }
                    if (anyGrouped) {
                        html += item(I.ungroup, t('ctx_ungroup', 'Desagrupar'), 'app.ungroupObject(app.selectedObj)');
                    }
                    if (multiCount > 1 || anyGrouped) html += `<div class="ctx-divider"></div>`;
                    if (multiCount > 1) {
                        html += item(I.align_h, t('ctx_align_h', 'Alinear Horizontal (mismo Y)'), 'app.alignSelectedObjects(\'horizontal\')');
                        html += item(I.align_v, t('ctx_align_v', 'Alinear Vertical (mismo X)'), 'app.alignSelectedObjects(\'vertical\')');
                        html += `<div class="ctx-divider"></div>`;
                    }
                    html += `<div class="ctx-item">${I.order}<span>${t('ctx_order', 'Ordenar...')}</span><div class="ctx-submenu"><div class="ctx-item" onclick="app.moveObjectZ('front')">${t('ctx_order_front', 'Al Frente')}</div><div class="ctx-item" onclick="app.moveObjectZ('back')">${t('ctx_order_back', 'Al Fondo')}</div></div></div>`;
                    html += `<div class="ctx-item">${I.transform}<span>${t('ctx_transform', 'Transformar...')}</span><div class="ctx-submenu"><div class="ctx-item" onclick="app.rotateSelectedObject(90)">${t('ctx_rot_p90', 'Rotar +90°')}</div><div class="ctx-item" onclick="app.rotateSelectedObject(-90)">${t('ctx_rot_m90', 'Rotar -90°')}</div><div class="ctx-item" onclick="app.flipObject('h')">${t('ctx_flip_h', 'Espejo H')}</div><div class="ctx-item" onclick="app.flipObject('v')">${t('ctx_flip_v', 'Espejo V')}</div></div></div>`;
                    html += `<div class="ctx-divider"></div>` + item(I.delete, `${t('btn_delete', 'Eliminar')}${multiCount > 1 ? ' (' + multiCount + ')' : ''}`, 'app.deleteObject()', 'style="color:#ff6b6b"');
                } else {
                    if (multiCount > 1) {
                        html += item(I.copy, `${t('ctx_copy_sel', 'Copiar selección')} (${multiCount})`, 'app.copyObject()');
                        html += item(I.group, t('ctx_group_sel', 'Agrupar selección'), 'app.groupSelectedObjects()');
                        if (anyGrouped) html += item(I.ungroup, t('ctx_ungroup', 'Desagrupar'), 'app.ungroupObject(app.selectedObj)');
                        html += `<div class="ctx-divider"></div>`;
                    }
                    if (this.clipboard) html += item(I.paste, t('btn_paste', 'Pegar'), 'app.pasteObject()') + `<div class="ctx-divider"></div>`;
                    html += item(I.text, t('ctx_add_text', 'Añadir Texto'), 'app.addText()');
                    html += item(I.image, t('ctx_add_img', 'Añadir Imagen'), 'document.querySelector(\'#toolbar-image input[type=file]\').click()');
                    html += item(I.paste_text, t('ctx_paste_plain_txt', 'Pegar Texto Plano'), 'navigator.clipboard.readText().then(t => { if(t) app.addText(t); })');
                    html += `<div class="ctx-divider"></div>`;
                    html += item(I.bookmark, t('ctx_add_bm_here', 'Añadir marcador aquí'), 'BookmarkManager.openModal()');
                    html += item(I.index, t('ctx_add_to_index', 'Añadir al índice'), 'app.addIndexEntryManual()');
                }
                content.innerHTML = html;
                window.bindFloatingSubmenus?.(menu);
                menu.style.display = 'flex';
                menu.classList.remove('anim-in');
                void menu.offsetWidth;
                menu.classList.add('anim-in');
                requestAnimationFrame(() => {
                    const placed = window.positionFloatingMenu?.(menu, { x: e.clientX, y: e.clientY });
                    menu.classList.toggle('submenu-left', !!placed && placed.left + menu.getBoundingClientRect().width + 8 > window.innerWidth);
                });
            },

            // --- FUNCIONES FALTANTES AGREGADAS ---

            toggleSidebarGrid: function () {
                const sidebar = document.getElementById('sidebar');
                const list = document.getElementById('sidebarList');
                const closeBtn = document.getElementById('sidebarGridCloseBtn');
                const gridBtn = document.getElementById('sidebarGridFloatBtn');
                const gridBtnReading = document.getElementById('sidebarGridReadingBtn');
                if (!list || !sidebar) return;

                const isGrid = sidebar.classList.toggle('fullscreen-grid');
                document.body.classList.toggle('sidebar-fullgrid', isGrid);
                const gridToolbar = document.getElementById('sidebarGridToolbar');
                if (gridToolbar) gridToolbar.style.display = isGrid ? 'flex' : 'none';

                const activeStyle = 'rgba(255,255,255,0.28)';
                if (isGrid) {
                    list.classList.add('grid-mode');
                    this._updateGridSelectAllButton();
                    if (closeBtn) closeBtn.style.display = 'flex';
                    [gridBtn, gridBtnReading].forEach(b => {
                        if (!b) return;
                        b.style.animation = 'none';
                        b.classList.add('active');
                        requestAnimationFrame(() => { b.style.animation = ''; });
                    });
                    // Cerrar con Escape
                    this._gridEscHandler = (e) => { if (e.key === 'Escape') this.toggleSidebarGrid(); };
                    document.addEventListener('keydown', this._gridEscHandler);
                } else {
                    list.classList.remove('grid-mode');
                    if (closeBtn) closeBtn.style.display = 'none';
                    if (gridBtn) { gridBtn.classList.remove('active'); gridBtn.style.background = ''; }
                    if (gridBtnReading) { gridBtnReading.classList.remove('active'); gridBtnReading.style.background = ''; }
                    if (this._gridEscHandler) {
                        document.removeEventListener('keydown', this._gridEscHandler);
                        this._gridEscHandler = null;
                    }
                }
            },

            _updateGridSelectAllButton: function () {
                const button = document.getElementById('gridSelectAllBtn');
                const doc = this.getDoc();
                if (!button || !doc) return;
                const allSelected = doc.pages.length > 0 && this.multiSelection.size === doc.pages.length;
                button.textContent = allSelected ? 'Deseleccionar todo' : 'Seleccionar todo';
                button.title = allSelected ? 'Deseleccionar todas las páginas' : 'Seleccionar todas las páginas';
            },

            gridSelectAllPages: function () {
                const doc = this.getDoc();
                if (!doc) return;
                const allSelected = doc.pages.length > 0 && this.multiSelection.size === doc.pages.length;
                this.multiSelection.clear();
                if (!allSelected) {
                    doc.pages.forEach((_, index) => this.multiSelection.add(index));
                    this.lastClickIndex = 0;
                }
                this.updateSidebarSelection(doc.currentIndex);
                this._updateGridSelectAllButton();
            },

            _gridGetSelectedThumb: function () {
                return document.querySelector('#sidebarList .thumb-wrap.selected');
            },

            _gridGetPageIndex: function (thumbWrap) {
                if (!thumbWrap) return -1;
                const num = thumbWrap.querySelector('.thumb-num');
                return num ? parseInt(num.textContent) - 1 : -1;
            },

            gridDeleteSelectedPage: function () {
                const doc = this.getDoc(); if (!doc) return;
                const allSelected = document.querySelectorAll('#sidebarList .thumb-wrap.selected');
                if (!allSelected.length) { this.showToast('Selecciona una página primero'); return; }
                const indices = Array.from(allSelected).map(tw => this._gridGetPageIndex(tw)).filter(i => i >= 0);
                if (!indices.length) return;
                if (doc.pages.length <= indices.length) { this.showToast('No se puede borrar todas las páginas'); return; }
                if (!confirm('¿Borrar ' + indices.length + ' página(s)?')) return;
                this.saveState();
                indices.sort((a, b) => b - a).forEach(idx => doc.pages.splice(idx, 1));
                if (doc.currentIndex >= doc.pages.length) doc.currentIndex = doc.pages.length - 1;
                this.multiSelection.clear(); // evitar índices stale al volver a la vista normal
                this.renderSidebar();
                this.loadPage(doc.currentIndex);
                this.showToast(indices.length + ' página(s) borrada(s)');
            },

            gridInsertPage: function () {
                const tw = this._gridGetSelectedThumb();
                const idx = this._gridGetPageIndex(tw);
                const doc = this.getDoc();
                if (!doc) return;
                const refPage = doc.pages[idx >= 0 ? idx : 0] || doc.pages[0];
                const docW = refPage?.width || 612;
                const docH = refPage?.height || 792;
                this._showBlankPageModal(docW, docH, (w, h) => {
                    this.saveState();
                    const insertAt = idx >= 0 ? idx + 1 : doc.pages.length;
                    doc.pages.splice(insertAt, 0, { objects: [], sourceId: null, pageIndex: null, width: w, height: h, _blank: true });
                    this.renderSidebar();
                    this.showToast('Página en blanco insertada en posición ' + (insertAt + 1));
                });
            },

            gridRotatePage: function (deg) {
                const tw = this._gridGetSelectedThumb();
                const idx = this._gridGetPageIndex(tw);
                if (idx < 0) { this.showToast('Selecciona una página primero'); return; }
                this.saveState();
                const doc = this.getDoc();
                const page = doc.pages[idx];
                page.rotation = ((page.rotation || 0) + deg + 360) % 360;
                page._thumbCache = null;
                if (idx === doc.currentIndex) this.loadPage(idx);
                this.renderSidebar();
                this.showToast('Página rotada ' + (deg > 0 ? deg + '° derecha' : Math.abs(deg) + '° izquierda'));
            },

            gridFlipPage: function (axis) {
                const tw = this._gridGetSelectedThumb();
                const idx = this._gridGetPageIndex(tw);
                if (idx < 0) { this.showToast('Selecciona una página primero'); return; }
                this.saveState();
                const doc = this.getDoc();
                const page = doc.pages[idx];
                if (axis === 'h') page.flipH = !page.flipH;
                else page.flipV = !page.flipV;
                page._thumbCache = null;
                if (idx === doc.currentIndex) this.loadPage(idx);
                this.renderSidebar();
                this.showToast('Flip ' + (axis === 'h' ? 'horizontal' : 'vertical') + ' aplicado');
            },

            toggleSidebar: function () {
                const sb = document.getElementById('sidebar');
                const cont = document.getElementById('sidebarContainer');
                const toggle = document.getElementById('toggleSb');
                const toggleBm = document.getElementById('toggleSbBookmark');
                const toggleIdx = document.getElementById('toggleSbIndex');
                const toggleAttach = document.getElementById('toggleSbAttach');
                const toggleFields = document.getElementById('toggleSbFields');
                const toggleLayers = document.getElementById('toggleSbLayers');
                const panelToggles = [toggleBm, toggleIdx, toggleAttach, toggleFields, toggleLayers];

                const isH = document.body.classList.contains('h-layout');
                if (isH) {
                    // In h-layout, toggle the downbar (sidebar-container) hidden state
                    // CSS sibling selector handles moving the pill toggle automatically
                    if (cont) cont.classList.toggle('hidden');
                } else {
                    sb.classList.toggle('hidden');
                    if (sb.classList.contains('hidden')) {
                        if (toggle) {
                            toggle.style.left = '0px';
                            toggle.style.right = 'auto';
                            toggle.innerText = '›';
                        }
                        panelToggles.forEach(t => { if (t) t.style.left = '0px'; });
                    } else {
                        const w = sb.style.width ? sb.style.width : '154px';
                        if (toggle) {
                            toggle.style.left = 'auto';
                            toggle.style.right = '0px';
                            toggle.innerText = '‹';
                        }
                        panelToggles.forEach(t => { if (t) t.style.left = w; });
                    }
                }
                // Redibujar para ajustar anchos
                setTimeout(() => this.loadPage(this.getDoc().currentIndex), 200);
            },

            setupResizer: function () {
                const resizer = document.getElementById('sidebarResizer');
                const sidebar = document.getElementById('sidebar');
                const toggle = document.getElementById('toggleSb');
                const toggleBm = document.getElementById('toggleSbBookmark');
                const toggleIdx = document.getElementById('toggleSbIndex');
                const toggleAttach = document.getElementById('toggleSbAttach');
                const toggleFields = document.getElementById('toggleSbFields');
                const toggleLayers = document.getElementById('toggleSbLayers');
                const panelToggles = [toggleBm, toggleIdx, toggleAttach, toggleFields, toggleLayers];
                let isResizing = false;

                resizer.addEventListener('mousedown', (e) => {
                    isResizing = true;
                    e.preventDefault();
                    document.body.style.cursor = 'col-resize';
                    if (toggle) toggle.style.transition = 'none';
                    panelToggles.forEach(t => {
                        if (t) {
                            t.style.transition = 'none';
                            t.style.pointerEvents = 'none';
                        }
                    });
                    if (toggle) toggle.style.pointerEvents = 'none';
                });

                window.addEventListener('mousemove', (e) => {
                    if (!isResizing) return;
                    let newWidth = e.clientX;
                    if (newWidth < 100) newWidth = 100;
                    if (newWidth > 400) newWidth = 400;
                    sidebar.style.width = newWidth + 'px';
                    panelToggles.forEach(t => {
                        if (t) t.style.left = newWidth + 'px';
                    });
                    sidebar.classList.toggle('narrow', newWidth < 130);
                });

                window.addEventListener('mouseup', () => {
                    if (isResizing) {
                        isResizing = false;
                        document.body.style.cursor = 'default';
                        if (toggle) toggle.style.transition = '';
                        panelToggles.forEach(t => {
                            if (t) t.style.transition = '';
                        });
                        // Re-enable toggle buttons after a short delay (after spurious click window)
                        setTimeout(() => {
                            if (toggle) toggle.style.pointerEvents = '';
                            panelToggles.forEach(t => {
                                if (t) t.style.pointerEvents = '';
                            });
                        }, 150);
                        const doc = this.getDoc();
                        if (doc) doc.pages.forEach(p => { p._thumbCache = null; });
                        this.renderSidebar();
                    }
                });
            },

            // ============================================================
            // MODAL & PROPERTIES MANAGEMENT
            // ============================================================






            showAbout: function () {
                document.getElementById('about-modal').style.display = 'flex';
                if(typeof window.renderAbout === 'function') window.renderAbout();
            },

            _updateAboutBtn: function () {
                const btn = document.getElementById('about-btn');
                if (!btn) return;
                const hasDoc = this.docs?.some(d => d.id === this.activeDocId && d.pages?.length > 0);
                btn.style.display = hasDoc ? 'none' : 'flex';
                btn.style.top = '';
            },

            setupEvents: function () {
                if (this._eventsInitialized) return;
                this._eventsInitialized = true;

                // ── IEM event wiring ────────────────────────────────
                // Shadow toggle
                const iemShadowOn = document.getElementById('iem-shadow-on');
                if (iemShadowOn) iemShadowOn.onchange = function() {
                    const opts = document.getElementById('iem-shadow-opts');
                    opts.style.opacity = this.checked ? '1' : '0.4';
                    opts.style.pointerEvents = this.checked ? '' : 'none';
                };
                // Shadow range labels
                [['iem-so','iem-so-v', v=>Math.round(v*100)+'%'],
                 ['iem-sb','iem-sb-v', v=>v+'px'],
                 ['iem-sx','iem-sx-v', v=>v+'px'],
                 ['iem-sy','iem-sy-v', v=>v+'px']].forEach(([id,vid,fmt])=>{
                    const el=document.getElementById(id), vel=document.getElementById(vid);
                    if(el&&vel) el.oninput=()=>{ vel.textContent=fmt(parseFloat(el.value)); };
                });
                // Flip buttons
                const iemFH=document.getElementById('iem-fliph'), iemFV=document.getElementById('iem-flipv');
                if(iemFH) iemFH.onclick=()=>{ app._iemFlipH=!app._iemFlipH; iemFH.classList.toggle('active',app._iemFlipH); app.iemRenderPreview(); };
                if(iemFV) iemFV.onclick=()=>{ app._iemFlipV=!app._iemFlipV; iemFV.classList.toggle('active',app._iemFlipV); app.iemRenderPreview(); };
                // Frame options
                document.querySelectorAll('.iem-frame-opt').forEach(opt=>{
                    opt.onclick=()=>{
                        document.querySelectorAll('.iem-frame-opt').forEach(o=>o.classList.remove('active'));
                        opt.classList.add('active');
                        app._iemFrame=opt.dataset.frame;
                        // Frame preview via clip path on canvas
                        app.iemRenderPreviewWithFrame();
                    };
                });
                // Frame border range
                const iemFBW=document.getElementById('iem-frame-bw'), iemFBWV=document.getElementById('iem-frame-bw-v');
                if(iemFBW&&iemFBWV) iemFBW.oninput=()=>{ iemFBWV.textContent=iemFBW.value+'px'; app.iemRenderPreviewWithFrame(); };
                // Reflection direction
                document.querySelectorAll('[data-refdir]').forEach(b=>{
                    b.onclick=()=>{
                        document.querySelectorAll('[data-refdir]').forEach(x=>x.classList.remove('active'));
                        b.classList.add('active'); app._iemRefDir=b.dataset.refdir;
                        clearTimeout(app._iemRefTimer);
                        app._iemRefTimer=setTimeout(()=>{
                            app._iemLoadImg(app._iemOrigSrc, img=>{
                                app._iemPreviewSrc=app._iemComposeReflection(img);
                                app.iemRenderPreview();
                            });
                        }, 150);
                    };
                });
                // Reflection ranges
                [['iem-ref-len','iem-ref-len-v',v=>v+'%'],
                 ['iem-ref-op','iem-ref-op-v',v=>Math.round(v*100)+'%'],
                 ['iem-ref-gap','iem-ref-gap-v',v=>v+'px']].forEach(([id,vid,fmt])=>{
                    const el=document.getElementById(id), vel=document.getElementById(vid);
                    if(el&&vel) el.oninput=()=>{ vel.textContent=fmt(parseFloat(el.value)); };
                });
                // Sparkle style buttons
                document.querySelectorAll('[data-sparkstyle]').forEach(b=>{
                    b.onclick=()=>{
                        document.querySelectorAll('[data-sparkstyle]').forEach(x=>x.classList.remove('active')); b.classList.add('active');
                        clearTimeout(app._iemSparkTimer);
                        app._iemSparkTimer=setTimeout(()=>{ app._iemLoadImg(app._iemOrigSrc, img=>{ app._iemPreviewSrc=app._iemComposeSparkles(img); app.iemRenderPreview(); }); }, 200);
                    };
                });
                // Sparkle ranges
                [['iem-spark-density','iem-spark-density-v',v=>v],
                 ['iem-spark-size','iem-spark-size-v',v=>v+'px']].forEach(([id,vid,fmt])=>{
                    const el=document.getElementById(id), vel=document.getElementById(vid);
                    if(el&&vel) el.oninput=()=>{
                        vel.textContent=fmt(parseFloat(el.value));
                        clearTimeout(app._iemSparkTimer);
                        app._iemSparkTimer=setTimeout(()=>{ app._iemLoadImg(app._iemOrigSrc, img=>{ app._iemPreviewSrc=app._iemComposeSparkles(img); app.iemRenderPreview(); }); }, 300);
                    };
                });
                // Sparkle color pickers
                ['iem-spark-c1','iem-spark-c2'].forEach(id=>{
                    const el=document.getElementById(id);
                    if(el) el.oninput=el.onchange=()=>{
                        clearTimeout(app._iemSparkTimer);
                        app._iemSparkTimer=setTimeout(()=>{ app._iemLoadImg(app._iemOrigSrc, img=>{ app._iemPreviewSrc=app._iemComposeSparkles(img); app.iemRenderPreview(); }); }, 300);
                    };
                });
                // Sparkle zone select
                const iemSparkZone=document.getElementById('iem-spark-zone');
                if(iemSparkZone) iemSparkZone.onchange=()=>{
                    clearTimeout(app._iemSparkTimer);
                    app._iemSparkTimer=setTimeout(()=>{ app._iemLoadImg(app._iemOrigSrc, img=>{ app._iemPreviewSrc=app._iemComposeSparkles(img); app.iemRenderPreview(); }); }, 200);
                };
                // Frame border color
                const iemFBC=document.getElementById('iem-frame-bc');
                if(iemFBC) iemFBC.oninput=iemFBC.onchange=()=>app.iemRenderPreviewWithFrame();
                // Fx grid
                document.querySelectorAll('.iem-fx-btn').forEach(b=>{
                    b.onclick=()=>app.iemPreviewFx(b.dataset.fx);
                });
                // Magic tolerance
                const iemMT=document.getElementById('iem-magic-tol'), iemMTV=document.getElementById('iem-magic-tol-v');
                if(iemMT&&iemMTV) iemMT.oninput=()=>{ iemMTV.textContent=iemMT.value; };
                // ── end IEM wiring ───────────────────────────────────

                document.getElementById('drawing-layer').addEventListener('mousedown', (e) => {
                    if (app.isDrawingMode) app.startDrawing(e);
                });

                const handleCtx = (e) => {
                    // Allow doc-tab context menu to handle its own events
                    if (e.target.closest('.doc-tab')) {
                        return;
                    }
                    // Let shortcut button handle its own right-click exclusively
                    if (e.target.closest('#btn-custom-shortcut') || e.target.closest('#btn-custom-shortcut2')) {
                        return;
                    }
                    // Let native comment pins handle their own right-click
                    if (e.target.closest('.native-comment-pin')) {
                        return;
                    }
                    e.preventDefault(); e.stopPropagation();
                    if (app.isHandMode) return;
                    const container = document.getElementById('canvas-container');
                    const rect = container.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                        app.selectedObj = null; app.showContextMenu(e, null); return;
                    }
                    const mouseX = (e.clientX - rect.left) / app.currentScale;
                    const mouseY = (e.clientY - rect.top) / app.currentScale;
                    const doc = app.getDoc();
                    let foundObj = null;
                    if (doc) {
                        const pageObjs = doc.pages[doc.currentIndex].objects;
                        for (let i = pageObjs.length - 1; i >= 0; i--) {
                            const o = pageObjs[i];
                            if (o.type === 'drawing') continue;
                            if (mouseX >= o.x && mouseX <= o.x + o.width && mouseY >= o.y && mouseY <= o.y + o.height) { foundObj = o; break; }
                        }
                    }
                    if (foundObj) {
                        app.selectedObj = foundObj;
                        if (!app.multiObjectSelection.has(foundObj.id)) {
                            app.multiObjectSelection.clear();
                            app.multiObjectSelection.add(foundObj.id);
                        }
                        app.renderOverlays(); app.showContextMenu(e, foundObj);
                    } else {
                        app.selectedObj = null;
                        app.renderOverlays(); app.showContextMenu(e, null);
                    }
                };

                document.addEventListener('contextmenu', handleCtx);
                document.addEventListener('pointerdown', (e) => {
                    const _pending = !!this.selectedObj?._pendingRealData;
                    const _committing = !!this.selectedObj?._commitInProgress || !!this._realTextCommitInProgress;
                    if (!_pending && !_committing) return;
                    window.__aliothDiag?.trace('TEXT-TXN', 'pointerdown-capture', {
                        target: e.target?.id || e.target?.className || e.target?.tagName || null,
                        button: e.button,
                        selectedId: this.selectedObj?.id || null,
                        pending: _pending,
                        objectCommit: !!this.selectedObj?._commitInProgress,
                        globalCommit: !!this._realTextCommitInProgress,
                        view: window.__aliothDiag?.view(this.splitView?.activePanel)
                    });
                }, true);
                document.addEventListener('click', (e) => {
                    // 1. Close menus
                    if (!e.target.closest('#context-menu') && !e.target.closest('#sidebar-context-menu')) {
                        document.getElementById('context-menu').style.display = 'none';
                        document.getElementById('sidebar-context-menu').style.display = 'none';
                    }
                    // Cerrar menú contextual de comentarios al clicar fuera
                    if (!e.target.closest('#comment-ctx-menu') && !e.target.closest('.comment-popup-menu-btn')) {
                        document.getElementById('comment-ctx-menu')?.classList.remove('visible');
                    }
                    // Cerrar popup de comentario al clicar fuera
                    if (!e.target.closest('#comment-popup') && !e.target.closest('.comment-pin')) {
                        app.closeCommentPopup?.();
                    }

                    // 2. Deselect logic (click on empty workspace)
                    if (e.target.closest('#real-text-inline-editor, .text-content[contenteditable="true"]')) return;
                    // El blur del editor real inicia una transacción asíncrona. No limpiar
                    // sus overlays hasta que el nuevo canvas ya esté listo.
                    const _selectedPending = !!this.selectedObj?._pendingRealData;
                    const _selectedCommitting = !!this.selectedObj?._commitInProgress;
                    if (_selectedPending || _selectedCommitting || this._realTextCommitInProgress) {
                        window.__aliothDiag?.trace('TEXT-TXN', 'document-click', {
                            build: window.__ALIOTH_DIAG_BUILD__,
                            target: e.target?.id || e.target?.className || e.target?.tagName || null,
                            selectedId: this.selectedObj?.id || null,
                            selectedPending: _selectedPending,
                            selectedCommitting: _selectedCommitting,
                            globalCommit: !!this._realTextCommitInProgress,
                            view: window.__aliothDiag?.view(this.splitView?.activePanel)
                        });
                    }
                    if (this._realTextCommitInProgress) return window.__aliothDiag?.trace('TEXT-TXN', 'document-click-suppressed', {
                            selectedId: this.selectedObj?.id || null
                        });

                    // If target is the canvas, background layer, or main-workspace area but NOT an object/control
                    const isObject = e.target.closest('.draggable') || e.target.closest('.resize-handle') || e.target.closest('.rotate-handle');
                    const isUI = e.target.closest('.ribbon') || e.target.closest('.app-header, .app-titlebar, #view-toggle-widget') || e.target.closest('.tabs-container') || e.target.closest('.sidebar') || e.target.closest('.glass-box');
                    const isWorkspace = e.target.closest('#canvas-container') || e.target.closest('.view-panel');

                    // Un solo clic fuera confirma una edición real pendiente. Tras usar el
                    // ribbon el contenteditable puede no conservar el foco, por lo que el
                    // blur natural no se dispara hasta el segundo clic.
                    if (isWorkspace && !isObject && !isUI && this.selectedObj?._pendingRealData) {
                        const pendingSpan = document.getElementById(this.selectedObj.id)?.querySelector('.text-content');
                        if (pendingSpan) {
                            if (document.activeElement !== pendingSpan) pendingSpan.focus({ preventScroll: true });
                            pendingSpan.blur();
                        }
                        if (this._realTextCommitInProgress) return;
                    }

                    // No deseleccionar si box-select acaba de terminar o está activo
                    if (this.isBoxSelectMode || this._boxSelectJustFinished) {
                        this._boxSelectJustFinished = false;
                        return;
                    }

                    if (isWorkspace && !isObject && !isUI) {
                        if (this.selectedObj || (this.multiObjectSelection && this.multiObjectSelection.size > 0)) {
                            window.__aliothDiag?.trace('TEXT-TXN', 'document-click-deselect', {
                                selectedId: this.selectedObj?.id || null,
                                selectedPending: !!this.selectedObj?._pendingRealData,
                                selectedCommitting: !!this.selectedObj?._commitInProgress
                            });
                            console.log('✨ Deseleccionando objetos (click fuera)');
                            this.selectedObj = null;
                            if (this.multiObjectSelection) this.multiObjectSelection.clear();
                            this.renderOverlays();
                            // No restaurar continuo si _cancelRealTextInlineEdit lo manejará
                            if (!this._realEditMode) this._restoreContinuousIfNeeded();
                        }
                    }
                });

                window.addEventListener('mousemove', (e) => {
                    this.mouseX = e.clientX;
                    this.mouseY = e.clientY;
                });

                window.addEventListener('keydown', (e) => {
                    const _isH = document.body.classList.contains('h-layout');
                    const _activeEl = document.activeElement?.tagName;
                    console.log(`⌨️ [KEYDOWN] key="${e.key}" h-layout=${_isH} activeElement=${_activeEl} isInputActive=${this.isInputActive()}`);
                    // Check for Copy/Paste shortcuts
                    if (e.ctrlKey || e.metaKey) {
                        const key = e.key.toLowerCase();
                        if (key === 'k') {
                            e.preventDefault();
                            this.toggleCommandPalette();
                            return;
                        } else if (key === 't' && e.shiftKey) {
                            e.preventDefault();
                            this.reopenLastClosedTab?.();
                            return;
                        } else if (key === 'p') {
                            e.preventDefault();
                            if (!document.getElementById('_alioth_print_modal')) this.showPrintModal();
                            return;
                        } else if (key === 'c') {
                            if (!this.isInputActive()) {
                                this.copyObject();
                                // Prefer not to preventDefault to allow system copy if no object selected? 
                                // But if selected, we want object copy.
                                if (this.selectedObj) e.preventDefault();
                            }
                        } else if (key === 'v') {
                            if (!this.isInputActive() && this.clipboard) {
                                this.pasteObject();
                                e.preventDefault();
                            }
                        } else if (key === 'z') {
                            e.preventDefault();
                            const _doc = this.getDoc();
                            if (_doc && _doc._originalColorBuffer) { app.restoreColorPDF(); return; }
                            if (_doc && _doc._originalBeforeInvertBuffer) { app.restoreInvertPDF(); return; }
                            app.undo(); return;
                        } else if (key === 'y') {
                            e.preventDefault(); app.redo(); return;
                        }
                    }

                    if (e.key === 'Escape') {
                        if (this.isCommandPaletteOpen && this.isCommandPaletteOpen()) {
                            this.closeCommandPalette();
                            return;
                        }
                        this.closeAllModals();
                        // Close firmas/signature dropdown
                        if (typeof this.closeFirmasDropdown === 'function') this.closeFirmasDropdown();
                        // Exit stamp placement mode
                        if (this.isStampMode && typeof this._exitStampMode === 'function') this._exitStampMode();
                        // Reset active form tool (signature field, etc.)
                        if (this.currentFormTool && this.currentFormTool !== 'none' && typeof this.setFormTool === 'function') this.setFormTool('none');
                        if (this.isDrawingMode) this.setDrawTool('none');
                        if (this.selectedObj) { this.selectedObj = null; this.multiObjectSelection.clear(); this.renderOverlays(); this._restoreContinuousIfNeeded(); }

                        // Deselect sidebar pages on ESC
                        if (this.multiSelection.size > 0) {
                            this.multiSelection.clear();
                            this.updateSidebarSelection();
                        }

                        return;
                    }
                    if ((e.key === 'Delete' || e.key === 'Backspace') && (this.selectedObj || this.multiObjectSelection.size > 0) && !this.editingObjId && !this.isInputActive()) {
                        this.deleteObject();
                    }
                });

                window.addEventListener('paste', e => {
                    if (e.clipboardData && e.clipboardData.items) {
                        for (let i = 0; i < e.clipboardData.items.length; i++) {
                            const item = e.clipboardData.items[i];
                            if (item.type.indexOf("image") !== -1) {
                                app.insertImage(item.getAsFile());
                                e.preventDefault();
                                break; // FIX: Only insert first image
                            }
                        }
                    }
                });

                document.body.ondragover = e => {
                    e.preventDefault();
                    // Don't show drop overlay for tab drags or page drags
                    const isTabDrag = e.dataTransfer.types.includes('text/doc-tab-id') || e.dataTransfer.types.includes('text/alioth-tab-token') || e.dataTransfer.types.includes('text/alioth-type');
                    const isPageDrag = e.dataTransfer.types.includes('text/alioth-page-token') || e.dataTransfer.types.includes('json/pages');
                    if (!app.isDraggingInternal && !isTabDrag && !isPageDrag) {
                        if (app.splitView.mode === 'single') {
                            document.getElementById('drop-overlay').style.display = 'flex';
                        }
                    }
                };
                document.body.ondragleave = e => { if (e.clientX === 0 && e.clientY === 0) document.getElementById('drop-overlay').style.display = 'none'; };
                // Helper: detect Office file extensions for drop handler
                function _isOfficeExt(name) {
                    return /\.(docx?|xlsx?|pptx?)$/i.test(name || '');
                }
                document.body.ondrop = async e => {
                    app.clearDropFeedback();

                    // 1. Manejo de pestañas (Tab Drop)
                    const rawTabToken = e.dataTransfer.getData('text/alioth-tab-token') || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(tab|token):/, '');
                    const tabId = e.dataTransfer.getData('text/doc-tab-id');

                    if (tabId && app.docs.some(d => d.id === tabId)) {
                        e.preventDefault();
                        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('drag-over'));
                        if (app.splitView.mode !== 'single') {
                            const panel = e.target.closest('.view-panel');
                            if (panel) {
                                const panelId = panel.dataset.panel;
                                app.openDocumentInPanel(tabId, panelId);
                                return;
                            }
                        }
                        if (app.docs.length > 1) {
                            app.detachTabToNewWindow(tabId);
                            return;
                        }
                        return;
                    }

                    if (rawTabToken && rawTabToken.startsWith('tab_')) {
                        e.preventDefault();
                        const payload = await app._fetchTransferPayload(rawTabToken);
                        if (payload && payload.pages && payload.pages.length) {
                            const doc = app.getDoc();
                            if (doc && doc.pages && doc.pages.length > 0) {
                                // Pestaña soltada sobre visor con documento abierto: fusionar páginas
                                const insertIndex = doc.currentIndex >= 0 ? doc.currentIndex + 1 : doc.pages.length;
                                const newPages = await app._clonePagesAndSources(payload, doc, insertIndex);
                                app.renderSidebar();
                                app.saveState();
                                if (app.viewMode === 'continuous') {
                                    app.renderContinuousContent(app.splitView && app.splitView.activePanel ? app.splitView.activePanel : 'primary');
                                    app.scrollToPage(insertIndex);
                                } else {
                                    app.loadPage(insertIndex);
                                }
                                app.showToast(`✅ ${newPages.length} página(s) de "${payload.name || 'Documento'}" agregada(s)`);
                            } else {
                                // Visor vacío: abrir como nuevo documento
                                await app.loadDetachedDocument(payload);
                            }
                            if (payload.sourceWindowId === window.__aliothWindowId && (payload.docId || payload.sourceDocId)) {
                                app.closeTab(payload.docId || payload.sourceDocId, null, true);
                            } else if (window.aliothChannel) {
                                window.aliothChannel.postMessage({ type: 'tab_transfer_ack', token: rawTabToken });
                            }
                            return;
                        }
                    }

                    // 2. Manejo de páginas soltadas sobre el visor principal (Page Drop)
                    const rawPageToken = e.dataTransfer.getData('text/alioth-page-token') || (e.dataTransfer.getData('text/plain') || '').replace(/^alioth-(page|token):/, '');
                    if (rawPageToken && (rawPageToken.startsWith('page_') || rawPageToken.startsWith('local_'))) {
                        e.preventDefault();
                        const payload = await app._fetchTransferPayload(rawPageToken);
                        if (payload && payload.pages && payload.pages.length) {
                            const doc = app.getDoc();
                            if (doc && doc.pages && doc.pages.length > 0) {
                                const insertIndex = doc.currentIndex >= 0 ? doc.currentIndex + 1 : doc.pages.length;
                                const newPages = await app._clonePagesAndSources(payload, doc, insertIndex);
                                app.renderSidebar();
                                app.saveState();
                                if (app.viewMode === 'continuous') {
                                    app.renderContinuousContent(app.splitView && app.splitView.activePanel ? app.splitView.activePanel : 'primary');
                                    app.scrollToPage(insertIndex);
                                } else {
                                    app.loadPage(insertIndex);
                                }
                                app.showToast(`✅ ${newPages.length} página(s) agregada(s)`);
                                if (payload.sourceWindowId === window.__aliothWindowId && payload.sourceDocId && payload.sourceDocId !== doc.id) {
                                    const srcDoc = app.docs.find(d => d.id === payload.sourceDocId);
                                    if (srcDoc && payload.indices) {
                                        if (srcDoc.pages.length <= payload.pages.length) {
                                            app.closeTab(srcDoc.id, null, true);
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
                                    window.aliothChannel.postMessage({ type: 'page_transfer_move_ack', token: rawPageToken });
                                }
                            } else {
                                await app.movePagesToNewTab(payload);
                            }
                            return;
                        }
                    }

                    e.preventDefault();
                    if (e.target.closest('#sidebar')) { if (e.dataTransfer.files.length > 0) app.handleSidebarDrop(Array.from(e.dataTransfer.files)); return; }
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                        // Detect target panel where file was dropped
                        const panel = e.target.closest('.view-panel');
                        const targetPanelId = (panel && app.splitView.mode !== 'single') ? panel.dataset.panel : app.splitView.activePanel;

                        // Switch focus to target panel
                        if (targetPanelId && targetPanelId !== app.splitView.activePanel) {
                            app.setActivePanel(targetPanelId);
                        }

                        // Si se suelta sobre las pestañas o barra superior, abrir como nuevo documento
                        const isTabArea = !!e.target.closest('#docTabsWrapper, .tabs-container, .app-titlebar, .app-header, #drop-overlay');
                        const targetDocId = app.splitView[targetPanelId]?.docId;
                        const doc = app.docs.find(d => d && d.id === targetDocId);
                        if (!doc || doc.pages.length === 0 || isTabArea) {
                            if (files.length === 1 && (files[0].type === 'application/pdf' || _isOfficeExt(files[0].name))) {
                                if (typeof app.resolveFileOriginPath === 'function') {
                                    await app.resolveFileOriginPath(files[0]);
                                }
                                if (typeof app.smartOpenFile === 'function') {
                                    await app.smartOpenFile(files[0]);
                                } else {
                                    await app.openFile(files[0]);
                                }
                            }
                            else app.handleSidebarDrop(files);
                        }
                        else {
                            // Si son múltiples archivos O se arrastra sobre sidebar (ya manejado arriba), intentar Batch Insert
                            // Si es UNA sola imagen sobre la vista principal, insertar como objeto
                            if (files.length === 1 && files[0].type.startsWith('image/')) {
                                app.handleMainViewDrop(files);
                            } else {
                                // Enviar todo a Sidebar Drop (Batch) si son PDFs, Imágenes u Office
                                const supported = files.filter(f => f.type === 'application/pdf' || f.type.startsWith('image/') || _isOfficeExt(f.name));
                                if (supported.length > 0) app.handleSidebarDrop(supported);
                            }
                        }
                    }
                };

                window.onmousemove = e => this.draw(e); window.onmouseup = () => this.stopDrawing();

                const mv = document.querySelector('.main-view');
                mv.addEventListener('mousedown', (e) => {
                    if (app.isHandMode) {
                        app.isPanning = true;
                        app.panStart = { x: e.clientX, y: e.clientY };
                        app.panScroll = { left: mv.scrollLeft, top: mv.scrollTop };
                        mv.style.cursor = 'grabbing';
                    }
                });
                window.addEventListener('mousemove', (e) => {
                    if (app.isHandMode && app.isPanning) {
                        const dx = e.clientX - app.panStart.x;
                        const dy = e.clientY - app.panStart.y;
                        mv.scrollLeft = app.panScroll.left - dx;
                        mv.scrollTop = app.panScroll.top - dy;
                    }
                });
                window.addEventListener('mouseup', () => {
                    if (app.isHandMode) { app.isPanning = false; mv.style.cursor = 'grab'; }
                });
                // Setup wheel zoom for BOTH panels
                const setupPanelWheelZoom = (panelElement, panelId) => {
                    if (!panelElement) return;
                    panelElement.addEventListener('wheel', e => {
                        if (e.ctrlKey) {
                            e.preventDefault();
                            // Sensibilidad reducida otro 10%: 0.0675 -> 0.06075.
                            this.zoomPanel(e.deltaY > 0 ? -0.06075 : 0.06075, panelId, {
                                clientX: e.clientX,
                                clientY: e.clientY
                            });
                        } else {
                            if (this.scrollDebounce) return;
                            // Block page navigation for 500ms after a zoom to prevent false edge triggers
                            if (this._zoomJustFinished && Date.now() - this._zoomJustFinished < 800) return;
                            const isH = document.body.classList.contains('h-layout');
                            if (isH) {
                                const _sl = panelElement.scrollLeft;
                                const _cw = panelElement.clientWidth;
                                const _sw = panelElement.scrollWidth;
                                const _atEnd = _sl + _cw >= _sw - 5;
                                const _atStart = _sl <= 0;
                                console.log(`🖱️ [WHEEL-H] panelId=${panelId} deltaY=${e.deltaY} scrollLeft=${_sl} clientWidth=${_cw} scrollWidth=${_sw} atStart=${_atStart} atEnd=${_atEnd}`);
                                if (e.deltaY > 0 && _atEnd) {
                                    console.log('🖱️ [WHEEL-H] → movePage(1) programado');
                                    this.scrollDebounce = setTimeout(() => { this.movePage(1); this.scrollDebounce = null; }, 300);
                                } else if (e.deltaY < 0 && _atStart) {
                                    console.log('🖱️ [WHEEL-H] → movePage(-1) programado');
                                    this.scrollDebounce = setTimeout(() => { this.movePage(-1); this.scrollDebounce = null; }, 300);
                                }
                            } else {
                                if (e.deltaY > 0 && panelElement.scrollTop + panelElement.clientHeight >= panelElement.scrollHeight - 5) {
                                    this.scrollDebounce = setTimeout(() => { this.movePage(1); this.scrollDebounce = null; }, 400);
                                } else if (e.deltaY < 0 && panelElement.scrollTop <= 0) {
                                    this.scrollDebounce = setTimeout(() => { this.movePage(-1); this.scrollDebounce = null; }, 400);
                                }
                            }
                        }
                    }, { passive: false });
                };

                // Apply to both panels
                setupPanelWheelZoom(document.getElementById('mainViewPrimary'), 'primary');
                setupPanelWheelZoom(document.getElementById('mainViewSecondary'), 'secondary');
            },

            toggleHorizontalLayout: function() {
                const isH = document.body.classList.contains('h-layout');
                this.setHorizontalLayout(!isH);
            },

            setHorizontalLayout: function(enable) {
                const btn = document.getElementById('btn-h-layout');
                const btnRibbon = document.getElementById('btn-h-layout-ribbon');
                const btnReadingH = document.getElementById('btn-reading-hlayout');
                const fitBtn = document.getElementById('zoomBtnFit');

                const toggle = document.getElementById('toggleSb');
                const toggleBm = document.getElementById('toggleSbBookmark');
                const toggleIdx = document.getElementById('toggleSbIndex');
                const toggleAttach = document.getElementById('toggleSbAttach');
                const toggleFields = document.getElementById('toggleSbFields');
                const toggleLayers = document.getElementById('toggleSbLayers');
                const panelToggles = [toggleBm, toggleIdx, toggleAttach, toggleFields, toggleLayers];
                const cont = document.getElementById('sidebarContainer');
                const sb = document.getElementById('sidebar');

                if (enable) {
                    document.body.classList.add('h-layout');
                    if (btn) btn.classList.add('active-view');
                    if (btnRibbon) btnRibbon.classList.add('active-view');
                    if (btnReadingH) {
                        btnReadingH.classList.add('active');
                        btnReadingH.classList.add('active-view');
                    }
                    localStorage.setItem('h-layout', 'true');
                    // Force split-view single mode
                    this.setSplitView('single');

                    if (fitBtn) {
                        fitBtn.title = 'Ajustar al alto';
                    }

                    // Reset downbar to visible, clear inline styles so CSS takes over
                    if (cont) cont.classList.remove('hidden');
                    if (toggle) {
                        toggle.style.left = '';
                        toggle.style.bottom = '';
                        toggle.style.top = '';
                        toggle.style.right = '';
                        toggle.innerText = '';
                    }
                    panelToggles.forEach(t => {
                        if (t) { t.style.left = ''; t.style.top = ''; t.style.bottom = ''; }
                    });
                } else {
                    document.body.classList.remove('h-layout');
                    if (btn) btn.classList.remove('active-view');
                    if (btnRibbon) btnRibbon.classList.remove('active-view');
                    if (btnReadingH) {
                        btnReadingH.classList.remove('active');
                        btnReadingH.classList.remove('active-view');
                    }
                    localStorage.setItem('h-layout', 'false');

                    if (fitBtn) {
                        fitBtn.title = 'Ajustar al ancho';
                    }

                    const w = (sb && sb.style.width) ? sb.style.width : '154px';
                    // Restore vertical layout coordinates and arrow for sidebar toggle
                    if (toggle) {
                        toggle.style.bottom = '';
                        toggle.style.top = '';
                        toggle.style.left = 'auto';
                        toggle.style.right = '0px';
                        toggle.innerText = '‹';
                    }
                    // Restore panel toggle positions to sidebar width
                    panelToggles.forEach(t => {
                        if (t) { t.style.bottom = ''; t.style.top = ''; t.style.left = w; }
                    });
                }

                // Update autoscroll icons if autoscroll helper is loaded
                if (app.autoScrollUpdateUI) {
                    app.autoScrollUpdateUI();
                }

                // Re-render sidebar to apply new thumbnail sizes
                this.renderSidebar();

                // Preserve scale and current page on layout toggle
                const _doc = this.getDoc();
                const _savedScale = this.currentScale || (_doc && _doc.scale) || 1.0;
                if (_doc) {
                    _doc.scale = _savedScale;
                    const _savedIdx = _doc.currentIndex;
                    const _ps = this.splitView[this.splitView.activePanel];
                    if (_ps) {
                        _ps.pageIndex = _savedIdx;
                        _ps.scale = _savedScale;
                    }
                }
                this.currentScale = _savedScale;
                const zi = document.getElementById('zoomInput');
                if (zi) zi.value = Math.round(_savedScale * 100) + '%';
                const zs = document.getElementById('zoomSlider');
                if (zs) zs.value = Math.max(20, Math.min(500, Math.round(_savedScale * 100)));

                // Invalidar TIMEOUTs anteriores de renderContinuousView antes de cambiar layout
                this._scrollRestoreToken = Symbol();
                this._suppressScrollTracking = false;
                clearTimeout(this._suppressScrollTimer);
                this._layoutChanging = true;

                // Re-render panels preserving exact scale
                this.renderPanelContent('primary');
                if (this.splitView.mode !== 'single') {
                    this.renderPanelContent('secondary');
                }
                setTimeout(() => {
                    this._layoutChanging = false;
                }, 400);
            },

            // ============================================================
            // AGENTE IA - GEMINI INTEGRATION
            // ============================================================


            // ============================================================
            // DATA EXTRACTION AI
            // ============================================================
            _dexEditMode: false,
            _dexFields: [],
            _dexProfiles: [],
            _dexEditingProfileId: null,
            _dexRawSources: null,

            _dexDefaultMedProfile: function () {
                const campos = [
                    ['Nombre','Nombre del paciente','Paciente'],
                    ['Fecha Nacimiento','F. Nac','Fecha de Nacimiento','DOB'],
                    ['Edad'],['Sexo','Género'],
                    ['Peso (kg)','Peso'],['Talla (cm)','Talla','Estatura'],
                    ['IMC','Índice de Masa Corporal'],
                    ['Presión Arterial','TA','Tensión Arterial'],
                    ['Glucosa','Glucosa en sangre'],
                    ['Colesterol','Colesterol Total'],
                    ['Triglicéridos'],
                    ['Hemoglobina Glucosilada','HbA1c'],
                    ['Ácido Úrico'],
                    ['Audiometría OD','OD'],
                    ['Audiometría OI','OI'],
                    ['FVC','Espirometría FVC'],
                    ['FEV1','Espirometría FEV1'],
                    ['Radiografía','Rx','Resultado Radiografía'],
                    ['Alergias'],
                    ['Médico','Médico Evaluador'],
                    ['Fecha Consulta','Fecha de Consulta','Fecha']
                ];
                return {
                    id: crypto.randomUUID(),
                    name: 'Formulario Médico General',
                    nameOrder: 'nombre_apellidos',
                    headerRow: 1,
                    excelFileName: '',
                    fields: campos.map((aliases, i) => ({
                        id: 'f' + i,
                        aliases,
                        column: aliases[0],
                        order: i
                    }))
                };
            },

            showDataExtractionModal: function () {
                const m = document.getElementById('modal-data-extraction');
                if (!m) { this.showToast('❌ No se encontró el panel Data Extraction AI.'); return; }
                m.style.display = 'flex';
                try {
                    this._dexProfiles = JSON.parse(localStorage.getItem('dex_profiles') || '[]');
                    if (!this._dexProfiles.length) {
                        this._dexProfiles = [this._dexDefaultMedProfile()];
                        localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                    }
                    this._dexRenderProfileSelect();
                    const defId = localStorage.getItem('dex_default_profile');
                    const sel = document.getElementById('dex-profile-select');
                    if (defId && sel && this._dexProfiles.some(p => p.id === defId)) {
                        sel.value = defId;
                        this._dexOnProfileChange();
                    }
                    this._dexSwitchTab_('extract');
                    this.dexSwitchExtractMode(this._dexExtractMode || 'single');
                    const status = document.getElementById('dex-status');
                    const results = document.getElementById('dex-results');
                    if (status) status.style.display = 'none';
                    if (results) results.style.display = 'none';
                    const banner = document.getElementById('dex-doping-banner');
                    if (banner) banner.style.display = 'none';
                } catch (e) {
                    console.error('[DEX Modal] Error de inicialización:', e);
                    this.showToast('⚠️ El panel abrió con datos locales que requieren revisión.');
                }
            },

            closeDataExtractionModal: function () {
                document.getElementById('modal-data-extraction').style.display = 'none';
            },

            dexSwitchTab: function (tab) { this._dexSwitchTab_(tab); },

            _dexSwitchTab_: function (tab) {
                const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
                ['extract','profiles','training'].forEach(t => {
                    const panel = document.getElementById('dex-panel-' + t);
                    if (panel) panel.style.display = t === tab ? 'block' : 'none';
                    const btn = document.getElementById('dex-tab-' + t);
                    if (btn) {
                        btn.style.background   = t === tab ? 'rgba(99,102,241,0.15)' : 'none';
                        btn.style.borderBottom = t === tab ? `2px solid ${accent}` : '2px solid transparent';
                        btn.style.color        = t === tab ? 'var(--text-main)' : 'var(--text-dim)';
                        btn.style.fontWeight   = t === tab ? '600' : '400';
                    }
                });
                if (tab === 'profiles') this._dexRenderProfilesList();
                if (tab === 'training') this._dexRenderTrainingPanel();
            },

            // Cambiar modo de extracción: 'single' | 'batch'
            dexSwitchExtractMode: function (mode) {
                this._dexExtractMode = mode || 'single';
                const btnSingle = document.getElementById('dex-mode-btn-single');
                const btnBatch  = document.getElementById('dex-mode-btn-batch');
                const panelSingle = document.getElementById('dex-mode-single');
                const panelBatch  = document.getElementById('dex-mode-batch');

                if (mode === 'batch') {
                    if (btnSingle) { btnSingle.style.background = 'rgba(255,255,255,0.04)'; btnSingle.style.border = '1px solid rgba(255,255,255,0.1)'; btnSingle.style.color = 'var(--text-dim)'; }
                    if (btnBatch)  { btnBatch.style.background  = 'rgba(99,102,241,0.2)'; btnBatch.style.border  = '1px solid var(--accent,#6366f1)'; btnBatch.style.color  = '#a5b4fc'; }
                    if (panelSingle) panelSingle.style.display = 'none';
                    if (panelBatch)  panelBatch.style.display  = 'block';
                    this._dexSetupBatchDropzone();
                } else {
                    if (btnSingle) { btnSingle.style.background = 'rgba(99,102,241,0.2)'; btnSingle.style.border = '1px solid var(--accent,#6366f1)'; btnSingle.style.color = '#a5b4fc'; }
                    if (btnBatch)  { btnBatch.style.background  = 'rgba(255,255,255,0.04)'; btnBatch.style.border  = '1px solid rgba(255,255,255,0.1)'; btnBatch.style.color  = 'var(--text-dim)'; }
                    if (panelSingle) panelSingle.style.display = 'block';
                    if (panelBatch)  panelBatch.style.display  = 'none';
                }
            },

            _dexSetupBatchDropzone: function () {
                const dz = document.getElementById('dex-batch-dropzone');
                if (!dz || dz._hasDragEvents) return;
                dz._hasDragEvents = true;

                ['dragenter', 'dragover'].forEach(eventName => {
                    dz.addEventListener(eventName, (e) => {
                        e.preventDefault(); e.stopPropagation();
                        dz.style.background = 'rgba(99,102,241,0.15)';
                        dz.style.borderColor = 'var(--accent,#6366f1)';
                    }, false);
                });
                ['dragleave', 'drop'].forEach(eventName => {
                    dz.addEventListener(eventName, (e) => {
                        e.preventDefault(); e.stopPropagation();
                        dz.style.background = 'rgba(99,102,241,0.05)';
                        dz.style.borderColor = 'rgba(99,102,241,0.4)';
                    }, false);
                });
                dz.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    if (dt && dt.files && dt.files.length) {
                        this._dexHandleBatchFiles(dt.files);
                    }
                }, false);
            },

            dexSelectBatchFiles: function (ev) {
                if (ev && ev.target && ev.target.files) {
                    this._dexHandleBatchFiles(ev.target.files);
                    ev.target.value = '';
                }
            },

            _dexHandleBatchFiles: function (files) {
                if (!this._dexBatchFiles) this._dexBatchFiles = [];
                let added = 0;
                Array.from(files).forEach(f => {
                    if (f.name.toLowerCase().endsWith('.pdf')) {
                        const fileObj = {
                            id: 'bf_' + Math.random().toString(36).slice(2, 9),
                            file: f,
                            name: f.name,
                            size: f.size,
                            status: 'pending',
                            error: '',
                            fields: []
                        };
                        this._dexBatchFiles.push(fileObj);
                        added++;
                    }
                });

                if (added > 0) {
                    this.showToast(`✅ Se agregaron ${added} archivo(s) al lote.`);
                    this._dexRenderBatchFiles();
                } else {
                    this.showToast('⚠️ No se detectaron archivos PDF válidos.');
                }
            },

            dexRemoveBatchFile: function (id) {
                if (!this._dexBatchFiles) return;
                this._dexBatchFiles = this._dexBatchFiles.filter(f => f.id !== id);
                this._dexRenderBatchFiles();
            },

            dexClearBatchFiles: function () {
                this._dexBatchFiles = [];
                this._dexBatchResults = [];
                this._dexRenderBatchFiles();
                const statusEl = document.getElementById('dex-batch-status');
                if (statusEl) statusEl.style.display = 'none';
                const resEl = document.getElementById('dex-batch-results');
                if (resEl) resEl.style.display = 'none';
            },

            _dexRenderBatchFiles: function () {
                const container = document.getElementById('dex-batch-files-container');
                const listEl = document.getElementById('dex-batch-file-list');
                const countEl = document.getElementById('dex-batch-files-count');
                const btnExtract = document.getElementById('dex-btn-extract-batch');
                if (!container || !listEl || !countEl) return;

                const files = this._dexBatchFiles || [];
                if (!files.length) {
                    container.style.display = 'none';
                    if (btnExtract) { btnExtract.disabled = true; btnExtract.style.opacity = '0.5'; }
                    return;
                }

                container.style.display = 'block';
                countEl.textContent = `${files.length} archivo(s) PDF en cola`;
                if (btnExtract) { btnExtract.disabled = false; btnExtract.style.opacity = '1'; }

                let html = '';
                files.forEach(f => {
                    const sizeStr = (f.size / 1024).toFixed(1) + ' KB';
                    let statusBadge = '';
                    if (f.status === 'pending') statusBadge = '<span style="color:#94a3b8; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">Pendiente</span>';
                    else if (f.status === 'extracting') statusBadge = '<span style="color:#93c5fd; background:rgba(59,130,246,0.15); padding:2px 6px; border-radius:4px;">⏳ Extrayendo...</span>';
                    else if (f.status === 'completed') statusBadge = `<span style="color:#4ade80; background:rgba(34,197,94,0.15); padding:2px 6px; border-radius:4px;">✅ ${f.fields.length} campos</span>`;
                    else if (f.status === 'error') statusBadge = `<span style="color:#f87171; background:rgba(239,68,68,0.15); padding:2px 6px; border-radius:4px;" title="${this._esc(f.error)}">❌ Error</span>`;

                    html += `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px;">
                            <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1;">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#a5b4fc" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                <span style="font-weight:500; color:#e2e8f0; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${this._esc(f.name)}</span>
                                <small style="color:#64748b; font-size:10px;">(${sizeStr})</small>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${statusBadge}
                                <button onclick="app.dexRemoveBatchFile('${f.id}')" style="background:none; border:none; color:#f87171; font-size:14px; cursor:pointer; padding:0 4px;" title="Quitar archivo">✕</button>
                            </div>
                        </div>
                    `;
                });
                listEl.innerHTML = html;
            },

            dexExtractBatch: async function () {
                if (this._dexBatchBusy) { this.showToast('⏳ Ya hay una extracción en lote en curso.'); return; }
                const files = this._dexBatchFiles || [];
                if (!files.length) { this.showToast('⚠️ Agrega al menos un archivo PDF al lote.'); return; }

                const azureKey      = localStorage.getItem('azure_api_key') || '';
                const azureEndpoint = localStorage.getItem('azure_endpoint') || '';
                const geminiKey     = localStorage.getItem('gemini_api_key') || localStorage.getItem('GEMINI_API_KEY') || '';
                const groqKey       = localStorage.getItem('groq_api_key') || localStorage.getItem('GROQ_API_KEY') || '';
                const openrouterKey = localStorage.getItem('openrouter_api_key') || '';
                const hasAI         = azureKey || geminiKey || groqKey || openrouterKey || Object.values(window.AliothSecureKeys || {}).some(Boolean);

                if (!hasAI) {
                    this.showToast('⚠️ Configura al menos una clave de IA (Gemini, Groq, OpenRouter o Azure) en Preferencias > API Keys.');
                    return;
                }

                this._dexBatchBusy = true;
                const abortCtrl = new AbortController();
                this._dexAbortController = abortCtrl;
                const escHandler = (ev) => { if (ev.key === 'Escape') abortCtrl.abort(); };
                document.addEventListener('keydown', escHandler);

                const btn = document.getElementById('dex-btn-extract-batch');
                if (btn) { btn.disabled = true; btn.textContent = '⏳ Extrayendo lote... (ESC cancela)'; }
                const statusEl = document.getElementById('dex-batch-status');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(59,130,246,0.1)';
                    statusEl.style.border = '1px solid rgba(59,130,246,0.2)';
                    statusEl.style.color = '#93c5fd';
                    statusEl.textContent = `Iniciando extracción en lote para ${files.length} archivos...`;
                }

                this._dexBatchResults = [];
                const profileId = document.getElementById('dex-profile-select')?.value;
                const activeProfile = this._dexProfiles?.find(p => p.id === profileId);

                try {
                    for (let i = 0; i < files.length; i++) {
                        if (abortCtrl.signal.aborted) break;
                        const bf = files[i];
                        bf.status = 'extracting';
                        this._dexRenderBatchFiles();

                        if (statusEl) {
                            statusEl.textContent = `⏳ Extrayendo (${i + 1}/${files.length}): ${bf.name}...`;
                        }

                        const arrayBuffer = await bf.file.arrayBuffer();
                        const pdfArr = new Uint8Array(arrayBuffer);
                        let b64 = '';
                        const CHUNK = 8192;
                        for (let j = 0; j < pdfArr.length; j += CHUNK) {
                            b64 += String.fromCharCode(...pdfArr.subarray(j, j + CHUNK));
                        }
                        b64 = btoa(b64);

                        const _useMulti = localStorage.getItem('dex_use_multi') !== 'false';
                        const _extractEndpoint = _useMulti ? '/data-extract/multi' : '/data-extract/azure';

                        const r = await fetch(_extractEndpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: abortCtrl.signal,
                            body: JSON.stringify({
                                pdf_base64: b64,
                                account_index: 0,
                                target_cols: (activeProfile?.fields || []).map(f => f.column).filter(Boolean),
                                profile_type: activeProfile?.docType || 'medico',
                                name_order: activeProfile?.nameOrder || 'nombre_apellidos',
                                training_examples: this._dexGetTrainingExamples(profileId),
                                gemini_api_key: geminiKey,
                                groq_api_key: groqKey,
                                openrouter_api_key: openrouterKey,
                                azure_api_key: azureKey,
                                azure_endpoint: azureEndpoint
                            })
                        });

                        const json = await r.json();
                        if (!r.ok) throw new Error(json.error || r.statusText);

                        let extractedFields = json.fields || [];

                        if (activeProfile && activeProfile.fields && activeProfile.fields.length) {
                            this._dexFields = extractedFields;
                            this._dexNormalizedMap = null;
                            const normalized = await this._dexBuildProfileFields(activeProfile);
                            if (normalized) {
                                extractedFields = Object.entries(normalized).map(([k, v]) => ({ key: k, value: v }));
                            }
                        }

                        bf.status = 'completed';
                        bf.fields = extractedFields;

                        const rowObj = { _fileName: bf.name };
                        extractedFields.forEach(f => {
                            rowObj[f.key] = f.value;
                        });
                        this._dexBatchResults.push(rowObj);

                        this._dexRenderBatchFiles();
                    }

                    if (statusEl) {
                        if (abortCtrl.signal.aborted) {
                            statusEl.style.background = 'rgba(234,179,8,0.1)';
                            statusEl.style.border = '1px solid rgba(234,179,8,0.2)';
                            statusEl.style.color = '#facc15';
                            statusEl.textContent = '⏹️ Extracción en lote cancelada por el usuario.';
                        } else {
                            statusEl.style.background = 'rgba(34,197,94,0.1)';
                            statusEl.style.border = '1px solid rgba(34,197,94,0.2)';
                            statusEl.style.color = '#4ade80';
                            statusEl.textContent = `✅ Lote completado: ${this._dexBatchResults.length} de ${files.length} archivos procesados con éxito.`;
                        }
                    }

                    if (this._dexBatchResults.length > 0) {
                        this._dexRenderBatchResults();

                        const autoPaste = document.getElementById('dex-auto-paste');
                        if (autoPaste && autoPaste.checked && activeProfile && activeProfile.excelFileName) {
                            await this.dexExportBatchAppend();
                        }
                    }

                } catch (e) {
                    if (statusEl) {
                        statusEl.style.background = 'rgba(239,68,68,0.1)';
                        statusEl.style.border = '1px solid rgba(239,68,68,0.2)';
                        statusEl.style.color = '#f87171';
                        statusEl.textContent = '❌ Error en lote: ' + e.message;
                    }
                } finally {
                    document.removeEventListener('keydown', escHandler);
                    this._dexBatchBusy = false;
                    this._dexAbortController = null;
                    if (btn) { btn.disabled = false; btn.textContent = '🚀 Procesar Lote de Archivos'; }
                }
            },

            _dexRenderBatchResults: function () {
                const resContainer = document.getElementById('dex-batch-results');
                const headEl = document.getElementById('dex-batch-table-head');
                const bodyEl = document.getElementById('dex-batch-table-body');
                const summaryEl = document.getElementById('dex-batch-results-summary');
                if (!resContainer || !headEl || !bodyEl) return;

                const results = this._dexBatchResults || [];
                if (!results.length) {
                    resContainer.style.display = 'none';
                    return;
                }

                resContainer.style.display = 'block';
                if (summaryEl) summaryEl.textContent = `✅ Resultados del Lote (${results.length} filas)`;

                const profileId = document.getElementById('dex-profile-select')?.value;
                const activeProfile = this._dexProfiles?.find(p => p.id === profileId);

                let columns = ['Archivo'];
                if (activeProfile && activeProfile.fields && activeProfile.fields.length) {
                    activeProfile.fields.forEach(f => {
                        if (f.column && !columns.includes(f.column)) columns.push(f.column);
                    });
                } else {
                    const keysSet = new Set();
                    results.forEach(r => {
                        Object.keys(r).forEach(k => { if (k !== '_fileName') keysSet.add(k); });
                    });
                    columns.push(...Array.from(keysSet));
                }

                let headHtml = '<tr style="background:rgba(255,255,255,0.05); color:#64748b;">';
                columns.forEach(col => {
                    headHtml += `<th style="padding:8px 10px; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); white-space:nowrap;">${this._esc(col)}</th>`;
                });
                headHtml += '</tr>';
                headEl.innerHTML = headHtml;

                let bodyHtml = '';
                results.forEach((row, rIdx) => {
                    bodyHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05); background:${rIdx % 2 === 0 ? 'none' : 'rgba(255,255,255,0.02)'};">`;
                    columns.forEach(col => {
                        let val = '';
                        if (col === 'Archivo') val = row._fileName || '';
                        else {
                            val = row[col] !== undefined ? row[col] : (row[col.toLowerCase()] !== undefined ? row[col.toLowerCase()] : '—');
                        }
                        const isFileCol = col === 'Archivo';
                        bodyHtml += `<td style="padding:6px 10px; color:${isFileCol ? '#a5b4fc' : '#e2e8f0'}; white-space:nowrap; max-width:180px; overflow:hidden; text-overflow:ellipsis;" ${!isFileCol ? `contenteditable="true" onblur="app._dexOnBatchCellEdit(${rIdx}, '${this._esc(col)}', this.textContent)"` : ''}>${this._esc(String(val))}</td>`;
                    });
                    bodyHtml += '</tr>';
                });
                bodyEl.innerHTML = bodyHtml;
            },

            _dexOnBatchCellEdit: function (rowIdx, colName, newVal) {
                if (this._dexBatchResults && this._dexBatchResults[rowIdx]) {
                    this._dexBatchResults[rowIdx][colName] = newVal.trim();
                }
            },

            dexExportBatchAppend: async function () {
                const results = this._dexBatchResults || [];
                if (!results.length) { this.showToast('⚠️ No hay resultados en el lote para agregar.'); return; }

                const profileId = document.getElementById('dex-profile-select')?.value;
                const profile   = this._dexProfiles?.find(p => p.id === profileId);
                if (!profile || !profile.excelFileName) {
                    this.showToast('⚠️ Selecciona un perfil que tenga un archivo Excel vinculado.');
                    return;
                }

                const stored = profile.id ? (() => { try { return JSON.parse(localStorage.getItem('dex_xl_' + profile.id)); } catch { return null; } })() : null;
                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';

                if (stored && stored.path) {
                    try {
                        this.showToast(`⏳ Agregando ${results.length} fila(s) al Excel vinculado...`);
                        let successCount = 0;
                        for (const rowObj of results) {
                            const writeRes = await fetch(`${PROXY_BASE}/excel/write-openpyxl`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    path: stored.path,
                                    sheet: stored.sheet || profile.sheet || '',
                                    headerRow: stored.headerRow || profile.headerRow || 1,
                                    rowData: rowObj
                                })
                            });
                            const wJson = await writeRes.json();
                            if (wJson.ok) successCount++;
                        }
                        this.showToast(`✅ Se agregaron ${successCount} fila(s) a: ${stored.name}`);
                    } catch(e) {
                        this.showToast('❌ Error al agregar filas al Excel: ' + e.message);
                    }
                } else {
                    this.showToast('⚠️ El perfil activo no tiene una ruta de disco válida para el Excel vinculado.');
                }
            },

            dexExportBatchNew: async function () {
                const results = this._dexBatchResults || [];
                if (!results.length) { this.showToast('⚠️ No hay resultados en el lote para exportar.'); return; }

                if (typeof XLSX === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('xlsx');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                }

                const profileId = document.getElementById('dex-profile-select')?.value;
                const profile   = this._dexProfiles?.find(p => p.id === profileId);

                const fname = (profile ? profile.name : 'Extraccion_Lote') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';

                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';
                let targetPath = '';

                try {
                    const dlgRes = await fetch(`${PROXY_BASE}/excel/save-dialog`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ default_name: fname })
                    });
                    const dlgJson = await dlgRes.json();
                    targetPath = dlgJson.path || '';
                } catch(e) {}

                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(results.map(r => {
                    const cleanRow = {};
                    Object.keys(r).forEach(k => {
                        const keyName = k === '_fileName' ? 'Archivo PDF' : k;
                        cleanRow[keyName] = r[k];
                    });
                    return cleanRow;
                }));

                XLSX.utils.book_append_sheet(wb, ws, (profile ? profile.name : 'Lote').slice(0, 31));

                if (targetPath) {
                    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
                    const wRes = await fetch(`${PROXY_BASE}/excel/write-direct`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: targetPath, data_base64: wbout })
                    });
                    const wJson = await wRes.json();
                    if (wJson.ok) {
                        this.showToast('✅ Nuevo Excel guardado en: ' + targetPath);
                        return;
                    }
                }

                XLSX.writeFile(wb, fname);
                this.showToast('✅ Excel exportado: ' + fname);
            },

            dexGenerarNuevoExcel: async function () {
                const nameEl = document.getElementById('dex-pe-name');
                const profileName = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : 'Perfil_Extraccion';

                const fieldEls = document.querySelectorAll('#dex-pe-fields .pe-field-row');
                const colNames = [];
                fieldEls.forEach(el => {
                    const colInput = el.querySelector('.pe-field-col');
                    if (colInput && colInput.value.trim()) {
                        colNames.push(colInput.value.trim());
                    }
                });

                if (!colNames.length) {
                    colNames.push('Nombre', 'Fecha', 'Observaciones');
                }

                const defaultFileName = profileName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.xlsx';
                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';

                let savePath = '';
                try {
                    const r = await fetch(`${PROXY_BASE}/excel/save-dialog`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ default_name: defaultFileName })
                    });
                    const j = await r.json();
                    savePath = j.path || '';
                } catch(e) {
                    console.warn('[DEX] Save dialog error:', e);
                }

                if (!savePath) {
                    this.showToast('⚠️ No se seleccionó la ruta para el nuevo archivo de Excel.');
                    return;
                }

                if (typeof XLSX === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('xlsx');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                }

                const wb = XLSX.utils.book_new();
                const emptyRow = {};
                colNames.forEach(c => emptyRow[c] = '');
                const ws = XLSX.utils.json_to_sheet([emptyRow], { header: colNames });
                XLSX.utils.book_append_sheet(wb, ws, profileName.slice(0, 31) || 'Datos');

                const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

                try {
                    const wRes = await fetch(`${PROXY_BASE}/excel/write-direct`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: savePath, data_base64: wbout })
                    });
                    const wJson = await wRes.json();
                    if (!wJson.ok) throw new Error(wJson.error || 'Error de escritura');

                    const fname = savePath.split(/[\\/]/).pop();
                    const pathInput = document.getElementById('dex-pe-excelpath');
                    if (pathInput) pathInput.value = savePath;

                    await this.dexVincularPorRuta();

                    this.showToast('✅ Nuevo archivo Excel creado y vinculado: ' + fname);
                } catch(e) {
                    this.showToast('❌ Error al crear archivo Excel: ' + e.message);
                }
            },

            _dexRenderProfileSelect: function () {
                const sel = document.getElementById('dex-profile-select');
                if (!sel) return;
                const prevValue = sel.value; // Guardar selección actual antes de reescribir
                const defId = localStorage.getItem('dex_default_profile');
                sel.innerHTML = '<option value="">— Sin perfil (todos los campos) —</option>';
                this._dexProfiles.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = (p.id === defId ? '★ ' : '') + p.name;
                    sel.appendChild(opt);
                });
                // Restaurar selección previa; si ya no existe, usar el predeterminado
                const restoreId = (prevValue && this._dexProfiles.some(p => p.id === prevValue)) ? prevValue : defId;
                if (restoreId && this._dexProfiles.some(p => p.id === restoreId)) {
                    sel.value = restoreId;
                    this._dexOnProfileChange();
                }
            },

            _dexOnProfileChange: async function () {
                // La hoja ya se selecciona en el editor de perfil al vincular el Excel.
                // Aquí solo validamos que el perfil tiene un Excel vinculado para habilitar "Agregar fila".
                const profileId = document.getElementById('dex-profile-select').value;
                const profile = this._dexProfiles.find(p => p.id === profileId);
                if (!profile) return;
                // Si tiene archivo vinculado, verificar que el stored data existe
                if (profile.excelFileName && profile.id) {
                    try {
                        const stored = JSON.parse(localStorage.getItem('dex_xl_' + profile.id));
                        if (stored) {
                            console.log('[DEX] Perfil activo:', profile.name, '| Hoja:', stored.sheet || '(auto)', '| Archivo:', stored.name || '');
                        }
                    } catch(e) {}
                }
            },

            dexSetDefault: function (id) {
                const current = localStorage.getItem('dex_default_profile');
                if (current === id) {
                    localStorage.removeItem('dex_default_profile');
                    this.showToast('Perfil predeterminado eliminado.');
                } else {
                    localStorage.setItem('dex_default_profile', id);
                    this.showToast('✅ Perfil marcado como predeterminado.');
                }
                this._dexRenderProfilesList();
                this._dexRenderProfileSelect();
            },

            dexExtract: async function () {
                if (this._dexBusy) { this.showToast('⏳ Ya hay una extracción en curso (ESC para cancelar).'); return; }
                if (!app.getDoc()) { this.showToast('⚠️ No hay PDF activo.'); return; }
                const azureKey      = localStorage.getItem('azure_api_key') || '';
                const azureEndpoint = localStorage.getItem('azure_endpoint') || '';
                const geminiKey     = localStorage.getItem('gemini_api_key') || localStorage.getItem('GEMINI_API_KEY') || '';
                const groqKey       = localStorage.getItem('groq_api_key') || localStorage.getItem('GROQ_API_KEY') || '';
                const openrouterKey = localStorage.getItem('openrouter_api_key') || '';
                const hasAI         = azureKey || geminiKey || groqKey || openrouterKey;

                if (!hasAI) {
                    this.showToast('⚠️ Configura al menos una clave de IA (Gemini, Groq, OpenRouter o Azure) en Preferencias > API Keys.');
                    return;
                }
                this._dexBusy = true;
                const abortCtrl = new AbortController();
                this._dexAbortController = abortCtrl;
                const escHandler = (ev) => { if (ev.key === 'Escape') abortCtrl.abort(); };
                document.addEventListener('keydown', escHandler);
                const btn = document.getElementById('dex-btn-extract');
                if (btn) { btn.disabled = true; btn.textContent = '⏳ Extrayendo... (ESC cancela)'; }
                const statusEl = document.getElementById('dex-status');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(59,130,246,0.1)';
                    statusEl.style.border = '1px solid rgba(59,130,246,0.2)';
                    statusEl.style.color = '#93c5fd';
                    statusEl.textContent = 'Analizando PDF con IA (Vision + OCR + Extracción)...';
                }
                try {
                    const rawBytes = await app.savePDFInternal(false, null, false, true);
                    const pdfArr = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
                    let b64 = '';
                    const CHUNK = 8192;
                    for (let i = 0; i < pdfArr.length; i += CHUNK) {
                        b64 += String.fromCharCode(...pdfArr.subarray(i, i + CHUNK));
                    }
                    b64 = btoa(b64);

                    // Usar pipeline multi-fuente si está disponible (Azure + Gemini Vision + OCR + Groq)
                    const _useMulti = localStorage.getItem('dex_use_multi') !== 'false';
                    const _extractEndpoint = _useMulti ? '/data-extract/multi' : '/data-extract/azure';
                    const _profileId = document.getElementById('dex-profile-select')?.value;
                    const _activeProfile = this._dexProfiles?.find(p => p.id === _profileId);
                    const r = await fetch(_extractEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: abortCtrl.signal,
                        body: JSON.stringify({
                            pdf_base64: b64,
                            account_index: 0,
                            target_cols: (_activeProfile?.fields || []).map(f => f.column).filter(Boolean),
                            profile_type: _activeProfile?.docType || 'medico',
                            name_order: _activeProfile?.nameOrder || 'nombre_apellidos',
                            training_examples: this._dexGetTrainingExamples(_profileId),
                            gemini_api_key: geminiKey,
                            groq_api_key: groqKey,
                            openrouter_api_key: openrouterKey,
                            azure_api_key: azureKey,
                            azure_endpoint: azureEndpoint
                        })
                    });
                    const json = await r.json();
                    if (!r.ok) throw new Error(json.error || r.statusText);

                    const newFields = json.fields || [];
                    // Acumular campos de múltiples PDFs (para capturar CHOL/TRIG de PDF de lab separado)
                    if (!this._dexFields || !this._dexFields.length) {
                        this._dexFields = newFields;
                        this._dexNormalizedMap = null;
                    } else {
                        // Fusionar: agregar campos nuevos que no existan ya (por key)
                        const existingKeys = new Set(this._dexFields.map(f => (f.key||'').toLowerCase().trim()));
                        const merged = [...this._dexFields];
                        let added = 0;
                        for (const nf of newFields) {
                            const nk = (nf.key||'').toLowerCase().trim();
                            if (!existingKeys.has(nk)) { merged.push(nf); existingKeys.add(nk); added++; }
                        }
                        this._dexFields = merged;
                        this._dexNormalizedMap = null;
                        if (added > 0) this.showToast(`+${added} campos nuevos acumulados.`);
                    }

                    this._dexRawParagraphs = json.paragraphs || [];
                    await this._dexRenderResults();
                    this.showToast(`✅ ${newFields.length} campos extraídos con IA.`);
                    if (statusEl) {
                        statusEl.style.background = 'rgba(16,185,129,0.1)';
                        statusEl.style.border = '1px solid rgba(16,185,129,0.2)';
                        statusEl.style.color = '#86efac';
                        statusEl.textContent = `Extracción completa: ${newFields.length} campos detectados.`;
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        this.showToast('⏹ Extracción cancelada por el usuario.');
                        if (statusEl) {
                            statusEl.style.background = 'rgba(239,68,68,0.1)';
                            statusEl.style.border = '1px solid rgba(239,68,68,0.2)';
                            statusEl.style.color = '#fca5a5';
                            statusEl.textContent = 'Extracción cancelada.';
                        }
                    } else {
                        console.error('[DEX Error]', e);
                        this.showToast('❌ Error al extraer: ' + e.message);
                        if (statusEl) {
                            statusEl.style.background = 'rgba(239,68,68,0.1)';
                            statusEl.style.border = '1px solid rgba(239,68,68,0.2)';
                            statusEl.style.color = '#fca5a5';
                            statusEl.textContent = 'Error: ' + e.message;
                        }
                    }
                } finally {
                    document.removeEventListener('keydown', escHandler);
                    this._dexBusy = false;
                    this._dexAbortController = null;
                    if (btn) { btn.disabled = false; btn.textContent = '🚀 Extraer Datos con IA'; }
                }
            },

            // Extracción directa desde el ribbon (sin abrir el modal manualmente)
            dexExtractDirect: async function () {
                if (this._dexBusy) { this.showToast('⏳ Ya hay una extracción en curso (ESC para cancelar).'); return; }
                const defId = localStorage.getItem('dex_default_profile');
                if (!defId) {
                    this.showToast('⚠️ No hay perfil predeterminado. Configúralo en Data Extraction AI → Perfiles.');
                    this.showDataExtractionModal();
                    return;
                }
                this._dexProfiles = JSON.parse(localStorage.getItem('dex_profiles') || '[]');
                const profile = this._dexProfiles.find(p => p.id === defId);
                if (!profile) { this.showToast('⚠️ Perfil predeterminado no encontrado.'); return; }
                if (!profile.excelFileName) { this.showToast('⚠️ El perfil predeterminado no tiene Excel vinculado.'); return; }
                if (!app.getDoc()) { this.showToast('⚠️ No hay PDF activo.'); return; }

                const azureKey      = localStorage.getItem('azure_api_key') || '';
                const azureEndpoint = localStorage.getItem('azure_endpoint') || '';
                const geminiKey     = localStorage.getItem('gemini_api_key') || localStorage.getItem('GEMINI_API_KEY') || '';
                const groqKey       = localStorage.getItem('groq_api_key') || localStorage.getItem('GROQ_API_KEY') || '';
                const openrouterKey = localStorage.getItem('openrouter_api_key') || '';
                const hasAI         = azureKey || geminiKey || groqKey || openrouterKey;

                if (!hasAI) {
                    this.showToast('⚠️ Configura al menos una clave de IA (Gemini, Groq, OpenRouter o Azure) en Preferencias > API Keys.');
                    return;
                }

                this._dexBusy = true;
                const abortCtrl2 = new AbortController();
                this._dexAbortController = abortCtrl2;
                const escHandler2 = (ev) => { if (ev.key === 'Escape') abortCtrl2.abort(); };
                document.addEventListener('keydown', escHandler2);
                this.showToast('⏳ Extrayendo con perfil: ' + profile.name + '... (ESC cancela)');
                try {
                    const rawBytes = await app.savePDFInternal(false, null, false, true);
                    const pdfArr = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
                    let b64 = '';
                    const CHUNK = 8192;
                    for (let i = 0; i < pdfArr.length; i += CHUNK) {
                        b64 += String.fromCharCode(...pdfArr.subarray(i, i + CHUNK));
                    }
                    b64 = btoa(b64);

                    const _useMulti2 = localStorage.getItem('dex_use_multi') !== 'false';
                    const r = await fetch(_useMulti2 ? '/data-extract/multi' : '/data-extract/azure', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: abortCtrl2.signal,
                        body: JSON.stringify({
                            pdf_base64: b64,
                            account_index: 0,
                            target_cols: (profile?.fields || []).map(f => f.column).filter(Boolean),
                            profile_type: profile?.docType || 'medico',
                            name_order: profile?.nameOrder || 'nombre_apellidos',
                            training_examples: this._dexGetTrainingExamples(defId),
                            gemini_api_key: geminiKey,
                            groq_api_key: groqKey,
                            openrouter_api_key: openrouterKey,
                            azure_api_key: azureKey,
                            azure_endpoint: azureEndpoint
                        })
                    });
                    const json = await r.json();
                    if (!r.ok) throw new Error(json.error || r.statusText);

                    const newFields2 = json.fields || [];
                    if (!this._dexFields || !this._dexFields.length) {
                        this._dexFields = newFields2;
                        this._dexNormalizedMap = null;
                    } else {
                        const existingKeys2 = new Set(this._dexFields.map(f => (f.key||'').toLowerCase().trim()));
                        const merged2 = [...this._dexFields];
                        for (const nf of newFields2) {
                            const nk = (nf.key||'').toLowerCase().trim();
                            if (!existingKeys2.has(nk)) { merged2.push(nf); existingKeys2.add(nk); }
                            else {
                                const idx = merged2.findIndex(f => (f.key||'').toLowerCase().trim() === nk);
                                if (idx >= 0 && (!merged2[idx].value || merged2[idx].value === '—') && nf.value) merged2[idx] = nf;
                            }
                        }
                        this._dexFields = merged2;
                        this._dexNormalizedMap = null;
                    }
                    this._dexRawParagraphs = [...(this._dexRawParagraphs || []), ...(json.paragraphs || [])];
                    this._dexRawSources = json.raw_texts || null;
                    await this._dexDoExport(true, profile);
                } catch(e) {
                    this.showToast(e.name === 'AbortError' ? '⏹️ Extracción cancelada.' : '❌ Extracción directa: ' + e.message);
                } finally {
                    document.removeEventListener('keydown', escHandler2);
                    this._dexBusy = false;
                    this._dexAbortController = null;
                }
            },

            _dexBuildProfileFields: async function (profile) {
                // Cache único de normalización, compartido por render y export
                if (this._dexNormalizedMap) return this._dexNormalizedMap;
                if (!profile || !profile.fields || !profile.fields.length) return null;
                // Si ya hay una llamada en curso, esperar esa misma promesa (evita duplicar Gemini en paralelo)
                if (this._dexNormalizePromise) return this._dexNormalizePromise;
                this._dexNormalizePromise = (async () => {
                    try {
                        const geminiFields = await this._dexGeminiNormalize(this._dexFields, profile);
                        if (geminiFields && geminiFields !== this._dexFields) {
                            const normalizedMap = {};
                            geminiFields.forEach(f => { normalizedMap[f.key.toLowerCase().trim()] = f.value; });
                            this._dexNormalizedMap = normalizedMap;
                            return normalizedMap;
                        }
                        return null;
                    } catch (e) {
                        console.warn('[DEX] Error al normalizar:', e);
                        return null;
                    } finally {
                        this._dexNormalizePromise = null;
                    }
                })();
                return this._dexNormalizePromise;
            },

            _dexRenderResults: async function () {
                const profileId = document.getElementById('dex-profile-select').value;
                const profile   = this._dexProfiles.find(p => p.id === profileId);
                let fields = this._dexFields;
                let isMapped = false;

                const _normalizeText = (s) => {
                    if (!s) return '';
                    return String(s).trim().toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]/g, '');
                };
                const _getMatchScore = (ocrKey, alias, ocrVal) => {
                    const nKey = _normalizeText(ocrKey);
                    const nAlias = _normalizeText(alias);
                    if (!nKey || !nAlias) return 0;
                    let score = 0;
                    if (nKey === nAlias) score = 100;
                    else if (nKey.length >= 3 && nAlias.length >= 3) {
                        if (nKey.includes(nAlias)) score = 50 + nAlias.length;
                        else if (nAlias.includes(nKey)) score = 50 + nKey.length;
                    }
                    if (score > 0 && (!ocrVal || !String(ocrVal).trim())) {
                        score = score * 0.1;
                    }
                    return score;
                };

                // ── Intentar normalización con Gemini ANTES de renderizar ──
                let normalizedMap = null;
                if (profile && profile.fields && profile.fields.length) {
                    isMapped = true;
                    normalizedMap = await this._dexBuildProfileFields(profile);

                    // Mapear campos usando Gemini (primario) o alias-matching (fallback)
                    fields = profile.fields.map(pf => {
                        const colKey = pf.column.toLowerCase().trim();
                        let val = '';
                        let _fromGemini = false;

                        // 1. Intentar obtener valor de Gemini
                        if (normalizedMap && normalizedMap[colKey] !== undefined) {
                            val = normalizedMap[colKey];
                            _fromGemini = true;
                        } else {
                            // 2. Fallback: alias-matching contra campos crudos OCR
                            const allAliases = [...(pf.aliases || []).map(a => a.trim()), pf.column.trim()];
                            let bestScore = 0;
                            let bestField = null;
                            for (const f of this._dexFields) {
                                for (const a of allAliases) {
                                    const score = _getMatchScore(f.key, a, f.value);
                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestField = f;
                                    }
                                }
                            }
                            val = bestField ? bestField.value : '';
                        }

                        return {
                            key: pf.column,
                            value: val,
                            confidence: _fromGemini ? 0.95 : 0,
                            _fromGemini: _fromGemini
                        };
                    });
                }

                // 3. Inject UI-only fields if found by Gemini (won't be exported if not in profile)
                if (normalizedMap) {
                    console.log('[DEX Render] normalizedMap keys:', Object.keys(normalizedMap));
                }
                const infoFields = [
                    {keys: ['info_conclusion_radiografias', 'conclusion radiografias', 'info_conclusion_radiogra'], label: 'CONCLUSION RADIOGRAFIAS'},
                    {keys: ['info_valores_ego', 'examen general de orina', 'valores ego', 'ego'], label: 'VALORES EGO'},
                    {keys: ['info_visiometria_snellen', 'visiometria snellen', 'visiometria', 'agudeza visual'], label: 'VISIOMETRIA SNELLEN'},
                    {keys: ['info_doping_alerta', 'doping', 'antidoping'], label: 'ALERTA DOPING'}
                ];
                
                infoFields.forEach(info => {
                    if (!normalizedMap) return;
                    let val = null;
                    // Try each possible key variant
                    for (const k of info.keys) {
                        if (normalizedMap[k] && String(normalizedMap[k]).trim()) {
                            val = normalizedMap[k];
                            break;
                        }
                    }
                    // Also search all keys in normalizedMap for partial matches
                    if (!val) {
                        for (const [mk, mv] of Object.entries(normalizedMap)) {
                            if (info.keys.some(k => mk === k || mk.includes(k)) && String(mv).trim()) {
                                val = mv;
                                break;
                            }
                        }
                    }
                    if (val) {
                        console.log(`[DEX Render] Injecting info field: ${info.label} = ${String(val).substring(0, 80)}...`);
                        fields.push({
                            key: info.label,
                            value: val,
                            confidence: 0.95,
                            _fromGemini: true
                        });
                    } else {
                        console.warn(`[DEX Render] Info field NOT found: ${info.label}. Searched keys:`, info.keys);
                    }
                });

                // 4. Banner + alert si INFO_DOPING_ALERTA no está vacío
                const dopingField = fields.find(f => f.key === 'ALERTA DOPING');
                const dopingValue = dopingField && String(dopingField.value || '').trim();

                const resultsEl = document.getElementById('dex-results');
                let dopingBanner = document.getElementById('dex-doping-banner');
                if (dopingValue) {
                    if (!dopingBanner && resultsEl && resultsEl.parentNode) {
                        dopingBanner = document.createElement('div');
                        dopingBanner.id = 'dex-doping-banner';
                        resultsEl.parentNode.insertBefore(dopingBanner, resultsEl);
                    }
                    if (dopingBanner) {
                        dopingBanner.style.cssText = 'background:#facc15;color:#000;font-weight:600;padding:10px 14px;border-radius:6px;margin-bottom:10px;';
                        dopingBanner.textContent = `⚠️ DOPING POSITIVO: ${dopingValue}`;
                        dopingBanner.style.display = 'block';
                    }
                    setTimeout(() => {
                        alert(`⚠️ ALERTA CRÍTICA: DOPING POSITIVO — ${dopingValue}`);
                    }, 500);
                } else if (dopingBanner) {
                    dopingBanner.style.display = 'none';
                }

                // ── Renderizar tabla ──
                this._dexRenderFieldsTable(fields, isMapped);

                // Poblar acordeón de texto bruto
                if (this._dexRawSources) {
                    this._dexShowRawTab('azure');
                    const acc = document.getElementById('dex-raw-accordion');
                    if (acc) {
                        const summary = acc.querySelector('summary');
                        if (summary) {
                            summary.onclick = () => {
                                const arrow = document.getElementById('dex-raw-arrow');
                                if (arrow) arrow.style.transform = acc.open ? '' : 'rotate(90deg)';
                            };
                        }
                    }
                } else {
                    const acc = document.getElementById('dex-raw-accordion');
                    if (acc) acc.style.display = 'none';
                }
                // Guardar campos renderizados para uso de _dexFlagForTraining
                this._dexRenderedFields = fields;
                this._dexRenderedIsMapped = isMapped;
            },

            // ── Helper: renderiza la tabla de campos en el DOM ──
            _dexRenderFieldsTable: function (fields, isMapped) {
                const tbody = document.getElementById('dex-results-body');
                tbody.innerHTML = '';
                fields.forEach((f, i) => {
                    const tr = document.createElement('tr');
                    tr.style.borderTop = '1px solid rgba(255,255,255,0.04)';
                    const confColor = f.confidence >= 0.9 ? '#4ade80' : f.confidence >= 0.7 ? '#facc15' : '#f87171';
                    const hasVal = f.value && String(f.value).trim() && String(f.value).trim() !== '—';
                    const statusIcon = hasVal
                        ? '<span title="Valor extraído" style="color:#4ade80;font-size:13px;">✓</span>'
                        : '<span title="Vacío o dudoso" style="color:#f87171;font-size:13px;">✗</span>';
                    const valColor = (f.key === 'ALERTA DOPING' && hasVal) ? '#facc15' : '#e2e8f0';
                    tr.innerHTML = `
                        <td style="padding:7px 12px; color:#cbd5e1;">${this._esc(f.key)}</td>
                        <td style="padding:7px 12px; color:${valColor};" id="dex-val-${i}">
                            ${this._dexEditMode
                                ? `<input type="text" value="${this._esc(f.value)}" onchange="app._dexUpdateFieldValue(${isMapped}, ${i}, this.value)" style="width:100%;background:#1e2640;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#e2e8f0;padding:3px 6px;font-size:12px;">`
                                : this._esc(f.value) || '<span style="color:#475569;">—</span>'}
                        </td>
                        <td style="padding:7px 12px; text-align:center; color:${confColor}; font-size:11px;">${f.confidence ? Math.round(f.confidence*100)+'%' : '—'}</td>
                        <td style="padding:7px 12px; text-align:center;">${statusIcon}</td>
                        <td style="padding:7px 12px; text-align:center;">
                            <button title="Guardar corrección como ejemplo de entrenamiento" onclick="app._dexFlagForTraining(${i})" style="background:none;border:none;cursor:pointer;color:#facc15;font-size:14px;padding:0;line-height:1;">⚑</button>
                        </td>`;
                    tbody.appendChild(tr);
                });

                document.getElementById('dex-results-count').textContent = `${fields.length} campos`;
                document.getElementById('dex-results').style.display = 'block';
            },

            // ── DEX RAW ACCORDION ─────────────────────────────────────────────
            _dexShowRawTab: function (src) {
                const sources = this._dexRawSources || {};
                const content = {
                    azure:  sources.azure  || '(sin datos)',
                    ocr:    sources.ocr    || '(sin datos)',
                    gemini: sources.gemini || '(sin datos)'
                };
                const el = document.getElementById('dex-raw-content');
                if (el) {
                    el.textContent = content[src] || '';
                    el.removeAttribute('data-raw-text');
                    const searchInput = document.getElementById('dex-raw-search');
                    if (searchInput) searchInput.value = '';
                }
                const acc = document.getElementById('dex-raw-accordion');
                if (acc) acc.style.display = '';
                ['azure','ocr','gemini'].forEach(t => {
                    const btn = document.getElementById('dex-raw-btn-' + t);
                    if (!btn) return;
                    const active = t === src;
                    btn.style.background   = active ? 'rgba(99,102,241,0.2)' : 'none';
                    btn.style.color        = active ? '#a5b4fc' : '#64748b';
                    btn.style.border       = active ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)';
                    btn.style.borderBottom = active ? 'none' : '1px solid rgba(255,255,255,0.07)';
                });
            },

            _dexSearchRawText: function (query) {
                const el = document.getElementById('dex-raw-content');
                if (!el) return;
                
                if (!el.hasAttribute('data-raw-text')) {
                    el.setAttribute('data-raw-text', el.textContent);
                }
                const originalText = el.getAttribute('data-raw-text');
                
                if (!query || query.trim() === '') {
                    el.innerHTML = this._esc(originalText);
                    return;
                }
                
                const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapeRegExp(query), 'gi');
                
                const escapedOriginal = this._esc(originalText);
                const highlighted = escapedOriginal.replace(regex, match => `<mark class="dex-search-mark" style="background:#facc15; color:#000; border-radius:2px; padding:0 2px; box-shadow: 0 0 3px rgba(250, 204, 21, 0.5);">${match}</mark>`);
                
                el.innerHTML = highlighted;

                // Auto-scroll hacia el primer resultado encontrado
                setTimeout(() => {
                    const firstMark = el.querySelector('mark.dex-search-mark');
                    if (firstMark) {
                        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 50);
            },

            // ── DEX TRAINING ──────────────────────────────────────────────────
            _dexGetTrainingExamples: function (profileId) {
                if (!profileId) return [];
                const profile = this._dexProfiles.find(p => p.id === profileId);
                return (profile && profile.training) ? profile.training : [];
            },

            _dexFlagForTraining: function (rowIndex) {
                const f = (this._dexRenderedFields || [])[rowIndex];
                if (!f) return;
                const profileId = document.getElementById('dex-profile-select')?.value;
                if (!profileId) { this.showToast('⚠️ Selecciona un perfil para guardar el ejemplo.'); return; }
                this._dexFlagPending = { profileId, campo: f.key, rowIndex };
                document.getElementById('dex-flag-campo').textContent = f.key;
                const input = document.getElementById('dex-flag-input');
                input.value = f.value || '';
                document.getElementById('dex-flag-dialog').style.display = 'flex';
                setTimeout(() => { input.focus(); input.select(); }, 60);
            },

            _dexFlagConfirm: function () {
                const dlg = document.getElementById('dex-flag-dialog');
                if (!this._dexFlagPending) { dlg.style.display = 'none'; return; }
                const { profileId, campo, rowIndex } = this._dexFlagPending;
                const valorCorrecto = document.getElementById('dex-flag-input').value.trim();
                const valorOriginal = (this._dexRenderedFields || [])[rowIndex]?.value || '';
                dlg.style.display = 'none';
                this._dexFlagPending = null;
                if (!valorCorrecto) return;

                // 1. Guardar como ejemplo de entrenamiento (con contexto real del OCR)
                const contexto = this._dexExtractContext(campo, valorOriginal);
                this._dexSaveTrainingExample(profileId, campo, valorOriginal, valorCorrecto, contexto);

                // 2. Actualizar valor para exportación
                if (rowIndex !== undefined) {
                    this._dexUpdateFieldValue(this._dexRenderedIsMapped, rowIndex, valorCorrecto);
                    // Actualizar celda visible en la tabla
                    const td = document.getElementById(`dex-val-${rowIndex}`);
                    if (td) {
                        const inp = td.querySelector('input');
                        if (inp) inp.value = valorCorrecto;
                        else td.innerHTML = this._esc(valorCorrecto);
                    }
                    // Actualizar estado a ✓
                    const tr = td?.closest('tr');
                    if (tr) {
                        const estCell = tr.cells[3];
                        if (estCell) estCell.innerHTML = '<span style="color:#4ade80;font-size:13px;" title="Corregido">✓</span>';
                    }
                }

                // 3. Si la pestaña de entrenamiento está activa, refrescarla
                const trainingPanel = document.getElementById('dex-panel-training');
                if (trainingPanel && trainingPanel.style.display !== 'none') {
                    this._dexRenderTrainingPanel();
                }
            },

            _dexFlagCancel: function () {
                document.getElementById('dex-flag-dialog').style.display = 'none';
                this._dexFlagPending = null;
            },

            // Busca el valor original (o el nombre del campo) en las fuentes crudas
            // (Azure/Gemini/OCR) y devuelve una ventana de texto alrededor del match,
            // incluyendo puntuación y campos vecinos para dar contexto real.
            _dexExtractContext: function (campo, valorOriginal) {
                const sources = this._dexRawSources || {};
                const fullText = [sources.azure, sources.gemini, sources.ocr].filter(Boolean).join('\n');
                if (!fullText) return '';
                const WINDOW = 80;
                const tryFind = (needle) => {
                    if (!needle) return -1;
                    return fullText.toLowerCase().indexOf(needle.toLowerCase());
                };
                let pos = tryFind(valorOriginal);
                if (pos < 0) pos = tryFind(campo);
                if (pos < 0) return '';
                const start = Math.max(0, pos - WINDOW);
                const end = Math.min(fullText.length, pos + (valorOriginal || campo).length + WINDOW);
                return fullText.substring(start, end).replace(/\s+/g, ' ').trim();
            },

            _dexSaveTrainingExample: function (profileId, campo, valorOriginal, valorCorrecto, contextoOcr) {
                const idx = this._dexProfiles.findIndex(p => p.id === profileId);
                if (idx < 0) return;
                if (!this._dexProfiles[idx].training) this._dexProfiles[idx].training = [];
                const list = this._dexProfiles[idx].training;
                const entry = { campo, valor_original: valorOriginal, valor_correcto: valorCorrecto, contexto_ocr: contextoOcr };
                // Evitar duplicados exactos (mismo campo + mismo contexto); si no, acumular como patrón nuevo
                const existing = list.findIndex(e => e.campo === campo && e.contexto_ocr === contextoOcr);
                if (existing >= 0) {
                    list[existing] = entry;
                } else {
                    list.push(entry);
                    // Máx 5 ejemplos por campo (FIFO) para no saturar el prompt
                    const sameField = list.filter(e => e.campo === campo);
                    if (sameField.length > 5) {
                        const firstIdx = list.findIndex(e => e.campo === campo);
                        list.splice(firstIdx, 1);
                    }
                }
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                this.showToast(`✅ Ejemplo guardado: "${campo}" → "${valorCorrecto}"`);
            },

            _dexRenderTrainingPanel: function () {
                const listEl = document.getElementById('dex-training-list');
                const nameEl  = document.getElementById('dex-training-profile-name');
                const countEl = document.getElementById('dex-training-count');
                if (!listEl) { console.warn('[DEX Training] dex-training-list no encontrado en DOM'); return; }

                // Recargar perfiles desde localStorage para tener datos frescos
                try {
                    const stored = JSON.parse(localStorage.getItem('dex_profiles') || '[]');
                    if (stored.length) this._dexProfiles = stored;
                } catch(e) {}

                const profileId = document.getElementById('dex-profile-select')?.value || '';
                const profile   = profileId ? this._dexProfiles.find(p => p.id === profileId) : null;
                console.log('[DEX Training] profileId=', profileId, '| profile=', profile?.name, '| profiles total=', this._dexProfiles?.length);

                if (!profile) {
                    if (nameEl) nameEl.textContent = '— (ningún perfil activo)';
                    if (countEl) countEl.textContent = '0 ejemplos';
                    listEl.innerHTML = '<p style="font-size:12px;color:#94a3b8;margin:8px 0;">Selecciona un perfil en EXTRAER para ver sus ejemplos.</p>';
                    return;
                }

                const examples = Array.isArray(profile.training) ? profile.training : [];
                if (nameEl) nameEl.textContent = profile.name;
                if (countEl) countEl.textContent = `${examples.length} ejemplo${examples.length !== 1 ? 's' : ''}`;
                console.log('[DEX Training] ejemplos:', examples.length, examples);

                if (!examples.length) {
                    listEl.innerHTML = '<p style="font-size:12px;color:#94a3b8;margin:8px 0;">Sin ejemplos aún. Usa ⚑ en la tabla de resultados para agregar correcciones.</p>';
                    return;
                }
                listEl.innerHTML = examples.map((e, i) => `
                    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(99,102,241,0.2);border-radius:6px;padding:8px 10px;font-size:12px;display:flex;align-items:flex-start;gap:8px;">
                        <div style="flex:1;min-width:0;">
                            <span style="color:#a5b4fc;font-weight:600;">${this._esc(e.campo)}</span>
                            <span style="color:#64748b;"> → </span>
                            <span style="color:#4ade80;font-weight:600;">"${this._esc(e.valor_correcto)}"</span>
                            ${e.contexto_ocr ? `<div style="color:#64748b;margin-top:3px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${this._esc(e.contexto_ocr)}">OCR: ${this._esc(e.contexto_ocr.substring(0,80))}</div>` : ''}
                        </div>
                        <button onclick="app._dexDeleteTrainingExample('${profileId}',${i})" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:14px;padding:0;flex-shrink:0;" title="Eliminar">✕</button>
                    </div>`).join('');
            },

            _dexDeleteTrainingExample: function (profileId, index) {
                const idx = this._dexProfiles.findIndex(p => p.id === profileId);
                if (idx < 0) return;
                this._dexProfiles[idx].training.splice(index, 1);
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                this._dexRenderTrainingPanel();
            },

            _dexClearTraining: function () {
                const profileId = document.getElementById('dex-profile-select')?.value;
                if (!profileId) return;
                const idx = this._dexProfiles.findIndex(p => p.id === profileId);
                if (idx < 0) return;
                if (!confirm('¿Eliminar todos los ejemplos de entrenamiento de este perfil?')) return;
                this._dexProfiles[idx].training = [];
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                this._dexRenderTrainingPanel();
                this.showToast('🗑 Ejemplos de entrenamiento eliminados.');
            },

            _dexExportTraining: function () {
                const profileId = document.getElementById('dex-profile-select')?.value;
                const profile   = profileId ? this._dexProfiles.find(p => p.id === profileId) : null;
                if (!profile || !profile.training?.length) { this.showToast('Sin ejemplos para exportar.'); return; }
                const blob = new Blob([JSON.stringify(profile.training, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `training_${profile.name.replace(/\s+/g,'_')}.json`;
                a.click();
            },

            _dexUpdateFieldValue: function (isMapped, index, val) {
                if (!isMapped) {
                    if (this._dexFields[index]) {
                        this._dexFields[index].value = val;
                    }
                } else {
                    const profileId = document.getElementById('dex-profile-select').value;
                    const profile   = this._dexProfiles.find(p => p.id === profileId);
                    if (profile && profile.fields && profile.fields[index]) {
                        const pf = profile.fields[index];
                        const _normalizeText = (s) => {
                            if (!s) return '';
                            return String(s).trim().toLowerCase()
                                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                .replace(/[^a-z0-9]/g, '');
                        };
                        const _getMatchScore = (ocrKey, alias, ocrVal) => {
                            const nKey = _normalizeText(ocrKey);
                            const nAlias = _normalizeText(alias);
                            if (!nKey || !nAlias) return 0;
                            let score = 0;
                            if (nKey === nAlias) score = 100;
                            else if (nKey.length >= 3 && nAlias.length >= 3) {
                                if (nKey.includes(nAlias)) score = 50 + nAlias.length;
                                else if (nAlias.includes(nKey)) score = 50 + nKey.length;
                            }
                            if (score > 0 && (!ocrVal || !String(ocrVal).trim())) {
                                score = score * 0.1;
                            }
                            return score;
                        };
                        const allAliases = [...(pf.aliases || []).map(a => a.trim()), pf.column.trim()];
                        let bestScore = 0;
                        let bestField = null;
                        for (const f of this._dexFields) {
                            for (const a of allAliases) {
                                const score = _getMatchScore(f.key, a, f.value);
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestField = f;
                                }
                            }
                        }
                        if (bestField) {
                            bestField.value = val;
                            console.log(`[DEX] Actualizado campo coincidente [${bestField.key}] para columna [${pf.column}] con: "${val}"`);
                        } else {
                            this._dexFields.push({ key: pf.column, value: val, confidence: 1.0 });
                            console.log(`[DEX] Creado nuevo campo para columna [${pf.column}] con: "${val}"`);
                        }
                    }
                }
            },

            dexToggleEdit: function () {
                this._dexEditMode = !this._dexEditMode;
                document.getElementById('dex-btn-edit').textContent = this._dexEditMode ? '👁 Ver' : '✏️ Editar';
                this._dexRenderResults();
            },

            _esc: function (s) {
                return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            },

            dexCopyToClipboard: async function () {
                const fields = this._dexRenderedFields || this._dexFields || [];
                if (!fields.length) { this.showToast('⚠️ Nada que copiar.'); return; }
                const cell = value => {
                    const text = String(value ?? '');
                    return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
                };
                const text = [fields.map(field => cell(field.key)).join('\t'), fields.map(field => cell(field.value)).join('\t')].join('\n');
                try {
                    await navigator.clipboard.writeText(text);
                    this.showToast('📋 Datos copiados en formato TSV.');
                } catch (error) {
                    this.showToast('❌ No se pudo copiar: ' + error.message);
                }
            },

            dexExportNew: function () {
                if (!this._dexFields.length) { this.showToast('⚠️ Nada que exportar.'); return; }
                const profileId = document.getElementById('dex-profile-select').value;
                const profile   = this._dexProfiles.find(p => p.id === profileId);
                this._dexDoExport(false, profile);
            },

            dexExportAppend: function () {
                if (!this._dexFields.length) { this.showToast('⚠️ Nada que exportar.'); return; }
                const profileId = document.getElementById('dex-profile-select').value;
                const profile   = this._dexProfiles.find(p => p.id === profileId);
                this._dexDoExport(true, profile);
            },

            // Post-procesamiento inteligente de campos mapeados por alias cuando Gemini no está disponible
            _dexPostProcessFields: function (fields, ocrFields) {
                const norm = (s) => String(s || '').trim().toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const normStrip = (s) => norm(s).replace(/[^a-z0-9]/g, '');

                // Concatenar todo el texto OCR para búsqueda global
                const allOcrText = ocrFields.map(f => `${f.key}: ${f.value}`).join(' | ');

                fields.forEach(f => {
                    const nk = normStrip(f.key);

                    // ── 1. FECHA DE NACIMIENTO ──
                    if (nk.includes('fechadenacimiento') || nk.includes('fechanacimiento')) {
                        const v = norm(f.value);
                        // Si el valor contiene basura concatenada (edad, sexo, genero...)
                        if (/anos|sexo|edad|genero|identidad/i.test(v) || !v.trim()) {
                            // Intentar extraer fecha del KEY del campo OCR empatado
                            const ocrKey = f._ocrKey || '';
                            let dateMatch = ocrKey.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/);
                            if (!dateMatch) {
                                // Buscar en el value también (podría estar al inicio)
                                dateMatch = f.value.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/);
                            }
                            if (!dateMatch) {
                                // Buscar en todos los campos OCR
                                for (const ocr of ocrFields) {
                                    const combined = `${ocr.key} ${ocr.value}`;
                                    if (/nacimiento/i.test(combined)) {
                                        dateMatch = combined.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/);
                                        if (dateMatch) break;
                                    }
                                }
                            }
                            if (dateMatch) {
                                let [, d, m, y] = dateMatch;
                                let yr = parseInt(y);
                                if (yr < 100) yr = yr > 30 ? 1900 + yr : 2000 + yr;
                                f.value = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${yr}`;
                                console.log(`[DEX PostProcess] FECHA NACIMIENTO extraída: "${f.value}" de key: "${ocrKey}"`);
                            }
                        }
                    }

                    // ── 2. SEXO ──
                    if (nk === 'sexo' || nk === 'genero') {
                        const v = norm(f.value);
                        if (!v.trim() || /sexo|genero|identidad|anos|edad/i.test(v)) {
                            // Escanear todos los campos OCR para encontrar indicadores de sexo
                            let found = false;
                            for (const ocr of ocrFields) {
                                const combined = `${ocr.key} ${ocr.value}`;
                                // Patrones: "Sexo: F_ MX", "Sexo: F M :selected:", "F_ M[X]"
                                const sexBlock = combined.match(/sexo\s*:?\s*(.*?)(?:\||identidad|$)/i);
                                if (sexBlock) {
                                    const txt = sexBlock[1];
                                    // M está marcado: MX, M:selected:, M✓, M[X], o F seguido de _ y luego M sin _
                                    if (/m\s*[x✓✗]/i.test(txt) || /m\s*:selected:/i.test(txt) || /m\s*\[x\]/i.test(txt) || /f[_\s]+m(?![_])/i.test(txt)) {
                                        f.value = 'MASCULINO';
                                        found = true;
                                    } else if (/f\s*[x✓✗]/i.test(txt) || /f\s*:selected:/i.test(txt) || /f\s*\[x\]/i.test(txt)) {
                                        f.value = 'FEMENINO';
                                        found = true;
                                    }
                                    if (found) {
                                        console.log(`[DEX PostProcess] SEXO detectado: "${f.value}" de: "${txt}"`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // ── 3. PESO ──
                    if (nk === 'peso') {
                        if (!f.value || !String(f.value).trim()) {
                            // Escanear todos los campos OCR buscando un valor numérico asociado a "Peso"
                            for (const ocr of ocrFields) {
                                const combined = `${ocr.key} ${ocr.value}`;
                                const pesoMatch = combined.match(/peso\s*:?\s*(\d+[\.,]?\d*)\s*(?:kg|kilos|kgs)?/i);
                                if (pesoMatch) {
                                    f.value = pesoMatch[1].replace(',', '.');
                                    console.log(`[DEX PostProcess] PESO extraído: "${f.value}" de: "${combined.substring(0, 60)}"`);
                                    break;
                                }
                            }
                        }
                    }

                    // ── 4. EDO CIVIL / ESTADO CIVIL ──
                    if (nk.includes('estadocivil') || nk.includes('edocivil')) {
                        const v = String(f.value).toUpperCase().trim();
                        // Interpretar marcas de checkbox: "SL C_UL_V_" o "S/ C_ UL_ V_" o similar
                        if (v && /[SCULVD_\/]/i.test(v) && v.length <= 20) {
                            // Buscar cuál opción NO tiene _ después (está marcada)
                            // Patrones: S seguido de algo que NO es _ → Soltero marcado
                            if (/\bS[^_C\s]/i.test(v) || /^S[\/LX]/i.test(v)) {
                                f.value = 'SOLTERO';
                            } else if (/\bC[^_\sU]/i.test(v) || /\bCA/i.test(v)) {
                                f.value = 'CASADO';
                            } else if (/UL[^_\s]/i.test(v)) {
                                f.value = 'UNION LIBRE';
                            } else if (/\bD[^_\s]/i.test(v)) {
                                f.value = 'DIVORCIADO';
                            } else if (/\bV[^_\s]/i.test(v) && !/\bVI/i.test(v)) {
                                f.value = 'VIUDO';
                            }
                            if (/SOLTERO|CASADO|UNION|DIVORCIADO|VIUDO/.test(f.value)) {
                                console.log(`[DEX PostProcess] EDO CIVIL interpretado: "${f.value}" de: "${v}"`);
                            }
                        }
                    }

                    // ── 5. TALLA / ESTATURA ──
                    if (nk.includes('talla') || nk.includes('estatura') || nk.includes('altura')) {
                        const cleaned = String(f.value).replace(/[^0-9.,]/g, '').replace(',', '.');
                        const numVal = parseFloat(cleaned);
                        if (!isNaN(numVal) && numVal >= 100) {
                            f.value = String(Math.round((numVal / 100) * 100) / 100); // 184 -> 1.84
                            console.log(`[DEX PostProcess] TALLA normalizada: ${numVal} -> ${f.value}`);
                        }
                    }
                });

                return fields;
            },

            // Parsear valor al tipo correcto (número, fecha, texto)
            _dexParseValue: function (val, key) {
                if (!val || !val.trim()) return '';
                let s = val.trim();
                
                // Si la columna es Peso o Talla/Estatura, extraer solo el número
                if (key) {
                    const _normalizeText = (text) => {
                        if (!text) return '';
                        return String(text).trim().toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                            .replace(/[^a-z0-9]/g, '');
                    };
                    const normKey = _normalizeText(key);
                    if (normKey.includes('peso') || normKey.includes('talla') || normKey.includes('estatura') || normKey.includes('altura')) {
                        const cleaned = s.replace(/[^0-9.,-]/g, '');
                        if (cleaned) s = cleaned;
                    }
                }
                
                // Número
                const num = Number(s.replace(/,/g, '.'));
                if (!isNaN(num) && s !== '') return num;
                // Fecha: formatos comunes dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd
                const datePatterns = [
                    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
                    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
                ];
                for (const pat of datePatterns) {
                    const m = s.match(pat);
                    if (m) {
                        let d;
                        if (m[1].length === 4) d = new Date(+m[1], +m[2]-1, +m[3]);
                        else d = new Date(+m[3] < 100 ? 2000+m[3] : +m[3], +m[2]-1, +m[1]);
                        if (!isNaN(d.getTime())) return d;
                    }
                }
                return s;
            },

            _dexGeminiNormalize: async function (fields, profile) {
                // Llama a Gemini para normalizar/interpretar campos difíciles
                const apiKey = localStorage.getItem('gemini_api_key') || localStorage.getItem('GEMINI_API_KEY');
                if (!apiKey) {
                    console.warn('[DEX] Gemini: sin API key en localStorage. Clave buscada: gemini_api_key / GEMINI_API_KEY');
                    console.warn('[DEX] localStorage keys:', Object.keys(localStorage).filter(k => k.toLowerCase().includes('gem') || k.toLowerCase().includes('api')));
                    return fields;
                }
                console.log('[DEX] Gemini: API key encontrada, iniciando llamada...');

                const targetCols = (profile && profile.fields)
                    ? profile.fields.map(f => f.column).filter(Boolean)
                    : fields.map(f => f.key);

                const docType = (profile && profile.docType) ? profile.docType : 'medico';
                if (docType === 'medico') {
                    if (!targetCols.includes('INFO_CONCLUSION_RADIOGRAFIAS')) targetCols.push('INFO_CONCLUSION_RADIOGRAFIAS');
                    if (!targetCols.includes('INFO_VALORES_EGO')) targetCols.push('INFO_VALORES_EGO');
                    if (!targetCols.includes('INFO_VISIOMETRIA_SNELLEN')) targetCols.push('INFO_VISIOMETRIA_SNELLEN');
                    if (!targetCols.includes('INFO_DOPING_ALERTA')) targetCols.push('INFO_DOPING_ALERTA');
                }

                const rawData = {};
                if (this._dexFields) {
                    this._dexFields.forEach(of => { if (of.value && String(of.value).trim()) rawData[of.key] = of.value; });
                }
                fields.forEach(f => { if (f.value !== undefined && f.value !== '') rawData[f.key] = f.value; });

                // Texto crudo completo (Azure/Gemini Vision/OCR) — evita depender solo de _dexFields ya consolidados
                const rs = this._dexRawSources || {};
                const rawTextBlock = ['gemini', 'ocr', 'azure']
                    .filter(k => rs[k] && String(rs[k]).trim())
                    .map(k => `--- ${k.toUpperCase()} ---\n${rs[k]}`)
                    .join('\n\n');

                let typePrompt = '';
                let rulesPrompt = '';

                if (docType === 'medico') {
                    typePrompt = 'formularios médicos';
                    rulesPrompt = `   - NOMBRE: Busca el nombre completo del paciente. Puede venir en un solo campo (ej. "Paciente"="ABRAHAM HERNANDEZ HERNANDEZ", "Nombre completo"="JUAN PEREZ LOPEZ") O en campos separados (ej. "Apellido Paterno"="TORRES", "Apellido Materno"="LOYA", "Nombre(s)"="ALEJANDRA"). Si viene en un solo campo, tómalo completo tal como está. Si viene separado, concaténalos. Orden de salida: si nameOrder es "nombre_apellidos" → "ALEJANDRA TORRES LOYA"; si es "apellidos_nombre" → "TORRES LOYA ALEJANDRA". Devuelve SIEMPRE el nombre completo con todos los apellidos, nunca solo un apellido.
   - FECHA DE NACIMIENTO: Formato DD/MM/YYYY. Si el valor es "DMA DDMMYY" (ej. "DMA 140525") interpreta DD=14 MM=05 YY=25 → "14/05/2025". Si mezcla fecha con edad/sexo extrae solo la fecha. Sin fecha: vacío.
   - SEXO: Solo "MASCULINO" o "FEMENINO". ":selected:" después de M, "MX", "F_ M :selected:" = MASCULINO. "F :selected:" o "F ✓" = FEMENINO. Campo "Identidad de Genero: FEMENINO/MASCULINO" también es válido.
   - ESTADO CIVIL / EDO CIVIL: identifica cuál letra está marcada (✓, X, selected, o cualquier marca visible junto a S/C/UL/V). S=marcado -> "SOLTERO (A)". C=marcado -> "CASADO (A)". UL=marcado -> "UNION LIBRE". V=marcado -> "VIUDO (A)". Si el documento ya trae la palabra completa, normalízala a ese mismo formato.
   - ESCOLARIDAD: "BÁSICA", "MEDIA", "TECNICO", "LICENCIATURA" o "POSTGRADO". Busca :selected: o ✓ junto a la opción. "Básica :selected:" = BÁSICA. "Universidad ✓" = LICENCIATURA.
   - PESO: solo el número en kg, sin unidades ni texto (ej. "67", no "67 kg" ni ", kg").
   - TALLA / ESTATURA: solo el número en metros con decimal (ej. "1.83", no "1.83 metros"). Si viene en cm (ej. 183), conviértelo a metros (1.83).
   - CHOL: busca "CHOL", "COLESTEROL", "COLESTEROL TOTAL" en CUALQUIER fuente (mayúsc/minúsc). Solo el número sin unidades. NO confundir con TRIGLICERIDOS.
   - GLUC: busca "GLUC", "GLUCOSA", "GLUCOSA BASAL", "GLICEMIA". Solo el número sin unidades.
   - TRIG: busca "TRIG", "TRIGLICERIDOS", "TRIGS". Solo el número sin unidades.
   - AC URICO: busca "AC URICO", "ACIDO URICO", "A. URICO", "ACID URIC". Solo el número sin unidades.
   - HEMOGLOBINA GLUCOSILADA: busca "HBA1C", "HB A1C", "HEMOGLOBINA GLICADA", "HEMOGLOBINA GLUCOSILADA", "HEMOGLOBINA GLICOSILADA". Solo el número sin unidades.
   - TA / PRESION ARTERIAL / P.A.: Busca "P.A.", "PA:", "PRESION ARTERIAL", "TENSION ARTERIAL" en key o value. El valor es sistólica/diastólica (ej. "130/90"). Devuelve solo los números con barra (ej. "130/90").
   - OIDO DERECHO / OIDO IZQUIERDO: Busca resultados de audiometría. Valores típicos: NORMOACUSIA, HIPOACUSIA LEVE, HIPOACUSIA SUPERFICIAL, HIPOACUSIA MODERADA. Si no hay resultado de audiometría en los datos, devuelve "".
   - ESPIROMETRIA: Busca resultados de espirometría. Valores válidos ÚNICAMENTE: NORMAL, PATRON RESTRICTIVO, PATRON OBSTRUCTIVO, ESTUDIO DENTRO DE LIMITES NORMALES. Si no hay un resultado claro de espirometría (por ejemplo, solo hay notas de procedimiento o leyendas de doping), devuelve "".
   - DOPING (INFO_DOPING_ALERTA): Busca panel con encabezado DOPING, ANTIDOPING, ANTIDROGAS, EXAMEN ANTIDROGAS, TEST ANTIDROGAS, CONSTANCIA ANTIDROGAS o PERFIL N DROGAS (cualquier número). Evalúa estas sustancias (con sinónimos/abreviaciones): Cocaína (COC), Marihuana/Canabinoides (THC, Cannabis, Mariguana), Anfetaminas (AMP, ANF), Benzodiacepinas (BZD, Benzodiazepinas), Opiáceos (Morfina, OPI), Metanfetaminas (MET), Barbitúricos. Ignora "Tira de Adulteración" (no es sustancia). POSITIVO o REACTIVO = positivo; NEGATIVO o NO REACTIVO = negativo (ignorar). Devuelve las sustancias positivas separadas por coma (ej. "COCAÍNA, ANFETAMINAS"), o "" si todo negativo o no hay panel.
   - VISIOMETRIA (INFO_VISIOMETRIA_SNELLEN): Extrae del cuadro Snellen: Visión cercana OD/OI/AO, Visión lejana OD/OI/AO, Corrección OD/OI/AO (formato "20/20"), y observaciones. Si un tipo no aparece, omítelo (no inventes). Si hay valores tachados/corregidos a mano, usa el más claro/reciente. Formato de salida: "Visión cercana: OD [x], OI [x], AO [x]. Visión lejana: OD [x], OI [x], AO [x]. Corrección: OD [x], OI [x], AO [x]. Observaciones: [texto]".`;
                } else if (docType === 'factura') {
                    typePrompt = 'facturas, recibos y comprobantes de pago';
                    rulesPrompt = `   - RFC / Tax ID: normaliza a mayúsculas sin guiones ni espacios.
   - Montos / Precios: extrae solo números con punto decimal (ej. 1250.50). Si hay moneda, no pongas símbolo (ej. "MXN" o "USD" separado).
   - Fechas: formato DD/MM/YYYY.
   - Emisor / Receptor: nombres de las empresas o personas correspondientes.`;
                } else if (docType === 'legal') {
                    typePrompt = 'documentos legales o contratos';
                    rulesPrompt = `   - Nombres de personas / partes: normaliza a mayúsculas.
   - Fechas: formato DD/MM/YYYY.
   - Identificaciones (INE, Pasaporte, etc.): números limpios sin espacios.`;
                } else {
                    typePrompt = 'documentos generales';
                    rulesPrompt = `   - Fechas: formato DD/MM/YYYY.
   - Nombres: capitalización adecuada.
   - Números: formato numérico limpio.`;
                }

                const prompt = `Eres un asistente experto que extrae y normaliza datos de ${typePrompt}.
Tienes los siguientes datos crudos extraídos por OCR de un PDF (campos ya parseados):
${JSON.stringify(rawData, null, 2)}
${rawTextBlock ? `\nTexto crudo completo por fuente (úsalo si un dato no aparece arriba, ej. nombre completo, labs en páginas posteriores):\n${rawTextBlock}\n` : ''}
Las columnas destino del Excel son: ${targetCols.join(', ')}

Tu tarea:
1. Mapea cada dato crudo a la columna destino más apropiada.
2. Normaliza los valores:
${rulesPrompt}
   - Valores vacíos, ilegibles o irrelevantes: string vacío "".
   - No inventes valores que no estén en los datos crudos.
3. Responde ÚNICAMENTE con un JSON plano: {"COLUMNA": "valor", ...}
   Solo incluye columnas que tengan valor no vacío.`;

                try {
                    const MAX_RETRIES = 3;
                    const RETRY_DELAYS = [3000, 6000, 12000]; // ms
                    let lastResp = null;

                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        if (attempt > 0) {
                            const delay = RETRY_DELAYS[attempt - 1] || 12000;
                            console.log(`[DEX] Gemini retry ${attempt}/${MAX_RETRIES} en ${delay/1000}s...`);
                            await new Promise(r => setTimeout(r, delay));
                        }

                        lastResp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + apiKey, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                        });

                        if (lastResp.status === 429) {
                            console.warn(`[DEX] Gemini 429 en intento ${attempt+1}`);
                            continue; // retry
                        }
                        break; // success or non-retryable error
                    }

                    if (lastResp.status === 429 || !lastResp.ok) {
                        const reason = lastResp.status === 429 ? '429 rate limit' : `error ${lastResp.status}`;
                        // Fallback 1: Mistral (tiene visión)
                        const mistralKey = localStorage.getItem('mistral_api_key') || '';
                        if (mistralKey) {
                            console.warn('[DEX] Probando otro servicio de IA:', reason);
                            try {
                                const mistralResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + mistralKey },
                                    body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: prompt }], max_tokens: 1024, temperature: 0 })
                                });
                                if (mistralResp.ok) {
                                    const mistralData = await mistralResp.json();
                                    const mistralText = mistralData?.choices?.[0]?.message?.content || '';
                                    const ms = mistralText.indexOf('{'), me = mistralText.lastIndexOf('}');
                                    if (ms >= 0 && me >= 0) {
                                        const normalized = JSON.parse(mistralText.slice(ms, me + 1));
                                        return Object.entries(normalized).map(([key, value]) => ({ key, value: String(value) }));
                                    }
                                }
                            } catch(mistralErr) { console.warn('[DEX] Mistral fallback error:', mistralErr); }
                        }
                        // Fallback 2: Groq (TPM 12000) — saltar si el prompt estimado no cabe
                        const estTokens = Math.ceil(prompt.length / 4) + 1024; // +max_tokens de respuesta
                        if (estTokens > 11000) {
                            console.warn(`[DEX] Groq omitido: prompt estimado ${estTokens} tokens excede TPM (12000). Usando aliases.`);
                            app.showToast('Revisa los campos detectados antes de exportar.');
                            return fields;
                        }
                        console.warn('[DEX] Probando otro servicio de IA:', reason);
                        try {
                            const groqKey = localStorage.getItem('groq_api_key') || localStorage.getItem('GROQ_API_KEY') || localStorage.getItem('groq-api-key') || '';
                            const PROXY_BASE_G = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';
                            const groqResp = await fetch(PROXY_BASE_G + '/groq/openai/v1/chat/completions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...(groqKey ? { 'Authorization': 'Bearer ' + groqKey } : {}) },
                                body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 1024, temperature: 0 })
                            });
                            if (groqResp.ok) {
                                const groqData = await groqResp.json();
                                const groqText = groqData?.choices?.[0]?.message?.content || '';
                                const gs = groqText.indexOf('{'), ge = groqText.lastIndexOf('}');
                                if (gs >= 0 && ge >= 0) {
                                    const normalized = JSON.parse(groqText.slice(gs, ge + 1));
                                    return Object.entries(normalized).map(([key, value]) => ({ key, value: String(value) }));
                                }
                            }
                        } catch(groqErr) { console.warn('[DEX] Groq fallback error:', groqErr); }
                        app.showToast('Revisa los campos detectados antes de exportar.');
                        return fields;
                    }
                    const data = await lastResp.json();
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    console.log('[DEX] Gemini raw response text:', text);
                    const start = text.indexOf('{'), end = text.lastIndexOf('}');
                    if (start < 0 || end < 0) return fields;
                    // Clean text: remove literal newlines inside string values that break JSON.parse
                    let jsonStr = text.slice(start, end + 1);
                    // Replace real newlines inside JSON string values with \n
                    jsonStr = jsonStr.replace(/(["]:[ ]*"[^"]*?)\n([^"]*?")/g, function(match) {
                        return match.replace(/\n/g, '\\n');
                    });
                    // More aggressive: just replace all newlines that aren't after a comma or brace
                    jsonStr = jsonStr.replace(/\r?\n/g, '\\n');
                    // But fix the structural ones back
                    jsonStr = jsonStr.replace(/\\n(\s*["{}\[\],])/g, '\n$1');
                    let normalized;
                    try {
                        normalized = JSON.parse(jsonStr);
                    } catch(parseErr) {
                        console.warn('[DEX] JSON.parse failed, attempting line-by-line fix:', parseErr);
                        // Fallback: try to extract key-value pairs with regex
                        normalized = {};
                        const kvRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"?/g;
                        let m;
                        while ((m = kvRegex.exec(text)) !== null) {
                            normalized[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                        }
                        console.log('[DEX] Regex fallback extracted:', Object.keys(normalized));
                    }
                    console.log('[DEX] Gemini normalized keys:', Object.keys(normalized));
                    return Object.entries(normalized).map(([key, value]) => ({ key, value: String(value) }));
                } catch(e) {
                    console.warn('[DEX] Gemini normalize error:', e);
                    return fields;
                }
            },

            _dexAutoDetectHeaderRow: function (aoa, profileFields) {
                // Busca la fila con más celdas no vacías que contenga al menos un alias del perfil
                const allAliases = (profileFields || []).flatMap(f => f.aliases.map(a => a.toLowerCase()));
                let bestRow = 0, bestScore = -1;
                const limit = Math.min(15, aoa.length);
                for (let r = 0; r < limit; r++) {
                    const row = aoa[r];
                    const filled = row.filter(c => String(c).trim() !== '').length;
                    const hits = row.filter(c => {
                        const v = String(c).trim().toLowerCase();
                        return v && allAliases.some(a => v.includes(a) || a.includes(v));
                    }).length;
                    const score = filled + hits * 5;
                    if (score > bestScore) { bestScore = score; bestRow = r; }
                }
                return bestRow;
            },

            _dexDoExport: async function (append, profile) {
                if (typeof XLSX === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('xlsx');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                }
                if (typeof XLSX === 'undefined') { this.showToast('No se pudo preparar la exportación a Excel.'); return; }

                // Obtener campos normalizados (reusa cache compartido con _dexRenderResults)
                let normalizedMap = await this._dexBuildProfileFields(profile);

                // Helpers de coincidencia estricta
                const _normalizeText = (s) => {
                    if (!s) return '';
                    return String(s).trim().toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]/g, '');
                };
                const _getMatchScore = (ocrKey, alias, ocrVal) => {
                    const nKey = _normalizeText(ocrKey);
                    const nAlias = _normalizeText(alias);
                    if (!nKey || !nAlias) return 0;
                    // Coincidencia exacta: máxima prioridad
                    let score = 0;
                    if (nKey === nAlias) score = 100;
                    // Coincidencia parcial: solo si ambos ≥ 3 caracteres
                    else if (nKey.length >= 3 && nAlias.length >= 3) {
                        if (nKey.includes(nAlias)) score = 50 + nAlias.length; // OCR key contiene el alias
                        else if (nAlias.includes(nKey)) score = 50 + nKey.length;   // alias contiene OCR key
                    }
                    if (score > 0 && (!ocrVal || !String(ocrVal).trim())) {
                        score = score * 0.1;
                    }
                    return score;
                };

                let fields = [];
                // Si hay un perfil con campos definidos, mapeamos cada columna del perfil
                if (profile && profile.fields && profile.fields.length) {
                    console.log('[DEX Debug] Mapeando columnas del perfil:', profile.name);
                    fields = profile.fields.map(pf => {
                        const colKey = pf.column.toLowerCase().trim();
                        let val = '';
                        let _ocrKey = '';
                        let _fromGemini = false;
                        
                        // 1. Intentar obtener el valor de la respuesta de Gemini
                        if (normalizedMap && normalizedMap[colKey] !== undefined) {
                            val = normalizedMap[colKey];
                            _fromGemini = true;
                            console.log(`  - Campo [${pf.column}] obtenido de Gemini: "${val}"`);
                        } else {
                            // 2. Fallback: buscar coincidencia puntuada usando aliases en los campos crudos
                            // Incluir el nombre de la columna como alias implícito
                            const allAliases = [...pf.aliases.map(a => a.trim()), pf.column.trim()];
                            let bestScore = 0;
                            let bestField = null;
                            for (const f of this._dexFields) {
                                const fKey = f.key;
                                for (const a of allAliases) {
                                    const score = _getMatchScore(fKey, a, f.value);
                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestField = f;
                                    }
                                }
                            }
                            val = bestField ? bestField.value : '';
                            _ocrKey = bestField ? bestField.key : '';
                            console.log(`  - Campo [${pf.column}] fallback de alias (score: ${bestScore}, match: ${bestField ? bestField.key : 'ninguno'}): "${val}"`);
                        }
                        
                        return { key: pf.column, value: val, _ocrKey: _ocrKey, _fromGemini: _fromGemini };
                    });

                    // Aplicar post-procesamiento: siempre (Gemini puede devolver vacíos para lab/TA/CHOL)
                    if (fields.length) {
                        const _needsPostProcess = !normalizedMap || fields.some(f => !f.value || f.value === '');
                        if (_needsPostProcess) {
                        console.log('[DEX Debug] Aplicando post-procesamiento inteligente...');
                        fields = fields.map(f => {
                            let val = f.value;
                            const _ocrKey = f._ocrKey || '';
                            const normKey = _normalizeText(f.key);
                            
                            // 1. FECHA DE NACIMIENTO
                            if (normKey.includes('nacimiento') || normKey.includes('nac') || normKey.includes('birth')) {
                                const valStr = String(val).trim();
                                const dmaMatch = valStr.match(/^DMA\s*(\d{2})(\d{2})(\d{2})$/i);
                                if (dmaMatch) {
                                    const dd = dmaMatch[1], mm = dmaMatch[2], yy = parseInt(dmaMatch[3], 10);
                                    const yyyy = yy > 30 ? 1900 + yy : 2000 + yy;
                                    val = `${dd}/${mm}/${yyyy}`;
                                    console.log(`[DEX PostProcess] Corrige FECHA DMA: "${f.value}" -> "${val}"`);
                                } else
                                if (valStr.includes('año') || valStr.includes('ano') || valStr.includes('Sexo') || valStr.includes('Edad') || valStr.includes('Genero') || valStr.includes('Identidad')) {
                                    // Extraer edad del valor si está presente (ej. "27 años" o "edad 27")
                                    let age = null;
                                    const ageMatch = valStr.match(/(\d+)\s*(años|anos|edad)/i) || valStr.match(/(edad|age)\s*:?\s*(\d+)/i);
                                    if (ageMatch) {
                                        age = parseInt(ageMatch[1] || ageMatch[2], 10);
                                    }
                                    
                                    // Buscar la fecha en la ocrKey
                                    const dateMatch = _ocrKey.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{1,4})/);
                                    if (dateMatch) {
                                        let day = parseInt(dateMatch[1], 10);
                                        let month = parseInt(dateMatch[2], 10);
                                        let yearStr = dateMatch[3];
                                        let year = parseInt(yearStr, 10);
                                        
                                        if (yearStr.length === 1 && age !== null) {
                                            const d = new Date();
                                            const curYear = d.getFullYear();
                                            const curMonth = d.getMonth() + 1;
                                            const curDay = d.getDate();
                                            
                                            let calcYear = curYear - age;
                                            if (curMonth < month || (curMonth === month && curDay < day)) {
                                                calcYear -= 1;
                                            }
                                            year = calcYear;
                                        } else if (year < 100) {
                                            year = year > 30 ? 1900 + year : 2000 + year;
                                        }
                                        val = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
                                        console.log(`[DEX PostProcess] Corrige FECHA DE NACIMIENTO: "${f.value}" -> "${val}" (ocrKey: "${_ocrKey}")`);
                                    }
                                } // end else DMA
                            }
                            
                            // 2. SEXO
                            if (normKey === 'sexo') {
                                const cleanVal = String(val).toUpperCase().trim();
                                if (cleanVal !== 'MASCULINO' && cleanVal !== 'FEMENINO') {
                                    let detectedSexo = '';
                                    for (const ocrF of this._dexFields) {
                                        const fKeyVal = ((ocrF.key || '') + ' ' + (ocrF.value || '')).toLowerCase();
                                        if (fKeyVal.includes('sexo') || fKeyVal.includes('genero')) {
                                            if (/m\s*[:\[\({]*\s*(x|✓|selected|mark)/i.test(fKeyVal) || 
                                                /m\s*:\s*selected/i.test(fKeyVal) || 
                                                /\bmasculino\b/i.test(fKeyVal) ||
                                                /sexo\s*:\s*[^f]*\bm\b/i.test(fKeyVal) ||
                                                /sexo\s*:\s*f\s*m\s*[:\[]*\s*selected/i.test(fKeyVal)) {
                                                detectedSexo = 'MASCULINO';
                                                break;
                                            }
                                            if (/f\s*[:\[\({]*\s*(x|✓|selected|mark)/i.test(fKeyVal) || 
                                                /f\s*:\s*selected/i.test(fKeyVal) || 
                                                /\bfemenino\b/i.test(fKeyVal) ||
                                                /sexo\s*:\s*f\b/i.test(fKeyVal)) {
                                                detectedSexo = 'FEMENINO';
                                                break;
                                            }
                                        }
                                    }
                                    if (detectedSexo) {
                                        val = detectedSexo;
                                        console.log(`[DEX PostProcess] Corrige SEXO: "${f.value}" -> "${val}"`);
                                    }
                                }
                                const sexoFinal = String(val).toUpperCase().trim();
                                if (sexoFinal === 'FEMENINO') val = 'MUJER';
                                else if (sexoFinal === 'MASCULINO') val = 'HOMBRE';
                            }
                            
                            // 3. PESO
                            if (normKey === 'peso') {
                                const valStr = String(val).trim();
                                if (!valStr || isNaN(parseFloat(valStr))) {
                                    let detectedPeso = '';
                                    for (const ocrF of this._dexFields) {
                                        const combined = ((ocrF.key || '') + ' ' + (ocrF.value || '')).toLowerCase();
                                        const match1 = combined.match(/peso\s*:?\s*(\d+([.,]\d+)?)/i);
                                        if (match1) {
                                            detectedPeso = match1[1];
                                            break;
                                        }
                                        const match2 = combined.match(/(\d+([.,]\d+)?)\s*kg/i);
                                        if (match2) {
                                            detectedPeso = match2[1];
                                            break;
                                        }
                                    }
                                    // Fallback final: buscar en los párrafos raw del layout
                                    if (!detectedPeso && this._dexRawParagraphs) {
                                        for (let idx = 0; idx < this._dexRawParagraphs.length; idx++) {
                                            const pText = this._dexRawParagraphs[idx].toLowerCase();
                                            if (pText.includes('peso') || pText.includes('kg')) {
                                                const matchThis = pText.match(/(\d+([.,]\d+)?)/);
                                                if (matchThis) {
                                                    detectedPeso = matchThis[1];
                                                    break;
                                                } else if (idx + 1 < this._dexRawParagraphs.length) {
                                                    const nextText = this._dexRawParagraphs[idx + 1];
                                                    const matchNext = nextText.match(/^(\d+([.,]\d+)?)/);
                                                    if (matchNext) {
                                                        detectedPeso = matchNext[1];
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (detectedPeso) {
                                        val = detectedPeso;
                                        console.log(`[DEX PostProcess] Corrige PESO: "${f.value}" -> "${val}"`);
                                    }
                                }
                            }
                            
                            // 4. ESTADO CIVIL / EDO CIVIL
                            if (normKey === 'estadocivil' || normKey === 'edocivil') {
                                const valStr = String(val);
                                const hasCheckbox = valStr.includes('_') || /S[A-Z]C[A-Z]/.test(valStr.toUpperCase()) || /selected/i.test(valStr) || /[✓✗x]\s*(C|S|V|UL)/i.test(valStr);
                                if (hasCheckbox) {
                                    // Prioridad 1: "OPCION :selected:" — captura lo que precede al marcador de Azure
                                    const selMatch = valStr.match(/(S(?:oltero)?|C(?:asado)?|UL|U\.?L\.?|V(?:iudo)?)\s*_?\s*:?selected:?/i);
                                    let isSoltero = false, isCasado = false, isUnion = false, isViudo = false;
                                    if (selMatch) {
                                        const m = selMatch[1].toUpperCase().replace(/[^A-Z]/g, '');
                                        isSoltero = m === 'S' || m.startsWith('SOLTERO');
                                        isCasado  = m === 'C' || m.startsWith('CASADO');
                                        isUnion   = m === 'UL';
                                        isViudo   = m === 'V' || m.startsWith('VIUDO');
                                    } else {
                                        // Prioridad 2: marca explícita ✓/x/slash junto a la letra
                                        isSoltero = /\bS\s*[✓x\/]/i.test(valStr);
                                        isCasado  = /\bC\s*[✓x\/]/i.test(valStr);
                                        isUnion   = /\bUL\s*[✓x\/]/i.test(valStr);
                                        isViudo   = /\bV\s*[✓x\/]/i.test(valStr);
                                        // Prioridad 3: carácter no guión/espacio después de la letra (patrón S/ C_ UL_ V_)
                                        if (!isSoltero && !isCasado && !isUnion && !isViudo) {
                                            isSoltero = /\bS[^_\s\bCV]/.test(valStr);
                                            isCasado  = /\bC[^_\s\bUV]/.test(valStr);
                                            isUnion   = /\bUL[^_\s]/.test(valStr);
                                            isViudo   = /\bV[^_\s\bCU]/.test(valStr);
                                        }
                                    }
                                    let newVal = val;
                                    if (isSoltero) newVal = 'SOLTERO (A)';
                                    else if (isCasado) newVal = 'CASADO (A)';
                                    else if (isUnion) newVal = 'UNION LIBRE';
                                    else if (isViudo) newVal = 'VIUDO (A)';
                                    if (newVal !== f.value) {
                                        console.log(`[DEX PostProcess] Corrige EDO CIVIL: "${f.value}" -> "${newVal}"`);
                                        val = newVal;
                                    }
                                }
                            }
                            
                            // 5. TALLA/ESTATURA
                            if (normKey === 'talla' || normKey === 'estatura' || normKey === 'altura') {
                                const valStr = String(val).replace(',', '.');
                                const numVal = parseFloat(valStr);
                                if (!isNaN(numVal) && numVal >= 100) {
                                    val = String(numVal / 100);
                                    console.log(`[DEX PostProcess] Corrige TALLA: "${f.value}" -> "${val}"`);
                                }
                            }
                            
                            // 5b. LAB VALUES — buscar en _dexFields cuando el valor está vacío o es N/A
                            // Cubre CHOL, TRIG, GLUC, AC URICO, Hemoglobina Glucosilada, Audiometría, Espirometría, TA
                            const _labNk = normKey.replace(/[^a-z]/g, '');
                            // Pre-limpieza: ESPIROMETRIA con valor inválido (leyenda larga) → forzar vacío
                            const VALID_ESPIRO = /^(normal|patron|obstructivo|restrictivo|limites normales)/i;
                            if (_labNk === 'espirometria' && val && !VALID_ESPIRO.test(String(val).trim())) {
                                val = '';
                            }
                            const _isLabEmpty = (!val || val === '' || val === '—' || val === '--' || String(val).toUpperCase() === 'N/A');
                            if (_isLabEmpty && this._dexFields) {
                                // Normaliza acentos: "triglicéridos" → "trigliceridos"
                                const _stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                const labMap = {
                                    'chol':               ['chol', 'colesterol total', 'colesterol'],
                                    'colesterol':         ['chol', 'colesterol total', 'colesterol'],
                                    'trig':               ['trig', 'trigliceridos', 'triglicerido', 'tg'],
                                    'trigliceridos':      ['trig', 'trigliceridos', 'triglicerido', 'tg'],
                                    'gluc':               ['gluc', 'glucosa basal', 'glucosa en ayuno', 'glucosa', 'glicemia'],
                                    'glucosa':            ['gluc', 'glucosa basal', 'glucosa en ayuno', 'glucosa', 'glicemia'],
                                    'acurico':            ['acido urico', 'acido uri', 'a. urico', 'a urico', 'ac urico', 'a. uric', 'acid uric', 'au', 'urico'],
                                    'hemoglobinaglucosilada': ['hb a1c', 'hba1c', 'hemoglobina glicada', 'hemoglobina glucosilada', 'hemoglobina glicosilada', 'hemoglobina', 'glucosilada', 'glicosilada'],
                                    'ta':                 ['p.a.', 'pa:', ' pa ', 'presion arterial', 'tension arterial'],
                                    'oidoderecho':        ['oido derecho', 'auditivo derecho', 'audiometria derecho', 'od:'],
                                    'oidoizquierdo':      ['oido izquierdo', 'auditivo izquierdo', 'audiometria izquierdo', 'oi:'],
                                    'espirometria':       ['espirometria', 'spirometry', 'patron', 'flujo'],
                                };
                                const nk = _labNk;
                                const keywords = labMap[nk];
                                if (keywords) {
                                    console.log(`[DEX LabMap] Buscando "${nk}" en ${this._dexFields.length} fields. Keywords: ${keywords.join(', ')}`);
                                    for (const of_ of this._dexFields) {
                                        // Normalización: minúsculas + sin acentos (NFD)
                                        const combined = _stripAccents(((of_.key||'') + ' ' + (of_.value||'')).toLowerCase());
                                        const matches = keywords.some(kw => {
                                        if (kw.length <= 3) {
                                            const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                            const startB = /[a-z0-9]/i.test(kw[0]) ? '\\b' : '';
                                            const endB = /[a-z0-9]/i.test(kw[kw.length - 1]) ? '\\b' : '';
                                            return new RegExp(`${startB}${esc}${endB}`, 'i').test(combined);
                                        }
                                        return combined.includes(kw);
                                    });
                                        if (!matches) continue;
                                        const rawVal = String(of_.value || '').trim();
                                        const numMatch = rawVal.match(/[*]?([\d]+(?:[.,]\d+)?)/);
                                        const isTextResult = nk.includes('oido') || nk === 'espirometria';
                                        const isTa = nk === 'ta';
                                        if (isTa) {
                                            // Buscar patrón NNN/NN o NNN/NNN en key+value combinado
                                            const taMatch = combined.match(/(\d{2,3})\s*[\/\\]\s*(\d{2,3})/);
                                            if (taMatch) {
                                                val = taMatch[1] + '/' + taMatch[2];
                                                console.log(`[DEX PostProcess] TA: -> "${val}" (from: ${of_.key}=${of_.value})`);
                                                break;
                                            }
                                        } else if (isTextResult) {
                                            const VALID_AUDIO = /normoacusia|hipoacusia|normal|bilateral|unilateral|dentro\s*de\s*l[ií]mites|sin\s*alteraci/i;
                                            if ((nk === 'oidoderecho' || nk === 'oidoizquierdo') && !VALID_AUDIO.test(rawVal)) {
                                                console.log(`[DEX PostProcess] ${nk}: descartado valor no-audiométrico: "${rawVal}"`);
                                                continue;
                                            }
                                            if (nk === 'espirometria' && !VALID_ESPIRO.test(rawVal)) continue;
                                            if (rawVal.length > 2 && rawVal.length < 80 && !/^(key|campo|field)$/i.test(rawVal)) {
                                                val = rawVal.replace(/\*/, '').trim();
                                                console.log(`[DEX PostProcess] Lab ${nk}: -> "${val}" (from: ${of_.key}=${of_.value})`);
                                                break;
                                            }
                                        } else if (numMatch) {
                                            val = numMatch[1].replace(',', '.');
                                            console.log(`[DEX PostProcess] Lab ${nk}: -> "${val}" (from: ${of_.key}=${of_.value})`);
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            // 6. ESCOLARIDAD
                            if ((normKey === 'escolaridad' || normKey === 'niveldeestudios' || normKey === 'estudios') && !f._fromGemini) {
                                // Contexto ampliado: unir todos los campos OCR que mencionen opciones educativas
                                let escCtx = String(val);
                                if (this._dexFields) {
                                    const more = this._dexFields
                                        .filter(of => /escolaridad|basica|universidad|tecnica|postgrado|bachiller|media/i.test((of.key||'') + ' ' + (of.value||'')))
                                        .map(of => (of.key||'') + ' ' + (of.value||'')).join(' ');
                                    if (more.length > escCtx.length) escCtx = more;
                                }
                                const optCount = ['basica','media','tecnica','universidad','postgrado'].filter(o => escCtx.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(o)).length;
                                if (optCount >= 1) {
                                    // Detectar "OPCION :selected:" de Azure
                                    // Azure puede poner :selected: antes o después de la opción marcada
                                    // Intentar ambos: "OPCION :selected:" y ":selected: OPCION" 
                                    const azSel = escCtx.match(/(b[aá]sica|media|t[eé]cnica|universidad|bachiller|postgrado)\s*:?selected:?/i)
                                               || escCtx.match(/:?selected:?\s*(b[aá]sica|media|t[eé]cnica|universidad|bachiller|postgrado)/i);
                                    let isB=false,isM=false,isT=false,isU=false,isP=false;
                                    if (azSel) {
                                        const m = azSel[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
                                        isB=m.includes('basica'); isM=m.includes('media'); isT=m.includes('tecnica'); isU=m.includes('universidad'); isP=m.includes('postgrado');
                                    } else {
                                        // Detectar marca explícita ✓/x/:selected:
                                        const MK = '[\\s:_\\[({]*\\s*(x|\u2713|\u2717|[\\/\\\\]|:selected:)\\b';
                                        isB = new RegExp('b[a\u00e1]sica'+MK,'i').test(escCtx);
                                        isM = new RegExp('media'+MK,'i').test(escCtx);
                                        isT = new RegExp('t[e\u00e9]cnica'+MK,'i').test(escCtx);
                                        isU = new RegExp('universidad'+MK,'i').test(escCtx);
                                        isP = new RegExp('postgrad[oo]'+MK,'i').test(escCtx);
                                    }
                                    let newVal = val;
                                    if (isU) newVal = 'LICENCIATURA';
                                    else if (isT) newVal = 'TECNICO';
                                    else if (isM) newVal = 'MEDIA';
                                    else if (isB) newVal = 'B\u00c1SICA';
                                    else if (isP) newVal = 'POSTGRADO';
                                    if (newVal !== f.value) {
                                        console.log(`[DEX PostProcess] Corrige ESCOLARIDAD: "${f.value}" -> "${newVal}"`);
                                        val = newVal;
                                    }
                                }
                            }
                            
                            // 7. NOMBRE — concatenar si Azure separó en ApellidoPaterno/Materno/Nombre(s)
                            if (normKey === 'nombre' || normKey === 'nombredelcolaborador' || normKey === 'nombrecompleto' || normKey === 'paciente') {
                                const nameOrder = (profile && profile.nameOrder) ? profile.nameOrder : 'nombre_apellidos';
                                val = String(val).replace(/\s{2,}/g, ' ').trim();
                                const parts = val.split(/\s+/).filter(Boolean);

                                if (this._dexFields) {
                                    // Primero: buscar campo "Paciente" o "Nombre completo" con valor de ≥2 palabras
                                    const fullNameField = this._dexFields.find(of_ => {
                                        const k = (of_.key || '').toLowerCase();
                                        const v = String(of_.value || '').trim();
                                        return /^paciente$|nombre\s*completo|nombre\s*del\s*(paciente|trabajador|colaborador)/i.test(k) && v.split(/\s+/).length >= 2;
                                    });
                                    if (fullNameField) {
                                        const fullName = String(fullNameField.value).replace(/\s{2,}/g,' ').trim();
                                        if (fullName.toUpperCase() !== val.toUpperCase()) {
                                            console.log(`[DEX PostProcess] NOMBRE completo desde campo "${fullNameField.key}": "${val}" -> "${fullName}"`);
                                            val = fullName;
                                        }
                                    } else {
                                        // Segundo: ensamblar desde ApellidoPaterno/Materno/Nombre(s)
                                        let ap1='', ap2='', nom='';
                                        for (const of_ of this._dexFields) {
                                            const k = of_.key || '';
                                            const v = String(of_.value || '').replace(/\s{2,}/g,' ').trim();
                                            if (!v) continue; // solo saltar vacíos, no por valor igual al parcial
                                            if (/apellido\s*p|paterno/i.test(k))                          ap1 = v;
                                            else if (/apellido\s*m|materno/i.test(k))                     ap2 = v;
                                            else if (/\bnombre[s(]*s?[)]*\s*$|nombre\s*propio|first\s*name/i.test(k) && !/apellido/i.test(k)) nom = v;
                                        }
                                        if ([ap1,ap2,nom].filter(Boolean).length >= 2) {
                                            const assembled = nameOrder === 'nombre_apellidos'
                                                ? [nom, ap1, ap2].filter(Boolean).join(' ')
                                                : [ap1, ap2, nom].filter(Boolean).join(' ');
                                            if (assembled.trim() && assembled.trim().toUpperCase() !== val.toUpperCase()) {
                                                console.log(`[DEX PostProcess] Ensambla NOMBRE: "${val}" -> "${assembled}"`);
                                                val = assembled;
                                            }
                                        } else if (parts.length >= 3 && nameOrder === 'nombre_apellidos' && !f._fromGemini) {
                                            const last = parts.pop();
                                            val = last + ' ' + parts.join(' ');
                                            console.log(`[DEX PostProcess] Reordena NOMBRE: "${String(f.value)}" -> "${val}"`);
                                        }
                                    }
                                }
                            }
                            
                            return { key: f.key, value: val, _ocrKey: _ocrKey };
                        });
                        } // end _needsPostProcess
                    } // end fields.length
                } else {
                    // Si no hay perfil o no tiene campos, usamos lo que Gemini normalizó o los campos crudos
                    console.log('[DEX Debug] No hay campos definidos en el perfil. Usando campos de Gemini o crudos.');
                    if (normalizedMap) {
                        fields = Object.entries(normalizedMap).map(([key, value]) => ({ key, value }));
                    } else {
                        fields = this._dexFields.map(f => ({ key: f.key, value: f.value }));
                    }
                }

                // Combinar fields y staticFields
                const allFields = [...fields];
                if (profile && profile.staticFields) {
                    profile.staticFields.forEach(sf => {
                        if (sf.column && sf.value !== undefined) {
                            let val = sf.value;
                            if (val === '@HOY' || val === '@TODAY' || val === '=HOY()' || val === '=TODAY()') {
                                const d = new Date();
                                const dd = String(d.getDate()).padStart(2, '0');
                                const mm = String(d.getMonth()+1).padStart(2, '0');
                                const yyyy = d.getFullYear();
                                val = `${dd}/${mm}/${yyyy}`;
                            }
                            const idx = allFields.findIndex(x => x.key.toLowerCase().trim() === sf.column.toLowerCase().trim());
                            if (idx >= 0) {
                                allFields[idx].value = val;
                            } else {
                                allFields.push({ key: sf.column, value: val });
                            }
                            console.log(`[DEX Debug] Inyectado campo estático [${sf.column}]: "${val}"`);
                        }
                    });
                }

                if (!append) {
                    // Exportar nuevo Excel
                    const doDirectDownload = async () => {
                        if (typeof XLSX === 'undefined') {
                            if (this.lazyLoad) await this.lazyLoad('xlsx');
                            else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                        }
                        const wb = XLSX.utils.book_new();
                        const row = {};
                        allFields.forEach(f => { row[f.key] = this._dexParseValue(f.value, f.key); });
                        const ws = XLSX.utils.json_to_sheet([row]);
                        XLSX.utils.book_append_sheet(wb, ws, profile ? (profile.name || 'Datos').slice(0,31) : 'Extracción');
                        const fname = 'extraccion_' + new Date().toISOString().slice(0,10) + '.xlsx';
                        XLSX.writeFile(wb, fname);
                        this.showToast('✅ Excel exportado: ' + fname);
                    };
                    doDirectDownload();
                    return;
                }

                // Append al Excel vinculado
                const stored = (profile && profile.id)
                    ? (() => { try { return JSON.parse(localStorage.getItem('dex_xl_' + profile.id)); } catch { return null; } })()
                    : null;

                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';

                const doAppend = async (stored) => {
                    if (typeof XLSX === 'undefined') {
                        if (this.lazyLoad) await this.lazyLoad('xlsx');
                        else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                    }
                    try {
                        const sheetName = stored.sheet || (profile && profile.sheet) || '';
                        console.log('[DEX Debug] Iniciando exportación/append:', {
                            path: stored.path || '(sin ruta local)',
                            sheetName: sheetName || '(primera hoja)',
                            headerRow: stored.headerRow || profile.headerRow || 1,
                            allFields: allFields
                        });

                        // Si hay path de disco, intentamos escribir directamente via openpyxl
                        if (stored.path) {
                            try {
                                const rowData = {};
                                allFields.forEach(f => {
                                    rowData[f.key] = f.value;
                                });

                                console.log('[DEX Debug] Enviando a /excel/write-openpyxl...', {
                                    path: stored.path, sheet: sheetName,
                                    headerRow: stored.headerRow || profile.headerRow || 1,
                                    rowDataKeys: Object.keys(rowData),
                                    rowDataSample: Object.fromEntries(Object.entries(rowData).slice(0, 5))
                                });
                                const writeRes = await fetch(`${PROXY_BASE}/excel/write-openpyxl`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        path: stored.path,
                                        sheet: sheetName,
                                        headerRow: stored.headerRow || profile.headerRow || 1,
                                        rowData: rowData
                                    })
                                });
                                const writeJ = await writeRes.json();
                                if (writeJ.ok) {
                                    console.log('[DEX Debug] Éxito al escribir via openpyxl:', writeJ);
                                    this.showToast('Fila ' + writeJ.row + ' guardada en Excel.');
                                    // Actualizar stored.data en segundo plano
                                    try {
                                        console.log('[DEX Debug] Actualizando binData en localStorage...');
                                        const readR = await fetch(`${PROXY_BASE}/excel/read-file`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ path: stored.path })
                                        });
                                        const readJ = await readR.json();
                                        if (readJ.data_base64) {
                                            stored.data = atob(readJ.data_base64);
                                            localStorage.setItem('dex_xl_' + profile.id, JSON.stringify(stored));
                                            console.log('[DEX Debug] binData actualizado exitosamente.');
                                        }
                                    } catch(e) {
                                        console.warn('[DEX Debug] Error al actualizar binData en segundo plano:', e);
                                    }
                                    return;
                                } else {
                                    throw new Error(writeJ.error || 'Error en backend');
                                }
                            } catch(openpyxlErr) {
                                console.warn('[DEX] openpyxl write falló, intentando SheetJS fallback:', openpyxlErr);
                            }
                        }

                        // Fallback con SheetJS
                        console.log('[DEX Debug] Iniciando fallback con SheetJS...');
                        let binData = stored.data;
                        if (!binData && stored.path) {
                            try {
                                console.log('[DEX Debug] binData ausente, leyendo del disco via /excel/read-file...');
                                const readR = await fetch(`${PROXY_BASE}/excel/read-file`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ path: stored.path })
                                });
                                const readJ = await readR.json();
                                if (readJ.data_base64) {
                                    binData = atob(readJ.data_base64);
                                    stored.data = binData;
                                    localStorage.setItem('dex_xl_' + profile.id, JSON.stringify(stored));
                                    console.log('[DEX Debug] Leído binData del disco para fallback.');
                                }
                            } catch(e) {
                                console.error('[DEX] Fallback data read error:', e);
                            }
                        }
                        if (!binData) throw new Error('No hay datos binarios del Excel en memoria.');
                        const wb = XLSX.read(binData, { type: 'binary' });
                        const resolvedSheetName = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
                        const ws = wb.Sheets[resolvedSheetName];

                        // Leer hoja como array de arrays
                        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                        const configuredRow = stored.headerRow ? parseInt(stored.headerRow)
                            : (profile && profile.headerRow ? parseInt(profile.headerRow) : 0);
                        const headerRow0 = configuredRow > 0
                            ? configuredRow - 1
                            : this._dexAutoDetectHeaderRow(aoa, profile ? profile.fields : null);
                        
                        console.log('[DEX Debug] SheetJS Fallback - Fila de cabecera detectada en index:', headerRow0);
                        if (aoa.length <= headerRow0) { this.showToast('❌ Hoja sin filas suficientes.'); return; }
                        const headers = aoa[headerRow0].map(h => String(h).trim());
                        console.log('[DEX Debug] SheetJS Fallback - Cabeceras de columna:', headers);

                        // Encontrar columna NOMBRE para detectar siguiente fila vacía
                        const nombreCol = headers.findIndex(h => /^nombre$/i.test(h));
                        let nextRow = aoa.length;
                        if (nombreCol >= 0) {
                            for (let r = headerRow0 + 1; r < aoa.length; r++) {
                                const cellVal = aoa[r][nombreCol];
                                if (cellVal === '' || cellVal === null || cellVal === undefined) {
                                    nextRow = r;
                                    break;
                                }
                            }
                        }

                        // Helper para limpiar strings en JS
                        const cleanStrJS = (s) => {
                            if (!s) return "";
                            return String(s).trim().toLowerCase()
                                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                .replace(/[^a-z0-9]/g, "");
                        };

                        // Construir nueva fila según encabezados
                        const newRow = new Array(headers.length).fill('');
                        allFields.forEach(f => {
                            const normKey = cleanStrJS(f.key);
                            const colIdx = headers.findIndex(h => cleanStrJS(h) === normKey);
                            if (colIdx >= 0) {
                                newRow[colIdx] = this._dexParseValue(f.value, f.key);
                                console.log(`[DEX Debug] SheetJS Fallback - Escrito campo '${f.key}' en Col ${colIdx+1} ('${headers[colIdx]}')`);
                            } else {
                                console.log(`[DEX Debug] SheetJS Fallback - Campo '${f.key}' sin columna correspondiente.`);
                            }
                        });

                        // FECHA DE ATENCION → fecha de hoy
                        const fechaAtIdx = headers.findIndex(h => {
                            const normH = cleanStrJS(h);
                            return normH.includes('fecha') && (normH.includes('atencion') || normH.includes('servicio'));
                        });
                        if (fechaAtIdx >= 0) {
                            newRow[fechaAtIdx] = new Date();
                            console.log(`[DEX Debug] SheetJS Fallback - Auto-completada fecha de atención en Col ${fechaAtIdx+1}`);
                        }

                        // Insertar en aoa
                        if (nextRow >= aoa.length) {
                            aoa.push(newRow);
                        } else {
                            aoa[nextRow] = newRow;
                        }
                        console.log('[DEX Debug] SheetJS Fallback - Insertado en fila:', nextRow + 1);

                        // Reconstruir worksheet preservando filas anteriores
                        const newWs = XLSX.utils.aoa_to_sheet(aoa);

                        if (ws['!merges']) newWs['!merges'] = ws['!merges'];
                        if (ws['!cols'])   newWs['!cols']   = ws['!cols'];
                        if (ws['!rows'])   newWs['!rows']   = ws['!rows'];

                        wb.Sheets[resolvedSheetName] = newWs;

                        const colLetter = (n) => { let s=''; while(n>=0){s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;} return s; };
                        allFields.forEach(f => {
                            const normKey = cleanStrJS(f.key);
                            const colIdx = headers.findIndex(h => cleanStrJS(h) === normKey);
                            if (colIdx < 0) return;
                            const parsed = this._dexParseValue(f.value, f.key);
                            if (parsed instanceof Date) {
                                const cellRef = colLetter(colIdx) + (nextRow + 1);
                                if (newWs[cellRef]) newWs[cellRef].z = 'dd/mm/yyyy';
                            }
                        });
                        if (fechaAtIdx >= 0) {
                            const cellRef = colLetter(fechaAtIdx) + (nextRow + 1);
                            if (newWs[cellRef]) newWs[cellRef].z = 'dd/mm/yyyy';
                        }

                        const bookType = (stored.name || '').toLowerCase().endsWith('.xlsm') ? 'xlsm' : 'xlsx';
                        const newBin = XLSX.write(wb, { type: 'binary', bookType });
                        stored.data = newBin;
                        localStorage.setItem('dex_xl_' + profile.id, JSON.stringify(stored));

                        if (stored.path) {
                            const _isCloud = ['onedrive','sharepoint','teams'].some(kw => stored.path.toLowerCase().includes(kw));
                            try {
                                if (_isCloud) {
                                    // Para rutas cloud: re-intentar con openpyxl (evita bloqueo SharePoint)
                                    console.log('[DEX Debug] Path cloud detectado, usando write-openpyxl para fallback...');
                                    const rowData2 = {};
                                    allFields.forEach(f2 => { rowData2[f2.key] = f2.value; });
                                    const wr2 = await fetch(`${PROXY_BASE}/excel/write-openpyxl`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            path: stored.path,
                                            sheet: resolvedSheetName,
                                            header_row: headerRow0 + 1,
                                            data: rowData2
                                        })
                                    });
                                    const wr2J = await wr2.json();
                                    if (wr2J.ok) {
                                        this.showToast('✅ Guardado (cloud) fila ' + wr2J.row + ' en "' + wr2J.sheet + '"');
                                        return;
                                    }
                                    throw new Error(wr2J.error || 'Error openpyxl cloud');
                                }
                                // Ruta local: write-direct (bytes SheetJS)
                                console.log('[DEX Debug] Guardando fallback via /excel/write-direct...');
                                const u8arr = new Uint8Array(newBin.length);
                                for (let i = 0; i < newBin.length; i++) u8arr[i] = newBin.charCodeAt(i) & 0xff;
                                let b64 = ''; const CHUNK = 8192;
                                for (let i = 0; i < u8arr.length; i += CHUNK)
                                    b64 += btoa(String.fromCharCode(...u8arr.subarray(i, i + CHUNK)));
                                const wr = await fetch(`${PROXY_BASE}/excel/write-direct`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ path: stored.path, data_base64: b64 })
                                });
                                const wrJ = await wr.json();
                                if (wrJ.ok) {
                                    console.log('[DEX Debug] Fallback guardado exitosamente.');
                                    this.showToast('✅ Guardado en disco: fila ' + (nextRow+1) + ' en "' + resolvedSheetName + '"');
                                } else {
                                    throw new Error(wrJ.error || 'Error desconocido');
                                }
                            } catch(writeErr) {
                                console.error('[DEX] Escritura a disco falló, descargando:', writeErr);
                                XLSX.writeFile(wb, stored.name);
                                this.showToast('⚠️ No se pudo escribir al disco, se descargó el archivo.');
                            }
                        } else {
                            XLSX.writeFile(wb, stored.name);
                            this.showToast('✅ Fila ' + (nextRow+1) + ' exportada en ' + stored.name);
                        }
                    } catch(err) {
                        console.error('[DEX] ❌ Error en doAppend:', err);
                        this.showToast('❌ Error: ' + err.message);
                    }
                };

                if (stored) {
                    doAppend(stored);
                    return;
                }

                // Sin archivo vinculado → picker
                console.log('[DEX Debug] Sin archivo vinculado en almacenamiento local, abriendo selector de archivo navegador.');
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = '.xlsx,.xls';
                inp.onchange = e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const tmpStored = { name: file.name, data: ev.target.result };
                        doAppend(tmpStored);
                    };
                    reader.readAsBinaryString(file);
                };
                inp.click();
            },

            // — Perfiles —
            _dexRenderProfilesList: function () {
                const el = document.getElementById('dex-profiles-list');
                if (!el) return;
                const defId = localStorage.getItem('dex_default_profile');
                if (!this._dexProfiles.length) {
                    el.innerHTML = '<p style="color:#475569; font-size:12px; text-align:center; padding:20px 0;">Sin perfiles. Crea uno con el botón + Nuevo perfil.</p>';
                    return;
                }
                el.innerHTML = this._dexProfiles.map((p) => `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.03); border:1px solid ${p.id===defId?'rgba(250,204,21,0.4)':'rgba(255,255,255,0.07)'}; border-radius:7px; margin-bottom:6px;">
                        <div>
                            <span style="font-size:12px; color:#e2e8f0;">${p.id===defId?'<span style="color:#facc15;">★</span> ':''}${this._esc(p.name)} <span style="color:#475569;">(${p.fields ? p.fields.length : 0} campos)</span></span>
                            ${p.excelFileName ? `<br><span style="font-size:10px; color:#4ade80;">📎 ${this._esc(p.excelFileName)}</span>` : ''}
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button onclick="app.dexSetDefault('${p.id}')" title="${p.id===defId?'Quitar predeterminado':'Marcar como predeterminado'}" style="font-size:13px; background:${p.id===defId?'rgba(250,204,21,0.15)':'rgba(255,255,255,0.04)'}; border:1px solid ${p.id===defId?'rgba(250,204,21,0.3)':'rgba(255,255,255,0.1)'}; border-radius:4px; color:${p.id===defId?'#facc15':'#94a3b8'}; padding:3px 8px; cursor:pointer;">★</button>
                            <button onclick="app.dexEditProfile('${p.id}')" style="font-size:11px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:#94a3b8; padding:3px 8px; cursor:pointer;">Editar</button>
                            <button onclick="app.dexDuplicateProfile('${p.id}')" style="font-size:11px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2); border-radius:4px; color:#93c5fd; padding:3px 8px; cursor:pointer;">Duplicar</button>
                            <button onclick="app.dexDeleteProfile('${p.id}')" style="font-size:11px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:4px; color:#f87171; padding:3px 8px; cursor:pointer;">✕</button>
                        </div>
                    </div>`).join('');
            },

            dexNewProfile: function () {
                this._dexEditingProfileId = crypto.randomUUID();
                document.getElementById('dex-pe-name').value = '';
                const no = document.getElementById('dex-pe-nameorder');
                if (no) no.value = 'nombre_apellidos';
                const dt = document.getElementById('dex-pe-doctype');
                if (dt) dt.value = 'medico';
                const hr = document.getElementById('dex-pe-headerrow');
                if (hr) hr.value = '1';
                const xn = document.getElementById('dex-pe-excelname');
                if (xn) xn.textContent = 'Sin archivo vinculado';
                const xp = document.getElementById('dex-pe-excelpath');
                if (xp) xp.value = '';
                document.getElementById('dex-pe-fields').innerHTML = '';
                const staticCont = document.getElementById('dex-pe-static-fields');
                if (staticCont) staticCont.innerHTML = '';
                document.getElementById('dex-profile-editor').style.display = 'block';
            },

            dexEditProfile: async function (id) {
                const p = this._dexProfiles.find(x => x.id === id);
                if (!p) return;
                this._dexEditingProfileId = id;
                document.getElementById('dex-pe-name').value = p.name || '';
                const no = document.getElementById('dex-pe-nameorder');
                if (no) no.value = p.nameOrder || 'nombre_apellidos';
                const dt = document.getElementById('dex-pe-doctype');
                if (dt) dt.value = p.docType || 'medico';
                const hr = document.getElementById('dex-pe-headerrow');
                if (hr) hr.value = p.headerRow || 1;
                const xn = document.getElementById('dex-pe-excelname');
                const xp = document.getElementById('dex-pe-excelpath');
                const stored = (() => { try { return JSON.parse(localStorage.getItem('dex_xl_' + id)); } catch { return null; } })();
                if (xn) xn.textContent = stored ? stored.name + (stored.path ? ' 📁' : ' (descarga)') : 'Sin archivo vinculado';
                if (xp) xp.value = (stored && stored.path) ? stored.path : '';
                // Restaurar selector de hoja
                if (stored) {
                    try {
                        let sheetNames = [];
                        if (stored.path) {
                            const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';
                            const r = await fetch(`${PROXY_BASE}/excel/sheets`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path: stored.path })
                            });
                            const j = await r.json();
                            sheetNames = j.sheets || [];
                        } else if (stored.data) {
                            if (typeof XLSX === 'undefined') {
                                if (app.lazyLoad) await app.lazyLoad('xlsx');
                                else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                            }
                            const wb = XLSX.read(stored.data, { type: 'binary' });
                            sheetNames = wb.SheetNames || [];
                        }
                        if (sheetNames.length) {
                            const row = document.getElementById('dex-pe-sheet-row');
                            const sel = document.getElementById('dex-pe-sheet-select');
                            if (row && sel) {
                                sel.innerHTML = sheetNames.map(s => `<option value="${s}">${s}</option>`).join('');
                                if (stored.sheet && sheetNames.includes(stored.sheet)) sel.value = stored.sheet;
                                row.style.display = 'block';
                                this._dexPeOnSheetChange();
                            }
                        }
                    } catch(e) {
                        console.warn('[DEX] dexEditProfile sheets load error:', e);
                    }
                } else {
                    const row = document.getElementById('dex-pe-sheet-row');
                    if (row) row.style.display = 'none';
                }
                const cont = document.getElementById('dex-pe-fields');
                cont.innerHTML = '';
                (p.fields || []).forEach(f => this._dexPeAddFieldRow(f.aliases ? f.aliases.join(', ') : '', f.column || ''));
                
                const staticCont = document.getElementById('dex-pe-static-fields');
                if (staticCont) {
                    staticCont.innerHTML = '';
                    (p.staticFields || []).forEach(sf => this._dexPeAddStaticFieldRow(sf.column || '', sf.value || ''));
                }
                document.getElementById('dex-profile-editor').style.display = 'block';
            },

            dexDeleteProfile: function (id) {
                this._dexProfiles = this._dexProfiles.filter(p => p.id !== id);
                localStorage.removeItem('dex_xl_' + id);
                if (localStorage.getItem('dex_default_profile') === id) localStorage.removeItem('dex_default_profile');
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                this._dexRenderProfilesList();
                this._dexRenderProfileSelect();
            },

            dexDuplicateProfile: function (id) {
                const p = this._dexProfiles.find(x => x.id === id);
                if (!p) return;
                const copy = JSON.parse(JSON.stringify(p));
                copy.id = crypto.randomUUID();
                copy.name = p.name + ' (copia)';
                copy.excelFileName = '';
                this._dexProfiles.push(copy);
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                this._dexRenderProfilesList();
                this._dexRenderProfileSelect();
                this.showToast('✅ Perfil duplicado.');
            },

            dexVincularExcel: async function () {
                const pid = this._dexEditingProfileId;
                if (!pid) { this.showToast('⚠️ Error: sin ID de perfil.'); return; }

                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';

                const loadAndShowSheets = async (binStr, name, diskPath) => {
                    try {
                        const wb = XLSX.read(binStr, { type: 'binary' });
                        const stored = { name, data: binStr, path: diskPath, sheet: '', headerRow: 7 };
                        localStorage.setItem('dex_xl_' + pid, JSON.stringify(stored));
                        const xn = document.getElementById('dex-pe-excelname');
                        if (xn) xn.textContent = name + (diskPath ? ' 📁' : ' (descarga)');
                        const xp = document.getElementById('dex-pe-excelpath');
                        if (xp && diskPath) xp.value = diskPath;
                        this._dexPePopulateSheets(wb, stored);
                        this.showToast('✅ Excel vinculado: ' + name);
                    } catch(err) { this.showToast('❌ Error al procesar Excel: ' + err.message); }
                };

                // Crear file picker y clickearlo SINCRÓNICAMENTE antes de cualquier await
                // para preservar la activación de usuario del navegador.
                let proxyWon = false;
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xls';
                inp.style.display = 'none';
                document.body.appendChild(inp);
                inp.onchange = e => {
                    inp.remove();
                    if (proxyWon) return;
                    const file = e.target.files[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => loadAndShowSheets(ev.target.result, file.name, '');
                    reader.readAsBinaryString(file);
                };
                inp.click();

                // En paralelo: diálogo nativo via proxy (bloquea hasta que usuario elija/cancele)
                let diskPath = '';
                try {
                    const r = await fetch(`${PROXY_BASE}/excel/browse`, { method: 'POST' });
                    const j = await r.json();
                    diskPath = j.path || '';
                } catch(e) {}

                if (diskPath) {
                    proxyWon = true;
                    inp.remove();
                    try {
                        const readR = await fetch(`${PROXY_BASE}/excel/read-file`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: diskPath })
                        });
                        const readJ = await readR.json();
                        if (!readJ.data_base64) throw new Error(readJ.error || 'Sin datos');
                        const binStr = atob(readJ.data_base64);
                        await loadAndShowSheets(binStr, readJ.name || diskPath.split(/[\\/]/).pop(), diskPath);
                    } catch(err) { this.showToast('❌ Error al leer: ' + err.message); }
                }
                // Sin ruta de proxy: el onchange del file picker maneja la selección del usuario.
                // inp.remove() se llama dentro del onchange.
            },

            _dexPePopulateSheets: function (wb, stored) {
                const row = document.getElementById('dex-pe-sheet-row');
                const sel = document.getElementById('dex-pe-sheet-select');
                const preview = document.getElementById('dex-pe-header-preview');
                if (!row || !sel) return;
                sel.innerHTML = wb.SheetNames.map(s => `<option value="${s}">${s}</option>`).join('');
                if (stored.sheet && wb.SheetNames.includes(stored.sheet)) sel.value = stored.sheet;
                row.style.display = 'block';
                this._dexPeOnSheetChange();
            },

            _dexPeOnSheetChange: function () {
                const pid = this._dexEditingProfileId; if (!pid) return;
                const sel = document.getElementById('dex-pe-sheet-select');
                const preview = document.getElementById('dex-pe-header-preview');
                if (!sel) return;
                const sheetName = sel.value;
                // Actualizar stored — SIEMPRE persistir hoja/headerRow
                try {
                    const stored = JSON.parse(localStorage.getItem('dex_xl_' + pid));
                    if (!stored) return;
                    stored.sheet = sheetName;

                    // Intentar leer cabeceras para preview (puede fallar si data está vacío)
                    let hRow = 0;
                    try {
                        if (stored.data) {
                            const wb = XLSX.read(stored.data, { type: 'binary' });
                            const ws = wb.Sheets[sheetName];
                            if (ws) {
                                const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                                const profile = this._dexProfiles.find(p => p.id === pid);
                                hRow = this._dexAutoDetectHeaderRow(aoa, profile ? profile.fields : null);
                                const headers = aoa[hRow] ? aoa[hRow].filter(h => String(h).trim()).slice(0, 8) : [];
                                if (preview) preview.textContent = 'Fila ' + (hRow+1) + ': ' + headers.join(', ') + (aoa[hRow] && aoa[hRow].filter(h=>h).length > 8 ? '…' : '');
                            }
                        } else if (preview) {
                            // Sin datos binarios (solo ruta): leer headerRow del input del editor
                            const hrInput = document.getElementById('dex-pe-headerrow');
                            if (hrInput) hRow = Math.max(0, parseInt(hrInput.value || '1') - 1);
                            preview.textContent = 'Hoja: ' + sheetName + ' (fila cabecera: ' + (hRow+1) + ')';
                        }
                    } catch(previewErr) {
                        console.warn('[DEX] _dexPeOnSheetChange preview error (no afecta guardado):', previewErr);
                        if (preview) preview.textContent = 'Hoja: ' + sheetName;
                    }

                    stored.headerRow = hRow + 1;
                    localStorage.setItem('dex_xl_' + pid, JSON.stringify(stored));
                    console.log('[DEX] Hoja persistida en localStorage:', sheetName, 'headerRow:', stored.headerRow);

                    // También guardar en el perfil
                    const profile = this._dexProfiles.find(p => p.id === pid);
                    if (profile) {
                        profile.sheet = sheetName;
                        profile.headerRow = hRow + 1;
                        localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                    }
                } catch(e) { console.warn('[DEX] _dexPeOnSheetChange error:', e); }
            },

            dexDesvincularExcel: function () {
                const pid = this._dexEditingProfileId;
                if (pid) localStorage.removeItem('dex_xl_' + pid);
                const xn = document.getElementById('dex-pe-excelname');
                if (xn) xn.textContent = 'Sin archivo vinculado';
                const xp = document.getElementById('dex-pe-excelpath');
                if (xp) xp.value = '';
            },

            dexVincularPorRuta: async function () {
                const pid = this._dexEditingProfileId;
                if (!pid) { this.showToast('⚠️ Error: sin ID de perfil.'); return; }
                const xlPathInput = document.getElementById('dex-pe-excelpath');
                const diskPath = xlPathInput ? xlPathInput.value.trim() : '';
                if (!diskPath) { this.showToast('⚠️ Introduce una ruta de archivo.'); return; }

                const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';

                this.showToast('⏳ Leyendo archivo...');
                try {
                    const readR = await fetch(`${PROXY_BASE}/excel/read-file`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: diskPath })
                    });
                    const readJ = await readR.json();
                    if (!readR.ok || !readJ.data_base64) throw new Error(readJ.error || 'No se pudo leer el archivo.');
                    const binStr = atob(readJ.data_base64);
                    const name = diskPath.split(/[\\/]/).pop();
                    
                    const wb = XLSX.read(binStr, { type: 'binary' });
                    const stored = { name, data: binStr, path: diskPath, sheet: '', headerRow: 1 };
                    localStorage.setItem('dex_xl_' + pid, JSON.stringify(stored));
                    
                    const xn = document.getElementById('dex-pe-excelname');
                    if (xn) xn.textContent = name + ' 📁';
                    
                    this._dexPePopulateSheets(wb, stored);
                    this.showToast('✅ Excel vinculado por ruta: ' + name);
                } catch(err) {
                    this.showToast('❌ Error al vincular por ruta: ' + err.message);
                }
            },

            dexPeAddField: function () { this._dexPeAddFieldRow('', ''); },

            _dexPeAddFieldRow: function (aliases, column) {
                const cont = document.getElementById('dex-pe-fields');
                const row  = document.createElement('div');
                row.style.cssText = 'display:flex; gap:6px; align-items:center;';
                row.innerHTML = `
                    <input type="text" placeholder="Alias (ej. Nombre, Paciente)" value="${this._esc(aliases)}"
                        style="flex:1; background:#1e2640; border:1px solid rgba(255,255,255,0.1); border-radius:5px; color:#e2e8f0; padding:5px 8px; font-size:11px;">
                    <span style="color:#475569; font-size:11px;">→</span>
                    <input type="text" placeholder="Columna Excel" value="${this._esc(column)}"
                        style="flex:1; background:#1e2640; border:1px solid rgba(255,255,255,0.1); border-radius:5px; color:#e2e8f0; padding:5px 8px; font-size:11px;">
                    <button onclick="this.parentElement.remove()" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:4px; color:#f87171; padding:3px 7px; cursor:pointer; font-size:12px;">✕</button>`;
                cont.appendChild(row);
            },

            dexPeAddStaticField: function () { this._dexPeAddStaticFieldRow('', ''); },

            _dexPeAddStaticFieldRow: function (column, value) {
                const cont = document.getElementById('dex-pe-static-fields');
                if (!cont) return;
                const row  = document.createElement('div');
                row.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:4px;';
                row.innerHTML = `
                    <input type="text" placeholder="Columna Excel" value="${this._esc(column)}"
                        style="flex:1; background:#1e2640; border:1px solid rgba(255,255,255,0.1); border-radius:5px; color:#e2e8f0; padding:5px 8px; font-size:11px;">
                    <span style="color:#475569; font-size:11px;">=</span>
                    <input type="text" placeholder="Valor fijo o @HOY" value="${this._esc(value)}"
                        style="flex:1; background:#1e2640; border:1px solid rgba(255,255,255,0.1); border-radius:5px; color:#e2e8f0; padding:5px 8px; font-size:11px;">
                    <button onclick="this.parentElement.remove()" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:4px; color:#f87171; padding:3px 7px; cursor:pointer; font-size:12px;">✕</button>`;
                cont.appendChild(row);
            },

            dexPeCancel: function () {
                document.getElementById('dex-profile-editor').style.display = 'none';
                this._dexEditingProfileId = null;
            },

            dexPeSave: function () {
                const name = document.getElementById('dex-pe-name').value.trim();
                if (!name) { this.showToast('⚠️ Introduce un nombre para el perfil.'); return; }

                const nameOrder     = document.getElementById('dex-pe-nameorder')?.value || 'nombre_apellidos';
                const docType       = document.getElementById('dex-pe-doctype')?.value || 'medico';
                const headerRow     = parseInt(document.getElementById('dex-pe-headerrow')?.value || '1') || 1;
                const xlPathInput   = document.getElementById('dex-pe-excelpath');
                const manualPath    = xlPathInput ? xlPathInput.value.trim() : '';
                const xlText        = document.getElementById('dex-pe-excelname')?.textContent.trim() || '';
                
                let excelFileName = xlText === 'Sin archivo vinculado' ? '' : xlText;
                if (manualPath) {
                    excelFileName = manualPath.split(/[\\/]/).pop();
                }

                const rows = document.getElementById('dex-pe-fields').querySelectorAll('div');
                const fields = [];
                rows.forEach((r, i) => {
                    const inputs  = r.querySelectorAll('input');
                    const aliases = inputs[0] ? inputs[0].value.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const column  = inputs[1] ? inputs[1].value.trim() : '';
                    if (column) fields.push({ id: 'f' + i, aliases, column, order: i });
                });

                const staticRows = document.getElementById('dex-pe-static-fields')?.querySelectorAll('div') || [];
                const staticFields = [];
                staticRows.forEach(r => {
                    const inputs = r.querySelectorAll('input');
                    const column = inputs[0] ? inputs[0].value.trim() : '';
                    const value  = inputs[1] ? inputs[1].value.trim() : '';
                    if (column) staticFields.push({ column, value });
                });

                const id       = this._dexEditingProfileId || crypto.randomUUID();
                
                let stored = null;
                try { stored = JSON.parse(localStorage.getItem('dex_xl_' + id)); } catch(e){}
                
                const sheetSel = document.getElementById('dex-pe-sheet-select');
                const selectedSheet = sheetSel ? sheetSel.value : '';
                
                if (stored || manualPath) {
                    if (!stored) {
                        stored = { name: excelFileName, data: '', path: manualPath, sheet: selectedSheet, headerRow: headerRow };
                    } else {
                        if (manualPath) {
                            stored.path = manualPath;
                            stored.name = excelFileName;
                        }
                        stored.sheet = selectedSheet;
                        stored.headerRow = headerRow;
                    }
                    localStorage.setItem('dex_xl_' + id, JSON.stringify(stored));
                    console.log('[DEX Debug] Guardado stored en localStorage:', stored);
                }

                const existing = this._dexProfiles.findIndex(p => p.id === id);
                const data     = { id, name, fields, nameOrder, docType, headerRow, excelFileName, staticFields };

                if (existing >= 0) {
                    this._dexProfiles[existing] = { ...this._dexProfiles[existing], ...data };
                } else {
                    this._dexProfiles.push(data);
                }

                this._dexEditingProfileId = null;
                localStorage.setItem('dex_profiles', JSON.stringify(this._dexProfiles));
                document.getElementById('dex-profile-editor').style.display = 'none';
                this._dexRenderProfilesList();
                this._dexRenderProfileSelect();
                this.showToast('✅ Perfil guardado.');
            },

            // ============================================================
            // 🚀 COMMAND PALETTE (Ctrl+K) - PdfCraft Style
            // ============================================================
            _paletteSelectedIndex: 0,
            _paletteFilteredCommands: [],
            _paletteBoundEvents: false,

            isCommandPaletteOpen: function () {
                const modal = document.getElementById('command-palette-modal');
                return !!(modal && modal.style.display !== 'none');
            },

            closeCommandPalette: function () {
                const modal = document.getElementById('command-palette-modal');
                if (modal) modal.style.display = 'none';
                const overlay = document.getElementById('modal-overlay');
                if (overlay) {
                    overlay.style.display = 'none';
                    overlay.classList.remove('anim-in');
                }
            },

            toggleCommandPalette: function (forceOpen) {
                const now = Date.now();
                if (this._lastPaletteToggle && (now - this._lastPaletteToggle < 200)) return;
                this._lastPaletteToggle = now;

                const modal = document.getElementById('command-palette-modal');
                if (!modal) return;
                const isOpen = modal.style.display !== 'none';
                if (isOpen && forceOpen !== true) {
                    this.closeCommandPalette();
                } else {
                    this.openCommandPalette();
                }
            },

            fitToPage: async function () {
                const panelId = this.splitView?.activePanel || 'primary';
                const doc = this.getDoc();
                const index = doc?.currentIndex;
                const page = doc?.pages[index];
                const view = this.getPanelElements(panelId).mainView;
                if (!page || !view) return;
                const source = doc.sources[page.sourceId];
                let width = page.width || 612, height = page.height || 792;
                if (source?.buffer) {
                    const pdf = await this.loadSourcePdf(source);
                    const pdfPage = await pdf.getPage(page.pageIndex + 1);
                    const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + (page.rotation || 0)) % 360 });
                    width = viewport.width; height = viewport.height;
                }
                if (this.getDoc()?.id !== doc.id || doc.currentIndex !== index) return;
                const scale = Math.max(0.2, Math.min(5, (view.clientWidth - 32) / width, (view.clientHeight - 48) / height));
                this.zoomPanel(scale - (this.splitView?.[panelId]?.scale || this.currentScale || 1), panelId);
            },

            openMergeModal: function () {
                const input = document.createElement('input');
                input.type = 'file'; input.multiple = true; input.accept = '.pdf';
                input.onchange = () => {
                    if (input.files?.length) this.handleSidebarDrop(Array.from(input.files));
                };
                input.click();
            },

            openSplitModal: function () {
                const doc = this.getDoc();
                if (!doc?.pages.length) { this.showToast('⚠️ Abre un PDF primero.'); return; }
                document.getElementById('pdf-split-dialog')?.remove();
                const dialog = document.createElement('dialog');
                dialog.id = 'pdf-split-dialog';
                dialog.style.cssText = 'border:1px solid var(--border);border-radius:14px;padding:24px;background:var(--bg-tools,#fff);color:var(--text-main,#222);max-width:360px;box-shadow:0 12px 40px #0005;';
                dialog.innerHTML = '<h3 style="margin:0 0 16px">Dividir PDF</h3><label>Páginas por archivo <input type="number" min="1" value="1" style="width:70px;border-radius:6px;padding:6px"></label><p style="font-size:12px">Se descargarán archivos PDF separados. El documento original se conserva.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="capsule-btn secondary" type="button">Cancelar</button><button class="capsule-btn primary" type="button">Dividir</button></div>';
                const input = dialog.querySelector('input');
                input.max = doc.pages.length;
                dialog.querySelector('.secondary').onclick = () => dialog.close();
                dialog.querySelector('.primary').onclick = async () => {
                    if (!input.reportValidity()) return;
                    const size = Number(input.value);
                    dialog.close();
                    try { await this.splitPDF(doc.id, size); }
                    catch (error) { this.showToast('❌ No se pudo dividir: ' + error.message); }
                };
                dialog.addEventListener('close', () => dialog.remove());
                document.body.appendChild(dialog);
                dialog.showModal();
            },

            splitPDF: async function (docId, pagesPerFile) {
                if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1) throw new Error('Cantidad de páginas inválida');
                const snapshot = await this.captureDocumentSnapshot(docId);
                const payload = snapshot.payload;
                const sources = Object.fromEntries(payload.sources.map(source => [source.sourceId, { buffer: source.buffer }]));
                const baseName = (payload.document.name || 'documento.pdf').replace(/\.pdf$/i, '');
                for (let start = 0; start < payload.pages.length; start += pagesPerFile) {
                    const part = {
                        ...payload.document, id: docId, currentIndex: 0, sources,
                        pages: payload.pages.slice(start, start + pagesPerFile),
                        indexEntries: (payload.document.indexEntries || []).filter(entry => entry.pageIndex >= start && entry.pageIndex < start + pagesPerFile).map(entry => ({ ...entry, pageIndex: entry.pageIndex - start }))
                    };
                    const bytes = await this.savePDFInternal(false, null, false, true, 'standard', part);
                    if (!bytes?.byteLength) throw new Error('No se generó el PDF');
                    saveAs(new Blob([bytes], { type: 'application/pdf' }), `${baseName}_${start + 1}-${start + part.pages.length}.pdf`);
                }
            },

            _getPaletteCommandList: function () {
                const doc = typeof this.getDoc === 'function' ? this.getDoc() : null;
                const commands = [
                    // Formato (estilo Excel / Acrobat / Word)
                    { id: 'format_bold', category: 'Formato', icon: '<svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>', title: 'Texto: Negrita (Bold)', action: () => this.toggleBoldShortcut?.() },
                    { id: 'format_italic', category: 'Formato', icon: '<svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>', title: 'Texto: Cursiva (Italic)', action: () => this.toggleItalicShortcut?.() },
                    { id: 'format_underline', category: 'Formato', icon: '<svg viewBox="0 0 24 24"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>', title: 'Texto: Subrayado (Underline)', action: () => this.toggleUnderlineShortcut?.() },

                    // Búsqueda & Paleta
                    { id: 'search_find', category: 'Búsqueda', icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', title: 'Buscar en documento', action: () => this.expandSearchWidget?.(true) },
                    { id: 'cmd_palette', category: 'General', icon: '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>', title: 'Paleta de Comandos', action: () => this.toggleCommandPalette?.() },

                    // Navegación & Vista
                    { id: 'nav_next', category: 'Navegación', icon: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>', title: 'Página siguiente', shortcut: '→', action: () => this.movePage?.(1) },
                    { id: 'nav_prev', category: 'Navegación', icon: '<svg viewBox="0 0 24 24"><polygon points="19 21 5 12 19 3 19 21" fill="currentColor"/></svg>', title: 'Página anterior', shortcut: '←', action: () => this.movePage?.(-1) },
                    { id: 'nav_first', category: 'Navegación', icon: '<svg viewBox="0 0 24 24"><line x1="5" y1="4" x2="5" y2="20"/><polygon points="19 20 7 12 19 4 19 20" fill="currentColor"/></svg>', title: 'Ir a la primera página', action: () => this.loadPage?.(0) },
                    { id: 'nav_last', category: 'Navegación', icon: '<svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="19" y2="20"/><polygon points="5 4 17 12 5 20 5 4" fill="currentColor"/></svg>', title: 'Ir a la última página', action: () => { if (doc?.pages) this.loadPage?.(doc.pages.length - 1); } },
                    { id: 'zoom_in', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', title: 'Acercar zoom', shortcut: 'Ctrl +', action: () => this.zoom?.(0.1) },
                    { id: 'zoom_out', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>', title: 'Alejar zoom', shortcut: 'Ctrl -', action: () => this.zoom?.(-0.1) },
                    { id: 'zoom_reset', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>', title: 'Restablecer zoom (100%)', action: () => this.zoom?.(1.0 - (this.currentScale || 1.0)) },
                    { id: 'zoom_fit_width', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5V7z"/><path d="M16 7l5 5-5 5V7z"/><line x1="3" y1="12" x2="21" y2="12"/></svg>', title: 'Ajustar al ancho de ventana', action: () => this.fitToWidth?.() },
                    { id: 'zoom_fit_page', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><path d="M7 8l5-5 5 5H7z"/><path d="M7 16l5 5 5-5H7z"/><line x1="12" y1="3" x2="12" y2="21"/></svg>', title: 'Ajustar página completa', action: () => this.fitToPage?.() },
                    { id: 'view_continuous', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><path d="M7 3h10v18H7z M7 9h10 M7 15h10"/></svg>', title: 'Alternar vista continua', action: () => this.toggleViewMode?.() },
                    { id: 'view_twoup', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><path d="M2 4h9v16H2z M13 4h9v16h-9z"/></svg>', title: 'Vista doble página (Modo Libro)', action: () => this.toggleTwoUpView?.() },
                    { id: 'view_twoup_cover', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>', title: 'Alternar portada individual en doble página', action: () => this.toggleTwoUpCoverAlone?.() },
                    { id: 'view_invert', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 010 18V3z" fill="currentColor"/></svg>', title: 'Modo Oscuro / Invertir colores PDF', action: () => this.invertColorsPDF?.() },
                    { id: 'view_reading', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><circle cx="6" cy="14" r="4"/><circle cx="18" cy="14" r="4"/><path d="M10 14h4"/><path d="M2 14l2-6a2 2 0 0 1 2-1h1"/><path d="M22 14l-2-6a2 2 0 0 0-2-1h-1"/></svg>', title: 'Modo lectura sin distracciones', action: () => this.toggleReadingMode?.() },
                    { id: 'view_layers', category: 'Vista', icon: '<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>', title: 'Panel de Capas PDF (OCG)', action: () => this.toggleLayersPanel?.() },

                    // Edición & Herramientas
                    { id: 'edit_undo', category: 'Edición', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>', title: 'Deshacer acción', action: () => this.undo?.() },
                    { id: 'edit_redo', category: 'Edición', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>', title: 'Rehacer acción', action: () => this.redo?.() },
                    { id: 'tool_splice_edit', category: 'Edición', icon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>', title: 'Editar texto directo (Quirúrgico)', action: () => this.activateRealTextEditor?.() },
                    { id: 'tool_smart_patch', category: 'Edición', icon: '<svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>', title: 'Editar texto directo (Smart Patch)', action: () => this.activateRealTextEditor?.() },
                    { id: 'tool_add_text', category: 'Edición', icon: '<svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>', title: 'Añadir nuevo texto libre', action: () => this.addText?.() },
                    { id: 'tool_select', category: 'Herramientas', icon: '<svg viewBox="0 0 24 24"><path d="M8 4h8 M12 4v16 M8 20h8" stroke-linecap="square"/></svg>', title: 'Herramienta Seleccionar', action: () => this.setDrawTool?.('none') },
                    { id: 'tool_hand', category: 'Herramientas', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7,21 L5.5,11 L5.5,7 A1.5,1.5 0 0 1 8.5,7 L8.5,11 L8.5,5 A1.5,1.5 0 0 1 11.5,5 L11.5,11 L11.5,2.45 A1.5,1.5 0 0 1 14.5,2.45 L14.5,11 L14.5,5 A1.5,1.5 0 0 1 17.5,5 L17.5,12 L20.5,10 A1.5,1.5 0 0 1 22,12.5 L18.5,15.5 Q17.5,16.5 17.5,18 L16,21 Q11.5,23 7,21 Z"/></svg>', title: 'Herramienta Mano (Pan & Scroll)', shortcut: 'H', action: () => this.toggleHandMode?.() },
                    { id: 'tool_highlight', category: 'Herramientas', icon: '<svg viewBox="0 0 24 24"><path d="M8 4h8 M12 4v16 M8 20h8" stroke-linecap="square"/><rect x="17" y="2" width="5" height="5" style="fill: #10b981 !important; stroke: none !important;" rx="0.5"/></svg>', title: 'Resaltador de texto', action: () => this.setDrawTool?.('highlight') },
                    { id: 'tool_pen', category: 'Herramientas', icon: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>', title: 'Lápiz de dibujo libre', action: () => this.setDrawTool?.('pen') },
                    { id: 'tool_image', category: 'Edición', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', title: 'Insertar imagen', action: () => document.getElementById('img-loader')?.click() },
                    { id: 'tool_sign', category: 'Firma', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 17s1.5-2 3-1 2.5 2 4 1"/></svg>', title: 'Insertar o gestionar firma', action: () => this.showFirmasModal?.() },
                    { id: 'tool_redact', category: 'Seguridad', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" fill-opacity="0.3"/><line x1="3" y1="5" x2="21" y2="19"/></svg>', title: 'Censurar / Tachar área sensible', action: () => this.setDrawTool?.('redact') },
                    { id: 'tool_ocr', category: 'Herramientas', icon: '<svg viewBox="0 0 24 24"><path d="M4 7V4h3"/><path d="M20 7V4h-3"/><path d="M4 17v3h3"/><path d="M20 17v3h-3"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="9" x2="12" y2="15"/></svg>', title: 'Reconocimiento de texto OCR', action: () => this.extractText?.() },

                    // Operaciones de Página & Documento
                    { id: 'page_rot_cw', category: 'Páginas', icon: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8" stroke="#2563eb" stroke-width="2"/><rect x="9.5" y="8.5" width="5" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>', title: 'Rotar página 90° a la derecha', action: () => this.rotatePage?.(90) },
                    { id: 'page_rot_ccw', category: 'Páginas', icon: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8" stroke="#2563eb" stroke-width="2"/><rect x="9.5" y="8.5" width="5" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>', title: 'Rotar página 90° a la izquierda', action: () => this.rotatePage?.(-90) },
                    { id: 'page_delete', category: 'Páginas', icon: '<svg viewBox="0 0 24 24" stroke="var(--danger, #ef4444)"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>', title: 'Eliminar página actual', action: () => this.deletePage?.() },
                    { id: 'page_extract', category: 'Páginas', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 12 18 15 15" stroke="#3b82f6"/><line x1="12" y1="11" x2="12" y2="18" stroke="#3b82f6"/></svg>', title: 'Extraer páginas seleccionadas', action: () => this.extractPage?.() },
                    { id: 'page_blank', category: 'Páginas', icon: '<svg viewBox="0 0 24 24"><path d="M13.2 21.5H6.5a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2H14l5 5v4" stroke="currentColor"/><path d="M14 2.8v4.7h4.7" stroke="currentColor"/><circle cx="17.6" cy="17.5" r="4.4" stroke="#2fa052"/><path d="M17.6 15v5M15.1 17.5h5" stroke="#2fa052"/></svg>', title: 'Insertar página en blanco', action: () => this.insertBlankPage?.() },
                    { id: 'doc_merge', category: 'Documento', icon: '<svg viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', title: 'Unir varios PDFs (con marcadores anidados)', action: () => this.openMergeModal?.() },
                    { id: 'doc_split', category: 'Documento', icon: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>', title: 'Dividir PDF en archivos separados', action: () => this.openSplitModal?.() },
                    { id: 'doc_compress', category: 'Documento', icon: '<svg viewBox="0 0 24 24"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>', title: 'Comprimir PDF y reducir tamaño', action: () => this.showCompressPDFModal?.() },
                    { id: 'doc_props', category: 'Documento', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>', title: 'Propiedades del Documento (Metadatos, Seguridad, Fuentes)', action: () => this.openDocumentProperties?.() },

                    // Archivo & Ventanas
                    { id: 'file_open', category: 'Archivo', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>', title: 'Abrir archivo PDF...', action: () => document.getElementById('file-loader')?.click() },
                    { id: 'file_save', category: 'Archivo', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3 3-1.34 3-3zm3-10H5V5h10v4z"/></svg>', title: 'Guardar cambios en el PDF', action: () => this.savePDF?.() },
                    { id: 'file_save_as', category: 'Archivo', icon: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', title: 'Guardar como...', action: () => this.showSaveModal?.() },
                    { id: 'file_print', category: 'Archivo', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>', title: 'Imprimir documento', action: () => this.showPrintModal?.() },
                    { id: 'file_close', category: 'Archivo', icon: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>', title: 'Cerrar documento actual', action: () => this.closeDocument?.() },
                    { id: 'file_reveal', category: 'Archivo', icon: '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>', title: 'Mostrar archivo en el Explorador de Windows', action: () => this.revealCurrentFileInExplorer?.() },
                    { id: 'tab_reopen', category: 'Pestañas', icon: '<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>', title: 'Reabrir última pestaña cerrada', action: () => this.reopenLastClosedTab?.() },

                    // IA Studio
                    { id: 'ai_panel', category: 'IA Studio', icon: '<svg viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>', title: 'Abrir asistente IA', action: () => this.toggleAIPanel?.() },
                    { id: 'ai_summarize', category: 'IA Studio', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>', title: 'Resumir documento con IA', action: () => this.aiQuickAction?.('resumir') },
                    { id: 'ai_translate', category: 'IA Studio', icon: '<svg viewBox="0 0 24 24"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>', title: 'Traducir documento con IA', action: () => this.showTextTranslationModal?.() },
                    { id: 'ai_tables', category: 'IA Studio', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>', title: 'Extraer tablas a Excel con IA', action: () => this.detectAndShowTables?.() },

                    // Ayuda & Configuración
                    { id: 'pref_help', category: 'Ayuda', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', title: 'Centro de Ayuda y Tutoriales', action: () => this.showPreferencesModal?.('pref-help') },
                    { id: 'pref_shortcuts', category: 'Ayuda', icon: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>', title: 'Configurar Atajos de Teclado', action: () => this.showPreferencesModal?.('pref-shortcuts') },
                    { id: 'app_about', category: 'Ayuda', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>', title: 'Acerca de ALIOTH PDF Editor', action: () => this.showAbout?.() }
                ];

                const sm = this.shortcutManager || (window.app && window.app.shortcutManager);
                if (sm) {
                    for (const cmd of commands) {
                        const sc = sm.getShortcutForAction(cmd.id);
                        if (sc) {
                            cmd.shortcut = sc;
                        }
                    }
                }

                return commands;
            },

            openCommandPalette: function () {
                const modal = document.getElementById('command-palette-modal');
                const input = document.getElementById('command-palette-input');
                const overlay = document.getElementById('modal-overlay');
                if (!modal || !input) return;

                // Ocultar cualquier otro modal visible dentro del overlay
                document.querySelectorAll('#modal-overlay .glass-box, #modal-overlay .preferences-modal-content').forEach(el => {
                    if (el.id !== 'command-palette-modal') el.style.display = 'none';
                });

                if (overlay) {
                    overlay.style.display = 'flex';
                    overlay.classList.remove('anim-in');
                    void overlay.offsetWidth;
                    overlay.classList.add('anim-in');
                }

                modal.style.display = 'block';
                input.value = '';
                this._paletteSelectedIndex = 0;
                this.filterCommandPalette('');

                setTimeout(() => {
                    input.focus();
                }, 50);

                if (!this._paletteBoundEvents) {
                    this._paletteBoundEvents = true;

                    if (overlay) {
                        overlay.addEventListener('click', (ev) => {
                            if (ev.target === overlay && modal.style.display !== 'none') {
                                this.closeCommandPalette();
                            }
                        });
                    }

                    input.addEventListener('input', (e) => {
                        this._paletteSelectedIndex = 0;
                        this.filterCommandPalette(e.target.value);
                    });
                    input.addEventListener('keydown', (e) => {
                        const results = this._paletteFilteredCommands;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (results.length > 0) {
                                this._paletteSelectedIndex = (this._paletteSelectedIndex + 1) % results.length;
                                this._updatePaletteActiveItem();
                            }
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (results.length > 0) {
                                this._paletteSelectedIndex = (this._paletteSelectedIndex - 1 + results.length) % results.length;
                                this._updatePaletteActiveItem();
                            }
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (results[this._paletteSelectedIndex]) {
                                this._executePaletteCommand(results[this._paletteSelectedIndex]);
                            }
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            this.closeCommandPalette();
                        }
                    });
                }
            },

            filterCommandPalette: function (query) {
                const listContainer = document.getElementById('command-palette-results');
                if (!listContainer) return;
                const all = this._getPaletteCommandList();
                const fold = window.AliothSearch.fold;
                const q = fold(query).trim();

                if (!q) {
                    this._paletteFilteredCommands = all;
                } else {
                    this._paletteFilteredCommands = all.filter(c => {
                        return fold(c.title).includes(q) ||
                               fold(c.category).includes(q) ||
                               (c.shortcut && fold(c.shortcut).includes(q));
                    });
                }

                if (this._paletteSelectedIndex >= this._paletteFilteredCommands.length) {
                    this._paletteSelectedIndex = 0;
                }

                this._renderCommandPaletteResults(this._paletteFilteredCommands);
            },

            _renderCommandPaletteResults: function (items) {
                const container = document.getElementById('command-palette-results');
                if (!container) return;

                if (items.length === 0) {
                    container.innerHTML = '<div style="padding: 18px; text-align: center; color: #64748b; font-size: 13px;">No se encontraron comandos coincidentes</div>';
                    return;
                }

                let html = '';
                items.forEach((item, index) => {
                    const isActive = index === this._paletteSelectedIndex ? ' active' : '';
                    const shortcutHtml = item.shortcut ? `<span class="palette-item-shortcut">${item.shortcut}</span>` : '';
                    html += `
                        <div class="palette-item${isActive}" data-index="${index}" onclick="app._executePaletteCommand(app._paletteFilteredCommands[${index}])">
                            <div class="palette-item-left">
                                <span class="palette-item-icon">${item.icon}</span>
                                <span class="palette-item-title">${item.title}</span>
                                <span class="palette-item-category">${item.category}</span>
                            </div>
                            ${shortcutHtml}
                        </div>
                    `;
                });

                container.innerHTML = html;
                this._scrollPaletteActiveIntoView();
            },

            _updatePaletteActiveItem: function () {
                const container = document.getElementById('command-palette-results');
                if (!container) return;
                const items = container.querySelectorAll('.palette-item');
                items.forEach((el, idx) => {
                    if (idx === this._paletteSelectedIndex) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
                this._scrollPaletteActiveIntoView();
            },

            _scrollPaletteActiveIntoView: function () {
                const container = document.getElementById('command-palette-results');
                if (!container) return;
                const activeEl = container.querySelector('.palette-item.active');
                if (activeEl) {
                    activeEl.scrollIntoView({ block: 'nearest' });
                }
            },

            _executePaletteCommand: async function (cmd) {
                this.closeCommandPalette();
                if (cmd && typeof cmd.action === 'function') {
                    try {
                        await cmd.action();
                    } catch (e) {
                        console.error('Error ejecutando comando:', cmd, e);
                        this.showToast('❌ No se pudo ejecutar: ' + e.message);
                    }
                }
            },

            // ── Reveal in Windows Explorer & Reopen Closed Tabs (PdfCraft style) ──
            revealCurrentFileInExplorer: async function (targetDocId = null) {
                const docId = targetDocId || this.activeDocId;
                const doc = (this.docs || []).find(d => d && d.id === docId) || (typeof this.getDoc === 'function' ? this.getDoc() : null);
                const path = doc?.filePath || doc?.path || doc?._nativePath;
                if (!path) {
                    this.showToast('ℹ️ El archivo seleccionado no tiene una ruta local en disco');
                    return;
                }
                try {
                    const resp = await fetch('/api/files/reveal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: path })
                    });
                    const res = await resp.json();
                    if (res && res.ok) {
                        this.showToast('📁 Mostrado en el Explorador de Windows');
                    } else {
                        this.showToast('⚠️ No se pudo abrir en el Explorador: ' + (res?.error || ''));
                    }
                } catch (e) {
                    this.showToast('⚠️ Error al contactar con el proxy: ' + e.message);
                }
            },

            reopenLastClosedTab: async function () {
                if (!this._closedTabsStack || this._closedTabsStack.length === 0) {
                    this.showToast('ℹ️ No hay pestañas cerradas recientemente');
                    return;
                }
                const item = this._closedTabsStack.pop();
                try {
                    if (item.persisting) await item.persisting;
                    let buffer = item.buffer;
                    if (!buffer && item.storageKey) {
                        const saved = await this.db.appState.get(item.storageKey);
                        buffer = (await this.decryptRecord(saved, ['buffer']))?.buffer;
                    }
                    if (!buffer) throw new Error('CLOSED_TAB_UNAVAILABLE');
                    const file = new File([buffer], item.name, { type: 'application/pdf' });
                    if (item.filePath) {
                        file.path = item.filePath;
                    }
                    await this.openFile(file);
                    if (item.currentIndex > 0 && typeof this.loadPage === 'function') {
                        setTimeout(() => this.loadPage(item.currentIndex), 120);
                    }
                    this.showToast(`↩ Pestaña "${item.name}" reabierta`);
                    await this.releaseClosedTab?.(item);
                } catch (e) {
                    this._closedTabsStack.push(item);
                    console.error('Error reabriendo pestaña:', e);
                    this.showToast('⚠️ No se pudo reabrir la pestaña');
                }
            },

});

