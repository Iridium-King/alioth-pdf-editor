// app.ai.js
// Extiende el objeto global `app` con métodos de ai
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            _tesseractWorker: null,
            _tesseractWorkerLoading: false,
            _tesseractWorkerPsm: null,

            // View & Navigation State
            _getOCRWorker: async function (psmMode) {
                if (typeof Tesseract === 'undefined') {
                    if (this.lazyLoad) await this.lazyLoad('tesseract');
                    else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('tesseract');
                }
                const autoPsm = (typeof Tesseract !== 'undefined' && Tesseract.PSM) ? Tesseract.PSM.AUTO : 3;
                const targetPsm = (psmMode !== undefined && psmMode !== null) ? psmMode : autoPsm;
                if (this._tesseractWorker && this._tesseractWorkerPsm === targetPsm) return this._tesseractWorker;
                if (this._tesseractWorkerLoading) {
                    await new Promise(resolve => {
                        const interval = setInterval(() => {
                            if (!this._tesseractWorkerLoading) { clearInterval(interval); resolve(); }
                        }, 100);
                    });
                    return this._tesseractWorker;
                }
                this._tesseractWorkerLoading = true;
                // Terminar worker anterior si cambió el PSM
                if (this._tesseractWorker && this._tesseractWorkerPsm !== targetPsm) {
                    try { await this._tesseractWorker.terminate(); } catch (_) { }
                    this._tesseractWorker = null;
                }
                this._tesseractWorker = await Tesseract.createWorker('spa', 1, {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const progress = Math.round(m.progress * 100);
                            const loaderMsg = document.getElementById('loader-msg');
                            if (loaderMsg) loaderMsg.innerText = `OCR: ${progress}% completado...`;
                        }
                    }
                });
                await this._tesseractWorker.setParameters({
                    tessedit_pageseg_mode: targetPsm,
                    preserve_interword_spaces: '1',
                });
                this._tesseractWorkerPsm = targetPsm;
                this._tesseractWorkerLoading = false;
                return this._tesseractWorker;
            },

            extractText: async function () {
                const cvs = document.getElementById('the-canvas');
                if (!cvs || cvs.width === 0) { alert("No hay página cargada."); return; }
                this.toggleLoader(true);
                const originalMsg = document.getElementById('loader-msg').innerText;
                try {
                    // Extraer primero el texto digital antes de recurrir a OCR.
                    const doc = this.getDoc();
                    const page = doc && doc.pages[doc.currentIndex];
                    const src = page && doc.sources[page.sourceId];

                    if (src && src.buffer && window.PythonManager?.extractPageText) {
                        document.getElementById('loader-msg').innerText = "Extrayendo texto nativo del PDF...";
                        try {
                            const nativeText = await PythonManager.extractPageText(src.buffer, page.pageIndex);

                            // Detección robusta: PDF digital vs escaneado.
                            // Un PDF escaneado puede tener texto residual (headers, nº página) pero pocas palabras reales.
                            // Criterio: al menos 3 palabras de ≥3 chars → es digital.
                            const words = (nativeText || '').split(/\s+/).filter(w => w.length >= 3);
                            const isDigital = words.length >= 3;
                            console.log(`📄 Detección PDF: ${words.length} palabras (${nativeText?.length || 0} chars) → ${isDigital ? 'DIGITAL' : 'ESCANEADO'}`);

                            if (isDigital) {
                                this.toggleLoader(false);
                                document.getElementById('ocr-text-area').value = nativeText;
                                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                                document.getElementById('ocr-result-modal').style.display = 'block';
                                document.getElementById('qr-result-modal').style.display = 'none';
                                document.getElementById('drop-modal-content').style.display = 'none';
                                document.getElementById('page-num-modal').style.display = 'none';
                                document.getElementById('loader-msg').innerText = originalMsg;
                                return; // PDF digital — no necesitamos Tesseract
                            }
                            // PDF escaneado — continuar a Tesseract
                            console.log('🔍 PDF escaneado detectado — usando Tesseract OCR');
                        } catch (pyEx) {
                            console.warn("⚠️ Extracción nativa falló, usando Tesseract:", pyEx);
                        }
                    }

                    // ── PASO 2: Fallback a Tesseract (PDF escaneado o imagen) ──
                    document.getElementById('loader-msg').innerText = "OCR: Preparando imagen...";

                    // Escalar 3x para mayor precisión en documentos escaneados
                    const tempCanvas = document.createElement('canvas');
                    const scale = 3.0;
                    tempCanvas.width = cvs.width * scale;
                    tempCanvas.height = cvs.height * scale;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.scale(scale, scale);
                    tempCtx.drawImage(cvs, 0, 0);
                    let imageData = tempCanvas.toDataURL('image/png');

                    // ── Pre-procesamiento PIL para mejorar accuracy de Tesseract ──
                    if (window.PythonManager && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "OCR: Optimizando imagen con Python...";
                            imageData = await PythonManager.preprocessForOCR(imageData);
                        } catch (preprocEx) {
                            console.warn("⚠️ Pre-procesamiento OCR falló, usando original:", preprocEx);
                        }
                    }

                    // ── PSM dinámico: detectar si la página tiene una o varias columnas ──
                    // Una sola columna de texto → PSM.SINGLE_BLOCK es más rápido y preciso
                    let psmMode = (typeof Tesseract !== 'undefined' && Tesseract.PSM) ? Tesseract.PSM.AUTO : 3;
                    try {
                        const aspectRatio = cvs.width / cvs.height;
                        if (aspectRatio > 0.5 && aspectRatio < 0.9) {
                            // Página vertical estándar — intentar detectar columnas
                            // Si el ancho de texto vs ancho de página es > 70%, probablemente es una columna
                            psmMode = (typeof Tesseract !== 'undefined' && Tesseract.PSM) ? Tesseract.PSM.SINGLE_BLOCK : 6;
                        }
                    } catch (_) { }

                    const worker = await this._getOCRWorker(psmMode);
                    document.getElementById('loader-msg').innerText = "OCR: Reconociendo texto...";
                    const ret = await worker.recognize(imageData);

                    // ── Marcar palabras de baja confianza en el texto resultado ──
                    let ocrText = ret.data.text;
                    const avgConf = ret.data.confidence || 0;
                    const lowConfWords = (ret.data.words || [])
                        .filter(w => w.confidence < 55 && w.text && w.text.trim().length > 0)
                        .map(w => w.text.trim());

                    if (lowConfWords.length > 0) {
                        // Añadir nota al final indicando palabras dudosas
                        ocrText += `\n\n⚠️ Palabras de baja confianza (revisar): ${lowConfWords.slice(0, 15).join(', ')}`;
                    }

                    this.toggleLoader(false);
                    document.getElementById('ocr-text-area').value = ocrText;
                    // Mostrar confianza general en el título
                    const ocrTitle = document.querySelector('#ocr-result-modal h3');
                    if (ocrTitle) ocrTitle.textContent = `Texto Detectado (OCR · ${Math.round(avgConf)}% confianza)`;
                    (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                    document.getElementById('ocr-result-modal').style.display = 'block';
                    document.getElementById('qr-result-modal').style.display = 'none';
                    document.getElementById('drop-modal-content').style.display = 'none';
                    document.getElementById('page-num-modal').style.display = 'none';
                } catch (e) {
                    this.toggleLoader(false);
                    alert("Error en OCR: " + e.message);
                }
                document.getElementById('loader-msg').innerText = originalMsg;
            },

            copyOCRText: function () {
                const txt = document.getElementById('ocr-text-area'); txt.select();
                document.execCommand("copy"); this.showToast("Texto copiado"); this.closeAllModals();
            },

            // ============================================================
            // PYTHON TOOLS: TABLAS, IMÁGENES, METADATOS
            // ============================================================

            /** 
             * Detecta tablas en la página actual o área seleccionada.
             * @param {Array|null} clip [x0, y0, x1, y1] en puntos PDF
             * @param {string} strategy "lattice" (basada en líneas) o "stream" (basada en espacios)
             */
            detectAndShowTables: async function (clip = null, strategy = "lattice") {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando...'); PythonManager.init(); return; }

                this.toggleLoader(true, `Analizando tablas (${strategy === 'lattice' ? 'Lattice' : 'Stream'})...`);
                try {
                    const tables = await PythonManager.detectTables(src.buffer, page.pageIndex, clip, strategy);
                    this.toggleLoader(false);

                    const container = document.getElementById('tables-modal-content');
                    const exportBtn = document.getElementById('tables-export-btn');

                    if (!tables || tables.length === 0) {
                        container.innerHTML = `
                            <div style="text-align:center; padding:30px; color:#888;">
                                <p>No se detectaron tablas en ${clip ? 'el área seleccionada' : 'esta página'}.</p>
                                <p style="font-size:10px;">Prueba cambiando de estrategia o seleccionando el área manualmente.</p>
                                <div style="margin-top:10px;">
                                    <button onclick="app.detectAndShowTables(${JSON.stringify(clip)}, 'stream')" 
                                            style="padding:5px 10px; background:var(--accent); color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">
                                        Reintentar con modo "Stream"
                                    </button>
                                </div>
                            </div>`;
                        exportBtn.style.display = 'none';
                    } else {
                        this._detectedTables = tables;
                        exportBtn.style.display = 'inline-block';
                        container.innerHTML = tables.map((t, i) => {
                            const rows = t.data || [];
                            const fillPct = t.fillRatio !== undefined ? Math.round(t.fillRatio * 100) : null;
                            const fillBadge = fillPct !== null
                                ? `<span style="font-size:9px; padding:1px 6px; border-radius:8px; background:${fillPct > 70 ? '#d1fae5' : fillPct > 40 ? '#fef3c7' : '#fee2e2'}; color:${fillPct > 70 ? '#065f46' : fillPct > 40 ? '#92400e' : '#991b1b'};">${fillPct}% llena</span>`
                                : '';

                            if (rows.length === 0) return `<p style="color:#888;">Tabla ${i + 1}: sin datos extraíbles</p>`;

                            const header = rows[0];
                            const body = rows.slice(1);

                            const highlightBtn = t.bbox
                                ? `<button onclick="app.highlightTableOnPage(${JSON.stringify(t.bbox)}, ${t.pageH || 0})"
                                       style="font-size:10px; padding:2px 8px; border:1px solid var(--accent); border-radius:10px; color:var(--accent); background:transparent; cursor:pointer; margin-left:8px;">
                                       📍 Resaltar
                                   </button>`
                                : '';

                            // 🆕 Botón para importar a Alioth Table
                            const importBtn = `<button onclick="app.importDetectedTableToAlioth(${i})"
                                                style="font-size:10px; padding:2px 8px; border:1px solid #10b981; border-radius:10px; color:#10b981; background:transparent; cursor:pointer; margin-left:4px;">
                                                📝 Importar a Editor
                                              </button>`;

                            return `
                                <div style="margin-bottom:16px; border:1px solid var(--border); border-radius:8px; padding:10px; background: rgba(0,0,0,0.1);">
                                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                                        <span style="font-weight:600; font-size:12px;">Tabla ${i + 1} (${t.rows}×${t.cols})</span>
                                        ${fillBadge}
                                        ${highlightBtn}
                                        ${importBtn}
                                    </div>
                                    <div style="overflow-x:auto; max-height:200px;">
                                    <table style="border-collapse:collapse; width:100%; font-size:10px;">
                                        <thead><tr>${header.map(h => `<th style="border:1px solid var(--border); padding:4px 8px; background:rgba(255,255,255,0.05); text-align:left;">${h || ''}</th>`).join('')}</tr></thead>
                                        <tbody>${body.map(row => `<tr>${row.map(cell => `<td style="border:1px solid var(--border); padding:3px 8px; color:rgba(255,255,255,0.8);">${cell || ''}</td>`).join('')}</tr>`).join('')}</tbody>
                                    </table>
                                    </div>
                                </div>`;
                        }).join('');
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
                    document.getElementById('tables-modal').style.display = 'block';
                } catch (e) {
                    this.toggleLoader(false);
                    this.showToast('❌ Error detectando tablas: ' + e.message);
                }
            },

            /** Inicia captura de área para detectar tabla específica */
            detectTableInSelection: function () {
                this.showToast('🖱️ Arrastra para seleccionar el área de la tabla...');
                this.startCaptureSelection((rect) => {
                    // Convertir rect de canvas a puntos PDF
                    const scale = this.currentScale;
                    const pdfRect = [
                        rect.x / scale,
                        rect.y / scale,
                        (rect.x + rect.w) / scale,
                        (rect.y + rect.h) / scale
                    ];
                    this.detectAndShowTables(pdfRect, "lattice");
                });
            },

            /** Importa una tabla detectada como un objeto "table" nativo de Alioth */
            importDetectedTableToAlioth: function (index) {
                const table = this._detectedTables && this._detectedTables[index];
                if (!table) return;

                this.closeAllModals();
                this.saveState();

                const doc = this.getDoc();
                if (!doc) return;

                // Dimensiones basadas en el bbox detectado
                const bbox = table.bbox;
                const w = bbox[2] - bbox[0];
                const h = bbox[3] - bbox[1];
                const rows = table.rows;
                const cols = table.cols;

                // Crear los anchos de columna basados en la primera fila de celdas si es posible
                let colWidths = Array(cols).fill(w / cols);
                if (table.cellBboxes && table.cellBboxes[0]) {
                    colWidths = table.cellBboxes[0].map(cell => cell ? cell[2] - cell[0] : w / cols);
                }

                // Crear las alturas de fila
                let rowHeights = Array(rows).fill(h / rows);
                if (table.cellBboxes) {
                    rowHeights = table.cellBboxes.map(row => {
                        const firstCell = row.find(c => c !== null);
                        return firstCell ? firstCell[3] - firstCell[1] : h / rows;
                    });
                }

                const tableObj = {
                    id: 'table_' + Date.now(),
                    type: 'table',
                    x: bbox[0],
                    y: bbox[1],
                    width: w,
                    height: h,
                    rows: rows,
                    cols: cols,
                    rowHeights: rowHeights,
                    colWidths: colWidths,
                    data: table.data,
                    cellStyles: Array(rows).fill(0).map(() => Array(cols).fill(null)),
                    rotation: 0,
                    borderColor: '#000000',
                    borderWidth: 1,
                    backgroundColor: 'transparent',
                    fontFamily: 'Arial',
                    fontSize: 10,
                    textColor: '#000000',
                    align: 'left',
                    textAlign: 'left'
                };

                doc.pages[doc.currentIndex].objects.push(tableObj);
                this.selectedObj = tableObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(tableObj.id);

                this.renderOverlays();
                this.renderSidebar();

                this.showToast('✨ Tabla importada al editor');
            },

            /** Abre el modal de selección de formato de exportación */
            showExportTableModal: function () {
                const tables = this._detectedTables;
                if (!tables || tables.length === 0) { this.showToast('⚠️ No hay tablas detectadas'); return; }
                this.closeAllModals();
                const overlay = document.getElementById('modal-overlay');
                overlay.style.display = 'flex';
                document.getElementById('export-table-modal').style.display = 'block';
            },

            /** Exporta las tablas detectadas como CSV */
            exportTablesCSV: function () {
                const tables = this._detectedTables;
                if (!tables || tables.length === 0) return;
                let csvContent = '';
                tables.forEach((t, i) => {
                    if (i > 0) csvContent += '\n\n';
                    csvContent += `# Tabla ${i + 1}\n`;
                    (t.data || []).forEach(row => {
                        csvContent += row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',') + '\n';
                    });
                });
                const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'tablas_detectadas.csv';
                a.click();
                this.showToast('📥 CSV exportado');
            },

            /** Exporta las tablas detectadas como XLSX (una hoja por tabla) */
            exportTablesXLSX: function () {
                const tables = this._detectedTables;
                if (!tables || tables.length === 0) { this.showToast('⚠️ No hay tablas detectadas'); return; }
                if (typeof XLSX === 'undefined') { this.showToast('No se pudieron exportar las tablas a Excel.'); return; }

                const wb = XLSX.utils.book_new();
                tables.forEach((t, i) => {
                    const data = t.data || [];
                    if (data.length === 0) return;
                    const ws = XLSX.utils.aoa_to_sheet(data);

                    // Estilo de encabezado: fila 0 en negrita
                    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
                    for (let C = range.s.c; C <= range.e.c; C++) {
                        const addr = XLSX.utils.encode_cell({ r: 0, c: C });
                        if (ws[addr]) {
                            if (!ws[addr].s) ws[addr].s = {};
                            ws[addr].s.font = { bold: true };
                            ws[addr].s.fill = { fgColor: { rgb: 'D6E4F0' } };
                        }
                    }

                    // Auto-ancho de columnas
                    const colWidths = data[0].map((_, ci) =>
                        Math.min(40, Math.max(10, ...data.map(r => ((r[ci] || '').toString().length) + 2)))
                    );
                    ws['!cols'] = colWidths.map(w => ({ wch: w }));

                    XLSX.utils.book_append_sheet(wb, ws, `Tabla ${i + 1}`);
                });

                XLSX.writeFile(wb, 'tablas_detectadas.xlsx');
                this.showToast('📊 XLSX exportado');
            },

            /* ─────────────────────────────────────────────────────────────
               TABLA → FORMULARIO CON IA
               1. Detecta tablas con PyMuPDF (reutiliza PythonManager)
               2. Claude analiza encabezados y clasifica tipo de campo
               3. Genera form-field objects sobre la página
            ───────────────────────────────────────────────────────────── */
            tableToFormAI: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando...'); PythonManager.init(); return; }

                this._ttfTables = [];
                this._ttfAIResults = [];
                this._ttfChatMessages = this._ttfChatMessages || [];
                this._ttfPreviewScale = 1.0;
                this._ttfClipRect = null;
                this._ttfClipCanvasRect = null;

                this.closeAllModals();
                const overlay = document.getElementById('modal-overlay');
                overlay.style.display = 'flex';
                document.getElementById('table-to-form-modal').style.display = 'flex';

                document.getElementById('ttf-status').textContent = 'Selecciona "Página completa" o "Seleccionar área" para comenzar.';
                document.getElementById('ttf-fields-preview').innerHTML = '';
                document.getElementById('ttf-table-selector').style.display = 'none';
                document.getElementById('ttf-options').style.display = 'none';
                document.getElementById('ttf-btn-generate').style.display = 'none';
                document.getElementById('ttf-btn-reanalyze').style.display = 'none';
                document.getElementById('ttf-btn-retry-detect').style.display = 'none';
                document.getElementById('ttf-preview-placeholder').style.display = 'flex';
                document.getElementById('ttf-page-img').style.display = 'none';
                document.getElementById('ttf-overlay-svg').innerHTML = '';
                document.getElementById('ttf-group-options').style.display = 'none';

                this._ttfRenderChatHistory();
            },

            _ttfDetectFullPage: async function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) return;
                this._ttfClipRect = null;
                this._ttfClipCanvasRect = null;
                // Render hi-res preview from PDF source at 2x
                try {
                    const VSCALE = 2.0;
                    const pdfDoc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const pdfPage = await pdfDoc.getPage((page.pageIndex || 0) + 1);
                    const vp = pdfPage.getViewport({ scale: VSCALE });
                    const offscreen = document.createElement('canvas');
                    offscreen.width = vp.width; offscreen.height = vp.height;
                    const ctx = offscreen.getContext('2d', { alpha: false });
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, vp.width, vp.height);
                    await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
                    const imgEl = document.getElementById('ttf-page-img');
                    imgEl.src = offscreen.toDataURL('image/png');
                    imgEl.style.display = 'block';
                    document.getElementById('ttf-preview-placeholder').style.display = 'none';
                    this._ttfPageNativeW = offscreen.width;
                    this._ttfPageNativeH = offscreen.height;
                } catch(e) { console.warn('_ttfDetectFullPage offscreen render error:', e); }
                await this._ttfRunDetection(src, page, null);
            },

            _ttfSelectArea: function () {
                const modal = document.getElementById('table-to-form-modal');
                const overlay = document.getElementById('modal-overlay');
                modal.style.display = 'none';
                overlay.style.display = 'none';
                this.showToast('🖱️ Arrastra para seleccionar el área de la tabla…');
                const self = this;
                this.startCaptureSelection(async (rect) => {
                    modal.style.display = 'flex';
                    overlay.style.display = 'flex';
                    const displayScale = self.currentScale;
                    const pdfRect = [rect.x/displayScale, rect.y/displayScale, (rect.x+rect.w)/displayScale, (rect.y+rect.h)/displayScale];
                    self._ttfClipRect = pdfRect;
                    self._ttfClipCanvasRect = rect;
                    // Render offscreen at 2x from PDF source for high-quality preview
                    const doc2 = self.getDoc();
                    const page2 = doc2 && doc2.pages[doc2.currentIndex];
                    const src2 = page2 && doc2.sources[page2.sourceId];
                    if (src2 && src2.buffer) {
                        try {
                            const VSCALE = 2.0;
                            const pdfDoc = await pdfjsLib.getDocument({ data: src2.buffer.slice(0) }).promise;
                            const pdfPage = await pdfDoc.getPage((page2.pageIndex || 0) + 1);
                            const vp = pdfPage.getViewport({ scale: VSCALE });
                            const offscreen = document.createElement('canvas');
                            offscreen.width = vp.width; offscreen.height = vp.height;
                            const ctx = offscreen.getContext('2d', { alpha: false });
                            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, vp.width, vp.height);
                            await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
                            // Crop to selected area (convert PDF-point clip to pixel coords at VSCALE)
                            const px0 = Math.round(pdfRect[0] * VSCALE);
                            const py0 = Math.round(pdfRect[1] * VSCALE);
                            const pw  = Math.round((pdfRect[2] - pdfRect[0]) * VSCALE);
                            const ph  = Math.round((pdfRect[3] - pdfRect[1]) * VSCALE);
                            const crop = document.createElement('canvas');
                            crop.width = Math.max(1, pw); crop.height = Math.max(1, ph);
                            crop.getContext('2d').drawImage(offscreen, -px0, -py0);
                            const imgEl = document.getElementById('ttf-page-img');
                            imgEl.src = crop.toDataURL('image/png');
                            imgEl.style.display = 'block';
                            document.getElementById('ttf-preview-placeholder').style.display = 'none';
                            self._ttfPageNativeW = crop.width;
                            self._ttfPageNativeH = crop.height;
                        } catch(e) { console.warn('_ttfSelectArea offscreen render error:', e); }
                        await self._ttfRunDetection(src2, page2, pdfRect);
                    }
                });
            },

            _ttfRunDetection: async function (src, page, clipRect) {
                this._ttfLastClip = clipRect || null;
                this._ttfLastStrategy = 'lattice';
                const statusEl = document.getElementById('ttf-status');
                statusEl.textContent = '🔍 Detectando tablas…';
                document.getElementById('ttf-fields-preview').innerHTML = '';
                document.getElementById('ttf-options').style.display = 'none';
                document.getElementById('ttf-btn-generate').style.display = 'none';
                document.getElementById('ttf-btn-reanalyze').style.display = 'none';
                document.getElementById('ttf-btn-retry-detect').style.display = 'none';
                document.getElementById('ttf-table-selector').style.display = 'none';

                let tables;
                try {
                    tables = await PythonManager.detectTables(src.buffer, page.pageIndex, clipRect, 'lattice');
                    if (!tables || tables.length === 0)
                        tables = await PythonManager.detectTables(src.buffer, page.pageIndex, clipRect, 'stream');
                } catch(e) { statusEl.textContent = '❌ Error: ' + e.message; return; }

                if (!tables || tables.length === 0) {
                    statusEl.textContent = '⚠️ No se detectaron tablas.';
                    document.getElementById('ttf-fields-preview').innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Sin tablas detectadas. Prueba Re-detectar o selecciona otra área.</p>';
                    document.getElementById('ttf-btn-retry-detect').style.display = 'inline-flex';
                    return;
                }

                this._ttfTables = tables;
                this._ttfAIResults = [];

                if (tables.length > 1) {
                    const sel = document.getElementById('ttf-table-select');
                    sel.innerHTML = tables.map((t,i)=>`<option value="${i}">Tabla ${i+1} (${t.rows}×${t.cols})</option>`).join('');
                    document.getElementById('ttf-table-selector').style.display = 'block';
                }

                // Auto-zoom si la tabla es pequeña en relación a la página
                try {
                    const _img = document.getElementById('ttf-page-img');
                    const _container = document.getElementById('ttf-preview-container');
                    const _tbl = tables[0];
                    if (_tbl && _img && _container) {
                        const _nW = this._ttfPageNativeW || _img.naturalWidth || 800;
                        const _nH = this._ttfPageNativeH || _img.naturalHeight || 1000;
                        const _tW = _tbl.bbox[2] - _tbl.bbox[0];
                        const _tH = _tbl.bbox[3] - _tbl.bbox[1];
                        const _pageW = _tbl.pageH || _nH; // approx using page ratio
                        const _tblFrac = Math.max(_tW / _nW, _tH / _nH);
                        // Si la tabla ocupa menos del 25% de la página, hacer zoom
                        const _cW = _container.offsetWidth || 400;
                        const _cH = _container.offsetHeight || 500;
                        const _imgW = _img.offsetWidth || _nW;
                        const _imgH = _img.offsetHeight || _nH;
                        const _tPxW = _tW * (_imgW / _nW);
                        const _tPxH = _tH * (_imgH / _nH);
                        const _desiredW = _cW * 0.7, _desiredH = _cH * 0.7;
                        if (_tPxW > 0 && _tPxH > 0 && (_tPxW < _desiredW || _tPxH < _desiredH)) {
                            const _zW = _desiredW / _tPxW, _zH = _desiredH / _tPxH;
                            const _zoom = Math.min(_zW, _zH, 4.0);
                            if (_zoom > 1.2) {
                                this._ttfPreviewScale = _zoom;
                                const wrapper = document.getElementById('ttf-preview-wrapper');
                                if (wrapper) { wrapper.style.transform = 'scale('+_zoom+')'; wrapper.style.transformOrigin = 'top center'; }
                            }
                        }
                    }
                } catch(_ze) {}
                statusEl.textContent = `✅ ${tables.length} tabla(s). Analizando con IA…`;
                await this._ttfAnalyzeWithAI(0);
            },

            _ttfRetryDetection: async function () {
                // Reset preview
                const svg = document.getElementById('ttf-overlay-svg');
                if (svg) svg.innerHTML = '';
                const previewEl = document.getElementById('ttf-fields-preview');
                if (previewEl) previewEl.innerHTML = '';
                this._ttfDragOffsets = {};
                this._ttfSelectedKeys = new Set();
                const statusEl = document.getElementById('ttf-status');
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) return;
                const clip = this._ttfLastClip || null;
                const strategies = ['lattice', 'stream', 'aggressive'];
                const prev = this._ttfLastStrategy || 'lattice';
                const nextIdx = (strategies.indexOf(prev) + 1) % strategies.length;
                const next = strategies[nextIdx];
                this._ttfLastStrategy = next;
                statusEl.textContent = '🔬 Re-detectando con estrategia: ' + next + '…';
                document.getElementById('ttf-btn-retry-detect').style.display = 'none';
                let tables;
                try {
                    tables = await PythonManager.detectTables(src.buffer, page.pageIndex, clip, next);
                } catch(e) { statusEl.textContent = '❌ Error: ' + e.message; document.getElementById('ttf-btn-retry-detect').style.display = 'inline-flex'; return; }
                if (!tables || tables.length === 0) {
                    statusEl.textContent = '⚠️ Sin tablas (' + next + '). Prueba otra estrategia o selecciona área.';
                    document.getElementById('ttf-btn-retry-detect').style.display = 'inline-flex';
                    return;
                }
                this._ttfTables = tables;
                this._ttfAIResults = [];
                if (tables.length > 1) {
                    const sel = document.getElementById('ttf-table-select');
                    sel.innerHTML = tables.map((t,i)=>'<option value="'+i+'">Tabla '+(i+1)+' ('+t.rows+'×'+t.cols+')</option>').join('');
                    document.getElementById('ttf-table-selector').style.display = 'block';
                }
                statusEl.textContent = '\u2705 ' + tables.length + ' tabla(s) [' + next + ']. Analizando…';
                await this._ttfAnalyzeWithAI(0);
            },

                        _ttfSelectTable: async function (idx) {
                await this._ttfAnalyzeWithAI(parseInt(idx));
            },

            _ttfReanalyze: async function () {
                // Reset preview
                const svg = document.getElementById('ttf-overlay-svg');
                if (svg) svg.innerHTML = '';
                this._ttfDragOffsets = {};
                this._ttfSelectedKeys = new Set();
                const sel = document.getElementById('ttf-table-select');
                const idx = parseInt(sel ? sel.value : '0') || 0;
                await this._ttfAnalyzeWithAI(idx);
            },

            _ttfAnalyzeWithAI: async function (tableIdx) {
                const table = this._ttfTables && this._ttfTables[tableIdx];
                if (!table) return;
                this._ttfCurrentTableIdx = tableIdx;

                const statusEl = document.getElementById('ttf-status');
                const previewEl = document.getElementById('ttf-fields-preview');
                const rows = table.data || [];
                if (rows.length === 0) { statusEl.textContent = '⚠️ La tabla no tiene datos extraíbles.'; return; }

                const headers = rows[0];
                const sampleRows = rows.slice(1, 4);

                statusEl.textContent = '🤖 IA analizando encabezados…';
                previewEl.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">Consultando IA…</div>';
                document.getElementById('ttf-btn-generate').style.display = 'none';
                document.getElementById('ttf-btn-reanalyze').style.display = 'none';
                document.getElementById('ttf-btn-retry-detect').style.display = 'none';

                const chatCtx = (this._ttfChatMessages||[]).map(m=>({role:m.role,content:m.content}));
                const systemMsg = `Eres un asistente especializado en formularios PDF. Analiza tablas y genera definiciones de campos JSON.`;
                const userMsg = `Analiza estos encabezados de tabla y datos de muestra para inferir el tipo de campo más apropiado para cada columna.

Encabezados: ${JSON.stringify(headers)}
Datos de muestra: ${JSON.stringify(sampleRows)}
Dimensiones tabla: ${table.rows} filas × ${table.cols} columnas

Responde SOLO con un JSON array (sin markdown ni explicación):
[{"col":0,"label":"nombre","fieldType":"text|checkbox|radio|dropdown","placeholder":"hint","options":[],"include":true}]

Reglas:
- text: nombre, número, fecha, dirección, firma, texto libre
- checkbox: booleanos (sí/no, aplica, verificado, ✓)
- radio: selección única 2-5 opciones fijas (género, estado civil, turno)
- dropdown: lista >4 opciones (departamento, país, cargo)
- include: true siempre por defecto
- Para radio/dropdown, inferir opciones probables`;

                const messages = [...chatCtx, {role:'user', content:userMsg}];

                try {
                    const raw = await this._callGroqWithFallback(messages, 1500);
                    if (!raw) throw new Error('Sin respuesta');
                    let text = raw.trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
                    const fields = JSON.parse(text);

                    this._ttfAIResults[tableIdx] = fields;
                    this._ttfRenderFieldsList(fields, table);
                    this._ttfRenderOverlaySVG(fields, table);

                    // Show group options if radio or checkbox present
                    const hasGroupable = fields.some(f=>f.fieldType==='radio'||f.fieldType==='checkbox');
                    document.getElementById('ttf-group-options').style.display = hasGroupable ? 'block' : 'none';

                    statusEl.textContent = `✅ ${fields.filter(f=>f.include!==false).length} campo(s) activos. Ajusta en la lista o en la vista previa.`;
                    document.getElementById('ttf-options').style.display = 'block';
                    document.getElementById('ttf-btn-generate').style.display = 'inline-flex';
                    document.getElementById('ttf-btn-reanalyze').style.display = 'inline-flex';
                    document.getElementById('ttf-btn-retry-detect').style.display = 'inline-flex';
                } catch(e) {
                    statusEl.textContent = '❌ Error IA: ' + e.message;
                    previewEl.innerHTML = '<p style="color:#f87171;text-align:center;padding:16px;">No se pudo analizar.</p>';
                    document.getElementById('ttf-btn-reanalyze').style.display = 'inline-flex';
                }
            },

            _ttfRenderFieldsList: function (fields, table) {
                const previewEl = document.getElementById('ttf-fields-preview');
                const tIdx = this._ttfCurrentTableIdx;
                const typeColors = { text:'#3b82f6', checkbox:'#10b981', radio:'#f59e0b', dropdown:'#8b5cf6' };
                const typeIcons = { text:'📝', checkbox:'☑️', radio:'⭕', dropdown:'📋' };

                const _btnStyle = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#aaa;font-size:10px;padding:2px 7px;cursor:pointer;flex-shrink:0;';
                previewEl.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:10px;color:#666;">Tabla ${tIdx+1}: ${table.rows}×${table.cols} — ${(table.bbox||[]).map(v=>Math.round(v)).join(', ')}</span>
                    <div style="display:flex;gap:4px;">
                        <button style="${_btnStyle}" title="Agregar columna" onclick="app._ttfAddColumn(${tIdx})">+Col</button>
                        <button style="${_btnStyle}" title="Quitar última columna" onclick="app._ttfRemoveColumn(${tIdx})">−Col</button>
                        <button style="${_btnStyle}" title="Agregar fila" onclick="app._ttfAddRow(${tIdx})">+Fil</button>
                        <button style="${_btnStyle}" title="Quitar última fila" onclick="app._ttfRemoveRow(${tIdx})">−Fil</button>
                    </div>
                </div>
                ${fields.map((f,i) => {
                    const active = f.include !== false;
                    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;margin-bottom:4px;background:${active?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.2)'};border:1px solid ${active?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.04)'};border-radius:6px;cursor:pointer;" onclick="app._ttfToggleFieldInclude(${tIdx},${i})">
                        <span style="font-size:13px;opacity:${active?1:0.3};">${typeIcons[f.fieldType]||'📝'}</span>
                        <div style="flex:1;min-width:0;">
                            <input value="${(f.label||'').replace(/"/g,'&quot;')}"
                                onclick="event.stopPropagation()"
                                onchange="app._ttfUpdateField(${tIdx},${i},'label',this.value);app._ttfRenderOverlaySVG(app._ttfAIResults[${tIdx}],app._ttfTables[${tIdx}])"
                                style="width:100%;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,${active?'0.15':'0.04'});color:${active?'#e0e0e0':'#666'};font-size:11px;padding:1px 2px;outline:none;">
                        </div>
                        <select onclick="event.stopPropagation()"
                            onchange="app._ttfUpdateField(${tIdx},${i},'fieldType',this.value);app._ttfRenderOverlaySVG(app._ttfAIResults[${tIdx}],app._ttfTables[${tIdx}]);app._ttfCheckGroupable()"
                            style="background:var(--bg-panel);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:${typeColors[f.fieldType]||'#3b82f6'};font-size:9px;padding:2px 3px;cursor:pointer;flex-shrink:0;">
                            ${['text','checkbox','radio','dropdown'].map(t=>'<option value="'+t+'" '+(f.fieldType===t?'selected':'')+'>'+typeIcons[t]+' '+t+'</option>').join('')}
                        </select>
                        <span style="font-size:14px;color:${active?'#10b981':'#555'};flex-shrink:0;">${active?'✓':'○'}</span>
                    </div>`;
                }).join('')}`;
            },

            _ttfAddColumn: function (tIdx) {
                const fields = this._ttfAIResults[tIdx];
                const table = this._ttfTables[tIdx];
                if (!fields || !table) return;
                const newCol = {col: fields.length, label: 'Campo '+(fields.length+1), fieldType:'text', include:true};
                fields.push(newCol);
                // Add empty cell to each row in cellBboxes: estimate bbox from last col
                const lastIdx = fields.length - 2;
                if (table.cellBboxes) {
                    table.cellBboxes.forEach(row => {
                        const last = row[lastIdx];
                        if (last) {
                            const cw = last[2] - last[0];
                            row.push([last[2], last[1], last[2]+cw, last[3]]);
                        } else row.push(null);
                    });
                }
                table.cols = fields.length;
                this._ttfRenderFieldsList(fields, table);
                this._ttfRenderOverlaySVG(fields, table);
                this._ttfCheckGroupable();
            },

            _ttfRemoveColumn: function (tIdx) {
                const fields = this._ttfAIResults[tIdx];
                const table = this._ttfTables[tIdx];
                if (!fields || fields.length <= 1) return;
                fields.pop();
                if (table.cellBboxes) table.cellBboxes.forEach(row => row.pop());
                table.cols = fields.length;
                this._ttfRenderFieldsList(fields, table);
                this._ttfRenderOverlaySVG(fields, table);
                this._ttfCheckGroupable();
            },

            _ttfAddRow: function (tIdx) {
                const table = this._ttfTables[tIdx];
                if (!table) return;
                // Clone last data row
                const lastRow = table.data[table.data.length - 1] || [];
                table.data.push(lastRow.map(() => ''));
                // Clone last cellBbox row, offset by row height
                if (table.cellBboxes && table.cellBboxes.length > 0) {
                    const lastBbox = table.cellBboxes[table.cellBboxes.length - 1];
                    if (lastBbox && lastBbox[0]) {
                        const rowH = lastBbox[0][3] - lastBbox[0][1];
                        table.cellBboxes.push(lastBbox.map(c => c ? [c[0], c[1]+rowH, c[2], c[3]+rowH] : null));
                    } else table.cellBboxes.push(lastBbox.map(() => null));
                }
                table.rows = table.data.length;
                this._ttfRenderOverlaySVGCurrent();
            },

            _ttfRemoveRow: function (tIdx) {
                const table = this._ttfTables[tIdx];
                if (!table || table.data.length <= 2) return; // keep header + 1
                table.data.pop();
                if (table.cellBboxes && table.cellBboxes.length > 0) table.cellBboxes.pop();
                table.rows = table.data.length;
                this._ttfRenderOverlaySVGCurrent();
            },

                        _ttfToggleFieldInclude: function (tIdx, fIdx) {
                const f = this._ttfAIResults[tIdx] && this._ttfAIResults[tIdx][fIdx];
                if (!f) return;
                f.include = f.include === false ? true : false;
                this._ttfRenderFieldsList(this._ttfAIResults[tIdx], this._ttfTables[tIdx]);
                this._ttfRenderOverlaySVG(this._ttfAIResults[tIdx], this._ttfTables[tIdx]);
                this._ttfCheckGroupable();
                const active = this._ttfAIResults[tIdx].filter(x=>x.include!==false).length;
                document.getElementById('ttf-status').textContent = `${active} campo(s) activos.`;
            },

            _ttfCheckGroupable: function () {
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx] || [];
                const has = fields.some(f=>f.include!==false && (f.fieldType==='radio'||f.fieldType==='checkbox'));
                document.getElementById('ttf-group-options').style.display = has ? 'block' : 'none';
            },

            _ttfRenderOverlaySVGCurrent: function () {
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults && this._ttfAIResults[tIdx];
                const table = this._ttfTables && this._ttfTables[tIdx];
                if (fields && table) this._ttfRenderOverlaySVG(fields, table);
            },

            _ttfGetStyleOpts: function () {
                return {
                    showBorder:   document.getElementById('ttf-style-show-border')?.checked || false,
                    roundBorder:  document.getElementById('ttf-style-round-border')?.checked || false,
                    borderRadius: parseFloat(document.getElementById('ttf-style-border-radius')?.value || '3'),
                    borderColor:  document.getElementById('ttf-style-border-color')?.value || '#000000',
                    borderWidth:  parseFloat(document.getElementById('ttf-style-border-width')?.value || '1'),
                    bgColor:      document.getElementById('ttf-style-bg-color')?.value || '#ffffff',
                    bgOpacity:    parseInt(document.getElementById('ttf-style-bg-opacity')?.value || '0') / 100,
                    fieldWPct:    Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-w-pct')?.value || '100'))) / 100,
                    fieldHPct:    Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-h-pct')?.value || '100'))) / 100
                };
            },

            _ttfRenderOverlaySVG: function (fields, table) {
                const img = document.getElementById('ttf-page-img');
                const svg = document.getElementById('ttf-overlay-svg');
                if (!img || !svg || !table) return;

                const doRender = () => {
                const imgW = img.offsetWidth || img.naturalWidth || 800;
                const imgH = img.offsetHeight || img.naturalHeight || 1000;

                svg.setAttribute('viewBox', `0 0 ${imgW} ${imgH}`);
                svg.setAttribute('width', imgW);
                svg.setAttribute('height', imgH);

                const nativeW = this._ttfPageNativeW || imgW;
                const nativeH = this._ttfPageNativeH || imgH;
                const VSCALE = 2.0;
                const dispScaleX = imgW / nativeW;
                const dispScaleY = imgH / nativeH;
                const clip = this._ttfClipRect;
                const originX = clip ? clip[0] * VSCALE : 0;
                const originY = clip ? clip[1] * VSCALE : 0;
                const toPx = (v, axis) => axis === 'x' ? (v * VSCALE - originX) * dispScaleX : (v * VSCALE - originY) * dispScaleY;
                const toDim = (v, axis) => axis === 'x' ? v * VSCALE * dispScaleX : v * VSCALE * dispScaleY;

                const bbox = table.bbox || [0,0,100,100];
                const cellBboxes = table.cellBboxes || [];
                const rows = table.data || [];
                const skipHeader = document.getElementById('ttf-opt-header-row')?.checked !== false;
                const startRow = skipHeader ? 1 : 0;
                const colCount = fields.length;
                const tableW = bbox[2]-bbox[0], tableH = bbox[3]-bbox[1];
                const defaultCellW = tableW/colCount;
                const defaultCellH = rows.length>0 ? tableH/rows.length : 20;

                const style = this._ttfGetStyleOpts();
                const typeStroke = { text:'#3b82f6', checkbox:'#10b981', radio:'#f59e0b', dropdown:'#8b5cf6' };

                const selectedKeys = this._ttfSelectedKeys = this._ttfSelectedKeys || new Set();
                let svgContent = '';
                const tx = toPx(bbox[0],'x'), ty = toPx(bbox[1],'y');
                const tw = toDim(tableW,'x'), th = toDim(tableH,'y');
                svgContent += `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="none" stroke="#ffffff20" stroke-width="1" stroke-dasharray="4,3"/>`;

                const draggedOffsets = this._ttfDragOffsets = this._ttfDragOffsets || {};
                const vInsetPdf = parseFloat(document.getElementById('ttf-style-v-inset')?.value || '5');
                const hPadPdfVal = parseFloat(document.getElementById('ttf-style-h-pad')?.value || '2');
                const isFreeForm = table._isFreeForm;

                const _renderField = (f, fi, rowIdx, colIdx, cellBox) => {
                    if (f.include === false) return;
                    let cx, cy, cw, ch;
                    if (cellBox) {
                        cx=cellBox[0]; cy=cellBox[1]; cw=cellBox[2]-cellBox[0]; ch=cellBox[3]-cellBox[1];
                    } else {
                        cx=bbox[0]+colIdx*defaultCellW; cy=bbox[1]+rowIdx*defaultCellH; cw=defaultCellW; ch=defaultCellH;
                    }
                    const key = `${fi}_${colIdx}`;
                    const off = draggedOffsets[key] || {dx:0,dy:0};
                    const cellX = toPx(cx,'x'), cellY = toPx(cy,'y');
                    const cellW = toDim(cw,'x'), cellH = toDim(ch,'y');
                    const ftype = f.fieldType||'text';
                    const isSquare = (ftype==='checkbox'||ftype==='radio');
                    const vInsetScaled = isSquare ? 0 : toDim(vInsetPdf,'y');
                    const hPad = isSquare ? 0 : toDim(hPadPdfVal,'x');
                    const sq = Math.min(cellW, cellH);
                    const pw = isSquare ? sq : Math.max((cellW - hPad*2) * style.fieldWPct, 12);
                    const ph = isSquare ? sq : Math.max((cellH - vInsetScaled*2) * style.fieldHPct, 8);
                    const px = cellX + (cellW - pw)/2 + off.dx;
                    const py = cellY + (cellH - ph)/2 + off.dy;
                    const typeStrokeColor = typeStroke[ftype]||'#3b82f6';
                    const bgHex = style.bgColor||'#ffffff';
                    const r2=parseInt(bgHex.slice(1,3),16), g2=parseInt(bgHex.slice(3,5),16), b2=parseInt(bgHex.slice(5,7),16);
                    const rectFill = `rgba(${r2},${g2},${b2},${style.bgOpacity})`;
                    const hasSolidBorder = style.showBorder && style.borderWidth > 0;
                    const rectStroke = hasSolidBorder ? style.borderColor : '#888888';
                    const rectStrokeW = hasSolidBorder ? style.borderWidth : 0.5;
                    const rectDash = hasSolidBorder ? '' : 'stroke-dasharray="3,2"';
                    const rectRx = style.roundBorder ? style.borderRadius : 0;
                    const isSelected = selectedKeys.has(key);
                    const selOverlay = isSelected ? `<rect x="${px-2}" y="${py-2}" width="${pw+4}" height="${ph+4}" fill="rgba(99,102,241,0.18)" stroke="#818cf8" stroke-width="1.5" rx="${rectRx+2}" stroke-dasharray="none"/>` : '';
                    svgContent += `<g class="ttf-field-overlay" data-key="${key}" data-row="${fi}" data-col="${colIdx}" style="cursor:move;">${selOverlay}<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${rectFill}" stroke="${rectStroke}" stroke-width="${rectStrokeW}" rx="${rectRx}" ${rectDash}/>`;
                    if (ftype==='text') {
                        const _lbl=f.label||''; const _fs=_lbl.length>0?Math.max(4,Math.min(ph*0.65,(pw-4)/(_lbl.length*0.55))):Math.max(4,ph*0.65);
                        svgContent += `<text x="${px+2}" y="${py+ph*0.72}" font-size="${_fs.toFixed(1)}" fill="${typeStrokeColor}" font-family="Arial">${_lbl}</text>`;
                    } else if (ftype==='checkbox') {
                        const s=Math.min(pw,ph)-2; svgContent += `<rect x="${px+1}" y="${py+1}" width="${s}" height="${s}" fill="none" stroke="${typeStrokeColor}" stroke-width="1.5" rx="1"/>`;
                    } else if (ftype==='radio') {
                        const r=Math.min(pw,ph)/2-1; svgContent += `<circle cx="${px+pw/2}" cy="${py+ph/2}" r="${r}" fill="none" stroke="${typeStrokeColor}" stroke-width="1.5"/>`;
                    } else if (ftype==='dropdown') {
                        const _lbl2='▼ '+(f.label||''); const _fs2=Math.max(4,Math.min(ph*0.65,(pw-4)/(_lbl2.length*0.55)));
                        svgContent += `<text x="${px+2}" y="${py+ph*0.72}" font-size="${_fs2.toFixed(1)}" fill="${typeStrokeColor}" font-family="Arial">${_lbl2}</text>`;
                    }
                    svgContent += `</g>`;
                };

                if (isFreeForm) {
                    // FREEFORM: índice directo fi → cellBboxes[fi][0], sin startRow ni skipHeader
                    fields.forEach((f, fi) => {
                        const cellBox = cellBboxes[fi] && cellBboxes[fi][0];
                        _renderField(f, fi, fi, 0, cellBox);
                    });
                } else {
                    const skipLastRow = document.getElementById('ttf-opt-last-row')?.checked === true;
                    const onePerCol = document.getElementById('ttf-opt-one-per-col')?.checked === true;
                    const allDataRows = rows.slice(startRow).map((_,i)=>startRow+i);
                    const trimmedRows = skipLastRow && allDataRows.length > 1 ? allDataRows.slice(0,-1) : allDataRows;
                    const rowsToProcess = onePerCol ? [startRow] : trimmedRows;
                    rowsToProcess.forEach(rowIdx => {
                        fields.forEach((f, colIdx) => {
                            const cellBox = cellBboxes[rowIdx] && cellBboxes[rowIdx][colIdx];
                            _renderField(f, rowIdx, rowIdx, colIdx, cellBox);
                        });
                    });
                }

                svg.innerHTML = svgContent;

                // FIX: Delegated events — un solo listener en el SVG padre en lugar de N listeners individuales
                const _self = this;
                const _dragState = {}; // {key, isDrag} por interacción activa

                svg.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    const g = e.target.closest('.ttf-field-overlay');
                    if (!g) return;
                    if (_self._ttfSelectModeActive) return;
                    e.preventDefault(); e.stopPropagation();
                    const key = g.dataset.key;
                    const rowIdx = parseInt(g.dataset.row);
                    const colIdx = parseInt(g.dataset.col);
                    _dragState.key = key; _dragState.isDrag = false;
                    _self._ttfStartDragElement(e, key, rowIdx, colIdx, () => { _dragState.isDrag = true; });
                });
                svg.addEventListener('click', (e) => {
                    if (_self._ttfPaintModeActive) return;
                    const g = e.target.closest('.ttf-field-overlay');
                    if (g) {
                        e.stopPropagation();
                        if (_dragState.isDrag) return;
                        if (!_self._ttfSelectModeActive) return;
                        const key = g.dataset.key;
                        const sel = _self._ttfSelectedKeys = _self._ttfSelectedKeys || new Set();
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                            sel.has(key) ? sel.delete(key) : sel.add(key);
                        } else {
                            if (sel.has(key) && sel.size === 1) { sel.clear(); }
                            else { sel.clear(); sel.add(key); }
                        }
                        _self._ttfUpdateSelToolbar();
                        const tIdx = _self._ttfCurrentTableIdx || 0;
                        _self._ttfRenderOverlaySVG(_self._ttfAIResults[tIdx], _self._ttfTables[tIdx]);
                    } else {
                        if (e.target === svg) {
                            (_self._ttfSelectedKeys = _self._ttfSelectedKeys || new Set()).clear();
                            _self._ttfUpdateSelToolbar();
                            const tIdx = _self._ttfCurrentTableIdx || 0;
                            _self._ttfRenderOverlaySVG(_self._ttfAIResults[tIdx], _self._ttfTables[tIdx]);
                        }
                    }
                });
                svg.addEventListener('contextmenu', (e) => {
                    const g = e.target.closest('.ttf-field-overlay');
                    if (!g) return;
                    e.preventDefault(); e.stopPropagation();
                    const key = g.dataset.key;
                    const sel = _self._ttfSelectedKeys = _self._ttfSelectedKeys || new Set();
                    if (!sel.has(key)) {
                        sel.clear(); sel.add(key);
                        _self._ttfUpdateSelToolbar();
                        const tIdx = _self._ttfCurrentTableIdx || 0;
                        _self._ttfRenderOverlaySVG(_self._ttfAIResults[tIdx], _self._ttfTables[tIdx]);
                    }
                    _self._ttfShowCtxMenu(e.clientX, e.clientY);
                });

                }; // end doRender
                if (img.offsetWidth > 0) doRender();
                else requestAnimationFrame(() => doRender());
                // Re-attach lasso if select mode was active
                if (this._ttfSelectModeActive) {
                    var svgEl = document.getElementById('ttf-overlay-svg');
                    if (svgEl) { svgEl._lassoActive = false; this._ttfInitLasso(); }
                }
            },

            _ttfToggleSelectMode: function () {
                this._ttfSelectModeActive = !this._ttfSelectModeActive;
                var btn = document.getElementById('ttf-btn-select-mode');
                var svg = document.getElementById('ttf-overlay-svg');
                var wrapper = document.getElementById('ttf-preview-wrapper');
                if (btn) {
                    btn.style.background = this._ttfSelectModeActive ? 'rgba(79,142,247,0.25)' : 'rgba(255,255,255,0.06)';
                    btn.style.borderColor = this._ttfSelectModeActive ? '#4f8ef7' : 'var(--border)';
                    btn.style.color = this._ttfSelectModeActive ? '#4f8ef7' : '#ccc';
                }
                if (svg) svg.style.cursor = this._ttfSelectModeActive ? 'crosshair' : 'default';
                if (wrapper) wrapper.style.outline = this._ttfSelectModeActive ? '2px solid #4f8ef780' : 'none';
                if (this._ttfSelectModeActive) {
                    // Disable paint mode if active
                    if (this._ttfPaintModeActive) this._ttfTogglePaintMode();
                    this._ttfInitLasso();
                } else {
                    this._ttfDestroyLasso();
                    (this._ttfSelectedKeys = this._ttfSelectedKeys || new Set()).clear();
                    this._ttfUpdateSelToolbar();
                    const tIdx = this._ttfCurrentTableIdx || 0;
                    if (this._ttfAIResults[tIdx]) this._ttfRenderOverlaySVG(this._ttfAIResults[tIdx], this._ttfTables[tIdx]);
                }
            },

            // ─── PAINT MODE ──────────────────────────────────────────────
            _ttfTogglePaintMode: function () {
                this._ttfPaintModeActive = !this._ttfPaintModeActive;
                var btn = document.getElementById('ttf-btn-paint-mode');
                var lbl = document.getElementById('ttf-paint-mode-label');
                var svg = document.getElementById('ttf-overlay-svg');
                var wrapper = document.getElementById('ttf-preview-wrapper');
                var active = this._ttfPaintModeActive;
                if (btn) {
                    btn.style.background = active ? 'rgba(16,185,129,0.22)' : 'rgba(255,255,255,0.06)';
                    btn.style.borderColor = active ? '#10b981' : 'var(--border)';
                    btn.style.color = active ? '#10b981' : '#ccc';
                }
                if (lbl) lbl.textContent = active ? 'Marcador de Campos' : 'Marcador de Campos';
                var swSel = document.getElementById('ttf-paint-stroke-width');
                if (swSel) swSel.style.display = active ? 'inline-block' : 'none';
                if (svg) svg.style.cursor = active ? 'crosshair' : 'default';
                if (wrapper) wrapper.style.outline = active ? '2px solid #10b98180' : 'none';
                if (active) {
                    if (this._ttfSelectModeActive) this._ttfToggleSelectMode();
                    this._ttfPaintStrokes = this._ttfPaintStrokes || [];
                    this._ttfInitPaintDraw();
                    document.getElementById('ttf-btn-analyze-marks').style.display =
                        (this._ttfPaintStrokes.length > 0) ? 'inline-flex' : 'none';
                    var statusEl2 = document.getElementById('ttf-status');
                    var hasFields = this._ttfAIResults[0] && this._ttfAIResults[0].length > 0;
                    var markLbl = document.getElementById('ttf-analyze-marks-label');
                    if (markLbl) markLbl.textContent = hasFields ? 'Añadir Marcas' : 'Analizar Marcas';
                    if (statusEl2) statusEl2.textContent = hasFields
                        ? '⬜ Marca los campos que faltaron. Al terminar presiona Añadir Marcas.'
                        : '⬜ Arrastra para marcar campos. Un click = punto. Al terminar presiona Analizar Marcas.';
                } else {
                    this._ttfDestroyPaintDraw();
                    document.getElementById('ttf-btn-analyze-marks').style.display = 'none';
                }
            },

            _ttfInitPaintDraw: function () {
                var self = this;
                var svg = document.getElementById('ttf-overlay-svg');
                if (!svg || svg._paintActive) return;
                svg._paintActive = true;
                var drawing = false;
                var startPt = null;
                var previewRect = null;
                var _cachedCTMInverse = null;
                var _rAFPending = false;

                function getSVGPt(e) {
                    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
                    return pt.matrixTransform(_cachedCTMInverse || svg.getScreenCTM().inverse());
                }
                function svgToPDF(sx, sy) {
                    var nW = self._ttfPageNativeW || 595;
                    var nH = self._ttfPageNativeH || 842;
                    var VSCALE2 = 2.0;
                    var imgEl = document.getElementById('ttf-page-img');
                    var svgW2 = parseFloat(svg.getAttribute('width')) || (imgEl ? imgEl.offsetWidth : 595);
                    var svgH2 = parseFloat(svg.getAttribute('height')) || (imgEl ? imgEl.offsetHeight : 842);
                    var clip = self._ttfClipRect;
                    var originX = clip ? clip[0] * VSCALE2 : 0;
                    var originY = clip ? clip[1] * VSCALE2 : 0;
                    var dispX = svgW2 / nW, dispY = svgH2 / nH;
                    return [(sx / dispX + originX) / VSCALE2, (sy / dispY + originY) / VSCALE2];
                }

                svg._paintDown = function(e) {
                    if (!self._ttfPaintModeActive) return;
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    _cachedCTMInverse = svg.getScreenCTM().inverse();
                    drawing = true;
                    startPt = getSVGPt(e);
                    // create preview rect
                    previewRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    var sw = self._ttfPaintStrokeWidth || 2;
                    previewRect.setAttribute('fill', 'rgba(16,185,129,0.08)');
                    previewRect.setAttribute('stroke', '#10b981');
                    previewRect.setAttribute('stroke-width', sw);
                    previewRect.setAttribute('stroke-dasharray', '5,3');
                    previewRect.setAttribute('pointer-events', 'none');
                    previewRect.setAttribute('x', startPt.x);
                    previewRect.setAttribute('y', startPt.y);
                    previewRect.setAttribute('width', 0);
                    previewRect.setAttribute('height', 0);
                    previewRect.classList.add('ttf-paint-stroke');
                    svg.appendChild(previewRect);
                };
                svg._paintMove = function(e) {
                    if (!drawing || !previewRect || !startPt) return;
                    e.preventDefault();
                    if (_rAFPending) return;
                    _rAFPending = true;
                    var clientX = e.clientX, clientY = e.clientY;
                    requestAnimationFrame(function() {
                        _rAFPending = false;
                        if (!drawing || !previewRect || !startPt) return;
                        var pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
                        var cur = pt.matrixTransform(_cachedCTMInverse);
                        var x = Math.min(startPt.x, cur.x);
                        var y = Math.min(startPt.y, cur.y);
                        var w = Math.abs(cur.x - startPt.x);
                        var h = Math.abs(cur.y - startPt.y);
                        previewRect.setAttribute('x', x);
                        previewRect.setAttribute('y', y);
                        previewRect.setAttribute('width', w);
                        previewRect.setAttribute('height', h);
                    });
                };
                svg._paintUp = function(e) {
                    if (!drawing) return;
                    drawing = false;
                    if (!previewRect || !startPt) return;
                    var cur = getSVGPt(e);
                    var x0 = Math.min(startPt.x, cur.x);
                    var y0 = Math.min(startPt.y, cur.y);
                    var x1 = Math.max(startPt.x, cur.x);
                    var y1 = Math.max(startPt.y, cur.y);
                    // Single click: draw small visible dot rect
                    var isPoint = (x1 - x0) < 4 && (y1 - y0) < 4;
                    var minSize = 6; // SVG px — small but visible
                    if (x1 - x0 < minSize) { var cx = (x0+x1)/2; x0 = cx - minSize/2; x1 = cx + minSize/2; }
                    if (y1 - y0 < minSize) { var cy = (y0+y1)/2; y0 = cy - minSize/2; y1 = cy + minSize/2; }
                    // Finalize visual: solid border, no dash
                    var sw = self._ttfPaintStrokeWidth || 2;
                    previewRect.setAttribute('fill', isPoint ? 'rgba(16,185,129,0.4)' : 'rgba(16,185,129,0.08)');
                    previewRect.setAttribute('stroke-dasharray', 'none');
                    previewRect.setAttribute('stroke-width', sw);
                    previewRect.setAttribute('x', x0);
                    previewRect.setAttribute('y', y0);
                    previewRect.setAttribute('width', x1 - x0);
                    previewRect.setAttribute('height', y1 - y0);
                    // Convert SVG → PDF
                    var p0 = svgToPDF(x0, y0);
                    var p1 = svgToPDF(x1, y1);
                    self._ttfPaintStrokes = self._ttfPaintStrokes || [];
                    self._ttfPaintStrokes.push([p0[0], p0[1], p1[0], p1[1]]);
                    self._ttfPaintHints = self._ttfPaintStrokes;
                    previewRect = null; startPt = null;
                    document.getElementById('ttf-btn-analyze-marks').style.display = 'inline-flex';
                    var statusEl3 = document.getElementById('ttf-status');
                    var hasF = self._ttfAIResults && self._ttfAIResults[0] && self._ttfAIResults[0].length > 0;
                    var aml = document.getElementById('ttf-analyze-marks-label');
                    if (aml) aml.textContent = hasF ? 'Añadir Marcas' : 'Analizar Marcas';
                    if (statusEl3) statusEl3.textContent = '⬜ ' + self._ttfPaintStrokes.length + ' marca(s). Sigue marcando o presiona ' + (hasF ? 'Añadir Marcas.' : 'Analizar Marcas.');
                };
                svg.addEventListener('mousedown', svg._paintDown);
                window.addEventListener('mousemove', svg._paintMove);
                window.addEventListener('mouseup', svg._paintUp);
            },

            _ttfDestroyPaintDraw: function () {
                var svg = document.getElementById('ttf-overlay-svg');
                if (!svg || !svg._paintActive) return;
                svg._paintActive = false;
                svg.removeEventListener('mousedown', svg._paintDown);
                window.removeEventListener('mousemove', svg._paintMove);
                window.removeEventListener('mouseup', svg._paintUp);
                svg.style.cursor = 'default';
            },

            _ttfClearPaintStrokes: function () {
                var svg = document.getElementById('ttf-overlay-svg');
                if (svg) svg.querySelectorAll('.ttf-paint-stroke').forEach(el => el.remove());
                this._ttfPaintStrokes = [];
                this._ttfPaintHints = [];
            },

            _ttfAnalyzeMarks: async function () {
                if (!this._ttfPaintStrokes || this._ttfPaintStrokes.length === 0) {
                    this.showToast('Dibuja al menos una marca primero');
                    return;
                }
                this._ttfPaintHints = this._ttfPaintStrokes.slice();
                if (this._ttfPaintModeActive) this._ttfTogglePaintMode();

                var doc = this.getDoc && this.getDoc();
                var page = doc && doc.pages[doc.currentIndex];
                var src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('Abre un PDF primero'); return; }

                var hasExisting = this._ttfAIResults[0] && this._ttfAIResults[0].length > 0;

                if (hasExisting) {
                    // ── MODO INCREMENTAL: solo procesar hints nuevos y añadir ──
                    var statusEl = document.getElementById('ttf-status');
                    if (statusEl) statusEl.textContent = 'Procesando marcas nuevas...';
                    var newFields = await this._ttfHintsToFields(src, page);
                    if (!newFields || newFields.length === 0) {
                        if (statusEl) statusEl.textContent = 'No se detectaron campos en las marcas. Intenta con un rectángulo más grande.';
                        return;
                    }
                    // Append to existing, dedup by overlap
                    var existing = this._ttfTables[0].cellBboxes.map(function(cb, i) {
                        return { bbox: cb[0], fieldType: (this._ttfAIResults[0][i]||{}).fieldType||'text' };
                    }.bind(this));
                    var added = 0;
                    newFields.forEach(function(nf) {
                        var nb = nf.bbox;
                        var dup = existing.some(function(ef) {
                            var eb = ef.bbox;
                            var ix0=Math.max(nb[0],eb[0]),iy0=Math.max(nb[1],eb[1]),ix1=Math.min(nb[2],eb[2]),iy1=Math.min(nb[3],eb[3]);
                            if (ix1<=ix0||iy1<=iy0) return false;
                            var inter=(ix1-ix0)*(iy1-iy0), area=(nb[2]-nb[0])*(nb[3]-nb[1]);
                            return area>0 && inter/area > 0.5;
                        });
                        if (!dup) {
                            var tbl = this._ttfTables[0];
                            tbl.rows++;
                            tbl.data.push([nf.label]);
                            tbl.cellBboxes.push([nf.bbox]);
                            this._ttfAIResults[0].push({ col:0, label:nf.label, fieldType:nf.fieldType, placeholder:'', options:[], groupName:nf.groupName||null, include:true });
                            existing.push({ bbox: nf.bbox });
                            added++;
                        }
                    }.bind(this));
                    // Clear used strokes
                    this._ttfPaintStrokes = [];
                    this._ttfPaintHints = [];
                    // Remove painted rects from SVG (keep field overlays)
                    var svg = document.getElementById('ttf-overlay-svg');
                    if (svg) { svg.querySelectorAll('.ttf-paint-stroke').forEach(function(el){ el.remove(); }); }
                    // Re-render
                    this._ttfRenderFFFieldsList(this._ttfAIResults[0]);
                    this._ttfRenderOverlaySVG(this._ttfAIResults[0], this._ttfTables[0]);
                    if (statusEl) statusEl.textContent = this._ttfAIResults[0].length + ' campo(s) total. +' + added + ' añadido(s). Ajusta y presiona Generar Campos.';
                    document.getElementById('ttf-btn-analyze-marks').style.display = 'none';
                    document.getElementById('ttf-btn-generate').style.display = 'inline-flex';
                } else {
                    // ── MODO INICIAL: análisis completo ──
                    if (!this._ttfTables[0]) {
                        this._ttfTables[0] = { bbox:[0,0,this._ttfPageW||595,this._ttfPageH||842], rows:0, cols:1, data:[], cellBboxes:[], _isFreeForm:true };
                        this._ttfAIResults[0] = [];
                        this._ttfCurrentTableIdx = 0;
                    }
                    document.getElementById('ttf-btn-generate').style.display = 'none';
                    await this._ttfRunFreeFormAnalysis(src, page);
                    // Clear strokes after full analysis
                    this._ttfPaintStrokes = [];
                    this._ttfPaintHints = [];
                    var svg2 = document.getElementById('ttf-overlay-svg');
                    if (svg2) { svg2.querySelectorAll('.ttf-paint-stroke').forEach(function(el){ el.remove(); }); }
                }
            },

            _ttfHintsToFields: async function (src, page) {
                var hints = (this._ttfPaintHints || []).slice();
                if (hints.length === 0) {
                    return await this._ttfHeuristicDetect(src, page, this._ttfClipRect);
                }

                // Con hints: inferir tipo por tamaño y enriquecer label con texto adyacente (PyMuPDF)
                var pageIdx = page.pageIndex || 0;
                var _hintsJson = JSON.stringify(hints);
                var enriched = hints.map(function(hr) {
                    var w = hr[2] - hr[0], h = hr[3] - hr[1];
                    var ftype;
                    if (w <= 20 && h <= 20) ftype = 'checkbox';
                    else if (w <= 20 && h <= 26) ftype = 'radio';
                    else ftype = 'text';
                    return { label: 'campo', fieldType: ftype, bbox: [hr[0], hr[1], hr[2], hr[3]], groupName: null, options: [], _fromHint: true };
                });

                // Try to enrich labels using PyMuPDF adjacent text lookup
                if (window.PythonManager && PythonManager.isLoaded) {
                    try {
                        var pyCode =
                            'import fitz, json\n' +
                            'doc = fitz.open(stream=bytes(js_pdf_bytes), filetype="pdf")\n' +
                            'pg = doc[' + pageIdx + ']\n' +
                            'hints = ' + _hintsJson + '\n' +
                            'words = pg.get_text("words")\n' +
                            'result = []\n' +
                            'for hr in hints:\n' +
                            '    x0,y0,x1,y1 = hr\n' +
                            '    w=x1-x0; h=y1-y0\n' +
                            '    if w<=20 and h<=20: ftype="checkbox"\n' +
                            '    elif w<=20 and h<=26: ftype="radio"\n' +
                            '    else: ftype="text"\n' +
                            '    cx=(x0+x1)/2; cy=(y0+y1)/2\n' +
                            '    best_lbl = "campo"; best_dist = 999\n' +
                            '    for wd in words:\n' +
                            '        wt=wd[4].strip().rstrip(":")\n' +
                            '        if not wt or len(wt)<2: continue\n' +
                            '        wcy=(wd[1]+wd[3])/2; wcx1=wd[2]\n' +
                            '        if abs(wcy-cy)>14: continue\n' +
                            '        dist=x0-wcx1\n' +
                            '        if -8 < dist < 120 and dist < best_dist: best_dist=dist; best_lbl=wt\n' +
                            '    result.append({"label":best_lbl,"fieldType":ftype,"x0":round(x0,1),"y0":round(y0,1),"x1":round(x1,1),"y1":round(y1,1)})\n' +
                            'doc.close()\n' +
                            'json.dumps(result)';
                        var raw = await PythonManager.run(pyCode, { js_pdf_bytes: Array.from(new Uint8Array(src.buffer)) });
                        if (raw) {
                            var parsed = JSON.parse(String(raw));
                            enriched = parsed.map(function(f) {
                                return { label: f.label, fieldType: f.fieldType, bbox: [f.x0, f.y0, f.x1, f.y1], groupName: null, options: [], _fromHint: true };
                            });
                        }
                    } catch(e) { /* fallback to size-only inference already in enriched */ }
                }
                return enriched;
            },


            _ttfShowPaintPopup: function (cx, cy) {
                var pop = document.getElementById('ttf-paint-popup');
                if (!pop) return;
                pop.style.display = 'block';
                // Default type by bbox size
                var bb = this._ttfPaintPendingBbox || [0,0,30,15];
                var w = bb[2]-bb[0], h = bb[3]-bb[1];
                var typeEl = document.getElementById('ttf-paint-type');
                if (typeEl) typeEl.value = (w < 25 && h < 25) ? 'checkbox' : 'text';
                var lbl = document.getElementById('ttf-paint-label');
                if (lbl) { lbl.value = 'Campo'; lbl.focus(); lbl.select(); }
                // Position popup near cursor but keep inside viewport
                var pw = 220, ph = 130;
                var left = Math.min(cx + 10, window.innerWidth - pw - 10);
                var top = Math.min(cy + 10, window.innerHeight - ph - 10);
                pop.style.left = left + 'px'; pop.style.top = top + 'px';
                // Enter key confirms
                if (lbl) lbl.onkeydown = function(e){ if(e.key==='Enter') app._ttfPaintConfirm(); };
            },

            _ttfPaintConfirm: function () {
                var pop = document.getElementById('ttf-paint-popup');
                if (pop) pop.style.display = 'none';
                var label = (document.getElementById('ttf-paint-label') || {}).value || 'Campo';
                var ftype = (document.getElementById('ttf-paint-type') || {}).value || 'text';
                var bb = this._ttfPaintPendingBbox;
                if (!bb) return;
                var tIdx = this._ttfCurrentTableIdx || 0;
                if (!this._ttfTables[tIdx]) return;
                var tbl = this._ttfTables[tIdx];
                var newField = { col:0, label:label, fieldType:ftype, placeholder:'', options:[], groupName:null, include:true };
                var newCell = [bb];
                tbl.rows++;
                tbl.data.push([label]);
                tbl.cellBboxes.push(newCell);
                this._ttfAIResults[tIdx].push(newField);
                this._ttfRenderFFFieldsList(this._ttfAIResults[tIdx]);
                this._ttfRenderOverlaySVG(this._ttfAIResults[tIdx], tbl);
                var statusEl = document.getElementById('ttf-status');
                if (statusEl) statusEl.textContent = this._ttfAIResults[tIdx].length + ' campo(s) detectados. Ajusta y presiona Generar Campos.';
                this._ttfPaintPendingBbox = null;
                this._ttfPaintPendingSvgBbox = null;
            },

            _ttfPaintCancel: function () {
                var pop = document.getElementById('ttf-paint-popup');
                if (pop) pop.style.display = 'none';
                this._ttfPaintPendingBbox = null;
                this._ttfPaintPendingSvgBbox = null;
            },
            // ─── END PAINT MODE ──────────────────────────────────────────

            _ttfInitLasso: function () {
                var self = this;
                var svg = document.getElementById('ttf-overlay-svg');
                if (!svg || svg._lassoActive) return;
                svg._lassoActive = true;
                var lassoRect = null, startPt = null, drawing = false;

                svg._lassoDown = function(e) {
                    if (!self._ttfSelectModeActive) return;
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    var pt = svg.createSVGPoint();
                    pt.x = e.clientX; pt.y = e.clientY;
                    var svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
                    startPt = svgPt;
                    drawing = true;
                    lassoRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
                    lassoRect.setAttribute('fill','rgba(79,142,247,0.12)');
                    lassoRect.setAttribute('stroke','#4f8ef7');
                    lassoRect.setAttribute('stroke-width','1');
                    lassoRect.setAttribute('stroke-dasharray','4,3');
                    lassoRect.setAttribute('pointer-events','none');
                    lassoRect.setAttribute('x', svgPt.x); lassoRect.setAttribute('y', svgPt.y);
                    lassoRect.setAttribute('width','0'); lassoRect.setAttribute('height','0');
                    svg.appendChild(lassoRect);
                };

                svg._lassoMove = function(e) {
                    if (!drawing || !lassoRect || !startPt) return;
                    var pt = svg.createSVGPoint();
                    pt.x = e.clientX; pt.y = e.clientY;
                    var svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
                    var x = Math.min(startPt.x, svgPt.x);
                    var y = Math.min(startPt.y, svgPt.y);
                    var w = Math.abs(svgPt.x - startPt.x);
                    var h = Math.abs(svgPt.y - startPt.y);
                    lassoRect.setAttribute('x', x); lassoRect.setAttribute('y', y);
                    lassoRect.setAttribute('width', w); lassoRect.setAttribute('height', h);
                };

                svg._lassoUp = function(e) {
                    if (!drawing) return;
                    drawing = false;
                    if (!lassoRect) return;
                    var lx = parseFloat(lassoRect.getAttribute('x'));
                    var ly = parseFloat(lassoRect.getAttribute('y'));
                    var lw = parseFloat(lassoRect.getAttribute('width'));
                    var lh = parseFloat(lassoRect.getAttribute('height'));
                    lassoRect.remove(); lassoRect = null;
                    if (lw < 4 && lh < 4) return; // click sin arrastrar
                    // Seleccionar todos los campos dentro del lasso
                    var sel = self._ttfSelectedKeys = self._ttfSelectedKeys || new Set();
                    if (!e.shiftKey) sel.clear();
                    var tIdx = self._ttfCurrentTableIdx || 0;
                    var fields = self._ttfAIResults[tIdx];
                    var table = self._ttfTables[tIdx];
                    if (!fields || !table) return;
                    // Obtener todos los <g class="ttf-field-overlay"> y su posición SVG
                    svg.querySelectorAll('.ttf-field-overlay').forEach(function(g) {
                        var r = g.querySelector('rect');
                        if (!r) return;
                        var rx = parseFloat(r.getAttribute('x'));
                        var ry = parseFloat(r.getAttribute('y'));
                        var rw = parseFloat(r.getAttribute('width'));
                        var rh = parseFloat(r.getAttribute('height'));
                        var cx = rx + rw/2, cy = ry + rh/2;
                        if (cx >= lx && cx <= lx+lw && cy >= ly && cy <= ly+lh) {
                            var key = g.dataset.key;
                            if (key) sel.add(key);
                        }
                    });
                    self._ttfUpdateSelToolbar();
                    self._ttfRenderOverlaySVG(fields, table);
                };

                svg.addEventListener('mousedown', svg._lassoDown);
                window.addEventListener('mousemove', svg._lassoMove);
                window.addEventListener('mouseup', svg._lassoUp);
            },

            _ttfDestroyLasso: function () {
                var svg = document.getElementById('ttf-overlay-svg');
                if (!svg || !svg._lassoActive) return;
                svg._lassoActive = false;
                if (svg._lassoDown) svg.removeEventListener('mousedown', svg._lassoDown);
                if (svg._lassoMove) window.removeEventListener('mousemove', svg._lassoMove);
                if (svg._lassoUp) window.removeEventListener('mouseup', svg._lassoUp);
                svg._lassoDown = svg._lassoMove = svg._lassoUp = null;
            },

            _ttfUpdateSelToolbar: function () {
                const sel = this._ttfSelectedKeys || new Set();
                const tb = document.getElementById('ttf-sel-toolbar');
                const cnt = document.getElementById('ttf-sel-count');
                if (!tb) return;
                if (sel.size > 0) { tb.style.display = 'flex'; if (cnt) cnt.textContent = sel.size + ' selec.'; }
                else { tb.style.display = 'none'; }
            },

            _ttfClearSelection: function () {
                (this._ttfSelectedKeys = this._ttfSelectedKeys || new Set()).clear();
                this._ttfUpdateSelToolbar();
                const tIdx = this._ttfCurrentTableIdx || 0;
                this._ttfRenderOverlaySVG(this._ttfAIResults[tIdx], this._ttfTables[tIdx]);
            },

            _ttfDeleteSelected: function () {
                const sel = this._ttfSelectedKeys || new Set();
                if (!sel.size) return;
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx];
                const table = this._ttfTables[tIdx];
                if (!fields) return;
                const isFreeForm = table && table._isFreeForm;
                sel.forEach(key => {
                    const parts = key.split('_').map(Number);
                    // data-row = fi (índice directo en freeform), colIdx en tablas
                    const fieldIdx = isFreeForm ? parts[0] : parts[1];
                    if (fields[fieldIdx]) fields[fieldIdx].include = false;
                });
                sel.clear();
                this._ttfUpdateSelToolbar();
                if (isFreeForm) {
                    this._ttfRenderFFFieldsList(fields);
                } else {
                    this._ttfRenderFieldsList(fields, table);
                }
                this._ttfRenderOverlaySVG(fields, table);
                this._ttfHideCtxMenu();
            },

            _ttfShowCtxMenu: function (x, y) {
                const menu = document.getElementById('ttf-ctx-menu');
                const hdr = document.getElementById('ttf-ctx-header');
                if (!menu) return;
                const sel = this._ttfSelectedKeys || new Set();
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx] || [];
                const labels = [];
                sel.forEach(key => { const [,c] = key.split('_').map(Number); if (fields[c]) labels.push(fields[c].label || 'campo'); });
                if (hdr) hdr.textContent = sel.size > 1 ? `${sel.size} campos seleccionados` : (labels[0] || 'Campo');
                menu.style.display = 'block';
                const mW = 200, mH = 140;
                menu.style.left = (x + mW > window.innerWidth ? x - mW : x) + 'px';
                menu.style.top  = (y + mH > window.innerHeight ? y - mH : y) + 'px';
                if (!this._ttfCtxOutside) {
                    this._ttfCtxOutside = (e) => { if (!menu.contains(e.target)) this._ttfHideCtxMenu(); };
                    document.addEventListener('mousedown', this._ttfCtxOutside);
                }
            },

            _ttfHideCtxMenu: function () {
                const menu = document.getElementById('ttf-ctx-menu');
                if (menu) menu.style.display = 'none';
                if (this._ttfCtxOutside) { document.removeEventListener('mousedown', this._ttfCtxOutside); this._ttfCtxOutside = null; }
            },

            _ttfCtxDelete: function () { this._ttfHideCtxMenu(); this._ttfDeleteSelected(); },

            _ttfCtxSelectAll: function () {
                this._ttfHideCtxMenu();
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx] || [];
                const table = this._ttfTables && this._ttfTables[tIdx];
                const rows = table ? (table.data || []) : [];
                const skipHeader = document.getElementById('ttf-opt-header-row')?.checked !== false;
                const startRow = skipHeader ? 1 : 0;
                const sel = this._ttfSelectedKeys = new Set();
                rows.forEach((_, rIdx) => { if (rIdx < startRow) return; fields.forEach((f, cIdx) => { if (f.include !== false) sel.add(`${rIdx}_${cIdx}`); }); });
                this._ttfUpdateSelToolbar();
                this._ttfRenderOverlaySVG(fields, table);
            },

            _ttfCtxProperties: function () {
                this._ttfHideCtxMenu();
                const sel = this._ttfSelectedKeys || new Set();
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx] || [];
                const keys = [...sel];
                if (!keys.length) return;
                const colIndices = [...new Set(keys.map(k => parseInt(k.split('_')[1])))];
                const singleField = colIndices.length === 1 ? fields[colIndices[0]] : null;
                const dlg = document.getElementById('ttf-props-dialog');
                const content = document.getElementById('ttf-props-content');
                if (!dlg || !content) return;
                this._ttfPropsKeys = keys;
                this._ttfPropsColIndices = colIndices;
                const typeOpts = ['text','checkbox','radio','dropdown'].map(t => `<option value="${t}" ${singleField && singleField.fieldType===t?'selected':''}>${t}</option>`).join('');
                content.innerHTML = `
                    ${colIndices.length === 1 ? `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Etiqueta</label>
                        <input id="ttf-prop-label" value="${singleField?.label||''}" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:#e2e8f0;padding:5px 8px;font-size:12px;width:100%;box-sizing:border-box;">
                    </div>` : `<div style="font-size:11px;color:#aaa;">${colIndices.length} columnas seleccionadas</div>`}
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="font-size:10px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Tipo de campo</label>
                        <select id="ttf-prop-type" style="background:rgba(10,15,35,0.7);border:1px solid rgba(255,255,255,0.18);border-radius:5px;color:#e2e8f0;padding:8px 10px;font-size:12px;height:36px;width:100%;box-sizing:border-box;">${typeOpts}</select>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" id="ttf-prop-include" ${!singleField || singleField.include!==false ? 'checked' : ''}>
                        <label for="ttf-prop-include" style="font-size:11px;color:#ccc;cursor:pointer;">Incluir en formulario</label>
                    </div>
                `;
                // Position near center of viewport
                dlg.style.display = 'block';
                dlg.style.left = '50%'; dlg.style.top = '50%';
                dlg.style.transform = 'translate(-50%,-50%)';
            },

            _ttfPropsApply: function () {
                const tIdx = this._ttfCurrentTableIdx || 0;
                const fields = this._ttfAIResults[tIdx];
                if (!fields || !this._ttfPropsColIndices) return;
                const newType = document.getElementById('ttf-prop-type')?.value;
                const newLabel = document.getElementById('ttf-prop-label')?.value;
                const newInclude = document.getElementById('ttf-prop-include')?.checked;
                this._ttfPropsColIndices.forEach(cIdx => {
                    if (!fields[cIdx]) return;
                    if (newType) fields[cIdx].fieldType = newType;
                    if (newLabel !== undefined && this._ttfPropsColIndices.length === 1) fields[cIdx].label = newLabel;
                    if (newInclude !== undefined) fields[cIdx].include = newInclude;
                });
                document.getElementById('ttf-props-dialog').style.display = 'none';
                this._ttfRenderFieldsList(fields, this._ttfTables[tIdx]);
                this._ttfRenderOverlaySVG(fields, this._ttfTables[tIdx]);
            },

            _ttfStartDragElement: function (e, key, rowIdx, colIdx, onDragStart) {
                e.preventDefault();
                const offsets = this._ttfDragOffsets = this._ttfDragOffsets || {};
                const svgScale = this._ttfPreviewScale || 1;
                const startX = e.clientX, startY = e.clientY;
                const startOff = offsets[key] ? {...offsets[key]} : {dx:0,dy:0};
                let moved = false;
                let rafId = null;
                let pending = null;
                const sel = this._ttfSelectedKeys || new Set();
                const isInSel = sel.has(key);

                const onMove = (ev) => {
                    ev.preventDefault();
                    const dx = (ev.clientX - startX) / svgScale, dy = (ev.clientY - startY) / svgScale;
                    if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { moved = true; if (onDragStart) onDragStart(); }
                    if (!moved) return;
                    pending = {dx: startOff.dx + dx, dy: startOff.dy + dy};
                    if (!rafId) rafId = requestAnimationFrame(() => {
                        if (pending) {
                            const ddx = pending.dx - startOff.dx, ddy = pending.dy - startOff.dy;
                            if (isInSel && sel.size > 1) {
                                sel.forEach(k => {
                                    const base = this._ttfDragStartOffsets?.[k] || offsets[k] || {dx:0,dy:0};
                                    offsets[k] = {dx: base.dx + ddx, dy: base.dy + ddy};
                                });
                            } else {
                                offsets[key] = pending;
                            }
                            const tIdx = this._ttfCurrentTableIdx || 0;
                            this._ttfRenderOverlaySVG(this._ttfAIResults[tIdx], this._ttfTables[tIdx]);
                        }
                        rafId = null;
                    });
                };
                // Save base offsets for multi-drag
                if (isInSel && sel.size > 1) {
                    this._ttfDragStartOffsets = {};
                    sel.forEach(k => { this._ttfDragStartOffsets[k] = offsets[k] ? {...offsets[k]} : {dx:0,dy:0}; });
                }
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                };
                window.addEventListener('mousemove', onMove, {passive:false});
                window.addEventListener('mouseup', onUp);
            },

            _ttfZoom: function (delta) {
                this._ttfPreviewScale = Math.max(0.3, Math.min(3, (this._ttfPreviewScale||1) + delta));
                const wrapper = document.getElementById('ttf-preview-wrapper');
                if (wrapper) wrapper.style.transform = `scale(${this._ttfPreviewScale})`;
                wrapper.style.transformOrigin = 'top center';
            },

            _ttfRenderChatHistory: function () {
                const hist = document.getElementById('ttf-chat-history');
                if (!hist) return;
                const msgs = this._ttfChatMessages || [];
                hist.innerHTML = msgs.map(m=>`
                    <div style="font-size:10px;padding:4px 8px;border-radius:6px;max-width:90%;${m.role==='user'?'align-self:flex-end;background:rgba(79,142,247,0.2);color:#a0c0ff;':'align-self:flex-start;background:rgba(255,255,255,0.05);color:#ccc;'}">
                        ${m.content.substring(0,200)}${m.content.length>200?'…':''}
                    </div>`).join('');
                hist.scrollTop = hist.scrollHeight;
            },

            _ttfSendChat: async function () {
                const input = document.getElementById('ttf-chat-input');
                const msg = input.value.trim();
                if (!msg) return;
                input.value = '';

                this._ttfChatMessages = this._ttfChatMessages || [];
                this._ttfChatMessages.push({role:'user', content:msg});
                this._ttfRenderChatHistory();

                const statusEl = document.getElementById('ttf-status');
                statusEl.textContent = '🤖 Procesando…';

                const tIdx = this._ttfCurrentTableIdx || 0;
                const table = this._ttfTables && this._ttfTables[tIdx];
                const currentFields = this._ttfAIResults[tIdx];

                const systemCtx = 'Eres asistente de formularios PDF. El usuario ya tiene estos campos definidos: ' +
                    JSON.stringify(currentFields) +
                    '. Responde con un JSON array actualizado si el usuario pide cambios a los campos, o con texto plano si solo hace una pregunta. Si respondes JSON, empiézalo con [ sin ningún texto previo.';
                const messages = [{role:'system',content:systemCtx}, ...this._ttfChatMessages];

                try {
                    const raw = await this._callGroqWithFallback(messages, 1500);
                    if (!raw) throw new Error('Sin respuesta');
                    const trimmed = raw.trim();
                    this._ttfChatMessages.push({role:'assistant', content:trimmed});

                    if (trimmed.startsWith('[')) {
                        try {
                            const updated = JSON.parse(trimmed);
                            this._ttfAIResults[tIdx] = updated;
                            this._ttfRenderFieldsList(updated, table);
                            this._ttfRenderOverlaySVG(updated, table);
                            this._ttfCheckGroupable();
                            statusEl.textContent = `✅ Campos actualizados según tu instrucción.`;
                        } catch(pe) {
                            statusEl.textContent = '⚠️ IA respondió pero el JSON no es válido.';
                        }
                    } else {
                        statusEl.textContent = '💬 IA respondió (ver chat).';
                    }
                } catch(e) {
                    statusEl.textContent = '❌ Error: ' + e.message;
                    this._ttfChatMessages.push({role:'assistant',content:'Error al procesar: ' + e.message});
                }
                this._ttfRenderChatHistory();
            },

            _ttfClearChat: function () {
                this._ttfChatMessages = [];
                this._ttfRenderChatHistory();
                this.showToast('🆕 Nueva conversación iniciada');
            },

            _ttfToggleChatPanel: function () {
                const panel = document.getElementById('ttf-chat-panel');
                const body = document.getElementById('ttf-chat-body');
                const btn = document.getElementById('ttf-chat-toggle-btn');
                const clearBtn = document.getElementById('ttf-chat-clear-btn');
                const label = document.getElementById('ttf-chat-panel-label');
                if (!panel) return;
                const collapsed = panel.dataset.collapsed === '1';
                if (collapsed) {
                    panel.dataset.collapsed = '0';
                    panel.style.width = '260px';
                    panel.style.minWidth = '0';
                    if (body) body.style.display = 'flex';
                    if (btn) btn.textContent = '‹';
                    if (clearBtn) clearBtn.style.display = '';
                    if (label) label.style.display = '';
                } else {
                    panel.dataset.collapsed = '1';
                    panel.style.width = '28px';
                    panel.style.minWidth = '0';
                    if (body) body.style.display = 'none';
                    if (btn) btn.textContent = '›';
                    if (clearBtn) clearBtn.style.display = 'none';
                    if (label) label.style.display = 'none';
                }
            },

            _ttfUpdateField: function (tableIdx, fieldIdx, key, value) {
                if (this._ttfAIResults[tableIdx] && this._ttfAIResults[tableIdx][fieldIdx]) {
                    this._ttfAIResults[tableIdx][fieldIdx][key] = value;
                }
            },

            _ttfGenerateFields: function () {
                const tableIdx = this._ttfCurrentTableIdx || 0;
                const table = this._ttfTables && this._ttfTables[tableIdx];
                const fields = this._ttfAIResults && this._ttfAIResults[tableIdx];
                if (!table || !fields) { this.showToast('⚠️ Sin datos para generar'); return; }

                const doc = this.getDoc();
                if (!doc) return;
                this.saveState();

                const page = doc.pages[doc.currentIndex];
                const rows = table.data || [];
                const bbox = table.bbox;
                const cellBboxes = table.cellBboxes || [];
                const dragOffsets = this._ttfDragOffsets || {};

                const skipHeader = document.getElementById('ttf-opt-header-row')?.checked !== false;
                const skipLastRow = document.getElementById('ttf-opt-last-row')?.checked === true;
                const addLabels = document.getElementById('ttf-opt-use-labels')?.checked !== false;
                const onePerCol = document.getElementById('ttf-opt-one-per-col')?.checked === true;
                const groupBy = document.querySelector('input[name="ttf-group-by"]:checked')?.value || 'row';
                const style = this._ttfGetStyleOpts();

                const startRow = skipHeader ? 1 : 0;
                let addedCount = 0;

                const tableW = bbox[2]-bbox[0], tableH = bbox[3]-bbox[1];
                const dataRows = rows.length - (skipHeader?1:0);
                const allColCount = fields.length;
                const defaultCellW = tableW / allColCount;
                const defaultCellH = dataRows>0 ? tableH/rows.length : 20;
                const pdfScale = this.currentScale || 1;
                const nativeW = this._ttfPageNativeW || 800;
                const nativeH2 = this._ttfPageNativeH || 1000;
                const imgEl = document.getElementById('ttf-page-img');
                const imgW = imgEl ? (imgEl.offsetWidth || imgEl.naturalWidth || nativeW) : nativeW;
                const imgH2 = imgEl ? (imgEl.offsetHeight || imgEl.naturalHeight || nativeH2) : nativeH2;
                const scaleX = imgW / nativeW;
                const scaleY2 = imgH2 / nativeH2;

                const existingFields = (page.objects||[]).filter(o=>o.type==='form-field');
                let nextTab = existingFields.length>0 ? Math.max(...existingFields.map(o=>o.tabIndex||0))+1 : 1;

                const allDataRows2 = rows.slice(startRow).map((_,i)=>startRow+i);
                const trimmedRows2 = skipLastRow && allDataRows2.length > 1 ? allDataRows2.slice(0,-1) : allDataRows2;
                const rowsToProcess = onePerCol ? [startRow] : trimmedRows2;

                // Build group names for radio/checkbox by row or col
                const getGroupName = (f, rowIdx, colIdx) => {
                    if (f.fieldType !== 'radio' && f.fieldType !== 'checkbox') return null;
                    return groupBy === 'row'
                        ? `grp_row${rowIdx}_${(f.label||'field').replace(/\s+/g,'_')}`
                        : `grp_col${colIdx}_${(f.label||'field').replace(/\s+/g,'_')}`;
                };

                const isFreeForm2 = table._isFreeForm;

                if (isFreeForm2) {
                    // FREEFORM: iterar directamente por índice de campo (fi), igual que render preview
                    fields.forEach((fieldDef, fi) => {
                        if (fieldDef.include === false) return;

                        const cellBox = cellBboxes[fi] && cellBboxes[fi][0];
                        let cx, cy, cw, ch;
                        if (cellBox) {
                            cx=cellBox[0]; cy=cellBox[1]; cw=cellBox[2]-cellBox[0]; ch=cellBox[3]-cellBox[1];
                        } else {
                            cx=bbox[0]; cy=bbox[1]+fi*defaultCellH; cw=defaultCellW; ch=defaultCellH;
                        }

                        const key = `${fi}_0`;
                        const off = dragOffsets[key] || {dx:0,dy:0};
                        const VSCALE2 = 2.0;
                        const dxPdf = off.dx / (VSCALE2 * scaleX);
                        const dyPdf = off.dy / (VSCALE2 * scaleY2);

                        const ftype = fieldDef.fieldType || 'text';
                        const fname = (fieldDef.label||'campo')+'_f'+fi+'_'+Date.now();
                        const groupName = getGroupName(fieldDef, fi, 0);

                        const vInset = parseFloat(document.getElementById('ttf-style-v-inset')?.value || '0');
                        const minPad = Math.max(parseFloat(document.getElementById('ttf-style-h-pad')?.value || '2'), 1);
                        const wPct = Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-w-pct')?.value || '100'))) / 100;
                        const hPct = Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-h-pct')?.value || '100'))) / 100;
                        const isSquareField = (ftype === 'checkbox' || ftype === 'radio');
                        let fw, fh, fx, fy;
                        if (isSquareField) {
                            const sq = Math.min(cw, ch);
                            fw = sq; fh = sq;
                            fx = cx + (cw - fw) / 2 + dxPdf;
                            fy = cy + (ch - fh) / 2 + dyPdf;
                        } else {
                            const baseW = Math.max(cw - minPad * 2, 20);
                            const baseH = Math.max(ch - vInset * 2, 12);
                            fw = baseW * wPct;
                            fh = baseH * hPct;
                            fx = cx + minPad + (baseW - fw) / 2 + dxPdf;
                            fy = cy + vInset + (baseH - fh) / 2 + dyPdf;
                        }

                        const bgHex3 = style.bgColor || '#ffffff';
                        const r3 = parseInt(bgHex3.slice(1,3),16), g3 = parseInt(bgHex3.slice(3,5),16), b3 = parseInt(bgHex3.slice(5,7),16);
                        const fieldBg = `rgba(${r3},${g3},${b3},${style.bgOpacity})`;

                        const fieldObj = {
                            id: 'ttf_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
                            type: 'form-field',
                            fieldType: ftype,
                            fieldName: fname,
                            x: fx, y: fy, width: fw, height: fh,
                            rotation: 0,
                            backgroundColor: style.bgOpacity > 0 ? fieldBg : 'rgba(0,0,0,0)',
                            noBg: style.bgOpacity === 0,
                            borderColor: style.showBorder ? (style.borderColor || '#999999') : null,
                            borderWidth: style.showBorder ? (style.borderWidth || 1) : 0,
                            borderStyle: style.showBorder ? 'solid' : 'none',
                            borderRadius: style.roundBorder ? style.borderRadius : 0,
                            autoSize: true,
                            tabIndex: nextTab++
                        };
                        if (groupName) { fieldObj.groupName = groupName; fieldObj.fieldName = groupName + '_opt' + fi; }
                        if ((ftype==='dropdown'||ftype==='radio') && fieldDef.options?.length>0) {
                            fieldObj.dropdownOptions = fieldDef.options; fieldObj.options = fieldDef.options;
                        }
                        if (fieldDef.placeholder) fieldObj.placeholder = fieldDef.placeholder;
                        page.objects.push(fieldObj);
                        addedCount++;
                    });
                } else {

                rowsToProcess.forEach(rowIdx => {
                    const fieldsToGen = fields;
                    fieldsToGen.forEach((fieldDef, colIdx) => {
                        if (fieldDef.include === false) return;

                        const cellBox = cellBboxes[rowIdx] && cellBboxes[rowIdx][colIdx];
                        let cx, cy, cw, ch;
                        if (cellBox) {
                            cx=cellBox[0]; cy=cellBox[1]; cw=cellBox[2]-cellBox[0]; ch=cellBox[3]-cellBox[1];
                        } else {
                            cx=bbox[0]+colIdx*defaultCellW; cy=bbox[1]+rowIdx*defaultCellH; cw=defaultCellW; ch=defaultCellH;
                        }

                        const key = `${rowIdx}_${colIdx}`;
                        const off = dragOffsets[key] || {dx:0,dy:0};
                        const VSCALE2 = 2.0;
                        const dxPdf = off.dx / (VSCALE2 * scaleX);
                        const dyPdf = off.dy / (VSCALE2 * scaleY2);

                        const ftype = fieldDef.fieldType || 'text';
                        const fname = (fieldDef.label||'campo')+'_r'+rowIdx+'c'+colIdx+'_'+Date.now();
                        const groupName = getGroupName(fieldDef, rowIdx, colIdx);

                        const vInset = parseFloat(document.getElementById('ttf-style-v-inset')?.value || '0');
                        const minPad = Math.max(parseFloat(document.getElementById('ttf-style-h-pad')?.value || '2'), 1);
                        const wPct = Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-w-pct')?.value || '100'))) / 100;
                        const hPct = Math.min(100, Math.max(10, parseFloat(document.getElementById('ttf-style-field-h-pct')?.value || '100'))) / 100;
                        const isSquareField = (ftype === 'checkbox' || ftype === 'radio');
                        let fw, fh, fx, fy;
                        if (isSquareField) {
                            const sq = Math.min(cw, ch);
                            fw = sq; fh = sq;
                            fx = cx + (cw - fw) / 2 + dxPdf;
                            fy = cy + (ch - fh) / 2 + dyPdf;
                        } else {
                            const baseW = Math.max(cw - minPad * 2, 20);
                            const baseH = Math.max(ch - vInset * 2, 12);
                            fw = baseW * wPct;
                            fh = baseH * hPct;
                            fx = cx + minPad + (baseW - fw) / 2 + dxPdf;
                            fy = cy + vInset + (baseH - fh) / 2 + dyPdf;
                        }

                        const bgHex3 = style.bgColor || '#ffffff';
                        const r3 = parseInt(bgHex3.slice(1,3),16), g3 = parseInt(bgHex3.slice(3,5),16), b3 = parseInt(bgHex3.slice(5,7),16);
                        const fieldBg = `rgba(${r3},${g3},${b3},${style.bgOpacity})`;

                        const fieldObj = {
                            id: 'ttf_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
                            type: 'form-field',
                            fieldType: ftype,
                            fieldName: fname,
                            x: fx, y: fy, width: fw, height: fh,
                            rotation: 0,
                            backgroundColor: style.bgOpacity > 0 ? fieldBg : 'rgba(0,0,0,0)',
                            noBg: style.bgOpacity === 0,
                            borderColor: style.showBorder ? (style.borderColor || '#999999') : null,
                            borderWidth: style.showBorder ? (style.borderWidth || 1) : 0,
                            borderStyle: style.showBorder ? 'solid' : 'none',
                            borderRadius: style.roundBorder ? style.borderRadius : 0,
                            autoSize: true,
                            tabIndex: nextTab++
                        };

                        if (groupName) {
                            fieldObj.groupName = groupName;
                            fieldObj.fieldName = groupName + '_opt' + (rowIdx*100+colIdx);
                        }
                        if ((ftype==='dropdown'||ftype==='radio') && fieldDef.options?.length>0) {
                            fieldObj.dropdownOptions = fieldDef.options;
                            fieldObj.options = fieldDef.options;
                        }
                        if (fieldDef.placeholder) fieldObj.placeholder = fieldDef.placeholder;

                        page.objects.push(fieldObj);
                        addedCount++;

                        if (addLabels && rowIdx===startRow) {
                            const labelH=10, labelY=fy-labelH-1;
                            if (labelY>=0) page.objects.push({
                                id:'ttf_lbl_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
                                type:'text', x:fx, y:labelY, width:fw, height:labelH,
                                text: fieldDef.label||('Campo '+(colIdx+1)),
                                fontSize:7, fontFamily:'Arial', fontWeight:'bold',
                                color:'#333333', rotation:0, align:'left'
                            });
                        }
                    });
                });
                } // end else (table mode)

                this._ttfDragOffsets = {};
                this.isFieldEditMode = true;
                const sw = document.getElementById('switch-edit-fields');
                if (sw) sw.checked = true;

                this.renderOverlays();
                this.renderSidebar();
                this.closeAllModals();
                this.showToast(`✨ ${addedCount} campos generados`);

                if (this.currentTab !== 'form') this.switchRibbon('form');
            },

            // ======================================================
            // FORMATO LIBRE - Vision AI field detection
            // ======================================================

            _ttfMode: 'table',

            _ttfSetMode: function (mode) {
                // Debounce cambio de pestaña 2s
                var now = Date.now();
                if (this._ttfLastTabSwitch && now - this._ttfLastTabSwitch < 2000) return;
                this._ttfLastTabSwitch = now;
                this._ttfMode = mode;
                var isFF = mode === 'freeform';
                var t = document.getElementById('ttf-tab-table');
                var f = document.getElementById('ttf-tab-freeform');
                if (t) { t.style.borderBottomColor = isFF ? 'transparent' : '#4f8ef7'; t.style.color = isFF ? '#888' : '#4f8ef7'; }
                if (f) { f.style.borderBottomColor = isFF ? '#4f8ef7' : 'transparent'; f.style.color = isFF ? '#4f8ef7' : '#888'; }
                // Deshabilitar "Página completa" en Formato Libre
                var btnFull = document.getElementById('ttf-btn-full-page');
                if (btnFull) {
                    btnFull.disabled = isFF;
                    btnFull.title = isFF ? 'Usa "Seleccionar área" en Formato Libre para mejor precisión' : '';
                    btnFull.style.opacity = isFF ? '0.4' : '';
                    btnFull.style.cursor = isFF ? 'not-allowed' : '';
                }
                document.getElementById('ttf-status').textContent = isFF ? 'Selecciona un área del formulario para analizar.' : 'Selecciona "Pagina completa" o "Seleccionar area" para comenzar.';
                document.getElementById('ttf-table-selector').style.display = 'none';
                document.getElementById('ttf-options').style.display = 'none';
                document.getElementById('ttf-btn-generate').style.display = 'none';
                document.getElementById('ttf-btn-reanalyze').style.display = 'none';
                var r = document.getElementById('ttf-btn-retry-detect'); if (r) r.style.display = 'none';
                var fr = document.getElementById('ttf-btn-ff-retry'); if (fr) fr.style.display = 'none';
                document.getElementById('ttf-fields-preview').innerHTML = '';
                var svg = document.getElementById('ttf-overlay-svg'); if (svg) svg.innerHTML = '';
                var adjPanel = document.getElementById('ttf-ff-adjust-panel');
                if (adjPanel) adjPanel.style.display = 'none';
                var amBtn = document.getElementById('ttf-btn-analyze-marks'); if (amBtn) amBtn.style.display = 'none';
                this._ttfPaintStrokes = []; this._ttfPaintHints = [];
                this._ttfClearPaintStrokes && this._ttfClearPaintStrokes();
                this._ttfTables = []; this._ttfAIResults = [];
            },

            _ttfFreeFormDetect: async function (scope) {
                if (this._ttfFFBusy) { this.showToast('Análisis en curso, espera...'); return; }
                this._ttfFFBusy = true;
                try { await this._ttfFreeFormDetectInner(scope); } finally { this._ttfFFBusy = false; }
            },

            _ttfFreeFormDetectInner: async function (scope) {
                var doc = this.getDoc();
                var page = doc && doc.pages[doc.currentIndex];
                var src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('Abre un PDF primero'); return; }
                if (scope === 'area') {
                    var modal = document.getElementById('table-to-form-modal');
                    var overlay = document.getElementById('modal-overlay');
                    modal.style.display = 'none'; overlay.style.display = 'none';
                    this.showToast('Arrastra para seleccionar el area del formulario...');
                    var self = this;
                    this.startCaptureSelection(async function(rect) {
                        modal.style.display = 'flex'; overlay.style.display = 'flex';
                        var scale = self.currentScale;
                        self._ttfClipRect = [rect.x/scale, rect.y/scale, (rect.x+rect.w)/scale, (rect.y+rect.h)/scale];
                        try {
                            const VSCALE = 2.0;
                            const pdfRect2 = self._ttfClipRect;
                            const pdfDoc2 = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                            const pdfPage2 = await pdfDoc2.getPage((page.pageIndex || 0) + 1);
                            const vp2 = pdfPage2.getViewport({ scale: VSCALE });
                            const offscreen2 = document.createElement('canvas');
                            offscreen2.width = vp2.width; offscreen2.height = vp2.height;
                            const ctx2a = offscreen2.getContext('2d', { alpha: false });
                            ctx2a.fillStyle = '#ffffff'; ctx2a.fillRect(0, 0, vp2.width, vp2.height);
                            await pdfPage2.render({ canvasContext: ctx2a, viewport: vp2 }).promise;
                            const px0 = Math.round(pdfRect2[0] * VSCALE);
                            const py0 = Math.round(pdfRect2[1] * VSCALE);
                            const pw2 = Math.round((pdfRect2[2] - pdfRect2[0]) * VSCALE);
                            const ph2 = Math.round((pdfRect2[3] - pdfRect2[1]) * VSCALE);
                            const crop2 = document.createElement('canvas');
                            crop2.width = Math.max(1, pw2); crop2.height = Math.max(1, ph2);
                            crop2.getContext('2d').drawImage(offscreen2, -px0, -py0);
                            var img = document.getElementById('ttf-page-img');
                            img.src = crop2.toDataURL('image/png');
                            img.style.display = 'block';
                            document.getElementById('ttf-preview-placeholder').style.display = 'none';
                            self._ttfPageNativeW = crop2.width; self._ttfPageNativeH = crop2.height;
                            self._ttfFFLastImgB64 = crop2.toDataURL('image/png').split(',')[1];
                        } catch(e) { console.warn('_ttfFreeFormDetect area render error:', e); }
                        // Reset paint strokes for new area
                        self._ttfPaintStrokes = []; self._ttfPaintHints = [];
                        self._ttfClearPaintStrokes && self._ttfClearPaintStrokes();
                        // Activate paint mode so user can mark fields
                        if (!self._ttfPaintModeActive) self._ttfTogglePaintMode();
                        // Initialize freeform table state
                        if (!self._ttfTables[0]) {
                            self._ttfTables[0] = { bbox:[0,0,self._ttfPageW||595,self._ttfPageH||842], rows:0, cols:1, data:[], cellBboxes:[], _isFreeForm:true };
                            self._ttfAIResults[0] = []; self._ttfCurrentTableIdx = 0;
                        }
                        document.getElementById('ttf-btn-analyze-marks').style.display = 'none';
                        document.getElementById('ttf-btn-generate').style.display = 'none';
                    });
                    return;
                }
                this._ttfClipRect = null;
                try {
                    const VSCALE = 2.0;
                    const pdfDoc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const pdfPage = await pdfDoc.getPage((page.pageIndex || 0) + 1);
                    const vp = pdfPage.getViewport({ scale: VSCALE });
                    const offscreen = document.createElement('canvas');
                    offscreen.width = vp.width; offscreen.height = vp.height;
                    const ctx2 = offscreen.getContext('2d', { alpha: false });
                    ctx2.fillStyle = '#ffffff'; ctx2.fillRect(0, 0, vp.width, vp.height);
                    await pdfPage.render({ canvasContext: ctx2, viewport: vp }).promise;
                    var img2 = document.getElementById('ttf-page-img');
                    img2.src = offscreen.toDataURL('image/png');
                    img2.style.display = 'block';
                    document.getElementById('ttf-preview-placeholder').style.display = 'none';
                    this._ttfPageNativeW = offscreen.width;
                    this._ttfPageNativeH = offscreen.height;
                    this._ttfFFLastImgB64 = offscreen.toDataURL('image/png').split(',')[1];
                } catch(e) { console.warn('_ttfFreeFormDetect offscreen render error:', e); }
                await this._ttfRunFreeFormAnalysis(src, page);
            },

            // Detecta campos nativos del PDF usando PyMuPDF (fallback sin IA)
            _ttfDetectFieldsPyMuPDF: async function(src, page, pageW, pageH) {
                if (!window.PythonManager || !PythonManager.isLoaded) return null;
                var fieldTypeMap = { 'Text': 'text', 'CheckBox': 'checkbox', 'RadioButton': 'radio',
                                     'ComboBox': 'dropdown', 'ListBox': 'dropdown', 'Signature': 'text' };
                try {
                    var pyCode =
                        'import fitz, json\n' +
                        'doc = fitz.open(stream=bytes(js_pdf_bytes), filetype="pdf")\n' +
                        'pg = doc[' + (page.pageIndex || 0) + ']\n' +
                        'result = []\n' +
                        'for w in pg.widgets():\n' +
                        '    r = list(w.rect)\n' +
                        '    result.append({"label": w.field_name or "Campo", "type": w.field_type_string or "Text", ' +
                        '"x0": round(r[0],2), "y0": round(r[1],2), "x1": round(r[2],2), "y1": round(r[3],2)})\n' +
                        'doc.close()\n' +
                        'json.dumps(result)';
                    var raw = await PythonManager.run(pyCode, { js_pdf_bytes: Array.from(new Uint8Array(src.buffer)) });
                    if (!raw) return null;
                    var parsed = JSON.parse(String(raw));
                    if (!Array.isArray(parsed) || parsed.length === 0) return null;
                    return parsed.map(function(f) {
                        return {
                            label: f.label,
                            fieldType: fieldTypeMap[f.type] || 'text',
                            bbox: [f.x0, f.y0, f.x1, f.y1],
                            groupName: null,
                            options: []
                        };
                    }).filter(function(f) {
                        var b = f.bbox; return (b[2]-b[0]) > 2 && (b[3]-b[1]) > 1;
                    });
                } catch(e) {
                    console.warn('PyMuPDF field detection error:', e.message);
                    return null;
                }
            },

            _ttfHeuristicDetect: async function (src, page, clipRect) {
                if (!window.PythonManager || !PythonManager.isLoaded) return [];
                var pageIdx = page.pageIndex || 0;
                var _hintsJson = JSON.stringify(this._ttfPaintHints || []);
                var pyCode =
                    'import fitz, json, re as _re\n' +
                    'doc = fitz.open(stream=bytes(js_pdf_bytes), filetype="pdf")\n' +
                    'pg = doc[' + pageIdx + ']\n' +
                    'clip = ' + (clipRect ? 'fitz.Rect(' + clipRect[0] + ',' + clipRect[1] + ',' + clipRect[2] + ',' + clipRect[3] + ')' : 'pg.rect') + '\n' +
                    'hint_rects_raw = ' + _hintsJson + '\n' +
                    'hint_rects = [fitz.Rect(h) for h in hint_rects_raw]\n' +
                    'drawings = pg.get_drawings()\n' +
                    'for di, d in enumerate(drawings[:3]):\n' +
                    '    dr = fitz.Rect(d["rect"])\n' +
                    '    items = d.get("items",[])\n' +
                    '    print(f"[DBG-D{di}] w={dr.width:.1f} h={dr.height:.1f} items={len(items)} fill={d.get(\'fill\')} color={d.get(\'color\')}")\n' +
                    '    for ii,it in enumerate(items[:2]):\n' +
                    '        print(f"  item{ii}: type={it[0]} rest={repr(it[1:])}")\n' +
                    'h_lines = []\n' +
                    'path_rects = []\n' +
                    'large_rects = []\n' +
                    'for d in drawings:\n' +
                    '    dr = fitz.Rect(d["rect"])\n' +
                    '    if not dr.intersects(clip): continue\n' +
                    '    dw = dr.width; dh = dr.height\n' +
                    '    if dh <= 5 and dw > 15: h_lines.append(dr); continue\n' +
                    '    if 3 < dw <= 30 and 3 < dh <= 30: path_rects.append(dr); continue\n' +
                    '    if 30 < dw <= 500 and 5 < dh <= 50: large_rects.append(dr); continue\n' +
                    '    for it in d.get("items",[]):\n' +
                    '        kind = it[0]\n' +
                    '        if kind == "re":\n' +
                    '            r2 = fitz.Rect(it[1])\n' +
                    '            if r2.intersects(clip):\n' +
                    '                if r2.height <= 5 and r2.width > 15: h_lines.append(r2)\n' +
                    '                elif 3 < r2.width <= 30 and 3 < r2.height <= 30: path_rects.append(r2)\n' +
                    '                elif 30 < r2.width <= 500 and 5 < r2.height <= 50: large_rects.append(r2)\n' +
                    '        elif kind == "l":\n' +
                    '            try:\n' +
                    '                p1 = it[1]; p2 = it[2]\n' +
                    '                lw = abs(p2[0]-p1[0]); lh = abs(p2[1]-p1[1])\n' +
                    '                if lh <= 2 and lw > 15:\n' +
                    '                    lr = fitz.Rect(min(p1[0],p2[0]),min(p1[1],p2[1]),max(p1[0],p2[0]),max(p1[1],p2[1]))\n' +
                    '                    if lr.intersects(clip): h_lines.append(lr)\n' +
                    '            except: pass\n' +
                    'print(f"[ALIOTH-HEU] drawings={len(drawings)} path_lines={len(h_lines)} path_rects={len(path_rects)}")\n' +
                    'hint_fields = []\n' +
                    'for hr in hint_rects:\n' +
                    '    w=hr.width; h=hr.height\n' +
                    '    if w<=20 and h<=20: ftype="checkbox"\n' +
                    '    elif w<=20 and h<=26: ftype="radio"\n' +
                    '    else: ftype="text"\n' +
                    '    for pr in path_rects:\n' +
                    '        if hr.intersects(pr) and pr.width<=24 and pr.height<=24:\n' +
                    '            ftype="checkbox" if abs(pr.width-pr.height)<5 else "radio"; break\n' +
                    '    hint_fields.append({"label":"campo","fieldType":ftype,"x0":round(hr.x0,1),"y0":round(hr.y0,1),"x1":round(hr.x1,1),"y1":round(hr.y1,1)})\n' +
                    'words = pg.get_text("words")\n' +
                    'print(f"[ALIOTH-HEU] words={len(words)}")\n' +
                    'label_fields = []\n' +
                    'used_lines = set()\n' +
                    'used_rects = set()\n' +
                    'used_lrects = set()\n' +
                    'CB_CHARS = set(["[]","[ ]","\u25a1","\u25a0","\u25fb","\u25fc","\u2610","\u2611","\u2612"])\n' +
                    'RD_CHARS = set(["()","( )","\u25cb","\u25cf","\u25cc","\u25cd"])\n' +
                    'ALL_CB = CB_CHARS | RD_CHARS\n' +
                    'UNDERSCORE_RE = _re.compile(r"^_{3,}$")\n' +
                    'BLANK_RE = _re.compile(r"^[\\s_\\-.]{3,}$")\n' +
                    'def best_label_for(cx, cy, x0_field, words, max_dist=120):\n' +
                    '    best = "campo"; bd = 999\n' +
                    '    for wd in words:\n' +
                    '        wt = wd[4].strip().rstrip(":")\n' +
                    '        if not wt or len(wt)<2 or wt in ALL_CB: continue\n' +
                    '        if UNDERSCORE_RE.match(wt) or BLANK_RE.match(wt): continue\n' +
                    '        wcy=(wd[1]+wd[3])/2; wcx1=wd[2]\n' +
                    '        if abs(wcy-cy)>14: continue\n' +
                    '        dist=x0_field-wcx1\n' +
                    '        if -10 < dist < max_dist and dist < bd: bd=dist; best=wt\n' +
                    '    return best\n' +
                    'for wi, w in enumerate(words):\n' +
                    '    word = w[4].strip()\n' +
                    '    if not word.endswith(":"): continue\n' +
                    '    wx0,wy0,wx1,wy1 = w[0],w[1],w[2],w[3]\n' +
                    '    if not fitz.Rect(wx0,wy0,wx1,wy1).intersects(clip): continue\n' +
                    '    cy = (wy0+wy1)/2\n' +
                    '    lbl = word.rstrip(":")\n' +
                    '    best = None\n' +
                    '    for li, lr in enumerate(h_lines):\n' +
                    '        if li in used_lines: continue\n' +
                    '        lcy = (lr.y0+lr.y1)/2\n' +
                    '        if abs(lcy - cy) < 10 and lr.x0 >= wx0 - 8:\n' +
                    '            if best is None or lr.x0 < best[1].x0: best = (li, lr)\n' +
                    '    if best:\n' +
                    '        li, lr = best; used_lines.add(li)\n' +
                    '        field_h = max(wy1-wy0+4, 10)\n' +
                    '        label_fields.append({"label": lbl, "fieldType": "text","x0": round(lr.x0,1), "y0": round(lr.y1-field_h,1),"x1": round(lr.x1,1), "y1": round(lr.y1+2,1)}); continue\n' +
                    '    best_r = None\n' +
                    '    for ri, rr in enumerate(path_rects):\n' +
                    '        if ri in used_rects: continue\n' +
                    '        rcy = (rr.y0+rr.y1)/2\n' +
                    '        if abs(rcy - cy) < 12 and rr.x0 >= wx0 - 8:\n' +
                    '            if best_r is None or rr.x0 < best_r[1].x0: best_r = (ri, rr)\n' +
                    '    if best_r:\n' +
                    '        ri, rr = best_r; used_rects.add(ri)\n' +
                    '        ftype = "checkbox" if rr.width <= 24 and abs(rr.width-rr.height)<5 else "text"\n' +
                    '        label_fields.append({"label": lbl, "fieldType": ftype,"x0": round(rr.x0,1), "y0": round(rr.y0,1),"x1": round(rr.x1,1), "y1": round(rr.y1,1)}); continue\n' +
                    '    best_lr = None\n' +
                    '    for lri, lrr in enumerate(large_rects):\n' +
                    '        if lri in used_lrects: continue\n' +
                    '        lrcy = (lrr.y0+lrr.y1)/2\n' +
                    '        if abs(lrcy - cy) < 12 and lrr.x0 >= wx0 - 8:\n' +
                    '            if best_lr is None or lrr.x0 < best_lr[1].x0: best_lr = (lri, lrr)\n' +
                    '    if best_lr:\n' +
                    '        lri, lrr = best_lr; used_lrects.add(lri)\n' +
                    '        label_fields.append({"label": lbl, "fieldType": "text","x0": round(lrr.x0,1), "y0": round(lrr.y0,1),"x1": round(lrr.x1,1), "y1": round(lrr.y1,1)})\n' +
                    'for w in words:\n' +
                    '    word = w[4].strip()\n' +
                    '    wx0,wy0,wx1,wy1 = w[0],w[1],w[2],w[3]\n' +
                    '    if not fitz.Rect(wx0,wy0,wx1,wy1).intersects(clip): continue\n' +
                    '    cx=(wx0+wx1)/2; cy2=(wy0+wy1)/2\n' +
                    '    if word in CB_CHARS:\n' +
                    '        lbl2 = best_label_for(cx,cy2,wx0,words,max_dist=80)\n' +
                    '        label_fields.append({"label":lbl2,"fieldType":"checkbox","x0":round(wx0,1),"y0":round(wy0,1),"x1":round(wx1,1),"y1":round(wy1,1)})\n' +
                    '    elif word in RD_CHARS:\n' +
                    '        lbl2 = best_label_for(cx,cy2,wx0,words,max_dist=80)\n' +
                    '        label_fields.append({"label":lbl2,"fieldType":"radio","x0":round(wx0,1),"y0":round(wy0,1),"x1":round(wx1,1),"y1":round(wy1,1)})\n' +
                    '    elif UNDERSCORE_RE.match(word) and fitz.Rect(wx0,wy0,wx1,wy1).intersects(clip):\n' +
                    '        lbl2 = best_label_for(cx,cy2,wx0,words,max_dist=150)\n' +
                    '        label_fields.append({"label":lbl2,"fieldType":"text","x0":round(wx0,1),"y0":round(wy0,1),"x1":round(wx1,1),"y1":round(wy1,1)})\n' +
                    'for ri, rr in enumerate(path_rects):\n' +
                    '    if ri in used_rects: continue\n' +
                    '    scx = (rr.x0+rr.x1)/2; scy = (rr.y0+rr.y1)/2\n' +
                    '    already = any(abs((f["x0"]+f["x1"])/2-scx)<6 and abs((f["y0"]+f["y1"])/2-scy)<6 for f in label_fields)\n' +
                    '    if already: continue\n' +
                    '    ftype = "checkbox" if rr.width <= 24 and abs(rr.width-rr.height)<5 else ("radio" if rr.width<=24 else "text")\n' +
                    '    lbl2 = best_label_for(scx,scy,rr.x0,words)\n' +
                    '    label_fields.append({"label": lbl2, "fieldType": ftype,"x0":round(rr.x0,1),"y0":round(rr.y0,1),"x1":round(rr.x1,1),"y1":round(rr.y1,1)})\n' +
                    'for lri, lrr in enumerate(large_rects):\n' +
                    '    if lri in used_lrects: continue\n' +
                    '    scx=(lrr.x0+lrr.x1)/2; scy=(lrr.y0+lrr.y1)/2\n' +
                    '    already = any(abs((f["x0"]+f["x1"])/2-scx)<10 and abs((f["y0"]+f["y1"])/2-scy)<6 for f in label_fields)\n' +
                    '    if already: continue\n' +
                    '    lbl2 = best_label_for(scx,scy,lrr.x0,words)\n' +
                    '    label_fields.append({"label": lbl2, "fieldType": "text","x0":round(lrr.x0,1),"y0":round(lrr.y0,1),"x1":round(lrr.x1,1),"y1":round(lrr.y1,1)})\n' +
                    'all_fields = hint_fields + label_fields\n' +
                    'print(f"[ALIOTH-HEU] total_fields={len(all_fields)}")\n' +
                    'doc.close()\n' +
                    'json.dumps(all_fields)';

                try {
                    var raw = await PythonManager.run(pyCode, { js_pdf_bytes: Array.from(new Uint8Array(src.buffer)) });
                    if (!raw) return [];
                    var parsed = JSON.parse(String(raw));
                    return parsed.map(function(f) {
                        return {
                            label: f.label || 'Campo',
                            fieldType: f.fieldType || 'text',
                            bbox: [f.x0, f.y0, f.x1, f.y1],
                            groupName: null,
                            options: [],
                            _fromHeuristic: true
                        };
                    }).filter(function(f) {
                        var b = f.bbox; return (b[2]-b[0]) > 3 && (b[3]-b[1]) > 1;
                    });
                } catch(e) {
                    console.warn('Heuristic detect error:', e.message);
                    return [];
                }
            },

            _ttfMergeFields: function (aiFields, heuFields) {
                // Para cada campo heurístico, buscar match IA solapado > 40%
                var merged = [];
                var usedAI = new Set();
                heuFields.forEach(function(h) {
                    var bh = h.bbox;
                    var bestAI = null, bestOverlap = 0;
                    aiFields.forEach(function(a, ai) {
                        if (usedAI.has(ai)) return;
                        var ba = a.bbox;
                        var ix0=Math.max(bh[0],ba[0]),iy0=Math.max(bh[1],ba[1]),ix1=Math.min(bh[2],ba[2]),iy1=Math.min(bh[3],ba[3]);
                        if (ix1<=ix0||iy1<=iy0) return;
                        var inter=(ix1-ix0)*(iy1-iy0);
                        var areaH=(bh[2]-bh[0])*(bh[3]-bh[1]);
                        var ov = areaH > 0 ? inter/areaH : 0;
                        if (ov > bestOverlap) { bestOverlap = ov; bestAI = ai; }
                    });
                    if (bestAI !== null && bestOverlap > 0.20) {
                        // Match: usar bbox heurístico (preciso) + label/tipo IA (semántico)
                        var a = aiFields[bestAI];
                        usedAI.add(bestAI);
                        merged.push({
                            label: a.label || h.label,
                            fieldType: a.fieldType || h.fieldType,
                            bbox: h.bbox,
                            groupName: a.groupName || null,
                            options: a.options || []
                        });
                    } else {
                        // Sin match IA: usar heurístico tal cual
                        merged.push(h);
                    }
                });
                // Campos IA sin match heurístico con label claro -> incluir
                aiFields.forEach(function(a, ai) {
                    if (usedAI.has(ai)) return;
                    var lbl = (a.label || '').trim();
                    if (lbl && lbl !== 'Campo' && lbl !== 'campo') merged.push(a);
                });
                return merged;
            },

            _ttfRunFreeFormAnalysis: async function (src, page) {
                // Store src for paint-hint re-runs
                var doc = this.getDoc && this.getDoc();
                if (doc) doc._pdfSrc = src;
                var statusEl = document.getElementById('ttf-status');
                var ffRetryBtn = document.getElementById('ttf-btn-ff-retry');
                var previewEl = document.getElementById('ttf-fields-preview');
                var svg = document.getElementById('ttf-overlay-svg');
                if (svg) svg.innerHTML = '';
                previewEl.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">Analizando con vision IA...</div>';
                if (ffRetryBtn) ffRetryBtn.style.display = 'none';
                document.getElementById('ttf-btn-generate').style.display = 'none';

                var pageW = 595, pageH = 842;
                try {
                    var pdfDoc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    var pdfPage = await pdfDoc.getPage((page.pageIndex || 0) + 1);
                    var vp = pdfPage.getViewport({ scale: 1.0 });
                    pageW = vp.width; pageH = vp.height;
                    this._ttfPageW = pageW; this._ttfPageH = pageH;
                } catch(e) {}

                var pageTextBlocks = '';
                if (window.PythonManager && PythonManager.isLoaded) {
                    try {
                        var pyResult = await PythonManager.run(
                            'import fitz,json\ndoc=fitz.open(stream=bytes(js_pdf_bytes),filetype="pdf")\npg=doc[' + (page.pageIndex||0) + ']\nblocks=pg.get_text("blocks")\nresult=json.dumps([{"t":b[4].strip()[:80],"x0":round(b[0],1),"y0":round(b[1],1),"x1":round(b[2],1),"y1":round(b[3],1)} for b in blocks if b[4].strip()][:150])\npg.close();doc.close()\nresult',
                            { js_pdf_bytes: Array.from(new Uint8Array(src.buffer)) }
                        );
                        if (pyResult) pageTextBlocks = String(pyResult).slice(0, 4000);
                    } catch(e) {}
                }

                var imgB64 = this._ttfFFLastImgB64;
                if (!imgB64) { statusEl.textContent = 'Sin imagen de pagina'; return; }

                statusEl.textContent = 'Analizando formulario (IA + heuristica)...';
                // Correr heurística y visión IA en paralelo
                var heuPromise = this._ttfHeuristicDetect(src, page, this._ttfClipRect);
                var nativeW = this._ttfPageNativeW || 800;
                var nativeH = this._ttfPageNativeH || 1000;

                          var clipInfo = this._ttfClipRect
                    ? 'AREA RECORTADA: analiza solo la region visible (coordenadas normalizadas relativas a esta imagen recortada).'
                    : 'PAGINA COMPLETA: analiza toda la imagen.';

                var prompt = 'Eres un extractor experto de campos de formularios PDF.\n' +
                    clipInfo + '\n' +
                    '\nREGLAS ESTRICTAS:\n' +
                    '1. INCLUIR SOLO zonas donde el usuario escribe/selecciona: lineas de escritura (___), cuadros vacios rect, checkboxes [ ], circulos radio ( ), celdas vacias de tabla\n' +
                    '2. EXCLUIR: texto impreso, titulos, encabezados, instrucciones, logos, lineas decorativas, separadores de seccion\n' +
                    '3. CADA campo interactivo UNICO: no duplicar si aparece en varias filas; cada opcion radio/checkbox es un campo separado\n' +
                    '4. bbox_norm cubre EXACTAMENTE el area de escritura (linea, cuadro), NO el label de texto adyacente\n' +
                    '5. Checkboxes y radio: bbox_norm pequeno ~[x,y,x+0.03,y+0.03], groupName igual para opciones del mismo grupo\n' +
                    '6. Campos de texto con linea: bbox_norm incluye toda la linea de escritura (pueden ser anchos)\n' +
                    '7. Si hay tabla con filas repetidas, reporta UNA sola instancia del campo template\n' +
                    '\nTIPOS: text=linea/cuadro/celda escritura, checkbox=casilla booleana, radio=opcion exclusiva, dropdown=lista desplegable\n' +
                    'COORDENADAS bbox_norm [0.0-1.0]: top-left(0,0) bottom-right(1,1). pageW=' + pageW.toFixed(0) + 'pt pageH=' + pageH.toFixed(0) + 'pt\n' +
                    '\nEJEMPLO:\n' +
                    '[{\"label\":\"Nombre\",\"fieldType\":\"text\",\"bbox_norm\":[0.12,0.08,0.88,0.11],\"groupName\":null},\n' +
                    '{\"label\":\"Fecha nacimiento\",\"fieldType\":\"text\",\"bbox_norm\":[0.12,0.14,0.38,0.17],\"groupName\":null},\n' +
                    '{\"label\":\"Masculino\",\"fieldType\":\"radio\",\"bbox_norm\":[0.12,0.20,0.15,0.23],\"groupName\":\"sexo\"},\n' +
                    '{\"label\":\"Femenino\",\"fieldType\":\"radio\",\"bbox_norm\":[0.22,0.20,0.25,0.23],\"groupName\":\"sexo\"},\n' +
                    '{\"label\":\"Acepta terminos\",\"fieldType\":\"checkbox\",\"bbox_norm\":[0.12,0.30,0.15,0.33],\"groupName\":null}]\n' +
                    '\nTexto PDF extraido (usa para identificar labels y posicion):\n' +
                    pageTextBlocks.slice(0, 1200) + '\n' +
                    '\nDevuelve SOLO el JSON array valido, sin markdown ni explicaciones:';

                var raw, fields = null;
                try {
                    raw = await this._callVisionWithFallback(imgB64, prompt);
                    if (!raw) throw new Error('Sin respuesta de IA');
                    var text = raw.trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
                    text = text.replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/,\s*([\}\]])/g,'$1');
                    text = text.replace(/(\[\s*[\d.,\s]+),\s*"([a-zA-Z])/g, '$1],"$2');
                    // Extract JSON array start
                    var arrStart = text.indexOf('[');
                    if (arrStart > 0) text = text.slice(arrStart);
                    var parsed;
                    try { parsed = JSON.parse(text); }
                    catch(e1) {
                        // Robust fallback: extract individual objects via regex
                        var objs = [];
                        var objRx = /\{[^{}]*\}/g, m;
                        while ((m = objRx.exec(text)) !== null) {
                            try { objs.push(JSON.parse(m[0])); } catch(ex) {}
                        }
                        if (objs.length > 0) { parsed = objs; }
                        else {
                            // Last resort: truncate to last complete object
                            var lastBrace = text.lastIndexOf('}');
                            if (lastBrace === -1) throw new Error('JSON irreparable: ' + e1.message);
                            var truncated = text.substring(0, lastBrace + 1).replace(/,\s*$/, '') + ']';
                            try { parsed = JSON.parse(truncated); }
                            catch(e2) { throw new Error('JSON irreparable: ' + e2.message); }
                        }
                    }
                    fields = parsed.map(function(f) {
                        var b = f.bbox_norm || f.bbox || [0,0,0.1,0.05];
                        if (b[2] > 1 || b[3] > 1) { b = [b[0]/nativeW, b[1]/nativeH, b[2]/nativeW, b[3]/nativeH]; }
                        b = b.map(function(v){ return Math.max(0, Math.min(1, v)); });
                        return {
                            label: f.label || f.name || 'Campo',
                            fieldType: f.fieldType || f.type || 'text',
                            bbox: [b[0]*pageW, b[1]*pageH, b[2]*pageW, b[3]*pageH],
                            groupName: f.groupName || null,
                            options: f.options || []
                        };
                    }).filter(function(f) {
                        var b = f.bbox; return (b[2]-b[0]) > 2 && (b[3]-b[1]) > 1;
                    });
                } catch(e) {
                    console.warn('IA falló, intentando heuristica + PyMuPDF:', e.message);
                     statusEl.textContent = 'Buscando campos en el PDF…';
                    fields = null;
                }

                // Esperar heurística y fusionar
                var heuFields = [];
                try { heuFields = await heuPromise; } catch(e) { heuFields = []; }

                if (fields && fields.length > 0 && heuFields.length > 0) {
                    // Ambos disponibles: fusionar
                    fields = this._ttfMergeFields(fields, heuFields);
                    statusEl.textContent = fields.length + ' campo(s) detectado(s).';
                } else if (heuFields.length > 0 && (!fields || fields.length === 0)) {
                    // Solo heurística
                    fields = heuFields;
                    statusEl.textContent = fields.length + ' campo(s) detectado(s). Revisa los resultados.';
                } else if (!fields || fields.length === 0) {
                    // Ninguno — intentar PyMuPDF nativo
                    fields = await this._ttfDetectFieldsPyMuPDF(src, page, pageW, pageH);
                    if (!fields || fields.length === 0) {
                        statusEl.textContent = 'No se detectaron campos.';
                        previewEl.innerHTML = '<p style="color:#f87171;padding:12px;font-size:11px;">No se detectaron campos en este PDF.</p>';
                        if (ffRetryBtn) ffRetryBtn.style.display = 'inline-flex';
                        return;
                    }
                    statusEl.textContent = fields.length + ' campo(s) detectado(s).';
                }

                if (!Array.isArray(fields) || fields.length === 0) {
                    statusEl.textContent = 'No se detectaron campos.';
                    previewEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Sin campos. Prueba Re-analizar IA.</p>';
                    if (ffRetryBtn) ffRetryBtn.style.display = 'inline-flex';
                    return;
                }

                // 0. Filtrar campos absurdamente grandes (>90% del ancho O >20% del alto = no es campo real)
                fields = fields.filter(function(f) {
                    var b = f.bbox;
                    var w = b[2]-b[0], h = b[3]-b[1];
                    return w < pageW * 0.9 && h < pageH * 0.20 && w > 3 && h > 1;
                });

                // 1. Filtrar campos fuera del área visible (clip)
                if (this._ttfClipRect) {
                    var cl = this._ttfClipRect; // [x0,y0,x1,y1] en PDF pts
                    fields = fields.filter(function(f) {
                        var b = f.bbox;
                        // centro del campo debe estar dentro del clip
                        var cx = (b[0]+b[2])/2, cy = (b[1]+b[3])/2;
                        return cx >= cl[0] && cx <= cl[2] && cy >= cl[1] && cy <= cl[3];
                    });
                }

                // 2. Dedup por solapamiento >65%
                var deduped = [];
                fields.forEach(function(f) {
                    var b = f.bbox;
                    var skip = deduped.some(function(g) {
                        var a = g.bbox;
                        var ix0=Math.max(b[0],a[0]),iy0=Math.max(b[1],a[1]),ix1=Math.min(b[2],a[2]),iy1=Math.min(b[3],a[3]);
                        if (ix1<=ix0||iy1<=iy0) return false;
                        var inter=(ix1-ix0)*(iy1-iy0), areaF=(b[2]-b[0])*(b[3]-b[1]);
                        return areaF>0 && inter/areaF > 0.65;
                    });
                    if (!skip) deduped.push(f);
                });
                fields = deduped;

                // 3. Dedup por proximidad Y: SOLO para campos de texto (no radio/checkbox — múltiples en misma fila son válidos)
                var yGroups = [];
                fields = fields.filter(function(f) {
                    if (f.fieldType === 'radio' || f.fieldType === 'checkbox') return true;
                    var cy = (f.bbox[1]+f.bbox[3])/2;
                    var lbl = (f.label||'').toLowerCase().trim();
                    var isDup = yGroups.some(function(g) {
                        return g.lbl === lbl && Math.abs(g.cy - cy) < 10;
                    });
                    if (!isDup) yGroups.push({lbl: lbl, cy: cy});
                    return !isDup;
                });

                // 4. Dedup por label exacto: SOLO para texto/dropdown con labels semánticos reales (no genéricos como "campo")
                var labelSeen = {};
                var genericLabels = new Set(['campo', 'text field', 'textfield', '']);
                fields = fields.filter(function(f) {
                    if (f.fieldType === 'radio' || f.fieldType === 'checkbox') return true;
                    var key = (f.label || '').toLowerCase().trim();
                    if (genericLabels.has(key)) return true; // No deduplicar labels genéricos
                    if (labelSeen[key]) return false;
                    labelSeen[key] = true;
                    return true;
                });

                var syntheticTable = {
                    bbox: [0, 0, pageW, pageH],
                    rows: fields.length, cols: 1,
                    data: fields.map(function(f){ return [f.label]; }),
                    cellBboxes: fields.map(function(f){ return [f.bbox]; }),
                    _isFreeForm: true
                };
                var syntheticFields = fields.map(function(f, i){ return {
                    col: 0, label: f.label, fieldType: f.fieldType,
                    placeholder: '', options: f.options||[], groupName: f.groupName||null, include: true
                }; });

                this._ttfTables[0] = syntheticTable;
                this._ttfAIResults[0] = syntheticFields;
                this._ttfCurrentTableIdx = 0;

                this._ttfRenderFFFieldsList(syntheticFields);
                this._ttfRenderOverlaySVG(syntheticFields, syntheticTable);

                statusEl.textContent = fields.length + ' campo(s) detectados. Ajusta y presiona Generar Campos.';
                document.getElementById('ttf-options').style.display = 'block';
                document.getElementById('ttf-btn-generate').style.display = 'inline-flex';
                if (ffRetryBtn) ffRetryBtn.style.display = 'inline-flex';
                // Mostrar panel de ajuste solo en Formato Libre
                var adjPanel = document.getElementById('ttf-ff-adjust-panel');
                if (adjPanel) adjPanel.style.display = this._ttfMode === 'freeform' ? 'block' : 'none';
            },

                        _ttfAdjustWithAI: async function () {
                var input = document.getElementById('ttf-ff-adjust-input');
                var statusEl = document.getElementById('ttf-ff-adjust-status');
                var instruction = input ? input.value.trim() : '';
                if (!instruction) return;
                if (!this._ttfTables[0] || !this._ttfTables[0]._isFreeForm) return;
                statusEl.textContent = 'Ajustando...';
                var currentFields = this._ttfTables[0].cellBboxes.map(function(cb, i) {
                    var sf = this._ttfAIResults[0][i];
                    return { label: sf.label, fieldType: sf.fieldType, bbox: cb[0], groupName: sf.groupName || null };
                }.bind(this));
                var doc = this.getDoc();
                var page = doc && doc.pages[doc.currentIndex];
                var src = page && doc.sources[page.sourceId];
                var pageW = 595, pageH = 842;
                try {
                    var pd = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    var pp = await pd.getPage((page.pageIndex||0)+1);
                    var vp = pp.getViewport({ scale: 1.0 });
                    pageW = vp.width; pageH = vp.height;
                } catch(e) {}
      var prompt = 'Eres un editor de campos de formulario PDF. Ajusta SOLO label y fieldType segun la instruccion. NO cambies los bbox ni el orden.\n' +
                    'Instruccion: "' + instruction.replace(/'/g, "\'") + '"\n' +
                    'Campos: ' + JSON.stringify(currentFields) + '\n' +
                    'Devuelve SOLO el JSON array con los mismos bbox originales. Sin markdown.';
                try {
                    var raw = await this._callGroqWithFallback([{ role: 'user', content: prompt }], 2000);
                    var text = raw.trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
                    var start = text.indexOf('['); if (start > 0) text = text.slice(start);
                    var parsed = JSON.parse(text);
                    var syntheticTable = {
                        bbox: [0,0,pageW,pageH], rows: parsed.length, cols: 1,
                        data: parsed.map(function(f){ return [f.label]; }),
                        cellBboxes: parsed.map(function(f){ return [f.bbox || [0,0,50,15]]; }),
                        _isFreeForm: true
                    };
                    var syntheticFields = parsed.map(function(f) {
                        return { col:0, label:f.label, fieldType:f.fieldType||'text', placeholder:'', options:[], groupName:f.groupName||null, include:true };
                    });
                    this._ttfTables[0] = syntheticTable;
                    this._ttfAIResults[0] = syntheticFields;
                    this._ttfRenderFFFieldsList(syntheticFields);
                    this._ttfRenderOverlaySVG(syntheticFields, syntheticTable);
                    statusEl.textContent = '\u2705 ' + parsed.length + ' campo(s) ajustados.';
                    if (input) input.value = '';
                } catch(e) {
                    statusEl.textContent = '\u274c Error: ' + e.message;
                }
            },

                        _ttfFreeFormRetry: async function () {
                this._ttfPaintHints = []; // Clear paint hints on manual re-analyze
                // Debounce 2s
                var now = Date.now();
                if (this._ttfLastRetry && now - this._ttfLastRetry < 2000) { this.showToast('Espera un momento...'); return; }
                this._ttfLastRetry = now;
                var doc = this.getDoc();
                var page = doc && doc.pages[doc.currentIndex];
                var src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) return;
                var svg = document.getElementById('ttf-overlay-svg');
                if (svg) svg.innerHTML = '';
                this._ttfDragOffsets = {}; this._ttfSelectedKeys = new Set();
                await this._ttfRunFreeFormAnalysis(src, page);
            },

            _ttfRenderFFFieldsList: function (fields) {
                var previewEl = document.getElementById('ttf-fields-preview');
                if (!previewEl) return;
                previewEl.innerHTML = fields.map(function(f, i){
                    return '<div style="display:flex;align-items:center;gap:5px;padding:4px 0;border-bottom:1px solid var(--border);">' +
                        '<input type="checkbox" ' + (f.include!==false?'checked':'') + ' onchange="app._ttfAIResults[0]['+i+'].include=this.checked;app._ttfRenderOverlaySVGCurrent();" style="flex-shrink:0;">' +
                        '<input type="text" value="' + (f.label||'').replace(/"/g,'&quot;') + '" style="flex:1;background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border);border-radius:4px;color:var(--text-main);font-size:10px;padding:2px 5px;" onchange="app._ttfAIResults[0]['+i+'].label=this.value;app._ttfRenderOverlaySVGCurrent();">' +
                        '<select onchange="app._ttfAIResults[0]['+i+'].fieldType=this.value;app._ttfRenderOverlaySVGCurrent();" style="background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border);border-radius:4px;color:var(--text-main);font-size:10px;padding:2px 3px;">' +
                        ['text','checkbox','radio','dropdown'].map(function(tp){ return '<option value="'+tp+'"'+(f.fieldType===tp?' selected':'')+'>'+tp+'</option>'; }).join('') +
                        '</select></div>';
                }).join('');
            },

            _callVisionWithFallback: async function (imgB64, prompt, plainText = false) {
                var geminiKey = this.geminiApiKey;
                var geminiModels = ['auto-vision'];
                var failures = [];
                for (var mi = 0; mi < geminiModels.length; mi++) {
                    var model = geminiModels[mi];
                    try {
                        var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + geminiKey;
                        var resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{ parts:[{ inline_data:{ mime_type:'image/png', data:imgB64 }},{ text:prompt }]}]}) });
                        if (!resp.ok) { failures.push('Gemini HTTP ' + resp.status); continue; }
                        var data = await resp.json();
                        var t = data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0]&&data.candidates[0].content.parts[0].text;
                        if (t) return t;
                    } catch(e) { failures.push('Gemini: ' + (e.name || 'error')); }
                }
                // El proxy elige modelos activos con entrada de imagen.
                var groqVisionModels = ['auto-vision'];
                var groqKeys = this._groqKeys || [];
                for (var gi = 0; gi < groqVisionModels.length; gi++) {
                    for (var gki = 0; gki < Math.max(groqKeys.length, 1); gki++) {
                        try {
                            var headers = { 'Content-Type': 'application/json' };
                            if (groqKeys[gki]) headers.Authorization = 'Bearer ' + groqKeys[gki];
                            var gresp = await fetch('/groq/v1/chat/completions', {
                                method: 'POST',
                                headers: headers,
                                body: JSON.stringify({
                                    model: groqVisionModels[gi],
                                    max_tokens: 2000,
                                    messages: [
                                        { role: 'system', content: plainText
                                            ? 'Responde con texto claro en el idioma solicitado. No uses JSON ni bloques de código.'
                                            : 'You are a JSON-only API. You MUST respond with a valid JSON array and nothing else. No markdown, no explanations, no comments. Start your response with [ and end with ].' },
                                        { role: 'user', content: [
                                            { type: 'text', text: prompt },
                                            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + imgB64 } }
                                        ]}
                                    ]
                                })
                            });
                            if (!gresp.ok) { failures.push('Groq HTTP ' + gresp.status); continue; }
                            var gdata = await gresp.json();
                            var gt = gdata.choices&&gdata.choices[0]&&gdata.choices[0].message&&gdata.choices[0].message.content;
                            if (gt) return gt;
                        } catch(e) { failures.push('Groq: ' + (e.name || 'error')); }
                    }
                }
                throw new Error('Todos los proveedores de vision fallaron: ' + failures.join('; '));
            },

            /**
             * Resalta visualmente una tabla en el canvas usando sus coordenadas PDF.
             * Las coordenadas vienen de PyMuPDF (Y-down desde arriba, en puntos PDF).
             * Se convierte al sistema de coordenadas del overlay (Y-down desde canvas top, escalado).
             * @param {Array} bbox   - [x0, y0, x1, y1] en puntos PDF (Y-down desde arriba)
             * @param {number} pageH - Altura de la página en puntos PDF
             */
            autoRedactAI: async function (type) {
                if (typeof this.showSensitiveReview === 'function') return this.showSensitiveReview(type);
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }

                this.toggleLoader(true, `Python: Escaneando y tachando ${type}s...`);
                try {
                    const redactedBuffer = await PythonManager.autoRedactPattern(src.buffer, type);
                    const blob = new Blob([redactedBuffer], { type: 'application/pdf' });
                    const file = new File([blob], `redactado_${type}_` + (doc.name || "doc.pdf"), { type: 'application/pdf' });
                    await this.openFile(file);
                    this.showToast(`✅ Redacción automática de ${type}s completada`);
                } catch (e) {
                    this.showToast('❌ Error en redacción AI: ' + e.message);
                }
                this.toggleLoader(false);
            },

            groqApiKey: (function () {
                const stored = localStorage.getItem('groq_api_key');
                if (stored && stored.trim()) return stored;
                return '';
            })(),

            huggingfaceApiKey: (function () {
                const stored = localStorage.getItem('huggingface_api_key');
                if (stored && stored.trim()) return stored;
                return '';
            })(),

            openrouterApiKey: (function () {
                const stored = localStorage.getItem('openrouter_api_key');
                if (stored && stored.trim()) return stored;
                return '';
            })(),

            nvidiaApiKey: (function () {
                const stored = localStorage.getItem('nvidia_api_key');
                if (stored && stored.trim()) return stored;
                return '';
            })(),

            // Lista de todas las Groq keys disponibles
            _groqKeys: (function () {
                const userKey = localStorage.getItem('groq_api_key');
                const keys = [];
                if (userKey && userKey.trim()) keys.push(userKey.trim());
                // Inyectado por _proxy.py desde config.ini al servir el HTML (array JSON)
                try {
                    const injected = __GROQ_KEYS_INJECTED__;
                    if (Array.isArray(injected)) injected.forEach(function(k){ if (k && k.trim()) keys.push(k.trim()); });
                } catch(e) {}
                return keys;
            })(),

            // Modelos Groq en orden de preferencia
            _groqModels: [
                'llama-3.3-70b-versatile',
                'llama-3.1-8b-instant',
                'gemma2-9b-it'
            ],

            // Llama a Groq con fallback entre keys y modelos; si todo falla usa Gemini
            _callGroqWithFallback: async function (messages, maxTokens = 1000) {
                const keys = this._groqKeys;
                const models = this._groqModels;

                for (const key of keys) {
                    let keyFailed = false;
                    for (const model of models) {
                        try {
                            const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                                body: JSON.stringify({ model, max_tokens: maxTokens, messages })
                            });
                            if (resp.status === 401 || resp.status === 403) { keyFailed = true; break; } // key inválida → siguiente key
                            if (!resp.ok) continue; // otro error → siguiente modelo
                            const data = await resp.json();
                            const content = data.choices?.[0]?.message?.content;
                            if (content) { console.log(`✅ Groq OK: ${model}`); return content; }
                        } catch(e) { console.warn(`⚠️ Groq ${model} falló:`, e.message); }
                    }
                    if (keyFailed) continue;
                }

                // Fallback: OpenRouter (OpenAI-compatible)
                if (this.openrouterApiKey) {
                    try {
                        console.log('⚠️ Intentando OpenRouter como fallback...');
                        const orResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.openrouterApiKey },
                            body: JSON.stringify({ model: 'meta-llama/llama-3.3-70b-instruct', max_tokens: maxTokens, messages })
                        });
                        if (orResp.ok) {
                            const orData = await orResp.json();
                            const orContent = orData.choices?.[0]?.message?.content;
                            if (orContent) { console.log('✅ OpenRouter fallback OK'); return orContent; }
                        }
                    } catch(e) { console.warn('⚠️ OpenRouter fallback falló:', e.message); }
                }

                // Fallback: NVIDIA NIM (OpenAI-compatible)
                if (this.nvidiaApiKey) {
                    try {
                        console.log('⚠️ Intentando NVIDIA NIM como fallback...');
                        const nvResp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.nvidiaApiKey },
                            body: JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', max_tokens: maxTokens, messages })
                        });
                        if (nvResp.ok) {
                            const nvData = await nvResp.json();
                            const nvContent = nvData.choices?.[0]?.message?.content;
                            if (nvContent) { console.log('✅ NVIDIA NIM fallback OK'); return nvContent; }
                        }
                    } catch(e) { console.warn('⚠️ NVIDIA NIM fallback falló:', e.message); }
                }

                // Fallback: HuggingFace Inference API
                if (this.huggingfaceApiKey) {
                    try {
                        console.log('⚠️ Intentando HuggingFace como fallback...');
                        const hfResp = await fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.huggingfaceApiKey },
                            body: JSON.stringify({ max_tokens: maxTokens, messages })
                        });
                        if (hfResp.ok) {
                            const hfData = await hfResp.json();
                            const hfContent = hfData.choices?.[0]?.message?.content;
                            if (hfContent) { console.log('✅ HuggingFace fallback OK'); return hfContent; }
                        }
                    } catch(e) { console.warn('⚠️ HuggingFace fallback falló:', e.message); }
                }

                // Fallback final: Gemini
                console.warn('⚠️ Todos los intentos fallaron. Usando Gemini como fallback...');
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.geminiApiKey}`;
                const userMsg = messages.find(m => m.role === 'user')?.content || '';
                const gresp = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: userMsg }] }] })
                });
                if (!gresp.ok) throw new Error(`Gemini también falló: ${gresp.status}`);
                const gdata = await gresp.json();
                const gcontent = gdata.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!gcontent) throw new Error('Gemini: sin respuesta');
                console.log('✅ Gemini fallback OK');
                return gcontent;
            },
            aiPanelOpen: false,
            geminiApiKey: (function () {
                // Check localStorage for user-configured API key
                const stored = localStorage.getItem('gemini_api_key');
                if (stored && stored.trim()) {
                    return stored.trim();
                }
                return '';
            })(),

            toggleAIPanel: function () {
                console.log('🤖 toggleAIPanel llamado');

                // Prevenir llamadas múltiples rápidas
                if (this._toggling) {
                    console.log('⏳ Ya se está procesando...');
                    return;
                }

                const panel = document.getElementById('ai-panel');
                const overlay = document.getElementById('ai-modal-overlay');
                const indicator = document.getElementById('ai-indicator');

                if (!panel || !overlay) {
                    console.error('❌ Panel o overlay no encontrado!');
                    return;
                }

                this._toggling = true;
                this.aiPanelOpen = !this.aiPanelOpen;

                console.log('🎯 Estado nuevo:', this.aiPanelOpen ? 'ABIERTO' : 'CERRADO');

                if (this.aiPanelOpen) {
                    // Mostrar modal centrado
                    overlay.style.display = 'block';

                    // Calcular posición centrada manualmente
                    const viewportWidth = window.innerWidth;
                    const viewportHeight = window.innerHeight;
                    const panelWidth = Math.min(viewportWidth * 0.9, 800);
                    const panelHeight = Math.min(viewportHeight * 0.8, 700);
                    const leftPos = (viewportWidth - panelWidth) / 2;
                    const topPos = (viewportHeight - panelHeight) / 2;

                    // Establecer estilos
                    panel.setAttribute('style', `
                        display: flex !important;
                        position: fixed !important;
                        top: ${topPos}px !important;
                        left: ${leftPos}px !important;
                        width: ${panelWidth}px !important;
                        height: ${panelHeight}px !important;
                        background: #1e2232 !important;
                        border-radius: 16px !important;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.5) !important;
                        z-index: 15001 !important;
                        flex-direction: column !important;
                        border: 2px solid #8b5cf6 !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        pointer-events: auto !important;
                    `);

                    // FORZAR REFLOW - esto obliga al navegador a recalcular
                    void panel.offsetHeight; // Trigger reflow
                    panel.style.display = 'flex'; // Re-aplicar
                    void panel.offsetHeight; // Trigger reflow again

                    console.log('📊 Posición calculada:', {
                        viewportWidth,
                        viewportHeight,
                        panelWidth,
                        panelHeight,
                        leftPos,
                        topPos
                    });

                    // Mutation Observer
                    if (!this._panelObserver) {
                        this._panelObserver = new MutationObserver((mutations) => {
                            mutations.forEach((mutation) => {
                                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                                    console.log('⚠️ ALERTA: El estilo del panel fue modificado!');
                                    console.log('Nuevo estilo:', panel.getAttribute('style'));
                                }
                            });
                        });
                        this._panelObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });
                    }

                    // DEBUGGING después del reflow
                    setTimeout(() => {
                        const computedPanel = window.getComputedStyle(panel);
                        console.log('📊 DEBUG - Estilos del PANEL (después de reflow):');
                        console.log('  display:', computedPanel.display);
                        console.log('  position:', computedPanel.position);
                        console.log('  top:', computedPanel.top);
                        console.log('  left:', computedPanel.left);
                        console.log('  width:', computedPanel.width);
                        console.log('  height:', computedPanel.height);
                        console.log('  z-index:', computedPanel.zIndex);
                        console.log('  visibility:', computedPanel.visibility);
                        console.log('  opacity:', computedPanel.opacity);
                        console.log('📊 Bounding rect del panel:', panel.getBoundingClientRect());
                        console.log('📊 offsetWidth:', panel.offsetWidth);
                        console.log('📊 offsetHeight:', panel.offsetHeight);
                        console.log('📊 clientWidth:', panel.clientWidth);
                        console.log('📊 clientHeight:', panel.clientHeight);
                        console.log('📊 ¿Panel visible en el DOM?', panel.offsetParent !== null);
                        console.log('📊 offsetParent:', panel.offsetParent);

                        // Verificar TODOS los ancestros
                        console.log('🔍 VERIFICANDO ANCESTROS:');
                        let current = panel;
                        let depth = 0;
                        while (current && depth < 10) {
                            const computed = window.getComputedStyle(current);
                            console.log(`  Nivel ${depth}: <${current.tagName}> display=${computed.display}, visibility=${computed.visibility}`);
                            if (current.id) console.log(`    id="${current.id}"`);
                            if (current.className) console.log(`    class="${current.className}"`);
                            current = current.parentElement;
                            depth++;
                        }

                        // Verificar si el panel está realmente en el body
                        console.log('📊 ¿Panel es descendiente del body?', document.body.contains(panel));
                        console.log('📊 Panel.parentElement:', panel.parentElement);
                        console.log('📊 Panel.parentElement.tagName:', panel.parentElement?.tagName);
                    }, 150);

                    if (indicator) indicator.style.display = 'block';
                    console.log('✅ MODAL ABIERTO - centrado en pantalla');
                } else {
                    // Ocultar modal
                    panel.style.display = 'none';
                    overlay.style.display = 'none';

                    if (indicator) indicator.style.display = 'none';
                    console.log('❌ MODAL CERRADO');
                }

                // Liberar el flag después de un delay (protección contra doble click)
                setTimeout(() => { this._toggling = false; }, 500);
            },

            aiQuickAction: function (action) {
                const doc = this.getDoc();
                if (!doc) {
                    this.addAIMessage('bot', '⚠️ Por favor, abre un documento PDF primero.');
                    return;
                }

                const prompts = {
                    'resumir': '📝 Resume este documento de manera concisa, destacando los puntos más importantes.',
                    'analizar': '🔍 Analiza este documento en detalle: estructura, temas principales, y conclusiones.',
                    'extraer': '📊 Extrae los datos más relevantes de este documento en formato estructurado.',
                    'traducir': '🌐 Traduce este documento al inglés manteniendo el formato y estructura.'
                };

                const prompt = prompts[action];
                if (prompt) {
                    document.getElementById('ai-input').value = prompt;
                    this.sendAIMessage();
                }
            },

            sendAIMessage: async function () {
                const input = document.getElementById('ai-input');
                const message = input.value.trim();

                if (!message) return;

                const doc = this.getDoc();
                if (!doc) {
                    this.addAIMessage('bot', '⚠️ Por favor, abre un documento PDF primero para que pueda analizarlo.');
                    return;
                }

                // Agregar mensaje del usuario
                this.addAIMessage('user', message);
                input.value = '';

                // Auto-resize textarea
                input.style.height = 'auto';

                // Mostrar indicador de carga
                const numDocs = this.docs.length;
                const loadingMsg = numDocs > 1
                    ? `⏳ Analizando ${numDocs} documentos...`
                    : '⏳ Procesando...';
                this.addAIMessage('bot', loadingMsg, true);

                try {
                    // ── 🆕 MEJORA 11: Extraer texto con PyMuPDF (orden de lectura real) ──
                    // Antes: PDF.js getTextContent de las primeras 3 páginas → orden incorrecto.
                    // Ahora: PyMuPDF extractDocumentText de TODO el documento, con sort=True.
                    let allExtractedText = '';
                    const docsProcessed = [];

                    for (const document of this.docs) {
                        const firstPage = document.pages[0];
                        if (!firstPage) continue;
                        const sourceId = firstPage.sourceId;
                        const source = document.sources[sourceId];
                        if (!source) continue;

                        let docText = '';

                        // Extracción local con respaldo; no requiere inicializar WASM.
                        if (window.PythonManager?.extractDocumentText && source.buffer) {
                            try {
                                docText = await PythonManager.extractDocumentText(source.buffer) || '';
                                if (docText) console.log(`🐍 PyMuPDF Gemini context: ${docText.length} chars de "${document.name}"`);
                            } catch (pyErr) {
                                console.warn('🐍 PyMuPDF fallback to PDF.js for Gemini:', pyErr);
                                docText = '';
                            }
                        }

                        // Fallback: PDF.js primeras 5 páginas (aumentado de 3)
                        if (!docText) {
                            let pdfDoc = source.doc;
                            if (!pdfDoc && source.buffer && window.pdfjsLib) {
                                try {
                                    pdfDoc = await pdfjsLib.getDocument({ data: source.buffer.slice(0) }).promise;
                                    source.doc = pdfDoc;
                                } catch (loadError) { console.error(`Error cargando ${document.name}:`, loadError); continue; }
                            }
                            if (pdfDoc) {
                                const maxPages = Math.min(5, pdfDoc.numPages);
                                for (let i = 1; i <= maxPages; i++) {
                                    const page = await pdfDoc.getPage(i);
                                    const textContent = await page.getTextContent();
                                    docText += `\nPágina ${i}:\n${textContent.items.map(item => item.str).join(' ')}`;
                                }
                            }
                        }

                        allExtractedText += `\n\n=== DOCUMENTO: ${document.name} ===\n${docText}\n`;
                        docsProcessed.push(document.name);
                    }

                    if (docsProcessed.length === 0) {
                        this.removeLoadingMessage();
                        this.addAIMessage('bot', '⚠️ No se pudo acceder a ningún documento.');
                        return;
                    }

                    // Limitar texto a 20000 caracteres (aumentado de 15000)
                    if (allExtractedText.length > 20000) {
                        allExtractedText = allExtractedText.substring(0, 20000) + '\n\n[... texto truncado por límite de API ...]';
                    }

                    // Llamar a Gemini API - gemini-3.6-flash
                    const response = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.geminiApiKey}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{
                                    parts: [{
                                        text: `Basándote en el siguiente contenido de ${docsProcessed.length} documento(s) PDF:\n\n${allExtractedText}\n\nPregunta del usuario: ${message}\n\nPor favor responde de manera clara y concisa.`
                                    }]
                                }]
                            })
                        }
                    );

                    const data = await response.json();

                    // Remover mensaje de carga
                    this.removeLoadingMessage();

                    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                        const aiResponse = data.candidates[0].content.parts[0].text;
                        this.addAIMessage('bot', aiResponse);
                    } else if (data.error) {
                        this.addAIMessage('bot', `❌ Error: ${data.error.message}\n\nℹ️ Nota: Analizando ${docsProcessed.length} documento(s).`);
                        console.error('Gemini API error:', data.error);
                    } else {
                        this.addAIMessage('bot', '❌ No se pudo obtener una respuesta de la IA.');
                        console.error('Respuesta inesperada:', data);
                    }
                } catch (error) {
                    this.removeLoadingMessage();
                    console.error('Error al llamar a Gemini:', error);
                    this.addAIMessage('bot', `❌ Error al procesar: ${error.message}`);
                }
            },

            addAIMessage: function (type, text, isLoading = false) {
                const chatArea = document.getElementById('ai-chat-area');
                const messageDiv = document.createElement('div');
                messageDiv.className = 'ai-message ' + (type === 'user' ? 'user' : 'ai');

                if (isLoading) {
                    messageDiv.id = 'ai-loading-message';
                }

                const fontSizeStr = this._aiFontSize ? `font-size: ${this._aiFontSize}px;` : '';
                const padStr = this._aiFontPad ? `padding: ${this._aiFontPad};` : 'padding: 12px 15px;';

                if (type === 'user') {
                    messageDiv.style.cssText = `
                        background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
                        color: white;
                        ${padStr}
                        border-radius: 12px 12px 4px 12px;
                        max-width: 80%;
                        align-self: flex-end;
                        margin-left: auto;
                        ${fontSizeStr}
                        line-height: 1.5;
                        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
                    `;
                } else {
                    messageDiv.style.cssText = `
                        background: var(--bg-panel);
                        color: var(--text-main);
                        ${padStr}
                        border-radius: 12px 12px 12px 4px;
                        max-width: 85%;
                        align-self: flex-start;
                        ${fontSizeStr}
                        line-height: 1.6;
                        border: 1px solid var(--border);
                        white-space: pre-wrap;
                    `;
                }

                messageDiv.textContent = text;
                chatArea.appendChild(messageDiv);

                // Scroll al final
                chatArea.scrollTop = chatArea.scrollHeight;
            },

            removeLoadingMessage: function () {
                const loadingMsg = document.getElementById('ai-loading-message');
                if (loadingMsg) {
                    loadingMsg.remove();
                }
            },

            clearAIChat: function () {
                const chatArea = document.getElementById('ai-chat-area');
                if (!chatArea) return;

                // Limpiar todos los mensajes
                chatArea.innerHTML = '';

                // Restaurar mensaje de bienvenida
                const welcomeMsg = document.createElement('div');
                welcomeMsg.className = 'ai-message ai';
                welcomeMsg.id = 'ai-welcome-msg';
                welcomeMsg.innerHTML = `
                    <p style="margin: 0 0 8px 0; font-weight: 600;">👋 ¡Hola! Soy tu asistente de IA.</p>
                    <p style="margin: 0; opacity: 0.85;">
                        Puedo resumir, analizar, extraer datos, traducir documentos y responder preguntas sobre tu PDF.
                    </p>
                `;
                chatArea.appendChild(welcomeMsg);

                console.log('🗑️ Chat de IA limpiado');
            },

            detectIndexTitles: async function (silentMode = false) {
                const doc = this.getDoc();
                if (!doc) {
                    if (!silentMode) alert('No hay documento abierto');
                    return;
                }

                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Analizando estructura del documento...";

                this.indexEntries = [];
                let entryId = 1;

                try {
                    // ── Primer paso: Recopilar todos los textos del documento ──────────────────
                    // 🆕 MEJORA 3: Motor PyMuPDF — extrae isBold, isItalic y fontSize REALES.
                    // El loop PDF.js solo tiene item.fontName (ej: "g_d0_f1") sin bold/size verídicos.
                    // Si Python no está listo o falla, cae al loop PDF.js como fallback.
                    const allTexts = [];
                    let usedPythonExtract = false;

                    try {
                        if (PythonManager.isLoaded) {
                            // Reunir buffer del primer source (normalmente todos vienen del mismo PDF)
                            const sourceIds = [...new Set(doc.pages.map(p => p.sourceId))];
                            const primarySrc = doc.sources[sourceIds[0]];
                            if (primarySrc && primarySrc.buffer) {
                                document.getElementById('loader-msg').innerText = "Extrayendo texto...";
                                const pyLines = await PythonManager.extractDocumentLines(primarySrc.buffer);
                                if (pyLines && pyLines.length > 0) {
                                    usedPythonExtract = true;
                                    let lineIndex = 0;
                                    for (const ln of pyLines) {
                                        // Mapear pageNum de Python (1-based, relativo al PDF source)
                                        // al pageIndex del documento (que puede tener múltiples sources)
                                        const docPageIdx = doc.pages.findIndex(
                                            p => p.sourceId === sourceIds[0] && p.pageIndex === ln.pageNum - 1
                                        );
                                        if (docPageIdx < 0) continue;
                                        allTexts.push({
                                            text: ln.text,
                                            fontSize: ln.fontSize,
                                            // 🎯 Datos reales que PDF.js NO puede dar:
                                            isBoldReal: ln.isBold,
                                            isItalicReal: ln.isItalic,
                                            textColor: ln.color,
                                            page: ln.pageNum,
                                            y: ln.y,
                                            // fontName no disponible desde PyMuPDF dict lines,
                                            // pero isBoldReal lo reemplaza en el scoring
                                            fontName: ln.isBold ? 'Bold' : '',
                                            lineIndex: lineIndex++
                                        });
                                    }
                                    console.log(`🐍 PyMuPDF Index: ${allTexts.length} líneas extraídas con métricas reales`);
                                }
                            }
                        }
                    } catch (pyExtractErr) {
                        console.warn("🐍 extractDocumentLines failed, using PDF.js fallback:", pyExtractErr);
                        usedPythonExtract = false;
                    }

                    // ── Fallback PDF.js: loop getTextContent ─────────────────────────────────
                    if (!usedPythonExtract) {
                        console.log("🔍 Extracción de índice con PDF.js (fallback)...");
                        for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
                            const page = doc.pages[pageIndex];
                            try {
                                const pData = page;
                                const src = doc.sources[pData.sourceId];
                                if (!src.doc) {
                                    src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                                }
                                const pdfPage = await src.doc.getPage(pData.pageIndex + 1);
                                const textContent = await pdfPage.getTextContent();
                                let lastY = -1, currentLine = '', currentFontSize = 0, lineStartY = 0, fontName = '', lineIndex = 0;
                                textContent.items.forEach((item) => {
                                    const y = item.transform[5];
                                    const fontSize = Math.abs(item.transform[3]);
                                    const itemFontName = item.fontName || '';
                                    if (lastY === -1 || Math.abs(y - lastY) > 5) {
                                        if (currentLine.trim()) {
                                            allTexts.push({ text: currentLine.trim(), fontSize: currentFontSize, page: pageIndex + 1, y: lineStartY, fontName: fontName, lineIndex: lineIndex });
                                            lineIndex++;
                                        }
                                        currentLine = item.str; currentFontSize = fontSize; lineStartY = y; fontName = itemFontName; lastY = y;
                                    } else { currentLine += item.str; lastY = y; }
                                });
                                if (currentLine.trim()) {
                                    allTexts.push({ text: currentLine.trim(), fontSize: currentFontSize, page: pageIndex + 1, y: lineStartY, fontName: fontName, lineIndex: lineIndex });
                                }
                            } catch (e) { console.error('Error analizando página ' + pageIndex, e); }
                            const progress = Math.round(((pageIndex + 1) / doc.pages.length) * 50);
                            document.getElementById('loader-msg').innerText = `Extrayendo texto... ${progress}%`;
                        }
                    }

                    // Segundo paso: Analizar y clasificar inteligentemente
                    document.getElementById('loader-msg').innerText = "Clasificando títulos...";

                    // Calcular tamaños de fuente promedio y máximo
                    const fontSizes = allTexts.map(t => t.fontSize);
                    const avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
                    const maxFontSize = Math.max(...fontSizes);

                    // Patrones comunes de títulos
                    const titlePatterns = {
                        roman: /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)\.?\s+/i,
                        decimal: /^\d+(\.\d+)*\.?\s+/,
                        letter: /^[A-Z]\.?\s+|^\([a-z]\)\s+/,
                        keywords: /^(capítulo|chapter|sección|section|parte|part|introducción|introduction|conclusión|conclusion|resumen|abstract|índice|index|tabla|table|figura|figure|anexo|appendix|bibliografía|bibliography|referencias|references)/i,
                        allCaps: /^[A-ZÁÉÍÓÚÑ\s]+$/,
                        formLabel: /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+:\s*$/, // "Clave:", "Nombre:", "Entidad de registro:"
                    };

                    // ── DETECCIÓN DE TIPO DE PÁGINA ──────────────────────────────────────────
                    // Detecta páginas que son formularios/IDs → tratarlas como entrada única
                    const pageGroups = {};
                    allTexts.forEach(item => {
                        if (!pageGroups[item.page]) pageGroups[item.page] = [];
                        pageGroups[item.page].push(item);
                    });

                    // Clasificar cada página como 'form', 'cv', o 'document'
                    const pageTypes = {};
                    const formKeywordPatterns = [
                        /curp|clave\s+única|registro\s+de\s+población|renapo/i,
                        /credencial|ine\s|ife\s|acta\s+de\s+nacimiento|pasaporte/i,
                        /rfc\s*:|folio\s*:|folio\s+fiscal/i,
                        /gobernación|secretaría\s+de/i,
                    ];
                    const cvKeywordPatterns = [
                        /licenciatura|ingeniería|maestría|doctorado/i,
                        /experiencia\s+(médica|laboral|profesional)/i,
                        /habilidades?\s+(técnicas|blandas)/i,
                        /perfil\s+personal|curriculum|cv\b/i,
                    ];

                    Object.entries(pageGroups).forEach(([pageNum, items]) => {
                        const pageText = items.map(i => i.text).join(' ');
                        const labelCount = items.filter(i => titlePatterns.formLabel.test(i.text)).length;
                        const shortLineCount = items.filter(i => i.text.length < 30).length;
                        const isFormLike = labelCount >= 3 || (shortLineCount / items.length > 0.6 && items.length < 20);
                        const hasFormKeyword = formKeywordPatterns.some(p => p.test(pageText));
                        const hasCvKeyword = cvKeywordPatterns.some(p => p.test(pageText));

                        if (hasFormKeyword && isFormLike) pageTypes[pageNum] = 'form';
                        else if (hasCvKeyword) pageTypes[pageNum] = 'cv';
                        else pageTypes[pageNum] = 'document';
                    });

                    // Identificar etiqueta semántica para páginas tipo form
                    const formTypeLabels = {
                        curp: /curp|clave\s+única|registro\s+de\s+población/i,
                        ine: /credencial\s+para\s+votar|ine\s|ife\s/i,
                        acta: /acta\s+de\s+nacimiento/i,
                        pasaporte: /pasaporte/i,
                        rfc: /registro\s+federal\s+de\s+contribuyentes|rfc/i,
                        folio: /folio\s+fiscal|comprobante\s+fiscal/i,
                    };

                    // Agregar entradas para páginas tipo form (entrada única por página)
                    Object.entries(pageTypes).forEach(([pageNum, type]) => {
                        if (type !== 'form') return;
                        const items = pageGroups[pageNum] || [];
                        const pageText = items.map(i => i.text).join(' ');
                        let label = 'Documento';
                        for (const [key, pat] of Object.entries(formTypeLabels)) {
                            if (pat.test(pageText)) {
                                label = key.toUpperCase();
                                break;
                            }
                        }
                        // Si no matchea, usar el texto más grande de la página
                        if (label === 'Documento') {
                            const largest = items.slice().sort((a, b) => b.fontSize - a.fontSize)[0];
                            if (largest) label = largest.text.substring(0, 40).trim();
                        }
                        this.indexEntries.push({
                            id: `auto-${entryId++}`,
                            title: label,
                            page: parseInt(pageNum),
                            level: 1,
                            type: 'auto',
                            score: 100
                        });
                    });

                    // ── AGRUPACIÓN DE LÍNEAS (para páginas no-form) ──────────────────────────
                    const groupedTexts = [];
                    let currentGroup = null;

                    allTexts.forEach((item, index) => {
                        if (pageTypes[item.page] === 'form') return; // ya manejadas arriba
                        const nextItem = allTexts[index + 1];

                        // Agrupar líneas del nombre en página 1 o CVs (misma página, fuente similar, consecutivas)
                        const pageType = pageTypes[item.page];
                        const isNameLike = item.fontSize > avgFontSize * 1.2 && item.text.length > 3 && item.text.length < 80;
                        const nextIsSameFont = nextItem && nextItem.page === item.page &&
                            Math.abs(item.fontSize - nextItem.fontSize) < 2 &&
                            nextItem.fontSize > avgFontSize * 1.2;

                        if (isNameLike && nextIsSameFont && pageType === 'cv') {
                            if (!currentGroup) {
                                currentGroup = { ...item, isGrouped: true };
                            } else {
                                currentGroup.text += ' ' + item.text;
                                currentGroup.fontSize = Math.max(currentGroup.fontSize, item.fontSize);
                            }
                        } else {
                            if (currentGroup) {
                                // solo agregar el grupo si el item actual no es la continuación
                                if (!nextIsSameFont || item.page !== (currentGroup.page)) {
                                    currentGroup.text += ' ' + item.text;
                                }
                                groupedTexts.push(currentGroup);
                                currentGroup = null;
                            } else {
                                groupedTexts.push(item);
                            }
                        }
                    });
                    if (currentGroup) groupedTexts.push(currentGroup);

                    groupedTexts.forEach((item, index) => {
                        const { text, fontSize, page, y, fontName, isGrouped } = item;
                        const pageType = pageTypes[page] || 'document';

                        // Ignorar textos muy cortos o muy largos
                        if (text.length < 3 || text.length > 200) return;

                        // Penalizar etiquetas de formulario sueltas (solo letras + dos puntos)
                        if (titlePatterns.formLabel.test(text) && text.length < 30) return;

                        // Sistema de puntuación
                        let score = 0;
                        let level = 3;

                        // 1. Tamaño de fuente relativo al promedio
                        const fontSizeRatio = fontSize / avgFontSize;
                        if (fontSizeRatio > 1.8) {
                            score += 55; level = 1;
                        } else if (fontSizeRatio > 1.4) {
                            score += 42; level = 1;
                        } else if (fontSizeRatio > 1.15) {
                            score += 28; level = 2;
                        } else if (fontSizeRatio > 1.05) {
                            score += 15; level = 3;
                        } else if (fontSizeRatio < 0.85) {
                            score -= 20; // pie de página / nota
                        }

                        // 1b. Visualmente aislado entre párrafos
                        const prevItem = groupedTexts[index - 1];
                        const nextItem = groupedTexts[index + 1];
                        const prevSamePage = prevItem && prevItem.page === page;
                        const nextSamePage = nextItem && nextItem.page === page;
                        const isLargerThanPrev = !prevSamePage || fontSize > prevItem.fontSize * 1.08;
                        const isLargerThanNext = !nextSamePage || fontSize > nextItem.fontSize * 1.08;
                        if (isLargerThanPrev && isLargerThanNext && fontSizeRatio > 1.05) score += 15;

                        // 2. Fuente en negrita
                        const isBoldDetected = (item.isBoldReal === true) || fontName.toLowerCase().includes('bold');
                        if (isBoldDetected) {
                            score += 18;
                            // Bold con tamaño similar al promedio → solo nivel 2 si no hay tamaño grande
                            if (level === 3 && fontSizeRatio <= 1.15) level = 2;
                        }

                        // 3. Patrones de numeración
                        if (titlePatterns.roman.test(text)) {
                            score += 35; level = Math.min(level, 1);
                        } else if (titlePatterns.decimal.test(text)) {
                            const dots = (text.match(/\./g) || []).length;
                            score += 30;
                            if (dots === 1) level = Math.min(level, 1);
                            else if (dots === 2) level = Math.min(level, 2);
                            else level = 3;
                        } else if (titlePatterns.letter.test(text)) {
                            score += 22; level = Math.min(level, 2);
                        }

                        // 4. Palabras clave de secciones
                        if (titlePatterns.keywords.test(text)) {
                            score += 30; level = Math.min(level, 1);
                        }

                        // 5. Todo en mayúsculas
                        const isAllCaps = titlePatterns.allCaps.test(text) && text.length > 5;
                        if (isAllCaps && !isGrouped) {
                            score += 18;
                            // En CV: secciones en mayúsculas son nivel 2 si hay nombre más grande
                            if (pageType === 'cv' && fontSizeRatio < 1.4) level = Math.min(level, 2);
                            else level = Math.min(level, 1);
                        }

                        // 6. Posición en la página
                        const isTopOfPage = index === 0 || (groupedTexts[index - 1] && groupedTexts[index - 1].page !== page);
                        if (isTopOfPage && page > 1) score += 12;

                        // 7. Longitud del texto
                        const wordCount = text.split(/\s+/).length;
                        if (text.length < 60 && wordCount <= 10) score += 14;
                        else if (wordCount > 15) score -= 25;
                        else if (text.length < 100) score += 5;

                        // 8. Sin puntuación final
                        if (!/[.!?;,]$/.test(text)) score += 10;
                        else score -= 12;

                        // 9. Primera letra mayúscula
                        if (/^[A-ZÁÉÍÓÚÑ]/.test(text)) score += 5;

                        // 10. Penalizar párrafos con muchas minúsculas
                        const lowerWords = (text.match(/\b[a-záéíóúñ]{4,}\b/g) || []).length;
                        if (lowerWords > 5) score -= 18;

                        // 11. Penalizar texto de CV que parece bullet/detalle (empieza con • o -)
                        if (/^[•\-–]\s/.test(text)) score -= 30;

                        // 12. Texto agrupado (nombre en portada/CV) → siempre nivel 1 si pasa umbral
                        if (isGrouped) { level = 1; score += 10; }

                        // Umbral adaptativo
                        const threshold = pageType === 'cv' ? 45 : (page === 1 ? 65 : 48);

                        if (score >= threshold) {
                            const isDuplicate = this.indexEntries.some(entry =>
                                entry.page === page &&
                                entry.title.toLowerCase() === text.toLowerCase()
                            );

                            if (!isDuplicate) {
                                this.indexEntries.push({
                                    id: `auto-${entryId++}`,
                                    title: text,
                                    page: page,
                                    level: level,
                                    type: 'auto',
                                    score: score
                                });
                            }
                        }
                    });

                    // Ordenar por página y luego por nivel
                    this.indexEntries.sort((a, b) => {
                        if (a.page !== b.page) return a.page - b.page;
                        return a.level - b.level;
                    });

                    // Persistir en doc
                    const _idxDoc = this.getDoc();
                    if (_idxDoc) { _idxDoc.indexEntries = this.indexEntries; this.saveSessionLight(); }

                    this.toggleLoader(false);
                    this.renderIndexEntries();
                    this.updateIndexCount();

                    if (this.indexEntries.length === 0) {
                        if (!silentMode) {
                            alert('No se detectaron títulos automáticamente.\n\n💡 Sugerencia: Puedes agregar entradas manualmente usando el botón "➕ Agregar"');
                        }
                        this.showIndexEmptyState(true);
                    } else {
                        this.showIndexEmptyState(false);
                        if (!silentMode) {
                            alert(`✅ Se detectaron ${this.indexEntries.length} títulos automáticamente\n\n📊 Distribución:\n• Nivel 1: ${this.indexEntries.filter(e => e.level === 1).length}\n• Nivel 2: ${this.indexEntries.filter(e => e.level === 2).length}\n• Nivel 3: ${this.indexEntries.filter(e => e.level === 3).length}`);
                        }
                    }
                } catch (error) {
                    this.toggleLoader(false);
                    console.error('Error en detección de títulos:', error);
                    if (!silentMode) {
                        alert('Error al detectar títulos: ' + error.message);
                    }
                }
            },

            runOCR: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) {
                    this.showToast('⚠️ Abre un documento primero');
                    return;
                }

                this.toggleLoader(true, 'Ejecutando OCR...');
                this.addAIMessage('bot', '🔤 Analizando página...', true);

                try {
                    // Extraer primero el texto digital antes de recurrir a OCR.
                    const page = doc.pages[doc.currentIndex];
                    const src = page && doc.sources[page.sourceId];

                    if (src && src.buffer) {
                        try {
                            this.toggleLoader(true, 'Extrayendo texto nativo...');
                            const nativeText = await PythonManager.extractPageText(src.buffer, page.pageIndex);

                            if (nativeText && nativeText.length > 20) {
                                this.removeLoadingMessage();
                                this.toggleLoader(false);
                                this.addAIMessage('bot', `✅ Texto extraído:\n\n${nativeText}`);
                                return;
                            }
                        } catch (pyEx) {
                            console.warn("⚠️ Extracción nativa falló, usando Tesseract:", pyEx);
                        }
                    }

                    // ── PASO 2: Fallback a Tesseract (PDF escaneado o imagen) ──
                    this.toggleLoader(true, 'Reconociendo texto en el PDF...');
                    this.addAIMessage('bot', '🔤 PDF escaneado detectado. Reconociendo texto...', true);

                    // Obtener el canvas correcto según la vista actual
                    let canvas;
                    if (this.splitView === 'single') {
                        canvas = document.getElementById('the-canvas');
                    } else {
                        const activePanelId = this.splitView.activePanel || 'primary';
                        canvas = document.getElementById(activePanelId === 'primary' ? 'the-canvas' : 'the-canvas-secondary');
                    }

                    if (!canvas) throw new Error('No se pudo encontrar el canvas de renderizado');
                    if (!canvas.width || !canvas.height) throw new Error('El canvas no tiene contenido renderizado.');

                    // ── 🐍 PASO 2.5: Pre-procesar imagen con PIL para mejorar precisión ──
                    // preprocessForOCR aplica: inversión (fondo oscuro), contraste adaptativo,
                    // binarización Otsu, y eliminación de ruido sal/pimienta.
                    let ocrInput;
                    try {
                        if (window.PythonManager) {
                            this.toggleLoader(true, 'Pre-procesando imagen con PIL...');
                            const rawDataURL = canvas.toDataURL('image/png');
                            const processedDataURL = await PythonManager.preprocessForOCR(rawDataURL);
                            if (processedDataURL && processedDataURL !== rawDataURL) {
                                // Convertir DataURL procesado a Blob para Tesseract
                                const b64 = processedDataURL.split(',')[1];
                                const binaryStr = atob(b64);
                                const bytes = new Uint8Array(binaryStr.length);
                                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                                ocrInput = new Blob([bytes], { type: 'image/png' });
                                console.log('🐍 OCR: Imagen pre-procesada con PIL (Otsu + contraste)');
                            }
                        }
                    } catch (prepErr) {
                        console.warn('🐍 OCR: Pre-procesamiento PIL falló, usando imagen original', prepErr);
                    }

                    // Fallback: usar canvas original si PIL no está disponible o falló
                    if (!ocrInput) {
                        ocrInput = await new Promise((resolve, reject) => {
                            try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas a blob falló'))); }
                            catch (e) { reject(e); }
                        });
                    }

                    this.toggleLoader(true, 'Reconociendo texto...');

                    // Usar worker persistente
                    const worker = await this._getOCRWorker();
                    const result = await worker.recognize(ocrInput);

                    this.removeLoadingMessage();
                    this.toggleLoader(false);

                    const text = result.data.text.trim();
                    if (text) {
                        this.addAIMessage('bot', `✅ Texto extraído:\n\n${text}`);
                    } else {
                        this.addAIMessage('bot', '⚠️ No se detectó texto en la imagen. Verifica que el documento contenga texto legible.');
                    }
                } catch (error) {
                    this.removeLoadingMessage();
                    this.toggleLoader(false);
                    console.error('Error en OCR:', error);
                    this.addAIMessage('bot', `❌ Error ejecutando OCR: ${error.message}`);
                }
            },

            // ============================================================
            // GENERAR ÍNDICE CON IA (GEMINI)
            // ============================================================
            generateIndexWithAI: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) {
                    this.showToast('⚠️ Abre un documento primero');
                    return;
                }

                this.toggleLoader(true, 'Generando índice con IA...');
                this.addAIMessage('bot', '🗂️ Analizando documento con IA...', true);

                try {
                    const source = doc.sources[doc.pages[0].sourceId];
                    let pdfDoc = source.doc;
                    if (!pdfDoc) {
                        pdfDoc = await pdfjsLib.getDocument({ data: source.buffer.slice(0) }).promise;
                        source.doc = pdfDoc;
                    }

                    // Capturar imágenes (máx 10 páginas, paralelo)
                    const maxPages = Math.min(10, pdfDoc.numPages);
                    const images = (await Promise.all(
                        Array.from({length: maxPages}, (_, i) => (async (pageNum) => {
                            const page = await pdfDoc.getPage(pageNum);
                            const viewport = page.getViewport({ scale: 1.5 });
                            const canvas = document.createElement('canvas');
                            canvas.width = viewport.width; canvas.height = viewport.height;
                            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                            return { data: canvas.toDataURL('image/jpeg', 0.82).split(',')[1], pageNum };
                        })(i + 1))
                    )).sort((a, b) => a.pageNum - b.pageNum);

                    const callGemini = async (parts, maxTokens = 512, temp = 0.1) => {
                        const res = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.geminiApiKey}`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: temp, maxOutputTokens: maxTokens } }) }
                        );
                        return res.json();
                    };
                    const imgParts = images.map(img => ({ inline_data: { mime_type: 'image/jpeg', data: img.data } }));

                    // ── PASO 1: Identificar tipo de documento ────────────────────────────────
                    document.getElementById('loader-msg').innerText = 'IA: identificando tipo de documento...';
                    const step1 = await callGemini([
                        { text: `Analiza estas imágenes de un documento PDF. Responde SOLO con JSON sin markdown:
{"docType":"tipo en español (CURP/CV/Contrato/Reporte/Factura/etc.)","isSingleRecord":true/false,"pageTypes":{"1":"form|cv|document",...}}
isSingleRecord=true si es un formulario de identidad (CURP, INE, acta, pasaporte). Clasifica cada página.` },
                        ...imgParts
                    ], 512, 0.1);

                    let docMeta = { docType: 'Documento', isSingleRecord: false, pageTypes: {} };
                    try {
                        let s1 = (step1.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
                        console.log('Step1 raw:', s1.substring(0, 200));
                        // Extraer primer objeto JSON válido aunque Gemini añada texto extra
                        const _js = s1.indexOf('{'), _je = s1.lastIndexOf('}');
                        if (_js !== -1 && _je > _js) s1 = s1.substring(_js, _je + 1);
                        docMeta = JSON.parse(s1);
                    } catch(e) { console.warn('Step1 parse failed', e); }
                    console.log('📋 docType:', docMeta.docType, '| isSingleRecord:', docMeta.isSingleRecord);

                    // ── PASO 2: Generar índice semántico ─────────────────────────────────────
                    document.getElementById('loader-msg').innerText = 'IA: generando índice...';
                    const indexPrompt = docMeta.isSingleRecord
                        ? `Este documento es: "${docMeta.docType}". Es un registro/formulario único.
Genera UNA entrada por tipo de documento presente.
TÍTULOS: máximo 25 caracteres. Abrevia: "Constancia CURP"→"CURP", "Identificación Electoral"→"INE", "Curriculum Vitae"→"CV", "Acta de Nacimiento"→"Acta Nacimiento", "Cédula Profesional"→"Cédula Prof.", "Título Universitario"→"Título Univ.".
Responde SOLO JSON array sin markdown:
[{"title":"CURP","page":1,"level":1}]`
                        : `Este documento es: "${docMeta.docType}". Tipos por página: ${JSON.stringify(docMeta.pageTypes)}.
Genera índice SEMÁNTICO. Reglas:
- cv: título nivel 1 = "CV" (solo esa palabra); secciones (EXPERIENCIA, ESTUDIOS, HABILIDADES, etc.) = nivel 2, nombre corto máx 20 chars; NO incluyas sub-items de cada sección.
- form: 1 entrada por página, nombre abreviado (máx 25 chars). Usa: "CURP","INE","Acta Nacimiento","Cédula Prof.","Título Univ.","Pasaporte","Contrato","Factura".
- document: títulos/subtítulos reales (máx 25 chars), sin artículos innecesarios.
NO incluyas: etiquetas sueltas ("Nombre:", "Clave:"), bullets, párrafos, pie de página.
NO fragmentes nombres propios. Responde SOLO JSON array sin markdown:
[{"title":"...","page":número,"level":1|2|3}]`;

                    const step2 = await callGemini([{ text: indexPrompt }, ...imgParts], 8192, 0.2);

                    this.removeLoadingMessage();
                    this.toggleLoader(false);

                    const rawText = step2.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!rawText) throw new Error(step2.error?.message || 'Sin respuesta');

                    // Extraer array JSON válido aunque Gemini añada texto extra
                    let jsonText = rawText.trim();
                    const _as = jsonText.indexOf('['), _ae = jsonText.lastIndexOf(']');
                    if (_as !== -1 && _ae > _as) jsonText = jsonText.substring(_as, _ae + 1);
                    if (!jsonText.endsWith(']')) {
                        const last = jsonText.lastIndexOf('}');
                        if (last !== -1) jsonText = jsonText.substring(0, last + 1) + '\n]';
                    }
                    const indexData = JSON.parse(jsonText);
                    if (!Array.isArray(indexData) || !indexData.length) throw new Error('Índice vacío');

                    // Fusionar: IA reemplaza 'auto', conserva 'manual'
                    const manualEntries = this.indexEntries.filter(e => e.type === 'manual');
                    const aiEntries = indexData
                        .filter(e => e.title && typeof e.page === 'number')
                        .map((e, idx) => ({ id: `ai-${Date.now()}-${idx}`, title: e.title, page: e.page, level: e.level || 1, type: 'ai' }));

                    this.indexEntries = [...aiEntries, ...manualEntries]
                        .sort((a, b) => a.page !== b.page ? a.page - b.page : a.level - b.level);

                    // Persistir
                    doc.indexEntries = this.indexEntries;
                    this.saveSessionLight();

                    this.renderIndexEntries();
                    this.updateIndexCount();
                    this.showIndexEmptyState(false);

                    this.addAIMessage('bot', `✅ Índice IA para "${docMeta.docType}" — ${aiEntries.length} entradas${manualEntries.length ? ` (+${manualEntries.length} manuales conservadas)` : ''}.`);
                    this.showToast('✅ Índice IA generado');

                } catch (error) {
                    this.removeLoadingMessage();
                    this.toggleLoader(false);
                    console.error('❌ generateIndexWithAI:', error);
                    this.addAIMessage('bot', `❌ Error: ${error.message}`);
                }
            },

            // ══════════════════════════════════════════════
            //  ADJUNTOS EMBEBIDOS EN PDF
            // ══════════════════════════════════════════════
            _ttsVisible: false,
            _ttsScope: 'sel',
            _ttsRate: 1,
            _ttsVoice: null,
            _ttsUtterance: null,
            _ttsPlaying: false,
            _ttsChunks: [],
            _ttsChunkIdx: 0,
            _ttsProvider: 'native',
            _ttsOAIVoice: 'nova',
            _ttsVoiceList: [],
            _ttsAllVoices: [],
            _ttsFilterOnline: false,
            _ttsFilterGender: null,   // null | 'm' | 'f'

            toggleTTSWidget: function () {
                this._ttsVisible = !this._ttsVisible;
                const w = document.getElementById('tts-widget');
                if (!w) return;
                w.style.display = this._ttsVisible ? 'block' : 'none';
                if (this._ttsVisible) {
                    this._ttsUpdatePosition();
                    this._ttsLoadVoices();
                } else {
                    this.ttsStop();
                }
                ['btn-tts-magic','btn-tts-reading'].forEach(id => {
                    const b = document.getElementById(id);
                    if (b) b.classList.toggle('tts-active', this._ttsVisible);
                });
            },

            _ttsUpdatePosition: function () {
                const w = document.getElementById('tts-widget');
                if (!w) return;
                const isReading = document.body.classList.contains('reading-mode');
                // reading: header(36) + mini-ribbon(23) = 59px
                // normal:  header(36) + tabs(29) + ribbon(61) = 126px
                w.style.top = isReading ? '59px' : '126px';
            },

            ttsBtnCollapse: function () {
                const w = document.getElementById('tts-widget');
                if (w) w.classList.toggle('tts-collapsed');
                const btn = document.getElementById('tts-collapse-btn');
                if (btn) btn.textContent = (w && w.classList.contains('tts-collapsed')) ? '+' : '−';
            },

            ttsSetScope: function (scope) {
                this._ttsScope = scope;
                ['sel','page','doc'].forEach(s => {
                    const b = document.getElementById('tts-scope-' + s);
                    if (b) b.classList.toggle('tts-pill-active', s === scope);
                });
            },

            ttsSetSpeed: function (val) {
                this._ttsRate = parseFloat(val);
                const lbl = document.getElementById('tts-speed-val');
                if (lbl) lbl.textContent = parseFloat(val).toFixed(1) + '×';
                if (this._ttsUtterance) this._ttsUtterance.rate = this._ttsRate;
                if (this._ttsAudio) this._ttsAudio.playbackRate = this._ttsRate;
            },

            ttsToggleAPIKey: function (forceState) {
                const p = document.getElementById('tts-apikey-panel');
                if (!p) return;
                const isCurrentlyVisible = p.style.display !== 'none' && p.style.display !== '';
                const nextState = typeof forceState === 'boolean' ? forceState : !isCurrentlyVisible;
                p.style.display = nextState ? 'flex' : 'none';
                const btn = document.getElementById('tts-apikey-btn');
                if (btn) {
                    btn.classList.toggle('tts-hdr-btn-active', nextState);
                    btn.style.background = nextState ? 'rgba(99,102,241,0.45)' : '';
                    btn.style.color = nextState ? '#ffffff' : '';
                }
            },

            ttsSetProvider: function (provider) {
                this._ttsProvider = provider;
                ['native','fishaudio','openai','eleven'].forEach(p => {
                    const b = document.getElementById('tts-api-' + p);
                    if (b) b.classList.toggle('tts-pill-active', p === provider);
                });
                const keyRow = document.getElementById('tts-apikey-row');
                const nativeWrap = document.getElementById('tts-native-voice-wrap');
                const oaiVoices = document.getElementById('tts-openai-voice-row');
                const fishRow = document.getElementById('tts-fishaudio-voice-row');
                if (keyRow) keyRow.style.display = provider === 'native' ? 'none' : 'flex';
                if (nativeWrap) nativeWrap.style.display = provider === 'native' ? 'flex' : 'none';
                if (oaiVoices) oaiVoices.style.display = provider === 'openai' ? 'flex' : 'none';
                if (fishRow) fishRow.style.display = provider === 'fishaudio' ? 'flex' : 'none';
                
                // restore saved key
                const saved = localStorage.getItem('alioth_tts_key_' + provider) || (provider === 'fishaudio' ? localStorage.getItem('fishaudio_api_key') : '');
                const inp = document.getElementById('tts-apikey-input');
                if (inp) inp.value = saved || '';

                if (provider === 'fishaudio') {
                    this._ttsLoadFishVoices(this._ttsFishScope || 'community');
                } else if (provider === 'native') {
                    this._ttsLoadVoices();
                }
            },

            ttsSetFishScope: function (scope) {
                this._ttsFishScope = scope;
                const bComm = document.getElementById('tts-fish-scope-community');
                const bSelf = document.getElementById('tts-fish-scope-self');
                if (bComm) bComm.classList.toggle('tts-pill-active', scope === 'community');
                if (bSelf) bSelf.classList.toggle('tts-pill-active', scope === 'self');
                this._ttsLoadFishVoices(scope);
            },

            _ttsLoadFishVoices: async function (scope = 'community') {
                const sel = document.getElementById('tts-voice-sel');
                if (!sel) return;
                const key = localStorage.getItem('alioth_tts_key_fishaudio') || localStorage.getItem('fishaudio_api_key') || '';
                this._ttsSetStatus('⏳ Cargando voces Fish Audio…');
                try {
                    const r = await fetch(`/api/tts/fishaudio/voices?scope=${scope}`, {
                        headers: key ? { 'Authorization': 'Bearer ' + key } : {}
                    });
                    const data = await r.json();
                    if (data && data.ok && Array.isArray(data.voices) && data.voices.length > 0) {
                        this._ttsFishVoices = data.voices;
                        sel.innerHTML = data.voices.map(v => {
                            const icon = scope === 'community' ? '🌐' : '👤';
                            const genderIcon = v.gender === 'female' ? '♀' : (v.gender === 'male' ? '♂' : '🎙');
                            const langBadge = (v.language || 'es').toUpperCase();
                            return `<option value="${v.id}">${icon} ${genderIcon} [${langBadge}] ${v.name}</option>`;
                        }).join('');
                        
                        const savedVoice = localStorage.getItem('alioth_tts_voice_fishaudio');
                        if (savedVoice && Array.from(sel.options).some(o => o.value === savedVoice)) {
                            sel.value = savedVoice;
                        }
                        this._ttsSetStatus(`✅ ${data.voices.length} voces BigFish`);
                    } else {
                        // Fallback a voces populares en español de BigFish
                        const defaults = [
                            { id: '7f92f8afb8ec43bf81429cc1c9199cb1', name: 'Alonso (Español Natural)', lang: 'ES', gender: '♂' },
                            { id: 'e48a17fe01f24d77bb4518bf97cf5c49', name: 'Sofía (Español Neutro)', lang: 'ES', gender: '♀' },
                            { id: 'd28d09f7a9ec49b996113b28b7e28b17', name: 'Mateo (Narrador Profesional)', lang: 'ES', gender: '♂' }
                        ];
                        sel.innerHTML = defaults.map(v => `<option value="${v.id}">🌐 ${v.gender} [${v.lang}] ${v.name}</option>`).join('');
                        const savedVoice = localStorage.getItem('alioth_tts_voice_fishaudio');
                        if (savedVoice && Array.from(sel.options).some(o => o.value === savedVoice)) {
                            sel.value = savedVoice;
                        }
                        this._ttsSetStatus('Listo (Voces sugeridas)');
                    }
                } catch (e) {
                    console.warn('[TTS FishAudio] Fallo al cargar voces remotas:', e);
                    sel.innerHTML = '<option value="">🌐 🎙 [ES] BigFish Narrador por Defecto</option>';
                    this._ttsSetStatus('Listo');
                }
            },

            ttsSetOAIVoice: function (voice) {
                this._ttsOAIVoice = voice;
                ['alloy','echo','fable','nova','shimmer'].forEach(v => {
                    const b = document.getElementById('tts-oai-' + v);
                    if (b) b.classList.toggle('tts-pill-active', v === voice);
                });
            },

            ttsSaveAPIKey: function () {
                const inp = document.getElementById('tts-apikey-input');
                if (!inp) return;
                const val = inp.value.trim();
                localStorage.setItem('alioth_tts_key_' + this._ttsProvider, val);
                if (this._ttsProvider === 'fishaudio') {
                    localStorage.setItem('fishaudio_api_key', val);
                    this.fishaudioApiKey = val;
                    this._ttsLoadFishVoices(this._ttsFishScope || 'community');
                }
                this._ttsSetStatus('✅ API Key guardada');
                this.showToast?.('✅ API Key guardada correctamente');
            },

            _ttsLoadVoices: function () {
                const sel = document.getElementById('tts-voice-sel');
                if (!sel) return;
                const populate = () => {
                    const voices = window.speechSynthesis.getVoices();
                    const es = voices.filter(v => v.lang.startsWith('es'));
                    this._ttsAllVoices = es.length ? es : voices.slice(0, 60);
                    this._ttsVoiceList = this._ttsAllVoices;
                    this._ttsRebuildVoiceList();
                };
                if (window.speechSynthesis.getVoices().length) populate();
                else window.speechSynthesis.onvoiceschanged = populate;
            },

            _ttsVoiceIsOnline: function (v) {
                return !v.localService || v.name.toLowerCase().includes('online') || v.name.toLowerCase().includes('neural');
            },

            _ttsVoiceGender: function (v) {
                const female = ['mónica','monica','sabina','helena','lucía','lucia','elvira','paulina','maría','maria','elena','laura','carmen','pilar','rosa','ana','isabel','sofía','sofia','marta','andrea','paula','cristina','alicia','silvia','nuria','claudia','leticia','sara','irene','natalia','vanessa','paloma','conchita','penélope','penelope','marisol','lupe','esperanza','ximena','valentina'];
                const n = v.name.toLowerCase();
                return female.some(f => n.includes(f)) ? 'f' : 'm';
            },

            _ttsVoiceCountryFlag: function (v) {
                const flags = { US:'🇺🇸', MX:'🇲🇽', ES:'🇪🇸', AR:'🇦🇷', CO:'🇨🇴', CL:'🇨🇱', VE:'🇻🇪', PE:'🇵🇪', UY:'🇺🇾', GT:'🇬🇹', CR:'🇨🇷', PA:'🇵🇦', DO:'🇩🇴', CU:'🇨🇺', PR:'🇵🇷', BO:'🇧🇴', EC:'🇪🇨', PY:'🇵🇾', HN:'🇭🇳', NI:'🇳🇮', SV:'🇸🇻' };
                const m = v.lang.match(/es-([A-Z]{2})/i);
                const code = m ? m[1].toUpperCase() : null;
                return flags[code] || (code || '??');
            },

            _ttsRebuildVoiceList: function () {
                const sel = document.getElementById('tts-voice-sel');
                if (!sel || !this._ttsAllVoices.length) return;
                let list = this._ttsAllVoices.filter(v => {
                    if (this._ttsFilterOnline && !this._ttsVoiceIsOnline(v)) return false;
                    if (this._ttsFilterGender && this._ttsVoiceGender(v) !== this._ttsFilterGender) return false;
                    return true;
                });
                if (!list.length) list = this._ttsAllVoices;
                sel.innerHTML = list.map(v => {
                    const idx = this._ttsAllVoices.indexOf(v);
                    const online = this._ttsVoiceIsOnline(v) ? '☁' : '💻';
                    const gender = this._ttsVoiceGender(v) === 'f' ? '♀' : '♂';
                    const flag = this._ttsVoiceCountryFlag(v);
                    return `<option value="${idx}">${online} ${gender} ${flag} ${v.name}</option>`;
                }).join('');
                // Seleccionar voz preferida: Alonso Online > Alonso > Raul Online > Raul > Sabina > Google
                const preferred = ['alonso online','alonso natural','alonso','raul online','raul natural','raul','sabina online','google español','google spanish'];
                let found = false;
                for (const name of preferred) {
                    const opt = Array.from(sel.options).find(o => o.text.toLowerCase().includes(name));
                    if (opt) { sel.value = opt.value; found = true; break; }
                }
                if (!found && sel.options.length) sel.value = sel.options[0].value;
            },

            ttsToggleFilter: function (type) {
                if (type === 'online') {
                    this._ttsFilterOnline = !this._ttsFilterOnline;
                    const b = document.getElementById('tts-filter-online');
                    if (b) b.classList.toggle('tts-filter-active', this._ttsFilterOnline);
                } else {
                    if (this._ttsFilterGender === type) {
                        this._ttsFilterGender = null;
                    } else {
                        this._ttsFilterGender = type;
                    }
                    ['m','f'].forEach(g => {
                        const b = document.getElementById('tts-filter-' + g);
                        if (b) b.classList.toggle('tts-filter-active', this._ttsFilterGender === g);
                    });
                }
                this._ttsRebuildVoiceList();
            },

            _ttsGetTextAsync: async function () {
                const scope = this._ttsScope;
                if (scope === 'sel') {
                    const sel = window.getSelection();
                    const txt = sel ? sel.toString().trim() : '';
                    if (txt) return txt;
                    return '';
                }

                const doc = typeof this.getDoc === 'function' ? this.getDoc() : null;
                const curIdx = doc ? (doc.currentIndex || 0) : 0;

                if (scope === 'page') {
                    // 1. Intentar capas de texto en DOM correspondientes a la página activa
                    const pageContainers = document.querySelectorAll('.page-container, .canvas-container');
                    let targetLayer = null;
                    if (pageContainers.length > curIdx && curIdx >= 0) {
                        targetLayer = pageContainers[curIdx].querySelector('.text-layer, .textLayer');
                    }
                    if (!targetLayer) {
                        targetLayer = document.querySelector('.text-layer, .textLayer');
                    }
                    if (targetLayer) {
                        const spans = Array.from(targetLayer.querySelectorAll('span'));
                        if (spans.length) {
                            const text = spans.map(s => s.innerText || s.textContent || '').join(' ').trim();
                            if (text) return text;
                        }
                        const inner = targetLayer.innerText?.trim();
                        if (inner) return inner;
                    }

                    // 2. Extraer directamente de la estructura del documento
                    if (doc && doc.pages && doc.pages[curIdx]) {
                        const curPage = doc.pages[curIdx];
                        if (curPage.textContent && curPage.textContent.trim()) {
                            return curPage.textContent.trim();
                        }
                        let objText = '';
                        if (Array.isArray(curPage.objects)) {
                            const texts = curPage.objects
                                .filter(o => o && (o.type === 'text' || o.text || o.content))
                                .map(o => o.text || o.content || '');
                            if (texts.length) objText = texts.join(' ').trim();
                        }

                        // Fallback con PDF.js si está cargado
                        if (curPage.sourceId && doc.sources && doc.sources[curPage.sourceId]) {
                            try {
                                const sourceData = doc.sources[curPage.sourceId];
                                let pdfDoc = sourceData.doc;
                                if (!pdfDoc && sourceData.buffer && window.pdfjsLib) {
                                    pdfDoc = await window.pdfjsLib.getDocument({ data: sourceData.buffer }).promise;
                                    sourceData.doc = pdfDoc;
                                }
                                if (pdfDoc) {
                                    const pageNum = (curPage.pageIndex !== undefined ? curPage.pageIndex : curIdx) + 1;
                                    const pageObj = await pdfDoc.getPage(pageNum);
                                    const tc = await pageObj.getTextContent();
                                    const pageStr = tc.items.map(item => item.str).join(' ').trim();
                                    if (pageStr) return pageStr + (objText ? '\n' + objText : '');
                                }
                            } catch (e) {
                                console.warn('[TTS] Error en extracción PDF.js:', e);
                            }
                        }
                        if (objText) return objText;
                    }
                    return '';
                }

                if (scope === 'doc') {
                    if (typeof this.extractAllDocumentText === 'function') {
                        try {
                            const all = await this.extractAllDocumentText();
                            if (all && all.trim()) return all.trim();
                        } catch (e) {
                            console.warn('[TTS] extractAllDocumentText failed:', e);
                        }
                    }
                    const layers = document.querySelectorAll('.text-layer, .textLayer');
                    if (layers.length) {
                        const texts = Array.from(layers)
                            .map(l => (l.innerText || l.textContent || '').trim())
                            .filter(t => t.length > 0);
                        if (texts.length) return texts.join('\n\n');
                    }
                    return '';
                }
                return '';
            },

            _ttsSetStatus: function (txt) {
                const s = document.getElementById('tts-status');
                if (s) s.textContent = txt;
            },

            _ttsSetPlayState: function (playing) {
                this._ttsPlaying = playing;
                const bp = document.getElementById('tts-btn-play');
                const bpause = document.getElementById('tts-btn-pause');
                if (bp) bp.style.display = playing ? 'none' : 'flex';
                if (bpause) bpause.style.display = playing ? 'flex' : 'none';
            },

            ttsPlay: async function () {
                // Si había un audio de IA pausado, reanudar
                if (this._ttsAudio && this._ttsAudio.paused && this._ttsAudio.currentTime > 0) {
                    this._ttsSetPlayState(true);
                    this._ttsSetStatus('▶ Leyendo...');
                    try {
                        await this._ttsAudio.play();
                        return;
                    } catch (e) {
                        console.warn('[TTS] Error al reanudar audio:', e);
                    }
                }
                if (this._ttsProvider !== 'native') {
                    await this._ttsPlayAI();
                    return;
                }
                const synth = window.speechSynthesis;
                if (!synth) { this._ttsSetStatus('❌ No soportado'); return; }
                if (synth.paused) { synth.resume(); this._ttsSetPlayState(true); this._ttsSetStatus('▶ Leyendo...'); return; }
                this.ttsStop();
                const text = await this._ttsGetTextAsync();
                if (!text) {
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus(this._ttsScope === 'sel' ? '⚠ Selecciona texto o cambia a Página' : '⚠ Sin texto en la página actual');
                    return;
                }
                const words = text.split(/\s+/);
                this._ttsChunks = [];
                let chunk = '';
                words.forEach(w => {
                    if ((chunk + ' ' + w).length > 200) { this._ttsChunks.push(chunk.trim()); chunk = w; }
                    else chunk += ' ' + w;
                });
                if (chunk.trim()) this._ttsChunks.push(chunk.trim());
                this._ttsChunkIdx = 0;
                this._ttsPlayChunk();
            },

            _ttsPlayChunk: function () {
                const synth = window.speechSynthesis;
                if (this._ttsChunkIdx >= this._ttsChunks.length) { this._ttsSetPlayState(false); this._ttsSetStatus('✅ Finalizado'); return; }
                const utt = new SpeechSynthesisUtterance(this._ttsChunks[this._ttsChunkIdx]);
                utt.rate = this._ttsRate;
                utt.lang = 'es-MX';
                const sel = document.getElementById('tts-voice-sel');
                if (sel && this._ttsVoiceList && this._ttsVoiceList[parseInt(sel.value)]) {
                    utt.voice = this._ttsVoiceList[parseInt(sel.value)];
                }
                utt.onstart = () => { this._ttsSetPlayState(true); this._ttsSetStatus(`▶ ${this._ttsChunkIdx + 1}/${this._ttsChunks.length}`); };
                utt.onend = () => { this._ttsChunkIdx++; this._ttsPlayChunk(); };
                utt.onerror = (e) => { this._ttsSetPlayState(false); this._ttsSetStatus('❌ Error: ' + e.error); };
                this._ttsUtterance = utt;
                synth.speak(utt);
            },

            _ttsPlayAI: async function () {
                const text = await this._ttsGetTextAsync();
                if (!text) {
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus(this._ttsScope === 'sel' ? '⚠ Selecciona texto o cambia a Página' : '⚠ Sin texto en la página actual');
                    return;
                }
                const key = localStorage.getItem('alioth_tts_key_' + this._ttsProvider) || (this._ttsProvider === 'fishaudio' ? localStorage.getItem('fishaudio_api_key') : '');
                if (!key) {
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus('⚠ API Key no configurada (clic en 🔑)');
                    this.ttsToggleAPIKey(true);
                    return;
                }
                this._ttsSetStatus('⏳ Generando audio…');
                this._ttsSetPlayState(true);
                try {
                    let audioBlob;
                    if (this._ttsProvider === 'fishaudio') {
                        const sel = document.getElementById('tts-voice-sel');
                        const voiceId = sel ? sel.value : '';
                        if (voiceId) localStorage.setItem('alioth_tts_voice_fishaudio', voiceId);
                        const r = await fetch('/api/tts/fishaudio/synthesize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                text: text.slice(0, 4000),
                                voice_id: voiceId,
                                api_key: key,
                                speed: this._ttsRate
                            })
                        });
                        if (!r.ok) {
                            const errData = await r.json().catch(() => ({}));
                            throw new Error(errData.error || `Error HTTP ${r.status}`);
                        }
                        audioBlob = await r.blob();
                    } else if (this._ttsProvider === 'openai') {
                        const r = await fetch('https://api.openai.com/v1/audio/speech', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ model: 'tts-1', input: text.slice(0,4096), voice: this._ttsOAIVoice, speed: this._ttsRate })
                        });
                        if (!r.ok) throw new Error(await r.text());
                        audioBlob = await r.blob();
                    } else if (this._ttsProvider === 'eleven') {
                        const voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel
                        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                            method: 'POST',
                            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: text.slice(0,5000), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
                        });
                        if (!r.ok) throw new Error(await r.text());
                        audioBlob = await r.blob();
                    }

                    if (this._ttsAudio) {
                        this._ttsAudio.pause();
                        this._ttsAudio = null;
                    }
                    if (this._ttsAudioUrl) {
                        URL.revokeObjectURL(this._ttsAudioUrl);
                        this._ttsAudioUrl = null;
                    }

                    const url = URL.createObjectURL(audioBlob);
                    this._ttsAudioUrl = url;
                    const audio = new Audio(url);
                    audio.playbackRate = this._ttsRate;
                    this._ttsAudio = audio;

                    audio.onplay = () => {
                        this._ttsSetPlayState(true);
                        this._ttsSetStatus('▶ Leyendo...');
                    };
                    audio.onended = () => {
                        this._ttsSetPlayState(false);
                        this._ttsSetStatus('✅ Finalizado');
                        if (this._ttsAudioUrl) {
                            URL.revokeObjectURL(this._ttsAudioUrl);
                            this._ttsAudioUrl = null;
                        }
                        this._ttsAudio = null;
                    };
                    audio.onerror = (e) => {
                        console.error('[TTS Audio Error]', e);
                        this._ttsSetPlayState(false);
                        this._ttsSetStatus('❌ Error al reproducir audio');
                    };

                    this._ttsSetStatus('▶ Reproduciendo...');
                    await audio.play();
                } catch(e) {
                    console.error('[TTS Play AI Error]', e);
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus('❌ ' + (e.message || e).toString().slice(0,60));
                }
            },

            ttsPause: function () {
                if (this._ttsAudio && !this._ttsAudio.paused) {
                    this._ttsAudio.pause();
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus('⏸ Pausado');
                    return;
                }
                const synth = window.speechSynthesis;
                if (synth && synth.speaking && !synth.paused) {
                    synth.pause();
                    this._ttsSetPlayState(false);
                    this._ttsSetStatus('⏸ Pausado');
                }
            },

            ttsStop: function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                if (this._ttsAudio) {
                    this._ttsAudio.pause();
                    this._ttsAudio.currentTime = 0;
                    this._ttsAudio = null;
                }
                if (this._ttsAudioUrl) {
                    URL.revokeObjectURL(this._ttsAudioUrl);
                    this._ttsAudioUrl = null;
                }
                this._ttsChunks = [];
                this._ttsChunkIdx = 0;
                this._ttsUtterance = null;
                this._ttsSetPlayState(false);
                this._ttsSetStatus('Listo');
            },
            // ── Fin TTS Widget ───────────────────────────────────────────

});
