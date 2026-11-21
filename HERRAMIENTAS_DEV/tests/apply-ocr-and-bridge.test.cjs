const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Aplicar OCR está en OTROS → TRANSFORMAR (#toolbar-magic) y NO en INICIO (#toolbar-home)', () => {
    const html = read('BASE.html');
    const homeSlice = html.slice(
        html.indexOf('id="toolbar-home"'),
        html.indexOf('id="toolbar-image"')
    );
    const magicSlice = html.slice(
        html.indexOf('id="toolbar-magic"'),
        html.indexOf('id="toolbar-ai"')
    );

    assert.ok(!homeSlice.includes('btn-apply-ocr'), 'Aplicar OCR NO debe estar en la pestaña INICIO');
    assert.ok(!homeSlice.includes('openApplyOcrModal'), 'openApplyOcrModal NO debe invocarse desde INICIO');
    assert.ok(magicSlice.includes('id="btn-apply-ocr"'), 'btn-apply-ocr debe estar dentro de #toolbar-magic');
    assert.ok(magicSlice.includes('app.openApplyOcrModal()'), 'btn-apply-ocr debe abrir el modal Aplicar OCR');
    assert.ok(magicSlice.includes('Aplicar<br>OCR'), 'El botón debe decir Aplicar OCR');
    assert.ok(html.includes('id="apply-ocr-modal"'), 'BASE.html debe declarar #apply-ocr-modal');
    assert.ok(!html.includes('PDF Buscable'), 'No debe quedar la etiqueta antigua PDF Buscable en BASE.html');

    const i18n = read('js/i18n.js');
    assert.ok(i18n.includes('"dyn_t_1008": "Aplicar<br>OCR"'), 'i18n ES debe usar Aplicar OCR');
    assert.ok(i18n.includes('"dyn_t_1008": "Apply<br>OCR"'), 'i18n EN debe usar Apply OCR');
    assert.ok(!i18n.includes('PDF Buscable'), 'No debe quedar PDF Buscable en i18n.js');

    const ui = read('js/app.ui.js');
    assert.ok(ui.includes("'#apply-ocr-modal'"), 'closeAllModals debe registrar #apply-ocr-modal');
    assert.ok(ui.includes("id: 'tool_apply_ocr'"), 'La paleta de comandos debe incluir tool_apply_ocr');
});

test('app.ocr.js realiza fallback automático 503 → libs/ocr-offline + createSearchablePDF y conserva undo', async () => {
    const beforeBuf = new Uint8Array([37, 80, 68, 70, 49]).buffer;
    const afterBuf = new Uint8Array([37, 80, 68, 70, 50, 99]).buffer;
    const src = { buffer: beforeBuf, password: null };
    const page = { sourceId: 's1', pageIndex: 0, rotation: 0, objects: [] };
    const doc = { sources: { s1: src }, currentIndex: 0, historyIndex: 1, pages: [page] };
    let released = false;
    let saved = false;
    let createCalledWith = null;
    let loadedPage = null;
    let reactivatedEditor = false;

    const app = {
        getDoc: () => doc,
        releasePdfSource() { released = true; },
        saveState() { saved = true; },
        trimDocumentHistory() {},
        async loadPage(idx) { loadedPage = idx; },
        renderSidebar() {},
        updateUndoRedoUI() {},
        activateRealTextEditor() { reactivatedEditor = true; },
        toggleLoader() {},
        showToast() {},
        async renderPageToCanvas() {
            return { toDataURL: () => 'data:image/png;base64,AA==' };
        }
    };

    const checkedDoc = {
        async getPage(n) {
            assert.equal(n, 1);
            return {
                async getOperatorList() {},
                async getTextContent() { return { items: [{ str: 'PruebaOCR' }] }; }
            };
        }
    };
    const loadingTask = { promise: Promise.resolve(checkedDoc), async destroy() {} };

    const context = {
        window: { app, location: { protocol: 'http:' } },
        Tesseract: {
            async createWorker(lang, oem, opts) {
                assert.equal(lang, 'spa');
                assert.equal(opts.corePath, 'libs/ocr-offline');
                assert.equal(opts.langPath, 'libs/ocr-offline');
                return {
                    async setParameters() {},
                    async recognize() {
                        return { data: { words: [{ text: 'PruebaOCR', bbox: { x0: 30, y0: 60, x1: 180, y1: 90 } }] } };
                    }
                };
            }
        },
        PythonManager: {
            async extractPageText() { return ''; },
            async createSearchablePDF(buf, words) {
                createCalledWith = { buf, words };
                return afterBuf;
            }
        },
        pdfjsLib: {
            getDocument(opts) {
                assert.equal(opts.stopAtErrors, true);
                return loadingTask;
            }
        },
        fetch: async (url) => {
            if (String(url).includes('/api/pdf/ocr')) {
                return { ok: false, status: 503, async json() { return { ok: false, error: 'WINDOWS_OCR_UNAVAILABLE' }; } };
            }
            return { ok: false, status: 404 };
        },
        btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
        atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
        setTimeout, clearTimeout, Uint8Array, ArrayBuffer, console
    };
    context.window.PythonManager = context.PythonManager;

    vm.runInNewContext(read('js/app.ocr.js'), context);

    const res = await app.applyOcrToDocument({ scope: 'current', lang: 'es', skipDigital: true, returnToEdit: true });
    assert.equal(res.ok, true);
    assert.equal(res.modified, true);
    assert.equal(res.engine, 'tesseract-offline');
    assert.ok(reactivatedEditor, 'returnToEdit: true debe reactivar activateRealTextEditor tras aplicar OCR');
    assert.ok(createCalledWith, 'Debe invocar PythonManager.createSearchablePDF en fallback');
    assert.equal(createCalledWith.words.length, 1);
    assert.equal(createCalledWith.words[0].text, 'PruebaOCR');
    assert.ok(released);
    assert.ok(saved);
    assert.equal(loadedPage, 0);
    assert.equal(src.buffer, afterBuf);
    assert.equal(src.doc, checkedDoc);
    assert.equal(src._pdfLoadingTask, loadingTask);
    assert.ok(doc._historyBuffers[1] && doc._historyBuffers[1].beforeBuffer);
});

test('Fase 3 aislamiento estricto y reutilización de checkedDoc en _applyRealTextInlineCommitNow', async () => {
    function buildHarness(isOcrHidden, { failValidation = false } = {}) {
        const original = new Uint8Array([1, 2, 3, 4]).buffer;
        const intermediate = new Uint8Array([5, 6]).buffer;
        const ocrOut = new Uint8Array([7, 7, 7]).buffer;
        const reflowOut = new Uint8Array([9, 9, 9]).buffer;
        const src = { buffer: original, doc: { stale: true }, _pdfLoadingTask: null };
        const overlay = { id: 'edit1', isRealEdit: true, bgAlpha: isOcrHidden ? 1 : 0, x: 20, y: 30, width: 80, height: 14 };
        const page = { sourceId: 'base', pageIndex: 0, objects: [overlay] };
        const doc = { sources: { base: src }, currentIndex: 0, historyIndex: 0, pages: [page] };

        const calls = { removeTextSpans: 0, eraseTextRegion: 0, applyReflowEdit: 0, applyOcrTextEdit: 0, disposed: false, saved: false };
        const checkedDoc = {
            verified: true,
            async getPage(n) {
                assert.equal(n, 1);
                return {
                    async getOperatorList() {
                        if (failValidation) throw new Error('Corrupt stream');
                    },
                    async getTextContent() { return { items: [] }; }
                };
            }
        };
        const loadingTask = {
            promise: Promise.resolve(checkedDoc),
            async destroy() { calls.disposed = true; }
        };

        const app = {
            getDoc: () => doc,
            currentScale: 1,
            _preEraseBuffer: { sourceId: 'base', pageIndex: 0, buffer: original },
            _pendingEraseRect: { x: 20, y: 30, w: 80, h: 14, bg: '#ffffff' },
            splitView: { activePanel: 0 },
            getPanelElements: () => null,
            releasePdfSource(s) { s.doc = null; delete s._pdfLoadingTask; },
            saveState() { calls.saved = true; doc.historyIndex += 1; },
            trimDocumentHistory() {},
            async loadPage() {},
            refreshThumbnail() {},
            _restoreContinuousIfNeeded() {},
            updateUndoRedoUI() {},
            toggleLoader() {},
            renderOverlays() {},
            showToast() {}
        };

        const context = {
            window: { app },
            document: { getElementById: () => null, body: { classList: { contains: () => false } } },
            PythonManager: {
                async removeTextSpans() { calls.removeTextSpans += 1; return intermediate; },
                async eraseTextRegion() { calls.eraseTextRegion += 1; return intermediate; },
                async applyReflowEdit() { calls.applyReflowEdit += 1; return { buffer: reflowOut, overflow: false, expandedH: 14, originalH: 14 }; },
                async applyOcrTextEdit() { calls.applyOcrTextEdit += 1; return { buffer: ocrOut, overflow: false, expandedH: 14, originalH: 14 }; }
            },
            pdfjsLib: {
                getDocument(opts) {
                    assert.equal(opts.stopAtErrors, true);
                    return loadingTask;
                }
            },
            console, Uint8Array, ArrayBuffer, Math, JSON
        };

        vm.runInNewContext(read('js/app.pdf_ops.js'), context);
        const data = { x: 20, y: 30, width: 80, height: 14, fontSize: 12, targetSpans: [{ text: 'OLD' }], isOcrHidden };
        return { app, overlay, data, src, original, ocrOut, reflowOut, calls, checkedDoc, loadingTask };
    }

    // 1. Camino OCR aislado: solo applyOcrTextEdit, jamás removeTextSpans ni applyReflowEdit; reutiliza checkedDoc
    const ocrCase = buildHarness(true);
    await ocrCase.app._applyRealTextInlineCommitNow(ocrCase.overlay, ocrCase.data, 'NuevoOCR', []);
    assert.equal(ocrCase.calls.applyOcrTextEdit, 1);
    assert.equal(ocrCase.calls.removeTextSpans, 0);
    assert.equal(ocrCase.calls.eraseTextRegion, 0);
    assert.equal(ocrCase.calls.applyReflowEdit, 0);
    assert.equal(ocrCase.calls.saved, true);
    assert.equal(ocrCase.calls.disposed, false, 'En éxito debe reutilizar loadingTask sin destruirlo antes de loadPage');
    assert.equal(ocrCase.src.buffer, ocrCase.ocrOut);
    assert.equal(ocrCase.src.doc, ocrCase.checkedDoc);
    assert.equal(ocrCase.src._pdfLoadingTask, ocrCase.loadingTask);

    // 2. Camino nativo 3.2.50: jamás toca applyOcrTextEdit; usa removeTextSpans + applyReflowEdit y reutiliza doc validado
    const natCase = buildHarness(false);
    await natCase.app._applyRealTextInlineCommitNow(natCase.overlay, natCase.data, 'NuevoNativo', []);
    assert.equal(natCase.calls.removeTextSpans, 1);
    assert.equal(natCase.calls.applyReflowEdit, 1);
    assert.equal(natCase.calls.applyOcrTextEdit, 0);
    assert.equal(natCase.calls.disposed, false);
    assert.equal(natCase.src.buffer, natCase.reflowOut);
    assert.equal(natCase.src.doc, natCase.checkedDoc);
    assert.equal(natCase.src._pdfLoadingTask, natCase.loadingTask);

    // 3. Si falla validación de PDF.js, loadingTask.destroy() SÍ se ejecuta y src.buffer queda intacto
    const failCase = buildHarness(false, { failValidation: true });
    await failCase.app._applyRealTextInlineCommitNow(failCase.overlay, failCase.data, 'Roto', []);
    assert.equal(failCase.calls.disposed, true);
    assert.equal(failCase.calls.saved, false);
    assert.equal(failCase.src.buffer, failCase.original);
});

test('app.tools.js ofrece banner no bloqueante con 1 clic para Aplicar OCR en páginas sin texto', () => {
    const tools = read('js/app.tools.js');
    assert.ok(tools.includes("this.showToast('⚠️ No se encontró texto en esta página')"));
    assert.ok(tools.includes('this._showNoTextOcrBanner?.(doc, page)'));
    assert.ok(tools.includes('this.smartPatchData.isOcrHidden = Boolean(bestPy.is_ocr_hidden || bestPy.alpha === 0)'));
    assert.ok(tools.includes('if (window.PythonManager && !data.isOcrHidden)'));

    const createdButtons = [];
    const appended = [];
    const fakeDocument = {
        getElementById: () => null,
        addEventListener: () => {},
        body: { appendChild: (el) => appended.push(el) },
        createElement: (tag) => {
            const el = {
                tagName: tag.toUpperCase(),
                children: [],
                style: {},
                listeners: {},
                setAttribute() {},
                appendChild(c) { this.children.push(c); },
                addEventListener(ev, fn) { this.listeners[ev] = fn; },
                remove() { el._removed = true; }
            };
            if (tag === 'button') createdButtons.push(el);
            return el;
        }
    };
    const ctx = {
        window: { app: {} },
        document: fakeDocument,
        setTimeout: () => 0,
        console,
        Object
    };
    vm.runInNewContext(tools, ctx);
    let quickApplied = null;
    let openedModal = null;
    ctx.window.app.applyOcrToDocument = (opts) => { quickApplied = opts; };
    ctx.window.app.openApplyOcrModal = (opts) => { openedModal = opts; };

    ctx.window.app._showNoTextOcrBanner();
    assert.equal(appended.length, 1);
    const applyBtn = createdButtons.find(b => b.textContent === 'Aplicar OCR a esta página');
    const optsBtn = createdButtons.find(b => b.textContent === 'Opciones OCR');
    assert.ok(applyBtn && optsBtn, 'Debe renderizar botones Aplicar OCR a esta página y Opciones OCR');

    applyBtn.listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(quickApplied)), { scope: 'current', returnToEdit: true });
    optsBtn.listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(openedModal)), { defaultScope: 'current', returnToEdit: true });
});
