        (function () {
            'use strict';
            if (window._officeConversionInitialized) return;
            window._officeConversionInitialized = true;

            // ══════════════════════════════════════════════════════════════
            //  PROXY OFFICE CONVERSION — Detección y conversión nativa
            // ══════════════════════════════════════════════════════════════
            const PROXY_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? window.location.origin : 'http://127.0.0.1:8765';
            const LS_KEY = 'alioth_office_software';

            async function getOfficeSoftware(forceRefresh = false) {
                if (!forceRefresh) {
                    try {
                        const cached = localStorage.getItem(LS_KEY);
                        if (cached) {
                            console.log('[Office] getOfficeSoftware → cache localStorage:', cached);
                            return JSON.parse(cached);
                        }
                    } catch (_) {}
                }
                console.log('[Office] getOfficeSoftware → fetching proxy /office-software (timeout 20s)...');
                try {
                    const r = await fetch(`${PROXY_BASE}/office-software`, { signal: AbortSignal.timeout(20000) });
                    const data = await r.json();
                    console.log('[Office] getOfficeSoftware → proxy response:', data);
                    localStorage.setItem(LS_KEY, JSON.stringify(data));
                    return data;
                } catch (err) {
                    console.warn('[Office] getOfficeSoftware → fetch falló:', err.message);
                    return null;
                }
            }

            // Mapa MIME → extensión para archivos Office
            const OFFICE_MIME_EXT = {
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                'application/vnd.ms-word.document.macroEnabled.12': '.docm',
                'application/msword': '.doc',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
                'application/vnd.ms-excel.sheet.macroEnabled.12': '.xlsm',
                'application/vnd.ms-excel.sheet.binary.macroEnabled.12': '.xlsb',
                'application/vnd.ms-excel': '.xls',
                'application/vnd.ms-excel.sheet': '.xlsx',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
                'application/vnd.ms-powerpoint.presentation.macroEnabled.12': '.pptm',
                'application/vnd.ms-powerpoint': '.ppt',
                'application/vnd.oasis.opendocument.text': '.odt',
                'application/vnd.oasis.opendocument.spreadsheet': '.ods',
                'application/vnd.oasis.opendocument.presentation': '.odp',
                'text/csv': '.csv',
                'application/rtf': '.rtf',
            };

            async function convertViaProxy(file, pageSetupParams = null) {
                let safeName = file.name;
                const hasExt = /\.[a-z0-9]{2,6}$/i.test(safeName);
                if (!hasExt && file.type && OFFICE_MIME_EXT[file.type]) {
                    safeName = safeName + OFFICE_MIME_EXT[file.type];
                } else if (hasExt) {
                    const ext = safeName.split('.').pop().toLowerCase();
                    const knownExts = ['docx','doc','docm','dotx','dotm','xlsx','xls','xlsm','xlsb','pptx','ppt','pptm','ppsx','odt','ods','odp','csv','rtf'];
                    if (!knownExts.includes(ext) && file.type && OFFICE_MIME_EXT[file.type]) {
                        safeName = safeName.replace(/\.[^.]+$/, OFFICE_MIME_EXT[file.type]);
                    }
                }
                console.log(`[Office] convertViaProxy → enviando "${safeName}" (${(file.size/1024).toFixed(1)} KB) al proxy...`);
                const form = new FormData();
                form.append('file', file, safeName);
                // Adjuntar parámetros de PageSetup si existen
                if (pageSetupParams) {
                    if (pageSetupParams.orientation) form.append('orientation', pageSetupParams.orientation);
                    if (pageSetupParams.fitWide != null) form.append('fitWide', String(pageSetupParams.fitWide));
                    if (pageSetupParams.fitTall  != null) form.append('fitTall',  String(pageSetupParams.fitTall));
                    if (pageSetupParams.zoom     != null) form.append('zoom',     String(pageSetupParams.zoom));
                    if (pageSetupParams.paperSize) form.append('paperSize', String(pageSetupParams.paperSize));
                }
                const r = await fetch(`${PROXY_BASE}/convert-office`, {
                    method: 'POST',
                    body: form,
                    signal: AbortSignal.timeout(180000)
                });
                console.log(`[Office] convertViaProxy → respuesta HTTP ${r.status}`);
                if (!r.ok) {
                    const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
                    throw new Error(err.error || `HTTP ${r.status}`);
                }
                const convertedBy = r.headers.get('X-Converted-By') || 'software de ofimatica';
                const blob = await r.blob();
                console.log(`[Office] convertViaProxy → PDF recibido: ${(blob.size/1024).toFixed(1)} KB, convertido por: ${convertedBy}`);
                return { blob, convertedBy };
            }

            // ══════════════════════════════════════════════════════════════
            //  UTILITY: Check if Office libraries are available
            // ══════════════════════════════════════════════════════════════
            function hasMammoth() { return typeof mammoth !== 'undefined'; }
            function hasXLSX() { return typeof XLSX !== 'undefined'; }

            // Office file extensions classification
            const OFFICE_EXTENSIONS = {
                word:  ['.docx', '.doc', '.docm', '.dotx', '.dotm', '.odt', '.rtf'],
                excel: ['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv'],
                ppt:   ['.pptx', '.ppt', '.pptm', '.ppsx', '.odp']
            };

            function getOfficeType(filename) {
                const ext = '.' + filename.split('.').pop().toLowerCase();
                if (OFFICE_EXTENSIONS.word.includes(ext)) return 'word';
                if (OFFICE_EXTENSIONS.excel.includes(ext)) return 'excel';
                if (OFFICE_EXTENSIONS.ppt.includes(ext)) return 'ppt';
                return null;
            }

            function isOfficeFile(filename) {
                return getOfficeType(filename) !== null;
            }

            // ══════════════════════════════════════════════════════════════
            //  EXCEL PAGE SETUP MODAL
            // ══════════════════════════════════════════════════════════════

            function _injectExcelModal() {
                if (document.getElementById('excel-pagesetup-modal')) return;
                const div = document.createElement('div');
                div.innerHTML = `
<div id="excel-pagesetup-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9998; align-items:center; justify-content:center;">
  <div id="excel-pagesetup-modal" class="glass-box" style="width:500px; max-width:95vw; padding:22px 26px; position:relative;">
    <h3 style="margin:0 0 14px; font-size:15px; color:var(--accent);">⚙️ Configuración de página — Excel a PDF</h3>

    <!-- Info previa -->
    <div id="xps-info" style="border:1px solid var(--border); border-radius:6px; padding:8px 12px; font-size:11px; margin-bottom:14px; min-height:32px;">
      <span id="xps-info-text" style="color:var(--text-dim);">🔍 Inspeccionando archivo...</span>
    </div>

    <!-- Orientación -->
    <div style="display:flex; gap:20px; margin-bottom:11px; font-size:12px; align-items:center;">
      <label style="font-weight:bold; color:var(--text-main); white-space:nowrap; min-width:80px;">Orientación:</label>
      <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:var(--text-main);">
        <input type="radio" name="xps-orient" value="Portrait" checked> 🗒 Vertical
      </label>
      <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color:var(--text-main);">
        <input type="radio" name="xps-orient" value="Landscape"> 🖥 Horizontal
      </label>
    </div>

    <!-- Tamaño de papel -->
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:11px; font-size:12px;">
      <label style="font-weight:bold; color:var(--text-main); white-space:nowrap; min-width:80px;">Papel:</label>
      <select id="xps-paper" style="padding:3px 6px; border:1px solid var(--border); border-radius:4px; background:var(--bg-ribbon); color:var(--text-main); font-size:11px; flex:1;">
        <option value="">— Sin cambiar —</option>
        <option value="1">Carta (Letter 8.5×11")</option>
        <option value="5">Legal (8.5×14")</option>
        <option value="9">A4 (210×297 mm)</option>
        <option value="11">A3 (297×420 mm)</option>
        <option value="8">A5 (148×210 mm)</option>
        <option value="18">Oficio / Folio (8.5×13")</option>
        <option value="24">Tabloide (11×17")</option>
      </select>
    </div>

    <!-- Ajuste de páginas -->
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:11px; font-size:12px; flex-wrap:wrap;">
      <label style="font-weight:bold; color:var(--text-main); white-space:nowrap; min-width:80px;">Ajustar a:</label>
      <input type="number" id="xps-fit-wide" placeholder="Ancho" min="0" max="99"
        style="width:52px; padding:3px 5px; border:1px solid var(--border); border-radius:4px; background:var(--bg-ribbon); color:var(--text-main); font-size:11px;">
      <span style="color:var(--text-dim);">págs ancho ×</span>
      <input type="number" id="xps-fit-tall" placeholder="Alto" min="0" max="99"
        style="width:52px; padding:3px 5px; border:1px solid var(--border); border-radius:4px; background:var(--bg-ribbon); color:var(--text-main); font-size:11px;">
      <span style="color:var(--text-dim);">págs alto &nbsp;<span style="font-size:10px;">(0 = auto)</span></span>
    </div>

    <!-- Escala % -->
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:16px; font-size:12px;">
      <label style="font-weight:bold; color:var(--text-main); white-space:nowrap; min-width:80px;">Escala:</label>
      <input type="number" id="xps-zoom" placeholder="—" min="10" max="400"
        style="width:58px; padding:3px 5px; border:1px solid var(--border); border-radius:4px; background:var(--bg-ribbon); color:var(--text-main); font-size:11px;">
      <span style="color:var(--text-dim);">% &nbsp;<span style="font-size:10px;">(vacío = usar ajuste de páginas)</span></span>
    </div>

    <!-- Botón edición manual -->
    <div style="border-top:1px solid var(--border); padding-top:13px; margin-bottom:14px;">
      <button id="xps-open-excel-btn" style="width:100%; padding:8px; border:1px dashed var(--accent); border-radius:6px; background:transparent; color:var(--accent); font-size:12px; cursor:pointer;">
        📊 Abrir en Excel para ajustar saltos de página manualmente
      </button>
      <div id="xps-waiting" style="display:none; text-align:center; margin-top:8px; font-size:11px; color:var(--text-dim);">
        ⏳ Excel abierto — guarda y cierra para continuar...
        <button id="xps-cancel-edit-btn" style="margin-left:10px; font-size:10px; padding:2px 8px; border:1px solid var(--border); border-radius:4px; cursor:pointer; background:transparent; color:var(--text-dim);">Cancelar</button>
      </div>
    </div>

    <!-- Acciones -->
    <div style="display:flex; gap:10px; justify-content:flex-end;">
      <button id="xps-cancel-btn" class="capsule-btn secondary">Cancelar</button>
      <button id="xps-convert-btn" class="capsule-btn primary">Convertir a PDF</button>
    </div>
  </div>
</div>`;
                document.body.appendChild(div.firstElementChild);
            }

            // Estado interno del modal
            let _xpsFile = null;
            let _xpsInsertMode = false;
            let _xpsSessionId = null;
            let _xpsPollingTimer = null;
            let _xpsTempPath = null; // ruta absoluta en servidor (enviada por inspect)

            async function _showExcelPageSetupModal(file, insertMode = false) {
                _injectExcelModal();
                _xpsFile = file;
                _xpsInsertMode = insertMode;
                _xpsSessionId = null;
                _xpsTempPath = null;

                const overlay = document.getElementById('excel-pagesetup-overlay');
                overlay.style.display = 'flex';

                // Resetear UI — defaults: carta, fit 1×1
                document.getElementById('xps-info-text').textContent = '🔍 Inspeccionando archivo...';
                document.getElementById('xps-waiting').style.display = 'none';
                document.getElementById('xps-open-excel-btn').style.display = '';
                document.getElementById('xps-fit-wide').value = '1';
                document.getElementById('xps-fit-tall').value = '1';
                document.getElementById('xps-zoom').value = '';
                document.getElementById('xps-paper').value = '1';  // Carta
                document.querySelector('input[name="xps-orient"][value="Portrait"]').checked = true;

                // Registrar handlers (una sola vez)
                _xpsBindHandlers();

                // Inspeccionar — necesitamos subir el archivo temporalmente al servidor
                // para que Python lea el PageSetup. Usamos el mismo endpoint /convert-office
                // con un flag especial, O hacemos inspect directo enviando el archivo.
                try {
                    const info = await _fetchExcelInspect(file);
                    if (info) {
                        const orient = info.orientation || 'Portrait';
                        const z = info.zoom ? `${info.zoom}%` : 'N/A';
                        const fw = info.fitToPagesWide || 0;
                        const ft = info.fitToPagesTall || 0;
                        const hb = info.hPageBreaks || 0;
                        const vb = info.vPageBreaks || 0;
                        document.getElementById('xps-info-text').innerHTML =
                            `📄 <b>Orientación:</b> ${orient} &nbsp;|&nbsp; <b>Zoom:</b> ${z} &nbsp;|&nbsp; ` +
                            `<b>Fit:</b> ${fw}×${ft} &nbsp;|&nbsp; <b>Saltos manuales:</b> H=${hb} V=${vb}`;
                        // Pre-llenar controles
                        document.querySelector(`input[name="xps-orient"][value="${orient}"]`).checked = true;
                        if (fw) document.getElementById('xps-fit-wide').value = fw;
                        if (ft) document.getElementById('xps-fit-tall').value = ft;
                        if (info.zoom) document.getElementById('xps-zoom').value = info.zoom;
                    }
                } catch (e) {
                    document.getElementById('xps-info-text').textContent = `⚠️ No se pudo inspeccionar: ${e.message}`;
                    console.warn('[XPS] inspect error:', e);
                }
            }

            async function _fetchExcelInspect(file) {
                // Subir archivo temporalmente para que el proxy lo inspeccione
                // Usamos endpoint /excel/inspect-upload (multipart → retorna JSON)
                const form = new FormData();
                form.append('file', file, file.name);
                try {
                    const r = await fetch(`${PROXY_BASE}/excel/inspect-upload`, {
                        method: 'POST', body: form,
                        signal: AbortSignal.timeout(45000)
                    });
                    if (!r.ok) return null;
                    const data = await r.json();
                    if (data.path) _xpsTempPath = data.path; // ruta temporal en servidor
                    return data;
                } catch (e) {
                    return null;
                }
            }

            let _xpsHandlersBound = false;
            function _xpsBindHandlers() {
                if (_xpsHandlersBound) return;
                _xpsHandlersBound = true;

                document.getElementById('xps-cancel-btn').onclick = () => {
                    _xpsCloseModal();
                };

                document.getElementById('xps-open-excel-btn').onclick = async () => {
                    if (!_xpsTempPath) {
                        // Si no tenemos ruta temporal (inspect falló o proxy no disponible),
                        // mostrar advertencia
                        alert('El proxy no está disponible o no pudo guardar el archivo temporalmente. Asegúrate de que el proxy está activo.');
                        return;
                    }
                    const btn = document.getElementById('xps-open-excel-btn');
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    try {
                        const r = await fetch(`${PROXY_BASE}/excel/open-for-edit`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: _xpsTempPath }),
                            signal: AbortSignal.timeout(10000)
                        });
                        const data = await r.json();
                        if (data.session_id) {
                            _xpsSessionId = data.session_id;
                            document.getElementById('xps-waiting').style.display = '';
                            btn.style.display = 'none';
                            _xpsStartPolling();
                        } else {
                            alert('Error al abrir Excel: ' + (data.error || 'desconocido'));
                            btn.disabled = false;
                            btn.style.opacity = '1';
                        }
                    } catch (e) {
                        alert('No se pudo conectar con el proxy: ' + e.message);
                        btn.disabled = false;
                        btn.style.opacity = '1';
                    }
                };

                document.getElementById('xps-cancel-edit-btn').onclick = () => {
                    _xpsStopPolling();
                    if (_xpsSessionId) {
                        fetch(`${PROXY_BASE}/excel/cancel-edit?session=${_xpsSessionId}`).catch(() => {});
                        _xpsSessionId = null;
                    }
                    document.getElementById('xps-waiting').style.display = 'none';
                    const btn = document.getElementById('xps-open-excel-btn');
                    btn.style.display = '';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                };

                document.getElementById('xps-convert-btn').onclick = async () => {
                    await _xpsDoConvert();
                };
            }

            function _xpsStartPolling() {
                _xpsStopPolling();
                _xpsPollingTimer = setInterval(async () => {
                    if (!_xpsSessionId) { _xpsStopPolling(); return; }
                    try {
                        const r = await fetch(`${PROXY_BASE}/excel/edit-status?session=${_xpsSessionId}`,
                            { signal: AbortSignal.timeout(5000) });
                        const data = await r.json();
                        if (data.status === 'closed') {
                            _xpsStopPolling();
                            // Refrescar info con datos actualizados
                            if (data.info) {
                                const info = data.info;
                                const orient = info.orientation || 'Portrait';
                                const z = info.zoom ? `${info.zoom}%` : 'N/A';
                                document.getElementById('xps-info-text').innerHTML =
                                    `✅ <b>Actualizado:</b> ${orient} | Zoom: ${z} | ` +
                                    `Fit: ${info.fitToPagesWide||0}×${info.fitToPagesTall||0} | ` +
                                    `Saltos: H=${info.hPageBreaks||0} V=${info.vPageBreaks||0}`;
                                // Pre-llenar controles con valores actualizados
                                const radio = document.querySelector(`input[name="xps-orient"][value="${orient}"]`);
                                if (radio) radio.checked = true;
                                if (info.fitToPagesWide) document.getElementById('xps-fit-wide').value = info.fitToPagesWide;
                                if (info.fitToPagesTall) document.getElementById('xps-fit-tall').value = info.fitToPagesTall;
                                if (info.zoom) document.getElementById('xps-zoom').value = info.zoom;
                            }
                            document.getElementById('xps-waiting').style.display = 'none';
                            const btn = document.getElementById('xps-open-excel-btn');
                            btn.style.display = '';
                            btn.disabled = false;
                            btn.style.opacity = '1';
                            btn.textContent = '📊 Volver a abrir en Excel';
                            _xpsSessionId = null;
                        }
                    } catch (e) {
                        console.warn('[XPS] polling error:', e.message);
                    }
                }, 2000);
            }

            function _xpsStopPolling() {
                if (_xpsPollingTimer) { clearInterval(_xpsPollingTimer); _xpsPollingTimer = null; }
            }

            function _xpsCloseModal() {
                _xpsStopPolling();
                if (_xpsSessionId) {
                    fetch(`${PROXY_BASE}/excel/cancel-edit?session=${_xpsSessionId}`).catch(() => {});
                    _xpsSessionId = null;
                }
                document.getElementById('excel-pagesetup-overlay').style.display = 'none';
                _xpsFile = null;
            }

            async function _xpsDoConvert() {
                if (!_xpsFile) return;
                const orient   = document.querySelector('input[name="xps-orient"]:checked')?.value || 'Portrait';
                const fitWide  = parseInt(document.getElementById('xps-fit-wide').value) || 0;
                const fitTall  = parseInt(document.getElementById('xps-fit-tall').value) || 0;
                const zoomVal  = parseInt(document.getElementById('xps-zoom').value) || 0;
                const paperVal = document.getElementById('xps-paper').value || '';

                const pageSetupParams = {
                    orientation: orient,
                    fitWide: fitWide || null,
                    fitTall: fitTall || null,
                    zoom:    (!fitWide && !fitTall && zoomVal) ? zoomVal : null,
                    paperSize: paperVal || null,
                };

                // Capturar antes de cerrar el modal
                const file = _xpsFile;
                const insertMode = _xpsInsertMode;

                // Solo cerrar UI — NO cancelar sesión Excel (proxy la necesita para convertir)
                _xpsStopPolling();
                _xpsSessionId = null;
                _xpsFile = null;
                document.getElementById('excel-pagesetup-overlay').style.display = 'none';

                if (window.app) {
                    app.toggleLoader(true, `🕒 Convirtiendo ${file.name}...`);
                }
                try {
                    const softwareInfo = await getOfficeSoftware();
                    if (softwareInfo && softwareInfo.software) {
                        const { blob, convertedBy } = await convertViaProxy(file, pageSetupParams);
                        const pdfFile = new File([blob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
                        pdfFile._convertedFromOffice = true;
                        pdfFile._sourceOfficeName = file.name;
                        pdfFile._aliothOriginalPath = await app.resolveFileOriginPath?.(file);
                        pdfFile._convertedBy = convertedBy;
                        pdfFile._nativeBlob = blob;
                        if (window.app) {
                            app.toggleLoader(false);
                            if (insertMode) {
                                await app.insertPDF(pdfFile);
                            } else {
                                await app.openFile(pdfFile);
                            }
                            app._showSaveConvertedToast(pdfFile);
                        }
                    } else {
                        // Fallback sin proxy
                        if (window.app) {
                            app.toggleLoader(false);
                            app.showToast('⚠️ Sin software nativo — convirtiendo en modo básico...');
                            await app.importOfficeFile(file, insertMode);
                        }
                    }
                } catch (e) {
                    if (window.app) {
                        app.toggleLoader(false);
                        app.showToast('❌ Error: ' + e.message);
                    }
                    console.error('[XPS] convert error:', e);
                }
            }

            // Cleanup en beforeunload para evitar Excel huérfano
            window.addEventListener('beforeunload', () => {
                if (_xpsSessionId) {
                    navigator.sendBeacon(`${PROXY_BASE}/excel/cancel-edit?session=${_xpsSessionId}`);
                }
            });

            // ══════════════════════════════════════════════════════════════
            //  smartOpenFile: Routes to openFile or importOfficeFile
            // ══════════════════════════════════════════════════════════════
            function waitForApp(cb) {
                if (window.app && typeof app.openFile === 'function') cb();
                else setTimeout(() => waitForApp(cb), 200);
            }

            waitForApp(function () {

                app.smartOpenFile = function (file) {
                    if (isOfficeFile(file.name)) {
                        return this.importOfficeFile(file);
                    } else {
                        return this.openFile(file);
                    }
                };

                // ══════════════════════════════════════════════════════════════
                //  WORD → PDF (using mammoth.js + jsPDF)
                // ══════════════════════════════════════════════════════════════
                app._convertWordToPDF = async function (file) {
                    if (!hasMammoth()) {
                        if (this.lazyLoad) await this.lazyLoad('mammoth');
                        else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('mammoth');
                    }
                    if (!hasMammoth()) {
                        this.showToast('⚠️ Librería mammoth.js no disponible. Descárgala para usar esta función offline.');
                        throw new Error('mammoth.js no cargada');
                    }

                    const arrayBuffer = await file.arrayBuffer();

                    // Convertir imágenes embebidas a data-URIs para que se vean en el iframe
                    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, {
                        styleMap: [
                            "p[style-name='Heading 1'] => h1:fresh",
                            "p[style-name='Heading 2'] => h2:fresh",
                            "p[style-name='Heading 3'] => h3:fresh",
                            "p[style-name='Heading 4'] => h4:fresh",
                            "p[style-name='Heading 5'] => h5:fresh",
                            "p[style-name='Heading 6'] => h6:fresh",
                            "p[style-name='Title']     => h1.doc-title:fresh",
                            "p[style-name='Subtitle']  => h2.doc-subtitle:fresh",
                            "p[style-name='List Bullet']   => ul > li:fresh",
                            "p[style-name='List Bullet 2'] => ul > li > ul > li:fresh",
                            "p[style-name='List Bullet 3'] => ul > li > ul > li > ul > li:fresh",
                            "p[style-name='List Number']   => ol > li:fresh",
                            "p[style-name='List Number 2'] => ol > li > ol > li:fresh",
                            "p[style-name='List Number 3'] => ol > li > ol > li > ol > li:fresh",
                            "p[style-name='Quote']         => blockquote:fresh",
                            "p[style-name='Intense Quote'] => blockquote.intense:fresh",
                            "p[style-name='Caption']       => p.caption:fresh",
                            "p[style-name='Normal']        => p:fresh",
                            "r[style-name='Strong']        => strong",
                            "r[style-name='Emphasis']      => em",
                            "r[style-name='Intense Emphasis'] => em.intense",
                            "b     => strong",
                            "i     => em",
                            "u     => u",
                            "strike => s",
                            "br[type='page'] => hr.page-break"
                        ],
                        convertImage: mammoth.images.imgElement(function (image) {
                            return image.read('base64').then(function (imageBase64) {
                                return { src: 'data:' + image.contentType + ';base64,' + imageBase64 };
                            });
                        })
                    });

                    const html = result.value;
                    if (result.messages.length > 0) {
                        console.warn('⚠️ Mammoth warnings:', result.messages);
                    }

                    return await this._htmlToPDF(html, file.name);
                };

                // ══════════════════════════════════════════════════════════════
                //  EXCEL → PDF (using SheetJS + jsPDF)
                // ══════════════════════════════════════════════════════════════
                app._convertExcelToPDF = async function (file) {
                    if (!hasXLSX()) {
                        if (this.lazyLoad) await this.lazyLoad('xlsx');
                        else if (window.app && window.app.lazyLoad) await window.app.lazyLoad('xlsx');
                    }
                    if (!hasXLSX()) {
                        this.showToast('No se pudo convertir el archivo Excel.');
                        throw new Error('SheetJS no cargada');
                    }

                    // Límites para evitar RangeError en hojas muy grandes
                    const MAX_ROWS = 1000;
                    const MAX_COLS = 50;

                    const arrayBuffer = await file.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });

                    /**
                     * Convierte un color ARGB de SheetJS (ej: "FF217346") a CSS hex ("#217346").
                     * Retorna null si no hay color válido.
                     */
                    function argbToCss(argb) {
                        if (!argb || typeof argb !== 'string') return null;
                        // Quitar alpha si está en formato AARRGGBB (8 chars)
                        const hex = argb.length === 8 ? argb.slice(2) : argb;
                        if (/^[0-9a-fA-F]{6}$/.test(hex)) return '#' + hex.toLowerCase();
                        return null;
                    }

                    /**
                     * Genera HTML fiel de tabla usando colores y estilos reales de SheetJS.
                     */
                    function sheetToStyledHtml(sheet) {
                        const ref = sheet['!ref'];
                        if (!ref) return '<p style="color:#999;font-style:italic">(Hoja vacía)</p>';

                        // Ancho de columnas
                        const colWidths = [];
                        if (sheet['!cols']) {
                            sheet['!cols'].forEach((col, i) => {
                                colWidths[i] = col && col.wpx ? Math.min(col.wpx, 220) : 80;
                            });
                        }

                        const range = XLSX.utils.decode_range(ref);
                        const endRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
                        const endCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
                        const totalRows = range.e.r - range.s.r + 1;
                        const totalCols = range.e.c - range.s.c + 1;

                        const parts = [];
                        parts.push('<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:9pt;width:auto;table-layout:fixed;">');

                        // Encabezado de columnas con anchos
                        parts.push('<colgroup>');
                        for (let C = range.s.c; C <= endCol; C++) {
                            const w = colWidths[C] || 80;
                            parts.push(`<col style="width:${w}px">`);
                        }
                        parts.push('</colgroup>');

                        for (let R = range.s.r; R <= endRow; R++) {
                            // Altura de fila
                            const rowH = sheet['!rows'] && sheet['!rows'][R] && sheet['!rows'][R].hpx
                                ? Math.min(sheet['!rows'][R].hpx, 60) : null;
                            const rowStyle = rowH ? `height:${rowH}px;` : '';
                            parts.push(`<tr style="${rowStyle}">`);

                            for (let C = range.s.c; C <= endCol; C++) {
                                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                                const cell = sheet[addr];

                                let val = '';
                                let cellStyle = 'border:1px solid #d0d0d0;padding:3px 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;vertical-align:middle;';

                                if (cell) {
                                    // Valor formateado
                                    val = cell.w !== undefined ? cell.w : (cell.v !== undefined ? String(cell.v) : '');
                                    val = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                                    // Estilos de celda (disponibles con cellStyles:true)
                                    const s = cell.s || {};
                                    const fill = s.fgColor || s.bgColor || s.patternType === 'solid' && s.fgColor;
                                    const bgArgb = s.fgColor ? s.fgColor.rgb || s.fgColor.theme : null;
                                    const fgArgb = s.font && s.font.color ? s.font.color.rgb : null;

                                    const bgCss = bgArgb ? argbToCss(bgArgb) : null;
                                    const fgCss = fgArgb ? argbToCss(fgArgb) : null;

                                    if (bgCss && bgCss !== '#000000') cellStyle += `background:${bgCss};`;
                                    if (fgCss) cellStyle += `color:${fgCss};`;

                                    // Negrita
                                    if (s.font && s.font.bold) cellStyle += 'font-weight:bold;';
                                    // Cursiva
                                    if (s.font && s.font.italic) cellStyle += 'font-style:italic;';
                                    // Alineación
                                    const align = s.alignment && s.alignment.horizontal;
                                    if (align === 'center') cellStyle += 'text-align:center;';
                                    else if (align === 'right') cellStyle += 'text-align:right;';
                                }

                                parts.push(`<td style="${cellStyle}">${val}</td>`);
                            }
                            parts.push('</tr>');
                        }
                        parts.push('</table>');

                        if (totalRows > MAX_ROWS || totalCols > MAX_COLS) {
                            const msgs = [];
                            if (totalRows > MAX_ROWS) msgs.push(`${totalRows} filas → mostrando ${MAX_ROWS}`);
                            if (totalCols > MAX_COLS) msgs.push(`${totalCols} columnas → mostrando ${MAX_COLS}`);
                            parts.push(`<p class="sheet-warning">⚠️ Hoja grande truncada: ${msgs.join(', ')}</p>`);
                        }

                        return parts.join('');
                    }

                    let allHtml = '';
                    workbook.SheetNames.forEach((sheetName, idx) => {
                        const sheet = workbook.Sheets[sheetName];
                        if (idx > 0) allHtml += '<div style="height:1px;margin:24px 0;border-top:2px solid #217346;page-break-before:always;"></div>';
                        allHtml += `<div class="sheet-title">${sheetName.replace(/</g, '&lt;')}</div>`;
                        allHtml += sheetToStyledHtml(sheet);
                    });

                    return await this._htmlToPDF(allHtml, file.name);
                };

                // ══════════════════════════════════════════════════════════════
                //  PPTX → PDF (basic slide extraction)
                // ══════════════════════════════════════════════════════════════
                app._convertPptToPDF = async function (file) {
                    this.showToast('📊 Extrayendo diapositivas...');
                    try {
                        const arrayBuffer = await file.arrayBuffer();

                        // PPTX es un ZIP — extraer XML de diapositivas con PyMuPDF/Python
                        PythonManager.pyodide.globals.set('_pptx_bytes', new Uint8Array(arrayBuffer));

                        const slidesJson = await PythonManager.pyodide.runPythonAsync(`
import zipfile, io, re, json

data = bytes(_pptx_bytes.to_py())
slides = []

try:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        slide_files = sorted(
            [n for n in z.namelist() if re.match(r'ppt/slides/slide\\d+\\.xml', n)],
            key=lambda x: int(re.search(r'\\d+', x.split('/')[-1]).group())
        )
        for sf in slide_files:
            xml = z.read(sf).decode('utf-8', errors='replace')
            # Extraer textos preservando párrafos (a:p) y runs (a:t)
            texts = []
            for para in re.findall(r'<a:p[^>]*>(.*?)</a:p>', xml, re.DOTALL):
                parts = re.findall(r'<a:t[^>]*>(.*?)</a:t>', para, re.DOTALL)
                line = ''.join(parts).strip()
                if line:
                    # Detectar si tiene formato grande (título probable)
                    sz_match = re.search(r'<a:sz val="(\\d+)"', para)
                    sz = int(sz_match.group(1)) if sz_match else 1800
                    texts.append({'text': line, 'sz': sz})
            slides.append(texts)
except Exception as ex:
    slides = [[ {'text': f'Error al leer PPTX: {ex}', 'sz': 1800} ]]

json.dumps(slides)
`);

                        const slides = JSON.parse(slidesJson);
                        let allHtml = '';

                        slides.forEach((blocks, idx) => {
                            if (idx > 0) allHtml += '<hr class="page-break">';
                            allHtml += `<div class="slide-header">Diapositiva ${idx + 1}</div>`;
                            if (!blocks.length) {
                                allHtml += '<p class="slide-empty">(Diapositiva sin texto)</p>';
                                return;
                            }
                            blocks.forEach(b => {
                                const emu = b.sz || 1800; // EMU = pt * 100
                                const ptSize = Math.round(emu / 100);
                                if (ptSize >= 28) {
                                    allHtml += `<h1 class="slide-title">${b.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</h1>`;
                                } else if (ptSize >= 20) {
                                    allHtml += `<h2 class="slide-h2">${b.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</h2>`;
                                } else if (ptSize >= 16) {
                                    allHtml += `<h3>${b.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</h3>`;
                                } else {
                                    allHtml += `<p>${b.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`;
                                }
                            });
                        });

                        // CSS extra para slides
                        const slideExtraHtml = `<style>
                            .slide-header { font-size:8pt; color:#aaa; text-transform:uppercase; letter-spacing:1px; margin-bottom:6pt; }
                            .slide-title  { font-size:24pt; color:#D24726; font-weight:bold; margin:0 0 8pt; }
                            .slide-h2     { font-size:18pt; color:#333; margin:6pt 0 4pt; }
                            .slide-empty  { color:#bbb; font-style:italic; }
                        </style>` + allHtml;

                        return await this._htmlToPDF(slideExtraHtml, file.name);
                    } catch (e) {
                        console.error('PPTX Conversion error:', e);
                        throw e;
                    }
                };

                // ══════════════════════════════════════════════════════════════
                //  HTML → PDF  (PyMuPDF Story — renderizado nativo HTML/CSS)
                //  PyMuPDF 1.21+ fitz.Story: HTML+CSS → PDF nativo.
                //  Sin canvas, sin restricciones de seguridad.
                // ══════════════════════════════════════════════════════════════
                app._htmlToPDF = async function (htmlContent, sourceFilename) {

                    if (!window.PythonManager || !PythonManager.isLoaded) {
                        await PythonManager.init();
                    }

                    // CSS base aplicado por PyMuPDF Story
                    const USER_CSS = [
                        'body        { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.4; margin: 0; padding: 0; }',
                        'h1          { font-size: 22pt; font-weight: bold; color: #1f3864; margin: 18pt 0 8pt; line-height: 1.2; }',
                        'h2          { font-size: 16pt; font-weight: bold; color: #2e4d7b; margin: 14pt 0 6pt; line-height: 1.2; }',
                        'h3          { font-size: 13pt; font-weight: bold; color: #333; margin: 10pt 0 4pt; }',
                        'h4          { font-size: 11pt; font-weight: bold; color: #555; margin: 8pt 0 3pt; }',
                        'h5, h6      { font-size: 10pt; font-weight: bold; color: #666; margin: 6pt 0 2pt; }',
                        'h1.doc-title    { font-size: 26pt; text-align: center; color: #1f3864; margin: 20pt 0 4pt; }',
                        'h2.doc-subtitle { font-size: 14pt; text-align: center; color: #666; font-weight: normal; margin: 0 0 16pt; }',
                        'p           { margin: 0 0 6pt; text-align: justify; orphans: 2; widows: 2; }',
                        'ul          { margin: 4pt 0 8pt; padding-left: 20pt; list-style-type: disc; }',
                        'ul ul       { list-style-type: circle; margin: 2pt 0; }',
                        'ul ul ul    { list-style-type: square; }',
                        'ol          { margin: 4pt 0 8pt; padding-left: 20pt; }',
                        'ol ol       { list-style-type: lower-alpha; margin: 2pt 0; }',
                        'li          { margin-bottom: 3pt; }',
                        'b, strong   { font-weight: bold; }',
                        'i, em       { font-style: italic; }',
                        'em.intense  { font-style: italic; color: #2e4d7b; }',
                        'u           { text-decoration: underline; }',
                        's           { text-decoration: line-through; }',
                        'blockquote  { margin: 8pt 0 8pt 16pt; padding: 4pt 8pt; border-left: 3pt solid #bbb; color: #555; font-style: italic; }',
                        'blockquote.intense { border-left-color: #2b579a; color: #2b579a; }',
                        'p.caption   { font-size: 9pt; color: #666; text-align: center; margin: 2pt 0 8pt; font-style: italic; }',
                        'table       { border-collapse: collapse; width: 100%; font-size: 10pt; margin: 8pt 0; }',
                        'th          { background-color: #dce6f0; color: #1f3864; font-weight: bold; padding: 5pt 7pt; border: 0.75pt solid #9ab3d5; text-align: left; }',
                        'td          { padding: 4pt 7pt; border: 0.5pt solid #c9c9c9; vertical-align: top; }',
                        'tr:nth-child(even) td { background-color: #f5f8fd; }',
                        '.sheet-title { font-size: 12pt; font-weight: bold; color: #217346; border-bottom: 1.5pt solid #217346; padding-bottom: 3pt; margin: 14pt 0 6pt; }',
                        '.sheet-warning { font-size: 8pt; color: #999; font-style: italic; margin: 4pt 0; }',
                        'img         { max-width: 80%; max-height: 400px; display: block; margin: 8pt auto; }',
                        'hr          { border: none; border-top: 0.75pt solid #ccc; margin: 10pt 0; }',
                        'hr.page-break { border-top: 1pt dashed #aaa; margin: 14pt 0; }',
                        'code, pre   { font-family: "Courier New", monospace; font-size: 9pt; background: #f4f4f4; padding: 1pt 3pt; border-radius: 2pt; }',
                        'pre         { display: block; padding: 8pt; margin: 6pt 0; white-space: pre-wrap; border: 0.5pt solid #ddd; }',
                    ].join(' ');

                    // Pasar datos a Python
                    PythonManager.pyodide.globals.set('_html_content', htmlContent);
                    PythonManager.pyodide.globals.set('_user_css', USER_CSS);

                    const pdfBase64 = await PythonManager.pyodide.runPythonAsync(`
        import fitz, base64, io
        
        html_content = _html_content
        user_css     = _user_css
        
        # Envolver en documento HTML completo
        full_html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + html_content + '</body></html>'
        
        # Dimensiones A4 en puntos (72 pt = 1 pulgada)
        A4_W = 595.28
        A4_H = 841.89
        MARGIN = 42  # pt
        
        mediabox = fitz.Rect(0, 0, A4_W, A4_H)
        where    = fitz.Rect(MARGIN, MARGIN, A4_W - MARGIN, A4_H - MARGIN)
        
        story = fitz.Story(html=full_html, user_css=user_css, em=11)
        
        pdf_buf = io.BytesIO()
        writer  = fitz.DocumentWriter(pdf_buf)
        
        more = True
        while more:
            device = writer.begin_page(mediabox)
            more, _ = story.place(where)
            story.draw(device)
            writer.end_page()
        
        writer.close()
        pdf_buf.seek(0)
        base64.b64encode(pdf_buf.read()).decode('ascii')
`);

                    // base64 → Uint8Array → Blob
                    const raw = atob(pdfBase64);
                    const bytes = new Uint8Array(raw.length);
                    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

                    const hdr = String.fromCharCode(...bytes.slice(0, 5));
                    if (!hdr.startsWith('%PDF-')) {
                        throw new Error('PyMuPDF Story: estructura PDF invalida.');
                    }

                    return new Blob([bytes], { type: 'application/pdf' });
                };

                // ══════════════════════════════════════════════════════════════
                //  showOfficeImportModal: Modal for importing Office files
                // ══════════════════════════════════════════════════════════════
                app.showOfficeImportModal = function () {
                    this.closeAllModals();

                    const modal = document.createElement('div');
                    modal.id = 'office-import-modal';
                    modal.className = 'glass-overlay';
                    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; z-index:15000; background:rgba(0,0,0,0.5);';

                    modal.innerHTML = `
                <div style="background:var(--bg-panel); border-radius:16px; padding:30px; max-width:500px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.4); border:1px solid var(--border); color:var(--text-main);">
                    <h2 style="margin:0 0 20px; font-size:18px; display:flex; align-items:center; gap:10px;">
                        <svg viewBox="0 0 24 24" style="width:28px; height:28px; fill:none; stroke:#2B579A; stroke-width:2;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        Importar Documento Office
                    </h2>

                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px;">
                        <label style="display:flex; flex-direction:column; align-items:center; padding:16px 10px; border:2px dashed var(--border); border-radius:12px; cursor:pointer; transition:0.2s;" onmouseover="this.style.borderColor='#2B579A'; this.style.background='rgba(43,87,154,0.05)'" onmouseout="this.style.borderColor='var(--border)'; this.style.background='transparent'">
                            <input type="file" accept=".docx,.doc" onchange="if(this.files.length){app.importOfficeFile(this.files[0]);app.closeAllModals()}" style="display:none;">
                            <svg viewBox="0 0 24 24" style="width:40px; height:40px; margin-bottom:8px;">
                                <rect x="2" y="3" width="20" height="18" rx="2" fill="#2B579A"/>
                                <text x="12" y="15" text-anchor="middle" font-size="10" font-weight="700" font-family="Arial" fill="white">W</text>
                            </svg>
                            <span style="font-size:11px; font-weight:600;">Word</span>
                            <span style="font-size:9px; opacity:0.6;">.docx .doc</span>
                        </label>

                        <label style="display:flex; flex-direction:column; align-items:center; padding:16px 10px; border:2px dashed var(--border); border-radius:12px; cursor:pointer; transition:0.2s;" onmouseover="this.style.borderColor='#217346'; this.style.background='rgba(33,115,70,0.05)'" onmouseout="this.style.borderColor='var(--border)'; this.style.background='transparent'">
                            <input type="file" accept=".xlsx,.xls" onchange="if(this.files.length){app.importOfficeFile(this.files[0]);app.closeAllModals()}" style="display:none;">
                            <svg viewBox="0 0 24 24" style="width:40px; height:40px; margin-bottom:8px;">
                                <rect x="2" y="3" width="20" height="18" rx="2" fill="#217346"/>
                                <text x="12" y="15" text-anchor="middle" font-size="10" font-weight="700" font-family="Arial" fill="white">X</text>
                            </svg>
                            <span style="font-size:11px; font-weight:600;">Excel</span>
                            <span style="font-size:9px; opacity:0.6;">.xlsx .xls</span>
                        </label>

                        <label style="display:flex; flex-direction:column; align-items:center; padding:16px 10px; border:2px dashed var(--border); border-radius:12px; cursor:pointer; transition:0.2s;" onmouseover="this.style.borderColor='#D24726'; this.style.background='rgba(210,71,38,0.05)'" onmouseout="this.style.borderColor='var(--border)'; this.style.background='transparent'">
                            <input type="file" accept=".pptx,.ppt" onchange="if(this.files.length){app.importOfficeFile(this.files[0]);app.closeAllModals()}" style="display:none;">
                            <svg viewBox="0 0 24 24" style="width:40px; height:40px; margin-bottom:8px;">
                                <rect x="2" y="3" width="20" height="18" rx="2" fill="#D24726"/>
                                <text x="12" y="15" text-anchor="middle" font-size="10" font-weight="700" font-family="Arial" fill="white">P</text>
                            </svg>
                            <span style="font-size:11px; font-weight:600;">PowerPoint</span>
                            <span style="font-size:9px; opacity:0.6;">.pptx .ppt</span>
                        </label>
                    </div>

                    <div style="border-top:1px solid var(--border); padding-top:15px; margin-top:5px;">
                        <h3 style="font-size:13px; margin:0 0 10px; display:flex; align-items:center; gap:6px;">📎 Insertar en documento actual</h3>
                        <label style="display:flex; align-items:center; gap:10px; padding:10px; border:1px solid var(--border); border-radius:8px; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.03)'" onmouseout="this.style.background='transparent'">
                            <input type="file" accept=".docx,.doc,.xlsx,.xls,.pptx,.ppt" onchange="if(this.files.length){app.importOfficeFile(this.files[0], true);app.closeAllModals()}" style="display:none;">
                            <svg viewBox="0 0 24 24" style="width:24px; height:24px; fill:none; stroke:currentColor; stroke-width:2;"><path d="M12 5v14M5 12h14"/></svg>
                            <div>
                                <span style="font-size:12px; font-weight:600;">Insertar archivo Office como páginas PDF</span><br>
                                <span style="font-size:10px; opacity:0.6;">Se convierte y se añade al documento abierto</span>
                            </div>
                        </label>
                    </div>

                    <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                        <button onclick="app.closeAllModals()" style="padding:8px 20px; border-radius:8px; border:1px solid var(--border); background:var(--bg-ribbon); cursor:pointer; font-weight:600; color:var(--text-main);">Cerrar</button>
                    </div>
                </div>
            `;

                    modal.addEventListener('click', (e) => { if (e.target === modal) app.closeAllModals(); });
                    document.body.appendChild(modal);
                };

                // ══════════════════════════════════════════════════════════════
                //  exportToWord: PDF → DOCX mediante reflujo nativo de Word
                // ══════════════════════════════════════════════════════════════
                app.exportToWord = async function () {
                    const doc = this.getDoc();
                    if (!doc || !doc.pages.length) {
                        this.showToast('⚠️ Abre un PDF primero');
                        return;
                    }

                    this.toggleLoader(true);
                    this.showToast('📝 Reconstruyendo Word editable...');

                    try {
                        const pdfBytes = await this.savePDFInternal(false, null, false, true);
                        if (!pdfBytes) throw new Error('No se pudo preparar el PDF actual');
                        const form = new FormData();
                        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'documento.pdf');
                        const response = await fetch(`${PROXY_BASE}/convert-pdf-to-word`, {
                            method: 'POST', body: form, signal: AbortSignal.timeout(180000)
                        });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || 'Word no pudo convertir el PDF');
                        }
                        const docxBlob = await response.blob();
                        const filename = (doc.name || 'documento').replace(/\.pdf$/i, '') + '.docx';
                        saveAs(docxBlob, filename);
                        this.showToast('✅ Exportado a Word con texto y números editables.');
                    } catch (e) {
                        console.error('Export to Word error:', e);
                        this.showToast('❌ Error al exportar: ' + e.message);
                    }
                    this.toggleLoader(false);
                };

                // ══════════════════════════════════════════════════════════════
                //  _generateDOCX: Creates a valid .docx ZIP archive
                // ══════════════════════════════════════════════════════════════
                app._generateDOCX = function (text, title) {
                    // A DOCX file is a ZIP containing XML files
                    // We'll create a minimal but valid DOCX structure

                    // Escape XML special characters
                    function escXml(s) {
                        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
                    }

                    // Split text into paragraphs
                    const paragraphs = text.split('\n').map(line => {
                        const trimmed = line.trim();
                        if (!trimmed) return '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';

                        // Detect page separators
                        if (trimmed.startsWith('--- Página') && trimmed.endsWith('---')) {
                            return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:color w:val="2B579A"/></w:rPr><w:t>${escXml(trimmed)}</w:t></w:r></w:p>`;
                        }

                        return `<w:p><w:r><w:t xml:space="preserve">${escXml(trimmed)}</w:t></w:r></w:p>`;
                    }).join('\n');

                    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

                    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

                    const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

                    const document_xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escXml(title)}</w:t></w:r></w:p>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;

                    // Build ZIP manually using a minimal implementation
                    // Since we can't guarantee JSZip is available, we use a raw ZIP builder
                    return this._buildZip([
                        { name: '[Content_Types].xml', content: contentTypes },
                        { name: '_rels/.rels', content: rels },
                        { name: 'word/_rels/document.xml.rels', content: wordRels },
                        { name: 'word/document.xml', content: document_xml }
                    ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                };

                // ══════════════════════════════════════════════════════════════
                //  _buildZip: Minimal ZIP file builder (no dependencies)
                // ══════════════════════════════════════════════════════════════
                app._buildZip = function (files, mimeType) {
                    // Minimal ZIP format implementation
                    const encoder = new TextEncoder();
                    const parts = [];
                    const centralDir = [];
                    let offset = 0;

                    function crc32(data) {
                        let crc = 0xFFFFFFFF;
                        const table = [];
                        for (let i = 0; i < 256; i++) {
                            let c = i;
                            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                            table[i] = c;
                        }
                        for (let i = 0; i < data.length; i++) {
                            crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
                        }
                        return (crc ^ 0xFFFFFFFF) >>> 0;
                    }

                    function u16(n) { return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]); }
                    function u32(n) { return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]); }

                    for (const file of files) {
                        const nameBytes = encoder.encode(file.name);
                        const dataBytes = file.content instanceof Uint8Array ? file.content : encoder.encode(file.content);
                        const crc = crc32(dataBytes);

                        // Local file header
                        const localHeader = new Uint8Array([
                            0x50, 0x4B, 0x03, 0x04,  // signature
                            0x14, 0x00,              // version needed (2.0)
                            0x00, 0x00,              // flags
                            0x00, 0x00,              // compression: stored
                            0x00, 0x00,              // mod time
                            0x00, 0x00,              // mod date
                            ...u32(crc),             // crc32
                            ...u32(dataBytes.length), // compressed size
                            ...u32(dataBytes.length), // uncompressed size
                            ...u16(nameBytes.length), // filename length
                            0x00, 0x00               // extra field length
                        ]);

                        // Central directory entry
                        const centralEntry = new Uint8Array([
                            0x50, 0x4B, 0x01, 0x02,  // signature
                            0x14, 0x00,              // version made by
                            0x14, 0x00,              // version needed
                            0x00, 0x00,              // flags
                            0x00, 0x00,              // compression
                            0x00, 0x00,              // mod time
                            0x00, 0x00,              // mod date
                            ...u32(crc),
                            ...u32(dataBytes.length),
                            ...u32(dataBytes.length),
                            ...u16(nameBytes.length),
                            0x00, 0x00,              // extra field length
                            0x00, 0x00,              // comment length
                            0x00, 0x00,              // disk number
                            0x00, 0x00,              // internal attrs
                            0x00, 0x00, 0x00, 0x00,  // external attrs
                            ...u32(offset)           // relative header offset
                        ]);

                        parts.push(localHeader, nameBytes, dataBytes);
                        centralDir.push(centralEntry, nameBytes);
                        offset += localHeader.length + nameBytes.length + dataBytes.length;
                    }

                    const centralDirOffset = offset;
                    let centralDirSize = 0;
                    centralDir.forEach(p => centralDirSize += p.length);

                    // End of central directory
                    const eocd = new Uint8Array([
                        0x50, 0x4B, 0x05, 0x06,
                        0x00, 0x00,  // disk number
                        0x00, 0x00,  // disk with central dir
                        ...u16(files.length),
                        ...u16(files.length),
                        ...u32(centralDirSize),
                        ...u32(centralDirOffset),
                        0x00, 0x00   // comment length
                    ]);

                    const allParts = [...parts, ...centralDir, eocd];
                    const totalSize = allParts.reduce((sum, p) => sum + p.length, 0);
                    const result = new Uint8Array(totalSize);
                    let pos = 0;
                    for (const p of allParts) { result.set(p, pos); pos += p.length; }

                    return new Blob([result], { type: mimeType || 'application/zip' });
                };

                app._renderPDFPagesForOffice = async function (doc) {
                    const pages = [];
                    for (let i = 0; i < doc.pages.length; i++) {
                        const page = doc.pages[i];
                        const src = doc.sources[page.sourceId];
                        if (!src?.doc) continue;
                        const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                        const viewport = pdfPage.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.ceil(viewport.width);
                        canvas.height = Math.ceil(viewport.height);
                        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
                        if (!blob) throw new Error('No se pudo renderizar una página del PDF.');
                        pages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: viewport.width / 1.5, height: viewport.height / 1.5 });
                    }
                    return pages;
                };

                app._generateHybridDOCX = function (pages, editableText, title) {
                    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    const rels = pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i + 1}.jpg"/>`).join('');
                    const visual = pages.map((p, i) => {
                        const maxWidth = 6.5 * 914400;
                        const ratio = Math.min(maxWidth / (p.width * 12700), 9.0 * 914400 / (p.height * 12700));
                        const cx = Math.round(p.width * 12700 * ratio), cy = Math.round(p.height * 12700 * ratio);
                        return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Página ${i + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="Página ${i + 1}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${i + 1}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${i < pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}`;
                    }).join('');
                    const editable = editableText.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${esc(line || ' ')}</w:t></w:r></w:p>`).join('');
                    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${esc(title)}</w:t></w:r></w:p>${visual}<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Contenido editable extraído</w:t></w:r></w:p>${editable}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`;
                    const files = [
                        { name: '[Content_Types].xml', content: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
                        { name: '_rels/.rels', content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
                        { name: 'word/document.xml', content: documentXml },
                        { name: 'word/_rels/document.xml.rels', content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` }
                    ];
                    pages.forEach((p, i) => files.push({ name: `word/media/page${i + 1}.jpg`, content: p.bytes }));
                    return this._buildZip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                };

                // ══════════════════════════════════════════════════════════════
                //  exportToExcel: PDF → XLSX (texto, líneas y fondos vectoriales)
                // ══════════════════════════════════════════════════════════════
                app.exportToExcel = async function () {
                    const doc = this.getDoc();
                    if (!doc || !doc.pages.length) {
                        this.showToast('⚠️ Abre un PDF primero');
                        return;
                    }

                    this.toggleLoader(true);
                    this.showToast('📊 Reconstruyendo cuadrícula editable para Excel...');

                    try {
                        const pdfBytes = await this.savePDFInternal(false, null, false, true);
                        const form = new FormData();
                        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'documento.pdf');
                        const response = await fetch(`${PROXY_BASE}/convert-pdf-to-excel`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || 'No se pudo reconstruir el Excel');
                        }
                        const filename = (doc.name || 'documento').replace(/\.pdf$/i, '') + '.xlsx';
                        saveAs(await response.blob(), filename);
                        this.showToast('✅ Exportado a Excel: ' + filename);
                    } catch (e) {
                        console.error('Export to Excel error:', e);
                        this.showToast('❌ Error al exportar: ' + e.message);
                    }
                    this.toggleLoader(false);
                };

                app.exportToExcelAI = async function () {
                    const doc = this.getDoc();
                    if (!doc || !doc.pages.length) return this.showToast('⚠️ Abre un PDF primero');
                    const progressBox = document.getElementById('excel-ai-progress');
                    const progressBar = document.getElementById('excel-ai-progress-bar');
                    const progressLabel = document.getElementById('excel-ai-progress-label');
                    const progressTitle = document.getElementById('office-ai-progress-title');
                    if (progressTitle) progressTitle.textContent = 'Excel con IA';
                    const setProgress = (value, label) => {
                        if (progressBox) progressBox.style.display = 'block';
                        if (progressBar) progressBar.style.width = value + '%';
                        if (progressLabel) progressLabel.textContent = label;
                    };
                    let progress = 8;
                    setProgress(progress, 'Preparando PDF…');
                    const timer = setInterval(() => {
                        progress = Math.min(86, progress + (progress < 35 ? 5 : 2));
                        setProgress(progress, progress < 35 ? 'Enviando página a IA…' : 'IA analizando formato y celdas…');
                    }, 1600);
                    try {
                        const pdfBytes = await this.savePDFInternal(false, null, false, true);
                        setProgress(30, 'Enviando página a IA…');
                        const form = new FormData();
                        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'documento.pdf');
                        const response = await fetch(`${PROXY_BASE}/convert-pdf-to-excel-ai`, { method: 'POST', body: form, signal: AbortSignal.timeout(300000) });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || 'La IA no pudo reconstruir el Excel');
                        }
                        setProgress(94, 'Reconstruyendo Excel…');
                        const filename = (doc.name || 'documento').replace(/\.pdf$/i, '') + '_IA.xlsx';
                        saveAs(await response.blob(), filename);
                        setProgress(100, 'Excel listo');
                        this.showToast('✅ Exportado con IA: ' + filename);
                        setTimeout(() => { if (progressBox) progressBox.style.display = 'none'; }, 2200);
                    } catch (e) {
                        console.error('Export to Excel AI error:', e);
                        setProgress(progress, 'Error: ' + e.message);
                        this.showToast('❌ Error IA: ' + e.message);
                    } finally {
                        clearInterval(timer);
                    }
                };

                app.showOfficeAIModal = function () {
                    const modal = document.createElement('div');
                    modal.id = 'office-ai-modal';
                    modal.style.cssText = 'position:fixed;inset:0;z-index:100006;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.48);backdrop-filter:blur(3px);';
                    modal.innerHTML = `
                        <div style="width:390px;padding:22px;border:1px solid rgba(139,92,246,.45);border-radius:14px;background:var(--bg-main,#182236);box-shadow:0 18px 45px rgba(0,0,0,.38);color:#fff;">
                            <div style="font-size:18px;font-weight:800;color:#fff;">Office con IA</div>
                            <div style="margin:6px 0 18px;font-size:12px;color:rgba(255,255,255,.8);">Selecciona el formato editable a reconstruir.</div>
                            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                                <button class="capsule-btn" style="background:#217346;border-color:#217346;color:#fff;" onclick="app.runOfficeAI('excel')">Excel</button>
                                <button class="capsule-btn" style="background:#2b579a;border-color:#2b579a;color:#fff;" onclick="app.runOfficeAI('word')">Word</button>
                                <button class="capsule-btn" style="background:#d24726;border-color:#d24726;color:#fff;" onclick="app.runOfficeAI('pptx')">PowerPoint</button>
                            </div>
                            <div style="display:flex;justify-content:flex-end;margin-top:18px;"><button class="capsule-btn" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.34);" onclick="document.getElementById('office-ai-modal')?.remove()">Cancelar</button></div>
                        </div>`;
                    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
                    document.body.appendChild(modal);
                };

                app.runOfficeAI = async function (target) {
                    document.getElementById('office-ai-modal')?.remove();
                    if (target === 'excel') return this.exportToExcelAI();
                    const doc = this.getDoc();
                    if (!doc || !doc.pages.length) return this.showToast('⚠️ Abre un PDF primero');
                    const progressBox = document.getElementById('excel-ai-progress');
                    const progressBar = document.getElementById('excel-ai-progress-bar');
                    const progressLabel = document.getElementById('excel-ai-progress-label');
                    const progressTitle = document.getElementById('office-ai-progress-title');
                    const label = target === 'word' ? 'Word' : 'PowerPoint';
                    const setProgress = (value, text) => {
                        if (progressBox) progressBox.style.display = 'block';
                        if (progressBar) progressBar.style.width = value + '%';
                        if (progressLabel) progressLabel.textContent = text;
                        if (progressTitle) progressTitle.textContent = label + ' con IA';
                    };
                    let progress = 8;
                    setProgress(progress, 'Preparando PDF…');
                    const timer = setInterval(() => {
                        progress = Math.min(86, progress + (progress < 35 ? 5 : 2));
                        setProgress(progress, 'IA reconstruyendo texto y formato…');
                    }, 1600);
                    try {
                        const pdfBytes = await this.savePDFInternal(false, null, false, true);
                        setProgress(30, 'Enviando página a IA…');
                        const form = new FormData();
                        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'documento.pdf');
                        const response = await fetch(`${PROXY_BASE}/convert-pdf-to-${target}-ai`, { method: 'POST', body: form, signal: AbortSignal.timeout(300000) });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || `La IA no pudo reconstruir ${label}`);
                        }
                        setProgress(94, `Generando ${label} editable…`);
                        const extension = target === 'word' ? 'docx' : 'pptx';
                        const filename = (doc.name || 'documento').replace(/\.pdf$/i, '') + `_IA.${extension}`;
                        saveAs(await response.blob(), filename);
                        setProgress(100, `${label} listo`);
                        this.showToast(`✅ Exportado con IA: ${filename}`);
                        setTimeout(() => { if (progressBox) progressBox.style.display = 'none'; }, 2200);
                    } catch (error) {
                        console.error(`Export to ${label} AI error:`, error);
                        setProgress(progress, 'Error: ' + error.message);
                        this.showToast('❌ Error IA: ' + error.message);
                    } finally {
                        clearInterval(timer);
                    }
                };

                app.exportToPptx = async function () {
                    const doc = this.getDoc();
                    if (!doc || !doc.pages.length) return this.showToast('⚠️ Abre un PDF primero');
                    this.toggleLoader(true);
                    this.showToast('📽️ Generando diapositivas PowerPoint...');
                    try {
                        const pdfBytes = await this.savePDFInternal(false, null, false, true);
                        const form = new FormData();
                        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'documento.pdf');
                        const response = await fetch(`${PROXY_BASE}/convert-pdf-to-pptx`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
                        if (!response.ok) {
                            const err = await response.json().catch(() => ({}));
                            throw new Error(err.error || 'No se pudo generar el PPTX');
                        }
                        const filename = (doc.name || 'documento').replace(/\.pdf$/i, '') + '.pptx';
                        saveAs(await response.blob(), filename);
                        this.showToast('✅ Exportado a PowerPoint: ' + filename);
                    } catch (e) {
                        console.error('Export to PowerPoint error:', e);
                        this.showToast('❌ Error al exportar: ' + e.message);
                    }
                    this.toggleLoader(false);
                };

                // ══════════════════════════════════════════════════════════════
                //  Patch openFile, insertPDF & resolveSidebarDrop
                //  to handle Office files transparently
                // ══════════════════════════════════════════════════════════════

                // Save originals BEFORE patching
                const _origOpenFile = app.openFile.bind(app);
                const _origInsertPDF = app.insertPDF.bind(app);

                // Helper: convert Office file to PDF File object
                async function officeFileToPDF(file) {
                    const type = getOfficeType(file.name);
                    console.log(`[Office] officeFileToPDF → archivo="${file.name}" tipo="${type}"`);
                    if (!type) return null;

                    // 1. Intentar conversión nativa via proxy
                    let softwareInfo = await getOfficeSoftware();
                    console.log(`[Office] officeFileToPDF → softwareInfo=`, softwareInfo);

                    if (softwareInfo && softwareInfo.software) {
                        try {
                            app.showToast(`🔄 Convirtiendo con ${softwareInfo.name}...`);
                            const { blob, convertedBy } = await convertViaProxy(file);
                            const pdfFile = new File([blob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
                            pdfFile._convertedFromOffice = true;
                            pdfFile._sourceOfficeName = file.name;
                            pdfFile._aliothOriginalPath = await app.resolveFileOriginPath?.(file);
                            pdfFile._convertedBy = convertedBy;
                            pdfFile._nativeBlob = blob;
                            console.log(`[Office] officeFileToPDF → ✅ conversión nativa OK`);
                            return pdfFile;
                        } catch (e) {
                            console.warn('⚠️ Conversión nativa falló, invalidando cache:', e.message);
                            localStorage.removeItem(LS_KEY);
                            softwareInfo = await getOfficeSoftware(true);
                            console.log('[Office] officeFileToPDF → re-detección tras fallo:', softwareInfo);
                        }
                    } else {
                        console.warn('[Office] officeFileToPDF → sin software nativo, usando fallback');
                        app.showToast('⚠️ Sin software de ofimatica instalado. Convirtiendo en modo básico (puede perder imágenes y formato)...');
                        await new Promise(r => setTimeout(r, 2200));
                    }

                    // 2. Fallback: conversión HTML→PDF existente
                    console.log('[Office] officeFileToPDF → ejecutando fallback mammoth/SheetJS...');
                    let pdfBlob;
                    switch (type) {
                        case 'word':  pdfBlob = await app._convertWordToPDF(file);  break;
                        case 'excel': pdfBlob = await app._convertExcelToPDF(file); break;
                        case 'ppt':   pdfBlob = await app._convertPptToPDF(file);   break;
                        default: return null;
                    }
                    if (!pdfBlob) return null;
                    const pdfFile = new File([pdfBlob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
                    pdfFile._convertedFromOffice = true;
                    pdfFile._sourceOfficeName = file.name;
                    pdfFile._aliothOriginalPath = await app.resolveFileOriginPath?.(file);
                    return pdfFile;
                }

                // Patch openFile: detect Office → para xlsx mostrar modal, resto convertir directo
                const _xlsExts = ['.xlsx', '.xls', '.xlsm', '.xlsb'];
                function _isExcelFile(name) {
                    return _xlsExts.includes('.' + name.split('.').pop().toLowerCase());
                }

                app.openFile = async function (file) {
                    if (isOfficeFile(file.name)) {
                        // Excel con proxy nativo → mostrar modal de configuración
                        if (_isExcelFile(file.name)) {
                            const si = await getOfficeSoftware();
                            if (si && si.software) {
                                await _showExcelPageSetupModal(file, false);
                                return;
                            }
                        }
                        this.toggleLoader(true, '🕒 Convirtiendo ' + file.name + '...');
                        const pdfFile = await officeFileToPDF(file);
                        this.toggleLoader(false);
                        if (pdfFile) {
                            await _origOpenFile(pdfFile);
                            if (pdfFile._convertedBy) {
                                this._showSaveConvertedToast(pdfFile);
                            } else {
                                this.showToast('✅ ' + file.name + ' abierto (modo básico)');
                            }
                        } else {
                            this.showToast('❌ No se pudo convertir ' + file.name);
                        }
                        return;
                    }
                    return _origOpenFile(file);
                };

                // Patch insertPDF: igual
                app.insertPDF = async function (file, targetIndex) {
                    if (isOfficeFile(file.name)) {
                        if (_isExcelFile(file.name)) {
                            const si = await getOfficeSoftware();
                            if (si && si.software) {
                                await _showExcelPageSetupModal(file, true);
                                return;
                            }
                        }
                        this.toggleLoader(true, '🕒 Convirtiendo ' + file.name + '...');
                        const pdfFile = await officeFileToPDF(file);
                        this.toggleLoader(false);
                        if (pdfFile) {
                            await _origInsertPDF(pdfFile, targetIndex);
                            if (pdfFile._convertedBy) {
                                this._showSaveConvertedToast(pdfFile);
                            } else {
                                this.showToast('✅ ' + file.name + ' insertado (modo básico)');
                            }
                        } else {
                            this.showToast('❌ No se pudo convertir ' + file.name);
                        }
                        return;
                    }
                    return _origInsertPDF(file, targetIndex);
                };

                // Also update importOfficeFile to use the ORIGINAL functions
                // (avoids infinite recursion through the patched versions)
                app.importOfficeFile = async function (file, insertMode = false) {
                    const type = getOfficeType(file.name);
                    if (!type) {
                        this.showToast('⚠️ Formato no reconocido: ' + file.name);
                        return;
                    }

                    // Para archivos Excel: mostrar modal de configuración de página
                    const xlsExts = ['.xlsx', '.xls', '.xlsm', '.xlsb'];
                    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
                    const isExcel = xlsExts.includes(fileExt);
                    const softwareInfo = await getOfficeSoftware();
                    const hasNative = softwareInfo && softwareInfo.software;

                    if (isExcel && hasNative) {
                        await _showExcelPageSetupModal(file, insertMode);
                        return; // La conversión la dispara el botón del modal
                    }

                    this.toggleLoader(true, '🕒 Convirtiendo ' + file.name + '...');
                    try {
                        const pdfFile = await officeFileToPDF(file);
                        this.toggleLoader(false);
                        if (!pdfFile) {
                            this.showToast('❌ No se pudo convertir el archivo');
                            return;
                        }

                        if (insertMode) {
                            await _origInsertPDF(pdfFile);
                        } else {
                            await _origOpenFile(pdfFile);
                        }

                        if (pdfFile._convertedBy) {
                            this._showSaveConvertedToast(pdfFile);
                        } else {
                            this.showToast('✅ ' + file.name + (insertMode ? ' insertado' : ' abierto') + ' (modo básico)');
                        }
                    } catch (e) {
                        this.toggleLoader(false);
                        console.error('Office conversion error:', e);
                        this.showToast('❌ Error: ' + e.message);
                    }
                };

                // Toast especial con botón "Guardar PDF" para conversiones nativas
                app._showSaveConvertedToast = function (pdfFile) {
                    // Intentar mostrar toast con botón si el sistema lo soporta
                    if (typeof this.showToastWithAction === 'function') {
                        this.showToastWithAction(
                            `✅ Convertido con ${pdfFile._convertedBy}`,
                            '💾 Guardar PDF',
                            () => {
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(pdfFile._nativeBlob || pdfFile);
                                a.download = pdfFile.name;
                                a.click();
                                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                            }
                        );
                    } else {
                        // Fallback: toast simple + toast de guardado manual
                        this.showToast(`✅ Convertido con ${pdfFile._convertedBy} — usa "Guardar" para exportar el PDF`);
                    }
                };

                console.log('📎 Office Conversion Engine loaded');
            }); // end waitForApp
        })();
