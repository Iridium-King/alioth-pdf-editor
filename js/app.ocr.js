// Browser OCR workers backed by bundled Tesseract assets + hybrid Windows OCR bridge.
if (!window.app) window.app = {};

Object.assign(window.app, {
    _ocrWorkers: new Map(),
    _ocrWorkersByLang: new Map(),
    _nativeOcrStatusCache: null,

    _createLocalOCRWorker: async function (languages, logger = () => {}) {
        if (typeof Tesseract === 'undefined') await this.lazyLoad('tesseract');
        if (typeof Tesseract === 'undefined') throw new Error('OCR_LOCAL_UNAVAILABLE');
        const worker = Tesseract.createWorker(languages, 1, {
            workerPath: 'libs/tesseract.worker.min.js',
            workerBlobURL: false,
            corePath: 'libs/ocr-offline',
            langPath: 'libs/ocr-offline',
            logger
        });
        let timer;
        try {
            return await Promise.race([worker, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('OCR_LOCAL_START_TIMEOUT')), 30000);
            })]);
        } catch (error) {
            worker.then(instance => instance.terminate()).catch(() => {});
            throw error;
        } finally {
            clearTimeout(timer);
        }
    },

    _getOCRWorker: function (psmMode = 3) {
        if (!this._ocrWorkers.has(psmMode)) {
            const pending = (async () => {
                const worker = await this._createLocalOCRWorker('spa', message => {
                    if (message.status !== 'recognizing text') return;
                    const label = document.getElementById('loader-msg');
                    if (label) label.innerText = `Reconociendo texto: ${Math.round(message.progress * 100)}% completado...`;
                });
                try {
                    await worker.setParameters({ tessedit_pageseg_mode: psmMode, preserve_interword_spaces: '1' });
                    return worker;
                } catch (error) {
                    await worker.terminate().catch(() => {});
                    throw error;
                }
            })().catch(error => {
                this._ocrWorkers.delete(psmMode);
                throw error;
            });
            this._ocrWorkers.set(psmMode, pending);
        }
        return this._ocrWorkers.get(psmMode);
    },

    _getOCRWorkerForLang: function (languages = 'spa', psmMode = 3) {
        const langKey = (languages || 'spa').trim() || 'spa';
        if (langKey === 'spa') return this._getOCRWorker(psmMode);
        const cacheKey = `${langKey}:${psmMode}`;
        if (!this._ocrWorkersByLang.has(cacheKey)) {
            const pending = (async () => {
                const worker = await this._createLocalOCRWorker(langKey, message => {
                    if (message.status !== 'recognizing text') return;
                    const label = document.getElementById('loader-msg');
                    if (label) label.innerText = `Reconociendo texto: ${Math.round(message.progress * 100)}% completado...`;
                });
                try {
                    await worker.setParameters({ tessedit_pageseg_mode: psmMode, preserve_interword_spaces: '1' });
                    return worker;
                } catch (error) {
                    await worker.terminate().catch(() => {});
                    throw error;
                }
            })().catch(error => {
                this._ocrWorkersByLang.delete(cacheKey);
                throw error;
            });
            this._ocrWorkersByLang.set(cacheKey, pending);
        }
        return this._ocrWorkersByLang.get(cacheKey);
    },

    _arrayBufferToBase64: function (buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const chunk = 0x8000;
        const parts = [];
        for (let i = 0; i < bytes.length; i += chunk) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
        }
        return btoa(parts.join(''));
    },

    _base64ToArrayBuffer: function (b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            out[i] = bin.charCodeAt(i);
        }
        return out.buffer;
    },

    _probeNativeOcrStatus: async function (forceRefresh = false) {
        if (!forceRefresh && this._nativeOcrStatusCache) return this._nativeOcrStatusCache;
        const fallback = { ok: true, windowsOcr: false, languages: [] };
        const proto = (typeof window !== 'undefined' && window.location && window.location.protocol) || '';
        if (proto === 'file:' || typeof fetch !== 'function') {
            return fallback;
        }
        try {
            const resp = await fetch('/api/pdf/ocr/status', { method: 'GET' });
            if (!resp || !resp.ok) return fallback;
            const data = await resp.json();
            if (data && data.ok) {
                this._nativeOcrStatusCache = data;
                return data;
            }
        } catch (_) {
            // Ignorar si no hay servidor proxy activo
        }
        return fallback;
    },

    _mapTessLang: function (lang) {
        const v = String(lang || 'es').trim().toLowerCase();
        if (v === 'en' || v === 'eng' || v.startsWith('en-')) return 'eng';
        if (v === 'spa+eng' || v === 'es+en' || v === 'auto') return 'spa+eng';
        return 'spa';
    },

    applyOcrToDocument: async function ({ scope = 'all', lang = 'es', skipDigital = true, dpi = 300, onProgress = null, returnToEdit = false } = {}) {
        const doc = this.getDoc ? this.getDoc() : null;
        const curPage = doc && doc.pages && doc.pages[doc.currentIndex];
        const src = curPage && doc.sources && doc.sources[curPage.sourceId];
        if (!src || !src.buffer) {
            this.showToast?.('⚠️ Abre un PDF primero');
            return { ok: false, error: 'NO_PDF_LOADED' };
        }

        const report = (pct, msg) => {
            try {
                const loaderMsg = typeof document !== 'undefined' ? document.getElementById('loader-msg') : null;
                if (loaderMsg && msg) loaderMsg.innerText = msg;
                if (typeof onProgress === 'function') onProgress(pct, msg);
            } catch (_) {}
        };

        const targetIndices = [];
        if (scope === 'current') {
            targetIndices.push(curPage.pageIndex);
        } else {
            const seen = new Set();
            for (const p of (doc.pages || [])) {
                if (p.sourceId === curPage.sourceId && !seen.has(p.pageIndex)) {
                    seen.add(p.pageIndex);
                    targetIndices.push(p.pageIndex);
                }
            }
        }
        if (targetIndices.length === 0) targetIndices.push(curPage.pageIndex || 0);

        const sourceAtStart = src.buffer;
        const beforeBuffer = sourceAtStart.slice(0);
        let outBuffer = null;
        let usedEngine = 'tesseract-offline';
        let stats = { processed_pages: [], skipped_pages: [], words_inserted: 0 };

        this.toggleLoader?.(true, 'Preparando reconocimiento de texto...');
        try {
            // 1. Camino primario: Windows OCR nativo vía _proxy.py
            const proto = (typeof window !== 'undefined' && window.location && window.location.protocol) || '';
            if (proto !== 'file:' && typeof fetch === 'function') {
                report(15, `Analizando ${targetIndices.length} página(s)...`);
                try {
                    const resp = await fetch('/api/pdf/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pdfBase64: this._arrayBufferToBase64(beforeBuffer),
                            pageIndices: targetIndices,
                            lang,
                            dpi,
                            skipDigital: !!skipDigital,
                        }),
                    });
                    if (resp && resp.status === 422) {
                        const payload = await resp.json().catch(() => ({}));
                        if (payload.error === 'PDF_HAS_SIGNATURE') {
                            this.toggleLoader?.(false);
                            this.showToast?.('⚠️ No se puede aplicar OCR: el PDF contiene una firma digital que se invalidaría.');
                            return { ok: false, error: 'PDF_HAS_SIGNATURE' };
                        }
                        if (payload.error === 'PDF_IS_ENCRYPTED') {
                            this.toggleLoader?.(false);
                            this.showToast?.('⚠️ No se puede aplicar OCR: el PDF está protegido con contraseña.');
                            return { ok: false, error: 'PDF_IS_ENCRYPTED' };
                        }
                    }
                    if (resp && resp.ok) {
                        const payload = await resp.json();
                        if (payload && payload.ok && payload.pdfBase64) {
                            outBuffer = this._base64ToArrayBuffer(payload.pdfBase64);
                            stats = payload.stats || stats;
                            usedEngine = (stats.engine || 'windows-ocr');
                        }
                    }
                } catch (_) {
                    // Fallback transparente a Tesseract.js offline
                }
            }

            // 2. Fallback automático: Tesseract.js offline (libs/ocr-offline) + PyMuPDF
            if (!outBuffer) {
                const tessLang = this._mapTessLang(lang);
                const pm = (typeof window !== 'undefined' && window.PythonManager) || (typeof PythonManager !== 'undefined' ? PythonManager : null);
                const pagesToOcr = [];
                const skippedPages = [];

                report(10, 'Revisando páginas...');
                for (const pIdx of targetIndices) {
                    let isDigital = false;
                    if (skipDigital && pm && typeof pm.extractPageText === 'function') {
                        try {
                            const txt = await pm.extractPageText(beforeBuffer, pIdx);
                            const words = (txt || '').split(/\s+/).filter(w => w.length >= 3);
                            isDigital = words.length >= 3;
                        } catch (_) {}
                    }
                    if (isDigital) skippedPages.push(pIdx);
                    else pagesToOcr.push(pIdx);
                }

                if (pagesToOcr.length === 0) {
                    stats = { engine: 'tesseract-offline', skipped_pages: skippedPages, processed_pages: [], words_inserted: 0 };
                    outBuffer = beforeBuffer;
                } else {
                    const worker = await this._getOCRWorkerForLang(tessLang, 3);
                    const scale = 3.0;
                    const ocrWords = [];
                    for (let idx = 0; idx < pagesToOcr.length; idx++) {
                        const pIdx = pagesToOcr[idx];
                        const pctBase = 20 + Math.round((idx / pagesToOcr.length) * 60);
                        report(pctBase, `Reconociendo texto en página ${pIdx + 1} (${idx + 1}/${pagesToOcr.length})...`);
                        const matchingPage = doc.pages.find(p => p.sourceId === curPage.sourceId && p.pageIndex === pIdx) || {
                            sourceId: curPage.sourceId,
                            pageIndex: pIdx,
                            rotation: 0,
                        };
                        const cvs = await this.renderPageToCanvas(matchingPage, scale);
                        const imageData = cvs.toDataURL('image/png');
                        const ret = await worker.recognize(imageData);
                        const words = (ret && ret.data && ret.data.words) || [];
                        for (const w of words) {
                            const text = (w.text || '').trim();
                            if (!text || !w.bbox) continue;
                            ocrWords.push({
                                text,
                                bbox: [w.bbox.x0 / scale, w.bbox.y0 / scale, w.bbox.x1 / scale, w.bbox.y1 / scale],
                                page: pIdx,
                                fontsize: Math.max(4, ((w.bbox.y1 - w.bbox.y0) / scale) * 0.85),
                            });
                        }
                    }

                    stats = {
                        engine: 'tesseract-offline',
                        lang_used: tessLang,
                        skipped_pages: skippedPages,
                        processed_pages: pagesToOcr,
                        words_inserted: ocrWords.length,
                    };

                    if (ocrWords.length > 0) {
                        if (!pm || typeof pm.createSearchablePDF !== 'function') {
                            throw new Error('PythonManager.createSearchablePDF no disponible');
                        }
                        report(88, 'Incorporando texto reconocido al PDF...');
                        outBuffer = await pm.createSearchablePDF(beforeBuffer, ocrWords);
                    } else {
                        outBuffer = beforeBuffer;
                    }
                }
            }

            const wordsInserted = Number(stats.words_inserted || 0);
            const skippedCount = (stats.skipped_pages || []).length;
            if (wordsInserted === 0) {
                if (skippedCount > 0) {
                    this.showToast?.('ℹ️ Las páginas seleccionadas ya contienen texto');
                } else {
                    this.showToast?.('⚠️ No se detectó texto para insertar');
                }
                return { ok: true, modified: false, engine: usedEngine, stats };
            }

            // 3. Validar con PDF.js antes de publicar y reutilizar el pdfDoc cargado
            report(93, 'Verificando PDF resultante...');
            let validatedDoc = null;
            let loadingTask = null;
            if (typeof pdfjsLib !== 'undefined' && typeof pdfjsLib.getDocument === 'function') {
                loadingTask = pdfjsLib.getDocument({
                    data: outBuffer.slice(0),
                    password: src.password,
                    stopAtErrors: true,
                    isEvalSupported: false,
                });
                try {
                    validatedDoc = await loadingTask.promise;
                    report(95, 'Verificando página...');
                    const checkIdx = (stats.processed_pages && stats.processed_pages[0] !== undefined)
                        ? stats.processed_pages[0]
                        : curPage.pageIndex;
                    const checkedPage = await validatedDoc.getPage(checkIdx + 1);
                    report(96, 'Verificando contenido de la página...');
                    await checkedPage.getOperatorList();
                    report(97, 'Verificando texto reconocido...');
                    await checkedPage.getTextContent();
                } catch (verifyErr) {
                    try { await loadingTask.destroy(); } catch (_) {}
                    throw verifyErr;
                }
            }

            if (src.buffer !== sourceAtStart || doc.sources[curPage.sourceId] !== src) {
                if (loadingTask) try { await loadingTask.destroy(); } catch (_) {}
                throw new Error('El documento cambió durante el proceso OCR');
            }

            this.releasePdfSource?.(src);
            src.buffer = outBuffer;
            src.doc = validatedDoc || null;
            if (loadingTask) src._pdfLoadingTask = loadingTask;

            (doc.pages || []).filter(p => p.sourceId === curPage.sourceId).forEach(p => {
                this.releasePageThumbnail?.(p);
                delete p._bgBitmap;
            });
            if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
                document.querySelectorAll('.bg-page-canvas').forEach(canvas => {
                    const wrapper = canvas.closest?.('.page-wrapper');
                    const ownerPanel = wrapper?.id?.startsWith('page-wrapper-secondary-') ? 'secondary' : 'primary';
                    const ownerDocId = this.splitView?.[ownerPanel]?.docId || this.activeDocId;
                    const ownerDoc = this.docs?.find?.(d => d.id === ownerDocId) || doc;
                    const targetPage = ownerDoc?.pages?.[Number(wrapper?.dataset?.index)];
                    if (ownerDoc !== doc || (targetPage && targetPage.sourceId !== curPage.sourceId)) return;
                    canvas._renderedSessionToken = null;
                    canvas._pendingSessionToken = null;
                    canvas._renderRequestToken = null;
                    try { canvas._activeRenderTask?.cancel(); } catch (_) {}
                    canvas._activeRenderTask = null;
                    canvas._renderPromise = null;
                    canvas._pdfPage = null;
                    canvas._pdfViewport = null;
                });
            }

            this.saveState?.();
            if (!doc._historyBuffers) doc._historyBuffers = {};
            doc._historyBuffers[doc.historyIndex] = {
                sourceId: curPage.sourceId,
                beforeBuffer: beforeBuffer,
                afterBuffer: outBuffer.slice(0),
                buffer: beforeBuffer,
            };
            this.trimDocumentHistory?.(doc);

            report(98, 'Actualizando vista del documento...');
            await this.loadPage?.(doc.currentIndex);
            report(99, 'Actualizando miniaturas...');
            this.renderSidebar?.();
            this.updateUndoRedoUI?.();

            const engineLabel = usedEngine === 'windows-ocr' ? 'Windows OCR' : 'Tesseract offline';
            const procCount = (stats.processed_pages || []).length || 1;
            this.showToast?.(`✅ OCR aplicado (${procCount} pág., ${wordsInserted} palabras · ${engineLabel})`, 5000);
            if (returnToEdit) {
                this.activateRealTextEditor?.();
            }
            return { ok: true, modified: true, engine: usedEngine, stats };
        } finally {
            this.toggleLoader?.(false);
        }
    },
});
