// app.core.js
// Extiende el objeto global `app` con métodos de core
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;

// Diagnóstico temporal para zoom y edición real. El marcador permite confirmar
// desde consola que la ventana cargó exactamente esta revisión de los scripts.
window.__ALIOTH_DIAG_BUILD__ = 'text-reflow-20261018-1';
window.__aliothDiag = window.__aliothDiag || {
    enabled: false,
    sequence: 0,
    _buffer: [],
    _flushTimer: null,
    _flush() {
        if (!this._buffer.length) return;
        const payload = JSON.stringify(this._buffer);
        this._buffer = [];
        try {
            if (typeof fetch === 'function') {
                fetch('/api/diag-log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                }).catch(() => {});
            }
        } catch (_) {}
    },
    trace(scope, event, data = {}) {
        if (!this.enabled && scope !== 'APP-ERROR') return;
        const entry = {
            sequence: ++this.sequence,
            elapsedMs: Math.round(performance.now() * 10) / 10,
            scope,
            event,
            ...data
        };
        let serialized = '';
        try { serialized = JSON.stringify(entry); } catch (_) { serialized = '{"serialization":"failed"}'; }
        console.log(`[ALIOTH-DIAG #${entry.sequence}] ${scope}:${event} ${serialized}`);
        this._buffer.push(entry);
        if (this._buffer.length > 200) this._buffer.shift();
        if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => {
                this._flushTimer = null;
                this._flush();
            }, 100);
        }
        return entry;
    },
    view(panelId = 'primary') {
        const suffix = panelId === 'secondary' ? 'Secondary' : 'Primary';
        const mainView = document.getElementById(`mainView${suffix}`);
        const canvas = document.getElementById(`canvas-container${panelId === 'secondary' ? '-secondary' : ''}`);
        const rect = canvas?.getBoundingClientRect();
        return {
            panelId,
            activeElement: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || null,
            scrollLeft: mainView?.scrollLeft ?? null,
            scrollTop: mainView?.scrollTop ?? null,
            scrollWidth: mainView?.scrollWidth ?? null,
            scrollHeight: mainView?.scrollHeight ?? null,
            clientWidth: mainView?.clientWidth ?? null,
            clientHeight: mainView?.clientHeight ?? null,
            canvasRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
            transform: canvas?.style.transform || '',
            transformOrigin: canvas?.style.transformOrigin || '',
            overlays: document.querySelectorAll('#overlay-layer .draggable, #overlay-layer-secondary .draggable').length,
            covers: document.querySelectorAll('[id^="real-edit-cover-"]').length
        };
    }
};

window.addEventListener('error', (e) => {
    window.__aliothDiag?.trace('APP-ERROR', 'uncaught', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack || null
    });
});
window.addEventListener('unhandledrejection', (e) => {
    window.__aliothDiag?.trace('APP-ERROR', 'unhandledrejection', {
        reason: e.reason?.stack || String(e.reason)
    });
});

try { window.__aliothDiag.enabled = localStorage.getItem('alioth_diagnostics') === '1'; } catch (_) {}

// ============================================================
// CROSS-WINDOW INTERACTION & TRANSFER SUBSYSTEM
// ============================================================
if (!window.__aliothWindowId) {
    window.__aliothWindowId = 'win_' + Math.random().toString(36).slice(2) + '_' + Date.now();
}
window._aliothTransferStore = window._aliothTransferStore || {};

if (!window.aliothChannel && typeof BroadcastChannel !== 'undefined') {
    try {
        window.aliothChannel = new BroadcastChannel('alioth_cross_window');
        window.aliothChannel.onmessage = async (e) => {
            const data = e.data;
            if (!data || typeof data !== 'object') return;

            // 1. Petición de payload desde otra ventana
            if (data.type === 'request_transfer_payload' && data.token) {
                const stored = window._aliothTransferStore[data.token];
                if (stored) {
                    try {
                        window.aliothChannel.postMessage({
                            type: 'response_transfer_payload',
                            token: data.token,
                            payload: stored
                        });
                    } catch (err) {
                        console.warn('[AliothChannel] Error enviando payload estructurado:', err);
                    }
                }
            }

            // 2. ACK de transferencia de pestaña: cerrar pestaña en ventana de origen
            if (data.type === 'tab_transfer_ack' && data.token) {
                if (window.app && window.app._activeDraggedTabToken === data.token) {
                    // Usar _activeDraggedTabDocId (persistente) como primario,
                    // draggingTabId como fallback, y payload.docId como último recurso
                    const docId = window.app._activeDraggedTabDocId
                        || window.app.draggingTabId
                        || (window._aliothTransferStore[data.token] && window._aliothTransferStore[data.token].docId);
                    if (docId) {
                        window.app.closeTab(docId, null, true);
                        window.app.showToast('📤 Pestaña movida a otra ventana');
                    }
                    window.app._activeDraggedTabToken = null;
                    window.app._activeDraggedTabDocId = null;
                    window.app.draggingTabId = null;
                    delete window._aliothTransferStore[data.token];
                    window.app._transferCache?.delete(data.token);
                }
            }

            // 3. ACK de extracción/movimiento de página:
            if (data.type === 'page_transfer_move_ack' && data.token) {
                const stored = window._aliothTransferStore[data.token];
                if (stored && stored.sourceDocId && stored.indices && stored.sourceWindowId === window.__aliothWindowId) {
                    if (window.app && window.app.docs) {
                        const srcDoc = window.app.docs.find(d => d.id === stored.sourceDocId);
                        if (srcDoc) {
                            if (srcDoc.pages.length <= stored.pages.length) {
                                window.app.closeTab(srcDoc.id, null, true);
                                window.app.showToast('📤 Documento movido a otra ventana');
                            } else {
                                [...stored.indices].sort((a, b) => b - a).forEach(idx => {
                                    srcDoc.pages.splice(idx, 1);
                                });
                                if (srcDoc.currentIndex >= srcDoc.pages.length) {
                                    srcDoc.currentIndex = Math.max(0, srcDoc.pages.length - 1);
                                }
                                window.app.renderSidebar();
                                window.app.loadPage(srcDoc.currentIndex);
                                window.app.saveState();
                                window.app.showToast('📤 Páginas movidas a otra ventana');
                            }
                        }
                    }
                    delete window._aliothTransferStore[data.token];
                    window.app?._transferCache?.delete(data.token);
                }
            }
        };
    } catch (err) {
        console.warn('[AliothChannel] BroadcastChannel no soportado o falló:', err);
    }
}

Object.assign(app, {
            docs: [], activeDocId: null, currentScale: 1.0, renderTask: null,

            // Transfer Helpers & Cross-Window Serialization
            _arrayBufferToBase64: function(buffer) {
                if (!buffer) return '';
                if (typeof buffer === 'string') return buffer;
                const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
                let binary = '';
                const len = bytes.byteLength;
                const chunkSize = 0x8000;
                for (let i = 0; i < len; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
                }
                return btoa(binary);
            },

            _base64ToArrayBuffer: function(base64) {
                if (!base64) return new ArrayBuffer(0);
                if (base64 instanceof ArrayBuffer) return base64;
                if (base64 instanceof Uint8Array) return base64.buffer;
                const binary = atob(base64);
                const len = binary.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return bytes.buffer;
            },

            _cacheTransferPayload: function (token, payload, backed = true) {
                if (!this._transferCache) this._transferCache = new Map();
                const bytes = Object.values(payload.sourcesBuffers || {}).reduce((sum, buffer) => sum + (buffer?.byteLength || (typeof buffer === 'string' ? buffer.length * 2 : 0)), 0);
                this._transferCache.delete(token);
                this._transferCache.set(token, { bytes, backed, time: Date.now() });
                window._aliothTransferStore[token] = payload;
                let total = [...this._transferCache.values()].reduce((sum, row) => sum + row.bytes, 0);
                for (const [key, row] of this._transferCache) {
                    if (row.backed && (total > 32 * 1024 * 1024 || this._transferCache.size > 32 || Date.now() - row.time > 600000)) {
                        total -= row.bytes;
                        this._transferCache.delete(key);
                        delete window._aliothTransferStore[key];
                        try { localStorage.removeItem('alioth_transfer_meta_' + key); } catch (_) {}
                    }
                }
            },

            _saveTransferPayload: async function(token, payload) {
                if (!token || !payload) return;
                this._cacheTransferPayload(token, payload, false);

                try {
                    localStorage.setItem('alioth_transfer_meta_' + token, JSON.stringify({
                        token: token,
                        type: payload.type,
                        name: payload.name || payload.docName || '',
                        time: Date.now()
                    }));
                } catch(e) {}

                try {
                    const httpPayload = {
                        ...payload,
                        sourcesBuffers: {}
                    };
                    if (payload.sourcesBuffers) {
                        for (const [srcId, buf] of Object.entries(payload.sourcesBuffers)) {
                            if (buf) {
                                httpPayload.sourcesBuffers[srcId] = this._arrayBufferToBase64(buf);
                            }
                        }
                    }
                    fetch('/transfer-payload?token=' + encodeURIComponent(token), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(httpPayload)
                    }).then(response => {
                        if (!response.ok) throw new Error('TRANSFER_STORE_BUSY');
                        this._cacheTransferPayload(token, payload, true);
                    }).catch(err => {
                        console.warn('[Proxy Transfer] No se pudo guardar payload en proxy:', err);
                    });
                } catch (err) {
                    console.warn('[Proxy Transfer] Error serializando payload:', err);
                }
            },

            _fetchTransferPayload: async function(token) {
                if (!token) return null;
                token = String(token).replace(/^alioth-(tab|page|token):/, '').trim();

                // 1. Memoria local en esta ventana
                if (window._aliothTransferStore && window._aliothTransferStore[token]) {
                    return window._aliothTransferStore[token];
                }

                // 2. Opener / parent si existe
                try {
                    if (window.opener && window.opener._aliothTransferStore && window.opener._aliothTransferStore[token]) {
                        return window.opener._aliothTransferStore[token];
                    }
                } catch(e) {}

                // 3. Solicitar vía BroadcastChannel con timeout
                if (window.aliothChannel) {
                    try {
                        const channelPromise = new Promise((resolve) => {
                            const handler = (e) => {
                                if (e.data && e.data.type === 'response_transfer_payload' && e.data.token === token) {
                                    window.aliothChannel.removeEventListener('message', handler);
                                    resolve(e.data.payload);
                                }
                            };
                            window.aliothChannel.addEventListener('message', handler);
                            setTimeout(() => {
                                window.aliothChannel.removeEventListener('message', handler);
                                resolve(null);
                            }, 800);
                            window.aliothChannel.postMessage({ type: 'request_transfer_payload', token: token });
                        });
                        const bcResult = await channelPromise;
                        if (bcResult) {
                            this._cacheTransferPayload(token, bcResult);
                            return bcResult;
                        }
                    } catch(e) {}
                }

                // 4. GET desde el servidor proxy local
                try {
                    const resp = await fetch('/transfer-payload?token=' + encodeURIComponent(token));
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.sourcesBuffers) {
                            const restoredBuffers = {};
                            for (const [srcId, b64] of Object.entries(data.sourcesBuffers)) {
                                if (typeof b64 === 'string') {
                                    restoredBuffers[srcId] = this._base64ToArrayBuffer(b64);
                                } else if (b64 && (b64 instanceof ArrayBuffer || b64 instanceof Uint8Array)) {
                                    restoredBuffers[srcId] = b64;
                                }
                            }
                            data.sourcesBuffers = restoredBuffers;
                        }
                        this._cacheTransferPayload(token, data);
                        return data;
                    }
                } catch (err) {
                    console.warn('[Proxy Transfer] Error recuperando payload desde proxy:', err);
                }

                return null;
            },

            _clonePagesAndSources: async function(payload, targetDoc, insertIndex = -1) {
                if (!payload || !targetDoc) return [];
                const pages = payload.pages || [];
                if (!pages.length) return [];

                targetDoc.sources = targetDoc.sources || {};

                // Cargar/asegurar buffers de fuentes PDF
                if (payload.sourcesBuffers) {
                    for (const [srcId, rawBuf] of Object.entries(payload.sourcesBuffers)) {
                        let buffer = rawBuf;
                        if (typeof buffer === 'string') {
                            buffer = this._base64ToArrayBuffer(buffer);
                        }
                        if (!targetDoc.sources[srcId] && buffer && (buffer instanceof ArrayBuffer || buffer.byteLength !== undefined)) {
                            try {
                                const cleanBuffer = buffer.slice ? buffer.slice(0) : buffer;
                                const loadingTask = pdfjsLib.getDocument({ data: cleanBuffer.slice(0) });
                                const pdf = await loadingTask.promise;
                                targetDoc.sources[srcId] = { buffer: cleanBuffer, doc: pdf };
                            } catch (err) {
                                console.error('[ClonePages] Error cargando fuente PDF:', srcId, err);
                            }
                        }
                    }
                }

                // Clonar páginas limpiando caches
                const clonedPages = pages.map(p => {
                    const cp = JSON.parse(JSON.stringify(p));
                    cp.id = 'page_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                    cp._thumbCache = null;
                    cp._thumbCacheObjects = undefined;
                    if (Array.isArray(cp.objects)) {
                        cp.objects = cp.objects.map(obj => {
                            const o = JSON.parse(JSON.stringify(obj));
                            o.id = 'obj_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                            return o;
                        });
                    }
                    return cp;
                });

                if (insertIndex < 0 || insertIndex > targetDoc.pages.length) {
                    insertIndex = targetDoc.pages.length;
                }
                targetDoc.pages.splice(insertIndex, 0, ...clonedPages);

                return clonedPages;
            },

            showInsertPagePositionModal: function(payload, targetDoc) {
                return new Promise((resolve) => {
                    const existing = document.getElementById('_insert-pos-modal');
                    if (existing) existing.remove();

                    const count = targetDoc.pages.length;
                    const currentIdx = targetDoc.currentIndex >= 0 ? targetDoc.currentIndex : 0;
                    const pagesCount = (payload && payload.pages) ? payload.pages.length : 1;
                    const docTitle = targetDoc.name || 'Documento';

                    const overlay = document.createElement('div');
                    overlay.id = '_insert-pos-modal';
                    overlay.className = 'glass-overlay';
                    overlay.style.cssText = 'display:flex; z-index:15000; align-items:center; justify-content:center; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(8px);';

                    const modal = document.createElement('div');
                    modal.className = 'glass-box';
                    modal.style.cssText = 'width:380px; max-width:92vw; text-align:left; padding:22px; border-radius:14px; background:rgba(20,20,30,0.95); border:1px solid rgba(255,255,255,0.15); box-shadow:0 12px 36px rgba(0,0,0,0.6); color:#fff; font-family:inherit;';

                    const optBtnStyle = 'display:flex; align-items:center; gap:10px; width:100%; padding:10px 14px; margin-bottom:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#f0f4ff; font-size:13px; cursor:pointer; transition:all 0.15s; text-align:left; box-sizing:border-box; font-weight:500;';

                    modal.innerHTML = `
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                            <h3 style="margin:0; font-size:15px; font-weight:600; color:#fff; display:flex; align-items:center; gap:8px;">
                                📑 Insertar en "${window.escapeHTML(docTitle)}"
                            </h3>
                            <span id="_ipm-close" style="cursor:pointer; font-size:16px; color:rgba(255,255,255,0.5); padding:2px 6px;">✕</span>
                        </div>
                        <p style="margin:0 0 16px; font-size:12px; color:rgba(200,215,255,0.75);">
                            Se insertará(n) <strong>${pagesCount} página(s)</strong>. Selecciona la posición de destino:
                        </p>
                        <div style="margin-bottom:14px;">
                            <button class="_ipm-opt" data-pos="start" style="${optBtnStyle}">
                                <span style="font-size:16px;">⏮️</span> <span><strong>Al inicio</strong> (como Página 1)</span>
                            </button>
                            <button class="_ipm-opt" data-pos="current" style="${optBtnStyle}">
                                <span style="font-size:16px;">📌</span> <span><strong>Después de pág actual</strong> (después de Pág ${currentIdx + 1})</span>
                            </button>
                            <button class="_ipm-opt" data-pos="end" style="${optBtnStyle}">
                                <span style="font-size:16px;">⏭️</span> <span><strong>Al final</strong> (como Página ${count + 1})</span>
                            </button>
                            <div style="display:flex; align-items:center; gap:8px; margin-top:10px; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04);">
                                <span style="font-size:16px;">🔢</span>
                                <label style="font-size:12px; color:rgba(200,215,255,0.85); flex:1;">Posición exacta (pág):</label>
                                <input id="_ipm-custom-idx" type="number" min="1" max="${count + 1}" value="${Math.min(currentIdx + 2, count + 1)}" style="width:60px; padding:4px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.25); background:rgba(0,0,0,0.5); color:#fff; text-align:center; font-size:13px;" />
                                <button id="_ipm-custom-btn" style="padding:6px 12px; border-radius:6px; border:none; background:var(--accent,#6366f1); color:#fff; font-size:12px; cursor:pointer; font-weight:600;">Insertar</button>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <button id="_ipm-cancel" style="padding:6px 14px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:transparent; color:rgba(255,255,255,0.7); font-size:12px; cursor:pointer;">Cancelar</button>
                        </div>
                    `;

                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);

                    const close = (idx) => {
                        overlay.remove();
                        resolve(idx);
                    };

                    modal.querySelectorAll('._ipm-opt').forEach(btn => {
                        btn.onmouseenter = () => {
                            btn.style.background = 'rgba(99,102,241,0.25)';
                            btn.style.borderColor = 'var(--accent,#6366f1)';
                        };
                        btn.onmouseleave = () => {
                            btn.style.background = 'rgba(255,255,255,0.06)';
                            btn.style.borderColor = 'rgba(255,255,255,0.12)';
                        };
                        btn.onclick = () => {
                            const pos = btn.dataset.pos;
                            if (pos === 'start') close(0);
                            else if (pos === 'current') close(currentIdx + 1);
                            else if (pos === 'end') close(count);
                        };
                    });

                    const customBtn = modal.querySelector('#_ipm-custom-btn');
                    const customInput = modal.querySelector('#_ipm-custom-idx');
                    if (customBtn && customInput) {
                        customBtn.onclick = () => {
                            let val = parseInt(customInput.value, 10);
                            if (isNaN(val) || val < 1) val = 1;
                            if (val > count + 1) val = count + 1;
                            close(val - 1);
                        };
                        customInput.onkeydown = (e) => {
                            if (e.key === 'Enter') customBtn.click();
                        };
                    }

                    modal.querySelector('#_ipm-close').onclick = () => close(null);
                    modal.querySelector('#_ipm-cancel').onclick = () => close(null);
                    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
                });
            },

            // ============================================================
            // DEXIE DATABASE - Auto-save & Persistence
            // ============================================================
            db: null, // Will be initialized in init()
            dbKey: null,
            isLocked: false,
            autoSaveEnabled: true,
            autoSaveInterval: 30000, // 30 seconds
            autoSaveTimer: null,
            lastSaveTime: null,

            // ============================================================
            // INTERACT.JS - Enhanced Drag & Resize
            // ============================================================
            interactEnabled: true, // Use Interact.js for drag/resize
            snapToGrid: false, // Grid snapping (10px grid)
            snapGridSize: 10,
            smartGuidesEnabled: true,   // Smart guides ON por defecto
            snapToGuidesEnabled: true,  // Magnetismo ON por defecto
            snapThreshold: 2.25,        // px de distancia para activar snap (unscaled)
            _sgSnapped: { x: null, y: null }, // histéresis: ancla activa por eje

            // Drawing Tools State
            _resolvedFonts: {},       // fontName → { bytes, source: 'local'|'metrics'|'google'|'upload' }
            _googleFontsCache: {},    // fontName → ArrayBuffer (descargados en esta sesión)

            viewMode: 'continuous', // 'single' | 'continuous'
            isTwoUpView: false,     // Modo Doble Página / Libro
            twoUpCoverAlone: true,  // Portada individual en doble página

            // Object Selection & Editing State
            selectedObj: null, editingObjId: null,
            multiObjectSelection: new Set(),
            isGroupingSelection: false,
            isFieldEditMode: false,

            // Sidebar & Drag State
            multiSelection: new Set(), draggedPageIndex: null,
            draggedDocId: null, isDraggingInternal: false,
            draggedSortIndex: null, dropTarget: null,
            sidebarCtxIndex: null, lastClickIndex: null,

            // Global Utilities & Clipboard
            clipboard: null, scrollDebounce: null, pendingDropFiles: [],
            searchResults: [], currentSearchIdx: -1, lastSearchTerm: '',

            // INDEX PANEL STATE
            _saveStateTimer: null,
            fontRegistry: {
                // Map font value to CSS family, weight, style, and file path
                fonts: {
                    // Sans-Serif: Arial
                    'Arial': { family: 'Arial', weight: 400, style: 'normal', path: 'fonts/standard_fonts/arial.ttf' },
                    'Arial-Bold': { family: 'Arial', weight: 700, style: 'normal', path: 'fonts/standard_fonts/arialbd.ttf' },
                    'Arial-Italic': { family: 'Arial', weight: 400, style: 'italic', path: 'fonts/standard_fonts/ariali.ttf' },
                    'Arial-BoldItalic': { family: 'Arial', weight: 700, style: 'italic', path: 'fonts/standard_fonts/arialbi.ttf' },
                    'Arial Narrow': { family: 'Arial Narrow', weight: 400, style: 'normal', path: 'fonts/standard_fonts/ARIALN.TTF' },
                    'Arial Narrow-Bold': { family: 'Arial Narrow', weight: 700, style: 'normal', path: 'fonts/standard_fonts/ARIALNB.TTF' },
                    'Arial Narrow-Italic': { family: 'Arial Narrow', weight: 400, style: 'italic', path: 'fonts/standard_fonts/ARIALNI.TTF' },
                    'Arial Narrow-BoldItalic': { family: 'Arial Narrow', weight: 700, style: 'italic', path: 'fonts/standard_fonts/ARIALNBI.TTF' },
                    // Sans-Serif: Calibri
                    'Calibri': { family: 'Calibri', weight: 400, style: 'normal', path: 'fonts/standard_fonts/calibri.ttf' },
                    'Calibri-Bold': { family: 'Calibri', weight: 700, style: 'normal', path: 'fonts/standard_fonts/calibrib.ttf' },
                    'Calibri-Italic': { family: 'Calibri', weight: 400, style: 'italic', path: 'fonts/standard_fonts/calibrii.ttf' },
                    'Calibri-BoldItalic': { family: 'Calibri', weight: 700, style: 'italic', path: 'fonts/standard_fonts/calibriz.ttf' },
                    'Calibri Light': { family: 'Calibri Light', weight: 300, style: 'normal', path: 'fonts/standard_fonts/calibril.ttf' },
                    'Calibri Light-Italic': { family: 'Calibri Light', weight: 300, style: 'italic', path: 'fonts/standard_fonts/calibrili.ttf' },
                    // Sans-Serif: Impact
                    'Impact': { family: 'Impact', weight: 400, style: 'normal', path: 'fonts/standard_fonts/impact.ttf' },
                    // Sans-Serif: Segoe UI
                    'Segoe UI': { family: 'Segoe UI', weight: 400, style: 'normal', path: 'fonts/standard_fonts/segoeui.ttf' },
                    'Segoe UI-Bold': { family: 'Segoe UI', weight: 700, style: 'normal', path: 'fonts/standard_fonts/segoeuib.ttf' },
                    'Segoe UI-Italic': { family: 'Segoe UI', weight: 400, style: 'italic', path: 'fonts/standard_fonts/segoeuii.ttf' },
                    'Segoe UI-BoldItalic': { family: 'Segoe UI', weight: 700, style: 'italic', path: 'fonts/standard_fonts/segoeuiz.ttf' },
                    'Segoe UI Light': { family: 'Segoe UI Light', weight: 300, style: 'normal', path: 'fonts/standard_fonts/segoeuil.ttf' },
                    'Segoe UI Semilight': { family: 'Segoe UI Semilight', weight: 350, style: 'normal', path: 'fonts/standard_fonts/segoeuisl.ttf' },
                    // Sans-Serif: Tahoma
                    'Tahoma': { family: 'Tahoma', weight: 400, style: 'normal', path: 'fonts/standard_fonts/tahoma.ttf' },
                    'Tahoma-Bold': { family: 'Tahoma', weight: 700, style: 'normal', path: 'fonts/standard_fonts/tahomabd.ttf' },
                    // Sans-Serif: Trebuchet MS
                    'Trebuchet MS': { family: 'Trebuchet MS', weight: 400, style: 'normal', path: 'fonts/standard_fonts/trebuc.ttf' },
                    'Trebuchet MS-Bold': { family: 'Trebuchet MS', weight: 700, style: 'normal', path: 'fonts/standard_fonts/trebucbd.ttf' },
                    'Trebuchet MS-Italic': { family: 'Trebuchet MS', weight: 400, style: 'italic', path: 'fonts/standard_fonts/trebucit.ttf' },
                    'Trebuchet MS-BoldItalic': { family: 'Trebuchet MS', weight: 700, style: 'italic', path: 'fonts/standard_fonts/trebucbi.ttf' },
                    // Sans-Serif: Verdana
                    'Verdana': { family: 'Verdana', weight: 400, style: 'normal', path: 'fonts/standard_fonts/verdana.ttf' },
                    'Verdana-Bold': { family: 'Verdana', weight: 700, style: 'normal', path: 'fonts/standard_fonts/verdanab.ttf' },
                    'Verdana-Italic': { family: 'Verdana', weight: 400, style: 'italic', path: 'fonts/standard_fonts/verdanai.ttf' },
                    'Verdana-BoldItalic': { family: 'Verdana', weight: 700, style: 'italic', path: 'fonts/standard_fonts/verdanaz.ttf' },
                    // Serif: Georgia
                    'Georgia': { family: 'Georgia', weight: 400, style: 'normal', path: 'fonts/standard_fonts/georgia.ttf' },
                    'Georgia-Bold': { family: 'Georgia', weight: 700, style: 'normal', path: 'fonts/standard_fonts/georgiab.ttf' },
                    'Georgia-Italic': { family: 'Georgia', weight: 400, style: 'italic', path: 'fonts/standard_fonts/georgiai.ttf' },
                    'Georgia-BoldItalic': { family: 'Georgia', weight: 700, style: 'italic', path: 'fonts/standard_fonts/georgiaz.ttf' },
                    // Serif: Times New Roman
                    'Times New Roman': { family: 'Times New Roman', weight: 400, style: 'normal', path: 'fonts/standard_fonts/times.ttf' },
                    'Times New Roman-Bold': { family: 'Times New Roman', weight: 700, style: 'normal', path: 'fonts/standard_fonts/timesbd.ttf' },
                    'Times New Roman-Italic': { family: 'Times New Roman', weight: 400, style: 'italic', path: 'fonts/standard_fonts/timesi.ttf' },
                    'Times New Roman-BoldItalic': { family: 'Times New Roman', weight: 700, style: 'italic', path: 'fonts/standard_fonts/timesbi.ttf' },
                    // Monospace: Consolas
                    'Consolas': { family: 'Consolas', weight: 400, style: 'normal', path: 'fonts/standard_fonts/consola.ttf' },
                    'Consolas-Bold': { family: 'Consolas', weight: 700, style: 'normal', path: 'fonts/standard_fonts/consolab.ttf' },
                    'Consolas-Italic': { family: 'Consolas', weight: 400, style: 'italic', path: 'fonts/standard_fonts/consolai.ttf' },
                    'Consolas-BoldItalic': { family: 'Consolas', weight: 700, style: 'italic', path: 'fonts/standard_fonts/consolaz.ttf' },
                    // Monospace: Courier New
                    'Courier New': { family: 'Courier New', weight: 400, style: 'normal', path: 'fonts/standard_fonts/cour.ttf' },
                    'Courier New-Bold': { family: 'Courier New', weight: 700, style: 'normal', path: 'fonts/standard_fonts/courbd.ttf' },
                    'Courier New-Italic': { family: 'Courier New', weight: 400, style: 'italic', path: 'fonts/standard_fonts/couri.ttf' },
                    'Courier New-BoldItalic': { family: 'Courier New', weight: 700, style: 'italic', path: 'fonts/standard_fonts/courbi.ttf' },
                    // Sans-Serif: Roboto (comentado - usar fuentes del sistema)
                    // Si tienes los archivos .ttf, descomenta estas líneas:
                    // 'Roboto': { family: 'Roboto', weight: 400, style: 'normal', path: 'fonts/Roboto-Regular.ttf' },
                    // 'Roboto-Bold': { family: 'Roboto', weight: 700, style: 'normal', path: 'fonts/Roboto-Bold.ttf' },
                    // 'Roboto-Italic': { family: 'Roboto', weight: 400, style: 'italic', path: 'fonts/Roboto-Italic.ttf' },
                    // 'Roboto-BoldItalic': { family: 'Roboto', weight: 700, style: 'italic', path: 'fonts/Roboto-BoldItalic.ttf' },
                    // Fallback: usar Arial como equivalente a Roboto
                    'Roboto': { family: 'Arial', weight: 400, style: 'normal', path: 'fonts/standard_fonts/arial.ttf' },
                    'Roboto-Bold': { family: 'Arial', weight: 700, style: 'normal', path: 'fonts/standard_fonts/arialbd.ttf' },
                    'Roboto-Italic': { family: 'Arial', weight: 400, style: 'italic', path: 'fonts/standard_fonts/ariali.ttf' },
                    'Roboto-BoldItalic': { family: 'Arial', weight: 700, style: 'italic', path: 'fonts/standard_fonts/arialbi.ttf' },
                    // PDF Standard Fonts - embed Arial TTF so app (which renders Helvetica as Arial) matches PDF output
                    'Helvetica': { family: 'Arial', weight: 400, style: 'normal', path: 'fonts/standard_fonts/arial.ttf' },
                    'Helvetica-Bold': { family: 'Arial', weight: 700, style: 'normal', path: 'fonts/standard_fonts/arialbd.ttf' },
                    'Helvetica-Oblique': { family: 'Arial', weight: 400, style: 'italic', path: 'fonts/standard_fonts/ariali.ttf' },
                    'Times-Roman': { family: 'Times New Roman', weight: 400, style: 'normal', path: 'fonts/standard_fonts/times.ttf', pdfStandard: 'TimesRoman' },
                    'Times-Bold': { family: 'Times New Roman', weight: 700, style: 'normal', path: 'fonts/standard_fonts/timesbd.ttf', pdfStandard: 'TimesBold' },
                    'Times-Italic': { family: 'Times New Roman', weight: 400, style: 'italic', path: 'fonts/standard_fonts/timesi.ttf', pdfStandard: 'TimesItalic' },
                    'Courier': { family: 'Courier New', weight: 400, style: 'normal', path: 'fonts/standard_fonts/cour.ttf', pdfStandard: 'Courier' },
                    'Courier-Bold': { family: 'Courier New', weight: 700, style: 'normal', path: 'fonts/standard_fonts/courbd.ttf', pdfStandard: 'CourierBold' },
                    'Courier-Oblique': { family: 'Courier New', weight: 400, style: 'italic', path: 'fonts/standard_fonts/couri.ttf', pdfStandard: 'CourierOblique' }
                },
                // Cache for loaded font bytes (for PDF embedding)
                loadedFonts: {},

                /**
                 * Get CSS font string for canvas rendering
                 * @param {string} fontKey - The font selector value
                 * @param {number} size - Font size in pixels
                 * @param {boolean} bold - Override bold (for B button)
                 * @param {boolean} italic - Override italic (for I button)
                 * @returns {string} CSS font string
                 */
                getCSSFont: function (fontKey, size, bold, italic) {
                    const info = this.fonts[fontKey];
                    if (!info) {
                        // Fallback for unknown fonts
                        const style = italic ? 'italic' : 'normal';
                        const weight = bold ? 'bold' : 'normal';
                        return `${style} ${weight} ${size}px ${fontKey}, Arial, sans - serif`;
                    }
                    // Use font's built-in style unless overridden
                    const style = italic ? 'italic' : (info.style || 'normal');
                    const weight = bold ? 700 : (info.weight || 400);
                    return `${style} ${weight} ${size}px "${info.family}", Arial, sans - serif`;
                },

                /**
                 * Load font bytes for PDF embedding
                 * @param {string} fontKey - The font selector value
                 * @returns {Promise<ArrayBuffer|null>} Font bytes or null if PDF standard
                 */
                loadFontBytes: async function (fontKey) {
                    const info = this.fonts[fontKey];
                    if (!info) return null;

                    // If it's a PDF standard font, always use the standard — never load custom bytes
                    if (info.pdfStandard) return null;

                    // Check cache first
                    if (this.loadedFonts[fontKey]) {
                        return this.loadedFonts[fontKey];
                    }

                    // ✅ Check system font bytes cache (loaded via Local Font Access API)
                    const appRef = typeof app !== 'undefined' ? app : null;
                    if (appRef?._systemFontSources?.[fontKey]) {
                        const bytes = await appRef.loadSystemFontBytes(fontKey);
                        if (bytes) return bytes;
                    }
                    if (appRef && appRef._systemFontBytes && appRef._systemFontBytes[fontKey]) {
                        console.log('📦 Using cached system font bytes:', fontKey);
                        return appRef._systemFontBytes[fontKey];
                    }
                    // Also try base family name for system fonts
                    if (appRef && appRef._systemFontBytes && info.family) {
                        if (appRef._systemFontBytes[info.family]) {
                            console.log('📦 Using cached system font bytes (base family):', info.family);
                            return appRef._systemFontBytes[info.family];
                        }
                    }

                    // Load from file
                    if (info.path) {
                        try {
                            const response = await fetch(info.path);
                            if (response.ok) {
                                const bytes = await response.arrayBuffer();
                                this.loadedFonts[fontKey] = bytes;
                                return bytes;
                            }
                        } catch (e) {
                            console.warn('Failed to load font:', fontKey, e);
                        }
                    }
                    return null;
                },

                /**
                 * Embed a font in a PDFDocument
                 * @param {PDFDocument} pdfDoc - The PDF document
                 * @param {string} fontKey - The font selector value  
                 * @returns {Promise<PDFFont>} Embedded font
                 */
                embedFont: async function (pdfDoc, fontKey) {
                    const info = this.fonts[fontKey];

                    // Use PDF standard font if available
                    if (info?.pdfStandard) {
                        return await pdfDoc.embedFont(PDFLib.StandardFonts[info.pdfStandard]);
                    }

                    // Try to load and embed custom font
                    const bytes = await this.loadFontBytes(fontKey);
                    if (bytes) {
                        try {
                            return await pdfDoc.embedFont(bytes);
                        } catch (e) {
                            console.warn('Failed to embed font:', fontKey, e);
                        }
                    }

                    // ✅ Try system font bytes as last resort before pipeline
                    const appRef = typeof app !== 'undefined' ? app : null;
                    if (appRef && appRef._systemFontBytes) {
                        const systemBytes = appRef._systemFontBytes[fontKey] || appRef._systemFontBytes[info?.family];
                        if (systemBytes) {
                            try {
                                console.log('📦 Embedding system font for:', fontKey);
                                return await pdfDoc.embedFont(systemBytes);
                            } catch (e) {
                                console.warn('Failed to embed system font:', fontKey, e);
                            }
                        }
                    }

                    // 🔀 Font Resolution Pipeline (Niveles 2-5)
                    if (appRef && appRef.fontResolutionPipeline) {
                        const resolved = await appRef.fontResolutionPipeline(fontKey, info);
                        if (resolved) {
                            try {
                                return await pdfDoc.embedFont(resolved.bytes);
                            } catch (e) {
                                console.warn('Pipeline font embed failed:', e);
                            }
                        }
                    }

                    // Último recurso: Helvetica
                    console.warn('⚠️ Font fallback final to Helvetica for:', fontKey);
                    return await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
                }
            },

            /**
             * Font Recognition System - For automatic font matching
             * Maps PDF internal font names to local equivalents
             */
            fontRecognition: {
                // PDF font name → local font key mapping
                pdfToLocalMapping: {
                    // Adobe/Standard font names - Arial family
                    'ArialMT': 'Arial',
                    'Arial-BoldMT': 'Arial-Bold',
                    'Arial-ItalicMT': 'Arial-Italic',
                    'Arial-BoldItalicMT': 'Arial-BoldItalic',
                    'ArialNarrow': 'Arial Narrow',
                    'ArialNarrow-Bold': 'Arial Narrow-Bold',
                    'ArialNarrow-Italic': 'Arial Narrow-Italic',
                    'ArialNarrow-BoldItalic': 'Arial Narrow-BoldItalic',
                    // Times New Roman
                    'TimesNewRomanPSMT': 'Times New Roman',
                    'TimesNewRomanPS-BoldMT': 'Times New Roman-Bold',
                    'TimesNewRomanPS-ItalicMT': 'Times New Roman-Italic',
                    'TimesNewRomanPS-BoldItalicMT': 'Times New Roman-BoldItalic',
                    'TimesNewRoman': 'Times New Roman',
                    'TimesNewRoman-Bold': 'Times New Roman-Bold',
                    'TimesNewRoman,Bold': 'Times New Roman-Bold',
                    'TimesNewRoman,Italic': 'Times New Roman-Italic',
                    // Calibri
                    'Calibri': 'Calibri',
                    'Calibri-Bold': 'Calibri-Bold',
                    'Calibri-Italic': 'Calibri-Italic',
                    'Calibri-BoldItalic': 'Calibri-BoldItalic',
                    'Calibri-Light': 'Calibri Light',
                    'Calibri,Bold': 'Calibri-Bold',
                    'Calibri,Italic': 'Calibri-Italic',
                    // Verdana
                    'Verdana': 'Verdana',
                    'Verdana-Bold': 'Verdana-Bold',
                    'Verdana-Italic': 'Verdana-Italic',
                    'Verdana-BoldItalic': 'Verdana-BoldItalic',
                    // Tahoma
                    'Tahoma': 'Tahoma',
                    'Tahoma-Bold': 'Tahoma-Bold',
                    // Georgia
                    'Georgia': 'Georgia',
                    'Georgia-Bold': 'Georgia-Bold',
                    'Georgia-Italic': 'Georgia-Italic',
                    'Georgia-BoldItalic': 'Georgia-BoldItalic',
                    // Segoe UI
                    'SegoeUI': 'Segoe UI',
                    'SegoeUI-Bold': 'Segoe UI-Bold',
                    'SegoeUI-Italic': 'Segoe UI-Italic',
                    'SegoeUI-BoldItalic': 'Segoe UI-BoldItalic',
                    'SegoeUI-Light': 'Segoe UI Light',
                    'SegoeUI-Semilight': 'Segoe UI Semilight',
                    // Trebuchet MS
                    'TrebuchetMS': 'Trebuchet MS',
                    'TrebuchetMS-Bold': 'Trebuchet MS-Bold',
                    'TrebuchetMS-Italic': 'Trebuchet MS-Italic',
                    'TrebuchetMS-BoldItalic': 'Trebuchet MS-BoldItalic',
                    // Consolas
                    'Consolas': 'Consolas',
                    'Consolas-Bold': 'Consolas-Bold',
                    'Consolas-Italic': 'Consolas-Italic',
                    'Consolas-BoldItalic': 'Consolas-BoldItalic',
                    // Cambria
                    'Cambria': 'Cambria',
                    'Cambria-Bold': 'Cambria-Bold',
                    'Cambria-Italic': 'Cambria-Italic',
                    'Cambria-BoldItalic': 'Cambria-BoldItalic',
                    // Candara
                    'Candara': 'Candara',
                    'Candara-Bold': 'Candara-Bold',
                    // Corbel
                    'Corbel': 'Corbel',
                    'Corbel-Bold': 'Corbel-Bold',
                    // Constantia
                    'Constantia': 'Constantia',
                    'Constantia-Bold': 'Constantia-Bold',
                    // Franklin Gothic
                    'FranklinGothicMedium': 'Franklin Gothic Medium',
                    'FranklinGothic-Medium': 'Franklin Gothic Medium',
                    // Century Gothic  
                    'CenturyGothic': 'Century Gothic',
                    'CenturyGothic-Bold': 'Century Gothic-Bold',
                    // Palatino
                    'PalatinoLinotype': 'Palatino Linotype',
                    'PalatinoLinotype-Roman': 'Palatino Linotype',
                    'PalatinoLinotype-Bold': 'Palatino Linotype-Bold',
                    // Garamond
                    'Garamond': 'Garamond',
                    'Garamond-Bold': 'Garamond-Bold',
                    // Book Antiqua
                    'BookAntiqua': 'Book Antiqua',
                    'BookAntiqua-Bold': 'Book Antiqua-Bold',
                    // Lucida
                    'LucidaConsole': 'Lucida Console',
                    'LucidaSansUnicode': 'Lucida Sans Unicode',
                    // Impact
                    'Impact': 'Impact',
                    // Courier New
                    'CourierNewPSMT': 'Courier New',
                    'CourierNewPS-BoldMT': 'Courier New-Bold',
                    'CourierNewPS-ItalicMT': 'Courier New-Italic',
                    'CourierNewPS-BoldItalicMT': 'Courier New-BoldItalic',
                    // Roboto
                    'Roboto-Regular': 'Roboto',
                    'Roboto-Bold': 'Roboto-Bold',
                    'Roboto-Italic': 'Roboto-Italic',
                    'Roboto-BoldItalic': 'Roboto-BoldItalic',
                    // PDF Standard fonts
                    'Helvetica': 'Helvetica',
                    'Helvetica-Bold': 'Helvetica-Bold',
                    'Helvetica-Oblique': 'Helvetica-Oblique',
                    'Helvetica-BoldOblique': 'Helvetica-Bold',
                    'Times-Roman': 'Times-Roman',
                    'Times-Bold': 'Times-Bold',
                    'Times-Italic': 'Times-Italic',
                    'Courier': 'Courier',
                    'Courier-Bold': 'Courier-Bold',
                    'Courier-Oblique': 'Courier-Oblique'
                },

                // Font similarity groups for fallback
                fontFamilies: {
                    'Arial': ['Helvetica', 'Segoe UI', 'Verdana', 'Tahoma'],
                    'Calibri': ['Segoe UI', 'Arial', 'Helvetica'],
                    'Times New Roman': ['Times-Roman', 'Georgia', 'Times'],
                    'Verdana': ['Tahoma', 'Arial', 'Segoe UI'],
                    'Georgia': ['Times New Roman', 'Times-Roman'],
                    'Courier New': ['Courier', 'Consolas'],
                    'Consolas': ['Courier New', 'Courier'],
                    'Roboto': ['Arial', 'Helvetica', 'Segoe UI']
                },

                /**
                 * Find the best local font match for a PDF font name
                 * @param {string} pdfFontName - Font name from PDF
                 * @returns {string} - Local font key
                 */
                matchFont: function (pdfFontName) {
                    if (!pdfFontName) return 'Arial';

                    // Direct mapping
                    if (this.pdfToLocalMapping[pdfFontName]) {
                        return this.pdfToLocalMapping[pdfFontName];
                    }

                    // Handle subset fonts (AAAAAA+FontName format)
                    const subsetMatch = pdfFontName.match(/^[A-Z]{6}\+(.+)$/);
                    if (subsetMatch) {
                        return this.matchFont(subsetMatch[1]);
                    }

                    // Fuzzy match by family name
                    const cleanName = pdfFontName.replace(/[-_,]/g, ' ').toLowerCase();
                    const knownFamilies = ['arial', 'calibri', 'times', 'verdana', 'georgia', 'tahoma', 'courier', 'consolas', 'segoe', 'trebuchet', 'impact', 'roboto'];

                    for (const family of knownFamilies) {
                        if (cleanName.includes(family)) {
                            // Determine weight/style
                            const isBold = cleanName.includes('bold') || cleanName.includes('black');
                            const isItalic = cleanName.includes('italic') || cleanName.includes('oblique');

                            let variant = family.charAt(0).toUpperCase() + family.slice(1);
                            if (family === 'times') variant = 'Times New Roman';
                            if (family === 'segoe') variant = 'Segoe UI';
                            if (family === 'trebuchet') variant = 'Trebuchet MS';
                            if (family === 'courier') variant = 'Courier New';

                            if (isBold && isItalic) variant += '-BoldItalic';
                            else if (isBold) variant += '-Bold';
                            else if (isItalic) variant += '-Italic';

                            return variant;
                        }
                    }

                    // Default fallback
                    // Default fallback: return a cleaned version of the original name
                    // instead of a hardcoded 'Arial' to allow fuzzy matching downstream
                    return pdfFontName.replace(/^[A-Z]{6}\+/, '');
                },

                /**
                 * Analyzes a PDF font name and extracts style information
                 * @param {string} pdfFontName - Font name like "AAAAAA+Helvetica-BoldOblique"
                 * @returns {Object} { original, clean, isBold, isItalic, isSerif, isMono, localFont }
                 */
                analyzeFontName: function (pdfFontName) {
                    if (!pdfFontName) {
                        return {
                            original: '',
                            clean: '',
                            isBold: false,
                            isItalic: false,
                            isSerif: false,
                            isMono: false,
                            localFont: 'Arial'
                        };
                    }

                    // Remove subset prefix (AAAAAA+FontName format)
                    let cleanName = pdfFontName.replace(/^[A-Z]{6}\+/, '');
                    const lowerName = cleanName.toLowerCase();

                    // Detect styles from font name
                    const isBold = /bold|black|heavy|demi|semibold|extrabold/i.test(cleanName);
                    const isItalic = /italic|oblique|inclined|slanted/i.test(cleanName);

                    // Detect font type for fallback purposes
                    const isSerif = (/times|georgia|garamond|palatino|cambria|book|roman|serif/i.test(cleanName)) &&
                        !/sans/i.test(cleanName);
                    const isMono = /courier|mono|consolas|code|fixed|terminal|typewriter/i.test(cleanName);

                    // Get best local font match
                    const localFont = this.matchFont(pdfFontName);

                    return {
                        original: pdfFontName,
                        clean: cleanName,
                        isBold: isBold,
                        isItalic: isItalic,
                        isSerif: isSerif,
                        isMono: isMono,
                        localFont: localFont
                    };
                },

                /**
                 * Generates CSS font-family string with appropriate fallbacks
                 * @param {Object} fontInfo - Result from analyzeFontName()
                 * @returns {string} CSS font-family value
                 */
                getCSSFontFamily: function (fontInfo) {
                    // First, try to use the clean font name directly if it's meaningful
                    // (not an internal ID like "g_d0_f3")
                    const cleanName = fontInfo.clean || '';
                    const isInternalId = /^g_d\d+_f\d+$/i.test(cleanName);

                    if (!isInternalId && cleanName && cleanName.length > 2) {
                        // Extract base font family (remove Bold, Italic, etc. suffixes)
                        let baseName = cleanName
                            .replace(/[-_]?(Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|Thin|Condensed|Extended|BoldItalic|BoldOblique)/gi, '')
                            .replace(/[-_]+$/, '')
                            .trim();

                        // If we have a valid base name, use it with fallback
                        if (baseName && baseName.length > 1) {
                            const fallback = fontInfo.isMono ? 'monospace' :
                                fontInfo.isSerif ? 'serif' : 'sans-serif';
                            return `"${baseName}", ${fallback} `;
                        }
                    }

                    // Try to use local font from registry
                    const registry = app.fontRegistry || (this.parent ? this.parent.fontRegistry : null);
                    const localFontData = registry && registry.fonts ? registry.fonts[fontInfo.localFont] : null;

                    if (localFontData && localFontData.family) {
                        // Use registered local font with appropriate fallback
                        const fallback = fontInfo.isMono ? 'monospace' :
                            fontInfo.isSerif ? 'serif' : 'sans-serif';
                        return `"${localFontData.family}", ${fallback} `;
                    }

                    // Fallback based on detected font type
                    if (fontInfo.isMono) {
                        return '"Courier New", Courier, monospace';
                    }
                    if (fontInfo.isSerif) {
                        return '"Times New Roman", Times, serif';
                    }

                    // Default sans-serif
                    return 'Arial, Helvetica, sans-serif';
                }
            },

            // ============================================================
            // FONT RESOLUTION PIPELINE (Niveles 1-5)
            // ============================================================

            /**
             * Pipeline principal de resolución de fuentes.
             * Intenta resolver en orden: métricas locales → Google Fonts → carga manual.
             * @param {string} fontKey  - Nombre de la fuente que no se encontró
             * @param {Object} fontInfo - info del registro (puede ser null)
             * @returns {Promise<{bytes: ArrayBuffer, source: string}|null>}
             */
            fontResolutionPipeline: async function (fontKey, fontInfo) {
                // --- Cache de sesión ---
                if (this._resolvedFonts[fontKey]) {
                    console.log(`🗃️ Pipeline cache hit: ${fontKey}`);
                    return this._resolvedFonts[fontKey];
                }

                console.log(`🔀 Font Resolution Pipeline iniciado para: "${fontKey}"`);

                // ── NIVEL 2: Google Fonts (prioritario sobre métricas) ───
                // Enfoque Adobe/Nitro: buscar la fuente REAL antes de aceptar un sustituto.
                // Si GF tiene la fuente → todos los glifos disponibles (acentos, especiales).
                // Si no hay red → caer a métricas locales.
                const gfBytes = await this._fetchGoogleFont(fontKey, fontInfo);
                if (gfBytes) {
                    console.log(`✅ Nivel 2 (Google Fonts): "${fontKey}"`);
                    const result = { bytes: gfBytes, source: 'google', resolvedAs: fontKey };
                    this._resolvedFonts[fontKey] = result;
                    if (this.showToast) this.showToast(`🌐 Fuente descargada: ${fontKey.split(',')[0]}`, 3000);
                    return result;
                }

                // ── NIVEL 3: Font matching por métricas (sustituto local) ─
                const metricsMatch = this._matchFontByMetrics(fontKey, fontInfo);
                if (metricsMatch) {
                    const localBytes = await this.fontRegistry.loadFontBytes.call(this.fontRegistry, metricsMatch);
                    if (localBytes) {
                        console.log(`✅ Nivel 3 (métricas): "${fontKey}" → "${metricsMatch}"`);
                        const result = { bytes: localBytes, source: 'metrics', resolvedAs: metricsMatch };
                        this._resolvedFonts[fontKey] = result;
                        return result;
                    }
                }

                // ── NIVEL 4: Carga manual del usuario ───────────────────
                const uploadedBytes = await this._showFontUploadPrompt(fontKey);
                if (uploadedBytes) {
                    console.log(`✅ Nivel 4 (upload): "${fontKey}"`);
                    const result = { bytes: uploadedBytes, source: 'upload', resolvedAs: fontKey };
                    this._resolvedFonts[fontKey] = result;
                    // Registrar en _systemFontBytes para reuso
                    if (!this._systemFontBytes) this._systemFontBytes = {};
                    this._systemFontBytes[fontKey] = uploadedBytes;
                    return result;
                }

                // ── NIVEL 5: Mejor sustituto disponible (métricas o GF) ─
                // El usuario ignoró el prompt — usamos el mejor resultado previo
                if (metricsMatch) {
                    const fallbackBytes = await this.fontRegistry.loadFontBytes.call(this.fontRegistry, metricsMatch);
                    if (fallbackBytes) {
                        console.warn(`⚠️ Nivel 5 (mejor sustituto): "${fontKey}" → "${metricsMatch}"`);
                        const result = { bytes: fallbackBytes, source: 'metrics-fallback', resolvedAs: metricsMatch };
                        this._resolvedFonts[fontKey] = result;
                        return result;
                    }
                }

                console.warn(`❌ Pipeline sin resultado para: "${fontKey}"`);
                return null;
            },

            /**
             * Nivel 2: Selecciona la fuente local más cercana por métricas y características.
             * Analiza: serif/sans, mono, bold, italic, y similitud de nombre.
             * @param {string} fontKey
             * @param {Object} fontInfo
             * @returns {string|null} - Key de fuente en fontRegistry.fonts
             */
            _matchFontByMetrics: function (fontKey, fontInfo) {
                const availableKeys = Object.keys(this.fontRegistry.fonts);
                const lc = fontKey.toLowerCase();

                const isBold   = /bold|black|heavy|demi|semibold|extrabold/i.test(fontKey);
                const isItalic = /italic|oblique|inclined/i.test(fontKey);
                const isMono   = /courier|mono|consolas|code|fixed|terminal|typewriter/i.test(fontKey);
                const isSerif  = /times|georgia|garamond|palatino|cambria|book|roman|serif/i.test(fontKey) && !/sans/i.test(fontKey);
                const isSans   = !isSerif && !isMono;

                // Tabla de métricas aproximadas por categoría (normalizado 0-1)
                // [ascender, capHeight, xHeight, descender] relativos al em
                const metricProfiles = {
                    'sans-serif':  [0.90, 0.72, 0.52, 0.22],
                    'serif':       [0.90, 0.68, 0.47, 0.22],
                    'mono':        [0.85, 0.65, 0.45, 0.20],
                    'condensed':   [0.92, 0.72, 0.52, 0.22],
                    'geometric':   [0.88, 0.70, 0.51, 0.21],
                };

                // Perfil de la fuente buscada
                const targetCat = isMono ? 'mono' : isSerif ? 'serif' : 'sans-serif';
                const targetProfile = metricProfiles[targetCat];

                // Perfiles conocidos de fuentes en la biblioteca
                const fontProfiles = {
                    'Arial':          { cat: 'sans-serif',  profile: [0.90, 0.72, 0.52, 0.21] },
                    'Calibri':        { cat: 'sans-serif',  profile: [0.88, 0.69, 0.51, 0.19] },
                    'Segoe UI':       { cat: 'sans-serif',  profile: [0.89, 0.70, 0.52, 0.20] },
                    'Verdana':        { cat: 'sans-serif',  profile: [0.92, 0.73, 0.55, 0.22] },
                    'Tahoma':         { cat: 'sans-serif',  profile: [0.91, 0.72, 0.54, 0.22] },
                    'Trebuchet MS':   { cat: 'sans-serif',  profile: [0.93, 0.72, 0.53, 0.24] },
                    'Impact':         { cat: 'condensed',   profile: [0.95, 0.74, 0.52, 0.22] },
                    'Arial Narrow':   { cat: 'condensed',   profile: [0.92, 0.72, 0.52, 0.21] },
                    'Georgia':        { cat: 'serif',       profile: [0.92, 0.69, 0.48, 0.22] },
                    'Times New Roman':{ cat: 'serif',       profile: [0.89, 0.66, 0.44, 0.22] },
                    'Consolas':       { cat: 'mono',        profile: [0.85, 0.65, 0.45, 0.20] },
                    'Courier New':    { cat: 'mono',        profile: [0.83, 0.63, 0.43, 0.20] },
                };

                // Score: penaliza diferencia de perfil (60%) + categoría (30%) + bold/italic match (10%)
                let bestKey = null;
                let bestScore = Infinity;

                for (const [baseName, meta] of Object.entries(fontProfiles)) {
                    // Penalización por categoría incorrecta
                    let catPenalty = 0;
                    if (isMono && meta.cat !== 'mono') catPenalty = 100;
                    else if (isSerif && meta.cat !== 'serif') catPenalty = 40;
                    else if (isSans && meta.cat === 'serif') catPenalty = 30;
                    else if (isSans && meta.cat === 'mono') catPenalty = 80;

                    // Distancia euclidiana de perfiles
                    const profileDist = Math.sqrt(
                        meta.profile.reduce((sum, v, i) => sum + Math.pow(v - targetProfile[i], 2), 0)
                    ) * 60;

                    const score = profileDist + catPenalty;

                    // Bonus por coincidencia parcial de nombre
                    const nameBonus = lc.includes(baseName.toLowerCase().split(' ')[0]) ? -20 : 0;

                    const finalScore = score + nameBonus;
                    if (finalScore < bestScore) {
                        bestScore = finalScore;
                        bestKey = baseName;
                    }
                }

                if (!bestKey) return null;

                // Bonus extra para fuentes que el usuario tiene cargadas en el sistema
                // Esto permite que Calibri gane sobre Arial cuando viene de Excel/Office
                const appRef2 = typeof app !== 'undefined' ? app : null;
                if (appRef2 && appRef2._systemFontBytes) {
                    let systemBestKey = null;
                    let systemBestScore = Infinity;
                    for (const [baseName, meta] of Object.entries(fontProfiles)) {
                        if (!appRef2._systemFontBytes[baseName] && !appRef2._systemFontSources?.[baseName]) continue;
                        let catPenalty = 0;
                        if (isMono && meta.cat !== 'mono') catPenalty = 100;
                        else if (isSerif && meta.cat !== 'serif') catPenalty = 40;
                        else if (isSans && meta.cat === 'serif') catPenalty = 30;
                        else if (isSans && meta.cat === 'mono') catPenalty = 80;
                        const profileDist = Math.sqrt(
                            meta.profile.reduce((sum, v, i) => sum + Math.pow(v - targetProfile[i], 2), 0)
                        ) * 60;
                        const nameBonus = lc.includes(baseName.toLowerCase().split(' ')[0]) ? -20 : 0;
                        const score = profileDist + catPenalty + nameBonus - 10; // -10 bonus por ser fuente del sistema
                        if (score < systemBestScore) { systemBestScore = score; systemBestKey = baseName; }
                    }
                    const threshold = bestScore * 1.15 + 3;
                    if (systemBestKey && systemBestScore <= threshold) {
                        console.log(`🎯 [FontMatch] Sistema prefiere "${systemBestKey}" (score=${systemBestScore.toFixed(2)}) sobre "${bestKey}" (score=${bestScore.toFixed(2)}) [threshold=${threshold.toFixed(2)}]`);
                        bestKey = systemBestKey;
                    }
                }

                // Agregar sufijo de variante si corresponde
                let variantKey = bestKey;
                if (isBold && isItalic) variantKey = bestKey + '-BoldItalic';
                else if (isBold)        variantKey = bestKey + '-Bold';
                else if (isItalic)      variantKey = bestKey + '-Italic';

                // Verificar que exista en el registro
                if (this.fontRegistry.fonts[variantKey]) return variantKey;
                if (this.fontRegistry.fonts[bestKey])    return bestKey;
                return null;
            },

            /**
             * Nivel 3: Descarga fuente desde Google Fonts API.
             * Extrae el nombre base de la fuente, consulta la API y descarga el TTF.
             * @param {string} fontKey
             * @param {Object} fontInfo
             * @returns {Promise<ArrayBuffer|null>}
             */
            _fetchGoogleFont: async function (fontKey, fontInfo) {
                // Cache de sesión
                if (this._googleFontsCache[fontKey]) return this._googleFontsCache[fontKey];

                // Cache persistente localStorage
                try {
                    const _lsKey = 'alioth_gf_' + fontKey.replace(/[^a-zA-Z0-9]/g, '_');
                    const _lsCached = localStorage.getItem(_lsKey);
                    if (_lsCached) {
                        const _u8 = Uint8Array.from(atob(_lsCached), c => c.charCodeAt(0));
                        // Validar magic: TTF=00010000, OTF=4F54544F, TrueType=74727565
                        const _isTTF = (_u8[0]===0x00 && _u8[1]===0x01 && _u8[2]===0x00 && _u8[3]===0x00);
                        const _isOTF = (_u8[0]===0x4F && _u8[1]===0x54 && _u8[2]===0x54 && _u8[3]===0x4F);
                        const _isTT  = (_u8[0]===0x74 && _u8[1]===0x72 && _u8[2]===0x75 && _u8[3]===0x65);
                        if (!_isTTF && !_isOTF && !_isTT) {
                            console.warn(`💾 GF: cache inválido magic=${_u8[0].toString(16)} para "${fontKey}" → purgando`);
                            localStorage.removeItem(_lsKey);
                            delete this._googleFontsCache[fontKey];
                            // Continuar al fetch fresco
                        } else {
                            const _buf = _u8.buffer;
                            this._googleFontsCache[fontKey] = _buf;
                            if (this.fontRegistry && this.fontRegistry.fonts && !this.fontRegistry.fonts[fontKey]) {
                                const _iB = /bold|black|heavy|demi|semibold/i.test(fontKey);
                                const _iI = /italic|oblique/i.test(fontKey);
                                const _fam = fontKey.replace(/^[A-Z]{6}\+/, '').replace(/[\s,_-]*(Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|Thin|Condensed)/gi, '').replace(/[,_-]+/g,' ').trim();
                                this.fontRegistry.fonts[fontKey] = { family: _fam, weight: _iB ? 700 : 400, style: _iI ? 'italic' : 'normal', googleFont: true };
                            }
                            console.log(`💾 Google Fonts: cargado desde localStorage: "${fontKey}"`);
                            return _buf;
                        }
                    }
                } catch(_lse) {}

                // --- Limpieza robusta del nombre base ---
                // Sufijos que pueden aparecer separados por coma, espacio, guión o underscore
                const _suffixRx = /[\s,_-]*(Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|Thin|Condensed|BoldItalic|BoldOblique|SemiBold|ExtraBold|Narrow|Extended|Compressed|Display|Text|Caption|Mono)/gi;
                let baseName = fontKey
                    .replace(/^[A-Z]{6}\+/, '')   // quitar subset prefix BCDEEE+
                    .replace(_suffixRx, '')        // quitar variantes (coma, guión, etc.)
                    .replace(/MT$|PS$/i, '')       // quitar sufijos de PostScript
                    .replace(/[,_-]+/g, ' ')       // normalizar separadores restantes a espacio
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!baseName || baseName.length < 2) return null;

                const isBold   = /bold|black|heavy|demi|semibold/i.test(fontKey);
                const isItalic = /italic|oblique/i.test(fontKey);

                // Variantes a intentar: exacta, luego sin última palabra (por si quedó algo)
                const _nameCandidates = [baseName];
                const splitCamel = baseName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
                if (splitCamel !== baseName) {
                    _nameCandidates.push(splitCamel);
                }
                if (baseName.includes(' ')) {
                    // e.g. "Libre Baskerville" → también intentar solo "Libre"
                    _nameCandidates.push(baseName.split(' ').slice(0, -1).join(' '));
                }
                if (splitCamel.includes(' ') && !baseName.includes(' ')) {
                    _nameCandidates.push(splitCamel.split(' ').slice(0, -1).join(' '));
                }

                // Construir URL GF CSS API v2 correcta:
                // familia con espacios → reemplazar por '+'  (NO encodeURIComponent del nombre completo)
                // URL directa al proxy con parámetros estructurados
                // El proxy descarga CSS+TTF con UA antiguo y cachea en disco
                const _buildGfUrl = (name) => {
                    const weight = isBold ? '700' : '400';
                    const italic = isItalic ? '1' : '0';
                    const cleanName = name.trim();
                    return `${window.location.origin}/gfonts?family=${encodeURIComponent(cleanName)}&weight=${weight}&italic=${italic}`;
                };

                // Intentar fetch vía JS (funciona en HTTPS/producción)
                // UA antiguo → GF devuelve TTF en lugar de WOFF2 (FreeType/PyMuPDF no soporta WOFF2)
                const _GF_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
                const _extractFontUrl = (css) => {
                    // Preferir TTF; si no hay, tomar woff/woff2 (solo para JS, no para Py)
                    const ttf = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
                    if (ttf) return ttf[1];
                    const any = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.(?:woff|woff2))\)/);
                    return any ? any[1] : null;
                };

                // El proxy /gfonts devuelve TTF directamente (descarga CSS internamente)
                const _tryJsFetch = async (proxyUrl) => {
                    try {
                        console.log(`🌐 [GF-JS] fetch proxy: ${proxyUrl}`);
                        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
                        if (!resp.ok) { console.warn(`🌐 [GF-JS] proxy resp ${resp.status}`); return null; }
                        const buf = await resp.arrayBuffer();
                        const magic = new Uint8Array(buf, 0, 4);
                        const magicStr = Array.from(magic).map(b=>b.toString(16).padStart(2,'0')).join(' ');
                        console.log(`🌐 [GF-JS] font ${buf.byteLength}B magic=${magicStr}`);
                        if (magic[0] === 0x77 && magic[1] === 0x4F && magic[2] === 0x46 && magic[3] === 0x32) {
                            console.warn('🌐 GF-JS: proxy devolvió WOFF2 — descartando');
                            return null;
                        }
                        return buf;
                    } catch(_jfe) {
                        console.warn(`🌐 [GF-JS] error: ${_jfe.message}`);
                        return null;
                    }
                };

                // Intentar fetch vía Pyodide/urllib con UA antiguo → GF devuelve TTF
                const _tryPyFetch = async (cssUrl) => {
                    if (!window.PythonManager || !PythonManager.isLoaded) return null;
                    try {
                        const b64 = await PythonManager.pyodide.runPythonAsync(`
import urllib.request, base64, re
_GF_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'
_result = None
try:
    _req = urllib.request.Request("${cssUrl}", headers={"User-Agent": _GF_UA})
    with urllib.request.urlopen(_req, timeout=6) as _r:
        _css = _r.read().decode("utf-8")
    # Preferir TTF estricto
    _m = re.search(r'url\\((https://fonts\\.gstatic\\.com/[^)]+\\.ttf)\\)', _css)
    if not _m:
        _m = re.search(r'url\\((https://fonts\\.gstatic\\.com/[^)]+\\.(?:woff(?!2)|woff2))\\)', _css)
    if _m:
        _freq = urllib.request.Request(_m.group(1), headers={"User-Agent": _GF_UA})
        with urllib.request.urlopen(_freq, timeout=12) as _fr:
            _bytes = _fr.read()
        # Rechazar WOFF2 (magic wOF2)
        if _bytes[:4] != b'wOF2':
            _result = base64.b64encode(_bytes).decode()
except Exception as _e:
    pass
_result
`);
                        if (!b64 || b64 === 'None') return null;
                        const _u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                        return _u8.buffer;
                    } catch(_pe) { return null; }
                };

                // Ejecutar con todos los candidatos de nombre
                for (const _candidate of _nameCandidates) {
                    const _url = _buildGfUrl(_candidate);
                    console.log(`🌐 Google Fonts: consultando "${_candidate}" → ${_url}`);
                    let bytes = null;
                    try { bytes = await _tryJsFetch(_url); } catch(_je) {}
                    if (!bytes) {
                        console.log(`🐍 Google Fonts: reintentando vía Pyodide para "${_candidate}"...`);
                        bytes = await _tryPyFetch(_url);
                    }
                    if (bytes) {
                        this._googleFontsCache[fontKey] = bytes;
                        // Registrar en fontRegistry para que renderOverlays pueda usar family/weight/style
                        if (this.fontRegistry && this.fontRegistry.fonts && !this.fontRegistry.fonts[fontKey]) {
                            this.fontRegistry.fonts[fontKey] = {
                                family: _candidate,
                                weight: isBold ? 700 : 400,
                                style: isItalic ? 'italic' : 'normal',
                                googleFont: true
                            };
                        }
                        try {
                            const _lsKey = 'alioth_gf_' + fontKey.replace(/[^a-zA-Z0-9]/g, '_');
                            const _u8s = new Uint8Array(bytes);
                            let _b64s = '';
                            for (let _i = 0; _i < _u8s.length; _i += 8190)
                                _b64s += btoa(String.fromCharCode(..._u8s.subarray(_i, _i + 8190)));
                            localStorage.setItem(_lsKey, _b64s);
                            console.log(`💾 Google Fonts: guardado en localStorage: "${fontKey}" (vía "${_candidate}")`);
                        } catch(_lse2) {}
                        return bytes;
                    }
                }

                console.warn(`🌐 Google Fonts: no encontrado para "${fontKey}"`);
                return null;
            },

            /**
             * Nivel 4: Muestra aviso al usuario para cargar la fuente manualmente.
             * Retorna una Promise que resuelve con ArrayBuffer o null si el usuario cancela/ignora.
             * @param {string} fontKey
             * @returns {Promise<ArrayBuffer|null>}
             */
            _showFontUploadPrompt: function (fontKey) {
                const baseName = fontKey.replace(/^[A-Z]{6}\+/, '').replace(/[-_](Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|Thin|Condensed|BoldItalic|BoldOblique|SemiBold|ExtraBold)/gi, '').trim();

                return new Promise((resolve) => {
                    // Crear toast persistente con botón de carga
                    const toastId = 'font-upload-toast-' + Date.now();
                    const inputId = 'font-upload-input-' + Date.now();

                    const toastEl = document.createElement('div');
                    toastEl.id = toastId;
                    toastEl.style.cssText = `
                        position: fixed; bottom: 80px; right: 20px; z-index: 99999;
                        background: var(--glass-bg, rgba(30,30,40,0.97));
                        border: 1px solid var(--border, #444);
                        border-left: 3px solid #f39c12;
                        color: var(--text, #eee);
                        padding: 12px 16px; border-radius: 10px;
                        font-size: 13px; max-width: 320px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                        animation: slideIn 0.2s ease;
                    `;

                    toastEl.innerHTML = `
                        <div style="margin-bottom:8px;">
                            ⚠️ Fuente <strong>"${baseName}"</strong> no encontrada en la biblioteca local ni en Google Fonts.
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <label for="${inputId}" style="
                                cursor:pointer; padding:5px 10px;
                                background: #f39c12; color:#fff;
                                border-radius:6px; font-size:12px;
                                white-space:nowrap;
                            ">📁 Cargar .ttf/.otf</label>
                            <input id="${inputId}" type="file" accept=".ttf,.otf,.woff,.woff2" style="display:none;">
                            <button onclick="document.getElementById('${toastId}').remove(); window._fontUploadResolve_${toastId}(null);"
                                style="cursor:pointer; padding:5px 10px; background:transparent;
                                    border:1px solid #666; color:#aaa; border-radius:6px; font-size:12px;">
                                Ignorar
                            </button>
                        </div>
                    `;

                    // Resolver desde el exterior (necesario para el botón inline)
                    window[`_fontUploadResolve_${toastId}`] = resolve;

                    document.body.appendChild(toastEl);

                    // Listener del input de archivo
                    setTimeout(() => {
                        const input = document.getElementById(inputId);
                        if (input) {
                            input.addEventListener('change', (e) => {
                                const file = e.target.files[0];
                                if (!file) { resolve(null); return; }
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                    toastEl.remove();
                                    delete window[`_fontUploadResolve_${toastId}`];
                                    this.showToast(`✅ Fuente "${file.name}" cargada`, 3000);
                                    resolve(ev.target.result);
                                };
                                reader.readAsArrayBuffer(file);
                            });
                        }
                    }, 50);

                    // Auto-resolver como null después de 30 segundos
                    setTimeout(() => {
                        if (document.getElementById(toastId)) {
                            toastEl.remove();
                            delete window[`_fontUploadResolve_${toastId}`];
                            resolve(null);
                        }
                    }, 30000);
                });
            },

            /**
             * Gets the center coordinates of the visible viewport for inserting objects
             * @returns {Object} {x, y} coordinates in page space (unscaled)
             */
            getVisibleCenter: function () {
                const panelId = this.splitView.activePanel;
                const mainViewId = panelId === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary';
                const mainView = document.getElementById(mainViewId);
                const canvasContainer = mainView?.querySelector('.canvas-container');

                if (!mainView || !canvasContainer) {
                    return { x: 150, y: 200 }; // Fallback
                }

                // Get scroll position 
                const scrollLeft = mainView.scrollLeft;
                const scrollTop = mainView.scrollTop;

                // Get visible viewport size
                const viewportWidth = mainView.clientWidth;
                const viewportHeight = mainView.clientHeight;

                // Calculate center of visible area in scaled (canvas) coordinates
                const scaledCenterX = scrollLeft + (viewportWidth / 2);
                const scaledCenterY = scrollTop + (viewportHeight / 2);

                // Get canvas container position (to account for padding/margins)
                const containerRect = canvasContainer.getBoundingClientRect();
                const mainViewRect = mainView.getBoundingClientRect();

                // Calculate the offset of the canvas within the main view
                const canvasOffsetX = containerRect.left - mainViewRect.left + scrollLeft;
                const canvasOffsetY = containerRect.top - mainViewRect.top + scrollTop;

                // Convert to page coordinates (unscaled) by dividing by current scale
                // Adjust for the canvas container position
                // ✅ FIX: Usar la escala del panel activo para consistencia con renderOverlays
                const panelState = this.splitView[panelId];
                const scale = panelState?.scale || this.currentScale || 1;
                let x = (scaledCenterX - canvasOffsetX) / scale;
                let y = (scaledCenterY - canvasOffsetY) / scale;

                // Ensure the position is within reasonable bounds (not negative)
                x = Math.max(50, x);
                y = Math.max(50, y);

                // Also ensure it's within the page dimensions if we can determine them
                const doc = this.getDoc();
                if (doc && doc.pages && doc.pages.length > 0) {
                    const currentPage = doc.pages[doc.currentIndex];
                    if (currentPage && currentPage.width && currentPage.height) {
                        x = Math.min(x, currentPage.width - 100);
                        y = Math.min(y, currentPage.height - 100);
                    }
                }

                return { x: Math.round(x), y: Math.round(y) };
            },

            // ============================================================
            // SECTION 2: INITIALIZATION & SETUP
            // ============================================================

            /**
             * Initializes the PDF Editor application
             * Sets up theme, PDF.js worker, and event listeners
             */
            init: async function () {
                if (window.pdfjsLib) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.js';
                    if (pdfjsLib.VerbosityLevel?.ERRORS !== undefined) {
                        pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;
                    }
                }

                const savedTheme = localStorage.getItem('alioth_theme');
                const _sunSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-sun"><circle cx="12" cy="12" r="4" fill="#fbbf24" fill-opacity="0.3" stroke="#f59e0b"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
                const _moonSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#818cf8" fill-opacity="0.25" stroke="#818cf8"/></svg>';
                if (savedTheme === 'dark') {
                    document.body.classList.add('dark-mode');
                    const _dt = document.getElementById('darkToggle'); if (_dt) _dt.innerHTML = _moonSvg;
                    const _rb = document.getElementById('btn-reading-theme'); if (_rb) _rb.innerHTML = _moonSvg;
                } else {
                    document.body.classList.remove('dark-mode');
                    const _dt = document.getElementById('darkToggle'); if (_dt) _dt.innerHTML = _sunSvg;
                    const _rb = document.getElementById('btn-reading-theme'); if (_rb) _rb.innerHTML = _sunSvg;
                }
                const _savedPreset = localStorage.getItem('alioth_last_preset');
                if (_savedPreset) setTimeout(() => this.applyThemePreset(_savedPreset), 0);

                // Restore Ribbon State
                const savedRibbonState = localStorage.getItem('ribbonCollapsed');
                if (savedRibbonState === 'true') {
                    // Use setTimeout to ensure DOM is ready
                    setTimeout(() => this.collapseRibbon(), 100);
                }

                // Restore Reading Mode
                const savedReadingMode = localStorage.getItem('alioth_reading_mode');
                if (savedReadingMode === 'true') {
                    setTimeout(() => { if (!this._readingMode) this.toggleReadingMode(); }, 150);
                }

                // Restore Custom Shortcut
                const savedShortcut = localStorage.getItem('alioth_custom_shortcut');
                if (savedShortcut) {
                    try {
                        const sc = JSON.parse(savedShortcut);
                        setTimeout(() => this._setCustomShortcut(sc.id), 300);
                    } catch(e) {}
                }

                // Restore Custom Shortcut 2
                const savedShortcut2 = localStorage.getItem('alioth_custom_shortcut2');
                if (savedShortcut2) {
                    try {
                        const sc2 = JSON.parse(savedShortcut2);
                        setTimeout(() => { this._shortcutPickerTarget = 2; this._setCustomShortcut(sc2.id); }, 350);
                    } catch(e) {}
                }

                // Restore Form Tab Shortcuts
                const savedSCForm1 = localStorage.getItem('alioth_custom_shortcut_form1');
                if (savedSCForm1) {
                    try {
                        const sc = JSON.parse(savedSCForm1);
                        setTimeout(() => {
                            if (!this._shortcutPickerGroups) this._buildShortcutGroups();
                            for (const g of this._shortcutPickerGroups) {
                                const item = g.items.find(i => i.id === sc.id);
                                if (item) { this._applyShortcutForm(1, item); break; }
                            }
                        }, 400);
                    } catch(e) {}
                }
                const savedSCForm2 = localStorage.getItem('alioth_custom_shortcut_form2');
                if (savedSCForm2) {
                    try {
                        const sc = JSON.parse(savedSCForm2);
                        setTimeout(() => {
                            if (!this._shortcutPickerGroups) this._buildShortcutGroups();
                            for (const g of this._shortcutPickerGroups) {
                                const item = g.items.find(i => i.id === sc.id);
                                if (item) { this._applyShortcutForm(2, item); break; }
                            }
                        }, 450);
                    } catch(e) {}
                }

                // Restore Custom Shortcut 3
                const savedShortcut3 = localStorage.getItem('alioth_custom_shortcut3');
                if (savedShortcut3) {
                    try {
                        const sc3 = JSON.parse(savedShortcut3);
                        setTimeout(() => { this._shortcutPickerTarget = 3; this._setCustomShortcut(sc3.id); }, 500);
                    } catch(e) {}
                }

                // Restore Tab Shortcuts
                setTimeout(() => {
                    if (!this._customShortcutTabs) this._customShortcutTabs = {};
                    if (!this._shortcutPickerGroups) this._buildShortcutGroups();
                    ['image_1','draw_1','formx_1','magic_1'].forEach((key, i) => {
                        const saved = localStorage.getItem('alioth_shortcut_tab_' + key);
                        if (!saved) return;
                        try {
                            const sc = JSON.parse(saved);
                            for (const g of this._shortcutPickerGroups) {
                                const item = g.items.find(it => it.id === sc.id);
                                if (item) {
                                    this._customShortcutTabs[key] = { id: item.id, label: item.label, icon: item.icon, fn: item.fn };
                                    const parts = key.split('_');
                                    const tab = parts[0]; const slot = parseInt(parts[1])||1;
                                    const icoId = 'custom-shortcut-icon-' + tab + slot;
                                    const lblId = 'custom-shortcut-label-' + tab + slot;
                                    const btnId = 'btn-custom-shortcut-' + tab + slot;
                                    const lbl = document.getElementById(lblId);
                                    const ico = document.getElementById(icoId);
                                    const btn = document.getElementById(btnId);
                                    if (lbl) lbl.innerHTML = item.label.replace(' ', '<br>');
                                    if (ico) ico.outerHTML = `<span id="${icoId}" style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;">${item.icon}</span>`;
                                    if (btn) btn.title = item.label;
                                    break;
                                }
                            }
                        } catch(e) {}
                    });
                }, 550);

                // Abrir PDF desde URL params (?openfile=ruta&readmode=1)
                // Esto se activa cuando se hace doble clic en un PDF desde Windows
                const _urlParams = new URLSearchParams(window.location.search);
                const _openFile  = _urlParams.get('openfile') || _urlParams.get('open') || _urlParams.get('file');
                const _readMode  = _urlParams.get('readmode') === '1';
                if (_openFile) {
                    setTimeout(async () => {
                        try {
                            const resp = await fetch('/open-file?path=' + encodeURIComponent(_openFile));
                            if (!resp.ok) throw new Error('HTTP ' + resp.status);
                            const arrayBuffer = await resp.arrayBuffer();
                            const rawName = _openFile.replace(/\\/g, '/').split('/').pop() || 'documento.pdf';
                            let fileName = rawName;
                            try { fileName = decodeURIComponent(rawName); } catch (_) {}
                            
                            const ext = '.' + fileName.split('.').pop().toLowerCase();
                            const mimeMap = {
                                '.pdf': 'application/pdf',
                                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                '.doc': 'application/msword',
                                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                '.xls': 'application/vnd.ms-excel',
                                '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                                '.ppt': 'application/vnd.ms-powerpoint',
                                '.png': 'image/png',
                                '.jpg': 'image/jpeg',
                                '.jpeg': 'image/jpeg',
                                '.webp': 'image/webp'
                            };
                            const mimeType = mimeMap[ext] || 'application/pdf';
                            const file = new File([arrayBuffer], fileName, { type: mimeType });
                            if (ext === '.pdf') file._aliothSourcePath = _openFile;
                            
                            if (typeof this.smartOpenFile === 'function') {
                                await this.smartOpenFile(file);
                            } else if (typeof this.openFile === 'function') {
                                await this.openFile(file);
                            }
                            
                            if (_readMode && typeof this.toggleReadingMode === 'function') {
                                setTimeout(() => { if (!this._readingMode) this.toggleReadingMode(); }, 400);
                            }
                        } catch(err) {
                            console.error('Error abriendo archivo desde URL:', err);
                            this.showToast('No se pudo abrir el archivo: ' + err.message);
                        }
                    }, 600);
                }


                // Parche de CSS para corregir Z-Index
                this.fixCSS();

                window.onbeforeunload = null;

                // ============================================================
                // DEXIE DATABASE INITIALIZATION
                // ============================================================
                if (localStorage.getItem('alioth_encryption_enabled') === 'true') {
                    this.isLocked = true;
                    document.getElementById('alioth-unlock-overlay').style.display = 'flex';
                } else {
                    await this.initDatabaseAndApp();
                }

                this.setupEvents();
                this.initTabEventsSSE();
                this.setupFormEvents();
                this.setupResizer(); // Función ahora existente
                this.setupSplitDivider(); // Split view divider resize
                this.setupPanelEvents(); // Split view panel events
                this.setupDelegatedEvents(); // New Centralized Drag/Drop Handler
                this.setupScrollNavigation(); // Scroll wheel page navigation
                this.refreshWindowsIntegrationStatus?.();
                window.addEventListener('focus', () => this.refreshWindowsIntegrationStatus?.());
                if (localStorage.getItem('h-layout') === 'true') this.setHorizontalLayout(true);


                document.getElementById('loader').style.setProperty('display', 'none', 'important');
                document.getElementById('modal-overlay').style.setProperty('display', 'none', 'important');

                this.switchRibbon('home');
                this.updateUndoRedoUI();
                this.updatePanelHeaders(); // Initialize panel headers
                this.setupEscapeHandler(); // ESC key to exit modes
                setTimeout(() => this._updateAboutBtn(), 200);

                // Activar botón de vista continua (estado inicial por defecto)
                const btnCont = document.getElementById('toggleContinuous');
                if (btnCont) btnCont.classList.toggle('active-view', this.viewMode === 'continuous');

                // Activar botón de SmartGuides (activo por defecto)
                const btnSG = document.getElementById('toggleSmartGuides');
                if (btnSG) btnSG.classList.add('active');

                // Initialize enhanced libraries
                this.setupInteractDraggables(); // Interact.js for smooth drag/resize
                this.initLucideIcons(); // Lucide icons
                this.setupObjectContextMenu(); // Setup context menu for objects

                // Renderizar documentos en la pantalla principal si no está bloqueado
                if (!this.isLocked) {
                    this.renderHomeDocuments();
                }

                console.log("Alioth PDF Editor Iniciado (Con Auto-Guardado + Interact.js)");
                console.log(`📦 VERSION: ${ALIOTH_VERSION}`);
                // Hide splash screen when initialization completes.
                (function() {
                    var sp = document.getElementById('alioth-splash');
                    if (!sp) return;
                    var isDetached = new URLSearchParams(location.search).has('detach') ||
                                     new URLSearchParams(location.search).has('transferToken') ||
                                     new URLSearchParams(location.search).has('token');
                    if (isDetached) {
                        if (sp.parentNode) sp.parentNode.removeChild(sp);
                        return;
                    }
                    sp.classList.add('fade-out');
                    setTimeout(function(){ if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
                })();
                // Resaltado de campos activo por defecto
                if (!this._readingMode) document.body.classList.add('fields-highlighted');

                // Handle document detached or transferred from another window (?detach=... or ?transferToken=... or ?token=...)
                const _detachToken = _urlParams.get('detach') || _urlParams.get('transferToken') || _urlParams.get('token');
                if (_detachToken) {
                    try {
                        let data = null;
                        try {
                            const opener = window.opener;
                            if (opener && opener._pendingDetach && opener._pendingDetach[_detachToken]) {
                                data = opener._pendingDetach[_detachToken];
                                delete opener._pendingDetach[_detachToken];
                            }
                        } catch(e) {}
                        if (!data) {
                            data = await this._fetchTransferPayload(_detachToken);
                        }
                        if (data) {
                            await this.loadDetachedDocument(data);
                        }
                    } catch(e) {
                        console.warn('Detach load failed:', e);
                    }
                    if (!this.docs || this.docs.length === 0) {
                        this.createNewTab(this.t('tab_new_doc', 'Nuevo Doc'));
                    }
                }

                // ── Shape picker: delegated listener on document ─────
                document.addEventListener('click', function(e) {
                    // Handle embedded PDF annotation clicks (capture phase - must be here)
                    const annotSection = e.target.closest('section.textAnnotation');
                    if (annotSection && !annotSection.classList.contains('native-comment-pin')) {
                        e.stopPropagation();
                        e.preventDefault();
                        const popupId = annotSection.dataset.popupId;
                        if (popupId) {
                            const existing = document.getElementById(popupId);
                            if (existing) { existing.remove(); return; }
                        }
                        document.querySelectorAll('.pdf-annot-popup').forEach(p => p.remove());
                        const popupContent = annotSection.dataset.popupContent;
                        const popupAuthor  = annotSection.dataset.popupAuthor;
                        if (!popupContent && !popupAuthor) return;
                        const pid = 'pap-' + Date.now();
                        annotSection.dataset.popupId = pid;
                        const popup = document.createElement('div');
                        popup.id = pid;
                        popup.className = 'pdf-annot-popup';
                        popup.style.cssText = 'position:fixed;background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:10px 14px;font-size:12px;max-width:280px;box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:99999;color:var(--text-main);white-space:pre-wrap;line-height:1.5;';
                        if (popupAuthor) {
                            const a = document.createElement('div');
                            a.style.cssText = 'font-weight:600;margin-bottom:5px;font-size:11px;opacity:0.7;';
                            a.textContent = popupAuthor;
                            popup.appendChild(a);
                        }
                        const b = document.createElement('div');
                        b.textContent = popupContent;
                        popup.appendChild(b);
                        const x = document.createElement('button');
                        x.textContent = '✕';
                        x.style.cssText = 'position:absolute;top:4px;right:6px;background:none;border:none;cursor:pointer;font-size:12px;opacity:0.5;';
                        x.onclick = (ev) => { ev.stopPropagation(); popup.remove(); delete annotSection.dataset.popupId; };
                        popup.appendChild(x);
                        document.body.appendChild(popup);
                        const r = annotSection.getBoundingClientRect();
                        let px = r.right + 8, py = r.top - 10;
                        if (px + 295 > window.innerWidth) px = r.left - 300;
                        if (py + 140 > window.innerHeight) py = window.innerHeight - 145;
                        if (py < 4) py = 4;
                        popup.style.left = px + 'px';
                        popup.style.top  = py + 'px';
                        setTimeout(() => {
                            document.addEventListener('click', function closeP(ev) {
                                if (!popup.contains(ev.target) && ev.target !== annotSection) {
                                    popup.remove();
                                    delete annotSection.dataset.popupId;
                                    document.removeEventListener('click', closeP, true);
                                }
                            }, true);
                        }, 200);
                        return;
                    }

                    console.log('🔍 CLICK captured:', e.target.id, e.target.tagName, e.target.className);
                    const btn = e.target.closest('#btn-shape-expand');
                    console.log('🔍 closest #btn-shape-expand:', btn);
                    if (btn) {
                        console.log('✅ Shape picker button clicked!');
                        e.stopPropagation();
                        const panel = document.getElementById('shape-picker-panel');
                        console.log('🔍 Panel found:', panel, 'display:', panel?.style.display);
                        app.toggleShapePicker(btn);
                    }
                }, true);
                console.log('✅ Shape picker delegated listener ready');
                // Also verify elements exist
                console.log('🔍 btn-shape-expand in DOM:', !!document.getElementById('btn-shape-expand'));
                console.log('🔍 shape-picker-panel in DOM:', !!document.getElementById('shape-picker-panel'));
                console.log('🔍 app.toggleShapePicker type:', typeof app.toggleShapePicker);
            },

            setupEscapeHandler: function () {
                // Ctrl+Tab / Ctrl+Shift+Tab → navegar pestañas del ribbon
                const _ribbonTabOrder = ['home', 'image', 'draw', 'form', 'magic'];
                if (this._ribbonKeyboardHandler) document.removeEventListener('keydown', this._ribbonKeyboardHandler);
                this._ribbonKeyboardHandler = (ev) => {
                    if (ev.ctrlKey && ev.key === 'Tab') {
                        ev.preventDefault();
                        const cur = this._currentRibbonTab || 'home';
                        const idx = _ribbonTabOrder.indexOf(cur);
                        const next = ev.shiftKey
                            ? _ribbonTabOrder[(idx - 1 + _ribbonTabOrder.length) % _ribbonTabOrder.length]
                            : _ribbonTabOrder[(idx + 1) % _ribbonTabOrder.length];
                        this.switchRibbon(next);
                    }
                };
                document.addEventListener('keydown', this._ribbonKeyboardHandler);

                if (this._arrowKeyboardHandler) document.removeEventListener('keydown', this._arrowKeyboardHandler);
                if (this._arrowKeyupHandler) document.removeEventListener('keyup', this._arrowKeyupHandler);
                if (this._fieldNudgeBlurHandler) window.removeEventListener('blur', this._fieldNudgeBlurHandler);
                if (this._fieldNudgeVisibilityHandler) document.removeEventListener('visibilitychange', this._fieldNudgeVisibilityHandler);
                this._arrowKeyboardHandler = (e) => {
                    // Skip if user is typing in an input or textarea
                    const activeEl = document.activeElement || e.target;
                    const target = e.target || activeEl;
                    const isTyping = [activeEl, target].some(el => el && (
                        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
                        el.contentEditable === 'true' || el.isContentEditable
                    ));
                    if (e.isComposing || e.keyCode === 229) return;

                    if (e.key === 'Escape') {
                        if (this.isCommandPaletteOpen && this.isCommandPaletteOpen()) {
                            this.closeCommandPalette();
                            return;
                        }
                        // Exit real edit / smart patch mode
                        if (this.smartPatchMode) {
                            this.cancelSmartPatch();
                            return;
                        }
                        // Exit drawing mode
                        if (this.isDrawingMode) {
                            this.isDrawingMode = false;
                            document.body.classList.remove('drawing-mode');
                            this.setDrawTool('none');
                            this.showToast('Modo dibujo desactivado');
                            return;
                        }
                        // Exit hand mode
                        if (this.isHandMode) {
                            this.toggleHandMode();
                            return;
                        }
                        // Hide capture overlay
                        const captureOverlay = document.getElementById('capture-overlay');
                        if (captureOverlay && captureOverlay.style.display !== 'none') {
                            captureOverlay.style.display = 'none';
                            this.showToast('Captura cancelada');
                            return;
                        }
                        // Close context menus
                        this.hideContextMenu();
                        document.getElementById('sidebar-context-menu').style.display = 'none';
                        // Close modals
                        this.closeAllModals();
                    }

                    // Arrow key navigation (only when not typing)
                    if (!isTyping) {
                        const doc = this.getDoc();
                        if (!doc || doc.pages.length === 0) return;

                        if (this.isFieldEditMode && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
                            this.nudgeSelectedFields && this.nudgeSelectedFields(e.key, e.shiftKey)) {
                            e.preventDefault();
                            return;
                        }

                        // Arrow Key Movement
                        const hasSelection = (this.multiObjectSelection && this.multiObjectSelection.size > 0) || this.selectedObj;
                        if (hasSelection && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            e.preventDefault();
                            const step = e.shiftKey ? 10 : 2;
                            let dx = 0, dy = 0;
                            if (e.key === 'ArrowLeft') dx = -step;
                            if (e.key === 'ArrowRight') dx = step;
                            if (e.key === 'ArrowUp') dy = -step;
                            if (e.key === 'ArrowDown') dy = step;
                            this.moveSelectedObjects(dx, dy);
                            this.saveStateDebounced(500);
                            return;
                        }

                        // Left Arrow - Previous Page
                        if (e.key === 'ArrowLeft') {
                            e.preventDefault();
                            if (this.isTwoUpView) {
                                const step = (this.twoUpCoverAlone && doc.currentIndex <= 2) ? doc.currentIndex : 2;
                                const target = Math.max(0, doc.currentIndex - (step || 1));
                                this.loadPage(target);
                                return;
                            }
                            if (doc.currentIndex > 0) {
                                this.loadPage(doc.currentIndex - 1);
                            }
                            return;
                        }

                        // Right Arrow - Next Page
                        if (e.key === 'ArrowRight') {
                            e.preventDefault();
                            if (this.isTwoUpView) {
                                const step = (this.twoUpCoverAlone && doc.currentIndex === 0) ? 1 : 2;
                                const target = Math.min(doc.pages.length - 1, doc.currentIndex + step);
                                this.loadPage(target);
                                return;
                            }
                            if (doc.currentIndex < doc.pages.length - 1) {
                                this.loadPage(doc.currentIndex + 1);
                            }
                            return;
                        }

                        // Up/Down arrows - page change in single page mode, scroll naturally in continuous mode/horizontal layout
                        const isHLayout = document.body.classList.contains('h-layout');
                        const isContinuous = (this.viewMode === 'continuous');

                        if (e.key === 'ArrowUp') {
                            if (!isHLayout && !isContinuous) {
                                e.preventDefault();
                                if (doc.currentIndex > 0) {
                                    this.loadPage(doc.currentIndex - 1);
                                }
                                return;
                            }
                        }

                        if (e.key === 'ArrowDown') {
                            if (!isHLayout && !isContinuous) {
                                e.preventDefault();
                                if (doc.currentIndex < doc.pages.length - 1) {
                                    this.loadPage(doc.currentIndex + 1);
                                }
                                return;
                            }
                        }
                    }
                };
                this._arrowKeyupHandler = (e) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) this.endFieldNudgeSession && this.endFieldNudgeSession();
                };
                this._fieldNudgeBlurHandler = () => this.endFieldNudgeSession && this.endFieldNudgeSession();
                this._fieldNudgeVisibilityHandler = () => {
                    if (document.visibilityState && document.visibilityState !== 'visible') this.endFieldNudgeSession && this.endFieldNudgeSession();
                };
                document.addEventListener('keydown', this._arrowKeyboardHandler);
                document.addEventListener('keyup', this._arrowKeyupHandler);
                window.addEventListener('blur', this._fieldNudgeBlurHandler);
                document.addEventListener('visibilitychange', this._fieldNudgeVisibilityHandler);
            },

            // ============================================================
            // AUTO-SAVE & PERSISTENCE FUNCTIONS (Dexie)
            // ============================================================

            /**
             * Starts the auto-save interval timer
             */
            startAutoSave: function () {
                if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
                if (!this.db || this._sessionListenersBound) return;
                this._sessionListenersBound = true;
                window.addEventListener('beforeunload', () => { this.saveSession(); });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') this.saveSessionLight();
                });
            },

            persistClosedTab: async function (item) {
                if (!this.db || !item.buffer) return;
                item.storageKey = 'closedTab:' + Date.now() + ':' + (window.__aliothWindowId || 'local') + ':' + Math.random().toString(36).slice(2);
                try {
                    await this.db.appState.put(await this.encryptRecord({ key: item.storageKey, buffer: item.buffer }, ['buffer']));
                    item.buffer = null;
                } catch (error) { console.warn('Closed tab cache remains in memory:', error); }
            },

            releaseClosedTab: async function (item) {
                if (!item) return;
                await item.persisting;
                if (this.db && item.storageKey) {
                    try { await this.db.appState.delete(item.storageKey); }
                    catch (error) { console.warn('Closed tab cache cleanup failed:', error); }
                }
            },

            releaseClosedTabs: async function () {
                const items = (this._closedTabsStack || []).splice(0);
                await Promise.all(items.map(item => this.releaseClosedTab(item)));
            },

            _queueSessionWrite: function (task) {
                const run = (this._sessionWriteQueue || Promise.resolve()).catch(() => {}).then(task);
                this._sessionWriteQueue = run.catch(() => {});
                return run;
            },

            saveSession: function () {
                return this._queueSessionWrite(() => this._writeSession());
            },

            saveSessionLight: function () {
                if (!this._sessionLightPending) {
                    this._sessionLightPending = this.saveSession().finally(() => { this._sessionLightPending = null; });
                }
                return this._sessionLightPending;
            },

            _writeSession: async function () {
                if (!this.db) return false;
                try {
                    const docs = this.docs.filter(doc => doc?.id && Array.isArray(doc.pages));
                    for (const doc of docs) await this.flushDocumentEdits?.(doc.id);
                    if (!this._sessionBuffers) this._sessionBuffers = new WeakMap();
                    const records = [], sources = [], cached = [];
                    const rememberSource = async (doc, sourceId, buffer, kind = 'document') => {
                        if (!buffer || typeof buffer !== 'object') return;
                        const id = kind === 'baseline' ? doc.id + ':baseline:' + sourceId : doc.id + '_' + sourceId;
                        if (this._sessionBuffers.get(buffer)?.has(id)) return;
                        const record = { id, docId: doc.id, sourceId, kind, encoding: 'binary-v1', buffer };
                        sources.push(await this.encryptRecord(record, ['buffer']));
                        cached.push([buffer, id]);
                    };
                    for (const doc of docs) {
                        if (!this.docs.includes(doc)) continue;
                        const state = doc.documentState ? { ...doc.documentState } : null;
                        if (state?.baselineSnapshot?.payload?.sources) {
                            const snapshot = state.baselineSnapshot;
                            const baselineSources = [];
                            for (const source of snapshot.payload.sources) {
                                await rememberSource(doc, source.sourceId, source.buffer, 'baseline');
                                baselineSources.push({ ...source, buffer: null });
                            }
                            state.baselineSnapshot = { ...snapshot, payload: { ...snapshot.payload, sources: baselineSources } };
                        }
                        const record = {
                            id: doc.id, name: doc.name, originalPath: doc.originalPath || doc.filePath || null,
                            currentIndex: doc.currentIndex, scale: doc.scale, documentState: state,
                            metadata: doc.metadata || {}, lastModified: Date.now(), indexEntries: doc.indexEntries || [],
                            pages: doc.pages.map(page => ({
                                id: page.id, sourceId: page.sourceId, pageIndex: page.pageIndex, rotation: page.rotation || 0,
                                flipH: page.flipH || false, flipV: page.flipV || false, width: page.width, height: page.height,
                                objects: page.objects || [], nativeFormValues: page.nativeFormValues || {},
                                deletedObjectIds: page.deletedObjectIds || []
                            }))
                        };
                        records.push(await this.encryptRecord(record, ['name', 'pages', 'indexEntries', 'documentState', 'metadata']));
                        for (const [sourceId, source] of Object.entries(doc.sources || {})) await rememberSource(doc, sourceId, source.buffer);
                    }
                    const live = new Set(this.docs.map(doc => doc.id));
                    const current = records.filter(record => live.has(record.id));
                    const docIds = current.map(record => record.id);
                    await this.db.transaction('rw', this.db.documents, this.db.sources, this.db.appState, async () => {
                        for (const record of current) await this.db.documents.put(record);
                        for (const source of sources) if (live.has(source.docId)) await this.db.sources.put(source);
                        await this.db.appState.put({ key: 'session', docIds,
                            activeDocId: docIds.includes(this.activeDocId) ? this.activeDocId : docIds[0] || null,
                            currentScale: this.currentScale, splitView: this.splitView });
                    });
                    for (const [buffer, id] of cached) {
                        let ids = this._sessionBuffers.get(buffer);
                        if (!ids) this._sessionBuffers.set(buffer, ids = new Set());
                        ids.add(id);
                    }
                    this.lastSaveTime = Date.now();
                    return true;
                } catch (error) {
                    console.error('Error saving session:', error);
                    return false;
                }
            },

            hydrateSessionDocument: function (doc) {
                if (!doc?._sessionSourcesPending) return Promise.resolve(doc);
                if (doc._sessionHydration) return doc._sessionHydration;
                doc._sessionHydration = (async () => {
                    const records = await this.db.sources.where('docId').equals(doc.id).toArray();
                    if (!this._sessionBuffers) this._sessionBuffers = new WeakMap();
                    const sources = {}, baseline = new Map();
                    for (const raw of records) {
                        const source = await this.decryptRecord(raw, ['buffer']);
                        let buffer = source.buffer;
                        if (source.encoding === 'binary-v1') {
                            if (ArrayBuffer.isView(buffer)) buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
                        } else {
                            if (typeof buffer !== 'string') buffer = new TextDecoder().decode(buffer);
                            buffer = this.base64ToArrayBuffer(buffer);
                        }
                        if (!buffer?.byteLength) throw new Error('SESSION_SOURCE_UNAVAILABLE');
                        if (source.kind === 'baseline') baseline.set(source.sourceId, buffer);
                        else sources[source.sourceId] = { buffer };
                        this._sessionBuffers.set(buffer, new Set([source.id]));
                    }
                    if (doc.pages.some(page => !sources[page.sourceId])) throw new Error('SESSION_SOURCE_UNAVAILABLE');
                    doc.sources = sources;
                    for (const source of doc.documentState?.baselineSnapshot?.payload?.sources || []) {
                        if (!source.buffer && baseline.has(source.sourceId)) source.buffer = baseline.get(source.sourceId);
                    }
                    delete doc._sessionSourcesPending;
                    return doc;
                })().finally(() => { delete doc._sessionHydration; });
                return doc._sessionHydration;
            },

            restoreSession: async function () {
                if (!this.db) return false;
                try {
                    const state = await this.db.appState.get('session');
                    let ids = state?.docIds;
                    if (!Array.isArray(ids)) {
                        const active = state?.activeDocId && await this.db.documents.get(state.activeDocId);
                        ids = active ? [state.activeDocId] : [];
                        if (ids.length && ['horizontal', 'vertical'].includes(state?.splitView?.mode)) {
                            ids.push(state.splitView.primary?.docId, state.splitView.secondary?.docId);
                        }
                        ids = [...new Set(ids.filter(Boolean))];
                    }
                    for (const id of ids) {
                        const raw = await this.db.documents.get(id);
                        if (!raw || this.docs.some(doc => doc.id === id)) continue;
                        const saved = await this.decryptRecord(raw, ['name', 'pages', 'indexEntries', 'documentState', 'metadata']);
                        const doc = { ...saved, sources: {}, history: [], historyIndex: -1, _sessionSourcesPending: !!saved.pages?.length };
                        for (const page of doc.pages || []) for (const object of page.objects || []) {
                            if (object.opacity > 1) object.opacity /= 100;
                        }
                        this.docs.push(doc);
                    }
                    if (!this.docs.length) return false;
                    this.activeDocId = this.docs.some(doc => doc.id === state?.activeDocId) ? state.activeDocId : this.docs[0].id;
                    if (state?.splitView) this.splitView = state.splitView;
                    for (const panel of ['primary', 'secondary']) {
                        if (this.splitView?.[panel] && !this.docs.some(doc => doc.id === this.splitView[panel].docId)) this.splitView[panel].docId = this.activeDocId;
                    }
                    this.currentScale = state?.currentScale || this.getDoc()?.scale || 1;
                    await this.hydrateSessionDocument(this.getDoc());
                    this.switchTab(this.activeDocId);
                    return true;
                } catch (error) {
                    console.error('Error restoring session:', error);
                    this.showToast('No se pudo recuperar toda la sesión. Los datos guardados se conservan.', 5000, 'warning');
                    return false;
                }
            },

            /**
             * Clears all saved session data from IndexedDB
             */
            clearSession: async function () {
                if (!this.db) return;
                try {
                    await this.releaseClosedTabs();
                    await this.db.documents.clear();
                    await this.db.sources.clear();
                    await this.db.appState.clear();
                    console.log('🗑️ Session cleared');
                    this.showToast('Datos guardados eliminados');
                } catch (err) {
                    console.error('Error clearing session:', err);
                }
            },

            /**
             * Removes a specific document from the saved session in IndexedDB
             * Called when a tab is closed without saving
             * @param {string} docId - The document ID to remove
             */
            removeDocumentFromSession: function (docId) {
                if (!this.db || !docId) return Promise.resolve();
                return this._queueSessionWrite(async () => {
                    try {
                        await this.db.transaction('rw', this.db.documents, this.db.sources, this.db.appState, async () => {
                            await this.db.documents.delete(docId);
                            await this.db.sources.where('docId').equals(docId).delete();
                            const session = await this.db.appState.get('session');
                            if (session) await this.db.appState.put({ ...session,
                                docIds: (session.docIds || []).filter(id => id !== docId),
                                activeDocId: this.activeDocId });
                        });
                    } catch (error) { console.error('Error removing document from session:', error); }
                });
            },

            /**
             * Force saves the current session (called manually)
             */
            forceSaveSession: async function () {
                const success = await this.saveSession();
                if (success) {
                    this.showToast('💾 Guardado exitoso');
                } else {
                    this.showToast('⚠️ No hay datos para guardar');
                }
            },

            /**
             * Utility: Convert ArrayBuffer to base64 string
             */
            arrayBufferToBase64: function (buffer) {
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
            },

            /**
             * Utility: Convert base64 string to ArrayBuffer
             */
            base64ToArrayBuffer: function (base64) {
                const binaryString = atob(base64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                return bytes.buffer;
            },

            // ============================================================
            // INTERACT.JS SETUP - Enhanced Drag & Resize
            // ============================================================

            /**
             * Initializes Interact.js on all draggable overlay elements
             * Call this after rendering overlays to enable enhanced interactions
             */
            initLucideIcons: function () {
                if (window.lucide) {
                    lucide.createIcons();
                    console.log('🎨 Lucide icons initialized');
                }
            },

            /**
             * Shows the highlight color selection modal
             */
            fixCSS: function () {
                // Inyecta estilos corregidos para capas (z-index)
                const style = document.createElement('style');
                style.innerHTML = `
                        .toast - notification { z - index: 20000!important; }
                    #modal - overlay, .glass - overlay { z - index: 15000!important; }
                    #loader { z - index: 16000!important; }
                    #context - menu, #sidebar - context - menu { z - index: 14000!important; }
                    #custom - alert - overlay { z - index: 15500!important; }
                    `;
                document.head.appendChild(style);
            },

            /**
             * Extract Rich Text (HTML) from selection with Optical Color Sampling
             * Enhanced to read font metadata from data attributes set during text layer rendering
             * Returns { html: string, text: string }
             */
            getObjectById: function (id, panelId) {
                const panelState = this.splitView[panelId];
                const docId = panelState?.docId || this.activeDocId;
                const doc = this.docs.find(d => d.id === docId);
                if (!doc || !doc.pages[doc.currentIndex]) return null;
                return doc.pages[doc.currentIndex].objects.find(o => o.id === id);
            },

            getDoc: function () {
                const doc = this.docs.find(d => d && d.id === this.activeDocId);
                if (!doc) {
                    console.warn('⚠ No document found. activeDocId:', this.activeDocId);
                    // Auto-recuperar: si hay docs disponibles, activar el primero
                    if (this.docs.length > 0) {
                        this.activeDocId = this.docs[0].id;
                        console.warn('⚠ Auto-recovered activeDocId to:', this.activeDocId);
                        return this.docs[0];
                    }
                }
                return doc;
            },

            updateWindowTitle: function () {
                const doc = typeof this.getDoc === 'function' ? this.getDoc() : (this.docs && this.docs.find(d => d && d.id === this.activeDocId));
                const appName = 'ALIOTH PDF EDITOR';
                const isDefaultEmpty = doc && (!doc.pages || doc.pages.length === 0) && (doc.name === 'Sin Título' || doc.name === 'Nuevo Doc' || (typeof this.t === 'function' && doc.name === this.t('tab_new_doc', 'Nuevo Doc')));
                if (doc && doc.name && !isDefaultEmpty) {
                    document.title = `${doc.name} - ${appName}`;
                } else {
                    document.title = appName;
                }
            },

            getClientToPDFCoords: function (clientX, clientY) {
                // Determine which panel the mouse is over
                const panels = ['primary'];
                if (this.splitView && this.splitView.active) panels.push('secondary');

                for (const pid of panels) {
                    const containerId = pid === 'secondary' ? 'secondary-canvas-container' : 'canvas-container';
                    const container = document.getElementById(containerId);
                    if (!container) continue;

                    const rect = container.getBoundingClientRect();
                    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                        const state = this.splitView ? this.splitView[pid] : null;
                        const scale = state ? (state.scale || 1) : this.currentScale;

                        return {
                            x: (clientX - rect.left + container.scrollLeft) / scale,
                            y: (clientY - rect.top + container.scrollTop) / scale,
                            panel: pid
                        };
                    }
                }
                return null;
            },

            isInputActive: function () {
                const act = document.activeElement;
                if (!act) return false;
                if (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA' || act.isContentEditable) return true;
                if (act.classList.contains('editing') || act.closest('.editing')) return true;
                return false;
            },

            _systemFontBytes: {},
            _systemFontSources: {},
            _systemFontLoads: new Map(),

            loadSystemFontBytes: async function (fontKey) {
                if (this._systemFontBytes[fontKey]) return this._systemFontBytes[fontKey];
                const source = this._systemFontSources[fontKey];
                if (!source) return null;
                if (this._systemFontLoads.has(fontKey)) return this._systemFontLoads.get(fontKey);
                const work = (async () => {
                    try {
                        const blob = await source.fontData.blob();
                        const bytes = await blob.arrayBuffer();
                        this._systemFontBytes[fontKey] = bytes;
                        return bytes;
                    } catch (error) {
                        console.warn('No se pudo leer la fuente local:', fontKey, error);
                        return null;
                    } finally { this._systemFontLoads.delete(fontKey); }
                })();
                this._systemFontLoads.set(fontKey, work);
                return work;
            },
            // Set of system font family names available
            _systemFontFamilies: new Set(),

            loadSystemFonts: async function (manual = false) {
                if (this._systemFontsLoading) return this._systemFontsLoading;
                if (this._systemFontsReady && !manual) return;
                this._systemFontsLoading = this._registerSystemFonts(manual)
                    .finally(() => { this._systemFontsLoading = null; });
                return this._systemFontsLoading;
            },

            _registerSystemFonts: async function (manual = false) {
                // 1. Fuentes comunes para asegurar que existen en el registro
                const commonFonts = [
                    "Segoe UI", "Calibri", "Cambria", "Candara", "Consolas", "Constantia", "Corbel",
                    "Georgia", "Impact", "Lucida Console", "Lucida Sans Unicode", "Tahoma",
                    "Times New Roman", "Trebuchet MS", "Verdana", "Franklin Gothic Medium"
                ];

                commonFonts.forEach(f => {
                    if (!this.fontRegistry.fonts[f]) {
                        this.fontRegistry.fonts[f] = { family: f, weight: 400, style: 'normal' };
                    }
                });

                if ("queryLocalFonts" in window) {
                    try {
                        // Solicitar permiso/consultar fuentes
                        const fonts = await window.queryLocalFonts();

                        if (fonts.length === 0 && manual) {
                            this.showToast("No se encontraron fuentes o permiso denegado");
                        }

                        const families = new Set();
                        // Track all variants per family for complete registration
                        const familyVariants = {}; // { "family": [ {fontData, weight, style, fullName, postscriptName} ] }

                        for (const f of fonts) {
                            families.add(f.family);
                            if (!familyVariants[f.family]) familyVariants[f.family] = [];

                            // Detect weight and style from style property or fullName
                            const fullNameLc = (f.fullName || '').toLowerCase();
                            const styleLc = (f.style || '').toLowerCase();

                            let weight = 400;
                            let fontStyle = 'normal';

                            // Weight detection
                            if (/\b(thin|hairline)\b/.test(fullNameLc)) weight = 100;
                            else if (/\b(extra\s?light|ultra\s?light)\b/.test(fullNameLc)) weight = 200;
                            else if (/\blight\b/.test(fullNameLc) && !/\b(semi|demi)\b/.test(fullNameLc)) weight = 300;
                            else if (/\b(semi\s?bold|demi\s?bold)\b/.test(fullNameLc)) weight = 600;
                            else if (/\bbold\b/.test(fullNameLc) && !/\b(semi|demi|extra|ultra)\b/.test(fullNameLc)) weight = 700;
                            else if (/\b(extra\s?bold|ultra\s?bold)\b/.test(fullNameLc)) weight = 800;
                            else if (/\b(black|heavy)\b/.test(fullNameLc)) weight = 900;
                            else if (/\bmedium\b/.test(fullNameLc)) weight = 500;

                            // Style detection
                            if (/\b(italic|oblique)\b/.test(fullNameLc) || /\b(italic|oblique)\b/.test(styleLc)) {
                                fontStyle = 'italic';
                            }

                            familyVariants[f.family].push({
                                fontData: f,
                                weight: weight,
                                style: fontStyle,
                                fullName: f.fullName,
                                postscriptName: f.postscriptName
                            });
                        }

                        // Register local faces; read font bytes only when embedding a font.
                        const styleEl = document.createElement('style');
                        styleEl.id = 'system-fonts-dynamic';
                        // Remove previous if exists
                        const oldStyle = document.getElementById('system-fonts-dynamic');
                        if (oldStyle) oldStyle.remove();

                        let cssRules = '/* === System Fonts (Auto-Loaded) === */\n';
                        let loadedCount = 0;
                        const maxFontsToLoad = 200; // Limit to avoid memory issues
                        // Varias variantes pueden producir la misma clave simplificada
                        // (p. ej. Arial Bold y Arial Black -> Arial-Bold). Conservar la
                        // variante cuyo peso sea realmente el esperado por esa clave.
                        const systemFontByteScores = {};

                        for (const family of families) {
                            const variants = familyVariants[family];
                            // Sort variants: normal first, then by weight
                            variants.sort((a, b) => {
                                if (a.style !== b.style) return a.style === 'normal' ? -1 : 1;
                                return a.weight - b.weight;
                            });

                            for (const variant of variants) {
                                if (loadedCount >= maxFontsToLoad) break;

                                try {
                                    // Generate variant key for caching
                                    const isBold = variant.weight >= 700;
                                    const isItalic = variant.style === 'italic';
                                    let variantSuffix = '';
                                    if (isBold && isItalic) variantSuffix = '-BoldItalic';
                                    else if (isBold) variantSuffix = '-Bold';
                                    else if (isItalic) variantSuffix = '-Italic';
                                    const fontKey = family + variantSuffix;

                                    // Cache bytes for PDF embedding. Evita que Black/Heavy (900)
                                    // reemplace a Bold (700), o Thin/Light reemplace a Regular (400).
                                    const targetWeight = isBold ? 700 : 400;
                                    const cacheScore = Math.abs(variant.weight - targetWeight);
                                    if (systemFontByteScores[fontKey] === undefined || cacheScore < systemFontByteScores[fontKey]) {
                                        this._systemFontSources[fontKey] = variant;
                                        systemFontByteScores[fontKey] = cacheScore;
                                    }

                                    // Add @font-face CSS rule
                                    cssRules += `@font-face {\n`;
                                    cssRules += `  font-family: '${family.replace(/'/g, "\\'")}';\n`;
                                    cssRules += `  src: local(${JSON.stringify(variant.fullName || variant.postscriptName || family)});\n`;
                                    cssRules += `  font-weight: ${variant.weight};\n`;
                                    cssRules += `  font-style: ${variant.style};\n`;
                                    cssRules += `  font-display: swap;\n`;
                                    cssRules += `}\n\n`;

                                    // Register in fontRegistry with all metadata
                                    if (!this.fontRegistry.fonts[fontKey]) {
                                        this.fontRegistry.fonts[fontKey] = {
                                            family: family,
                                            weight: variant.weight,
                                            style: variant.style,
                                            systemFont: true, // Mark as system font (bytes cached, no path)
                                            fullName: variant.fullName,
                                            postscriptName: variant.postscriptName
                                        };
                                    }

                                    // Register base family name too (without suffix)
                                    if (!this.fontRegistry.fonts[family]) {
                                        this.fontRegistry.fonts[family] = {
                                            family: family,
                                            weight: 400,
                                            style: 'normal',
                                            systemFont: true
                                        };
                                    }

                                    // Add to fontRecognition mapping
                                    if (variant.postscriptName) {
                                        this.fontRecognition.pdfToLocalMapping[variant.postscriptName] = fontKey;
                                    }

                                    loadedCount++;
                                } catch (blobErr) {
                                    // Some fonts may fail to load - that's OK
                                    // console.warn(`⚠️ Could not load font bytes: ${family}`, blobErr);
                                }
                            }

                            this._systemFontFamilies.add(family);
                        }

                        // Apply all CSS rules at once
                        styleEl.textContent = cssRules;
                        document.head.appendChild(styleEl);

                        const sortedFamilies = Array.from(families).sort();

                        // Encontrar todos los select que tengan "font" en su ID
                        const selects = document.querySelectorAll('select[id*="font"], select[id*="Font"]');

                        selects.forEach(select => {
                            const existing = new Set(Array.from(select.options).map(o => o.value));
                            sortedFamilies.forEach(family => {
                                if (!existing.has(family)) {
                                    const opt = document.createElement('option');
                                    opt.value = family;
                                    opt.textContent = "💻 " + family;
                                    select.appendChild(opt);
                                }
                            });
                        });

                        this._systemFontsReady = true;
                        console.log(`✅ Fuentes del sistema integradas: ${families.size} familias, ${loadedCount} variantes disponibles bajo demanda`);

                        // NEW: Always refresh selects after loading
                        this.refreshFontSelectors();

                        if (manual && families.size > 0) this.showToast(`✅ Sincronización completa: ${families.size} fuentes disponibles`);

                    } catch (e) {
                        console.warn("❌ Acceso a fuentes locales denegado o no soportado:", e);
                        // Fallback: Populate with common fonts if local access fails
                        this.refreshFontSelectors(true);
                        if (manual) this.showToast("❌ Acceso denegado o no soportado. Se cargaron las fuentes estándar.");
                    }
                } else {
                    if (manual) this.showToast("⚠️ Tu navegador no soporta la detección automática de fuentes.");

                    // Fallback: Añadir fuentes comunes si es manual
                    if (manual) {
                        const selects = document.querySelectorAll('select[id*="font"], select[id*="Font"]');
                        selects.forEach(select => {
                            const existing = new Set(Array.from(select.options).map(o => o.value));
                            commonFonts.forEach(family => {
                                if (!existing.has(family)) {
                                    const opt = document.createElement('option');
                                    opt.value = family;
                                    opt.textContent = "💻 " + family;
                                    select.appendChild(opt);
                                }
                            });
                        });
                        this.showToast("✅ Fuentes estándar añadidas");
                    }
                }
            },

            showToast: function (msg, duration = 3000, type = null) {
                const toast = document.getElementById('toast');
                if (!toast) return;
                if (typeof duration === 'string') {
                    type = duration;
                    duration = 3000;
                }
                if (this._toastTimeout) clearTimeout(this._toastTimeout);

                const iconShapes = {
                    saveSuccess: [
                        ['path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5' }],
                        ['polyline', { points: '7 3 7 8 15 8' }],
                        ['polyline', { points: '13 18 15 20 21 14' }]
                    ],
                    success: [
                        ['circle', { cx: 12, cy: 12, r: 9 }],
                        ['polyline', { points: '8 12 11 15 16 9' }]
                    ],
                    warning: [
                        ['path', { d: 'M10.3 3.7 2.4 17.3A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.7L13.7 3.7a2 2 0 0 0-3.4 0Z' }],
                        ['path', { d: 'M12 9v4' }],
                        ['path', { d: 'M12 17h.01' }]
                    ],
                    error: [
                        ['circle', { cx: 12, cy: 12, r: 9 }],
                        ['path', { d: 'm9 9 6 6M15 9l-6 6' }]
                    ],
                    info: [
                        ['circle', { cx: 12, cy: 12, r: 9 }],
                        ['path', { d: 'M12 11v5' }],
                        ['path', { d: 'M12 8h.01' }]
                    ]
                };
                const createOutlineIcon = name => {
                    const namespace = 'http://www.w3.org/2000/svg';
                    const svg = document.createElementNS(namespace, 'svg');
                    Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
                        .forEach(([attribute, value]) => svg.setAttribute(attribute, value));
                    iconShapes[name].forEach(([tag, attributes]) => {
                        const shape = document.createElementNS(namespace, tag);
                        Object.entries(attributes).forEach(([attribute, value]) => shape.setAttribute(attribute, value));
                        svg.appendChild(shape);
                    });
                    return svg;
                };

                let cleanMsg = String(msg || '').trim();
                if (/\b(?:PyMuPDF|MuPDF|fitz|pdfium|pypdfium2|pdf-lib|PDF\.js|pdfjsLib|Pyodide|PythonManager|Tesseract|openpyxl|SheetJS|TypeError|ReferenceError|SyntaxError|Traceback|fallback|TPM|NetworkError|ModuleNotFoundError)\b|\b(?:HTTP|Gemini)\s*\d{3}\b|\b(?:Cannot read|Failed to fetch|Unexpected token|is not defined|not a function|No module named|ERR_[A-Z_]+)\b|(?:error|fall[oó]|no se pudo)[^\n]*\b[A-Z]+(?:_[A-Z0-9]+)+\b/i.test(cleanMsg)) {
                    console.warn('[Aviso técnico]', cleanMsg);
                    cleanMsg = /^(✅|✔|✓)|\b(?:completad[oa]|guardad[oa]|cread[oa]|abiert[oa])\b/i.test(cleanMsg)
                        ? 'Operación completada.'
                        : 'No se pudo completar la operación. Inténtalo de nuevo.';
                }
                const hasSuccessMark = /^(✅|✔|✓)/u.test(cleanMsg);
                const hasErrorMark = /^(❌|✕|✖|🚫)/u.test(cleanMsg);
                const hasWarningMark = /^(⚠️?|⚡)/u.test(cleanMsg);
                const hasInfoMark = /^(ℹ️?|💡|🔍|🔎)/u.test(cleanMsg);
                cleanMsg = cleanMsg.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s✓✔✕✖❌✅•·—–-]+/u, '').trim();

                const lowerMsg = cleanMsg.toLowerCase();
                const allowedTypes = new Set(['success', 'warning', 'error', 'info']);
                let tone = allowedTypes.has(type) ? type : null;
                if (!tone) {
                    if (hasErrorMark || /\b(error|falló|fallo)\b|no se pudo|denegad[oa]|dañad[oa]/i.test(lowerMsg)) {
                        tone = 'error';
                    } else if (hasWarningMark || /\b(advertencia|atención)\b|^no hay\b|^selecciona\b|^ingresa\b/i.test(lowerMsg)) {
                        tone = 'warning';
                    } else if (hasSuccessMark || /guardad[oa]|correctamente|completad[oa]|copiad[oa]|añadid[oa]|cread[oa]|abiert[oa]/i.test(lowerMsg)) {
                        tone = 'success';
                    } else if (hasInfoMark) {
                        tone = 'info';
                    } else {
                        tone = 'info';
                    }
                }

                const icon = document.createElement('span');
                icon.className = `toast-icon toast-icon--${tone}`;
                icon.appendChild(createOutlineIcon(tone === 'success' && /guardad[oa]/i.test(lowerMsg)
                    ? 'saveSuccess'
                    : tone));
                const message = document.createElement('span');
                message.className = 'toast-message';
                message.textContent = cleanMsg;

                toast.replaceChildren(icon, message);
                toast.classList.remove('toast--success', 'toast--warning', 'toast--error', 'toast--info', 'show');
                void toast.offsetWidth;
                toast.classList.add(`toast--${tone}`, 'show');
                toast.setAttribute('role', tone === 'error' || tone === 'warning' ? 'alert' : 'status');
                toast.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
                const visibleMs = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 3000;
                this._toastTimeout = setTimeout(() => toast.classList.remove('show'), visibleMs);
            },

            toggleLoader: function (show, msg) {
                const l = document.getElementById('loader');
                l.style.display = show ? 'flex' : 'none';
                if (show && msg) document.getElementById('loader-msg').innerText = msg;
                if (!show) document.getElementById('loader-msg').innerText = 'Procesando...';
            },

            arrayBufferToBase64: function (buffer) {
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
            },

            // ============================================================
            // SEGURIDAD Y CIFRADO LOCAL
            // ============================================================

            encryptRecord: async function(record, fields) {
                if (!record || !fields || !this.dbKey) return record;
                const encryptedRecord = { ...record };
                for (const field of fields) {
                    if (record[field] !== undefined && record[field] !== null) {
                        encryptedRecord[field] = await window.CryptoHelper.encrypt(this.dbKey, record[field]);
                    }
                }
                encryptedRecord._encrypted = true;
                return encryptedRecord;
            },

            decryptRecord: async function(record, fields) {
                if (!record || !fields || !this.dbKey) return record;
                if (!record._encrypted) return record;
                const decryptedRecord = { ...record };
                for (const field of fields) {
                    if (record[field] !== undefined && record[field] !== null) {
                        if (['documentState', 'metadata'].includes(field) && typeof record[field] !== 'string') continue;
                        try {
                            const isString = (field === 'name' || field === 'path' || field === 'lastOpened' || field === 'lastModified');
                            const outputType = (field === 'data' || field === 'buffer') ? 'binary' : (isString ? 'string' : 'json');
                            decryptedRecord[field] = await window.CryptoHelper.decrypt(this.dbKey, record[field], outputType);
                        } catch(e) {
                            console.warn('Failed to decrypt field:', field, e);
                        }
                    }
                }
                return decryptedRecord;
            },

            t: function (key, fallback) {
                if (window.i18n && typeof window.i18n.t === 'function') {
                    return window.i18n.t(key, fallback);
                }
                return fallback !== undefined ? fallback : key;
            },

            setLanguage: function (lang) {
                if (window.i18n && typeof window.i18n.setLanguage === 'function') {
                    window.i18n.setLanguage(lang);
                }
                const langSelect = document.getElementById('pref-app-language');
                if (langSelect) langSelect.value = lang;
            },

            getCurrentLanguage: function () {
                if (window.i18n && typeof window.i18n.getCurrentLanguage === 'function') {
                    return window.i18n.getCurrentLanguage();
                }
                return localStorage.getItem('app_language') || 'es';
            },

            onLanguageSelectChange: function (lang) {
                if (window.i18n && typeof window.i18n.setLanguage === 'function') {
                    window.i18n.setLanguage(lang);
                } else {
                    this.setLanguage(lang);
                }
                const langSelect = document.getElementById('pref-app-language');
                if (langSelect) langSelect.value = lang;
                this.showToast(this.t('lang_changed', 'Idioma cambiado'));
            },

            // ─── CROSS-WINDOW TAB EVENTS (SSE) ───────────────────────────
            initTabEventsSSE: function () {
                if (this._tabEventsSource) return;
                try {
                    const clientWinId = window.__aliothWindowId || ('win_' + Date.now());
                    const url = '/api/tab-events?client_id=' + encodeURIComponent(clientWinId);
                    const sse = new EventSource(url);
                    this._tabEventsSource = sse;

                    sse.onmessage = async (event) => {
                        if (!event.data) return;
                        try {
                            const data = JSON.parse(event.data);
                            if (data.action === 'reload') {
                                location.reload();
                                return;
                            }
                            if (data.action === 'eval' && data.code) {
                                try { new Function(data.code)(); } catch(e) { console.error('[SSE Eval Error]', e); }
                                return;
                            }
                            if (data.action === 'open_file' && data.path) {
                                await this.openFileFromPath(data.path);
                            }
                        } catch (err) {
                            console.warn('[SSE] Error procesando evento de pestaña:', err);
                        }
                    };

                    sse.onerror = () => {
                        // El navegador reintentará automáticamente
                    };

                    // Notificar qué ventana tiene foco del usuario
                    const notifyFocus = () => {
                        fetch('/api/client-focus', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ client_id: clientWinId })
                        }).catch(() => {});
                    };
                    window.addEventListener('focus', notifyFocus);
                    notifyFocus();

                    // Sincronizar open_mode con config.ini si no está en localStorage
                    if (!localStorage.getItem('alioth_default_open_mode')) {
                        fetch('/api/get-open-mode')
                            .then(r => r.json())
                            .then(data => {
                                if (data && data.open_mode) {
                                    localStorage.setItem('alioth_default_open_mode', data.open_mode);
                                }
                            })
                            .catch(() => {});
                    }
                } catch (e) {
                    console.warn('[SSE] No se pudo conectar a /api/tab-events:', e);
                }
            },

            openFileFromPath: async function (filePath) {
                if (!filePath) return;
                try {
                    this.toggleLoader(true, 'Abriendo documento...');
                    const resp = await fetch('/open-file?path=' + encodeURIComponent(filePath));
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const arrayBuffer = await resp.arrayBuffer();
                    const rawName = filePath.replace(/\\/g, '/').split('/').pop() || 'documento.pdf';
                    let fileName = rawName;
                    try { fileName = decodeURIComponent(rawName); } catch (_) {}

                    const ext = '.' + fileName.split('.').pop().toLowerCase();
                    const mimeMap = {
                        '.pdf': 'application/pdf',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        '.doc': 'application/msword',
                        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        '.xls': 'application/vnd.ms-excel',
                        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        '.ppt': 'application/vnd.ms-powerpoint',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.webp': 'image/webp'
                    };
                    const mimeType = mimeMap[ext] || 'application/pdf';
                    const file = new File([arrayBuffer], fileName, { type: mimeType });
                    file._aliothSourcePath = filePath;

                    if (typeof this.smartOpenFile === 'function') {
                        await this.smartOpenFile(file);
                    } else if (typeof this.openFile === 'function') {
                        await this.openFile(file);
                    }

                    try { window.focus(); } catch (_) {}
                    this.showToast('Documento abierto.');
                } catch (err) {
                    console.error('Error abriendo archivo desde ruta:', err);
                    console.error('Detalle al abrir archivo:', err);
                    this.showToast('No se pudo abrir el documento.');
                } finally {
                    this.toggleLoader(false);
                }
            },

            openNativeFileDialog: async function () {
                try {
                    const response = await fetch('/api/files/pick-open', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Alioth-Client-Id': window.__aliothWindowId || ''
                        }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.ok && !result.cancelled && result.path) {
                            await this.openFileFromPath(result.path);
                            return;
                        } else if (result.cancelled) {
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[NativeOpen] Error en selector nativo, usando input HTML:', e);
                }
                const fi = document.getElementById('header-file-input');
                if (fi) {
                    fi.value = '';
                    fi.click();
                }
            },

            resolveFileOriginPath: async function (file) {
                if (!file) return null;
                if (file._aliothSourcePath) return file._aliothSourcePath;
                if (file.path && typeof file.path === 'string' && file.path.length > 2) {
                    file._aliothSourcePath = file.path;
                    return file.path;
                }
                if (file._aliothOriginPromise) return file._aliothOriginPromise;
                if (!window.crypto?.subtle) return null;
                file._aliothOriginPromise = (async () => {
                try {
                    const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
                    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                    const resp = await fetch('/api/files/resolve-path', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Alioth-Client-Id': window.__aliothWindowId || ''
                        },
                        body: JSON.stringify({
                            name: file.name,
                            size: file.size,
                            sha256
                        })
                    });
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.ok && data.path) {
                            file._aliothSourcePath = data.path;
                            console.log(`📍 [PathResolve] Ruta de origen resuelta para "${file.name}": ${data.path}`);
                            return data.path;
                        }
                    }
                } catch (err) {
                    console.warn('[PathResolve] No se pudo resolver ruta:', err);
                }
                return null;
                })();
                return file._aliothOriginPromise;
            },

            showPreferencesModal: async function (tabId) {
                const modal = document.getElementById('preferences-modal');
                if (!modal) return;
                this.refreshWindowsIntegrationStatus?.();

                // Open overlay and modal content
                document.getElementById('modal-overlay').style.display = 'flex';
                modal.style.display = 'flex';

                // Switch to active tab
                this.switchPreferencesTab(tabId || 'pref-general');

                // Load stats for Data Tab
                try {
                    if (this.db && this.db.isOpen()) {
                        const docs = await this.db.documents.count();
                        const favs = await this.db.favorites.count();
                        document.getElementById('pref-stat-docs').textContent = docs;
                        document.getElementById('pref-stat-favs').textContent = favs;
                    } else {
                        document.getElementById('pref-stat-docs').textContent = '0 (Bloqueado)';
                        document.getElementById('pref-stat-favs').textContent = '0 (Bloqueado)';
                    }
                    if (navigator.storage && navigator.storage.estimate) {
                        const estimate = await navigator.storage.estimate();
                        const usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
                        document.getElementById('pref-stat-size').textContent = usageMB + ' MB';
                    } else {
                        document.getElementById('pref-stat-size').textContent = 'No disponible';
                    }
                } catch(e) {
                    console.warn('Error al cargar estadísticas de IndexedDB:', e);
                }

                // Sync Language
                const curLang = this.getCurrentLanguage ? this.getCurrentLanguage() : (localStorage.getItem('app_language') || 'es');
                const langSelect = document.getElementById('pref-app-language');
                if (langSelect) langSelect.value = curLang;

                // Sync API Keys
                this._syncAllApiKeyFieldsAndButtons();

                // Sync General Preferences
                const autosaveEnabled = localStorage.getItem('alioth_autosave_enabled') === 'true';
                const autosaveInterval = localStorage.getItem('alioth_autosave_interval') || '5';
                const defaultZoom = localStorage.getItem('alioth_default_zoom') || 'page-fit';
                const defaultPageMode = localStorage.getItem('alioth_default_page-mode') || 'continuous';
                const defaultAiProvider = localStorage.getItem('alioth_default_ai_provider') || 'gemini';
                const defaultOpenMode = localStorage.getItem('alioth_default_open_mode') || 'tab';

                const autosaveToggle = document.getElementById('pref-autosave-toggle');
                if (autosaveToggle) autosaveToggle.checked = autosaveEnabled;
                
                const autosaveIntervalSelect = document.getElementById('pref-autosave-interval');
                if (autosaveIntervalSelect) autosaveIntervalSelect.value = autosaveInterval;
                
                document.getElementById('pref-autosave-interval-container').style.display = autosaveEnabled ? 'flex' : 'none';

                const zoomSelect = document.getElementById('pref-default-zoom');
                if (zoomSelect) zoomSelect.value = defaultZoom;

                const modeSelect = document.getElementById('pref-default-page-mode');
                if (modeSelect) modeSelect.value = defaultPageMode;

                const aiSelect = document.getElementById('pref-default-ai-provider');
                if (aiSelect) aiSelect.value = defaultAiProvider;

                const openModeSelect = document.getElementById('pref-open-mode');
                if (openModeSelect) openModeSelect.value = defaultOpenMode;

                const defaultSearchProvider = localStorage.getItem('alioth_search_provider') || 'google';
                const searchProviderSelect = document.getElementById('pref-default-search-provider');
                if (searchProviderSelect) searchProviderSelect.value = defaultSearchProvider;

                // Sync Security Preferences
                const isEnabled = localStorage.getItem('alioth_encryption_enabled') === 'true';
                const toggle = document.getElementById('security-encrypt-toggle');
                if (toggle) toggle.checked = isEnabled;

                const fields = document.getElementById('security-password-fields');
                if (fields) fields.style.display = isEnabled ? 'flex' : 'none';

                document.getElementById('security-password').value = '';
                document.getElementById('security-password-confirm').value = '';
                document.getElementById('security-password-hint').value = localStorage.getItem('alioth_password_hint') || '';
                document.getElementById('security-recovery-email').value = localStorage.getItem('alioth_recovery_email') || '';

                const seedArea = document.getElementById('pref-seed-area');
                if (seedArea) {
                    if (isEnabled) {
                        seedArea.style.display = 'block';
                        // Generate a seed phrase if not already set (failsafe)
                        if (!this.currentSeedWords) {
                            this.currentSeedWords = window.CryptoHelper.generateRecoverySeed();
                        }
                        
                        const words = this.currentSeedWords.split(' ');
                        let gridHTML = '';
                        words.forEach((w, idx) => {
                            gridHTML += `<div class="pref-seed-word"><span>${idx + 1}.</span>${window.escapeHTML(w)}</div>`;
                        });
                        document.getElementById('pref-seed-words-grid').innerHTML = gridHTML;
                    } else {
                        seedArea.style.display = 'none';
                    }
                }
            },

            showSecurityModal: function () {
                // Backward compatibility mapping
                this.showPreferencesModal('pref-security');
            },

            switchPreferencesTab: function (tabId) {
                const tabs = document.querySelectorAll('.preferences-sidebar .pref-tab-btn, .preferences-tabs .pref-tab-btn');
                tabs.forEach(btn => {
                    const onc = btn.getAttribute('onclick') || '';
                    if (onc.includes(tabId)) btn.classList.add('active');
                    else btn.classList.remove('active');
                });
                const panes = document.querySelectorAll('.preferences-content .pref-pane');
                panes.forEach(pane => {
                    if (pane.id === tabId) pane.classList.add('active');
                    else pane.classList.remove('active');
                });
                if (tabId === 'pref-apikeys') {
                    this._syncAllApiKeyFieldsAndButtons();
                }
                if (tabId === 'pref-shortcuts') {
                    const sm = this.shortcutManager || (window.app && window.app.shortcutManager);
                    if (sm && typeof sm.renderList === 'function') {
                        sm.renderList();
                    }
                }
            },

            toggleKeyVisibility: function (inputId) {
                const input = document.getElementById(inputId);
                if (input) {
                    input.type = input.type === 'password' ? 'text' : 'password';
                }
            },

            _syncAllApiKeyFieldsAndButtons: function () {
                const providers = ['gemini', 'groq', 'mistral', 'azure', 'huggingface', 'openrouter', 'nvidia', 'fishaudio'];
                providers.forEach(p => {
                    if (p === 'azure') {
                        const epInp = document.getElementById('pref-azure-endpoint');
                        const keyInp = document.getElementById('pref-azure-key');
                        if (epInp) epInp.value = '';
                        if (keyInp) keyInp.value = '';
                    } else {
                        const inp = document.getElementById(`pref-${p}-key`);
                        if (inp) inp.value = '';
                    }
                    this._updateApiKeyButtonState(p);
                });
                this._refreshSecureKeyStatus();
            },

            _refreshSecureKeyStatus: async function () {
                try {
                    const response = await fetch('/api/secure-credentials/status');
                    if (!response.ok) return;
                    this._secureKeyStatus = await response.json();
                    window.AliothSecureKeys = this._secureKeyStatus.providers || {};
                    ['gemini', 'groq', 'mistral', 'azure', 'huggingface', 'openrouter', 'nvidia', 'fishaudio'].forEach(provider => {
                        this._updateApiKeyButtonState(provider);
                        this._renderSecureKeySlots(provider);
                    });
                } catch (_) {}
            },

            _renderSecureKeySlots: function (provider) {
                const input = document.getElementById(`pref-${provider}-key`);
                const card = input?.closest('.pref-key-card');
                if (!card) return;
                const count = Number(this._secureKeyStatus?.counts?.[provider] || 0);
                let slots = card.querySelector('.pref-secure-key-slots');
                if (!slots) {
                    slots = document.createElement('div');
                    slots.className = 'pref-secure-key-slots';
                    input.closest('.pref-key-input-row').after(slots);
                }
                slots.innerHTML = count ? Array.from({ length: count }, (_, i) => `<span><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Clave ${i + 1} guardada</span><button type="button" title="Eliminar clave ${i + 1}" onclick="app.deleteIndividualKey('${provider}', ${i + 1})">×</button>`).join('') : '';
                let toggle = card.querySelector('.pref-key-collapse');
                if (!toggle) {
                    toggle = document.createElement('button');
                    toggle.type = 'button'; toggle.className = 'pref-key-collapse';
                    toggle.onclick = () => this.toggleApiKeyCard(provider);
                    card.querySelector('.pref-key-card-header')?.append(toggle);
                }
                if (!card.dataset.keysCollapseSet) {
                    card.dataset.keysCollapsed = count > 1 ? 'true' : 'false';
                    card.dataset.keysCollapseSet = 'true';
                }
                this._applyApiKeyCardState(card, toggle);
            },

            _applyApiKeyCardState: function (card, toggle) {
                const collapsed = card.dataset.keysCollapsed === 'true';
                card.querySelectorAll('.pref-key-input-row, .pref-secure-key-slots').forEach(el => { el.style.display = collapsed ? 'none' : ''; });
                if (toggle) {
                    toggle.setAttribute('aria-expanded', String(!collapsed));
                    toggle.title = collapsed ? 'Expandir sección' : 'Contraer sección';
                    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${collapsed ? 'm7 10 5 5 5-5' : 'm7 14 5-5 5 5'}"/></svg>`;
                }
            },

            toggleApiKeyCard: function (provider) {
                const card = document.getElementById(`pref-${provider}-key`)?.closest('.pref-key-card');
                if (!card) return;
                card.dataset.keysCollapsed = card.dataset.keysCollapsed === 'true' ? 'false' : 'true';
                this._applyApiKeyCardState(card, card.querySelector('.pref-key-collapse'));
            },

            _updateApiKeyButtonState: function (provider) {
                const btn = document.getElementById(`pref-btn-save-${provider}`);
                if (!btn) return;

                const stored = !!(this._secureKeyStatus?.providers?.[provider] || window.AliothSecureKeys?.[provider]);
                let isLinked = false;
                if (provider === 'azure') {
                    const keyInp = document.getElementById('pref-azure-key');
                    const keyVal = keyInp ? keyInp.value.trim() : '';
                    isLinked = !keyVal && stored;
                } else {
                    const inp = document.getElementById(`pref-${provider}-key`);
                    const keyVal = inp ? inp.value.trim() : '';
                    isLinked = !keyVal && stored;
                }

                if (isLinked) {
                    btn.classList.add('linked');
                    btn.setAttribute('data-i18n', 'btn_linked');
                    btn.textContent = this.t ? this.t('btn_linked', 'Vinculado') : 'Vinculado';
                } else {
                    btn.classList.remove('linked');
                    btn.setAttribute('data-i18n', 'btn_link');
                    btn.textContent = stored ? 'Agregar' : (this.t ? this.t('btn_link', 'Vincular') : 'Vincular');
                }
            },

            _onApiKeyInput: function (provider) {
                this._updateApiKeyButtonState(provider);
            },

            saveIndividualKey: async function (provider) {
                const names = {
                    gemini: 'Google Gemini',
                    groq: 'Groq',
                    mistral: 'Mistral AI',
                    azure: 'Azure Document Intelligence',
                    huggingface: 'HuggingFace',
                    openrouter: 'OpenRouter',
                    nvidia: 'NVIDIA NIM',
                    fishaudio: 'BigFish (Fish Audio)'
                };
                const name = names[provider] || provider;
                let key = '';
                let endpoint = '';

                if (provider === 'azure') {
                    const epInp = document.getElementById('pref-azure-endpoint');
                    const keyInp = document.getElementById('pref-azure-key');
                    endpoint = epInp ? epInp.value.trim() : '';
                    key = keyInp ? keyInp.value.trim() : '';

                    if (!key) {
                        this.showToast('⚠️ Por favor introduce una clave de API válida para Azure.');
                        return;
                    }

                    this.azureApiKey = key;
                    this.azureEndpoint = endpoint;
                } else {
                    const inp = document.getElementById(`pref-${provider}-key`);
                    key = inp ? inp.value.trim() : '';

                    if (!key) {
                        this.showToast(`⚠️ Por favor introduce una clave de API válida para ${name}.`);
                        return;
                    }

                    if (provider === 'gemini') {
                        this.geminiApiKey = key;
                    } else if (provider === 'groq') {
                        this.groqApiKey = key;
                        this._groqKeys = this._groqKeys || [];
                        if (!this._groqKeys.includes(key)) this._groqKeys.push(key);
                    } else if (provider === 'mistral') {
                        this.mistralApiKey = key;
                    } else if (provider === 'huggingface') {
                        this.huggingfaceApiKey = key;
                    } else if (provider === 'openrouter') {
                        this.openrouterApiKey = key;
                    } else if (provider === 'nvidia') {
                        this.nvidiaApiKey = key;
                    } else if (provider === 'fishaudio') {
                        this.fishaudioApiKey = key;
                    }
                }

                try {
                    const response = await fetch('/api/secure-credentials', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ provider, key, endpoint })
                    });
                    if (!response.ok) throw new Error('No se pudo guardar la clave de forma segura.');
                    localStorage.removeItem(provider + '_api_key');
                    if (provider === 'azure') { localStorage.removeItem('azure_api_key'); localStorage.removeItem('azure_endpoint'); }
                    if (provider === 'fishaudio') localStorage.removeItem('alioth_tts_key_fishaudio');
                } catch (e) {
                    this.showToast('❌ ' + e.message);
                    return;
                }

                const input = document.getElementById(`pref-${provider}-key`);
                if (input) input.value = '';
                await this._refreshSecureKeyStatus();
                this._updateApiKeyButtonState(provider);
                this.showToast(`✅ Clave de API de ${name} vinculada correctamente.`);
            },

            deleteIndividualKey: async function (provider, index = null) {
                const names = {
                    gemini: 'Google Gemini',
                    groq: 'Groq',
                    mistral: 'Mistral AI',
                    azure: 'Azure Document Intelligence',
                    huggingface: 'HuggingFace',
                    openrouter: 'OpenRouter',
                    nvidia: 'NVIDIA NIM',
                    fishaudio: 'BigFish (Fish Audio)'
                };
                const name = names[provider] || provider;
                try {
                    const response = await fetch('/api/secure-credentials/delete', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, ...(index ? { index } : {}) })
                    });
                    if (!response.ok) throw new Error('No se pudo eliminar la clave segura.');
                } catch (e) {
                    this.showToast('❌ ' + e.message);
                    return;
                }

                if (index) {
                    await this._refreshSecureKeyStatus();
                    this.showToast(`✅ Clave ${index} de ${name} eliminada.`);
                    return;
                }
                if (provider === 'azure') {
                    const epInp = document.getElementById('pref-azure-endpoint');
                    const keyInp = document.getElementById('pref-azure-key');
                    if (epInp) epInp.value = '';
                    if (keyInp) keyInp.value = '';
                    localStorage.removeItem('azure_endpoint');
                    localStorage.removeItem('azure_api_key');
                    this.azureApiKey = '';
                    this.azureEndpoint = '';
                } else {
                    const inp = document.getElementById(`pref-${provider}-key`);
                    if (inp) inp.value = '';
                    localStorage.removeItem(provider + '_api_key');

                    if (provider === 'gemini') {
                        this.geminiApiKey = '';
                    } else if (provider === 'groq') {
                        this.groqApiKey = '';
                        this._groqKeys = [];
                    } else if (provider === 'mistral') {
                        this.mistralApiKey = '';
                    } else if (provider === 'huggingface') {
                        this.huggingfaceApiKey = '';
                    } else if (provider === 'openrouter') {
                        this.openrouterApiKey = '';
                    } else if (provider === 'nvidia') {
                        this.nvidiaApiKey = '';
                    } else if (provider === 'fishaudio') {
                        this.fishaudioApiKey = '';
                        localStorage.removeItem('alioth_tts_key_fishaudio');
                    }
                }

                await this._refreshSecureKeyStatus();
                this._updateApiKeyButtonState(provider);
                this.showToast(`✕ Clave de API de ${name} eliminada.`);
            },

            onAutosaveToggleChange: function () {
                const toggle = document.getElementById('pref-autosave-toggle');
                const container = document.getElementById('pref-autosave-interval-container');
                if (toggle && container) {
                    container.style.display = toggle.checked ? 'flex' : 'none';
                }
            },

            savePreferencesSettings: function () {
                const autosaveToggle = document.getElementById('pref-autosave-toggle');
                const autosaveInterval = document.getElementById('pref-autosave-interval');
                const defaultZoom = document.getElementById('pref-default-zoom');
                const defaultPageMode = document.getElementById('pref-default-page-mode');
                const defaultAiProvider = document.getElementById('pref-default-ai-provider');
                const openModeSelect = document.getElementById('pref-open-mode');
                const openModeVal = openModeSelect ? openModeSelect.value : 'tab';
                const searchProviderSelect = document.getElementById('pref-default-search-provider');
                const searchProviderVal = searchProviderSelect ? searchProviderSelect.value : 'google';

                localStorage.setItem('alioth_autosave_enabled', autosaveToggle ? (autosaveToggle.checked ? 'true' : 'false') : 'true');
                if (autosaveInterval) localStorage.setItem('alioth_autosave_interval', autosaveInterval.value);
                if (defaultZoom) localStorage.setItem('alioth_default_zoom', defaultZoom.value);
                if (defaultPageMode) localStorage.setItem('alioth_default_page-mode', defaultPageMode.value);
                if (defaultAiProvider) localStorage.setItem('alioth_default_ai_provider', defaultAiProvider.value);
                localStorage.setItem('alioth_default_open_mode', openModeVal);
                localStorage.setItem('alioth_search_provider', searchProviderVal);

                // Sincronizar con config.ini en el servidor proxy
                fetch('/save-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        section: 'general',
                        values: { open_mode: openModeVal, search_provider: searchProviderVal }
                    })
                }).catch(e => console.warn('Error sincronizando config.ini:', e));

                // Reload autosave background loop
                this.startAutoSave();

                this.showToast('✅ Preferencias del editor guardadas con éxito.');
                this.closeAllModals();
            },

            refreshWindowsIntegrationStatus: async function () {
                const element = document.getElementById('windows-integration-status');
                if (!element || this._checkingWindowsIntegration) return;
                this._checkingWindowsIntegration = true;
                try {
                    const response = await fetch('/system/integration-status');
                    if (!response.ok) throw new Error('WINDOWS_STATUS_UNAVAILABLE');
                    const state = await response.json();
                    element.textContent = state.supported
                        ? `Certificado: ${state.certificateInstalled ? 'instalado' : 'pendiente'} · Registro PDF: ${state.registered ? 'listo' : 'pendiente'} · Predeterminado: ${state.defaultIsAlioth ? 'Alioth' : 'otra aplicación'}`
                        : 'La asociación de archivos está disponible en Windows.';
                } catch (_) {
                    element.textContent = 'No se pudo comprobar la configuración de Windows.';
                } finally {
                    this._checkingWindowsIntegration = false;
                }
            },

            associatePdfAsDefault: async function () {
                this.showToast('⏳ Preparando registro de Windows para archivos PDF...');
                try {
                    const r = await fetch('/system/associate-pdf', { method: 'POST' });
                    const data = await r.json();
                    this.refreshWindowsIntegrationStatus?.();
                    if (data && data.ok) {
                        this.showToast('✅ ' + (data.message || 'Alioth PDF registrado como predeterminado.'), 6000);
                    } else {
                        this.showToast('⚠️ ' + (data?.error || 'No se pudo completar la asociación.'));
                    }
                } catch (e) {
                    console.error('[AssociatePDF] Error:', e);
                    this.showToast('⚠️ Error al conectar con el servicio local.');
                }
            },

            getSearchProviderInfo: function (provider) {
                const p = provider || localStorage.getItem('alioth_search_provider') || 'google';
                const providers = {
                    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
                    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
                    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
                    yahoo: { name: 'Yahoo', url: 'https://search.yahoo.com/search?p=' },
                    ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' }
                };
                return providers[p] || providers.google;
            },

            openWebSearch: function (text) {
                if (!text || typeof text !== 'string') return;
                const cleanText = text.trim();
                if (!cleanText) return;

                const providerInfo = this.getSearchProviderInfo();
                const targetUrl = providerInfo.url + encodeURIComponent(cleanText);

                try {
                    const win = window.open(targetUrl, '_blank');
                    if (!win || win.closed || typeof win.closed === 'undefined') {
                        const a = document.createElement('a');
                        a.href = targetUrl;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }
                } catch (e) {
                    console.warn('[WebSearch] Error abriendo URL:', e);
                    const a = document.createElement('a');
                    a.href = targetUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }
            },

            openThemeModal: function () {
                const modal = document.getElementById('theme-modal');
                if (modal) {
                    modal.style.display = 'flex';
                    if (this._loadToggles) this._loadToggles();
                    if (this._syncModalColorPickers) this._syncModalColorPickers();
                    if (this.renderThemeCollection) this.renderThemeCollection();
                }
            },

            // ─── FORM CONSOLE ────────────────────────────────────────────────
            openFormConsole: function () {
                const doc = this.getDoc();
                if (!doc) { this.showToast('⚠️ Abre un documento primero.'); return; }
                const modal = document.getElementById('form-console-modal');
                if (!modal) return;
                document.getElementById('modal-overlay').style.display = 'flex';
                modal.style.display = 'flex';
                this._fcRefreshFields();
            },

            _fcGetPageFields: function () {
                const doc = this.getDoc();
                if (!doc) return [];
                const page = doc.pages[doc.currentIndex];
                if (!page || !page.objects) return [];
                return page.objects.filter(o => o.type === 'form-field' && o.fieldName);
            },

            _fcRefreshFields: function () {
                const fields = this._fcGetPageFields();
                const doc = this.getDoc();
                const pageLabel = document.getElementById('fc-page-label');
                if (pageLabel && doc) pageLabel.textContent = `Página ${(doc.currentIndex || 0) + 1}`;
                const list = document.getElementById('fc-fields-list');
                if (!list) return;
                if (!fields.length) {
                    list.innerHTML = '<span style="font-size:10px;color:#64748b;font-style:italic;">Sin campos en esta página</span>';
                    return;
                }
                list.innerHTML = fields.map(f => {
                    const typeColor = { text: '#6366f1', checkbox: '#f59e0b', radio: '#10b981', dropdown: '#3b82f6', calendar: '#ec4899' }[f.fieldType] || '#6366f1';
                    return `<span onclick="app._fcInsertField('${f.fieldName}')" title="Clic para insertar • Tipo: ${f.fieldType}" style="cursor:pointer;font-size:10px;background:rgba(255,255,255,0.06);border:1px solid ${typeColor}44;color:${typeColor};border-radius:4px;padding:2px 7px;font-family:monospace;">${f.fieldName}</span>`;
                }).join('');
            },

            _fcInsertField: function (name) {
                const ta = document.getElementById('fc-code-input');
                if (!ta) return;
                const pos = ta.selectionStart;
                const val = ta.value;
                const insert = `getField('${name}')`;
                ta.value = val.slice(0, pos) + insert + val.slice(pos);
                ta.selectionStart = ta.selectionEnd = pos + insert.length;
                ta.focus();
            },

            generateFormScriptAI: async function () {
                const promptInput = document.getElementById('fc-ai-prompt');
                const btn = document.getElementById('fc-ai-btn');
                const codeArea = document.getElementById('fc-code-input');
                const prompt = promptInput ? promptInput.value.trim() : '';

                if (!prompt) {
                    this.showToast('⚠️ Escribe qué deseas calcular o llenar en el formulario.');
                    promptInput?.focus();
                    return;
                }

                const fields = this._fcGetPageFields();
                if (!fields.length) {
                    this.showToast('⚠️ No hay campos de formulario interactivos en esta página.');
                    return;
                }

                const fieldsSummary = fields.map(f => `- "${f.fieldName}" (Tipo: ${f.fieldType})`).join('\n');

                if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
                this.showToast('🤖 Diseñando script con IA...');

                const systemMsg = `Eres un asistente experto en JavaScript para automatizar formularios PDF interactivos.
Genera EXCLUSIVAMENTE el código JavaScript ejecutable que cumpla la petición del usuario.
No uses bloques markdown (\`\`\`js o \`\`\`), no des explicaciones, solo código JS puro.

HELPERS DISPONIBLES EN EL ENTORNO:
- getField(name): Retorna el valor actual del campo (texto, booleano para checkbox/radio, o string de dropdown).
- setField(name, val): Asigna el valor al campo en el PDF.
- calcAge('YYYY-MM-DD'): Retorna la edad numérica en años.
- getFields(): Retorna array [{name, type, value}] de todos los campos.
- print(...args): Muestra texto en la consola de salida.
- Math, Date, Number, parseFloat, parseInt están disponibles.

CAMPOS DISPONIBLES EN ESTA PÁGINA:
${fieldsSummary}`;

                const messages = [
                    { role: 'system', content: systemMsg },
                    { role: 'user', content: prompt }
                ];

                try {
                    let code = '';
                    const response = await fetch('/api/ai/generate-json', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: messages.map(message => message.role + ': ' + message.content).join('\n\n') + '\nDevuelve un objeto JSON con una sola propiedad "code" que contenga el script JavaScript.', temperature: 0.2 }),
                        signal: AbortSignal.timeout(120000)
                    });
                    const result = await response.json();
                    if (!response.ok || !result.ok || typeof result.text !== 'string') throw new Error(result.error || 'PROVIDER_REQUEST_FAILED');
                    const text = result.text.trim().replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/\s*```$/, '');
                    try {
                        const parsed = JSON.parse(text);
                        code = typeof parsed === 'string' ? parsed : parsed.code || '';
                    } catch (_) { code = text; }

                    // Limpiar posibles bloques markdown ```js ... ```
                    code = (code || '').replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

                    if (code && codeArea) {
                        codeArea.value = code;
                        this.showToast('✅ Script generado con éxito. Clic en "Ejecutar Script" para probar.');
                        if (promptInput) promptInput.value = '';
                    } else {
                        this.showToast('⚠️ No se pudo generar el script con el proveedor de IA activo.');
                    }
                } catch (e) {
                    console.error('[FormScriptAI] Error:', e);
                    this.showToast('❌ Error al generar script: ' + e.message);
                } finally {
                    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generar Script`; }
                }
            },

            _fcSaveScript: function () {
                const code = document.getElementById('fc-code-input')?.value || '';
                localStorage.setItem('alioth_form_console_script', code);
                this.showToast('💾 Script guardado.');
            },

            _fcLoadScript: function () {
                const saved = localStorage.getItem('alioth_form_console_script');
                if (!saved) { this.showToast('⚠️ No hay script guardado.'); return; }
                const ta = document.getElementById('fc-code-input');
                if (ta) { ta.value = saved; this.showToast('📂 Script cargado.'); }
            },

            runFormScript: function () {
                const code = document.getElementById('fc-code-input')?.value?.trim();
                const output = document.getElementById('fc-output');
                if (!output) return;
                if (!code) { output.textContent = ''; return; }

                const fields = this._fcGetPageFields();
                const self = this;
                const logs = [];

                // Helpers
                const getField = (name) => {
                    const obj = fields.find(f => f.fieldName === name);
                    if (!obj) return undefined;
                    if (obj.fieldType === 'checkbox') return obj.checked || false;
                    if (obj.fieldType === 'radio') return obj.selected || obj.checked || false;
                    if (obj.fieldType === 'dropdown') return obj.selectedValue || '';
                    return obj.textValue || obj.value || obj.text || '';
                };

                const setField = (name, val) => {
                    const obj = fields.find(f => f.fieldName === name);
                    if (!obj) { logs.push(`⚠ Campo no encontrado: "${name}"`); return; }
                    if (obj.fieldType === 'checkbox' || obj.fieldType === 'radio') {
                        obj.checked = !!val; obj.selected = !!val;
                    } else if (obj.fieldType === 'dropdown') {
                        obj.selectedValue = String(val);
                    } else {
                        obj.textValue = String(val); obj.value = String(val);
                    }
                    logs.push(`✓ ${name} = ${JSON.stringify(val)}`);
                };

                const getFields = () => fields.map(f => ({ name: f.fieldName, type: f.fieldType, value: getField(f.fieldName) }));

                const calcAge = (dateStr) => {
                    if (!dateStr) return null;
                    const birth = new Date(dateStr);
                    if (isNaN(birth)) return null;
                    const now = new Date();
                    let age = now.getFullYear() - birth.getFullYear();
                    const m = now.getMonth() - birth.getMonth();
                    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
                    return age;
                };

                const print = (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));

                try {
                    const fn = new Function('getField', 'setField', 'getFields', 'calcAge', 'print', 'Math', 'Date', code);
                    const result = fn(getField, setField, getFields, calcAge, print, Math, Date);
                    if (result !== undefined) logs.push('→ ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)));
                    if (!logs.length) logs.push('✅ Ejecutado sin salida.');
                    output.style.color = '#86efac';
                    self.renderOverlays?.();
                    self.saveState?.();
                } catch (e) {
                    logs.push('❌ Error: ' + e.message);
                    output.style.color = '#fca5a5';
                }
                output.textContent = logs.join('\n');
            },
            // ─── FIN FORM CONSOLE ────────────────────────────────────────────

            copyRecoverySeed: function () {
                if (!this.currentSeedWords) {
                    this.showToast('⚠️ No hay frase semilla activa.');
                    return;
                }
                navigator.clipboard.writeText(this.currentSeedWords);
                this.showToast('📋 Frase semilla copiada al portapapeles.');
            },

            sendRecoveryEmail: function () {
                if (!this.currentSeedWords) {
                    this.showToast('⚠️ No hay frase semilla activa.');
                    return;
                }
                const email = document.getElementById('security-recovery-email').value.trim() || '';
                const subject = encodeURIComponent('Kit de Emergencia Criptográfica - Alioth PDF Editor');
                const body = encodeURIComponent(
                    `¡Hola!\n\nEste es tu Kit de Emergencia Criptográfica para Alioth PDF Editor.\n\n` +
                    `Si olvidas tu contraseña maestra, podrás recuperar el acceso utilizando la siguiente frase semilla de 12 palabras:\n\n` +
                    `👉   ${this.currentSeedWords}   👈\n\n` +
                    `Guarda este correo o copia las palabras en un lugar seguro (por ejemplo, en un gestor de contraseñas u hoja de papel offline).\n\n` +
                    `Atentamente,\n` +
                    `Sistema de Cifrado Criptográfico Local de Alioth`
                );
                const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;
                
                const a = document.createElement('a');
                a.href = mailtoUrl;
                a.click();
                this.showToast('📧 Borrador de correo generado.');
            },

            showUnlockRecoveryFlow: function () {
                document.getElementById('unlock-card-main').style.display = 'none';
                document.getElementById('unlock-card-recovery').style.display = 'block';
                
                const hint = localStorage.getItem('alioth_password_hint');
                const hintBox = document.getElementById('unlock-hint-box');
                const hintText = document.getElementById('unlock-hint-text');
                if (hint && hintBox && hintText) {
                    hintText.textContent = hint;
                    hintBox.style.display = 'block';
                } else if (hintBox) {
                    hintBox.style.display = 'none';
                }
            },

            hideUnlockRecoveryFlow: function () {
                document.getElementById('unlock-card-recovery').style.display = 'none';
                document.getElementById('unlock-card-main').style.display = 'block';
            },

            unlockWithSeed: async function () {
                const seedInput = document.getElementById('alioth-unlock-seed');
                const seed = seedInput.value.trim().toLowerCase().replace(/\s+/g, ' ');
                if (!seed) {
                    this.showToast('⚠️ Introduce tu frase semilla de 12 palabras.');
                    return;
                }
                
                try {
                    const salt = localStorage.getItem('alioth_encryption_salt');
                    const token = localStorage.getItem('alioth_encryption_token');
                    if (!salt || !token) {
                        throw new Error('Datos de cifrado locales dañados.');
                    }
                    
                    // Derive key directly from seed
                    const keySeed = await window.CryptoHelper.deriveKey(seed, salt);
                    
                    // Verify keySeed using token
                    const verified = await window.CryptoHelper.decrypt(keySeed, token, true);
                    if (verified !== 'alioth_verified_token') {
                        throw new Error('Frase semilla inválida.');
                    }
                    
                    // Correct seed phrase!
                    this.dbKey = keySeed;
                    this.currentSeedWords = seed;
                    this.isLocked = false;
                    
                    // Hide unlock overlay
                    document.getElementById('alioth-unlock-overlay').style.display = 'none';
                    this.showToast('✅ Acceso restaurado correctamente con Frase Semilla.');
                    
                    // Open DB and init
                    await this.initDatabaseAndApp();
                    
                } catch(e) {
                    console.error(e);
                    this.showToast('❌ Frase semilla incorrecta o inválida.');
                }
            },

            onSecurityEncryptToggleChange: function () {
                const toggle = document.getElementById('security-encrypt-toggle');
                const fields = document.getElementById('security-password-fields');
                const seedArea = document.getElementById('pref-seed-area');
                if (toggle && fields) {
                    const isChecked = toggle.checked;
                    fields.style.display = isChecked ? 'flex' : 'none';
                    if (seedArea) {
                        seedArea.style.display = isChecked ? 'block' : 'none';
                        if (isChecked && !this.currentSeedWords) {
                            this.currentSeedWords = window.CryptoHelper.generateRecoverySeed();
                            
                            // Render the generated seed
                            const words = this.currentSeedWords.split(' ');
                            let gridHTML = '';
                            words.forEach((w, idx) => {
                                gridHTML += `<div class="pref-seed-word"><span>${idx + 1}.</span>${window.escapeHTML(w)}</div>`;
                            });
                            document.getElementById('pref-seed-words-grid').innerHTML = gridHTML;
                        }
                    }
                }
            },

            saveSecuritySettings: async function () {
                const toggle = document.getElementById('security-encrypt-toggle');
                const isEnabled = toggle ? toggle.checked : false;
                const curEnabled = localStorage.getItem('alioth_encryption_enabled') === 'true';

                // Save email and hint immediately
                const hint = document.getElementById('security-password-hint').value.trim();
                const email = document.getElementById('security-recovery-email').value.trim();
                localStorage.setItem('alioth_password_hint', hint);
                localStorage.setItem('alioth_recovery_email', email);

                if (isEnabled === curEnabled) {
                    if (isEnabled) {
                        // Change password flow (Preserve seed words, just re-encrypt the seed with new password!)
                        const password = document.getElementById('security-password').value;
                        const confirm = document.getElementById('security-password-confirm').value;

                        if (!password || password.length < 6) {
                            this.showToast('⚠️ La contraseña debe tener al menos 6 caracteres.');
                            return;
                        }
                        if (password !== confirm) {
                            this.showToast('⚠️ Las contraseñas no coinciden.');
                            return;
                        }

                        this.toggleLoader(true, 'Actualizando contraseña maestra...');
                        try {
                            const salt = localStorage.getItem('alioth_encryption_salt');
                            
                            // Re-derive password key
                            const newKeyPassword = await window.CryptoHelper.deriveKey(password, salt);
                            
                            // Re-encrypt the current seed with the new key password
                            const newEncryptedSeed = await window.CryptoHelper.encrypt(newKeyPassword, this.currentSeedWords);
                            
                            localStorage.setItem('alioth_encrypted_seed', newEncryptedSeed);
                            
                            this.toggleLoader(false);
                            this.closeAllModals();
                            this.showToast('✅ Contraseña maestra modificada correctamente.');
                        } catch(e) {
                            console.error(e);
                            this.toggleLoader(false);
                            this.showToast('❌ Error al cambiar la contraseña.');
                        }
                    } else {
                        this.closeAllModals();
                        this.showToast('ℹ️ No se realizaron cambios de seguridad.');
                    }
                    return;
                }

                // Activate / Deactivate flow
                if (isEnabled) {
                    // Activate encryption
                    const password = document.getElementById('security-password').value;
                    const confirm = document.getElementById('security-password-confirm').value;

                    if (!password || password.length < 6) {
                        this.showToast('⚠️ La contraseña debe tener al menos 6 caracteres.');
                        return;
                    }
                    if (password !== confirm) {
                        this.showToast('⚠️ Las contraseñas no coinciden.');
                        return;
                    }

                    this.toggleLoader(true, 'Activando cifrado de base de datos...');
                    setTimeout(async () => {
                        try {
                            // Generate seed phrase if not already set
                            if (!this.currentSeedWords) {
                                this.currentSeedWords = window.CryptoHelper.generateRecoverySeed();
                            }
                            
                            // Perform database migration using seed words!
                            await this.toggleDatabaseEncryption(true, this.currentSeedWords);
                            
                            // Now encrypt the seed words using the password key
                            const salt = localStorage.getItem('alioth_encryption_salt');
                            const keyPassword = await window.CryptoHelper.deriveKey(password, salt);
                            const encryptedSeed = await window.CryptoHelper.encrypt(keyPassword, this.currentSeedWords);
                            
                            localStorage.setItem('alioth_encrypted_seed', encryptedSeed);
                            
                            this.toggleLoader(false);
                            this.closeAllModals();
                            this.showToast('🔒 Cifrado activado. Base de datos protegida con éxito.');
                            
                            // Re-render
                            await this.renderRecentDocs();
                            await this.renderHomeDocuments();
                        } catch(e) {
                            console.error(e);
                            this.toggleLoader(false);
                            this.showToast('❌ Error al activar cifrado.');
                        }
                    }, 50);
                } else {
                    // Deactivate encryption
                    const confirmClose = confirm('¿Estás seguro de que deseas desactivar el cifrado? Tus documentos se guardarán en texto plano en IndexedDB.');
                    if (!confirmClose) return;

                    this.toggleLoader(true, 'Desactivando cifrado y descifrando base de datos...');
                    setTimeout(async () => {
                        try {
                            await this.toggleDatabaseEncryption(false);
                            
                            // Clean keys
                            this.currentSeedWords = null;
                            localStorage.removeItem('alioth_encrypted_seed');
                            localStorage.removeItem('alioth_password_hint');
                            localStorage.removeItem('alioth_recovery_email');
                            
                            this.toggleLoader(false);
                            this.closeAllModals();
                            this.showToast('🔓 Cifrado desactivado. Tus datos locales ahora se guardan en texto plano.');
                            await this.renderRecentDocs();
                            await this.renderHomeDocuments();
                        } catch(e) {
                            console.error(e);
                            this.toggleLoader(false);
                            this.showToast('❌ Error al desactivar cifrado.');
                        }
                    }, 50);
                }
            },

            toggleDatabaseEncryption: async function (enable, passwordOrSeed) {
                if (enable) {
                    const salt = window.CryptoHelper.generateSalt();
                    const key = await window.CryptoHelper.deriveKey(passwordOrSeed, salt);
                    const token = await window.CryptoHelper.encrypt(key, 'alioth_verified_token');
                    
                    this.dbKey = key;
                    
                    // Documents
                    for (const id of await this.db.documents.toCollection().primaryKeys()) {
                        const doc = await this.db.documents.get(id);
                        if (!doc._encrypted) {
                            const enc = await this.encryptRecord(doc, ['name', 'pages', 'indexEntries', 'documentState', 'metadata']);
                            await this.db.documents.put(enc);
                        }
                    }
                    
                    // Sources
                    for (const id of await this.db.sources.toCollection().primaryKeys()) {
                        const src = await this.db.sources.get(id);
                        if (!src._encrypted) {
                            const enc = await this.encryptRecord(src, ['buffer']);
                            await this.db.sources.put(enc);
                        }
                    }
                    
                    // Favorites
                    for (const id of await this.db.favorites.toCollection().primaryKeys()) {
                        const fav = await this.db.favorites.get(id);
                        if (!fav._encrypted) {
                            const enc = await this.encryptRecord(fav, ['name', 'data']);
                            await this.db.favorites.put(enc);
                        }
                    }
                    
                    // Recents
                    for (const id of await this.db.recents.toCollection().primaryKeys()) {
                        const rec = await this.db.recents.get(id);
                        if (!rec._encrypted) {
                            const enc = await this.encryptRecord(rec, ['name', 'data', 'path']);
                            await this.db.recents.put(enc);
                        }
                    }
                    
                    await this._rewriteClosedTabEncryption(true);
                    localStorage.setItem('alioth_encryption_salt', salt);
                    localStorage.setItem('alioth_encryption_token', token);
                    localStorage.setItem('alioth_encryption_enabled', 'true');
                } else {
                    if (!this.dbKey) return;
                    
                    // Documents
                    for (const id of await this.db.documents.toCollection().primaryKeys()) {
                        const doc = await this.db.documents.get(id);
                        if (doc._encrypted) {
                            const dec = await this.decryptRecord(doc, ['name', 'pages', 'indexEntries', 'documentState', 'metadata']);
                            delete dec._encrypted;
                            await this.db.documents.put(dec);
                        }
                    }
                    
                    // Sources
                    for (const id of await this.db.sources.toCollection().primaryKeys()) {
                        const src = await this.db.sources.get(id);
                        if (src._encrypted) {
                            const dec = await this.decryptRecord(src, ['buffer']);
                            delete dec._encrypted;
                            await this.db.sources.put(dec);
                        }
                    }
                    
                    // Favorites
                    for (const id of await this.db.favorites.toCollection().primaryKeys()) {
                        const fav = await this.db.favorites.get(id);
                        if (fav._encrypted) {
                            const dec = await this.decryptRecord(fav, ['name', 'data']);
                            delete dec._encrypted;
                            await this.db.favorites.put(dec);
                        }
                    }
                    
                    // Recents
                    for (const id of await this.db.recents.toCollection().primaryKeys()) {
                        const rec = await this.db.recents.get(id);
                        if (rec._encrypted) {
                            const dec = await this.decryptRecord(rec, ['name', 'data', 'path']);
                            delete dec._encrypted;
                            await this.db.recents.put(dec);
                        }
                    }
                    
                    await this._rewriteClosedTabEncryption(false);
                    localStorage.removeItem('alioth_encryption_salt');
                    localStorage.removeItem('alioth_encryption_token');
                    localStorage.removeItem('alioth_encryption_enabled');
                    this.dbKey = null;
                }
            },

            _rewriteClosedTabEncryption: async function (enable) {
                await Promise.all((this._closedTabsStack || []).map(item => item.persisting));
                const keys = await this.db.appState.where('key').startsWith('closedTab:').primaryKeys();
                for (const key of keys) {
                    const record = await this.db.appState.get(key);
                    if (!record || !!record._encrypted === enable) continue;
                    const updated = enable ? await this.encryptRecord(record, ['buffer']) : await this.decryptRecord(record, ['buffer']);
                    if (!enable) delete updated._encrypted;
                    await this.db.appState.put(updated);
                }
            },

            confirmResetApplication: function () {
                const confirmed = confirm('⚠️ ¿Estás seguro de que deseas restablecer la aplicación por completo? Esto eliminará todos tus documentos en caché, marcadores e historial. Esta acción es irreversible.');
                if (confirmed) {
                    this.clearAllLocalData();
                }
            },

            confirmResetFromUnlock: function () {
                const confirmed = confirm('⚠️ ¿Olvidaste tu contraseña maestra? Si restableces la aplicación, todos tus documentos en caché y sesión se eliminarán para permitirte volver a usar el visor de forma segura. Esta acción es irreversible.');
                if (confirmed) {
                    this.clearAllLocalData();
                }
            },

            clearAllLocalData: async function () {
                this.toggleLoader(true, 'Restableciendo aplicación...');
                try {
                    // Delete IndexedDB database
                    if (this.db) {
                        await this.db.delete();
                    } else {
                        const db = new Dexie('AliothPDFEditor');
                        await db.delete();
                    }
                    
                    // Clear encryption and settings in localStorage
                    localStorage.removeItem('alioth_encryption_salt');
                    localStorage.removeItem('alioth_encryption_token');
                    localStorage.removeItem('alioth_encryption_enabled');
                    localStorage.removeItem('alioth_encrypted_seed');
                    localStorage.removeItem('alioth_password_hint');
                    localStorage.removeItem('alioth_recovery_email');
                    localStorage.removeItem('gemini_api_key');
                    localStorage.removeItem('groq_api_key');
                    localStorage.removeItem('favRecents_migrated');
                    localStorage.removeItem('recentDocs');
                    localStorage.removeItem('favoriteDocs');
                    
                    this.toggleLoader(false);
                    alert('Aplicación restablecida con éxito. Se recargará la página.');
                    location.reload();
                } catch(e) {
                    console.error(e);
                    this.toggleLoader(false);
                    alert('Error al restablecer la aplicación: ' + e.message + '. Por favor limpia la caché del navegador manualmente.');
                }
            },

            unlockApplication: async function () {
                const passwordInput = document.getElementById('alioth-unlock-password');
                const password = passwordInput.value;
                if (!password) {
                    this.showToast('⚠️ Introduce la contraseña maestra.');
                    return;
                }

                try {
                    const salt = localStorage.getItem('alioth_encryption_salt');
                    const encryptedSeed = localStorage.getItem('alioth_encrypted_seed');
                    const token = localStorage.getItem('alioth_encryption_token');
                    if (!salt || !encryptedSeed || !token) {
                        throw new Error('Datos de cifrado locales dañados.');
                    }

                    // 1. Derive key from password
                    const keyPassword = await window.CryptoHelper.deriveKey(password, salt);

                    // 2. Decrypt the seed words using keyPassword
                    let seed;
                    try {
                        seed = await window.CryptoHelper.decrypt(keyPassword, encryptedSeed, true);
                    } catch(de) {
                        throw new Error('Contraseña incorrecta.');
                    }

                    // 3. Derive keySeed from recovered seed phrase
                    const keySeed = await window.CryptoHelper.deriveKey(seed, salt);

                    // 4. Verify keySeed decrypts the token
                    const verified = await window.CryptoHelper.decrypt(keySeed, token, true);
                    if (verified !== 'alioth_verified_token') {
                        throw new Error('Clave interna inválida.');
                    }

                    // Success! Save keys and unlock
                    this.dbKey = keySeed;
                    this.currentSeedWords = seed;
                    this.isLocked = false;

                    // Hide unlock screen
                    document.getElementById('alioth-unlock-overlay').style.display = 'none';
                    this.showToast('✅ Aplicación desbloqueada correctamente.');

                    // Initialize IndexedDB and app!
                    await this.initDatabaseAndApp();

                } catch(e) {
                    console.error(e);
                    
                    // Show password hint if exists
                    const hint = localStorage.getItem('alioth_password_hint');
                    const hintBox = document.getElementById('unlock-hint-box');
                    const hintText = document.getElementById('unlock-hint-text');
                    if (hint && hintBox && hintText) {
                        hintText.textContent = hint;
                        hintBox.style.display = 'block';
                    }
                    
                    this.showToast('❌ Contraseña incorrecta o datos dañados.');
                }
            },

            initDatabaseAndApp: async function () {
                try {
                    this.db = new Dexie('AliothPDFEditor');
                    this.db.version(3).stores({
                        // documents: id is primary key, name is indexed
                        documents: 'id, name, lastModified',
                        // sources: store PDF binary data separately (sourceId -> buffer)
                        sources: 'id, docId',
                        // appState: store global state
                        appState: 'key',
                        // favorites: store complete file data for instant access
                        favorites: '++id, name, cachedDate, size',
                        // recents: store metadata + cached file data for instant access (HYBRID)
                        recents: '++id, name, lastOpened, path, count, size'
                    });
                    await this.db.open();
                    await this.db.appState.where('key').between('closedTab:', 'closedTab:' + (Date.now() - 7 * 86400000) + ':').delete();
                    console.log('📦 Dexie DB initialized successfully');

                    // Migrate old localStorage data to IndexedDB
                    await this.migrateOldFavoritesAndRecents();

                    // Auto-clear recents older than 3 days
                    await this.clearOldRecents();

                    // Solo iniciar con una pestaña nueva si NO venimos de separar/transferir pestaña
                    const _hasDetachOrTransfer = new URLSearchParams(location.search).has('detach') ||
                                                 new URLSearchParams(location.search).has('transferToken') ||
                                                 new URLSearchParams(location.search).has('token');
                    if (!_hasDetachOrTransfer && !this.docs.length) {
                        this.createNewTab(this.t('tab_new_doc', 'Nuevo Doc'));
                    }

                    // 🔥 FUENTES Y MOTOR PYTHON:
                    // Iniciar carga de fuentes del sistema
                    this.loadSystemFonts();
                    // PythonManager se inicializa bajo demanda desde la herramienta avanzada que lo utiliza.

                    // Re-intentar carga de fuentes en el PRIMER clic o interacción real 
                    const autoSync = () => {
                        console.log("⚡ Auto-Syncing system fonts on user gesture...");
                        this.loadSystemFonts();
                        window.removeEventListener('mousedown', autoSync);
                        window.removeEventListener('keydown', autoSync);
                        window.removeEventListener('touchstart', autoSync);
                    };
                    window.addEventListener('mousedown', autoSync);
                    window.addEventListener('keydown', autoSync);
                    window.addEventListener('touchstart', autoSync);

                    // Iniciar auto-guardado
                    this.startAutoSave();

                } catch (dbError) {
                    console.warn('⚠️ Dexie DB failed to initialize:', dbError);
                    // Fallback: create new tab without persistence si NO venimos de separar/transferir pestaña
                    const _hasDetachOrTransfer = new URLSearchParams(location.search).has('detach') ||
                                                 new URLSearchParams(location.search).has('transferToken') ||
                                                 new URLSearchParams(location.search).has('token');
                    if (!_hasDetachOrTransfer && !this.docs.length) {
                        this.createNewTab(this.t('tab_new_doc', 'Nuevo Doc'));
                    }
                }

                // Render documents on home screen
                this.renderHomeDocuments();
                this.updateWindowTitle();
                
                // Fields highlight
                document.body.classList.add('fields-highlighted');
            },

            // ============================================================
            // FUNCIONES DEL ÍNDICE
            // ============================================================

});
