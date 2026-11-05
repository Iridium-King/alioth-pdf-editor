// app.pdf.js
// Extiende el objeto global `app` con métodos de pdf
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            _hasCryptographicSignature: function (pdfDoc) {
                const name = PDFLib.PDFName;
                const perms = pdfDoc.catalog.lookupMaybe(name.of('Perms'), PDFLib.PDFDict);
                if (perms?.get(name.of('DocMDP'))) return true;

                for (const [, object] of pdfDoc.context.enumerateIndirectObjects()) {
                    if (!(object instanceof PDFLib.PDFDict)) continue;
                    const byteRange = object.lookupMaybe(name.of('ByteRange'), PDFLib.PDFArray);
                    const contents = object.get(name.of('Contents'));
                    if (byteRange && contents) return true;
                }
                return false;
            },

            _importNativeFormFieldsFromPage: function (pdfDoc, copiedPage, importedRefs = new Set()) {
                const annots = copiedPage.node.lookupMaybe(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
                if (!annots) return importedRefs;

                for (let i = 0; i < annots.size(); i++) {
                    const annotRef = annots.get(i);
                    const annot = annots.lookup(i, PDFLib.PDFDict);
                    if (!annot || String(annot.get(PDFLib.PDFName.of('Subtype'))) !== '/Widget') continue;
                    annot.set(PDFLib.PDFName.of('P'), copiedPage.ref);

                    let fieldRef = annot.get(PDFLib.PDFName.of('Parent')) || annotRef;
                    let field = pdfDoc.context.lookup(fieldRef, PDFLib.PDFDict);
                    while (field) {
                        const parentRef = field.get(PDFLib.PDFName.of('Parent'));
                        if (!parentRef) break;
                        fieldRef = parentRef;
                        field = pdfDoc.context.lookup(fieldRef, PDFLib.PDFDict);
                    }

                    const key = String(fieldRef);
                    if (!importedRefs.has(key)) {
                        pdfDoc.getForm().acroForm.addField(fieldRef);
                        importedRefs.add(key);
                    }
                }
                return importedRefs;
            },

            _prepareNativeFormAppearances: function (pdfDoc, fallbackFont, autoSizeFieldNames = new Set()) {
                if (!fallbackFont) return autoSizeFieldNames;

                const form = pdfDoc.getForm();
                const acroForm = form.acroForm.dict;
                const context = pdfDoc.context;
                const name = PDFLib.PDFName;
                let resources = acroForm.lookupMaybe(name.of('DR'), PDFLib.PDFDict);
                if (!resources) {
                    resources = context.obj({});
                    acroForm.set(name.of('DR'), resources);
                }
                let fonts = resources.lookupMaybe(name.of('Font'), PDFLib.PDFDict);
                if (!fonts) {
                    fonts = context.obj({});
                    resources.set(name.of('Font'), fonts);
                }

                const fallbackName = 'Helvetica';
                fonts.set(name.of(fallbackName), fallbackFont.ref);
                fonts.set(name.of('Helv'), fallbackFont.ref);
                if (!acroForm.get(name.of('DA'))) {
                    acroForm.set(name.of('DA'), PDFLib.PDFString.of(`0 g\n/${fallbackName} 0 Tf`));
                }

                for (const field of form.getFields()) {
                    const isVariableText = field instanceof PDFLib.PDFTextField ||
                        field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList;
                    if (!isVariableText || !field.acroField) continue;

                    let defaultAppearance = '';
                    try { defaultAppearance = field.acroField.getDefaultAppearance() || ''; } catch (_) { }
                    const fontMatch = defaultAppearance.match(/\/([^\s/]+)\s+([-+]?\d*\.?\d+)\s+Tf/);
                    if (!fontMatch) {
                        field.acroField.setDefaultAppearance(`0 g\n/${fallbackName} 0 Tf`);
                        autoSizeFieldNames.add(field.getName());
                        fonts.set(name.of(fallbackName), fallbackFont.ref);
                    } else {
                        fonts.set(name.of(fontMatch[1]), fallbackFont.ref);
                        if (Number(fontMatch[2]) === 0) autoSizeFieldNames.add(field.getName());
                    }
                }
                return autoSizeFieldNames;
            },

            _setNativeFieldAutoSize: function (field) {
                if (!field?.acroField?.setDefaultAppearance) return;
                let appearance = '';
                try { appearance = field.acroField.getDefaultAppearance() || ''; } catch (_) { }
                if (/\/[^\s/]+\s+[-+]?\d*\.?\d+\s+Tf/.test(appearance)) {
                    appearance = appearance.replace(
                        /(\/[^\s/]+\s+)[-+]?\d*\.?\d+(\s+Tf)/,
                        (_, prefix, suffix) => prefix + '0' + suffix
                    );
                } else {
                    appearance = '0 g\n/Helvetica 0 Tf';
                }
                field.acroField.setDefaultAppearance(appearance);
            },

            _applyNativeFormValues: function (pdfDoc, pages) {
                const form = pdfDoc.getForm();
                for (const page of pages || []) {
                    for (const [fieldName, change] of Object.entries(page.nativeFormValues || {})) {
                        let field;
                        try { field = form.getField(fieldName); } catch (_) { continue; }

                        if (change.kind === 'checkbox' && field instanceof PDFLib.PDFCheckBox) {
                            if (change.value) field.check(); else field.uncheck();
                        } else if (change.kind === 'radio' && field instanceof PDFLib.PDFRadioGroup) {
                            if (change.value) field.select(String(change.value));
                        } else if (change.kind === 'choice' && (field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList)) {
                            if (change.value === '' && field.clear) field.clear();
                            else field.select(String(change.value));
                        } else if (field instanceof PDFLib.PDFTextField) {
                            field.setText(String(change.value ?? ''));
                        }
                    }
                }
            },

            prepareDocumentPdf: async function (snapshot, options = {}, signal) {
                if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.payload) throw new Error('INVALID_SNAPSHOT');
                if (signal?.aborted) throw new DOMException('Abortado', 'AbortError');
                const compression = options.compression || 'none';
                if (!['none', 'lossless', 'fast', 'standard', 'max'].includes(compression)) throw new Error('INVALID_COMPRESSION_LEVEL');
                if ((options.protection || 'preserve') !== 'preserve') throw new Error('PROTECTION_REQUIRED');
                const payload = snapshot.payload;
                for (const source of payload.sources || []) {
                    if (!source?.buffer) {
                        if (source?.sourceId === 'generated-index') continue;
                        throw new Error('SOURCE_PDF_UNAVAILABLE');
                    }
                    if (source.metadata?.protectionRequired) throw new Error('PROTECTION_REQUIRED');
                    try {
                        const inspected = await PDFLib.PDFDocument.load(source.buffer, { ignoreEncryption: false });
                        if (inspected.isEncrypted) throw new Error('PROTECTION_REQUIRED');
                        if (this._hasCryptographicSignature(inspected)) throw new Error('SIGNATURE_INVALIDATION_REQUIRED');
                    } catch (error) {
                        if (error.message === 'SIGNATURE_INVALIDATION_REQUIRED') throw error;
                        if (error.message === 'PROTECTION_REQUIRED' || /encrypt|password/i.test(error.message || '')) throw new Error('PROTECTION_REQUIRED');
                    }
                }
                const sources = Object.fromEntries((payload.sources || []).map(source => [source.sourceId, {
                    buffer: source.buffer
                        ? (source.buffer instanceof Uint8Array ? source.buffer.slice() : new Uint8Array(source.buffer).slice())
                        : null,
                    metadata: source.metadata || {}
                }]));
                const documentSnapshot = {
                    id: snapshot.docId,
                    name: payload.document?.name || 'documento.pdf',
                    currentIndex: payload.document?.currentIndex || 0,
                    pages: (payload.pages || []).map(page => JSON.parse(JSON.stringify(page))),
                    sources
                };
                const compressionLevel = compression === 'lossless' ? 'fast' : compression;
                const bytes = await this.savePDFInternal(false, null, compressionLevel !== 'none', true, compressionLevel, documentSnapshot);
                if (!bytes) throw new Error('SAVE_OUTPUT_UNAVAILABLE');
                if (signal?.aborted) throw new DOMException('Abortado', 'AbortError');
                const output = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                const validation = await this.validatePreparedPdf(output, snapshot, options);
                if (!validation.ok) throw new Error(validation.failures[0]?.code || 'INVALID_PDF');
                let sha256 = null;
                if (globalThis.crypto?.subtle) {
                    const digest = await globalThis.crypto.subtle.digest('SHA-256', output);
                    sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                }
                return { bytes: output, sha256, revision: snapshot.revision, validation };
            },

            validatePreparedPdf: async function (bytes, snapshot) {
                try {
                    const pdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
                    const expectedPages = snapshot?.payload?.pages?.length || 0;
                    if (pdf.getPageCount() !== expectedPages) return { ok: false, failures: [{ code: 'PAGE_COUNT_MISMATCH' }] };
                    return { ok: true, failures: [] };
                } catch (_) {
                    return { ok: false, failures: [{ code: 'INVALID_PDF' }] };
                }
            },

            adoptCanonicalPdf: async function (docId, bytes, provenance = {}) {
                const doc = this.getDocumentById ? this.getDocumentById(docId) : this.getDoc();
                if (!doc) throw new Error('DOCUMENT_NOT_FOUND');
                const validation = await this.validatePreparedPdf(bytes, { payload: { pages: doc.pages || [] } });
                if (!validation.ok) throw new Error(validation.failures[0].code);
                const canonicalId = 'canonical_' + Date.now().toString(36);
                const buffer = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice();
                doc.sources = { [canonicalId]: { buffer, provenance: { ...provenance } } };
                doc.pages = (doc.pages || []).map((page, pageIndex) => ({ ...page, sourceId: canonicalId, pageIndex, originalBuffer: undefined }));
                if (this.markDocumentChanged) this.markDocumentChanged(docId, 'canonical-pdf');
            },

            _syncNativeOverlayValuesForSave: function (pages, activePage) {
                if (!this.isFieldEditMode || !activePage) return;
                const page = (pages || []).find(item => item === activePage);
                if (!page) return;

                page.nativeFormValues = page.nativeFormValues || {};
                for (const field of (page.objects || []).filter(object => object.fromFormField)) {
                    const fieldName = field.nativeFieldName || field.fieldName;
                    if (!fieldName) continue;
                    if (field.fieldType === 'checkbox') {
                        page.nativeFormValues[fieldName] = { kind: 'checkbox', value: !!field.checked };
                    } else if (field.fieldType === 'radio') {
                        if (field.selected || field.checked) {
                            page.nativeFormValues[fieldName] = { kind: 'radio', value: field.value || field.exportValue || '' };
                        }
                    } else if (field.fieldType === 'dropdown') {
                        page.nativeFormValues[fieldName] = { kind: 'choice', value: field.selectedValue ?? field.value ?? '' };
                    } else {
                        page.nativeFormValues[fieldName] = { kind: 'text', value: field.textValue ?? field.value ?? '' };
                    }
                }
            },

            openFile: async function (file) {
                if (this.measureMode) {
                    this.measureMode = false;
                    this._measureCalib = { calibrated: false, mode: 'page', pxPerUnit: null, unit: 'cm', scaleRatio: 100 };
                    ['btn-measure', 'toggleMeasure'].forEach(id => {
                        const b = document.getElementById(id);
                        if (b) b.classList.remove('active', 'measure-active');
                    });
                    ['', '-secondary'].forEach(suffix => {
                        const svg = document.getElementById('measure-layer' + suffix);
                        if (svg) { svg.classList.remove('active'); svg.innerHTML = ''; svg._measureInit = false; }
                    });
                }
                const fileName = file.name || "Sin Título.pdf";
                const openMode = localStorage.getItem('alioth_default_open_mode') || 'tab';
                let doc = this.getDoc();

                if (openMode === 'window' && doc && doc.pages.length > 0 && !file._forceSameWindow) {
                    try {
                        const token = 'win_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                        const buffer = await file.arrayBuffer();
                        const payload = {
                            type: 'tab',
                            name: fileName,
                            originalPath: file._aliothOriginalPath || await this.resolveFileOriginPath?.(file),
                            docName: fileName,
                            token: token,
                            sourcesBuffers: { ['src_' + Date.now()]: buffer },
                            pages: []
                        };
                        await this._saveTransferPayload(token, payload);
                        const url = 'BASE.html?transferToken=' + encodeURIComponent(token);
                        window.open(url, '_blank');
                        return;
                    } catch (we) {
                        console.warn('Error abriendo en nueva ventana, abriendo en pestaña:', we);
                    }
                }

                if (!doc || doc.pages.length > 0) { const newId = this.createNewTab(fileName); doc = this.docs.find(d => d.id === newId); }
                else { doc.name = fileName; this.renderTabs(); }
                if (typeof this.updateWindowTitle === 'function') this.updateWindowTitle();

                if (file.type.startsWith('image/')) {
                    doc.originalPath = await this.resolveFileOriginPath?.(file) || null;
                    await this.insertImageAsPage(file, doc, 0);
                    if (typeof this.updateWindowTitle === 'function') this.updateWindowTitle();
                    return;
                }

                this.toggleLoader(true);
                try {
                    // Una sola copia del buffer — se reutiliza para pdf.js y para recientes
                    const buffer = await file.arrayBuffer();

                    // Validar header PDF
                    const headerBytes = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
                    const headerStr = String.fromCharCode(...headerBytes);
                    if (!headerStr.startsWith('%PDF-')) {
                        const isConvertedOffice = fileName.endsWith('.pdf') && file._convertedFromOffice;
                        const msg = isConvertedOffice
                            ? `El archivo "${file._sourceOfficeName || fileName}" no pudo convertirse a PDF correctamente.`
                            : `"${fileName}" no es un PDF válido (cabecera incorrecta). El archivo puede estar corrupto o tener formato incorrecto.`;
                        this.showToast('❌ ' + msg);
                        const emptyIdx = this.docs.findIndex(d => d.id === doc.id && d.pages.length === 0);
                        if (emptyIdx > -1) { this.docs.splice(emptyIdx, 1); this.renderTabs(); }
                        this.toggleLoader(false);
                        return;
                    }

                    // Pasar copia a pdf.js para que no detache el buffer original
                    let _capturedPassword = null;
                    let _passwordCancelled = false;
                    const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
                    loadingTask.onPassword = function (updatePassword, reason) {
                        if (_passwordCancelled) return;
                        const pwd = prompt(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
                            ? "Contraseña incorrecta. Reintenta:"
                            : "Archivo protegido. Introduce contraseña:");
                        if (pwd === null) {
                            _passwordCancelled = true;
                            loadingTask.destroy();
                            return;
                        }
                        _capturedPassword = pwd;
                        updatePassword(pwd);
                    };

                    let pdf;
                    try { pdf = await loadingTask.promise; }
                    catch(passErr) {
                        if (_passwordCancelled) {
                            const emptyIdx = this.docs.findIndex(d => d.id === doc.id && d.pages.length === 0);
                            if (emptyIdx > -1) { this.docs.splice(emptyIdx, 1); this.renderTabs(); }
                            this.toggleLoader(false);
                            return;
                        }
                        throw passErr;
                    }
                    const srcId = 'src_' + Date.now();

                    // Si se usó contraseña, desencriptar el buffer para que PDFLib pueda leerlo al guardar
                    let cleanBuffer = buffer;
                    if (_capturedPassword) {
                        try {
                            cleanBuffer = await PythonManager.decryptPDF(buffer, _capturedPassword);
                        } catch (e) {
                            console.warn('⚠️ No se pudo desencriptar buffer, usando ignoreEncryption como fallback:', e);
                            cleanBuffer = buffer;
                        }
                    }

                    doc.sources[srcId] = { buffer: cleanBuffer, doc: pdf };

                    for (let i = 0; i < pdf.numPages; i++) {
                        doc.pages.push({
                            sourceId: srcId, pageIndex: i, rotation: 0, flipped: false,
                            objects: [], id: Math.random().toString(36)
                        });
                    }
                    if (!file._aliothOriginalPath && !file._aliothSourcePath && !file.path && typeof this.resolveFileOriginPath === 'function') {
                        try {
                            file._aliothSourcePath = await this.resolveFileOriginPath(file);
                        } catch (_) {}
                    }
                    const resolvedOriginPath = file._aliothSourcePath || file.path || null;
                    doc.originalPath = file._aliothOriginalPath || resolvedOriginPath;
                    doc.filePath = resolvedOriginPath;
                    await this.applyDefaultDocumentZoom?.(doc, pdf);
                    await this.setDocumentBaseline(doc.id);
                    if (resolvedOriginPath && typeof this.bindOpenedFilePath === 'function') {
                        try {
                            await this.bindOpenedFilePath(doc.id, resolvedOriginPath);
                            console.log(`💾 [NativeSave] Documento "${doc.id}" (${fileName}) vinculado a origen: ${resolvedOriginPath}`);
                        } catch (bindingError) {
                            console.warn('[NativeSave] no se pudo vincular el archivo de origen', bindingError);
                        }
                    }
                    this.switchTab(doc.id);

                    // Diferir operaciones pesadas para no bloquear la primera renderización
                    setTimeout(() => {
                        this.saveState();
                    }, 0);

                    // Guardar en recientes de forma asíncrona sin bloquear UI
                    this.addToRecentDocs(fileName, '', buffer).catch(e => console.warn('Recents error:', e));
                    if (typeof this.updateWindowTitle === 'function') this.updateWindowTitle();

                } catch (e) {
                    console.error(e);
                    const friendly = e.name === 'InvalidPDFException'
                        ? `PDF inválido o corrupto: "${fileName}".`
                        : e.message;
                    this.showToast('❌ Error al abrir: ' + friendly);
                    const emptyIdx = this.docs.findIndex(d => d.id === doc.id && d.pages.length === 0);
                    if (emptyIdx > -1) { this.docs.splice(emptyIdx, 1); this.renderTabs(); }
                }
                this.toggleLoader(false);
            },

            insertPDF: async function (file, targetIndex = null) {
                const doc = this.getDoc(); if (!doc) return this.openFile(file);

                if (file.type.startsWith('image/')) {
                    const idx = targetIndex !== null ? targetIndex + 1 : (doc.pages.length > 0 ? doc.currentIndex + 1 : 0);
                    await this.insertImageAsPage(file, doc, idx);
                    return;
                }

                const isBulk = document.getElementById('loader').style.display === 'flex';
                if (!isBulk) this.toggleLoader(true);
                try {
                    const buffer = await file.arrayBuffer();

                    let _insertCancelled = false;
                    const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
                    loadingTask.onPassword = function (cb, reason) {
                        if (_insertCancelled) return;
                        const p = prompt("Contraseña requerida para insertar:");
                        if (p === null) { _insertCancelled = true; loadingTask.destroy(); return; }
                        cb(p);
                    };

                    let pdf;
                    try { pdf = await loadingTask.promise; }
                    catch(passErr) {
                        if (_insertCancelled) { if (!isBulk) this.toggleLoader(false); return; }
                        throw passErr;
                    }
                    const srcId = 'src_' + Date.now() + Math.random();
                    doc.sources[srcId] = { buffer: buffer, doc: pdf };

                    const insertAt = targetIndex !== null ? targetIndex + 1 : (doc.pages.length > 0 ? doc.currentIndex + 1 : 0);
                    const newPages = [];
                    for (let i = 0; i < pdf.numPages; i++) newPages.push({ sourceId: srcId, pageIndex: i, rotation: 0, flipped: false, objects: [], id: Math.random().toString(36) });

                    doc.pages.splice(insertAt, 0, ...newPages);

                    if (!isBulk) {
                        this.renderSidebar();
                        // Restaurar vista continua si se cerró un doc que estaba en continuo
                        if (this._precloseWasContinuous && this.viewMode !== 'continuous') {
                            this.viewMode = 'continuous';
                            const _btnC = document.getElementById('toggleContinuous');
                            if (_btnC) _btnC.classList.add('active-view');
                            this._precloseWasContinuous = false;
                        }
                        if (this.viewMode === 'continuous') {
                            this.renderPanelContent(this.splitView.activePanel);
                        } else {
                            this.loadPage(insertAt < doc.pages.length ? insertAt : doc.pages.length - 1);
                        }
                        // Diferir saveState para no bloquear la primera renderización
                        setTimeout(() => this.saveState(), 0);
                    }
                } catch (e) { alert(e.message) }
                if (!isBulk) this.toggleLoader(false);
            },

            insertImageAsPage: async function (file, targetDoc, insertIndex) {
                const isBulk = document.getElementById('loader').style.display === 'flex';
                if (!isBulk) this.toggleLoader(true);
                try {
                    const doc = targetDoc || this.getDoc();
                    const buffer = await file.arrayBuffer();
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    let image;
                    if (file.type === 'image/jpeg') image = await pdfDoc.embedJpg(buffer);
                    else if (file.type === 'image/png') image = await pdfDoc.embedPng(buffer);
                    else { throw new Error("Formato no soportado."); }

                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

                    const pdfBytes = await pdfDoc.save();
                    const safeBuffer = await new Blob([pdfBytes]).arrayBuffer();
                    const srcId = 'src_' + Date.now() + Math.random();
                    const pdf = await pdfjsLib.getDocument({ data: safeBuffer.slice(0) }).promise;

                    doc.sources[srcId] = { buffer: safeBuffer, doc: pdf };
                    const newPage = { sourceId: srcId, pageIndex: 0, rotation: 0, flipped: false, objects: [], id: Math.random().toString(36) };

                    if (insertIndex !== undefined && insertIndex !== null) doc.pages.splice(insertIndex, 0, newPage);
                    else doc.pages.push(newPage);

                    if (!isBulk) {
                        this.renderSidebar();
                        // FIX: In continuous mode, we must rebuild the stack to include the new pages
                        if (this.viewMode === 'continuous') {
                            this.renderPanelContent(this.splitView.activePanel);
                        } else {
                            this.loadPage(doc.currentIndex);
                        }
                    }
                } catch (e) { console.error(e); alert("Error imagen: " + e.message); }
                if (!isBulk) this.toggleLoader(false);
            },

            insertBlankPage: async function () {
                if (this.docs.length === 0) this.createNewTab("Documento Nuevo");
                const doc = this.getDoc();
                const refPage = doc?.pages?.[doc.currentIndex ?? 0] || doc?.pages?.[0];
                const docW = refPage?.width || 595;
                const docH = refPage?.height || 842;
                this._showBlankPageModal(docW, docH, async (w, h) => {
                    try {
                        const pdfDoc = await PDFLib.PDFDocument.create();
                        pdfDoc.addPage([w, h]);
                        const bytes = await pdfDoc.save();
                        const blob = new Blob([bytes], { type: 'application/pdf' });
                        const file = new File([blob], "pagina_blanco.pdf", { type: "application/pdf" });
                        await this.insertPDF(file);
                    } catch (e) { console.error(e); alert("Error creando página en blanco."); }
                });
            },

            _showBlankPageModal: function (docW, docH, onConfirm) {
                const SIZES = [
                    { key: 'doc',    label: 'Mismo que documento', w: docW, h: docH },
                    { key: 'a4',     label: 'A4  (210 × 297 mm)',  w: 595,  h: 842  },
                    { key: 'letter', label: 'Carta (216 × 279 mm)', w: 612, h: 792  },
                    { key: 'legal',  label: 'Legal (216 × 356 mm)', w: 612, h: 1008 },
                    { key: 'a3',     label: 'A3  (297 × 420 mm)',  w: 842,  h: 1191 },
                    { key: 'a5',     label: 'A5  (148 × 210 mm)',  w: 420,  h: 595  },
                ];

                const existing = document.getElementById('_blank-page-modal');
                if (existing) existing.remove();

                const overlay = document.createElement('div');
                overlay.id = '_blank-page-modal';
                overlay.className = 'glass-overlay';
                overlay.style.cssText = 'display:flex; z-index:13000;';

                const modal = document.createElement('div');
                modal.className = 'glass-box';
                modal.style.cssText = 'width:320px; text-align:left; padding:24px;';

                const accentActive   = 'flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--accent,#6366f1);background:var(--accent,#6366f1);color:#fff;font-size:12px;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:opacity 0.15s;font-weight:600;';
                const accentInactive = 'flex:1;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:rgba(200,215,255,0.55);font-size:12px;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.15s;';

                const sizeOptItems = SIZES.map((s,i) =>
                    `<div class="_bpm-opt" data-key="${s.key}" style="padding:9px 12px;font-size:13px;color:#f0f4ff;cursor:pointer;background:${i===0?'rgba(255,255,255,0.1)':'transparent'};">${s.label}</div>`
                ).join('');

                modal.innerHTML = `
                    <h3 style="margin:0 0 18px;font-size:14px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--accent,#6366f1)"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
                        Insertar Página en Blanco
                    </h3>
                    <label style="font-size:11px;color:rgba(200,215,255,0.5);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Tamaño</label>
                    <div style="position:relative;margin-bottom:16px;">
                        <div id="_bpm-trigger" style="width:100%;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:#1e2035;color:#f0f4ff;font-size:13px;cursor:pointer;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;">
                            <span id="_bpm-label">Mismo que documento</span>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="rgba(200,215,255,0.5)"><path d="M7 10l5 5 5-5z"/></svg>
                        </div>
                        <div id="_bpm-list" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#1e2035;border:1px solid rgba(255,255,255,0.18);border-radius:10px;overflow:hidden;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,0.6);">
                            ${sizeOptItems}
                        </div>
                    </div>
                    <label style="font-size:11px;color:rgba(200,215,255,0.5);display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Orientación</label>
                    <div style="display:flex;gap:8px;margin-bottom:22px;">
                        <button id="_bpm-portrait" style="${accentActive}">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="5" y="2" width="14" height="20" rx="2"/></svg> Vertical
                        </button>
                        <button id="_bpm-landscape" style="${accentInactive}">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="2" y="5" width="20" height="14" rx="2"/></svg> Horizontal
                        </button>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button id="_bpm-cancel" style="padding:8px 18px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(200,215,255,0.5);font-size:13px;font-family:inherit;cursor:pointer;transition:color 0.15s;">Cancelar</button>
                        <button id="_bpm-ok" style="padding:8px 20px;border-radius:10px;border:none;background:var(--accent,#6366f1);color:#fff;font-size:13px;font-family:inherit;cursor:pointer;font-weight:600;transition:opacity 0.15s;">Insertar</button>
                    </div>`;

                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                // Custom dropdown logic
                let selectedKey = 'doc';
                const trigger = modal.querySelector('#_bpm-trigger');
                const labelEl = modal.querySelector('#_bpm-label');
                const list    = modal.querySelector('#_bpm-list');

                trigger.addEventListener('click', e => {
                    e.stopPropagation();
                    list.style.display = list.style.display === 'none' ? 'block' : 'none';
                });

                modal.querySelectorAll('._bpm-opt').forEach(opt => {
                    opt.addEventListener('mouseenter', () => opt.style.background = 'rgba(255,255,255,0.1)');
                    opt.addEventListener('mouseleave', () => opt.style.background = opt.dataset.key === selectedKey ? 'rgba(255,255,255,0.1)' : 'transparent');
                    opt.addEventListener('click', () => {
                        selectedKey = opt.dataset.key;
                        labelEl.textContent = opt.textContent;
                        list.style.display = 'none';
                        modal.querySelectorAll('._bpm-opt').forEach(o => o.style.background = o.dataset.key === selectedKey ? 'rgba(255,255,255,0.1)' : 'transparent');
                    });
                });

                document.addEventListener('click', () => { list.style.display = 'none'; });

                let selectedOrient = docW > docH ? 'landscape' : 'portrait';

                const btnPortrait  = modal.querySelector('#_bpm-portrait');
                const btnLandscape = modal.querySelector('#_bpm-landscape');

                function setOrient(o) {
                    selectedOrient = o;
                    btnPortrait.style.cssText  = o === 'portrait'  ? accentActive : accentInactive;
                    btnLandscape.style.cssText = o === 'landscape' ? accentActive : accentInactive;
                }
                setOrient(selectedOrient);

                btnPortrait.addEventListener('click',  () => setOrient('portrait'));
                btnLandscape.addEventListener('click', () => setOrient('landscape'));

                const btnCancel = modal.querySelector('#_bpm-cancel');
                const btnOk     = modal.querySelector('#_bpm-ok');

                btnCancel.onmouseenter = () => btnCancel.style.color = '#f0f4ff';
                btnCancel.onmouseleave = () => btnCancel.style.color = 'rgba(200,215,255,0.5)';
                btnOk.onmouseenter = () => btnOk.style.opacity = '0.85';
                btnOk.onmouseleave = () => btnOk.style.opacity = '1';

                const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
                btnCancel.addEventListener('click', close);
                overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
                const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
                document.addEventListener('keydown', onKey);

                btnOk.addEventListener('click', () => {
                    const s = SIZES.find(x => x.key === selectedKey);
                    let { w, h } = s;
                    if (selectedOrient === 'landscape' && h > w) [w, h] = [h, w];
                    if (selectedOrient === 'portrait'  && w > h) [w, h] = [h, w];
                    close();
                    onConfirm(w, h);
                });
            },

            insertImageAsPage: async function (file, targetDoc, insertIndex) {
                const isBulk = document.getElementById('loader').style.display === 'flex';
                if (!isBulk) {
                    document.getElementById('loader-msg').textContent = 'Procesando imagen...';
                    document.getElementById('loader').style.display = 'flex';
                }

                try {
                    const doc = targetDoc || this.getDoc();
                    const buffer = await file.arrayBuffer();
                    const pdfDoc = await PDFLib.PDFDocument.create();
                    let image;
                    if (file.type === 'image/jpeg') image = await pdfDoc.embedJpg(buffer);
                    else if (file.type === 'image/png') image = await pdfDoc.embedPng(buffer);
                    else { throw new Error("Formato no soportado."); }

                    // Standard page sizes in points (72 points = 1 inch)
                    const LETTER_WIDTH = 612;   // 8.5 inches
                    const LETTER_HEIGHT = 792;  // 11 inches
                    const LEGAL_HEIGHT = 1008;  // 14 inches

                    // Determine page size and orientation based on image aspect ratio
                    const imgRatio = image.width / image.height;
                    const letterRatio = LETTER_WIDTH / LETTER_HEIGHT;        // ~0.77 (portrait)
                    const letterLandscapeRatio = LETTER_HEIGHT / LETTER_WIDTH; // ~1.29 (landscape)
                    const legalRatio = LETTER_WIDTH / LEGAL_HEIGHT;          // ~0.61 (portrait legal)

                    let pageWidth, pageHeight;

                    if (imgRatio > 1) {
                        // Landscape image
                        const legalLandscapeRatio = LEGAL_HEIGHT / LETTER_WIDTH; // ~1.65
                        if (imgRatio > legalLandscapeRatio) {
                            // Very wide - use Legal landscape
                            pageWidth = LEGAL_HEIGHT;
                            pageHeight = LETTER_WIDTH;
                        } else {
                            // Normal landscape - use Letter landscape
                            pageWidth = LETTER_HEIGHT;
                            pageHeight = LETTER_WIDTH;
                        }
                    } else {
                        // Portrait image
                        if (imgRatio < legalRatio) {
                            // Very tall - use Legal portrait
                            pageWidth = LETTER_WIDTH;
                            pageHeight = LEGAL_HEIGHT;
                        } else {
                            // Normal portrait - use Letter portrait
                            pageWidth = LETTER_WIDTH;
                            pageHeight = LETTER_HEIGHT;
                        }
                    }

                    // Scale image to fit within page bounds
                    const scaleX = pageWidth / image.width;
                    const scaleY = pageHeight / image.height;
                    const scale = Math.min(scaleX, scaleY); // Fit mode: image fully visible

                    const scaledWidth = image.width * scale;
                    const scaledHeight = image.height * scale;

                    // Center image on page
                    const x = (pageWidth - scaledWidth) / 2;
                    const y = (pageHeight - scaledHeight) / 2;

                    const page = pdfDoc.addPage([pageWidth, pageHeight]);
                    page.drawImage(image, { x: x, y: y, width: scaledWidth, height: scaledHeight });

                    const pdfBytes = await pdfDoc.save();
                    const safeBuffer = await new Blob([pdfBytes]).arrayBuffer();
                    const srcId = 'src_' + Date.now() + Math.random();
                    const pdf = await pdfjsLib.getDocument({ data: safeBuffer.slice(0) }).promise;

                    doc.sources[srcId] = { buffer: safeBuffer, doc: pdf };
                    const newPage = { sourceId: srcId, pageIndex: 0, rotation: 0, flipped: false, objects: [], id: Math.random().toString(36) };

                    if (insertIndex !== undefined && insertIndex !== null) doc.pages.splice(insertIndex, 0, newPage);
                    else doc.pages.push(newPage);

                    if (!isBulk) {
                        this.renderSidebar();
                        this.loadPage(doc.currentIndex);

                        // Hide loader
                        document.getElementById('loader').style.display = 'none';

                        // Show success toast
                        const toast = document.getElementById('toast');
                        toast.textContent = '✅ Imagen insertada como página nueva';
                        toast.classList.add('show');
                        setTimeout(() => toast.classList.remove('show'), 3000);
                    }
                } catch (e) {
                    console.error(e);
                    alert("Error imagen: " + e.message);
                    if (!isBulk) document.getElementById('loader').style.display = 'none';
                }
            },

            /**
             * Handles emoji/icon click - normal click inserts immediately, Ctrl+click adds to selection
             */
            rotatePage: function (deg) {
                const doc = this.getDoc(); if (!doc) return;
                this.saveState();
                let targets = this.multiSelection.size > 0 ? Array.from(this.multiSelection) : [doc.currentIndex];
                targets.forEach(idx => {
                    if (doc.pages[idx]) {
                        let newRot = (doc.pages[idx].rotation + deg) % 360;
                        if (newRot < 0) newRot += 360;
                        doc.pages[idx].rotation = newRot;
                        // Invalidar cache de thumbnail para forzar re-render
                        doc.pages[idx]._thumbCache = null;
                    }
                });
                if (this.viewMode === 'continuous') {
                    this.renderPanelContent(this.splitView.activePanel);
                } else {
                    this.loadPage(doc.currentIndex);
                }
                this.renderSidebar();
            },

            flipPage: function (axis) {
                const doc = this.getDoc(); if (!doc) return;
                this.saveState();
                let targets = this.multiSelection.size > 0 ? Array.from(this.multiSelection) : [doc.currentIndex];
                targets.forEach(idx => {
                    const p = doc.pages[idx];
                    if (p) {
                        if (axis === 'h') p.flipH = !p.flipH;
                        if (axis === 'v') p.flipV = !p.flipV;
                        p._thumbCache = null;
                    }
                });
                if (this.viewMode === 'continuous') {
                    this.renderPanelContent(this.splitView.activePanel);
                } else {
                    this.loadPage(doc.currentIndex);
                }
                this.renderSidebar();
            },

            deletePage: function () {
                const doc = this.getDoc(); if (!doc) return;
                // Filtrar índices stale (pueden quedar de la vista grid)
                let rawTargets = this.multiSelection.size > 0 ? Array.from(this.multiSelection) : [doc.currentIndex];
                let targets = rawTargets.filter(i => i >= 0 && i < doc.pages.length).sort((a, b) => b - a);
                if (targets.length === 0) targets = [doc.currentIndex];
                console.log('🗑 [deletePage] multiSel=' + this.multiSelection.size + ' raw=' + JSON.stringify(rawTargets) + ' valid=' + JSON.stringify(targets) + ' pages=' + doc.pages.length);
                if (doc.pages.length <= targets.length) {
                    // Eliminada confirmación
                    this.closeTab(doc.id); return;
                }
                // Eliminada confirmación de borrado múltiple
                // if(!confirm(`¿Borrar ${targets.length} página(s)?`)) return;
                this.saveState();
                targets.forEach(idx => doc.pages.splice(idx, 1));
                this.multiSelection.clear();
                const remapIndex = oldIndex => Math.max(0, Math.min(oldIndex - targets.filter(idx => idx < oldIndex).length, doc.pages.length - 1));
                const newIdx = remapIndex(doc.currentIndex);
                // Sincronizar el índice antes de reconstruir la vista continua.
                doc.currentIndex = newIdx;
                ['primary', 'secondary'].forEach(panelId => {
                    const panel = this.splitView && this.splitView[panelId];
                    if (panel && panel.docId === doc.id) panel.pageIndex = remapIndex(panel.pageIndex);
                });
                // FIX: Sync continuous view if pages were deleted
                if (this.viewMode === 'continuous') {
                    ['primary', 'secondary'].forEach(panelId => {
                        const panel = this.splitView && this.splitView[panelId];
                        if (panel && panel.docId === doc.id) this.renderPanelContent(panelId);
                    });
                } else {
                    this.loadPage(newIdx);
                }
                this.renderSidebar();
            },

            extractPage: async function () {
                const doc = this.getDoc(); if (!doc) return;
                let targets = this.multiSelection.size > 0 ? Array.from(this.multiSelection).sort((a, b) => a - b) : [doc.currentIndex];
                this.toggleLoader(true);
                try {
                    const out = await PDFLib.PDFDocument.create();
                    for (const idx of targets) {
                        const p = doc.pages[idx];
                        const srcDoc = await PDFLib.PDFDocument.load(doc.sources[p.sourceId].buffer, { ignoreEncryption: true });
                        const [cp] = await out.copyPages(srcDoc, [p.pageIndex]);
                        // FIX: Flip desde el centro de la página
                        const pageWidth = cp.getWidth();
                        const pageHeight = cp.getHeight();
                        if (p.flipH) {
                            cp.translateContent(pageWidth / 2, 0);
                            cp.scaleContent(-1, 1);
                            cp.translateContent(-pageWidth / 2, 0);
                        }
                        if (p.flipV) {
                            cp.translateContent(0, pageHeight / 2);
                            cp.scaleContent(1, -1);
                            cp.translateContent(0, -pageHeight / 2);
                        }
                        cp.setRotation(PDFLib.degrees((cp.getRotation().angle + p.rotation) % 360));
                        out.addPage(cp);
                    }
                    const pdfBytes = await out.save();
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), `extraido_${doc.name}`);
                } catch (e) { console.error(e); alert("Error al extraer: " + e.message); }
                this.toggleLoader(false);
            },

            /**
             * Helper to compress image data to JPEG with specified quality
             * @param {string} source - Base64 or URL of image
             * @param {number} quality - Quality from 0 to 1 (default 0.75)
             */
            savePDFInternal: async function (onlyCurrentPage, customFilename = null, compress = false, returnBytes = false, compressLevel = 'standard', sourceDocument = null) {
                // Race-condition guard: prevent concurrent saves
                if (this._isSaving) {
                    this.showToast('⏳ Guardado en progreso...');
                    if (returnBytes) throw new Error('SAVE_ALREADY_IN_PROGRESS');
                    return;
                }
                this._isSaving = true;

                const doc = sourceDocument || this.getDoc();
                if (!doc || !doc.pages.length) { this._isSaving = false; return; }

                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Generando PDF...";

                try {
                    const out = await PDFLib.PDFDocument.create();
                    if (window.fontkit) out.registerFontkit(fontkit);

                    // DYNAMIC FONT LOADING - Scan all objects to find needed fonts
                    const pagesToProcess = onlyCurrentPage ? [doc.pages[doc.currentIndex]] : doc.pages;
                    const _autoSizeFieldNames = new Set();
                    const deletedNativeFields = new Set();
                    const neededFonts = new Set();

                    for (const p of pagesToProcess) {
                        for (const o of p.objects || []) {
                            if (o.type === 'text') {
                                // Add base font
                                if (o.font) neededFonts.add(o.font);

                                // ✅ FIX: Add bold/italic variants if needed
                                if (o.bold || o.italic) {
                                    let baseFontKey = o.font || 'Helvetica';

                                    // ✅ CRITICAL: Map internal fonts to Helvetica BEFORE checking variants
                                    if (baseFontKey.startsWith('g_d') || baseFontKey.startsWith('g_')) {
                                        baseFontKey = 'Helvetica';
                                    }

                                    if (baseFontKey === 'Arial') baseFontKey = 'Helvetica';
                                    if (baseFontKey === 'Times New Roman') baseFontKey = 'Times-Roman';
                                    if (baseFontKey === 'Courier New') baseFontKey = 'Courier';

                                    if (baseFontKey === 'Helvetica') {
                                        if (o.bold && o.italic) neededFonts.add('Helvetica-BoldOblique');
                                        else if (o.bold) neededFonts.add('Helvetica-Bold');
                                        else if (o.italic) neededFonts.add('Helvetica-Oblique');
                                    } else if (baseFontKey === 'Times-Roman') {
                                        if (o.bold && o.italic) neededFonts.add('Times-BoldItalic');
                                        else if (o.bold) neededFonts.add('Times-Bold');
                                        else if (o.italic) neededFonts.add('Times-Italic');
                                    } else if (baseFontKey === 'Courier') {
                                        if (o.bold && o.italic) neededFonts.add('Courier-BoldOblique');
                                        else if (o.bold) neededFonts.add('Courier-Bold');
                                        else if (o.italic) neededFonts.add('Courier-Oblique');
                                    }
                                }
                            }
                            if (o.type === 'link' && o.font) {
                                neededFonts.add(o.font);
                            }
                            // form-field text/dropdown: registrar variante bold/italic en neededFonts
                            // SIN esto, getFont() devuelve null y se ignora bold/italic en el PDF
                            if (o.type === 'form-field' && (o.fieldType === 'text' || o.fieldType === 'dropdown' || o.fieldType === 'Ch' || o.fieldType === 'signature')) {
                                let _ffBase = o.font || 'Helvetica';
                                if (_ffBase === 'Arial')           _ffBase = 'Helvetica';
                                if (_ffBase === 'Times New Roman') _ffBase = 'Times-Roman';
                                if (_ffBase === 'Courier New')     _ffBase = 'Courier';
                                if (_ffBase === 'Georgia')         _ffBase = 'Times-Roman';
                                if (_ffBase === 'Verdana')         _ffBase = 'Helvetica';
                                if (o.bold && o.italic) {
                                    if (_ffBase === 'Helvetica')        neededFonts.add('Helvetica-BoldOblique');
                                    else if (_ffBase === 'Times-Roman') neededFonts.add('Times-BoldItalic');
                                    else if (_ffBase === 'Courier')     neededFonts.add('Courier-BoldOblique');
                                    else neededFonts.add(_ffBase);
                                } else if (o.bold) {
                                    if (_ffBase === 'Helvetica')        neededFonts.add('Helvetica-Bold');
                                    else if (_ffBase === 'Times-Roman') neededFonts.add('Times-Bold');
                                    else if (_ffBase === 'Courier')     neededFonts.add('Courier-Bold');
                                    else neededFonts.add(_ffBase);
                                } else if (o.italic) {
                                    if (_ffBase === 'Helvetica')        neededFonts.add('Helvetica-Oblique');
                                    else if (_ffBase === 'Times-Roman') neededFonts.add('Times-Italic');
                                    else if (_ffBase === 'Courier')     neededFonts.add('Courier-Oblique');
                                    else neededFonts.add(_ffBase);
                                } else {
                                    neededFonts.add(_ffBase);
                                }
                            }
                            // Add calendar fonts (including bold/italic variants)
                            if (o.type === 'form-field' && o.fieldType === 'calendar' && o.calendarState) {
                                const cs = o.calendarState;
                                const base = cs.font || 'Helvetica';

                                // Helper to register variant
                                const addVariant = (bold, italic) => {
                                    let k = base;
                                    if (k === 'Arial') k = 'Helvetica';
                                    if (k === 'Times New Roman') k = 'Times-Roman';
                                    if (k === 'Courier New') k = 'Courier';

                                    if (bold && italic) {
                                        if (k === 'Helvetica') neededFonts.add('Helvetica-BoldOblique');
                                        else if (k === 'Times-Roman') neededFonts.add('Times-BoldItalic');
                                        else if (k === 'Courier') neededFonts.add('Courier-BoldOblique');
                                    } else if (bold) {
                                        if (k === 'Helvetica') neededFonts.add('Helvetica-Bold');
                                        else if (k === 'Times-Roman') neededFonts.add('Times-Bold');
                                        else if (k === 'Courier') neededFonts.add('Courier-Bold');
                                    } else if (italic) {
                                        if (k === 'Helvetica') neededFonts.add('Helvetica-Oblique');
                                        else if (k === 'Times-Roman') neededFonts.add('Times-Italic');
                                        else if (k === 'Courier') neededFonts.add('Courier-Oblique');
                                    } else {
                                        neededFonts.add(k);
                                    }
                                };

                                addVariant(cs.headerBold, cs.headerItalic);
                                addVariant(cs.weekdayBold !== undefined ? cs.weekdayBold : true, cs.weekdayItalic);
                                addVariant(cs.dayBold, cs.dayItalic);
                            }

                            // Add table cell fonts
                            if (o.type === 'table' && o.cellStyles) {
                                // Scan all cells for custom fonts/styles
                                for (let r = 0; r < o.rows; r++) {
                                    if (!o.cellStyles[r]) continue;
                                    for (let c = 0; c < o.cols; c++) {
                                        const style = o.cellStyles[r][c];
                                        if (style) {
                                            const family = style.fontFamily || o.fontFamily || 'Helvetica';
                                            const isBold = style.bold;
                                            const isItalic = style.italic;

                                            // Helper to resolve font name same as above
                                            // Ideally this helper should be defined outside loops, but duplicating for safety/scope
                                            let k = family;
                                            if (k === 'Arial') k = 'Helvetica';
                                            if (k === 'Times New Roman') k = 'Times-Roman';
                                            if (k === 'Courier New') k = 'Courier';

                                            if (isBold && isItalic) {
                                                if (k === 'Helvetica') neededFonts.add('Helvetica-BoldOblique');
                                                else if (k === 'Times-Roman') neededFonts.add('Times-BoldItalic');
                                                else if (k === 'Courier') neededFonts.add('Courier-BoldOblique');
                                            } else if (isBold) {
                                                if (k === 'Helvetica') neededFonts.add('Helvetica-Bold');
                                                else if (k === 'Times-Roman') neededFonts.add('Times-Bold');
                                                else if (k === 'Courier') neededFonts.add('Courier-Bold');
                                            } else if (isItalic) {
                                                if (k === 'Helvetica') neededFonts.add('Helvetica-Oblique');
                                                else if (k === 'Times-Roman') neededFonts.add('Times-Italic');
                                                else if (k === 'Courier') neededFonts.add('Courier-Oblique');
                                            } else {
                                                neededFonts.add(k);
                                            }
                                        }
                                    }
                                }
                            }

                        }
                    }

                    // Always include Helvetica as fallback
                    neededFonts.add('Helvetica');


                    document.getElementById('loader-msg').innerText = "Cargando fuentes...";

                    // Load and embed all needed fonts
                    const embeddedFonts = {};
                    const standardFonts = [
                        'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
                        'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
                        'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'
                    ];

                    for (const fontKey of neededFonts) {
                        try {
                            if (standardFonts.includes(fontKey)) {
                                embeddedFonts[fontKey] = await out.embedFont(fontKey);
                                console.log('✓ Embedded standard font:', fontKey);
                            } else {
                                embeddedFonts[fontKey] = await this.fontRegistry.embedFont(out, fontKey);
                                console.log('✓ Embedded registered font:', fontKey);
                            }
                        } catch (e) {
                            console.warn('✗ Failed to embed font:', fontKey, e);
                            // Fallback to Helvetica
                            if (!embeddedFonts['Helvetica']) {
                                embeddedFonts['Helvetica'] = await out.embedFont(PDFLib.StandardFonts.Helvetica);
                            }
                            embeddedFonts[fontKey] = embeddedFonts['Helvetica'];
                        }
                    }

                    // Helper to get font for an object
                    const getFont = (fontKey) => {
                        return embeddedFonts[fontKey] || embeddedFonts['Helvetica'];
                    };

                    document.getElementById('loader-msg').innerText = "Generando PDF...";

                    // Helper: Convert hex color string to PDFLib.rgb color
                    const hexToRgb = (hex) => {
                        if (!hex) return PDFLib.rgb(0, 0, 0);
                        hex = hex.replace('#', '');
                        if (hex.length === 3) {
                            hex = hex.split('').map(c => c + c).join('');
                        }
                        const num = parseInt(hex, 16);
                        return PDFLib.rgb(
                            ((num >> 16) & 255) / 255,
                            ((num >> 8) & 255) / 255,
                            (num & 255) / 255
                        );
                    };

                    // Helper: Safe color conversion with fallback
                    const getSafeColor = (colorStr, defaultCol) => {
                        if (!colorStr) return defaultCol || PDFLib.rgb(0, 0, 0);
                        try {
                            if (colorStr.startsWith('#')) return hexToRgb(colorStr);
                            if (colorStr.startsWith('rgba')) {
                                const m = colorStr.match(/[\d.]+/g);
                                if (m && m.length >= 3) return PDFLib.rgb(m[0] / 255, m[1] / 255, m[2] / 255);
                            }
                        } catch (e) { }
                        return defaultCol || PDFLib.rgb(0, 0, 0);
                    };




                    // Cache for loaded source documents to prevent resource duplication
                    // If we load the same source doc multiple times, resources (fonts, images) are duplicated in output
                    const loadedSourceDocs = {};
                    const importedNativeFieldRefs = new Set();

                    let _docPageIdx = 0;
                    for (const p of pagesToProcess) {
                        const _currentDocPageIdx = _docPageIdx++;
                        const src = doc.sources[p.sourceId];
                        const generatedIndex = p.sourceId === 'generated-index' && !src?.buffer;
                        let pageAlreadyAdded = false;
                        let cp;
                        if (generatedIndex) {
                            const width = Number(p.width) || 612;
                            const height = Number(p.height) || 792;
                            cp = out.addPage([width, height]);
                            pageAlreadyAdded = true;
                        } else {
                            if (!src?.buffer) throw new Error('SOURCE_PDF_UNAVAILABLE');
                            let srcDoc = loadedSourceDocs[p.sourceId];
                            if (!srcDoc) {
                            // originalBuffer repairs sessions created by the former destructive form editor.
                            // New sessions always keep and copy the original AcroForm source.
                            const bufferToLoad = sourceDocument ? src.buffer : (src.originalBuffer || src.buffer);
                            srcDoc = await Promise.race([
                                PDFLib.PDFDocument.load(bufferToLoad, { ignoreEncryption: true }),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('PDF load timed out after 30s — file may be corrupt')), 30000))
                            ]);
                            loadedSourceDocs[p.sourceId] = srcDoc;
                        }

                            [cp] = await out.copyPages(srcDoc, [p.pageIndex]);
                            out.addPage(cp);
                            pageAlreadyAdded = true;
                            this._importNativeFormFieldsFromPage(out, cp, importedNativeFieldRefs);
                        }

                        // --------------------------------------------------------
                        // FORM FIELD HANDLING STRATEGY:
                        // Instead of deleting original fields, we UPDATE them.
                        // This keeps the PDF interactive and preserves non-modified fields.
                        // --------------------------------------------------------

                        for (const name of p.deletedNativeFields || []) {
                            if (typeof name === 'string') deletedNativeFields.add(name);
                        }


                        const { width: _rawW, height: _rawH } = cp.getSize();
                        const currentRotationAngle = cp.getRotation().angle;

                        // cp.getSize() devuelve el mediaBox SIN aplicar la rotación intrínseca.
                        // PDF.js sí aplica la rotación al viewport, por lo que las coordenadas de
                        // los objetos (o.x, o.y) están en el sistema del viewport rotado.
                        // Si la rotación intrínseca es 90° o 270°, width y height están intercambiados.
                        let pageWidth, pageHeight;
                        if (currentRotationAngle === 90 || currentRotationAngle === 270) {
                            pageWidth = _rawH;
                            pageHeight = _rawW;
                        } else {
                            pageWidth = _rawW;
                            pageHeight = _rawH;
                        }
                        // Store for comment coordinate conversion
                        p._pdfW = pageWidth; p._pdfH = pageHeight;

                        // Rotación de página base
                        const totalRotation = (currentRotationAngle + p.rotation) % 360;
                        cp.setRotation(PDFLib.degrees(totalRotation));

                        // Espejo de página - FIX: Flip desde el centro
                        if (p.flipH) {
                            cp.translateContent(pageWidth / 2, 0);
                            cp.scaleContent(-1, 1);
                            cp.translateContent(-pageWidth / 2, 0);
                        }
                        if (p.flipV) {
                            cp.translateContent(0, pageHeight / 2);
                            cp.scaleContent(1, -1);
                            cp.translateContent(0, -pageHeight / 2);
                        }

                        // ── Handle Native Comments Modifications (PDF-Lib Fallback) ──
                        // If Python (PyMuPDF) is not available, we try to update colors/text via PDF-Lib
                        if (!PythonManager.isLoaded && doc.modifiedNativeComments && doc.modifiedNativeComments[_currentDocPageIdx]) {
                            try {
                                const mods = doc.modifiedNativeComments[_currentDocPageIdx];
                                const annots = cp.node.get(PDFLib.PDFName.of('Annots'));
                                if (annots instanceof PDFLib.PDFArray) {
                                    // Build lookup of annotation contents for content-based matching
                                    const annotEntries = [];
                                    for (let i = 0; i < annots.size(); i++) {
                                        const annotRef = annots.get(i);
                                        const annot = out.context.lookup(annotRef);
                                        if (!annot) continue;
                                        const refStr = annotRef.toString();
                                        const xref = refStr.replace(/[() R]/g, '').split(' ')[0];
                                        const contentsRaw = annot.get(PDFLib.PDFName.of('Contents'));
                                        const contentsStr = contentsRaw ? contentsRaw.decodeText?.() || contentsRaw.value || '' : '';
                                        annotEntries.push({ annot, xref, contents: contentsStr });
                                    }
                                    // For each modification, try to find matching annotation
                                    for (const [modKey, mod] of Object.entries(mods)) {
                                        if (!mod) continue;
                                        // Try xref match first
                                        let entry = annotEntries.find(e => e.xref === modKey || (e.xref + 'R') === modKey || modKey === (e.xref + 'R'));
                                        // Fallback: content match
                                        if (!entry && mod.text) {
                                            const modText = (mod.text || '').trim();
                                            entry = annotEntries.find(e => e.contents.trim() === modText || e.contents.includes(modText) || modText.includes(e.contents.trim()));
                                        }
                                        const annot = entry?.annot;
                                        if (annot && mod) {
                                            if (mod.color) {
                                                const c = hexToRgb(mod.color);
                                                annot.set(PDFLib.PDFName.of('C'), out.context.obj([c.red, c.green, c.blue]));
                                            }
                                            if (mod.text || mod.reactions) {
                                                let fullText = mod.text || annot.getContents() || '';
                                                if (mod.reactions && Object.keys(mod.reactions).length > 0) {
                                                    fullText += '\n\nReacciones: ' + Object.entries(mod.reactions).map(([e, n]) => `${e} ${n}`).join(', ');
                                                }
                                                if (mod.replies && mod.replies.length > 0) {
                                                    fullText += '\n\n— Respuestas —\n' + mod.replies.map(r => {
                                                        let rt = `${r.author}: ${r.text}`;
                                                        if (r.reactions && Object.keys(r.reactions).length > 0) {
                                                            rt += ' [' + Object.entries(r.reactions).map(([e, n]) => `${e} ${n}`).join(', ') + ']';
                                                        }
                                                        return rt;
                                                    }).join('\n');
                                                }
                                                annot.set(PDFLib.PDFName.of('Contents'), PDFLib.PDFString.of(fullText));
                                            }
                                            if (mod.author) annot.set(PDFLib.PDFName.of('T'), PDFLib.PDFString.of(mod.author));
                                            if (mod.resolved) annot.set(PDFLib.PDFName.of('F'), PDFLib.PDFNumber.of(2)); // Hidden flag
                                        }
                                    }
                                }
                            } catch (e) { console.warn("PDF-Lib native update failed", e); }
                        }

                        // Dibujar objetos
                        for (const o of p.objects) {
                            // PDF-Lib uses Bottom-Left origin, Canvas uses Top-Left. 
                            // Y = PageHeight - Y_Canvas - ObjectHeight

                            const objH = o.height;
                            const objW = o.width;

                            // Ajuste de Y para sistema de coordenadas PDF
                            // La posición 'o.y' es top-left en canvas. En PDF es bottom-left.
                            // Y_PDF = pageHeight - o.y - o.height
                            let pdfY = pageHeight - o.y - objH;
                            let pdfX = o.x;

                            if (o.type === 'comment') {
                                if (o._isNative) continue; // EVITAR DUPLICADOS: No re-añadir como nuevo si ya era nativo
                                try {
                                    let fullText = o.text || '';
                                    if (o.reactions && Object.keys(o.reactions).length > 0) {
                                        fullText += '\n\nReacciones: ' + Object.entries(o.reactions).map(([e, n]) => `${e} ${n}`).join(', ');
                                    }
                                    if (o.replies && o.replies.length > 0) {
                                        fullText += '\n\n— Respuestas —\n' + o.replies.map(r => `${r.author || 'Usuario'}: ${r.text || ''}`).join('\n');
                                    }
                                    const col = hexToRgb(o.color || '#3b82f6');

                                    if (o.translationNote) {
                                        const originalText = o.sourceText || o.translationReference;
                                        if (originalText) fullText = `Original: ${originalText}\n\nTraducción: ${fullText}`;
                                        const noteW = Math.max(20, o.width || 80);
                                        const noteH = Math.max(12, o.height || 18);
                                        const tPdfY = pageHeight - o.y - noteH;
                                        const tPdfX = o.x;
                                        const annot = out.context.register(
                                            out.context.obj({
                                                Type: 'Annot',
                                                Subtype: 'Highlight',
                                                Rect: [tPdfX, tPdfY, tPdfX + noteW, tPdfY + noteH],
                                                QuadPoints: [
                                                    tPdfX, tPdfY + noteH,
                                                    tPdfX + noteW, tPdfY + noteH,
                                                    tPdfX, tPdfY,
                                                    tPdfX + noteW, tPdfY
                                                ],
                                                Contents: PDFLib.PDFHexString.fromText(fullText),
                                                T: PDFLib.PDFHexString.fromText(o.author || 'Traducción'),
                                                C: [col.red, col.green, col.blue],
                                                CA: 0.06,
                                                F: 4
                                            })
                                        );
                                        cp.node.addAnnot(annot);
                                        continue;
                                    }

                                    const annot = out.context.register(
                                        out.context.obj({
                                            Type: 'Annot',
                                            Subtype: 'Text',
                                            Rect: [pdfX, pdfY, pdfX + 24, pdfY + 24],
                                            Contents: PDFLib.PDFString.of(fullText),
                                            T: PDFLib.PDFString.of(o.author || 'Usuario'),
                                            C: [col.red, col.green, col.blue],
                                            Name: 'Comment',
                                            F: o.resolved ? 2 : 4 // 2=Hidden, 4=Printable
                                        })
                                    );
                                    cp.node.addAnnot(annot);
                                } catch (e) { console.error("Error drawing comment with PDF-Lib", e); }
                                continue;
                            }

                            // --- HANDLE ORIGINAL FORM FIELDS ---
                            // Native edit overlays retain an immutable lookup name so renamed fields can
                            // still be updated instead of falling through to the new-field path.
                            let nativeFieldUpdated = false;
                            if (o.fromFormField && (o.nativeFieldName || o.fieldName) && o.type === 'form-field') {
                                try {
                                    const form = out.getForm();
                                    const nativeFieldName = o.nativeFieldName || o.fieldName;
                                    const field = form.getField(nativeFieldName);
                                    if (field) {
                                        console.log('📝 Updating original form field:', nativeFieldName);

                                        const requestedName = String(o.fieldName || nativeFieldName).trim();
                                        if (requestedName && requestedName !== nativeFieldName) {
                                            const collision = form.getFieldMaybe(requestedName);
                                            if (collision) {
                                                console.warn('⚠️ Native field rename skipped because the target already exists:', requestedName);
                                                o.fieldName = nativeFieldName;
                                            } else {
                                                const oldParts = nativeFieldName.split('.');
                                                const newParts = requestedName.split('.');
                                                const sameParent = oldParts.slice(0, -1).join('.') === newParts.slice(0, -1).join('.');
                                                if (sameParent) {
                                                    field.acroField.setPartialName(newParts[newParts.length - 1]);
                                                    o.nativeFieldName = requestedName;
                                                } else {
                                                    console.warn('⚠️ Native field rename skipped because changing its hierarchy is unsafe:', requestedName);
                                                    o.fieldName = nativeFieldName;
                                                }
                                            }
                                        }

                                        // Update Value
                                        const isText = o.type === 'text' || o.fieldType === 'text';

                                        if (isText) {
                                            if (field instanceof PDFLib.PDFTextField) {
                                                field.setText(o.textValue || o.text || o.value || '');
                                                if (o.autoSize) {
                                                    this._setNativeFieldAutoSize(field);
                                                    _autoSizeFieldNames.add(o.fieldName || o.nativeFieldName);
                                                }
                                                else if (Number(o.fontSize) > 0) field.setFontSize(Number(o.fontSize));
                                                if (o.multiline) field.enableMultiline(); else field.disableMultiline();
                                                if (o.textAlign === 'center') field.setAlignment(PDFLib.TextAlignment.Center);
                                                else if (o.textAlign === 'right') field.setAlignment(PDFLib.TextAlignment.Right);
                                                else field.setAlignment(PDFLib.TextAlignment.Left);
                                            }
                                        } else {
                                            if (o.fieldType === 'Btn' || o.fieldType === 'checkbox' || o.subtype === 'checkbox') {
                                                if (field instanceof PDFLib.PDFCheckBox) {
                                                    if (o.checked) field.check(); else field.uncheck();
                                                }
                                            } else if (o.fieldType === 'radio' || o.subtype === 'radio') {
                                                if (field instanceof PDFLib.PDFRadioGroup && (o.selected || o.checked)) {
                                                    const optionValue = o.value || o.exportValue;
                                                    if (optionValue) field.select(String(optionValue));
                                                }
                                            } else if (o.fieldType === 'Ch' || o.fieldType === 'dropdown' || o.subtype === 'select') {
                                                if (field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList) {
                                                    if (o.nativeStyleChanged && Array.isArray(o.options)) field.setOptions(o.options.map(String));
                                                    const val = o.selectedValue ?? o.value ?? '';
                                                    if (val === '' && field.clear) field.clear();
                                                    else if (val) {
                                                        try { field.select(val); } catch (e) { console.warn("Failed to select option", val); }
                                                    }
                                                    if (!o.autoSize && Number(o.fontSize) > 0) field.setFontSize(Number(o.fontSize));
                                                }
                                            }
                                        }

                                        // Sync flags
                                        try {
                                            if (o.readOnly !== undefined) {
                                                if (o.readOnly) field.enableReadOnly(); else field.disableReadOnly();
                                            }
                                            if (o.required !== undefined) {
                                                if (o.required) field.enableRequired(); else field.disableRequired();
                                            }
                                        } catch (flagErr) { }

                                        // Update the exact widget when a logical field has multiple widgets.
                                        try {
                                            const widgets = field.acroField.getWidgets();
                                            if (widgets.length > 0) {
                                                const widgetIndex = Math.min(Math.max(Number(o.nativeWidgetIndex) || 0, 0), widgets.length - 1);
                                                const widget = widgets[widgetIndex];
                                                widget.setRectangle({
                                                    x: pdfX,
                                                    y: pdfY,
                                                    width: objW,
                                                    height: objH
                                                });
                                                if (o.nativeStyleChanged) {
                                                    const appearance = widget.getOrCreateAppearanceCharacteristics();
                                                    const parseRgb = value => {
                                                        const match = String(value || '').match(/#([0-9a-f]{6})/i);
                                                        if (!match) return null;
                                                        return [0, 1, 2].map(index => parseInt(match[1].slice(index * 2, index * 2 + 2), 16) / 255);
                                                    };
                                                    const background = parseRgb(o.backgroundColor);
                                                    const border = parseRgb(o.borderColor);
                                                    if (o.noBg || !background) appearance.dict.delete(PDFLib.PDFName.of('BG'));
                                                    else appearance.setBackgroundColor(background);
                                                    if (border) appearance.setBorderColor(border);
                                                    widget.getOrCreateBorderStyle().setWidth(Math.max(0, Number(o.borderWidth) || 0));
                                                }
                                                console.log('📏 Updated native field geometry:', o.nativeFieldName || o.fieldName);
                                            }
                                        } catch (geomErr) {
                                            console.warn('⚠️ Could not update geometry for:', o.nativeFieldName || o.fieldName, geomErr);
                                        }

                                        nativeFieldUpdated = true;
                                        // Skip drawing static overlay
                                        continue;
                                    }
                                } catch (e) {
                                    console.warn('⚠️ Could not update original field:', o.fieldName, e);
                                    // nativeFieldUpdated remains false → fall through to static rendering below
                                }
                            }

                            // --- HANDLE NEW FORM FIELDS (User added) OR fromFormField that couldn't update natively ---
                            if (o.type === 'form-field' && (!o.fromFormField || !nativeFieldUpdated)) {
                                try {
                                    const form = out.getForm();
                                    const fieldName = o.fieldName || o.id; // Use fieldName if available

                                    console.log('📝 Creating NEW form field:', fieldName, o.fieldType);

                                    // === FORM FIELD PDF RENDERING ===
                                    const borderWidthVal = o.borderWidth !== undefined ? o.borderWidth : 1;
                                    const hasBorder     = o.borderStyle !== 'none' && borderWidthVal > 0;
                                    const hasBackground = !o.noBg;
                                    const borderRadius  = parseFloat(o.borderRadius) || 0;

                                    const bgColorVal    = o.backgroundColor || '#ffffff';
                                    const borderColorVal = o.borderColor || '#999999';
                                    let bgColor   = getSafeColor(bgColorVal);
                                    const borderColor = hasBorder ? getSafeColor(borderColorVal) : null;
                                    let dashArray = undefined;
                                    if (o.borderStyle === 'dashed') dashArray = [4, 2];
                                    else if (o.borderStyle === 'dotted') dashArray = [1, 1];
                                    if (o.fieldType === 'calendar' && o.calendarState && o.calendarState.bgColor)
                                        bgColor = getSafeColor(o.calendarState.bgColor);

                                    // Normalize field type
                                    const rawType    = o.fieldType || '';
                                    const fType      = rawType.toLowerCase().trim();
                                    const isCalendar  = fType === 'calendar';
                                    const isSignature = fType === 'signature';
                                    const isCheckbox  = fType === 'btn' || fType === 'checkbox';
                                    const isDropdown  = fType === 'ch' || fType === 'dropdown' || fType === 'select';
                                    const isRadio     = fType === 'radio';
                                    const isTextField = (fType==='tx'||fType==='text'||fType==='input'||!fType)
                                        && !isCalendar && !isSignature && !isCheckbox && !isDropdown && !isRadio;

                                    // Font resolution (bold/italic variant)
                                    // Georgia/Verdana no existen en pdf-lib → fallback a Times/Helvetica
                                    const _resolveFontKey = (base) => {
                                        let k = (base || 'Helvetica').trim();
                                        if (k==='Arial')           k='Helvetica';
                                        if (k==='Times New Roman') k='Times-Roman';
                                        if (k==='Courier New')     k='Courier';
                                        if (k==='Georgia')         k='Times-Roman';
                                        if (k==='Verdana')         k='Helvetica';
                                        if (o.bold&&o.italic){ if(k==='Helvetica')return'Helvetica-BoldOblique'; if(k==='Times-Roman')return'Times-BoldItalic'; if(k==='Courier')return'Courier-BoldOblique'; }
                                        else if(o.bold)      { if(k==='Helvetica')return'Helvetica-Bold';        if(k==='Times-Roman')return'Times-Bold';        if(k==='Courier')return'Courier-Bold'; }
                                        else if(o.italic)    { if(k==='Helvetica')return'Helvetica-Oblique';     if(k==='Times-Roman')return'Times-Italic';       if(k==='Courier')return'Courier-Oblique'; }
                                        return k;
                                    };
                                    const _rfont       = getFont(_resolveFontKey(o.font));
                                    // _bgCol: siempre blanco cuando noBg para evitar negro en visores PDF.
                                    const _bgCol       = hasBackground ? bgColor : null;
                                    const _textCol     = (o.fontColor||o.textColor||o.color) ? getSafeColor(o.fontColor||o.textColor||o.color) : undefined;

                                    // SVG rounded-rect helper
                                    const _svgRound = (w, h, r) => {
                                        const cr = Math.min(r, w/2, h/2);
                                        return [`M ${cr} 0`,`L ${w-cr} 0`,`Q ${w} 0 ${w} ${cr}`,
                                                `L ${w} ${h-cr}`,`Q ${w} ${h} ${w-cr} ${h}`,
                                                `L ${cr} ${h}`,`Q 0 ${h} 0 ${h-cr}`,
                                                `L 0 ${cr}`,`Q 0 0 ${cr} 0`,'Z'].join(' ');
                                    };
                                    // Draw bg+border as vector (rect or rounded)
                                    const _drawVisual = (fillCol, strokeCol, strokeW) => {
                                        const opts = {};
                                        if (fillCol)  opts.color       = fillCol;
                                        if (strokeCol){ opts.borderColor = strokeCol; opts.borderWidth = strokeW||1; }
                                        if (dashArray) opts.borderDashArray = dashArray;
                                        if (borderRadius > 0) {
                                            try { cp.drawSvgPath(_svgRound(objW,objH,borderRadius),{x:pdfX,y:pdfY+objH,scale:1,...opts}); return; }
                                            catch(e){}
                                        }
                                        cp.drawRectangle({x:pdfX,y:pdfY,width:objW,height:objH,...opts});
                                    };

                                    console.log(`🔍 Field:"${fieldName}" type:"${fType}" radius:${borderRadius}`);

                                    // ══════════════════════════════════════════════════════════════
                                    // OPCIÓN C: Siempre AcroField interactivo con border radius.
                                    // 3 capas cuando borderRadius > 0:
                                    //   1) Fondo redondeado (SVG fill) dibujado debajo
                                    //   2) AcroField reducido por _inset → esquinas cuadradas
                                    //      quedan enterradas bajo la capa 1
                                    //   3) Stroke redondeado encima → tapa esquinas residuales
                                    // IMPORTANTE: AcroField SIEMPRE recibe backgroundColor para
                                    // evitar que el visor PDF lo rellene de negro.
                                    // ══════════════════════════════════════════════════════════════

                                    // Inset: oculta esquinas del AcroField sin sacrificar área útil
                                    // Escala 0.6× el borderRadius, máximo 6px
                                    const _insetX = borderRadius >= 6 ? Math.min(borderRadius * 0.4, 4) : 0;
                                    const _insetY = borderRadius >= 6 ? Math.min(borderRadius * 0.2, 2) : 0;
                                    const _inset = _insetX; // Mantener compatibilidad con usos existentes de _inset


                                    // Helper: stroke encima del AcroField (capa 3)
                                    // Para borderRadius > 0: stroke redondeado (SVG path)
                                    // Para borderRadius = 0: rect stroke puro (sin fill) — cubre borde tapado por el widget
                                    const _drawBorderOverlay = () => {
                                        if (!hasBorder) return;
                                        try {
                                            if (borderRadius > 0) {
                                                cp.drawSvgPath(_svgRound(objW, objH, borderRadius), {
                                                    x: pdfX, y: pdfY + objH, scale: 1,
                                                    borderColor: borderColor,
                                                    borderWidth: borderWidthVal,
                                                    color: undefined
                                                });
                                            } else {
                                                // Rect sin fill — solo borde — encima del widget
                                                cp.drawRectangle({
                                                    x: pdfX, y: pdfY, width: objW, height: objH,
                                                    borderColor: borderColor,
                                                    borderWidth: borderWidthVal,
                                                    color: undefined,
                                                    ...(dashArray ? {borderDashArray: dashArray} : {})
                                                });
                                            }
                                        } catch(e) {}
                                    };

                                    if (!isCalendar) {
                                        // ── ACROFIELD PATH: editable interactive field ──

                                        // Capa 1: fondo (redondeado si borderRadius > 0, rect si = 0)
                                        // Para borderRadius > 0 NO dibujamos el borde aquí — lo hace la capa 3
                                        if (!isCheckbox && !isRadio) {
                                            // Capa 1: solo fondo (sin borde — el borde lo dibuja _drawBorderOverlay encima del widget)
                                            _drawVisual(_bgCol, undefined, borderWidthVal);
                                        }

                                        if (isTextField) {
                                            // ── Calcular fontSize final ──────────────────────────
                                            let _fs = Number(o.fontSize) || 12;
                                            if (o.autoSize) {
                                                const _txt = String(o.text || o.value || o.textValue || '');
                                                const _availW = objW - _inset * 2 - 4;
                                                const _availH = objH - _inset * 2;
                                                // Height-based starting size
                                                _fs = Math.max(3, _availH * 0.72);
                                                if (_txt.length > 0 && _rfont) {
                                                    try {
                                                        if (o.multiline) {
                                                            // Fit longest line to available width
                                                            const lines = _txt.split(/\r?\n/);
                                                            const longest = lines.reduce((a,b) => b.length > a.length ? b : a, '');
                                                            const tw = _rfont.widthOfTextAtSize(longest, _fs);
                                                            if (tw > _availW) _fs = Math.max(3, _fs * (_availW / tw));
                                                        } else {
                                                            // Single line: fit to both width and height
                                                            const tw = _rfont.widthOfTextAtSize(_txt, _fs);
                                                            if (tw > _availW) _fs = Math.max(3, _fs * (_availW / tw));
                                                        }
                                                    } catch(e) {}
                                                }
                                            } else if (o.text || o.value || o.textValue) {
                                                const _txt = String(o.text || o.value || o.textValue || '');
                                                const _availW = objW - _inset * 2 - 8;
                                                try {
                                                    const _tw = _rfont.widthOfTextAtSize(_txt, _fs);
                                                    if (_tw > _availW) _fs = Math.max(6, _fs * (_availW / _tw));
                                                } catch(e) {}
                                            }

                                            // ── twoColumns: crear dos AcroFields lado a lado ─────
                                            if (o.twoColumns) {
                                                const _fullTxt = String(o.text || o.value || o.textValue || '');
                                                const _mid = _fullTxt.indexOf(' ', Math.floor(_fullTxt.length / 2));
                                                const _splitIdx = _mid !== -1 ? _mid : Math.floor(_fullTxt.length / 2);
                                                const _col1txt = _fullTxt.substring(0, _splitIdx).trim();
                                                const _col2txt = _fullTxt.substring(_splitIdx).trim();
                                                const _colW = (objW - _insetX * 2) / 2 - 2;
                                                const _colH = objH - _insetY * 2;

                                                const _makeColField = (txt, colX, colFieldName) => {
                                                    try {
                                                        const cf = form.createTextField(colFieldName);
                                                        cf.setText(txt);
                                                        if (o.multiline) cf.enableMultiline();
                                                        const copts = {x: colX, y: pdfY+_insetY, width: _colW, height: _colH, borderWidth: 0};
                                                        if (_rfont)   copts.font        = _rfont;
                                                        if (_textCol) copts.textColor   = _textCol;
                                                        if (_bgCol !== null) copts.backgroundColor = _bgCol;
                                                         cf.addToPage(cp, copts);
                                                         cf.setFontSize(_fs);
                                                         if (o.autoSize) _autoSizeFieldNames.add(colFieldName);
                                                         if (_rfont) try { cf.updateAppearances(_rfont); } catch(e){}
                                                    } catch(e) { console.warn('twoCol field error:', e); }
                                                };
                                                _makeColField(_col1txt, pdfX+_insetX,          fieldName+'_col1');
                                                _makeColField(_col2txt, pdfX+_insetX+_colW+4,  fieldName+'_col2');

                                            } else {
                                                // ── Campo único (normal, multiline o autoSize) ───
                                                const field = form.createTextField(fieldName);
                                                field.setText(o.text || o.value || o.textValue || '');
                                                if (o.multiline) field.enableMultiline();
                                                const _widgetBorderW = (hasBorder && borderRadius === 0) ? borderWidthVal : 0;
                                                const _widgetBorderC = (hasBorder && borderRadius === 0) ? borderColor : undefined;
                                                const opts = {x:pdfX, y:pdfY, width:objW, height:objH, borderWidth:_widgetBorderW};
                                                if (_widgetBorderC) opts.borderColor = _widgetBorderC;
                                                if (_rfont)   opts.font        = _rfont;
                                                if (_textCol) opts.textColor   = _textCol;
                                                if (_bgCol !== null) opts.backgroundColor = _bgCol;
                                                 field.addToPage(cp, opts);
                                                 field.setFontSize(_fs); // Tamaño de la apariencia actual; DA vuelve a 0 al finalizar si autoSize.
                                                 if (o.autoSize) _autoSizeFieldNames.add(fieldName);
                                                 if (o.textAlign==='center') field.setAlignment(PDFLib.TextAlignment.Center);
                                                else if (o.textAlign==='right') field.setAlignment(PDFLib.TextAlignment.Right);
                                                else field.setAlignment(PDFLib.TextAlignment.Left);
                                                if (_rfont) try { field.updateAppearances(_rfont); } catch(e){}
                                            }
                                            // Capa 3: stroke redondeado encima
                                            _drawBorderOverlay();
                                            console.log('✅ TextField (OpC):', fieldName, '| inset:', _inset, '| twoCol:', !!o.twoColumns, '| multiline:', !!o.multiline, '| fs:', _fs);

                                        } else if (isCheckbox) {
                                            // max1 group: use radio group with checkbox appearance (PDF-native exclusivity)
                                            const cbGroupRule = o.groupRule || 'none';
                                            const cbGroupName = o.groupName || '';
                                            if (cbGroupRule === 'max1' && cbGroupName) {
                                                try {
                                                    const rgName = 'cbg_' + cbGroupName;
                                                    let rg; try{rg=form.getRadioGroup(rgName);}catch(e){rg=form.createRadioGroup(rgName);}
                                                    const optName = fieldName;
                                                    rg.addOptionToPage(optName, cp, {x:pdfX, y:pdfY, width:objW, height:objH});
                                                    if (o.checked) try{rg.select(optName);}catch(e){}
                                                    if (!p._styledFields) p._styledFields = [];
                                                    p._styledFields.push({
                                                        name: rgName,
                                                        type: 'checkbox',  // render as checkbox not radio
                                                        optionName: optName,
                                                        checked: !!o.checked,
                                                        bg: (o.noBg || !o.backgroundColor || o.backgroundColor === 'rgba(0,0,0,0)') ? '#ffffff' : o.backgroundColor,
                                                        borderColor: o.borderColor || '#000000',
                                                        borderWidth: o.borderWidth !== undefined ? o.borderWidth : 1,
                                                        borderRadius: parseFloat(o.borderRadius) || 4,
                                                        checkColor: o.checkColor || '#000000',
                                                        groupName: cbGroupName,
                                                        groupRule: 'max1',
                                                        isRadioAsCheckbox: true
                                                    });
                                                } catch(e){ console.warn('⚠️ max1 checkbox failed:', e); }
                                            } else {
                                                const field = form.createCheckBox(fieldName);
                                                if (o.checked) field.check();
                                                field.addToPage(cp, {x:pdfX, y:pdfY, width:objW, height:objH, borderWidth:0});
                                                if (!p._styledFields) p._styledFields = [];
                                                p._styledFields.push({
                                                    name: fieldName,
                                                    type: 'checkbox',
                                                    checked: !!o.checked,
                                                    bg: (o.noBg || !o.backgroundColor || o.backgroundColor === 'rgba(0,0,0,0)') ? '#ffffff' : o.backgroundColor,
                                                    borderColor: o.borderColor || '#000000',
                                                    borderWidth: o.borderWidth !== undefined ? o.borderWidth : 1,
                                                    borderRadius: parseFloat(o.borderRadius) || 4,
                                                    checkColor: o.checkColor || '#000000',
                                                    groupName: cbGroupName,
                                                    groupRule: cbGroupRule
                                                });
                                            }

                                        } else if (isRadio) {
                                            try {
                                                const gn = o.groupName || ('radio_group_' + (o.id||'1'));
                                                let rg; try{rg=form.getRadioGroup(gn);}catch(e){rg=form.createRadioGroup(gn);}
                                                const on = o.fieldName || o.id;
                                                rg.addOptionToPage(on, cp, {x:pdfX, y:pdfY, width:objW, height:objH});
                                                if (o.selected || o.checked) try{rg.select(on);}catch(e){}
                                                // Tag for PyMuPDF post-processing
                                                if (!p._styledFields) p._styledFields = [];
                                                p._styledFields.push({
                                                    name: gn,
                                                    type: 'radio',
                                                    optionName: on,
                                                    selected: !!(o.selected || o.checked),
                                                    bg: (o.noBg || !o.backgroundColor || o.backgroundColor === 'rgba(0,0,0,0)') ? '#ffffff' : o.backgroundColor,
                                                    borderColor: o.borderColor || '#000000',
                                                    borderWidth: o.borderWidth !== undefined ? o.borderWidth : 1,
                                                    dotColor: o.dotColor || o.checkColor || '#000000',
                                                    groupName: gn
                                                });
                                            } catch(e){ console.warn('⚠️ Radio failed:', e); }

                                        } else if (isDropdown) {
                                            const field = form.createDropdown(fieldName);
                                            if (o.options && Array.isArray(o.options)) {
                                                const opts2 = o.options.map(opt => typeof opt==='string'?opt:(opt.exportValue||opt.displayValue||opt));
                                                if (opts2.length > 0) field.setOptions(opts2);
                                            }
                                            if (o.selectedValue||o.value) try{field.select(o.selectedValue||o.value);}catch(e){}
                                            // Capa 2: AcroField reducido por _inset
                                            const ddOpts = {x:pdfX+_inset, y:pdfY+_inset, width:objW-_inset*2, height:objH-_inset*2, borderWidth:0};
                                            // Bold/italic: _rfont ya considera o.bold/o.italic en _resolveFontKey.
                                            // Fallback: si la variante no está embedida, intentar fuente base o Helvetica
                                            const _ddFont = _rfont
                                                || (o.bold||o.italic ? getFont(_resolveFontKey('Helvetica')) : null)
                                                || getFont('Helvetica');
                                            if (_ddFont)  ddOpts.font      = _ddFont;
                                            if (_textCol) ddOpts.textColor = _textCol;
                                            ddOpts.backgroundColor = _bgCol;
                                            field.addToPage(cp, ddOpts);
                                            // autoSize para dropdown: calcular fontSize que cabe
                                            let _ddFs = Number(o.fontSize) || 12;
                                            if (o.autoSize && _ddFont && (o.selectedValue||o.value)) {
                                                const _sel = String(o.selectedValue||o.value||'');
                                                const _availW = objW - _inset*2 - 20; // margen flecha
                                                try {
                                                    const _tw = _ddFont.widthOfTextAtSize(_sel, _ddFs);
                                                    if (_tw > _availW) _ddFs = Math.max(6, _ddFs * (_availW / _tw));
                                                } catch(e) {}
                                             }
                                             field.setFontSize(_ddFs);
                                             if (o.autoSize) _autoSizeFieldNames.add(fieldName);
                                             if (_ddFont) try { field.updateAppearances(_ddFont); } catch(e){}
                                            // Capa 3: stroke redondeado encima
                                            _drawBorderOverlay();
                                            console.log('✅ Dropdown (OpC):', fieldName, '| bold:', !!o.bold, '| italic:', !!o.italic, '| font:', _ddFont?.name||'null');

                                        } else if (isSignature) {
                                            if (o.signMode === 'image' && o.signImageData) {
                                                // ── Image signature: embed as PNG in PDF ──
                                                try {
                                                    const b64 = o.signImageData.split(',')[1];
                                                    const imgBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                                                    const isPng = o.signImageData.startsWith('data:image/png');
                                                    const pdfImg = isPng
                                                        ? await out.embedPng(imgBytes)
                                                        : await out.embedJpg(imgBytes);
                                                    const opacity = (o.signOpacity || 100) / 100;
                                                    // Draw image at field position
                                                    cp.drawImage(pdfImg, {
                                                        x: pdfX, y: pdfY,
                                                        width: objW, height: objH,
                                                        opacity: opacity
                                                    });
                                                    console.log('✅ Signature image embedded:', fieldName);
                                                } catch(imgErr) {
                                                    console.warn('⚠️ Signature image failed:', imgErr);
                                                }
                                            } else {
                                                // ── Interactive signature field (AcroForm) ──
                                                const field = form.createTextField(fieldName);
                                                field.setText('');
                                                const sigOpts = {x:pdfX+_inset, y:pdfY+_inset, width:objW-_inset*2, height:objH-_inset*2, borderWidth:0};
                                                if (_rfont)   sigOpts.font = _rfont;
                                                sigOpts.backgroundColor = _bgCol;
                                                field.addToPage(cp, sigOpts);
                                                field.setFontSize(Number(o.fontSize)||8);
                                                if (_rfont) try { field.updateAppearances(_rfont); } catch(e){}
                                                _drawBorderOverlay();
                                                console.log('✅ Signature field (interactive):', fieldName);
                                            }
                                        }

                                    } else if (isCalendar) {
                                        console.log('📅 Calendar field - rendering...');
                                        // Calendar: Render as static visual since PDF doesn't have native calendar
                                        // Calendar: Render as static visual (V5 - Explicit RGB & Spacing)
                                        console.log('📅 Calendar field - rendering V6 (Safe Mode)');

                                        try {
                                            // SAFETY: Capture rgb constructor safely
                                            const { rgb } = PDFLib;

                                            const calState = o.calendarState || {};

                                            // HELPER: Explicit Hex to PDFLib.rgb conversion
                                            // This bypasses any potential issues with global helpers
                                            const hexToPdfColor = (hex) => {
                                                if (!hex || typeof hex !== 'string') return undefined; // Transparent
                                                const h = hex.trim().replace('#', '');
                                                if (h.length !== 6 && h.length !== 3) return undefined;

                                                let r = 0, g = 0, b = 0;
                                                if (h.length === 3) {
                                                    r = parseInt(h[0] + h[0], 16) / 255;
                                                    g = parseInt(h[1] + h[1], 16) / 255;
                                                    b = parseInt(h[2] + h[2], 16) / 255;
                                                } else {
                                                    r = parseInt(h.substring(0, 2), 16) / 255;
                                                    g = parseInt(h.substring(2, 4), 16) / 255;
                                                    b = parseInt(h.substring(4, 6), 16) / 255;
                                                }
                                                return rgb(r, g, b);
                                            };

                                            // 1. Resolve Colors
                                            // Default to White/Gray if missing (WYSIWYG)
                                            const bgCol = hexToPdfColor(calState.bgColor || '#ffffff');
                                            const headCol = hexToPdfColor(calState.headerColor || '#f0f0f0');
                                            const brColor = (o.borderWidth && o.borderColor) ? hexToPdfColor(o.borderColor) : undefined;
                                            const brWidth = o.borderWidth || 0;

                                            // 2. Geometry Setup
                                            // Increase header/weekday space to prevent overlap
                                            const headerHeight = Math.max(18, objH * 0.15);
                                            const weekdayLineH = 18; // Slightly taller strip for weekdays

                                            const headerLocY = pdfY + objH - headerHeight; // Bottom of header (Title)
                                            const daysTop = headerLocY - weekdayLineH;     // Top of days grid
                                            const daysHeight = daysTop - pdfY;             // Height available for days

                                            // 3. Draw Backgrounds - Support rounded corners
                                            const borderRadius = parseFloat(o.borderRadius) || 0;

                                            // Log for debugging
                                            console.log('📅 Calendar drawing:', { pdfX, pdfY, objW, objH, bgCol: calState.bgColor, headCol: calState.headerColor, borderRadius });

                                            // Helper function to draw rounded rectangle using PDF operators
                                            const drawRoundedRect = (page, x, y, width, height, radius, options) => {
                                                // Validate all values are numbers
                                                if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height) || isNaN(radius)) {
                                                    console.warn('📅 Invalid values for rounded rect, falling back to standard rect');
                                                    page.drawRectangle({ x, y, width, height, ...options });
                                                    return;
                                                }

                                                // Limit radius to half of smallest dimension
                                                const r = Math.min(radius, width / 2, height / 2);

                                                if (r <= 0) {
                                                    // No radius, use standard rectangle
                                                    page.drawRectangle({ x, y, width, height, ...options });
                                                    return;
                                                }

                                                // Build SVG path for rounded rectangle
                                                // PDF-lib SVG: origin at (x,y) with Y going UP in PDF
                                                // SVG path: draws from (0,0) with Y going DOWN
                                                // Solution: position at (x, y+height) and use positive Y in path
                                                const path = [
                                                    `M ${r} 0`,
                                                    `L ${width - r} 0`,
                                                    `Q ${width} 0 ${width} ${r}`,
                                                    `L ${width} ${height - r}`,
                                                    `Q ${width} ${height} ${width - r} ${height}`,
                                                    `L ${r} ${height}`,
                                                    `Q 0 ${height} 0 ${height - r}`,
                                                    `L 0 ${r}`,
                                                    `Q 0 0 ${r} 0`,
                                                    'Z'
                                                ].join(' ');

                                                try {
                                                    // CRITICAL FIX: pdf-lib drawSvgPath uses SVG coordinates where Y goes DOWN
                                                    // But PDF coordinates have Y going UP
                                                    // So we position at (x, y + height) and the SVG draws "down" into the correct area
                                                    page.drawSvgPath(path, {
                                                        x: x,
                                                        y: y + height,  // Position at TOP of rectangle, SVG draws downward
                                                        color: options.color,
                                                        borderColor: options.borderColor,
                                                        borderWidth: options.borderWidth || 0,
                                                        scale: 1
                                                    });
                                                    console.log('📅 Drew rounded rect at y:', y + height, 'height:', height);
                                                } catch (e) {
                                                    console.warn('📅 SVG path failed, using standard rect:', e.message);
                                                    page.drawRectangle({ x, y, width, height, ...options });
                                                }
                                            };

                                            // Body background (with rounded corners if radius > 0)
                                            if (bgCol) {
                                                if (borderRadius > 0) {
                                                    drawRoundedRect(cp, pdfX, pdfY, objW, objH, borderRadius, { color: bgCol });
                                                } else {
                                                    cp.drawRectangle({ x: pdfX, y: pdfY, width: objW, height: objH, color: bgCol });
                                                }
                                            }

                                            // DRAW ORDER: 1) Body fill, 2) Header fill, 3) Border on top
                                            if (bgCol) {
                                                if (borderRadius > 0) {
                                                    drawRoundedRect(cp, pdfX, pdfY, objW, objH, borderRadius, { color: bgCol });
                                                } else {
                                                    cp.drawRectangle({ x: pdfX, y: pdfY, width: objW, height: objH, color: bgCol });
                                                }
                                            }

                                            // 2. Header background (BEFORE border so border goes on top)
                                            if (headCol) {
                                                if (borderRadius > 0) {
                                                    // For header, only round top corners
                                                    const headerPath = [
                                                        `M ${borderRadius} 0`,
                                                        `L ${objW - borderRadius} 0`,
                                                        `Q ${objW} 0 ${objW} ${borderRadius}`,
                                                        `L ${objW} ${headerHeight}`,
                                                        `L 0 ${headerHeight}`,
                                                        `L 0 ${borderRadius}`,
                                                        `Q 0 0 ${borderRadius} 0`,
                                                        'Z'
                                                    ].join(' ');

                                                    try {
                                                        cp.drawSvgPath(headerPath, {
                                                            x: pdfX,
                                                            y: headerLocY + headerHeight,
                                                            color: headCol
                                                        });
                                                    } catch (e) {
                                                        console.warn('📅 Header SVG failed:', e.message);
                                                        cp.drawRectangle({ x: pdfX, y: headerLocY, width: objW, height: headerHeight, color: headCol });
                                                    }
                                                } else {
                                                    cp.drawRectangle({ x: pdfX, y: headerLocY, width: objW, height: headerHeight, color: headCol });
                                                }
                                            }

                                            // 3. Border LAST (on top of everything)
                                            if (brColor && brWidth > 0) {
                                                if (borderRadius > 0) {
                                                    drawRoundedRect(cp, pdfX, pdfY, objW, objH, borderRadius, { borderColor: brColor, borderWidth: brWidth });
                                                } else {
                                                    cp.drawRectangle({ x: pdfX, y: pdfY, width: objW, height: objH, borderColor: brColor, borderWidth: brWidth });
                                                }
                                            }

                                            // Skip the old else block since we're always using rectangles now
                                            if (false) {
                                                // Standard rectangles (no border radius)
                                                // Body
                                                if (bgCol) {
                                                    cp.drawRectangle({
                                                        x: pdfX, y: pdfY, width: objW, height: objH,
                                                        color: bgCol,
                                                        borderColor: brColor,
                                                        borderWidth: brWidth
                                                    });
                                                }

                                                // Header
                                                if (headCol) {
                                                    cp.drawRectangle({
                                                        x: pdfX, y: headerLocY, width: objW, height: headerHeight,
                                                        color: headCol
                                                    });
                                                }
                                            }

                                            // 4. Font Logic
                                            const resolveFont = (base, bold, italic) => {
                                                let k = base || 'Helvetica';
                                                if (k === 'Arial') k = 'Helvetica';
                                                if (k === 'Times New Roman') k = 'Times-Roman';
                                                if (k === 'Courier New') k = 'Courier';
                                                if (bold && italic) {
                                                    if (k === 'Helvetica') return 'Helvetica-BoldOblique';
                                                    if (k === 'Times-Roman') return 'Times-BoldItalic';
                                                    if (k === 'Courier') return 'Courier-BoldOblique';
                                                } else if (bold) {
                                                    if (k === 'Helvetica') return 'Helvetica-Bold';
                                                    if (k === 'Times-Roman') return 'Times-Bold';
                                                    if (k === 'Courier') return 'Courier-Bold';
                                                } else if (italic) {
                                                    if (k === 'Helvetica') return 'Helvetica-Oblique';
                                                    if (k === 'Times-Roman') return 'Times-Italic';
                                                    if (k === 'Courier') return 'Courier-Oblique';
                                                }
                                                return k;
                                            };

                                            const hKey = resolveFont(calState.font, calState.headerBold, calState.headerItalic);
                                            const wKey = resolveFont(calState.font, calState.weekdayBold !== undefined ? calState.weekdayBold : true, calState.weekdayItalic);
                                            const dKey = resolveFont(calState.font, calState.dayBold, calState.dayItalic);

                                            const getEmb = (k) => embeddedFonts[k] || embeddedFonts['Helvetica'];
                                            const hFont = getEmb(hKey);
                                            const wFont = getEmb(wKey);
                                            const dFont = getEmb(dKey);

                                            // 5. Header Text
                                            const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
                                            const monthNum = calState.month !== undefined ? calState.month : new Date().getMonth();
                                            const currYear = calState.year || new Date().getFullYear();
                                            const headerFormat = calState.format || 'MMMM YYYY';

                                            let headerText = '';
                                            if (headerFormat === 'MM/YYYY') headerText = `${String(monthNum + 1).padStart(2, '0')}/${currYear}`;
                                            else if (headerFormat === 'MM/YY') headerText = `${String(monthNum + 1).padStart(2, '0')}/${String(currYear).slice(-2)}`;
                                            else if (headerFormat === 'MMMM YYYY') headerText = `${monthNames[monthNum]} ${currYear}`;
                                            else if (headerFormat === 'MMMM YY') headerText = `${monthNames[monthNum]} ${String(currYear).slice(-2)}`;

                                            const headerFontSize = calState.headerFontSize || Math.min(12, headerHeight * 0.6);
                                            const headerTc = hexToPdfColor(calState.headerTextColor || '#000000');

                                            const hTxtW = hFont.widthOfTextAtSize(headerText, headerFontSize);
                                            let hX = pdfX + 5;
                                            const align = calState.align || 'center';
                                            if (align === 'center') hX = pdfX + objW / 2 - hTxtW / 2;
                                            else if (align === 'right') hX = pdfX + objW - hTxtW - 5;

                                            cp.drawText(headerText, {
                                                x: hX,
                                                y: headerLocY + (headerHeight - headerFontSize) / 2 + headerFontSize / 4,
                                                size: headerFontSize, font: hFont, color: headerTc
                                            });

                                            // 6. Weekday Headers
                                            const cellW = objW / 7;
                                            const wkArr = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
                                            const wkFS = calState.weekdayFontSize || Math.min(10, cellW * 0.4);
                                            const wkTc = hexToPdfColor(calState.weekdayTextColor || '#333333');

                                            wkArr.forEach((wd, i) => {
                                                const wTxtW = wFont.widthOfTextAtSize(wd, wkFS);
                                                const wx = pdfX + i * cellW + cellW / 2 - wTxtW / 2;
                                                const wy = headerLocY - weekdayLineH / 2 - wkFS / 3;
                                                cp.drawText(wd, { x: wx, y: wy, size: wkFS, font: wFont, color: wkTc });
                                            });

                                            // 7. Days Grid
                                            const daysInMonth = new Date(currYear, monthNum + 1, 0).getDate();
                                            const firstDay = new Date(currYear, monthNum, 1).getDay(); // 0=Sun
                                            const offset = firstDay === 0 ? 6 : firstDay - 1; // Mon=0
                                            const rows = Math.ceil((daysInMonth + offset) / 7);

                                            const fitCellH = daysHeight / rows;
                                            // Safety check: ensure rows fit. If objH is too small, cells fit tightly

                                            const dayFS = calState.dayFontSize || Math.min(10, Math.min(cellW, fitCellH) * 0.5);
                                            const dTc = hexToPdfColor(calState.dayTextColor || '#000000');
                                            const selColor = hexToPdfColor(calState.selectColor || '#ff0000');
                                            const selDays = calState.selectedDays || [];

                                            for (let i = 1; i <= daysInMonth; i++) {
                                                const slot = i + offset - 1;
                                                const r = Math.floor(slot / 7);
                                                const c = slot % 7;

                                                const dx = pdfX + c * cellW;
                                                // Top-down calculation from daysTop
                                                const cellTopY = daysTop - r * fitCellH;
                                                const cellBottomY = cellTopY - fitCellH;
                                                const cellCenterY = cellBottomY + fitCellH / 2;

                                                // Selection
                                                if (selDays.includes(i)) {
                                                    const cx = dx + cellW / 2;
                                                    const cy = cellCenterY + 1;
                                                    const rad = Math.min(cellW, fitCellH) / 2 - 2;
                                                    if (calState.style === 'fill') cp.drawCircle({ x: cx, y: cy, size: rad, color: selColor });
                                                    else cp.drawCircle({ x: cx, y: cy, size: rad, borderColor: selColor, borderWidth: 1 });
                                                }

                                                const dayStr = String(i);
                                                const dTxtW = dFont.widthOfTextAtSize(dayStr, dayFS);
                                                const finalTC = (selDays.includes(i) && calState.style === 'fill') ? hexToPdfColor('#ffffff') : dTc;

                                                cp.drawText(dayStr, {
                                                    x: dx + cellW / 2 - dTxtW / 2,
                                                    y: cellCenterY - dayFS / 3,
                                                    size: dayFS, font: dFont, color: finalTC
                                                });
                                            }

                                        } catch (e) {
                                            console.error('❌ Calendar rendering failed:', e);
                                            // Fallback to error box
                                            cp.drawRectangle({
                                                x: pdfX, y: pdfY, width: objW, height: objH,
                                                borderColor: PDFLib.rgb(1, 0, 0), borderWidth: 2
                                            });
                                            cp.drawText('CALENDAR ERROR', {
                                                x: pdfX + 5, y: pdfY + objH / 2,
                                                size: 10, color: PDFLib.rgb(1, 0, 0)
                                            });
                                        }
                                    }

                                    // Only skip static drawing for successfully created interactive fields
                                    if (isTextField || isCheckbox || isDropdown || isSignature || isRadio) {
                                        continue;
                                    }

                                } catch (e) {
                                    console.warn('⚠️ Failed to create new form field:', e);
                                    // Fall through to static drawing (or skip if preferred)
                                }
                            }
                            // FIN DEL BLOQUE DE FORM FIELDS - El loop de objetos (for o of p.objects) SIGUE AQUÍ




                            // Rotación de objeto: PDF-Lib rota alrededor del punto de anclaje (x,y) bottom-left del objeto.
                            // En canvas rotamos desde el centro. Hay que compensar.
                            const rot = -(o.rotation || 0); // Invertir rotación para PDF-Lib
                            const centerRotate = PDFLib.degrees(rot);

                            // Calculamos centro para rotación
                            const cx = pdfX + objW / 2;
                            const cy = pdfY + objH / 2;

                            if (o.type === 'text') {
                                // Get font with bold/italic variants
                                let fontKey = o.font || 'Helvetica';

                                // Resolución de variante Bold/Italic
                                if (o.bold || o.italic) {
                                    const boldSuffix = o.bold && o.italic ? '-BoldItalic' : o.bold ? '-Bold' : '-Italic';
                                    // Paso 1: variante directa ya embedida (ej: "Calibri-Bold")
                                    const directKey = fontKey.replace(/-(Bold|Italic|BoldItalic)$/i, '') + boldSuffix;
                                    if (embeddedFonts[directKey]) {
                                        fontKey = directKey;

                                    } else if (!embeddedFonts[fontKey]) {
                                        // Paso 2: fuente no embedida → mapear a estándar con variante
                                        let base = fontKey.toLowerCase().includes('times') ? 'Times-Roman'
                                            : fontKey.toLowerCase().includes('courier') ? 'Courier'
                                                : 'Helvetica';
                                        if (base === 'Helvetica') fontKey = o.bold && o.italic ? 'Helvetica-BoldOblique' : o.bold ? 'Helvetica-Bold' : 'Helvetica-Oblique';
                                        else if (base === 'Times-Roman') fontKey = o.bold && o.italic ? 'Times-BoldItalic' : o.bold ? 'Times-Bold' : 'Times-Italic';
                                        else fontKey = o.bold && o.italic ? 'Courier-BoldOblique' : o.bold ? 'Courier-Bold' : 'Courier-Oblique';

                                    }
                                    // Si la base SÍ está embedida pero sin variante → usar la base (mejor que degradar)
                                } else if (embeddedFonts[fontKey]) {

                                }

                                const curFont = getFont(fontKey);

                                // Color removed here to avoid duplication below
                                // ... existing logic ...
                                // Ajuste visual para texto (baseline)
                                const fontSize = Number(o.size || o.fontSize || 12);
                                const textWidth = curFont.widthOfTextAtSize(o.text || '', fontSize);

                                // Calculate positions based on alignment
                                let textX;
                                // Respetar alignment del objeto (incluye smart patches)
                                if (!o.alignment || o.alignment === 'left' || o.alignment === 'justify') {
                                    textX = pdfX;
                                } else if (o.alignment === 'right') {
                                    textX = pdfX + objW - textWidth;
                                } else if (o.alignment === 'center') {
                                    // Solo centrar si hay alignment explícito 'center'
                                    textX = pdfX + (objW - textWidth) / 2;
                                } else {
                                    // Sin alignment definido: left align (evita desplazamiento negativo)
                                    textX = pdfX;
                                }

                                // ✅ AJUSTE DE ESPACIADO PARA SMART PATCH (Evitar Solapamiento)
                                let charSpacing = 0;
                                let finalSmartFontSize = fontSize;
                                if (o.isSmartPatch && o.text && o.text.length > 1) {
                                    // ── AJUSTE BIDIRECCIONAL: forzar que el texto ocupe EXACTAMENTE el ancho original ──
                                    const spacingDelta = objW - textWidth;
                                    charSpacing = spacingDelta / (o.text.length - 1);
                                    // Si el charSpacing necesario supera el rango razonable,
                                    // escalar el fontSize para que el texto quepa en objW
                                    if (charSpacing < -2 || charSpacing > 3) {
                                        const scaled = fontSize * (objW / textWidth);
                                        if (scaled > 1) {
                                            finalSmartFontSize = scaled;
                                            const newW = curFont.widthOfTextAtSize(o.text || '', scaled);
                                            charSpacing = (objW - newW) / (o.text.length - 1);
                                            charSpacing = Math.min(Math.max(charSpacing, -0.5), 0.5);
                                        } else {
                                            charSpacing = Math.min(Math.max(charSpacing, -2), 3);
                                        }
                                    }
                                } else if (o.letterSpacing) {
                                    // Si no es smart patch o no necesita condensación, usar el espaciado manual
                                    charSpacing = (o.letterSpacing / 100) * fontSize;
                                }
                                // NO horizontal shift needed - was causing offset
                                // textX = textX + 29.7;

                                // CORRECTED Baseline positioning:
                                // Para Smart Patches, usamos la posición EXACTA (baseline original) compensando el ascent
                                // Para texto normal, aplicamos el centrado vertical heurístico.
                                let textY;
                                if (o.isSmartPatch) {
                                    // Usar jsY (calculado por JS con baseline real) si está disponible.
                                    // o.y es del bbox de Python que puede diferir ~5px del baseline real.
                                    // jsY = viewport.height - (textBaseline + ascentPx) → ya incorpora ascentPx.
                                    // En PDF: textBaseline = pageHeight - jsY - ascentPx
                                    const baseY = o.jsY !== null && o.jsY !== undefined ? o.jsY : o.y;
                                    const ascent = o.ascentPx || (o.height * 0.77);
                                    textY = pageHeight - (baseY + ascent);
                                } else {
                                    textY = pdfY + (objH / 2) - (fontSize / 3);
                                }

                                // Use safe color from object
                                const txtColor = getSafeColor(o.color);

                                // Fondo de texto y Borde
                                // Smart Patch SIEMPRE dibuja rectángulo de fondo (opacity=1) para tapar
                                // el texto original del PDF, SALVO que sea un parche quirúrgico (fondo transparente).
                                const isTransparent = o.bgColor === 'transparent' || o.bgAlpha === 0;
                                const _drawBg = o.isSmartPatch
                                    ? (!isTransparent && !!o.bgColor)
                                    : (!isTransparent && ((o.bgColor && o.bgAlpha > 0) || (o.borderColor && o.borderWidth > 0)));

                                if (_drawBg) {
                                    const rad = Number(o.borderRadius || 0);
                                    const bgOps = {
                                        x: cx - objW / 2, y: cy - objH / 2,
                                        width: objW, height: objH,
                                        rotate: centerRotate,
                                        xSkew: PDFLib.degrees(0), ySkew: PDFLib.degrees(0)
                                    };
                                    if (o.bgColor) {
                                        bgOps.color = getSafeColor(o.bgColor);
                                        bgOps.opacity = o.isSmartPatch ? 1 : parseFloat(o.bgAlpha || 1);
                                    }
                                    if (o.borderColor && o.borderWidth > 0) {
                                        bgOps.borderColor = getSafeColor(o.borderColor);
                                        bgOps.borderWidth = Number(o.borderWidth);
                                    }
                                    if (rad > 0) {
                                        const r = Math.min(rad, objW / 2, objH / 2);
                                        const path = [`M ${r} 0`, `L ${objW - r} 0`, `Q ${objW} 0 ${objW} ${r}`, `L ${objW} ${objH - r}`, `Q ${objW} ${objH} ${objW - r} ${objH}`, `L ${r} ${objH}`, `Q 0 ${objH} 0 ${objH - r}`, `L 0 ${r}`, `Q 0 0 ${r} 0`, 'Z'].join(' ');
                                        const drawOps = { x: pdfX, y: pdfY + objH, scale: 1, opacity: bgOps.opacity || 1 };
                                        try {
                                            if (bgOps.color) cp.drawSvgPath(path, { ...drawOps, color: bgOps.color, borderWidth: 0 });
                                            if (bgOps.borderColor) cp.drawSvgPath(path, { ...drawOps, borderColor: bgOps.borderColor, borderWidth: Number(bgOps.borderWidth), color: undefined, opacity: 1 });
                                        } catch (e) { cp.drawRectangle(bgOps); }
                                    } else { cp.drawRectangle(bgOps); }
                                }

                                const opacityValue = o.opacity !== undefined && o.opacity <= 1 ? Number(o.opacity) : (Number(o.opacity || 100) / 100);

                                if (o.twoColumns && !o.isSmartPatch) {
                                    // Split text into two columns
                                    const fullText = String(o.text || '');
                                    const mid = Math.floor(fullText.length / 2);
                                    let splitIdx = fullText.indexOf(' ', mid);
                                    if (splitIdx === -1) splitIdx = mid;
                                    const col1 = fullText.substring(0, splitIdx).trim();
                                    const col2 = fullText.substring(splitIdx).trim();

                                    const colW = (objW / 2) - 5;
                                    // Col 1
                                    cp.drawText(col1, {
                                        x: pdfX, y: textY, size: fontSize, font: curFont,
                                        color: txtColor, opacity: opacityValue, rotate: centerRotate, rotatePivot: { x: cx, y: cy }
                                    });
                                    // Col 2
                                    cp.drawText(col2, {
                                        x: pdfX + (objW / 2) + 5, y: textY, size: fontSize, font: curFont,
                                        color: txtColor, opacity: opacityValue, rotate: centerRotate, rotatePivot: { x: cx, y: cy }
                                    });
                                } else {
                                    // Standard text
                                    let finalFontSize = o.isSmartPatch ? finalSmartFontSize : fontSize;
                                    if (o.isSmartPatch) {
                                        console.log(`🩹 SMARTPATCH DRAW: "${o.text}" fontSize=${fontSize.toFixed(2)} finalSize=${finalFontSize.toFixed(2)} charSpacing=${charSpacing.toFixed(3)} textX=${textX.toFixed(2)} textY=${textY.toFixed(2)} o.y=${o.y.toFixed(2)} ascentPx=${(o.ascentPx||0).toFixed(2)} pageH=${pageHeight}`);
                                    }
                                    if (o.autoSize && !o.isSmartPatch) {
                                        const tw = curFont.widthOfTextAtSize(String(o.text || ''), fontSize);
                                        if (tw > objW) finalFontSize = fontSize * (objW / tw);
                                    }

                                    // Para texto normal, la app aplica scaleX via CSS transform cuando el texto
                                    // no cabe en o.width. En PDF replicamos esto escalando el fontSize.
                                    if (!o.isSmartPatch && o.text && o.text.length > 1 && !o.autoSize) {
                                        const tw = curFont.widthOfTextAtSize(String(o.text || ''), finalFontSize);
                                        if (tw > 0 && tw > objW) {
                                            // App clampea scaleX a mínimo 0.7
                                            const rawScaleX = objW / tw;
                                            const clampedScaleX = Math.max(rawScaleX, 0.7);
                                            finalFontSize = finalFontSize * clampedScaleX;
                                        }
                                    }

                                    if (!o.isSmartPatch) {
                                        console.log(`📝 TEXT DRAW: "${o.text}" o.x=${o.x.toFixed(1)} o.y=${o.y.toFixed(1)} o.w=${objW.toFixed(1)} o.h=${objH.toFixed(1)} → pdfX=${pdfX.toFixed(1)} pdfY=${pdfY.toFixed(1)} textX=${textX.toFixed(1)} textY=${textY.toFixed(1)} size=${finalFontSize.toFixed(1)} charSpacing=${charSpacing.toFixed(2)}`);
                                    }
                                    cp.drawText(String(o.text || '').replace(/\r?\n/g, ' '), {
                                        x: textX, y: textY, size: finalFontSize, font: curFont,
                                        color: txtColor, opacity: opacityValue, rotate: centerRotate, rotatePivot: { x: cx, y: cy },
                                        characterSpacing: charSpacing
                                    });
                                }
                            }
                            else if (o.type === 'link') {
                                const fontSize = Number(o.size || 10);
                                const fontName = o.font || 'Helvetica';
                                const font = getFont(fontName);
                                const txtColor = getSafeColor(o.color || '#0066cc');
                                const textWidth = font.widthOfTextAtSize(String(o.text || ''), fontSize);
                                const textX = pdfX + (objW - textWidth) / 2;
                                const textY = pdfY + (objH / 2) - (fontSize / 3);
                                const opacityValue = o.opacity !== undefined && o.opacity <= 1 ? Number(o.opacity) : (Number(o.opacity || 100) / 100);

                                cp.drawText(String(o.text || '').replace(/\r?\n/g, ' '), {
                                    x: textX,
                                    y: textY,
                                    size: fontSize,
                                    font: font,
                                    color: txtColor,
                                    opacity: opacityValue,
                                    rotate: centerRotate,
                                    rotatePivot: { x: cx, y: cy }
                                });

                                // Draw underline
                                cp.drawLine({
                                    start: { x: textX, y: textY - 2 },
                                    end: { x: textX + textWidth, y: textY - 2 },
                                    thickness: 1,
                                    color: txtColor,
                                    opacity: 1
                                });

                                // ✅ NUEVO: Crear anotación según tipo de vínculo
                                if (o.linkType === 'internal' && o.internalPage) {
                                    // Vínculo interno - usar GoTo action
                                    const targetPageIndex = o.internalPage - 1;
                                    if (targetPageIndex >= 0 && targetPageIndex < out.getPages().length) {
                                        const targetPdfPage = out.getPages()[targetPageIndex];

                                        // Crear destino (Destination)
                                        const destArray = out.context.obj([
                                            targetPdfPage.ref,
                                            PDFLib.PDFName.of('XYZ'),
                                            null, // x position (null = no change)
                                            null, // y position (null = no change)
                                            null  // zoom (null = no change)
                                        ]);

                                        // Crear anotación de link interno
                                        const linkAnnotation = out.context.obj({});
                                        linkAnnotation.set(PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Annot'));
                                        linkAnnotation.set(PDFLib.PDFName.of('Subtype'), PDFLib.PDFName.of('Link'));
                                        linkAnnotation.set(PDFLib.PDFName.of('Rect'), out.context.obj([pdfX, pdfY, pdfX + objW, pdfY + objH]));
                                        linkAnnotation.set(PDFLib.PDFName.of('Border'), out.context.obj([0, 0, 0]));
                                        linkAnnotation.set(PDFLib.PDFName.of('Dest'), destArray);

                                        // Add annotation to page
                                        const annotRef = out.context.register(linkAnnotation);
                                        const annots = cp.node.get(PDFLib.PDFName.of('Annots'));
                                        if (annots) {
                                            annots.push(annotRef);
                                        } else {
                                            cp.node.set(PDFLib.PDFName.of('Annots'), out.context.obj([annotRef]));
                                        }
                                    }
                                } else {
                                    // Vínculo externo - usar URI action
                                    const actionDict = out.context.obj({});
                                    actionDict.set(PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Action'));
                                    actionDict.set(PDFLib.PDFName.of('S'), PDFLib.PDFName.of('URI'));
                                    actionDict.set(PDFLib.PDFName.of('URI'), PDFLib.PDFString.of(o.url));

                                    const linkAnnotation = out.context.obj({});
                                    linkAnnotation.set(PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Annot'));
                                    linkAnnotation.set(PDFLib.PDFName.of('Subtype'), PDFLib.PDFName.of('Link'));
                                    linkAnnotation.set(PDFLib.PDFName.of('Rect'), out.context.obj([pdfX, pdfY, pdfX + objW, pdfY + objH]));
                                    linkAnnotation.set(PDFLib.PDFName.of('Border'), out.context.obj([0, 0, 0]));
                                    linkAnnotation.set(PDFLib.PDFName.of('A'), actionDict);

                                    // Add annotation to page
                                    const annotRef = out.context.register(linkAnnotation);
                                    const annots = cp.node.get(PDFLib.PDFName.of('Annots'));
                                    if (annots) {
                                        annots.push(annotRef);
                                    } else {
                                        cp.node.set(PDFLib.PDFName.of('Annots'), out.context.obj([annotRef]));
                                    }
                                }
                            }
                            else if (o.type === 'image' || o.type === 'drawing') {
                                try {
                                    let imgEmbed;

                                    // Rasterizar SVG (Sellos) a PNG
                                    if (o.type === 'image' && o.src && o.src.startsWith('data:image/svg')) {
                                        // Crear elemento imagen temporal
                                        const tempImg = new Image();
                                        tempImg.src = o.src;
                                        await new Promise(r => tempImg.onload = r);

                                        // Dibujar en canvas para rasterizar a PNG con tamaño apropiado
                                        const cvs = document.createElement('canvas');
                                        // Usar dimensiones del objeto para mejor calidad
                                        cvs.width = objW * 2; // 2x for higher quality
                                        cvs.height = objH * 2;
                                        const xctx = cvs.getContext('2d');
                                        xctx.drawImage(tempImg, 0, 0, cvs.width, cvs.height);

                                        const buffer = await new Promise(resolve => {
                                            cvs.toBlob(async blob => {
                                                resolve(await blob.arrayBuffer());
                                            }, 'image/png');
                                        });
                                        imgEmbed = await out.embedPng(new Uint8Array(buffer));
                                        // Free temporary canvas memory
                                        cvs.width = 0; cvs.height = 0;
                                    }
                                    // Handle PNG/JPG/Other images with optional compression
                                    else if (o.src) {
                                        if (compress) {

                                            try {
                                                // Converts to JPEG 0.75 (25% reduction)
                                                // Note: Transparency will be lost (becomes white background)
                                                const compressedData = await this.compressImageData(o.src, 0.75);
                                                imgEmbed = await out.embedJpg(compressedData);
                                            } catch (compErr) {
                                                console.warn('Compression failed, falling back to original', compErr);
                                                // Fallback to original
                                                if (o.src.includes('image/png') || o.src.startsWith('data:image/png')) imgEmbed = await out.embedPng(o.src);
                                                else imgEmbed = await out.embedJpg(o.src);
                                            }
                                        } else {
                                            // Original quality
                                            if (o.src.includes('image/png') || o.src.startsWith('data:image/png')) imgEmbed = await out.embedPng(o.src);
                                            else imgEmbed = await out.embedJpg(o.src);
                                        }
                                    }
                                    else if (o.type === 'drawing' && o.path && o.path.length > 1) {

                                        try {
                                            if (o.isEraser) continue;

                                            if (o.isHighlighter) {
                                                // Rectángulo semitransparente con blend mode Multiply
                                                // Funciona en TODOS los visores (Acrobat, Chrome, Edge, Firefox, PDF-XChange)
                                                const hColor = getSafeColor(o.color);
                                                const hW = Number(o.width || 10);
                                                const xs = o.path.map(p => p.x);
                                                const x1 = Math.min(...xs);
                                                const x2 = Math.max(...xs);
                                                const yMid = o.path[0].y;
                                                const y1pdf = pageHeight - (yMid + hW / 2);
                                                const rectH = hW;
                                                cp.drawRectangle({
                                                    x: x1,
                                                    y: y1pdf,
                                                    width: Math.max(x2 - x1, 1),
                                                    height: rectH,
                                                    color: hColor,
                                                    opacity: 0.4,
                                                    borderWidth: 0,
                                                });
                                            } else {
                                                // Trazo normal (lápiz, pluma, etc.)
                                                let svgPathOps = `M ${o.path[0].x} ${o.path[0].y}`;
                                                for (let k = 1; k < o.path.length; k++) {
                                                    svgPathOps += ` L ${o.path[k].x} ${o.path[k].y}`;
                                                }
                                                cp.drawSvgPath(svgPathOps, {
                                                    x: 0,
                                                    y: pageHeight,
                                                    borderColor: getSafeColor(o.color),
                                                    borderWidth: Number(o.width || 2),
                                                    opacity: o.opacity !== undefined ? Number(o.opacity) : 1,
                                                    lineCap: PDFLib.LineCapStyle.Round,
                                                    lineJoin: PDFLib.LineJoinStyle.Round
                                                });
                                            }
                                        } catch (drawErr) {
                                            console.error('Error rendering drawing path:', drawErr);
                                        }
                                        continue;
                                    }
                                    else {

                                        continue;
                                    }

                                    // Para imágenes con rotación, necesitamos ajustar la posición
                                    // porque PDF-lib rota desde (x,y) pero el editor rota desde el centro
                                    const rotation = o.rotation || 0;
                                    let drawX = pdfX;
                                    let drawY = pdfY;

                                    if (rotation !== 0) {
                                        // Calculate center of the image
                                        const centerX = pdfX + objW / 2;
                                        const centerY = pdfY + objH / 2;

                                        // Convert rotation to radians (negative because PDF-lib inverts)
                                        const radians = -rotation * Math.PI / 180;

                                        // When rotating around corner (x,y), we need to adjust
                                        // to make it look like it's rotating around center
                                        // Offset = center position after rotation - original center position
                                        const cos = Math.cos(radians);
                                        const sin = Math.sin(radians);

                                        // The corner (pdfX, pdfY) after rotating around center
                                        const dx = pdfX - centerX;
                                        const dy = pdfY - centerY;
                                        const rotatedCornerX = centerX + (dx * cos - dy * sin);
                                        const rotatedCornerY = centerY + (dx * sin + dy * cos);

                                        // Adjust draw position so rotation appears centered
                                        drawX = rotatedCornerX;
                                        drawY = rotatedCornerY;
                                    }

                                    cp.drawImage(imgEmbed, {
                                        x: drawX,
                                        y: drawY,
                                        width: objW,
                                        height: objH,
                                        rotate: PDFLib.degrees(-rotation),
                                        opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100
                                    });
                                } catch (err) {
                                    console.warn('[SavePDF] image/stamp omitted', {
                                        type: o.type, id: o.id || null, sourceId: o.sourceId || null,
                                        hasImageSource: !!(o.data || o.imageData || o.src || o.dataUrl), error: err.message
                                    });
                                }
                            }
                            else if (o.type === 'table') {
                                try {
                                    const tblForm       = out.getForm();
                                    const borderWidth   = (o.borderWidth !== undefined ? Number(o.borderWidth) : 1);
                                    const hasBorder     = borderWidth > 0;
                                    const borderColor   = hasBorder ? getSafeColor(o.borderColor || '#000000') : undefined;
                                    const fontSize      = Number(o.fontSize) || 10;
                                    const fontFamily    = (o.fontFamily || 'Helvetica').replace('Arial','Helvetica').replace('Times New Roman','Times-Roman').replace('Courier New','Courier');
                                    const globalTextCol = getSafeColor(o.textColor || '#000000');
                                    const isTransparent = (!o.backgroundColor || o.backgroundColor === 'transparent');
                                    const globalBgCol   = isTransparent ? undefined : getSafeColor(o.backgroundColor);
                                    const tableOpacity  = o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100;

                                    // FIX: Normalize colWidths/rowHeights to match obj.width/height
                                    // If Interact.js resized the container without updating the arrays,
                                    // rescale them now so they sum to objW/objH exactly.
                                    const sumCW = o.colWidths.reduce((a, b) => a + b, 0);
                                    const sumRH = o.rowHeights.reduce((a, b) => a + b, 0);
                                    const colWidths  = sumCW > 0 ? o.colWidths.map(w => w * (objW / sumCW))  : o.colWidths;
                                    const rowHeights = sumRH > 0 ? o.rowHeights.map(h => h * (objH / sumRH)) : o.rowHeights;

                                    let currentY = pdfY + objH; // PDF-lib: Y grows upward

                                    for (let r = 0; r < o.rows; r++) {
                                        const rHeight = rowHeights[r];
                                        let currentX = pdfX;
                                        const rowY   = currentY - rHeight;

                                        for (let c = 0; c < o.cols; c++) {
                                            const cWidth   = colWidths[c];
                                            const cellText = String(o.data[r][c] || '');
                                            const cs       = (o.cellStyles && o.cellStyles[r] && o.cellStyles[r][c]) || {};

                                            // ── 1. Cell background rectangle ──
                                            const cellBgCol = cs.bgColor ? getSafeColor(cs.bgColor) : globalBgCol;

                                            const rectOpts = {
                                                x:           currentX,
                                                y:           rowY,
                                                width:       cWidth,
                                                height:      rHeight,
                                                opacity:     tableOpacity,
                                                borderWidth: 0  // always explicit — PDF-lib default is 1
                                            };
                                            if (cellBgCol) rectOpts.color = cellBgCol;
                                            if (hasBorder) {
                                                rectOpts.borderColor = borderColor;
                                                rectOpts.borderWidth = borderWidth;
                                            }
                                            cp.drawRectangle(rectOpts);

                                            // ── 2. AcroForm TextField — editable cell ──
                                            const fieldName = (o.id || ('tbl_' + Date.now())) + '_r' + r + '_c' + c;
                                            try {
                                                let cfName = (cs.fontFamily || o.fontFamily || 'Helvetica')
                                                    .replace('Arial','Helvetica')
                                                    .replace('Times New Roman','Times-Roman')
                                                    .replace('Courier New','Courier');
                                                if (cs.bold && cs.italic) {
                                                    if (cfName==='Helvetica')        cfName='Helvetica-BoldOblique';
                                                    else if (cfName==='Times-Roman') cfName='Times-BoldItalic';
                                                    else if (cfName==='Courier')     cfName='Courier-BoldOblique';
                                                } else if (cs.bold) {
                                                    if (cfName==='Helvetica')        cfName='Helvetica-Bold';
                                                    else if (cfName==='Times-Roman') cfName='Times-Bold';
                                                    else if (cfName==='Courier')     cfName='Courier-Bold';
                                                } else if (cs.italic) {
                                                    if (cfName==='Helvetica')        cfName='Helvetica-Oblique';
                                                    else if (cfName==='Times-Roman') cfName='Times-Italic';
                                                    else if (cfName==='Courier')     cfName='Courier-Oblique';
                                                }
                                                const cFont    = getFont(cfName);
                                                const cFontSz  = Number(cs.fontSize || fontSize);
                                                const cTextCol = cs.textColor ? getSafeColor(cs.textColor) : globalTextCol;

                                                const tf = tblForm.createTextField(fieldName);
                                                if (cellText) tf.setText(cellText);
                                                tf.enableMultiline();

                                                const _inset = hasBorder ? 1 : 0;
                                                const tfOpts = {
                                                    x:               currentX + _inset,
                                                    y:               rowY + _inset,
                                                    width:           Math.max(cWidth  - _inset * 2, 4),
                                                    height:          Math.max(rHeight - _inset * 2, 4),
                                                    borderWidth:     0,                      // border drawn above via drawRectangle
                                                    backgroundColor: PDFLib.rgb(1, 1, 1)  // always white — prevents viewer default dark background
                                                };
                                                if (cFont)    tfOpts.font      = cFont;
                                                if (cTextCol) tfOpts.textColor = cTextCol;
                                                tf.addToPage(cp, tfOpts);
                                                tf.setFontSize(cFontSz);

                                                const alignH = cs.alignH || o.textAlign || 'left';
                                                if      (alignH === 'center') tf.setAlignment(PDFLib.TextAlignment.Center);
                                                else if (alignH === 'right')  tf.setAlignment(PDFLib.TextAlignment.Right);
                                                else                          tf.setAlignment(PDFLib.TextAlignment.Left);

                                                // Always regenerate appearance — text visible before first click
                                                const _appFont = cFont || getFont('Helvetica');
                                                if (_appFont) try { tf.updateAppearances(_appFont); } catch(e) {}

                                            } catch (cellErr) {
                                                console.warn('Table cell field error r'+r+'c'+c+':', cellErr);
                                            }

                                            currentX += cWidth;
                                        }
                                        currentY -= rHeight;
                                    }
                                } catch (e) {
                                    console.error('Error drawing table:', e);
                                }
                            }

                            else if (o.type === 'shape') {
                                try {
                                    const ops = {
                                        color: o.noFill ? undefined : getSafeColor(o.fill),
                                        borderColor: o.noBorder ? undefined : getSafeColor(o.stroke),
                                        borderWidth: Number(o.strokeWidth || 0),
                                        opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100,
                                        rotate: centerRotate,
                                        rotatePivot: { x: cx, y: cy }
                                    };

                                    if (o.shapeType === 'rect') {
                                        cp.drawRectangle({ x: pdfX, y: pdfY, width: objW, height: objH, ...ops });
                                    }
                                    else if (o.shapeType === 'circle') {
                                        cp.drawEllipse({ x: cx, y: cy, xScale: objW / 2, yScale: objH / 2, ...ops, rotatePivot: undefined });
                                    }
                                    else if (o.shapeType === 'round_rect') {
                                        // Use normalized SVG path (0-100 coordinate system) with scaling
                                        // This matches how star and arrow shapes work
                                        const cornerRadius = 15; // 15% radius in normalized coords

                                        // Normalized rounded rectangle path (100x100 viewBox)
                                        // Starting from top-left corner, going clockwise
                                        const roundRectPath = `
                                            M ${cornerRadius} 0
                                            L ${100 - cornerRadius} 0
                                            Q 100 0 100 ${cornerRadius}
                                            L 100 ${100 - cornerRadius}
                                            Q 100 100 ${100 - cornerRadius} 100
                                            L ${cornerRadius} 100
                                            Q 0 100 0 ${100 - cornerRadius}
                                            L 0 ${cornerRadius}
                                            Q 0 0 ${cornerRadius} 0
                                            Z
                                        `.replace(/\s+/g, ' ').trim();

                                        try {
                                            const scaleX = objW / 100;
                                            const scaleY = objH / 100;
                                            // Use average scale for uniform rendering
                                            const avgScale = (scaleX + scaleY) / 2;

                                            // Draw fill first
                                            if (!o.noFill) {
                                                cp.drawSvgPath(roundRectPath, {
                                                    x: pdfX,
                                                    y: pdfY + objH,
                                                    scale: avgScale,
                                                    color: getSafeColor(o.fill),
                                                    opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100
                                                });
                                            }
                                            // Draw border on top
                                            if (!o.noBorder) {
                                                cp.drawSvgPath(roundRectPath, {
                                                    x: pdfX,
                                                    y: pdfY + objH,
                                                    scale: avgScale,
                                                    borderColor: getSafeColor(o.stroke),
                                                    borderWidth: Number(o.strokeWidth || 2),
                                                    opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100
                                                });
                                            }
                                            console.log('Rounded rectangle drawn successfully with SVG path');
                                        } catch (svgErr) {
                                            // Fallback to regular rectangle if SVG path fails
                                            console.log('SVG path failed, using regular rect:', svgErr);
                                            cp.drawRectangle({ x: pdfX, y: pdfY, width: objW, height: objH, ...ops });
                                        }
                                    }
                                    else {
                                        // SVG Paths para formas complejas
                                        const safeW = Number(objW) || 100;
                                        const safeH = Number(objH) || 100;
                                        const strokeColor = getSafeColor(o.stroke) || getSafeColor('#000000');
                                        const strokeWidth = Number(o.strokeWidth) || 2;
                                        const shapeOpacity = (o.opacity || 100) / 100;

                                        // Special handling for line-based shapes
                                        if (o.shapeType === 'arrow_line') {
                                            console.log('Drawing arrow_line...');
                                            // ✅ FIX: Use SVG path instead of separate lines
                                            // Arrow line with arrowhead pointing right
                                            const arrowPath = `M 0 50 L 85 50 M 75 30 L 100 50 L 75 70`;
                                            try {
                                                const scaleX = safeW / 100;
                                                const scaleY = safeH / 100;
                                                const avgScale = (scaleX + scaleY) / 2;

                                                cp.drawSvgPath(arrowPath, {
                                                    x: pdfX,
                                                    y: pdfY + safeH,
                                                    scale: avgScale,
                                                    borderColor: strokeColor,
                                                    borderWidth: strokeWidth,
                                                    opacity: shapeOpacity
                                                });
                                                console.log('Arrow line drawn successfully');
                                            } catch (e) {
                                                // Fallback to individual lines
                                                const y = pdfY + safeH / 2;
                                                cp.drawLine({ start: { x: pdfX, y }, end: { x: pdfX + safeW * 0.85, y }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                                cp.drawLine({ start: { x: pdfX + safeW * 0.75, y: pdfY + safeH * 0.3 }, end: { x: pdfX + safeW, y }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                                cp.drawLine({ start: { x: pdfX + safeW * 0.75, y: pdfY + safeH * 0.7 }, end: { x: pdfX + safeW, y }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                            }
                                        }
                                        else if (o.shapeType === 'bracket') {
                                            console.log('Drawing bracket...');
                                            // FIX: Use full width for bracket arms
                                            const armLength = objW;
                                            const bracketPath = `M ${armLength} 0 L 0 0 L 0 ${objH} L ${armLength} ${objH}`;

                                            // FIX: Anchor at Top-Left (pdfY + objH)
                                            try {
                                                cp.drawSvgPath(bracketPath, {
                                                    x: pdfX,
                                                    y: pdfY + objH,
                                                    borderColor: getSafeColor(o.stroke),
                                                    borderWidth: Number(o.strokeWidth || 2),
                                                    opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100,
                                                    ...ops
                                                });
                                                console.log('Bracket drawn successfully at:', pdfX, pdfY + objH);
                                            } catch (e) {
                                                console.warn('Bracket SVG failed, using line fallback:', e);
                                                const strokeColor = getSafeColor(o.stroke) || getSafeColor('#000000');
                                                const strokeWidth = Number(o.strokeWidth) || 2;
                                                const shapeOpacity = o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100;
                                                cp.drawLine({ start: { x: pdfX + objW, y: pdfY }, end: { x: pdfX, y: pdfY }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                                cp.drawLine({ start: { x: pdfX, y: pdfY }, end: { x: pdfX, y: pdfY + objH }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                                cp.drawLine({ start: { x: pdfX, y: pdfY + objH }, end: { x: pdfX + objW, y: pdfY + objH }, thickness: strokeWidth, color: strokeColor, opacity: shapeOpacity });
                                            }
                                        }
                                        else if (o.shapeType === 'triangle') {
                                            console.log('Drawing triangle...');
                                            // FIX: Coordinates for UP pointing triangle (Apex at 0, Base at objH)
                                            // Anchored at TOP (pdfY + objH) and drawing downwards
                                            const topX = objW / 2;
                                            const topY = 0;
                                            const bottomLeftX = 0;
                                            const bottomLeftY = objH;
                                            const bottomRightX = objW;
                                            const bottomRightY = objH;

                                            const trianglePath = `M ${topX} ${topY} L ${bottomLeftX} ${bottomLeftY} L ${bottomRightX} ${bottomRightY} Z`;

                                            const triangleOps = {
                                                x: pdfX,
                                                y: pdfY + objH, // Anchor at TOP
                                                opacity: o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100,
                                                ...ops
                                            };

                                            if (!o.noFill) triangleOps.color = getSafeColor(o.fill);
                                            if (!o.noBorder) {
                                                triangleOps.borderColor = getSafeColor(o.stroke);
                                                triangleOps.borderWidth = Number(o.strokeWidth || 2);
                                            }

                                            try {
                                                cp.drawSvgPath(trianglePath, triangleOps);
                                                console.log('✅ Triangle drawn at:', pdfX, pdfY + objH);
                                            } catch (triErr) {
                                                console.error('Error drawing triangle SVG:', triErr);
                                            }
                                        }
                                        else if (o.shapeType === 'star' || o.shapeType === 'arrow') {

                                            let path = "";
                                            const sx = safeW / 100;
                                            const sy = safeH / 100;

                                            if (o.shapeType === 'star') path = "M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z";
                                            else if (o.shapeType === 'arrow') path = "M0 40 H60 V20 L100 50 L60 80 V60 H0 Z";

                                            if (path && !isNaN(sx)) {
                                                cp.drawSvgPath(path, {
                                                    x: pdfX, y: pdfY + safeH,
                                                    scale: sx,
                                                    ...ops,
                                                    rotatePivot: { x: cx, y: cy }
                                                });

                                            }
                                        }
                                        else if (o.shapeType === 'heart') {
                                            const path = "M50 85C50 85 10 58 10 30a20 20 0 0140 0 20 20 0 0140 0C90 58 50 85 50 85Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'cloud') {
                                            const path = "M80 65a20 20 0 00-38-8 15 15 0 00-22 14 15 15 0 0015 14h45a15 15 0 000-20z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH * 0.8, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'burst') {
                                            const path = "M50 0l8 30 22-22-12 28 30-5-25 18 25 18-30-5 12 28-22-22-8 30-8-30-22 22 12-28-30 5 25-18-25-18 30 5-12-28 22 22z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'chevron') {
                                            const path = "M0 0H70L100 50L70 100H0L30 50Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'cross') {
                                            const path = "M35 0H65V35H100V65H65V100H35V65H0V35H35Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'double_arrow') {
                                            const path = "M0 50L20 20V40H80V20L100 50L80 80V60H20V80Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'diamond') {
                                            const path = "M50 0L100 50L50 100L0 50Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'hexagon') {
                                            const path = "M25 0L75 0L100 50L75 100L25 100L0 50Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'pentagon') {
                                            const path = "M50 0L100 38L81 100L19 100L0 38Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'octagon') {
                                            const path = "M30 0L70 0L100 30L100 70L70 100L30 100L0 70L0 30Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'parallelogram') {
                                            const path = "M20 0L100 0L80 100L0 100Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'trapezoid') {
                                            const path = "M20 0L80 0L100 100L0 100Z";
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'cylinder') {
                                            // Approx cylinder as rounded rect
                                            const path = `M5 18H95V88Q95 93 50 93Q5 93 5 88Z M5 18Q5 8 50 8Q95 8 95 18Q95 28 50 28Q5 28 5 18Z`;
                                            cp.drawSvgPath(path, { x: pdfX, y: pdfY + safeH, scale: safeW / 100, ...ops, rotatePivot: { x: cx, y: cy } });
                                        }
                                        else if (o.shapeType === 'no_entry') {
                                            // Circle with diagonal bar approximated as path
                                            cp.drawCircle({ x: cx, y: cy, size: Math.min(safeW, safeH), ...ops });
                                        }
                                        else {
                                            // Unknown shape — draw bounding box
                                            cp.drawRectangle({ x: pdfX, y: pdfY, width: safeW, height: safeH, ...ops });
                                        }
                                    }
                                } catch (shapeErr) {
                                    console.error('=== SHAPE RENDERING ERROR ===');
                                    console.error('Shape type:', o.shapeType);
                                    console.error('Error:', shapeErr);
                                }
                            }
                        }

                        // ── Conectores ────────────────────────────────────────
                        const pageConnectors = (p.objects || []).filter(o => o.type === 'connector');
                        for (const co of pageConnectors) {
                            try {
                                const x1 = co.x1 != null ? co.x1 : co.x;
                                const y1 = co.y1 != null ? co.y1 : co.y;
                                const x2 = co.x2 != null ? co.x2 : (co.x + co.width);
                                const y2 = co.y2 != null ? co.y2 : (co.y + co.height);
                                const sw = Number(co.strokeWidth || 2);
                                const op = co.opacity !== undefined && co.opacity <= 1 ? co.opacity : (co.opacity || 100) / 100;
                                const sc = getSafeColor(co.stroke || '#000000');
                                const cType = co.connType || 'line';

                                // PDF coords: Y flipped (pageHeight - y), same as other objects
                                const px1 = x1;
                                const py1 = pageHeight - y1;
                                const px2 = x2;
                                const py2 = pageHeight - y2;

                                const drawSegments = (pts) => {
                                    for (let i = 0; i < pts.length - 1; i++) {
                                        cp.drawLine({
                                            start: { x: pts[i][0], y: pts[i][1] },
                                            end:   { x: pts[i+1][0], y: pts[i+1][1] },
                                            thickness: sw,
                                            color: sc,
                                            opacity: op,
                                            lineCap: PDFLib.LineCapStyle.Round
                                        });
                                    }
                                };

                                if (cType === 'elbow' || cType === 'elbow_arrow') {
                                    const mx = (px1 + px2) / 2;
                                    drawSegments([[px1, py1],[mx, py1],[mx, py2],[px2, py2]]);
                                } else if (cType === 'bracket') {
                                    drawSegments([[px2, py1],[px1, py1],[px1, py2],[px2, py2]]);
                                } else {
                                    // line, arrow, double_arrow, curved — draw as straight line
                                    cp.drawLine({
                                        start: { x: px1, y: py1 },
                                        end:   { x: px2, y: py2 },
                                        thickness: sw,
                                        color: sc,
                                        opacity: op,
                                        lineCap: PDFLib.LineCapStyle.Round
                                    });
                                }

                                // Arrowhead(s)
                                if (cType === 'arrow' || cType === 'elbow_arrow' || cType === 'curved' || cType === 'double_arrow') {
                                    const drawArrow = (tipX, tipY, fromX, fromY) => {
                                        const angle = Math.atan2(tipY - fromY, tipX - fromX);
                                        const al = sw * 4 + 6;
                                        const spread = Math.PI / 6;
                                        cp.drawLine({ start: { x: tipX, y: tipY }, end: { x: tipX - al * Math.cos(angle - spread), y: tipY - al * Math.sin(angle - spread) }, thickness: sw, color: sc, opacity: op, lineCap: PDFLib.LineCapStyle.Round });
                                        cp.drawLine({ start: { x: tipX, y: tipY }, end: { x: tipX - al * Math.cos(angle + spread), y: tipY - al * Math.sin(angle + spread) }, thickness: sw, color: sc, opacity: op, lineCap: PDFLib.LineCapStyle.Round });
                                    };
                                    if (cType === 'elbow_arrow') {
                                        drawArrow(px2, py2, (px1 + px2) / 2, py2);
                                    } else {
                                        drawArrow(px2, py2, px1, py1);
                                    }
                                    if (cType === 'double_arrow') {
                                        drawArrow(px1, py1, px2, py2);
                                    }
                                }
                            } catch (connErr) {
                                console.warn('Connector PDF render error:', connErr);
                            }
                        }

                        if (!pageAlreadyAdded) out.addPage(cp);
                    }

                    // Add transparent PDF link annotations after every output page exists.
                    // This preserves each object's appearance and supports forward page links.
                    pagesToProcess.forEach((p, pageIndex) => {
                        const cp = out.getPages()[pageIndex];
                        if (!cp) return;
                        const pageHeight = cp.getHeight();
                        (p.objects || []).forEach(o => {
                            const action = o.actionLink;
                            if (!action || !o.width || !o.height) return;
                            const x = Number(o.x || 0);
                            const y = pageHeight - Number(o.y || 0) - Number(o.height || 0);
                            const annotation = out.context.obj({});
                            annotation.set(PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Annot'));
                            annotation.set(PDFLib.PDFName.of('Subtype'), PDFLib.PDFName.of('Link'));
                            annotation.set(PDFLib.PDFName.of('Rect'), out.context.obj([x, y, x + Number(o.width), y + Number(o.height)]));
                            annotation.set(PDFLib.PDFName.of('Border'), out.context.obj([0, 0, 0]));
                            if (action.type === 'internal' && action.internalPage) {
                                const target = out.getPages()[Number(action.internalPage) - 1];
                                if (!target) return;
                                annotation.set(PDFLib.PDFName.of('Dest'), out.context.obj([
                                    target.ref, PDFLib.PDFName.of('XYZ'), null, null, null
                                ]));
                            } else if (action.url) {
                                const uri = out.context.obj({});
                                uri.set(PDFLib.PDFName.of('Type'), PDFLib.PDFName.of('Action'));
                                uri.set(PDFLib.PDFName.of('S'), PDFLib.PDFName.of('URI'));
                                uri.set(PDFLib.PDFName.of('URI'), PDFLib.PDFString.of(action.url));
                                annotation.set(PDFLib.PDFName.of('A'), uri);
                            } else return;
                            const ref = out.context.register(annotation);
                            const annots = cp.node.get(PDFLib.PDFName.of('Annots'));
                            if (annots) annots.push(ref);
                            else cp.node.set(PDFLib.PDFName.of('Annots'), out.context.obj([ref]));
                        });
                    });


                    const form = out.getForm();
                    for (const field of form.getFields()) {
                        if (!deletedNativeFields.has(field.getName())) continue;
                        const widgets = new Set(field.acroField.getWidgets().map(widget => widget.dict));
                        const refs = new Set([field.ref]);
                        for (const widget of widgets) {
                            const ref = out.context.getObjectRef(widget);
                            if (ref) refs.add(ref);
                        }
                        for (const outputPage of out.getPages()) {
                            const annots = outputPage.node.lookupMaybe(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
                            for (let i = (annots?.size() || 0) - 1; i >= 0; i--) {
                                if (refs.has(annots.get(i)) || widgets.has(annots.lookup(i, PDFLib.PDFDict))) annots.remove(i);
                            }
                        }
                        form.acroForm.removeField(field.acroField);
                        for (const ref of refs) out.context.delete(ref);
                    }
                    this._syncNativeOverlayValuesForSave(pagesToProcess, doc.pages[doc.currentIndex]);
                    this._applyNativeFormValues(out, pagesToProcess);
                    this._prepareNativeFormAppearances(out, embeddedFonts['Helvetica'], _autoSizeFieldNames);

                    // Rebuild appearance streams for all form fields (prevents blank fields on save)
                    try {
                        out.getForm().updateFieldAppearances(embeddedFonts['Helvetica']);
                    } catch (e) { /* Sin formulario, ok */ }

                    // Preserve native auto-size through appearance rebuilding. Valid AP + DA/DR is
                    // portable; NeedAppearances is intentionally removed because viewers disagree on it.
                    try {
                        const form = out.getForm();
                        for (const fieldName of _autoSizeFieldNames) {
                            const field = form.getFieldMaybe(fieldName);
                            this._setNativeFieldAutoSize(field);
                        }
                        form.acroForm.dict.delete(PDFLib.PDFName.of('NeedAppearances'));
                    } catch(e) { console.warn('Form appearance finalization failed:', e); }

                    // Enable compression (Object Streams) to reduce file size
                    const saveOptions = compress ? { useObjectStreams: true } : {};

                    let pdfBytes = await out.save(saveOptions);

                    // 🐍 Apply styled checkbox/radio appearance streams via PyMuPDF
                    const _allStyledFields = pagesToProcess.flatMap(p => p._styledFields || []);
                    if (_allStyledFields.length > 0 && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "Aplicando estilos a campos...";
                            pdfBytes = await PythonManager.applyStyledFields(pdfBytes, _allStyledFields);
                        } catch (sfErr) {
                            console.warn("⚠️ applyStyledFields failed:", sfErr);
                        }
                        // Clean up tags
                        pagesToProcess.forEach(p => { delete p._styledFields; });
                    }

                    // 🐍 Apply Tab Order: reorder /Annots array by tabIndex via PyMuPDF
                    // Collect all field names ordered by tabIndex per page
                    const _tabOrderData = pagesToProcess.map((p, pi) => {
                        const fields = (p.objects || [])
                            .filter(o => o.type === 'form-field' && o.fieldName)
                            .sort((a, b) => (a.tabIndex || 999) - (b.tabIndex || 999))
                            .map(o => o.fieldName);
                        return { pageIndex: pi, fieldNames: fields };
                    }).filter(d => d.fieldNames.length > 0);

                    if (_tabOrderData.length > 0 && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "Aplicando orden de tabulación...";
                            const _tabSafe = pdfBytes instanceof ArrayBuffer ? pdfBytes.slice(0) : new Uint8Array(pdfBytes).buffer.slice(0);
                            const uint8 = new Uint8Array(_tabSafe);
                            PythonManager.pyodide.globals.set('_tab_pdf', uint8);
                            PythonManager.pyodide.globals.set('_tab_order_data',
                                PythonManager.pyodide.toPy(_tabOrderData));

                            const result = await PythonManager.pyodide.runPythonAsync(`
import fitz, json

pdf_bytes = bytes(_tab_pdf)
tab_data  = [dict(d) for d in _tab_order_data]

doc = fitz.open(stream=pdf_bytes, filetype="pdf")

for entry in tab_data:
    pno          = entry['pageIndex']
    field_names  = list(entry['fieldNames'])
    if not field_names or pno >= len(doc):
        continue

    page = doc[pno]

    # Build a map: field_name -> widget xref
    name_to_xref = {}
    for widget in page.widgets():
        fn = widget.field_name
        if fn:
            name_to_xref[fn] = widget.xref

    # Build ordered xref list (only fields we know about, in tab order)
    ordered_xrefs = []
    for fn in field_names:
        if fn in name_to_xref:
            ordered_xrefs.append(name_to_xref[fn])

    # Append any widgets NOT in our list at the end (native fields not managed by us)
    managed = set(ordered_xrefs)
    for widget in page.widgets():
        if widget.xref not in managed:
            ordered_xrefs.append(widget.xref)

    if not ordered_xrefs:
        continue

    # Set /Annots array on the page in the new order
    # /Annots can contain non-widget annotations too — preserve those first
    page_xref = page.xref
    try:
        annots_str = doc.xref_get_key(page_xref, 'Annots')
        # Parse existing annots to find non-widget xrefs
        import re
        non_widget_xrefs = []
        if annots_str and annots_str[0] == '[':
            for m in re.finditer(r'(\d+)\s+0\s+R', annots_str[1]):
                xref = int(m.group(1))
                if xref not in managed:
                    non_widget_xrefs.append(xref)
    except Exception:
        non_widget_xrefs = []

    # Build new /Annots array: widgets in tab order, then other annotations
    all_xrefs = ordered_xrefs + non_widget_xrefs
    new_annots = '[' + ' '.join(f'{x} 0 R' for x in all_xrefs) + ']'
    doc.xref_set_key(page_xref, 'Annots', new_annots)

import io, base64
out = io.BytesIO()
doc.save(out)
doc.close()
base64.b64encode(out.getvalue()).decode('ascii')
`);
                            const raw = atob(result);
                            const bytes = new Uint8Array(raw.length);
                            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                            pdfBytes = bytes.buffer;
                        } catch (tabErr) {
                            console.warn("⚠️ Tab order application failed:", tabErr);
                        }
                    }

                    // 🐍 EMBED COMMENTS as PDF Text Annotations (sticky notes)
                    const _commentData = pagesToProcess.map((p, pi) => {
                        const { width: _rw, height: _rh } = (() => {
                            // We need page dims per page - approximate from objects or use stored data
                            const src = doc.sources[p.sourceId];
                            const _srcPassword = src?.password || null;
                            const _pdfLibLoadOpts = _srcPassword ? { password: _srcPassword } : { ignoreEncryption: true };
                            return { width: p._pdfW || 595, height: p._pdfH || 842 };
                        })();
                        return {
                            pageIndex: pi,
                            pageH: p._pdfH || 842,
                            comments: (p.objects || [])
                                .filter(o => o.type === 'comment')
                                .map(o => ({
                                    x: o.x,
                                    y: o.y,
                                    text: o.text || '',
                                    author: o.author || 'Usuario',
                                    color: o.color || '#f59e0b',
                                    replies: (o.replies || []).map(r => `${r.author || ''}: ${r.text || ''}`).join('\n'),
                                    repliesJson: JSON.stringify(o.replies || []),
                                    resolved: !!o.resolved
                                }))
                        };
                    }).filter(pd => pd.comments.length > 0);

                    // 🐍 EMBED BOOKMARKS as PDF Outlines
                    const _bmData = window.BookmarkManager ? BookmarkManager.getAll(doc) : [];

                    if ((_commentData.length > 0 || _bmData.length > 0) && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "Integrando comentarios y marcadores...";
                            const _annotSafe = pdfBytes instanceof ArrayBuffer ? pdfBytes.slice(0) : new Uint8Array(pdfBytes).buffer.slice(0);
                            const uint8 = new Uint8Array(_annotSafe);
                            PythonManager.pyodide.globals.set('_annot_pdf', uint8);
                            PythonManager.pyodide.globals.set('_annot_comments_json', JSON.stringify(_commentData));
                            PythonManager.pyodide.globals.set('_annot_native_mods_json', JSON.stringify(doc.modifiedNativeComments || {}));
                            PythonManager.pyodide.globals.set('_annot_bookmarks_json', JSON.stringify(_bmData));

                            const result = await PythonManager.pyodide.runPythonAsync(`
import fitz, json, base64, io

def hex_to_rgb01(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    r,g,b = int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255
    return (r,g,b)

pdf_bytes = bytes(_annot_pdf)
comment_data = json.loads(_annot_comments_json)
native_mods = json.loads(_annot_native_mods_json)
bookmark_data = json.loads(_annot_bookmarks_json)

doc = fitz.open(stream=pdf_bytes, filetype="pdf")

# ── Update Existing Native Annotations ──
# Strategy: Match by content/author instead of xref (xrefs change after PDF-Lib copy)
for pno_str, mods in native_mods.items():
    pno = int(pno_str)
    if pno >= len(doc): continue
    page = doc[pno]
    annot_list = list(page.annots()) if page.annots() else []
    for mod_key, mod in mods.items():
        if not mod:
            continue
        # Try to find matching annotation: first by xref, then by content match
        matched_annot = None
        for annot in annot_list:
            xref_str = str(annot.xref)
            if xref_str == mod_key or (xref_str + 'R') == mod_key or mod_key == (xref_str + 'R'):
                matched_annot = annot
                break
        # Fallback: match by original text content (more reliable after PDF-Lib copy)
        if not matched_annot and mod.get('text'):
            mod_text = (mod.get('text') or '').strip()
            if mod_text:
                for annot in annot_list:
                    try:
                        annot_content = (annot.info.get('content') or '').strip()
                        if annot_content and (annot_content == mod_text or mod_text in annot_content or annot_content in mod_text):
                            matched_annot = annot
                            break
                    except: pass
        # Fallback: match by author name
        if not matched_annot and mod.get('author'):
            for annot in annot_list:
                try:
                    annot_author = (annot.info.get('title') or '').strip()
                    if annot_author and annot_author == mod.get('author','').strip():
                        matched_annot = annot
                        break
                except: pass
        if matched_annot:
            annot = matched_annot
            if 'text' in mod or 'reactions' in mod or 'replies' in mod:
                content = mod.get('text') or annot.info.get('content') or ''
                # Store structured data (replies + reactions) as JSON in subject field
                structured = {}
                if mod.get('replies'):
                    structured['r'] = mod['replies']
                if mod.get('reactions') and len(mod['reactions']) > 0:
                    structured['rx'] = mod['reactions']
                if structured:
                    annot.set_info(content=content, subject=json.dumps(structured, ensure_ascii=False))
                else:
                    annot.set_info(content=content)
            if 'author' in mod:
                annot.set_info(title=mod['author'])
            if 'color' in mod:
                try:
                    col = hex_to_rgb01(mod['color'])
                    annot.set_colors(stroke=col, fill=col)
                except: pass
            if mod.get('resolved'):
                annot.set_flags(fitz.PDF_ANNOT_IS_HIDDEN)
            else:
                flags = annot.flags
                if flags & fitz.PDF_ANNOT_IS_HIDDEN:
                    annot.set_flags(flags & ~fitz.PDF_ANNOT_IS_HIDDEN)
            annot.update()

# ── New comments are now handled by PDF-Lib directly for compatibility ──

# ── Bookmarks as PDF Outlines ──
if bookmark_data:
    try:
        toc = []
        for bm in bookmark_data:
            pno = int(bm.get('pageIndex', 0))
            title = str(bm.get('title', 'Marcador'))
            toc.append([1, title, pno + 1])
        toc.sort(key=lambda t: t[2])
        if toc:
            existing = doc.get_toc(simple=True)  # simple=True → always 3-element lists
            if not existing:
                doc.set_toc(toc)
            else:
                existing_pages = {e[2] for e in existing}
                merged = existing + [t for t in toc if t[2] not in existing_pages]
                merged.sort(key=lambda t: t[2])
                doc.set_toc(merged)
    except Exception as e:
        pass

out2 = io.BytesIO()
doc.save(out2, deflate=True, garbage=3, clean=True)
doc.close()
base64.b64encode(out2.getvalue()).decode('ascii')
`);
                            const raw2 = atob(result);
                            const bytes2 = new Uint8Array(raw2.length);
                            for (let i = 0; i < raw2.length; i++) bytes2[i] = raw2.charCodeAt(i);
                            pdfBytes = bytes2.buffer;
                        } catch (annotErr) {
                            console.warn('⚠️ Comment/bookmark embedding failed:', annotErr);
                        }
                    }

                    // 🐍 COPY EMBEDDED FILES (adjuntos) from source buffers to output PDF
                    const _attachSrcIds = [...new Set(pagesToProcess.map(p => p.sourceId))];
                    const _attachSources = _attachSrcIds.map(id => doc.sources[id]).filter(s => s && s.buffer);
                    if (_attachSources.length > 0 && PythonManager.isLoaded) {
                        try {
                            document.getElementById('loader-msg').innerText = "Copiando archivos adjuntos...";

                            // Step 1: collect all embedded file {name, b64data, filename, desc, mime} from all sources
                            const _collectedFiles = [];
                            const _seenNames = new Set();

                            for (const _src of _attachSources) {
                                try {
                                    const _srcSafe = _src.buffer instanceof ArrayBuffer ? _src.buffer.slice(0) : new Uint8Array(_src.buffer).buffer.slice(0);
                                    const _srcU8 = new Uint8Array(_srcSafe);
                                    PythonManager.pyodide.globals.set('_emb_src_buf', _srcU8);
                                    const _srcResult = await PythonManager.pyodide.runPythonAsync(`
import fitz, base64, json
result = []
try:
    if hasattr(_emb_src_buf, 'to_py'):
        buf = bytes(_emb_src_buf.to_py())
    else:
        buf = bytes(_emb_src_buf)
    src = fitz.open(stream=buf, filetype="pdf")
    for nm in src.embfile_names():
        try:
            info = src.embfile_info(nm)
            data = src.embfile_get(nm)
            result.append(json.dumps({
                "name": nm,
                "filename": info.get("filename", nm),
                "ufilename": info.get("ufilename", nm),
                "desc": info.get("desc", ""),
                "mime": info.get("mimetype", "application/octet-stream"),
                "data": base64.b64encode(data).decode("ascii")
            }))
        except: pass
    src.close()
except: pass
json.dumps(result)
`);
                                    const _parsed = JSON.parse(_srcResult);
                                    for (const _entry of _parsed) {
                                        const _f = JSON.parse(_entry);
                                        if (!_seenNames.has(_f.name)) {
                                            _seenNames.add(_f.name);
                                            _collectedFiles.push(_f);
                                        }
                                    }
                                } catch (_srcErr) { /* continue */ }
                            }

                            // Step 2: inject collected files into output PDF
                            if (_collectedFiles.length > 0) {
                                const _outSafe = pdfBytes instanceof ArrayBuffer ? pdfBytes.slice(0) : new Uint8Array(pdfBytes).buffer.slice(0);
                                const _outU8 = new Uint8Array(_outSafe);
                                PythonManager.pyodide.globals.set('_emb_out_buf', _outU8);
                                PythonManager.pyodide.globals.set('_emb_files_json', JSON.stringify(_collectedFiles));
                                const _injectResult = await PythonManager.pyodide.runPythonAsync(`
import fitz, base64, json, io
if hasattr(_emb_out_buf, 'to_py'):
    out_bytes = bytes(_emb_out_buf.to_py())
else:
    out_bytes = bytes(_emb_out_buf)
files = json.loads(_emb_files_json)
out_doc = fitz.open(stream=out_bytes, filetype="pdf")
existing = set(out_doc.embfile_names())
for f in files:
    if f["name"] not in existing:
        data = base64.b64decode(f["data"])
        out_doc.embfile_add(f["name"], data,
            filename=f["filename"],
            ufilename=f["ufilename"],
            desc=f["desc"])
        existing.add(f["name"])
buf = io.BytesIO()
out_doc.save(buf, deflate=True, garbage=3)
out_doc.close()
base64.b64encode(buf.getvalue()).decode("ascii")
`);
                                const _rawInject = atob(_injectResult);
                                const _bytesInject = new Uint8Array(_rawInject.length);
                                for (let i = 0; i < _rawInject.length; i++) _bytesInject[i] = _rawInject.charCodeAt(i);
                                pdfBytes = _bytesInject.buffer;
                                console.log(`📎 ${_collectedFiles.length} adjunto(s) copiado(s) al PDF de salida`);
                            }
                        } catch (_attachErr) {
                            console.warn('⚠️ Attachment copy failed:', _attachErr);
                        }
                    }

                    // 🐍 CRITICAL: Apply Python PyMuPDF compression if requested
                    if (compress) {
                        if (typeof PythonManager === 'undefined' || typeof PythonManager.compressPDF !== 'function')
                            throw new Error('COMPRESSION_UNAVAILABLE');
                        document.getElementById('loader-msg').innerText = "Python: Comprimiendo PDF...";
                        // compressLevel: 'fast' = no recomprimir imgs, 'standard' = calidad 75, 'max' = calidad 45
                        const imgQuality = compressLevel === 'max' ? 45 : compressLevel === 'fast' ? 0 : compressLevel === 'lossless' ? -1 : 75;
                        try {
                            pdfBytes = await PythonManager.compressPDF(pdfBytes, imgQuality);
                        } catch (error) {
                            throw new Error('COMPRESSION_FAILED', { cause: error });
                        }
                    }

                    if (returnBytes) return pdfBytes;

                    const fileName = customFilename ? (customFilename + '.pdf') : (onlyCurrentPage ? 'pagina_exportada.pdf' : (doc.name || 'documento_editado.pdf'));
                    saveAs(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
                    this.showToast('PDF guardado' + (compress ? ' (Comprimido)' : ''));

                } catch (e) {
                    console.error('PDF Save Error:', e);
                    if (returnBytes) throw e;
                    if (e.message && e.message.includes('timed out')) {
                        this.showToast('⚠️ El PDF tardó demasiado — intenta con menos páginas', 5000);
                    } else if (e.message && (e.message.includes('corrupt') || e.message.includes('Invalid'))) {
                        this.showToast('⚠️ El archivo PDF fuente puede estar dañado', 5000);
                    } else {
                        alert("Error al guardar: " + e.message);
                    }
                } finally {
                    this._isSaving = false;
                    this.toggleLoader(false);
                }
            },

            generatePDFBuffer: async function (doc) {
                // Generate PDF bytes for the given document (used for favorites caching)
                if (!doc) doc = this.getDoc();
                if (!doc || !doc.pages.length) {
                    throw new Error('No document to generate PDF from');
                }

                // Temporarily set as active doc if needed
                const originalDoc = this.activeDocId;
                const wasActive = this.activeDocId === doc.id;

                if (!wasActive) {
                    this.activeDocId = doc.id;
                }

                try {
                    // Use existing savePDFInternal with returnBytes=true
                    const pdfBytes = await this.savePDFInternal(false, null, false, true);
                    return pdfBytes;
                } finally {
                    // Restore original active doc
                    if (!wasActive) {
                        this.activeDocId = originalDoc;
                    }
                }
            },

            savePDF: function () {
                console.log('=== savePDF() CALLED ===');
                console.log('PDFLib available:', typeof PDFLib !== 'undefined');
                console.log('saveAs available:', typeof saveAs !== 'undefined');
                const doc = this.getDoc();
                console.log('this.getDoc():', doc ? 'exists' : 'null');

                if (!doc) {
                    alert('❌ No hay documento para guardar');
                    return;
                }

                // Save last read position for bookmark system
                if (window.BookmarkManager) BookmarkManager.saveLastRead(doc, doc.currentIndex);

                // CRITICAL: Normalize ALL opacity before save to prevent PDF-lib validation errors
                // DISABLED: This causes shapes/stamps opacity issues
                console.log('🔧 Normalizando opacidad de todos los objetos...');
                // this.normalizeAllOpacity(doc);
                console.log('✅ Opacidad normalizada correctamente');


                if (typeof PDFLib === 'undefined') {
                    console.error('ERROR: PDFLib is not loaded!');
                    alert('No se pudo preparar el guardado del PDF. Reinicia la aplicación e inténtalo de nuevo.');
                    return;
                }

                // Call with compression enabled by default
                this.savePDFInternal(false, null, true).then(() => {
                    console.log('=== SAVE COMPLETED SUCCESSFULLY ===');
                }).catch(err => {
                    console.error('=== SAVE PDF ASYNC ERROR ===', err);
                    console.error('Error stack:', err.stack);
                    alert('No se pudo guardar el PDF. Inténtalo de nuevo.');
                });
            },

            // ============================================================
            // SISTEMA DE COMENTARIOS
            // ============================================================
            movePage: function (dir) {
                const doc = this.getDoc();
                if (!doc) return;
                let newIdx = doc.currentIndex + dir;
                if (newIdx >= 0 && newIdx < doc.pages.length) {
                    this.loadPage(newIdx);
                    this.updateSidebarSelection();
                }
            },

            reorderCurrentPage: function (dir) {
                const doc = this.getDoc();
                if (!doc) return;

                // Obtener objetivos: Si hay multiselección, usarla. Si no, la página actual.
                let targets = [];
                if (this.multiSelection.size > 0) {
                    targets = Array.from(this.multiSelection).sort((a, b) => a - b);
                } else {
                    targets = [doc.currentIndex];
                }

                if (targets.length === 0) return;

                // Si movemos arriba (dir = -1), procesamos de arriba a abajo.
                // Si movemos abajo (dir = 1), procesamos de abajo a arriba para no pisarnos.

                if (dir === -1) {
                    // Mover ARRIBA
                    if (targets[0] === 0) return; // Tope alcanzado

                    // Ordenar targets ascendente para mover primero el de más arriba
                    targets.sort((a, b) => a - b);

                    targets.forEach(idx => {
                        if (idx > 0) {
                            const temp = doc.pages[idx];
                            doc.pages[idx] = doc.pages[idx - 1];
                            doc.pages[idx - 1] = temp;

                            // Actualizar índices en multiselección
                            this.multiSelection.delete(idx);
                            this.multiSelection.add(idx - 1);
                        }
                    });
                    // Ajustar pagina actual si estaba en la selección
                    if (this.multiSelection.has(doc.currentIndex)) doc.currentIndex -= 1; // Simplificación, idealmente rastrear exacto

                } else {
                    // Mover ABAJO
                    if (targets[targets.length - 1] === doc.pages.length - 1) return; // Tope alcanzado

                    // Ordenar targets descendente para mover primero el de más abajo
                    targets.sort((a, b) => b - a);

                    targets.forEach(idx => {
                        if (idx < doc.pages.length - 1) {
                            const temp = doc.pages[idx];
                            doc.pages[idx] = doc.pages[idx + 1];
                            doc.pages[idx + 1] = temp;

                            // Actualizar índices en multiselección
                            this.multiSelection.delete(idx);
                            this.multiSelection.add(idx + 1);
                        }
                    });
                    // Ajustar pagina actual
                    if (this.multiSelection.has(doc.currentIndex)) doc.currentIndex += 1;
                }

                // Asegurar índices válidos
                if (doc.currentIndex < 0) doc.currentIndex = 0;
                if (doc.currentIndex >= doc.pages.length) doc.currentIndex = doc.pages.length - 1;

                this.saveState();
                this.renderSidebar();
                this.loadPage(doc.currentIndex);
                this.updateSidebarSelection();
            },

            showPageNumModal: function (editObj = null) {
                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                document.getElementById('page-num-modal').style.display = 'block';
                document.getElementById('drop-modal-content').style.display = 'none';

                if (!this._batesSegments || !this._batesSegments.length) {
                    this._batesSegments = [
                        { id: Date.now() + 1, type: 'text',    value: 'EXP' },
                        { id: Date.now() + 2, type: 'text',    value: '2026' },
                        { id: Date.now() + 3, type: 'counter', digits: 6 }
                    ];
                    this._batesSep = '-';
                }
                this._pnSetTab('simple');
                this._batesRenderSegments();

                if (editObj && editObj.isPageNum) {
                    let fontRaw = editObj.font || 'Helvetica';
                    let fontBase = 'Helvetica';
                    if (fontRaw.includes('Times')) fontBase = 'Times New Roman';
                    else if (fontRaw.includes('Courier')) fontBase = 'Courier New';
                    else if (fontRaw.includes('Arial')) fontBase = 'Arial';
                    document.getElementById('pagenum-font').value = fontBase;
                    document.getElementById('pagenum-size').value = editObj.size || 12;
                    document.getElementById('pagenum-color').value = editObj.color || '#000000';
                    const isBold = fontRaw.includes('Bold');
                    const isItalic = fontRaw.includes('Italic') || fontRaw.includes('Oblique');
                    const btnBold = document.getElementById('pagenum-bold');
                    const btnItalic = document.getElementById('pagenum-italic');
                    if (isBold) btnBold.classList.add('active'); else btnBold.classList.remove('active');
                    if (isItalic) btnItalic.classList.add('active'); else btnItalic.classList.remove('active');
                    if (editObj.bgColor) {
                        document.getElementById('pagenum-has-bg').checked = true;
                        document.getElementById('pagenum-bg-color').value = this._toHexColor(editObj.bgColor, '#ffffff');
                        document.getElementById('pagenum-bg-alpha').value = editObj.bgAlpha || 1;
                    } else { document.getElementById('pagenum-has-bg').checked = false; }
                    if (editObj.borderColor) {
                        document.getElementById('pagenum-has-border').checked = true;
                        document.getElementById('pagenum-border-color').value = this._toHexColor(editObj.borderColor, '#000000');
                        document.getElementById('pagenum-border-width').value = editObj.borderWidth || 1;
                        document.getElementById('pagenum-border-radius').value = editObj.borderRadius || 0;
                    } else { document.getElementById('pagenum-has-border').checked = false; }
                }
            },

            /**
             * Show unified save modal
             */
            showSaveModal: function () {
                const doc = this.getDoc();
                if (!doc) {
                    this.showToast('No hay documento abierto');
                    return;
                }
                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                document.getElementById('save-modal').style.display = 'block';
                document.getElementById('drop-modal-content').style.display = 'none';

                this.clearSaveTarget();

                // Reset options
                document.getElementById('compress-none').checked = true;
                document.getElementById('save-use-password').checked = false;
                document.getElementById('password-options').style.display = 'none';
                document.getElementById('pdf-user-password').value = '';
                document.getElementById('pdf-owner-password').value = '';
                const _sdd = document.getElementById('save-share-dropdown'); if (_sdd) _sdd.style.display = 'none';
            },

            clearSaveTarget: function () {
                this._pendingNativeSaveTarget = null;
                const field = document.getElementById('save-target-path');
                const help = document.getElementById('save-target-help');
                if (field) field.value = '';
                if (help) help.textContent = 'Elige una ubicación antes de guardar.';
            },

            _showNativeSaveError: function (error, fallbackPrefix = 'Error al guardar') {
                if (error?.message === 'SAVE_OUTPUT_UNVERIFIED') {
                    this.showToast('El archivo se escribió, pero no se pudo verificar. Conserva esta pestaña abierta y revisa el PDF antes de cerrarla.', 7000, 'warning');
                    return;
                }
                const code = error?.message || 'error desconocido';
                if (code === 'SIGNATURE_INVALIDATION_REQUIRED') {
                    this.showToast(
                        'No se guardó el PDF porque contiene una firma digital. Editarlo invalidaría la firma.',
                        5000,
                        'warning'
                    );
                    return;
                }
                if (code === 'PROTECTION_REQUIRED') {
                    this.showToast(
                        'No se guardó el PDF porque su protección no puede conservarse de forma segura.',
                        5000,
                        'warning'
                    );
                    return;
                }
                if (code === 'SOURCE_PDF_UNAVAILABLE') {
                    this.showToast('No se guardó porque una página original ya no está disponible. Reabre el PDF e inténtalo de nuevo.', 5000, 'warning');
                    return;
                }
                if (code.startsWith('COMPRESSION_')) {
                    this.showToast('No se sustituyó el archivo porque falló la compresión.', 5000, 'warning');
                    return;
                }
                if (code === 'TARGET_ALREADY_OPEN') {
                    this.showToast('Ese archivo ya está abierto. En la ventana de Windows elige otro nombre o ubicación para la copia.', 5000, 'warning');
                    return;
                }
                console.error('[Guardado] Detalle:', error);
                this.showToast(fallbackPrefix + '. Inténtalo de nuevo.', 3000, 'error');
            },

            saveFromHeader: async function (mode, button) {
                const doc = this.getDoc();
                if (!doc) {
                    this.showToast('No hay documento abierto');
                    return;
                }
                const isCopy = mode === 'copy';
                const baseName = (doc.name || 'documento.pdf').replace(/\.pdf$/i, '');
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                }
                try {
                    let target = !isCopy && this._nativeSaveTargets instanceof Map
                        ? this._nativeSaveTargets.get(doc.id)
                        : null;
                    if (!target?.token) {
                        const selected = await this.pickSaveTarget(
                            baseName + '.pdf',
                            isCopy ? 'copy' : 'save'
                        );
                        target = this._pendingNativeSaveTarget;
                        if (!selected || !target?.token) return;
                    }
                    const options = {
                        token: target.token,
                        targetIdentity: target.identity || null,
                        expectedFingerprint: target.fingerprint || null
                    };
                    if (isCopy) await this.saveCopyDocument(doc.id, options);
                    else await this.saveDocument(doc.id, options);
                    this.clearSaveTarget();
                    this.showToast('PDF guardado correctamente.', 3000, 'success');
                } catch (error) {
                    this._showNativeSaveError(error);
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    }
                }
            },

            pickSaveTarget: async function (suggestedName, mode = 'save') {
                const currentName = this.getDoc()?.name || 'documento.pdf';
                const filename = suggestedName || (/\.pdf$/i.test(currentName) ? currentName : currentName + '.pdf');
                const help = document.getElementById('save-target-help');
                const button = document.getElementById('btn-pick-save-target');
                try {
                    if (button?.disabled) return false;
                    if (button) {
                        button.disabled = true;
                        button.setAttribute('aria-busy', 'true');
                    }
                    if (help) help.textContent = 'Abriendo selector de archivos...';
                    const response = await fetch('/api/files/pick-save', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Alioth-Client-Id': window.__aliothWindowId || ''
                        },
                        body: JSON.stringify({ suggested_name: filename, mode: mode === 'copy' ? 'copy' : 'save-as',
                            source_path: this.getDoc()?.originalPath || this.getDoc()?.filePath || null })
                    });
                    const result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || 'SAVE_TARGET_UNAVAILABLE');
                    if (result.cancelled) {
                        if (help) help.textContent = 'No se cambió la ubicación de guardado.';
                        return false;
                    }
                    this._pendingNativeSaveTarget = {
                        token: result.token,
                        identity: result.identity || null,
                        fingerprint: result.fingerprint || null,
                        expiresAt: result.expires_at,
                        mode
                    };
                    const field = document.getElementById('save-target-path');
                    if (field) field.value = filename;
                    if (help) help.textContent = 'Ubicación seleccionada. Pulsa Guardar para escribir el PDF.';
                    return true;
                } catch (error) {
                    if (help) help.textContent = 'No se pudo abrir el selector. Inténtalo de nuevo.';
                    this.showToast('No se pudo seleccionar la ubicación de guardado');
                    return false;
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    }
                }
            },

            /**
             * Save PDF from unified modal (with or without password)
             */
            
            sharePDF: async function () {
                const doc = this.getDoc();
                if (!doc) {
                    this.showToast('No hay documento abierto');
                    return;
                }

                const filename = (doc.name || 'documento.pdf').replace(/\.pdf$/i, '');
                const compressLevel = document.querySelector('input[name="compress-level"]:checked')?.value || 'standard';
                const compress = compressLevel !== 'none';
                const usePassword = document.getElementById('save-use-password').checked;
                const userPassword = document.getElementById('pdf-user-password').value;
                const ownerPassword = document.getElementById('pdf-owner-password').value || userPassword;
                const saveAsImages = document.getElementById('save-as-images')?.checked || false;
                const lockEdit  = document.getElementById('save-lock-edit')?.checked || false;
                const lockCopy  = document.getElementById('save-lock-copy')?.checked || false;
                const lockPrint = document.getElementById('save-lock-print')?.checked || false;
                const hasLocks  = lockEdit || lockCopy || lockPrint;

                if (usePassword && !userPassword) {
                    this.showToast('Ingresa una contraseña');
                    return;
                }

                this.closeAllModals();
                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Generando PDF para compartir...";

                try {
                    let pdfBytes = null;

                    if (saveAsImages) {
                        document.getElementById('loader-msg').innerText = "Rasterizando páginas...";
                        const srcBytes = await this.savePDFInternal(false, null, false, true);
                        if (!srcBytes) throw new Error('No se pudo generar el PDF base');
                        const srcDoc = await pdfjsLib.getDocument({ data: srcBytes }).promise;
                        const pageCount = srcDoc.numPages;
                        const newPdf = await PDFLib.PDFDocument.create();
                        const scale = compress ? 1.5 : 2;
                        for (let i = 1; i <= pageCount; i++) {
                            const pdfPage = await srcDoc.getPage(i);
                            const vp = pdfPage.getViewport({ scale });
                            const cvs = document.createElement('canvas');
                            cvs.width = vp.width; cvs.height = vp.height;
                            await pdfPage.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
                            const quality = compress ? 0.8 : 0.95;
                            const imgDataUrl = cvs.toDataURL('image/jpeg', quality);
                            const imgBytes = Uint8Array.from(atob(imgDataUrl.split(',')[1]), c => c.charCodeAt(0));
                            const embImg = await newPdf.embedJpg(imgBytes);
                            const { width, height } = pdfPage.getViewport({ scale: 1 });
                            const newPage = newPdf.addPage([width, height]);
                            newPage.drawImage(embImg, { x: 0, y: 0, width, height });
                        }
                        pdfBytes = await newPdf.save();
                    }

                    if (usePassword || hasLocks) {
                        if (!pdfBytes) pdfBytes = await this.savePDFInternal(false, null, compress, true, compressLevel);
                        if (!pdfBytes) throw new Error('No se pudo generar el PDF');
                        const effectiveUser  = usePassword ? userPassword : '';
                        const effectiveOwner = ownerPassword || ('alioth-owner-' + Date.now());
                        const perms = [];
                        if (!lockPrint) perms.push('print');
                        if (!lockEdit)  perms.push('modify', 'annotate');
                        if (!lockCopy)  perms.push('copy');
                        if (!usePassword) { perms.push('print', 'modify', 'annotate', 'copy'); }
                        const uniquePerms = [...new Set(perms)];
                        if (hasLocks) {
                            const filteredPerms = uniquePerms.filter(p => {
                                if (lockPrint && p === 'print') return false;
                                if (lockEdit  && (p === 'modify' || p === 'annotate')) return false;
                                if (lockCopy  && p === 'copy') return false;
                                return true;
                            });
                            if (window.PythonManager) {
                                pdfBytes = await PythonManager.encryptPDF(pdfBytes, effectiveUser, effectiveOwner, filteredPerms);
                            }
                        }
                    } else if (!pdfBytes) {
                        pdfBytes = await this.savePDFInternal(false, null, compress, true, compressLevel);
                    }

                    if (!pdfBytes) throw new Error('No se pudo compilar el archivo PDF.');

                    const fn = filename + '.pdf';
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const file = new File([blob], fn, { type: 'application/pdf' });

                    // Si el sistema soporta Web Share con archivos (Windows 10/11), abre directamente el menú nativo con el archivo adjunto
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        try {
                            this.toggleLoader(false);
                            await navigator.share({
                                files: [file],
                                title: fn,
                                text: fn
                            });
                            this.showToast('✓ Compartido');
                            return;
                        } catch (e) {
                            if (e.name === 'AbortError') return;
                            console.warn('WebShare cancelado o no disponible:', e);
                        }
                    }

                    // Fallback para navegadores antiguos que no soportan Web Share de archivos:
                    const dlUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = dlUrl;
                    a.download = fn;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(dlUrl); }, 1500);

                    const subject = encodeURIComponent(fn);
                    const body = encodeURIComponent("Hola,\n\nTe comparto el documento adjunto \"" + fn + "\" generado con Alioth PDF Editor.\n\nSaludos.");
                    window.open('mailto:?subject=' + subject + '&body=' + body, '_self');
                    this.showToast('📧 Abriendo cliente de correo...');
                } catch (error) {
                    console.error('Error sharing PDF:', error);
                    this.showToast('Error al compartir: ' + error.message);
                } finally {
                    this.toggleLoader(false);
                }
            },

            saveNativeFromModal: async function () {
                const doc = this.getDoc();
                if (!doc) return;
                if (!this._pendingNativeSaveTarget?.token || (this._pendingNativeSaveTarget.mode && this._pendingNativeSaveTarget.mode !== 'save')) {
                    this.clearSaveTarget();
                    await this.pickSaveTarget();
                    return;
                }
                const compressLevel = document.querySelector('input[name="compress-level"]:checked')?.value || 'none';
                const usePassword = document.getElementById('save-use-password')?.checked;
                const saveAsImages = document.getElementById('save-as-images')?.checked;
                const hasLocks = ['save-lock-edit', 'save-lock-copy', 'save-lock-print']
                    .some(id => document.getElementById(id)?.checked);
                if (usePassword || saveAsImages || hasLocks) {
                    this.showToast('El guardado nativo no admite protección ni rasterización. Ajusta las opciones para continuar.');
                    return;
                }

                const button = document.getElementById('btn-save-modal-primary');
                const help = document.getElementById('save-target-help');
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                }
                if (help) help.textContent = 'Guardando PDF...';
                try {
                    await this.saveDocument(doc.id, {
                        token: this._pendingNativeSaveTarget.token,
                        targetIdentity: this._pendingNativeSaveTarget.identity,
                        expectedFingerprint: this._pendingNativeSaveTarget.fingerprint || null,
                        compression: compressLevel,
                        protection: 'preserve'
                    });
                    this.clearSaveTarget();
                    this.closeAllModals();
                    this.showToast('PDF guardado correctamente.');
                } catch (error) {
                    if (help) help.textContent = 'No se pudo guardar. Corrige el problema e inténtalo de nuevo.';
                    this._showNativeSaveError(error);
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    }
                }
            },

            saveCopyFromModal: async function () {
                const doc = this.getDoc();
                if (!doc) return;
                const compressLevel = document.querySelector('input[name="compress-level"]:checked')?.value || 'none';
                const usePassword = document.getElementById('save-use-password')?.checked;
                const saveAsImages = document.getElementById('save-as-images')?.checked;
                const hasLocks = ['save-lock-edit', 'save-lock-copy', 'save-lock-print']
                    .some(id => document.getElementById(id)?.checked);
                if (usePassword || saveAsImages || hasLocks) {
                    this.showToast('El guardado nativo no admite protección ni rasterización. Ajusta las opciones para continuar.');
                    return;
                }
                const button = document.getElementById('btn-save-modal-copy');
                if (button?.disabled) return;
                if (button) {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                }
                try {
                    if (!this._pendingNativeSaveTarget?.token || this._pendingNativeSaveTarget.mode !== 'copy') {
                        this.clearSaveTarget();
                        const baseName = (doc.name || 'documento.pdf').replace(/\.pdf$/i, '');
                        const selected = await this.pickSaveTarget(baseName + '.pdf', 'copy');
                        if (!selected || !this._pendingNativeSaveTarget?.token) return;
                    }
                    const targetIdentity = this._pendingNativeSaveTarget.identity || null;
                    const overwriteOriginal = targetIdentity &&
                        this.ensureDocumentState(doc).binding?.identity === targetIdentity;
                    const anotherOpenDocumentUsesTarget = targetIdentity && (this.docs || []).some(candidate =>
                        candidate.id !== doc.id && this.ensureDocumentState(candidate).binding?.identity === targetIdentity
                    );
                    if (anotherOpenDocumentUsesTarget) {
                        this.clearSaveTarget();
                        this.showToast('Ese archivo ya está abierto. En la ventana de Windows elige otro nombre o ubicación para la copia.', 5000, 'warning');
                        return;
                    }
                    const saveOptions = {
                        token: this._pendingNativeSaveTarget.token,
                        targetIdentity,
                        expectedFingerprint: this._pendingNativeSaveTarget.fingerprint || null,
                        compression: compressLevel,
                        protection: 'preserve'
                    };
                    if (overwriteOriginal) {
                        await this.saveDocument(doc.id, saveOptions);
                    } else {
                        await this.saveCopyDocument(doc.id, saveOptions);
                    }
                    this.clearSaveTarget();
                    this.closeAllModals();
                    this.showToast(overwriteOriginal ? 'PDF original sobrescrito correctamente.' : 'PDF guardado correctamente.', 3000, 'success');
                } catch (error) {
                    this._showNativeSaveError(error, 'Error al guardar la copia');
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    }
                }
            },

            saveFromModal: async function () {
                if (this.nativeSaveTransport && window.__aliothWindowId && /^https?:$/.test(window.location.protocol)) {
                    return this.saveNativeFromModal();
                }
                const doc = this.getDoc();
                if (!doc) return;

                const filename = (doc.name || 'documento.pdf').replace(/\.pdf$/i, '');
                const compressLevel = document.querySelector('input[name="compress-level"]:checked')?.value || 'standard';
                const compress = compressLevel !== 'none';
                const usePassword = document.getElementById('save-use-password').checked;
                const userPassword = document.getElementById('pdf-user-password').value;
                const ownerPassword = document.getElementById('pdf-owner-password').value || userPassword;
                const saveAsImages = document.getElementById('save-as-images')?.checked || false;
                const lockEdit  = document.getElementById('save-lock-edit')?.checked || false;
                const lockCopy  = document.getElementById('save-lock-copy')?.checked || false;
                const lockPrint = document.getElementById('save-lock-print')?.checked || false;
                const hasLocks  = lockEdit || lockCopy || lockPrint;

                // Validate password if using protection
                if (usePassword && !userPassword) {
                    this.showToast('Ingresa una contraseña');
                    return;
                }

                this.closeAllModals();
                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Generando PDF...";

                try {
                    let pdfBytes = null;

                    if (saveAsImages) {
                        // Rasterize each page as JPEG image inside a new PDF
                        document.getElementById('loader-msg').innerText = "Rasterizando páginas como imágenes...";
                        const srcBytes = await this.savePDFInternal(false, null, false, true);
                        if (!srcBytes) throw new Error('No se pudo generar el PDF base');
                        const srcDoc = await pdfjsLib.getDocument({ data: srcBytes }).promise;
                        const pageCount = srcDoc.numPages;
                        const newPdf = await PDFLib.PDFDocument.create();
                        const scale = compress ? 1.5 : 2;
                        for (let i = 1; i <= pageCount; i++) {
                            document.getElementById('loader-msg').innerText = `Rasterizando página ${i}/${pageCount}...`;
                            const pdfPage = await srcDoc.getPage(i);
                            const vp = pdfPage.getViewport({ scale });
                            const cvs = document.createElement('canvas');
                            cvs.width = vp.width; cvs.height = vp.height;
                            await pdfPage.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
                            const quality = compress ? 0.8 : 0.95;
                            const imgDataUrl = cvs.toDataURL('image/jpeg', quality);
                            const imgBytes = Uint8Array.from(atob(imgDataUrl.split(',')[1]), c => c.charCodeAt(0));
                            const embImg = await newPdf.embedJpg(imgBytes);
                            const { width, height } = pdfPage.getViewport({ scale: 1 });
                            const newPage = newPdf.addPage([width, height]);
                            newPage.drawImage(embImg, { x: 0, y: 0, width, height });
                        }
                        pdfBytes = await newPdf.save();
                    }

                    if (usePassword || hasLocks) {
                        // Apply encryption / permissions
                        if (!pdfBytes) pdfBytes = await this.savePDFInternal(false, null, compress, true, compressLevel);
                        if (!pdfBytes) throw new Error('No se pudo generar el PDF');

                        const effectiveUser  = usePassword ? userPassword : '';
                        const effectiveOwner = ownerPassword || ('alioth-owner-' + Date.now());

                        // Build permissions array (what IS allowed)
                        const perms = [];
                        if (!lockPrint) perms.push('print');
                        if (!lockEdit)  perms.push('modify', 'annotate');
                        if (!lockCopy)  perms.push('copy');
                        if (!usePassword) { perms.push('print', 'modify', 'annotate', 'copy'); }
                        // deduplicate
                        const uniquePerms = [...new Set(perms)];
                        if (hasLocks) {
                            const filteredPerms = uniquePerms.filter(p => {
                                if (lockPrint && p === 'print') return false;
                                if (lockEdit  && (p === 'modify' || p === 'annotate')) return false;
                                if (lockCopy  && p === 'copy') return false;
                                return true;
                            });
                            document.getElementById('loader-msg').innerText = "Aplicando restricciones de seguridad...";
                            if (window.PythonManager) {
                                pdfBytes = await PythonManager.encryptPDF(pdfBytes, effectiveUser, effectiveOwner, filteredPerms);
                            }
                        } else {
                            await this.saveWithEncryption(filename, effectiveUser, effectiveOwner, compress, compressLevel, pdfBytes);
                            return;
                        }

                        const fn = filename + '.pdf';
                        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
                        this.showToast('✅ PDF guardado con restricciones');
                    } else if (saveAsImages) {
                        const fn = filename + '.pdf';
                        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
                        this.showToast('✅ PDF guardado como imágenes');
                    } else {
                        await this.savePDFInternal(false, filename, compress, false, compressLevel);
                    }
                } catch (error) {
                    console.error('Error saving PDF:', error);
                    this.showToast('Error al guardar: ' + error.message);
                } finally {
                    this.toggleLoader(false);
                }
            },

            /**
             * Save PDF with encryption (password protection)
             */
            // showPageNumModal: merged into first definition above

            pageNumPos: 'bc', // default bottom-center

            setPageNumPos: function (pos) {
                this.pageNumPos = pos;
                // Update UI buttons
                document.querySelectorAll('.pos-btn').forEach(btn => {
                    if (btn.id === 'pos-' + pos) {
                        btn.style.background = 'var(--accent)';
                        btn.style.color = 'white';
                    } else {
                        btn.style.background = 'transparent';
                        btn.style.color = 'var(--text-main)';
                    }
                });
            },

            applyPageNumbering: async function () {
                const doc = this.getDoc();
                if (!doc) return;
                this.saveState();

                // Show loader because this might take a moment to load page dimensions
                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Aplicando numeración...";

                try {
                    const opt = document.querySelector('input[name="pagenum-opt"]:checked')?.value || 'all';
                    const startPageVal = this._currentPnTab === 'bates'
                        ? (parseInt(document.getElementById('bates-start-page')?.value) || 1)
                        : (parseInt(document.getElementById('pagenum-start-page').value) || 1);
                    const format = document.getElementById('pagenum-format').value;

                    // Styling
                    let fontVal = document.getElementById('pagenum-font').value;
                    let fontSize = parseInt(document.getElementById('pagenum-size').value) || 12;
                    let color = document.getElementById('pagenum-color').value || '#000000';

                    // Override con valores Bates si aplica
                    if (this._currentPnTab === 'bates') {
                        fontVal  = document.getElementById('bates-font')?.value  || fontVal;
                        fontSize = parseInt(document.getElementById('bates-size')?.value)  || fontSize;
                        color    = document.getElementById('bates-color')?.value || color;
                    }

                    const isBold = document.getElementById('pagenum-bold').classList.contains('active');
                    const isItalic = document.getElementById('pagenum-italic').classList.contains('active');

                    // Transparency
                    const textAlpha = document.getElementById('pagenum-alpha') ? document.getElementById('pagenum-alpha').value : 1;

                    // Map to Standard PDF Fonts
                    let pdfFontBase = 'Helvetica'; // Default for Arial too
                    if (fontVal === 'Times New Roman') pdfFontBase = 'Times-Roman';
                    else if (fontVal === 'Courier New') pdfFontBase = 'Courier';
                    else if (fontVal === 'Helvetica') pdfFontBase = 'Helvetica';
                    else if (fontVal === 'Arial') pdfFontBase = 'Helvetica';

                    let fontName = pdfFontBase;
                    if (isBold && isItalic) {
                        if (pdfFontBase === 'Times-Roman') fontName = 'Times-BoldItalic';
                        else if (pdfFontBase === 'Courier') fontName = 'Courier-BoldOblique';
                        else fontName = 'Helvetica-BoldOblique';
                    }
                    else if (isBold) {
                        if (pdfFontBase === 'Times-Roman') fontName = 'Times-Bold';
                        else if (pdfFontBase === 'Courier') fontName = 'Courier-Bold';
                        else fontName = 'Helvetica-Bold';
                    }
                    else if (isItalic) {
                        if (pdfFontBase === 'Times-Roman') fontName = 'Times-Italic';
                        else if (pdfFontBase === 'Courier') fontName = 'Courier-Oblique';
                        else fontName = 'Helvetica-Oblique';
                    }

                    // Background & Border
                    const hasBg = document.getElementById('pagenum-has-bg').checked;
                    const bgColor = document.getElementById('pagenum-bg-color').value;
                    const bgAlpha = parseFloat(document.getElementById('pagenum-bg-alpha').value);

                    const hasBorder = document.getElementById('pagenum-has-border').checked;
                    const borderColor = document.getElementById('pagenum-border-color').value;
                    const borderWidth = parseInt(document.getElementById('pagenum-border-width').value) || 1;
                    const borderRadius = parseInt(document.getElementById('pagenum-border-radius').value) || 0;

                    // Cleanup existing page numbers
                    doc.pages.forEach(p => {
                        if (p.objects) {
                            p.objects = p.objects.filter(o => !o.isPageNum);
                        }
                    });

                    let startIdx = 0;
                    let pageNumberCounter = 1;

                    if (opt === 'current') {
                        startIdx = doc.currentIndex;
                    }

                    const totalPages = doc.pages.length;
                    const startPageIdx = startPageVal - 1; // Convert to 0-based

                    for (let i = startIdx; i < totalPages; i++) {
                        // Skip if current page index is less than where we want to start
                        if (i < startPageIdx) continue;

                        const p = doc.pages[i];

                        // CRITICAL: Ensure we have page dimensions
                        // Page dimensions might not be set if we haven't rendered/saved yet.
                        let w = p.width;
                        let h = p.height;

                        if (!w || !h) {
                            // Try to fetch from source
                            try {
                                const src = doc.sources[p.sourceId];
                            const _srcPassword = src.password || null;
                            const _pdfLibLoadOpts = _srcPassword ? { password: _srcPassword } : { ignoreEncryption: true };
                                if (src) {
                                    if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                                    const pg = await src.doc.getPage(p.pageIndex + 1);
                                    const rot = (p.rotation + pg.rotate) % 360;
                                    const vp = pg.getViewport({ scale: 1, rotation: rot });
                                    w = vp.width;
                                    h = vp.height;
                                    // Cache it
                                    p.width = w;
                                    p.height = h;
                                }
                            } catch (e) {
                                console.error('Error getting page dims for numbering:', e);
                            }
                        }
                        // Fallback defaults if still missing
                        w = w || 612; // Standard Letter width approx
                        h = h || 792; // Standard Letter height approx

                        // Format text
                        let text;
                        if (this._currentPnTab === 'bates') {
                            text = this._batesBuildText(pageNumberCounter);
                        } else {
                            text = String(pageNumberCounter);
                            if (format === '- 1 -') text = `- ${pageNumberCounter} -`;
                            else if (format === 'Page 1') text = `Página ${pageNumberCounter}`;
                            else if (format === '1 of N') text = `${pageNumberCounter} de ${totalPages - startPageIdx}`;
                        }

                        // Calculate Position
                        const margin = 20;
                        const textHeight = fontSize * 1.5;
                        const estWidth = 200; // Fixed width container for alignment safety

                        let x = 0;
                        let y = 0;
                        let align = 'center';

                        // Y Logic (Top-down visual)
                        if (this.pageNumPos.startsWith('t')) {
                            y = margin;
                        } else {
                            y = h - margin - textHeight;
                        }

                        // X Logic
                        if (this.pageNumPos.endsWith('l')) {
                            x = margin;
                            align = 'left';
                        } else if (this.pageNumPos.endsWith('c')) {
                            x = (w - estWidth) / 2;
                            align = 'center';
                        } else { // right
                            x = w - margin - estWidth;
                            align = 'right';
                        }

                        const textObj = {
                            id: 'pgnum_' + Date.now() + '_' + i,
                            type: 'text',
                            x: x,
                            y: y,
                            width: estWidth,
                            height: textHeight,
                            text: text,
                            font: fontName,
                            size: fontSize,
                            color: color,
                            opacity: parseFloat(textAlpha), // Pass text opacity
                            rotation: 0, scaleX: 1, scaleY: 1,
                            isPageNum: true,
                            alignment: align,
                            pageHeight: h
                        };

                        // Apply styles
                        if (hasBg) {
                            textObj.bgColor = bgColor;
                            textObj.bgAlpha = bgAlpha;
                        }
                        if (hasBorder) {
                            textObj.borderColor = borderColor;
                            textObj.borderWidth = borderWidth;
                        }
                        if (borderRadius > 0) {
                            textObj.borderRadius = borderRadius;
                        }

                        p.objects.push(textObj);
                        pageNumberCounter++;
                    }

                    this.loadPage(doc.currentIndex);
                    this.renderSidebar();
                    this.closeAllModals();
                    this.showToast("Numeración aplicada correctamente");

                } catch (e) {
                    console.error("Error applying page numbers:", e);
                    alert("Error al aplicar numeración: " + e.message);
                } finally {
                    this.toggleLoader(false);
                }
            },

            handleSidebarDrop: function (files, insertionIndex = null, targetZone = 'primary') {
                this.clearDropFeedback?.();
                files = files.filter(file => /\.(?:pdf|docx?|docm|xlsx?|xlsm|pptx?|pptm)$/i.test(file.name) || file.type.startsWith('image/'));
                if (!files.length) return;
                files.forEach(file => {
                    file._aliothDropId ||= 'drop_' + Math.random().toString(36).slice(2);
                    this.resolveFileOriginPath?.(file);
                });
                const modal = document.getElementById('drop-modal-content');
                if (modal.style.display !== 'none' && this.pendingDropFiles?.length) {
                    this.pendingDropFiles.push(...files);
                    this.populateDropContainers(files, true, targetZone);
                    const button = document.getElementById('btn-drop-new');
                    if (button) button.textContent = 'Abrir en Pestañas Separadas';
                    return;
                }
                this.dropTargetIndex = insertionIndex;
                this.pendingDropFiles = files;
                // Mostrar modal de ordenamiento
                (function(){ const _mo=document.getElementById('modal-overlay');
                    _mo.style.display='flex';
                    _mo.classList.remove('anim-in'); void _mo.offsetWidth; _mo.classList.add('anim-in');
                    // Animate the visible glass-box
                    setTimeout(()=>{ const _vis=document.querySelector('.glass-box[style*="block"],.glass-box[style*="flex"]');
                        if(_vis){_vis.classList.remove('anim-in'); void _vis.offsetWidth; _vis.classList.add('anim-in');}
                    },0);
                })();
                modal.style.display = 'block';
                document.getElementById('qr-result-modal').style.display = 'none';

                // Reset to simple view mode
                this.switchDropMode('simple');

                // Update "Abrir Nuevo" button label based on file count
                const btnNew = document.getElementById('btn-drop-new');
                if (btnNew) {
                    btnNew.textContent = files.length > 1 ? 'Abrir en Pestañas Separadas' : 'Abrir Nuevo';
                }

                // Populate both views
                this.populateDropContainers(files);
            },

            switchDropMode: function (mode) {
                const simpleView = document.getElementById('drop-simple-view');
                const parallelView = document.getElementById('drop-parallel-view');
                const tabs = document.querySelectorAll('.mode-tab');

                tabs.forEach(tab => {
                    if (tab.dataset.mode === mode) {
                        tab.classList.add('active');
                        tab.style.background = 'rgba(255,255,255,0.9)';
                        tab.style.color = '#111';
                        tab.style.fontWeight = '600';
                    } else {
                        tab.classList.remove('active');
                        tab.style.background = 'rgba(255,255,255,0.12)';
                        tab.style.color = '#f0f4ff';
                        tab.style.fontWeight = '';
                    }
                });

                if (mode === 'simple') {
                    simpleView.style.display = 'block';
                    parallelView.style.display = 'none';
                    document.getElementById('btn-drop-new')?.style.removeProperty('display');
                    document.getElementById('btn-drop-insert')?.style.removeProperty('display');
                    document.getElementById('btn-open-parallel')?.style.removeProperty('display');
                } else {
                    simpleView.style.display = 'none';
                    parallelView.style.display = 'block';
                    document.getElementById('btn-drop-new')?.style.setProperty('display', 'none');
                    document.getElementById('btn-drop-insert')?.style.setProperty('display', 'none');
                    document.getElementById('btn-open-parallel')?.style.removeProperty('display');
                }

                this.currentDropMode = mode;
            },

            populateDropContainers: function (files, append = false, targetZone = 'primary') {
                const self = this;

                // Renders first page of PDF as thumbnail into a .sort-thumb div
                const renderPDFThumb = async (file, thumbDiv) => {
                    try {
                        const arrayBuffer = await file.arrayBuffer();
                        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                        const page = await pdf.getPage(1);
                        const viewport = page.getViewport({ scale: 0.4 });
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                        thumbDiv.innerHTML = '';
                        thumbDiv.appendChild(canvas);
                    } catch(e) {
                        // keep placeholder on error
                    }
                };

                const createSortItem = (file, index, parentContainer) => {
                    const d = document.createElement('div');
                    d.className = 'sort-item';
                    d.draggable = true;
                    d.dataset.filename = file.name;
                    d.dataset.fileId = file._aliothDropId;
                    // Tooltip con nombre completo (punto 2)
                    d.title = file.name;

                    const isPDF   = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                    const isImage = file.type.startsWith('image/');
                    const ext = file.name.split('.').pop().toLowerCase();
                    const officeIcon = { docx:'W', doc:'W', xlsx:'X', xls:'X', pptx:'P', ppt:'P' }[ext];
                    const officeColor = { docx:'#2B579A', doc:'#2B579A', xlsx:'#217346', xls:'#217346', pptx:'#D24726', ppt:'#D24726' }[ext];
                    let placeholder;
                    if (isPDF) placeholder = '📄';
                    else if (isImage) placeholder = '🖼️';
                    else if (officeIcon) placeholder = `<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;background:${officeColor};color:#fff;font-weight:700;font-size:16px;font-family:Arial,sans-serif;">${officeIcon}</span>`;
                    else placeholder = '📁';

                    d.innerHTML = `
                        <div class="delete-btn-mini" onclick="event.stopPropagation();this.parentElement.remove()">✕</div>
                        <div class="sort-thumb"><span class="sort-thumb-placeholder">${placeholder}</span></div>
                        <div class="sort-name">${file.name}</div>
                        <div class="sort-idx">${index + 1}</div>
                    `;

                    // Render thumbnail (punto 1)
                    const thumbDiv = d.querySelector('.sort-thumb');
                    if (isPDF) {
                        renderPDFThumb(file, thumbDiv);
                    } else if (isImage) {
                        const img = document.createElement('img');
                        img.src = URL.createObjectURL(file);
                        img.onload = () => { thumbDiv.innerHTML = ''; thumbDiv.appendChild(img); };
                    }

                    // Drag & drop nativo HTML5 — reordenamiento correcto
                    d.addEventListener('dragstart', (e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', file.name);
                        self._sortDragSrc = d;
                        self.isDraggingInternal = true; // Evita que body.ondragover muestre el overlay
                        // Retardo para que el navegador capture el snapshot antes de ocultar
                        setTimeout(() => d.classList.add('dragging'), 0);
                    });

                    d.addEventListener('dragend', () => {
                        d.classList.remove('dragging');
                        self._sortDragSrc = null;
                        self.isDraggingInternal = false;
                        // Ocultar overlay por si acaso quedó visible
                        const ov = document.getElementById('drop-overlay');
                        if (ov) ov.style.display = 'none';
                        // Limpiar indicadores visuales en todos los contenedores
                        document.querySelectorAll('.sort-item').forEach(s => {
                            s.classList.remove('drag-over', 'drag-over-after');
                        });
                        // Renumerar en el contenedor actual
                        parentContainer.querySelectorAll('.sort-item').forEach((item, idx) => {
                            item.querySelector('.sort-idx').innerText = idx + 1;
                        });
                    });

                    d.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const src = self._sortDragSrc;
                        if (!src || src === d) return;
                        // Limpiar indicadores previos dentro del mismo contenedor
                        const container = d.parentElement;
                        container.querySelectorAll('.sort-item').forEach(s => {
                            s.classList.remove('drag-over', 'drag-over-after');
                        });
                        // Determinar si insertar antes o después según posición X del cursor
                        const rect = d.getBoundingClientRect();
                        const midX = rect.left + rect.width / 2;
                        if (e.clientX < midX) {
                            d.classList.add('drag-over');
                        } else {
                            d.classList.add('drag-over-after');
                        }
                    });

                    d.addEventListener('dragleave', () => {
                        d.classList.remove('drag-over', 'drag-over-after');
                    });

                    d.addEventListener('drop', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const src = self._sortDragSrc;
                        if (!src || src === d) return;
                        const container = d.parentElement;
                        const rect = d.getBoundingClientRect();
                        const midX = rect.left + rect.width / 2;
                        if (e.clientX < midX) {
                            container.insertBefore(src, d);
                        } else {
                            container.insertBefore(src, d.nextSibling);
                        }
                        d.classList.remove('drag-over', 'drag-over-after');
                        // Renumerar
                        container.querySelectorAll('.sort-item').forEach((item, idx) => {
                            item.querySelector('.sort-idx').innerText = idx + 1;
                        });
                    });

                    return d;
                };

                // Populate simple view (all files in one container)
                const simpleContainer = document.getElementById('drop-sort-container');
                if (!append) simpleContainer.innerHTML = '';
                const simpleOffset = simpleContainer.children.length;
                files.forEach((f, i) => {
                    simpleContainer.appendChild(createSortItem(f, simpleOffset + i, simpleContainer));
                });

                // Populate parallel view (split files: first half to primary, second half to secondary)
                const primaryContainer = document.getElementById('drop-sort-primary');
                const secondaryContainer = document.getElementById('drop-sort-secondary');
                if (!append) {
                    primaryContainer.innerHTML = '';
                    secondaryContainer.innerHTML = '';
                }

                // Put all files in primary by default
                const targetContainer = targetZone === 'secondary' ? secondaryContainer : primaryContainer;
                const offset = targetContainer.children.length;
                files.forEach((f, i) => {
                    targetContainer.appendChild(createSortItem(f, offset + i, targetContainer));
                });

                // Enable drag between zones
                const enableZoneDrop = (zone, container) => {
                    zone.ondragover = (e) => {
                        e.preventDefault();
                        zone.style.borderColor = '#8b5cf6';
                        zone.style.background = 'rgba(139, 92, 246, 0.1)';
                    };
                    zone.ondragleave = () => {
                        zone.style.borderColor = 'var(--border)';
                        zone.style.background = 'var(--bg-panel)';
                    };
                    zone.ondrop = (e) => {
                        e.preventDefault();
                        zone.style.borderColor = 'var(--border)';
                        zone.style.background = 'var(--bg-panel)';
                        const dragging = self._sortDragSrc || document.querySelector('.sort-item.dragging');
                        if (dragging) {
                            container.appendChild(dragging);
                            // Update index display
                            container.querySelectorAll('.sort-item').forEach((item, idx) => {
                                item.querySelector('.sort-idx').innerText = idx + 1;
                            });
                        }
                    };
                };

                enableZoneDrop(document.getElementById('drop-zone-primary'), primaryContainer);
                enableZoneDrop(document.getElementById('drop-zone-secondary'), secondaryContainer);
            },

            getFilesFromContainer: function (containerId) {
                const container = document.getElementById(containerId);
                const items = container.querySelectorAll('.sort-item');
                const files = [];
                items.forEach(item => {
                    const filename = item.dataset.filename || item.querySelector('.sort-name').innerText;
                    const file = this.pendingDropFiles.find(f => item.dataset.fileId ? f._aliothDropId === item.dataset.fileId : f.name === filename);
                    if (file) files.push(file);
                });
                return files;
            },

            _isOfficeExt: function (name) {
                return /\.(docx?|xlsx?|pptx?)$/i.test(name || '');
            },

            _toHexColor: function (color, fallback) {
                // Convert non-hex color values (transparent, none, rgb(), etc.) to a valid #rrggbb for <input type="color">
                if (!fallback) fallback = '#ffffff';
                if (!color || color === 'transparent' || color === 'none' || color === 'rgba(0,0,0,0)') return fallback;
                if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
                if (/^#[0-9a-fA-F]{3}$/.test(color)) {
                    // Expand 3-digit hex to 6-digit
                    return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
                }
                // Try parsing rgb(r,g,b) or rgba(r,g,b,a)
                const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (m) {
                    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
                }
                return fallback;
            },

            resolveSidebarDrop: async function (mode) {
                this.clearDropFeedback?.();
                // Handle legacy boolean parameter (true = 'new', false = 'insert')\
                if (mode === true) mode = 'new';
                if (mode === false) mode = 'insert';

                this.closeAllModals();

                if (mode === 'tabs') {
                    // Abrir cada archivo en su propia pestaña (doc) separado
                    const visualItems = document.querySelectorAll('#drop-sort-container .sort-item .sort-name');
                    let orderedFiles = [];
                    visualItems.forEach(el => {
                        const name = el.innerText;
                        const fileId = el.closest?.('.sort-item')?.dataset.fileId;
                        const file = this.pendingDropFiles.find(f => fileId ? f._aliothDropId === fileId : f.name === name);
                        if (file) orderedFiles.push(file);
                    });
                    if (orderedFiles.length === 0) orderedFiles = this.pendingDropFiles.slice();
                    if (orderedFiles.length === 0) return;

                    for (const file of orderedFiles) {
                        await this.openFile(file);
                    }
                    this.pendingDropFiles = [];
                    this.dropTargetIndex = null;
                    this.showToast('✅ ' + orderedFiles.length + ' archivos abiertos en pestañas separadas');
                    return;
                }

                if (mode === 'parallel') {
                    // Logic for side-by-side mode (separate documents)
                    const primaryFiles = this.getFilesFromContainer('drop-sort-primary');
                    const secondaryFiles = this.getFilesFromContainer('drop-sort-secondary');

                    if (primaryFiles.length === 0 && secondaryFiles.length === 0) {
                        this.showToast('No hay archivos para abrir');
                        return;
                    }

                    let primaryDocId = null;
                    let secondaryDocId = null;

                    // Open files for primary panel
                    if (primaryFiles.length > 0) {
                        await this.openFile(primaryFiles[0]);
                        for (let i = 1; i < primaryFiles.length; i++) await this.insertPDF(primaryFiles[i]);
                        primaryDocId = this.activeDocId;
                    }

                    // Open files for secondary panel
                    if (secondaryFiles.length > 0) {
                        await this.openFile(secondaryFiles[0]);
                        for (let i = 1; i < secondaryFiles.length; i++) await this.insertPDF(secondaryFiles[i]);
                        secondaryDocId = this.activeDocId;
                    }

                    if (primaryDocId) this.splitView.primary = { docId: primaryDocId, pageIndex: 0, scale: 1.0 };
                    if (secondaryDocId) this.splitView.secondary = { docId: secondaryDocId, pageIndex: 0, scale: 1.0 };

                    if (this.splitView.mode === 'single') {
                        const orientationRadio = document.querySelector('input[name="split-orientation"]:checked');
                        const orientation = orientationRadio ? orientationRadio.value : 'horizontal';
                        this.setSplitView(orientation);
                    }

                    if (primaryDocId) this.renderPanelContent('primary');
                    if (secondaryDocId) this.renderPanelContent('secondary');

                    if (primaryDocId) { this.activeDocId = primaryDocId; this.setActivePanel('primary'); }

                    this.updatePanelHeaders();
                    this.renderTabs();
                    this.renderSidebar();
                    this.showToast('Archivos abiertos en vista paralela');

                } else {
                    // ── MODO ESTÁNDAR (Abrir o Insertar) ──
                    const visualItems = document.querySelectorAll('#drop-sort-container .sort-item .sort-name');
                    let orderedFiles = [];
                    visualItems.forEach(el => {
                        const name = el.innerText;
                        const fileId = el.closest?.('.sort-item')?.dataset.fileId;
                        const file = this.pendingDropFiles.find(f => fileId ? f._aliothDropId === fileId : f.name === name);
                        if (file) orderedFiles.push(file);
                    });

                    if (orderedFiles.length === 0) return;

                    // 🐍 PRO-MERGE AUTOMÁTICO: Calidad estructural si hay varios archivos
                    if (orderedFiles.length > 1 && PythonManager.isLoaded) {
                        this.toggleLoader(true, 'Python: Combinando archivos (Estructural)...');
                        try {
                            const buffers = [];
                            const docNames = [];
                            for (const f of orderedFiles) {
                                // Soporte para conversión de Office en el batch merge
                                if (this._isOfficeExt(f.name)) {
                                    this.showToast('📄 Convirtiendo ' + f.name + '...');
                                    const type = f.name.match(/\.docx?$/i) ? 'word' : f.name.match(/\.xlsx?$/i) ? 'excel' : 'ppt';
                                    let pdfBlob;
                                    if (type === 'word') pdfBlob = await this._convertWordToPDF(f);
                                    else if (type === 'excel') pdfBlob = await this._convertExcelToPDF(f);
                                    else pdfBlob = await this._convertPptToPDF(f);

                                    if (pdfBlob) {
                                        buffers.push(await pdfBlob.arrayBuffer());
                                        docNames.push(f.name);
                                    }
                                } else if (f.type.startsWith('image/')) {
                                    // Convertir imagen a PDF de una página antes del merge
                                    try {
                                        const imgBuffer = await f.arrayBuffer();
                                        const imgPdfDoc = await PDFLib.PDFDocument.create();
                                        let embeddedImg;
                                        if (f.type === 'image/jpeg') embeddedImg = await imgPdfDoc.embedJpg(imgBuffer);
                                        else if (f.type === 'image/png') embeddedImg = await imgPdfDoc.embedPng(imgBuffer);
                                        else { console.warn('Imagen no soportada para merge:', f.type); continue; }
                                        const imgPage = imgPdfDoc.addPage([embeddedImg.width, embeddedImg.height]);
                                        imgPage.drawImage(embeddedImg, { x: 0, y: 0, width: embeddedImg.width, height: embeddedImg.height });
                                        buffers.push((await imgPdfDoc.save()).buffer);
                                        docNames.push(f.name);
                                    } catch (imgErr) {
                                        console.warn('Error convirtiendo imagen para merge:', imgErr);
                                    }
                                } else {
                                    buffers.push(await f.arrayBuffer());
                                    docNames.push(f.name || ('Documento ' + (docNames.length + 1)));
                                }
                            }

                            if (buffers.length > 1) {
                                const mergedBuffer = await PythonManager.mergePDFs(buffers, docNames);
                                const mergedFile = new File([new Blob([mergedBuffer], { type: 'application/pdf' })], "combinado_python.pdf", { type: 'application/pdf' });
                                const origin = await this.resolveFileOriginPath?.(orderedFiles[0]);
                                if (/\.pdf$/i.test(origin || '')) mergedFile._aliothSourcePath = origin;
                                else mergedFile._aliothOriginalPath = origin;
                                orderedFiles = [mergedFile];
                                this.showToast('✅ Fusión estructural con marcadores completada');
                            }
                        } catch (e) {
                            console.warn('Python Merge failed:', e);
                        }
                        this.toggleLoader(false);
                    }

                    if (mode === 'new') {
                        await this.openFile(orderedFiles[0]);
                        for (let i = 1; i < orderedFiles.length; i++) await this.insertPDF(orderedFiles[i]);
                    } else if (mode === 'secondary') {
                        const existingDocId = this.activeDocId;
                        const existingDoc = this.getDoc();
                        const hasExt = existingDoc && existingDoc.pages && existingDoc.pages.length > 0;

                        await this.openFile(orderedFiles[0]);
                        for (let i = 1; i < orderedFiles.length; i++) await this.insertPDF(orderedFiles[i]);
                        const newDocId = this.activeDocId;

                        if (hasExt) {
                            this.splitView.primary = { docId: existingDocId, pageIndex: existingDoc.currentIndex || 0, scale: existingDoc.scale || 1.0 };
                            this.renderPanelContent('primary');
                            this.openDocumentInPanel(newDocId, 'secondary');
                        } else {
                            this.openDocumentInPanel(newDocId, 'secondary');
                        }
                    } else {
                        // INSERT MODE
                        const doc = this.getDoc();
                        if (!doc) {
                            await this.openFile(orderedFiles[0]);
                            for (let i = 1; i < orderedFiles.length; i++) await this.insertPDF(orderedFiles[i]);
                        } else {
                            let cursor = Number.isInteger(this.dropTargetIndex)
                                ? Math.max(0, Math.min(this.dropTargetIndex, doc.pages.length)) - 1
                                : doc.pages.length - 1;
                            for (const file of orderedFiles) {
                                const prevLimit = doc.pages.length;
                                await this.insertPDF(file, cursor);
                                cursor += (doc.pages.length - prevLimit);
                            }
                        }
                    }
                }



                this.pendingDropFiles = [];
                this.dropTargetIndex = null;
            },

            handleMainViewDrop: function (files) {
                // Inserción rápida de imagen en la página actual
                const f = files[0];
                if (f.type.startsWith('image/')) {
                    this.insertImage(f);
                }
            },

            cancelDrop: function () {
                this.pendingDropFiles = [];
                this.dropTargetIndex = null;
                this.clearDropFeedback?.();
                this.closeAllModals();
            },

            // ============================================================
            // SECTION 6: FORM PROPERTIES & SAVING
            // ============================================================




            // NOTE: savePDFInternal is defined earlier in this file (around line 8291) with full shape/drawing support

            // ============================================================
            // SECTION 9: UI HELPERS (Modals, Toast, Loader)
            // ============================================================



            // ============================================================
            //  PRINT
            // ============================================================
            showPrintModal: function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { this.showToast('⚠️ Abre un PDF primero'); return; }
                const totalPages = doc.pages.length;
                const cur = doc.currentIndex + 1;

                const existing = document.getElementById('_alioth_print_modal');
                if (existing) existing.remove();

                const modal = document.createElement('div');
                modal.id = '_alioth_print_modal';
                // Overlay semi-transparente
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';

                // Selectores con colores hardcodeados para modal oscuro
                const sel = (id, label, opts, onchange = 'app._printPreview()') => `
                    <div style="flex:1;">
                        <label style="font-size:10px;font-weight:700;display:block;margin-bottom:5px;text-transform:uppercase;opacity:0.65;">${label}</label>
                        <select id="${id}" aria-label="${label}" onchange="${onchange}"
                            style="width:100%;padding:0 8px;height:30px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;
                                   background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:12px;cursor:pointer;outline:none;">
                            ${opts.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}
                        </select>
                    </div>`;

                modal.innerHTML = `
                <div style="background:rgba(26,32,53,0.63);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:24px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
                            width:780px;max-width:96vw;height:680px;max-height:92vh;box-sizing:border-box;overflow:hidden;
                            box-shadow:0 16px 48px rgba(0,0,0,0.6);color:#f0f4ff;display:flex;gap:20px;position:relative;">

                    <!-- Botón Cerrar en esquina superior derecha -->
                    <button class="modal-close-btn-round" onclick="document.getElementById('_alioth_print_modal').remove()" title="Cerrar">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>

                    <!-- LEFT: Options -->
                    <div style="flex:0 0 310px;display:flex;flex-direction:column;gap:12px;min-height:0;overflow-y:auto;padding-right:2px;">

                        <!-- Header -->
                        <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.18);">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent)">
                                <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
                            </svg>
                            <strong style="font-size:15px;flex:1;">Imprimir</strong>
                        </div>

                        ${sel('_pr_printer', 'Impresora', [['', 'Cargando impresoras...']], 'app._printPrinterChanged()')}

                        <!-- PÁGINAS -->
                        <div>
                            <label style="font-size:10px;font-weight:700;display:block;margin-bottom:7px;text-transform:uppercase;opacity:0.65;">Páginas</label>
                            <div style="display:flex;flex-direction:column;gap:5px;font-size:13px;">
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="radio" name="_pr_pages" value="all" checked onchange="app._printPreview()"> Todas (${totalPages})
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="radio" name="_pr_pages" value="current" onchange="app._printPreview()"> Página actual (${cur})
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="radio" name="_pr_pages" value="range" onchange="app._printPreview()"> Rango:
                                    <input id="_pr_from" type="number" value="1" min="1" max="${totalPages}"
                                        style="width:44px;padding:3px 5px;border:1px solid rgba(255,255,255,0.18);border-radius:4px;background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:12px;"
                                        onfocus="document.querySelector('input[name=_pr_pages][value=range]').checked=true;app._printPreview()"
                                        oninput="app._printPreview()">
                                    <span style="opacity:.6;">–</span>
                                    <input id="_pr_to" type="number" value="${totalPages}" min="1" max="${totalPages}"
                                        style="width:44px;padding:3px 5px;border:1px solid rgba(255,255,255,0.18);border-radius:4px;background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:12px;"
                                        onfocus="document.querySelector('input[name=_pr_pages][value=range]').checked=true;app._printPreview()"
                                        oninput="app._printPreview()">
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap;">
                                    <input type="radio" name="_pr_pages" value="custom" onchange="app._printPreview()"> Personalizado:
                                    <input id="_pr_custom_pages" type="text" placeholder="ej: 1,3,5-8,12"
                                        style="width:130px;padding:3px 6px;border:1px solid rgba(255,255,255,0.18);border-radius:4px;background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:11px;"
                                        onfocus="document.querySelector('input[name=_pr_pages][value=custom]').checked=true;app._printPreview()"
                                        oninput="app._printPreview()">
                                </label>
                            </div>
                        </div>

                        <!-- ORIENTACIÓN + ESCALA + COPIAS -->
                        <div style="display:flex;gap:8px;align-items:flex-end;">
                            ${sel('_pr_orient','Orientación',[['portrait','Vertical'],['landscape','Horizontal'],['auto','Auto']])}
                            ${sel('_pr_scale','Escala',[['fit','Ajustar'],['100','100%'],['75','75%'],['125','125%'],['50','50%'],['150','150%']])}
                            <div style="flex:0 0 52px;max-width:52px;">
                                <label style="font-size:10px;font-weight:700;display:block;margin-bottom:5px;text-transform:uppercase;opacity:0.65;">Copias</label>
                                <input id="_pr_copies" type="number" value="1" min="1" max="99"
                                    style="width:100%;box-sizing:border-box;padding:0 4px;height:30px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;
                                           background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:13px;text-align:center;">
                            </div>
                        </div>

                        <!-- PAPEL + MÁRGENES -->
                        <div style="display:flex;gap:8px;">
                            ${sel('_pr_paper','Papel',[['A4','A4'],['letter','Carta'],['legal','Legal'],['A3','A3'],['A5','A5']])}
                            ${sel('_pr_margin','Márgenes',[['default','Por defecto'],['none','Sin márgenes'],['min','Mínimos'],['custom','Personalizados']])}
                        </div>

                        <!-- MÁRGENES PERSONALIZADOS -->
                        <div id="_pr_custom_margins" style="display:none;background:rgba(10,15,35,0.4);border-radius:8px;padding:10px;border:1px solid rgba(255,255,255,0.18);">
                            <label style="font-size:10px;font-weight:700;display:block;margin-bottom:8px;opacity:0.65;text-transform:uppercase;">Márgenes (mm)</label>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                                ${['Superior','Inferior','Izquierdo','Derecho'].map((l,i) => `
                                <div>
                                    <label style="font-size:10px;display:block;margin-bottom:3px;opacity:.7;">${l}</label>
                                    <input id="_pr_m${i}" type="number" value="10" min="0" max="80" oninput="app._printPreview()"
                                        style="width:100%;box-sizing:border-box;padding:0 6px;height:28px;border:1px solid rgba(255,255,255,0.18);border-radius:4px;background:rgba(10,15,35,0.7);color:#f0f4ff;font-size:12px;">
                                </div>`).join('')}
                            </div>
                        </div>

                        <!-- OPCIONES -->
                        <div style="background:rgba(10,15,35,0.4);border-radius:8px;padding:10px;border:1px solid rgba(255,255,255,0.18);">
                            <label style="font-size:10px;font-weight:700;display:block;margin-bottom:8px;text-transform:uppercase;opacity:0.65;">Opciones</label>
                            <div style="display:flex;flex-direction:column;gap:7px;font-size:12px;">
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" id="_pr_bg" onchange="app._printPreview()" style="cursor:pointer;width:14px;height:14px;"> Imprimir fondo/colores
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" id="_pr_annots" onchange="app._printPreview()" style="cursor:pointer;width:14px;height:14px;"> Incluir anotaciones
                                </label>
                                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" id="_pr_gray" onchange="app._printPreview()" style="cursor:pointer;width:14px;height:14px;"> Escala de grises
                                </label>
                            </div>
                        </div>

                        <!-- BOTONES -->
                        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,0.18);">
                            <button onclick="document.getElementById('_alioth_print_modal').remove()"
                                style="padding:8px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:8px;font-size:12px;cursor:pointer;color:#f0f4ff;">
                                Cancelar
                            </button>
                            <button id="_pr_submit" disabled onclick="app.executePrint()"
                                style="padding:8px 18px;background:var(--accent);color:white;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:6px;">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="white">
                                    <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
                                </svg>
                                Imprimir
                            </button>
                        </div>
                    </div>

                    <!-- RIGHT: Preview -->
                    <div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;">
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;padding-right:32px;">
                            <label style="font-size:10px;font-weight:700;text-transform:uppercase;opacity:0.65;letter-spacing:0.5px;">Vista previa</label>
                            <div style="display:flex;align-items:center;gap:4px;">
                                <button onclick="app._printSetPreviewZoom(-0.25)" title="Alejar"
                                    style="width:25px;height:25px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;color:#f0f4ff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">−</button>
                                <button onclick="app._printSetPreviewZoom(0)" title="Ajustar a la vista"
                                    style="min-width:45px;height:25px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;color:#f0f4ff;font-size:10px;display:flex;align-items:center;justify-content:center;"><span id="_pr_zoom_lbl">100%</span></button>
                                <button onclick="app._printSetPreviewZoom(0.25)" title="Acercar"
                                    style="width:25px;height:25px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;color:#f0f4ff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;">+</button>
                            </div>
                        </div>
                        <div id="_pr_preview_wrap"
                            style="flex:1;background:rgba(5,10,25,0.5);border-radius:8px;border:1px solid rgba(255,255,255,0.18);
                                   display:flex;align-items:center;justify-content:center;overflow:auto;min-height:0;position:relative;">
                            <div style="font-size:12px;opacity:0.5;" id="_pr_preview_spinner">Generando vista previa...</div>
                            <canvas id="_pr_preview_canvas" style="display:none;max-width:none;max-height:none;border-radius:2px;box-shadow:0 4px 20px rgba(0,0,0,0.4);"></canvas>
                        </div>
                        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:8px;font-size:12px;">
                            <button onclick="app._printNavPage(-1)"
                                style="padding:5px 12px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;color:#f0f4ff;">◀</button>
                            <span id="_pr_page_lbl" style="opacity:0.6;min-width:60px;text-align:center;">—</span>
                            <button onclick="app._printNavPage(1)"
                                style="padding:5px 12px;border:1px solid rgba(255,255,255,0.18);border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;color:#f0f4ff;">▶</button>
                        </div>
                    </div>
                </div>`;

                document.body.appendChild(modal);
                modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
                this._printLoadPrinters(modal);

                // Cerrar con Escape
                const _printEscHandler = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', _printEscHandler); } };
                document.addEventListener('keydown', _printEscHandler);

                document.getElementById('_pr_margin').addEventListener('change', function() {
                    this.dataset.userSelected = 'true';
                    document.getElementById('_pr_custom_margins').style.display = this.value === 'custom' ? 'block' : 'none';
                });

                this._printPreviewIndex = 0;
                this._printPreviewZoom = 1;
                setTimeout(() => this._printPreview(), 80);
            },

            _printLoadPrinters: async function (modal) {
                const select = modal.querySelector('#_pr_printer');
                const submit = modal.querySelector('#_pr_submit');
                select.disabled = true;
                submit.disabled = true;
                submit.style.opacity = '0.65';
                try {
                    const response = await fetch('/system/printers', { cache: 'no-store' });
                    const result = await response.json();
                    if (!response.ok || !Array.isArray(result.printers)) throw new Error('No se pudieron cargar las impresoras');
                    if (!document.contains(modal)) return;
                    select.replaceChildren();
                    for (const name of result.printers) {
                        select.add(new Option(name === result.default ? name + ' (predeterminada)' : name, name));
                    }
                    if (!result.printers.length) {
                        select.add(new Option('No hay impresoras instaladas', ''));
                        return;
                    }
                    if (result.printers.includes(result.default)) select.value = result.default;
                    select.disabled = false;
                    submit.disabled = false;
                    submit.style.opacity = '';
                    this._printPrinterChanged();
                } catch (e) {
                    if (!document.contains(modal)) return;
                    select.replaceChildren(new Option('No se pudieron cargar las impresoras', ''));
                    this.showToast('⚠️ No se pudieron cargar las impresoras. Vuelve a abrir Imprimir.');
                }
            },

            _printPrinterChanged: function () {
                const margin = document.getElementById('_pr_margin');
                if (margin && !margin.dataset.userSelected) {
                    margin.value = /pdf/i.test(document.getElementById('_pr_printer')?.value || '') ? 'none' : 'default';
                }
                this._printPreview();
            },

            _printGetMargins: function () {
                const mode = document.getElementById('_pr_margin')?.value || 'default';
                const margins = mode === 'custom'
                    ? [2, 0, 3, 1].map(i => Number(document.getElementById('_pr_m' + i)?.value ?? 10))
                    : Array(4).fill(mode === 'none' ? 0 : mode === 'min' ? 3 : 10);
                if (margins.some(value => !Number.isFinite(value) || value < 0 || value > 80)) {
                    throw new Error('Los márgenes deben estar entre 0 y 80 mm');
                }
                return margins;
            },

            _printGetPageIndices: function () {
                const doc = this.getDoc();
                if (!doc) return [];
                const total = doc.pages.length;
                const mode = document.querySelector('input[name="_pr_pages"]:checked')?.value || 'all';
                if (mode === 'current') return [doc.currentIndex];
                if (mode === 'all') return doc.pages.map((_,i)=>i);
                if (mode === 'range') {
                    const from = Math.max(0, parseInt(document.getElementById('_pr_from')?.value||1)-1);
                    const to   = Math.min(total-1, parseInt(document.getElementById('_pr_to')?.value||total)-1);
                    const arr = [];
                    for (let i=from;i<=to;i++) arr.push(i);
                    return arr;
                }
                if (mode === 'custom') {
                    const raw = document.getElementById('_pr_custom_pages')?.value || '';
                    const arr = [];
                    raw.split(',').forEach(part => {
                        part = part.trim();
                        if (part.includes('-')) {
                            const [a,b] = part.split('-').map(x=>parseInt(x.trim())-1);
                            for (let i=Math.max(0,a);i<=Math.min(total-1,b);i++) arr.push(i);
                        } else {
                            const n = parseInt(part)-1;
                            if (n>=0 && n<total) arr.push(n);
                        }
                    });
                    return [...new Set(arr)].sort((a,b)=>a-b);
                }
                return [];
            },

            _printPreviewIndex: 0,

            _printSetPreviewZoom: function (delta) {
                const current = this._printPreviewZoom || 1;
                this._printPreviewZoom = delta === 0 ? 1 : Math.max(0.25, Math.min(3, current + delta));
                this._printApplyPreviewZoom();
            },

            _printApplyPreviewZoom: function () {
                const wrap = document.getElementById('_pr_preview_wrap');
                const cvs = document.getElementById('_pr_preview_canvas');
                const label = document.getElementById('_pr_zoom_lbl');
                const zoom = this._printPreviewZoom || 1;
                if (label) label.textContent = Math.round(zoom * 100) + '%';
                if (!wrap || !cvs || !cvs.width || !cvs.height) return;
                const padding = 20;
                const fit = Math.min(
                    Math.max(1, wrap.clientWidth - padding) / cvs.width,
                    Math.max(1, wrap.clientHeight - padding) / cvs.height
                );
                cvs.style.width = Math.max(1, Math.round(cvs.width * fit * zoom)) + 'px';
                cvs.style.height = 'auto';
            },

            _printPreview: async function () {
                const token = this._printPreviewToken = (this._printPreviewToken || 0) + 1;
                const doc = this.getDoc();
                if (!doc) return;
                const indices = this._printGetPageIndices();
                if (!indices.length) return;
                const idx = Math.min(this._printPreviewIndex, indices.length - 1);
                this._printPreviewIndex = idx;
                const pageIdx = indices[idx];
                const lbl = document.getElementById('_pr_page_lbl');
                if (lbl) lbl.textContent = (idx+1) + ' / ' + indices.length;

                const spinner = document.getElementById('_pr_preview_spinner');
                const cvs = document.getElementById('_pr_preview_canvas');
                if (!cvs) return;
                if (spinner) { spinner.style.display = 'block'; spinner.textContent = 'Generando vista previa...'; }

                const gray   = document.getElementById('_pr_gray')?.checked;
                const annots = document.getElementById('_pr_annots')?.checked;

                const p = doc.pages[pageIdx];
                const src = doc.sources[p.sourceId];
                try {
                    if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const pdfPage = await src.doc.getPage(p.pageIndex + 1);
                    const vp = pdfPage.getViewport({ scale: 1.5, rotation: p.rotation||0 });
                    const sourceCanvas = document.createElement('canvas');
                    sourceCanvas.width = vp.width; sourceCanvas.height = vp.height;
                    const ctx = sourceCanvas.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0,0,sourceCanvas.width,sourceCanvas.height);
                    await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

                    if (annots && p.objects) {
                        const scale = 1.5;
                        for (const obj of p.objects) {
                            if (obj.type==='image' && obj.src) {
                                try {
                                    const img = await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=obj.src;});
                                    ctx.save();
                                    ctx.globalAlpha = obj.opacity!==undefined?(obj.opacity>1?obj.opacity/100:obj.opacity):1;
                                    ctx.translate((obj.x+obj.width/2)*scale,(obj.y+obj.height/2)*scale);
                                    if(obj.rotation) ctx.rotate(obj.rotation*Math.PI/180);
                                    ctx.drawImage(img,-obj.width/2*scale,-obj.height/2*scale,obj.width*scale,obj.height*scale);
                                    ctx.restore();
                                } catch(e){}
                            }
                        }
                    }

                    // Escala de grises en vista previa
                    if (gray) {
                        const imgData = ctx.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
                        const d = imgData.data;
                        for (let i=0;i<d.length;i+=4) {
                            const g = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
                            d[i]=d[i+1]=d[i+2]=g;
                        }
                        ctx.putImageData(imgData,0,0);
                    }

                    const paper = document.getElementById('_pr_paper')?.value || 'A4';
                    let [width, height] = { A4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], A3: [297, 420], A5: [148, 210] }[paper];
                    const orient = document.getElementById('_pr_orient')?.value || 'portrait';
                    let landscape = orient === 'landscape';
                    if (orient === 'auto') {
                        const first = doc.pages[indices[0]];
                        const firstSource = doc.sources[first.sourceId];
                        if (!firstSource.doc) firstSource.doc = await pdfjsLib.getDocument({ data: firstSource.buffer.slice(0) }).promise;
                        const firstPage = await firstSource.doc.getPage(first.pageIndex + 1);
                        const firstViewport = firstPage.getViewport({ scale: 1, rotation: first.rotation || 0 });
                        landscape = firstViewport.width > firstViewport.height;
                    }
                    if (landscape) [width, height] = [height, width];
                    const pixelsPerMm = 108 / 25.4;
                    const [left, top, right, bottom] = this._printGetMargins();
                    const x = Math.round(left * pixelsPerMm), y = Math.round(top * pixelsPerMm);
                    const output = document.createElement('canvas');
                    output.width = Math.round(width * pixelsPerMm);
                    output.height = Math.round(height * pixelsPerMm);
                    const availableWidth = output.width - x - Math.round(right * pixelsPerMm);
                    const availableHeight = output.height - y - Math.round(bottom * pixelsPerMm);
                    if (availableWidth < 1 || availableHeight < 1) throw new Error('Los márgenes dejan el área imprimible vacía');
                    const scale = document.getElementById('_pr_scale')?.value || 'fit';
                    const factor = scale === 'fit' ? Math.min(availableWidth / sourceCanvas.width, availableHeight / sourceCanvas.height) : Number(scale) / 100;
                    const drawWidth = Math.round(sourceCanvas.width * factor), drawHeight = Math.round(sourceCanvas.height * factor);
                    const outputContext = output.getContext('2d');
                    outputContext.fillStyle = '#fff';
                    outputContext.fillRect(0, 0, output.width, output.height);
                    outputContext.drawImage(sourceCanvas, x + Math.round((availableWidth - drawWidth) / 2), y + Math.round((availableHeight - drawHeight) / 2), drawWidth, drawHeight);
                    if (token !== this._printPreviewToken || document.getElementById('_pr_preview_canvas') !== cvs) return;
                    cvs.width = output.width; cvs.height = output.height;
                    cvs.getContext('2d').drawImage(output, 0, 0);
                    if (spinner) spinner.style.display = 'none';
                    cvs.style.display = 'block';
                    this._printApplyPreviewZoom();
                } catch(e) {
                    if (token !== this._printPreviewToken) return;
                    console.error('Print preview error:', e);
                    if (spinner) spinner.textContent = e.message || 'Error al generar vista previa';
                }
            },

            _printNavPage: function (dir) {
                const indices = this._printGetPageIndices();
                this._printPreviewIndex = Math.max(0, Math.min(indices.length-1, (this._printPreviewIndex||0) + dir));
                this._printPreview();
            },

            executePrint: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) return;
                const printerSelect = document.getElementById('_pr_printer');
                if (!printerSelect || printerSelect.disabled || !printerSelect.value) {
                    this.showToast('⚠️ Selecciona una impresora');
                    return;
                }
                const printer = printerSelect.value;

                const orient    = document.getElementById('_pr_orient')?.value || 'portrait';
                const scaleSel  = document.getElementById('_pr_scale')?.value || 'fit';
                const paper     = document.getElementById('_pr_paper')?.value || 'A4';
                let margins;
                try { margins = this._printGetMargins(); }
                catch (e) { this.showToast('⚠️ ' + e.message); return; }
                const inclAnnot = document.getElementById('_pr_annots')?.checked !== false;
                const gray      = document.getElementById('_pr_gray')?.checked || false;
                const copies    = Math.max(1, parseInt(document.getElementById('_pr_copies')?.value || 1));

                const pageIndices = this._printGetPageIndices();

                this.showToast('🖨️ Preparando impresión...');

                const canvases = [];
                for (const idx of pageIndices) {
                    const p = doc.pages[idx];
                    const src = doc.sources[p.sourceId];
                    try {
                        if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                        const pdfPage = await src.doc.getPage(p.pageIndex + 1);
                        const scale = 2.0;
                        const vp = pdfPage.getViewport({ scale, rotation: p.rotation || 0 });
                        const cvs = document.createElement('canvas');
                        cvs.width = vp.width; cvs.height = vp.height;
                        const ctx = cvs.getContext('2d');
                        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

                        if (inclAnnot && p.objects && p.objects.length) {
                            for (const obj of p.objects) {
                                if (obj.type === 'image' && obj.src) {
                                    try {
                                        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = obj.src; });
                                        ctx.save();
                                        ctx.globalAlpha = obj.opacity !== undefined ? (obj.opacity > 1 ? obj.opacity/100 : obj.opacity) : 1;
                                        ctx.translate((obj.x + obj.width/2) * scale, (obj.y + obj.height/2) * scale);
                                        if (obj.rotation) ctx.rotate(obj.rotation * Math.PI / 180);
                                        ctx.drawImage(img, -obj.width/2 * scale, -obj.height/2 * scale, obj.width * scale, obj.height * scale);
                                        ctx.restore();
                                    } catch(e) {}
                                } else if (obj.type === 'text') {
                                    ctx.save();
                                    ctx.font = (obj.bold?'bold ':'')+' '+(obj.italic?'italic ':'')+' '+((obj.fontSize||12)*scale)+'px '+(obj.fontFamily||'Arial');
                                    ctx.fillStyle = obj.color || '#000';
                                    ctx.globalAlpha = obj.opacity !== undefined ? (obj.opacity > 1 ? obj.opacity/100 : obj.opacity) : 1;
                                    ctx.fillText(obj.text || '', obj.x * scale, (obj.y + (obj.fontSize||12)) * scale);
                                    ctx.restore();
                                }
                            }
                        }

                        // Escala de grises
                        if (gray) {
                            const imgData = ctx.getImageData(0,0,cvs.width,cvs.height);
                            const d = imgData.data;
                            for (let i=0;i<d.length;i+=4) { const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; d[i]=d[i+1]=d[i+2]=g; }
                            ctx.putImageData(imgData,0,0);
                        }

                        canvases.push({ cvs, w: vp.width, h: vp.height });
                    } catch(e) {
                        console.error('Print render error page', idx, e);
                    }
                }

                if (!canvases.length) { this.showToast('❌ No se pudo preparar la impresión'); return; }

                const orientation = orient === 'auto'
                    ? (canvases[0].w > canvases[0].h ? 'landscape' : 'portrait')
                    : orient;
                const requestBody = JSON.stringify({
                    printer,
                    pages: canvases.map(({ cvs }) => cvs.toDataURL('image/jpeg', 0.95)),
                    layout: {
                        paper,
                        orientation,
                        scale: scaleSel === 'fit' ? 'fit' : Number(scaleSel),
                        margins,
                        copies
                    }
                });
                if (new Blob([requestBody]).size > 95 * 1024 * 1024) {
                    this.showToast('⚠️ La selección supera el límite de impresión directa de 95 MB');
                    return;
                }

                const submit = document.getElementById('_pr_submit');
                const originalLabel = submit?.innerHTML;
                if (submit) { submit.disabled = true; submit.style.opacity = '0.65'; submit.textContent = 'Enviando...'; }
                try {
                    const response = await fetch('/system/print', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: requestBody
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok || !result.ok) throw new Error(result?.error?.message || 'La impresora rechazó el trabajo');
                    document.getElementById('_alioth_print_modal')?.remove();
                    this.showToast('🖨️ Enviado a ' + result.printer + ' (' + result.pages + ' página(s))');
                } catch (e) {
                    console.error('Direct print error:', e);
                    this.showToast('❌ ' + (e.message || 'No se pudo imprimir'));
                } finally {
                    if (submit && document.contains(submit)) { submit.disabled = false; submit.style.opacity = ''; submit.innerHTML = originalLabel; }
                }
            },

            /**
             * Shows a toast notification message
             * @param {string} msg - Message to display
             */
            setPageCount: function (text) {
                const el = document.getElementById('pageCountDisplay');
                if (!el) return;
                const [current, total] = String(text).split('/').map(value => value.trim());
                const prefix = document.createElement('span');
                prefix.className = 'page-count-current';
                prefix.textContent = total === undefined ? '' : current + ' / ';
                const count = document.createElement('span');
                count.className = 'page-count-total';
                count.textContent = total === undefined ? current : total;
                el.replaceChildren(prefix, count);
                el.title = text;
                el.setAttribute('aria-label', text);
                const len = text.replace(/\s/g, '').length;
                // ≤7: "9/99pág"=7  ≤9: "99/99pág"=8, "1/300pág"=8  ≤11: "100/300pág"=10  >11: extremo
                el.style.fontSize = len <= 7 ? '11px' : len <= 9 ? '10px' : len <= 11 ? '8.5px' : '7.5px';
            },

            // ─── BATES NUMBERING ───────────────────────────────────────────────

            _batesSegments: null,
            _batesSep: '-',
            _currentPnTab: 'simple',

            _pnSetTab: function (tab) {
                document.getElementById('pnpanel-simple').style.display = tab === 'simple' ? '' : 'none';
                document.getElementById('pnpanel-bates').style.display  = tab === 'bates'  ? '' : 'none';
                const tSimple = document.getElementById('pntab-simple');
                const tBates  = document.getElementById('pntab-bates');
                if (tSimple) {
                    tSimple.style.borderBottomColor = tab === 'simple' ? 'var(--accent)' : 'transparent';
                    tSimple.style.color = tab === 'simple' ? 'var(--accent)' : 'var(--text-dim)';
                    tSimple.style.fontWeight = tab === 'simple' ? 'bold' : 'normal';
                }
                if (tBates) {
                    tBates.style.borderBottomColor = tab === 'bates' ? 'var(--accent)' : 'transparent';
                    tBates.style.color = tab === 'bates' ? 'var(--accent)' : 'var(--text-dim)';
                    tBates.style.fontWeight = tab === 'bates' ? 'bold' : 'normal';
                }
                this._currentPnTab = tab;
                if (tab === 'bates') this._batesUpdatePreview();
            },

            _batesAddSegment: function (type) {
                if (!this._batesSegments) this._batesSegments = [];
                const id = Date.now() + Math.random();
                if (type === 'text')    this._batesSegments.push({ id, type: 'text',    value: 'TEXTO' });
                if (type === 'counter') this._batesSegments.push({ id, type: 'counter', digits: 6 });
                this._batesRenderSegments();
                this._batesUpdatePreview();
            },

            _batesRemoveSegment: function (id) {
                this._batesSegments = (this._batesSegments || []).filter(s => s.id !== id);
                this._batesRenderSegments();
                this._batesUpdatePreview();
            },

            _batesMoveSegment: function (id, dir) {
                const segs = this._batesSegments || [];
                const idx = segs.findIndex(s => s.id === id);
                if (idx < 0) return;
                const newIdx = idx + dir;
                if (newIdx < 0 || newIdx >= segs.length) return;
                [segs[idx], segs[newIdx]] = [segs[newIdx], segs[idx]];
                this._batesRenderSegments();
                this._batesUpdatePreview();
            },

            _batesRenderSegments: function () {
                const container = document.getElementById('bates-segments');
                if (!container) return;
                container.innerHTML = '';
                (this._batesSegments || []).forEach(seg => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; align-items:center; gap:5px; padding:4px 6px; background:var(--bg-secondary,#f0f0f0); border-radius:5px; border:1px solid var(--border);';

                    const badge = document.createElement('span');
                    badge.style.cssText = 'font-size:9px; padding:1px 5px; border-radius:3px; font-weight:bold; white-space:nowrap; color:white;';
                    badge.style.background = seg.type === 'counter' ? 'var(--accent)' : '#6c757d';
                    badge.textContent = seg.type === 'counter' ? '# CTR' : 'TXT';
                    row.appendChild(badge);

                    if (seg.type === 'text') {
                        const inp = document.createElement('input');
                        inp.value = seg.value;
                        inp.style.cssText = 'flex:1; padding:2px 5px; font-size:11px; font-family:monospace; border:1px solid var(--border); border-radius:3px; background:var(--bg-main,white); color:var(--text-main);';
                        inp.oninput = (e) => { seg.value = e.target.value; this._batesUpdatePreview(); };
                        row.appendChild(inp);
                    } else {
                        const lblD = document.createElement('span');
                        lblD.textContent = 'Dígitos:';
                        lblD.style.cssText = 'font-size:10px; color:var(--text-dim); white-space:nowrap;';
                        row.appendChild(lblD);

                        const inpD = document.createElement('input');
                        inpD.type = 'number'; inpD.value = seg.digits || 6; inpD.min = 1; inpD.max = 12;
                        inpD.style.cssText = 'width:42px; padding:2px; font-size:11px; border:1px solid var(--border); border-radius:3px;';
                        inpD.oninput = (e) => { seg.digits = parseInt(e.target.value) || 6; this._batesUpdatePreview(); };
                        row.appendChild(inpD);
                    }

                    const btnL = document.createElement('button');
                    btnL.textContent = '←'; btnL.title = 'Mover izquierda';
                    btnL.style.cssText = 'padding:1px 5px; font-size:11px; border:1px solid var(--border); border-radius:3px; cursor:pointer; background:transparent;';
                    btnL.onclick = () => this._batesMoveSegment(seg.id, -1);
                    row.appendChild(btnL);

                    const btnR = document.createElement('button');
                    btnR.textContent = '→'; btnR.title = 'Mover derecha';
                    btnR.style.cssText = 'padding:1px 5px; font-size:11px; border:1px solid var(--border); border-radius:3px; cursor:pointer; background:transparent;';
                    btnR.onclick = () => this._batesMoveSegment(seg.id, 1);
                    row.appendChild(btnR);

                    const btnDel = document.createElement('button');
                    btnDel.textContent = '✕';
                    btnDel.style.cssText = 'padding:1px 5px; font-size:11px; border:1px solid #e55; border-radius:3px; cursor:pointer; color:#e55; background:transparent;';
                    btnDel.onclick = () => this._batesRemoveSegment(seg.id);
                    row.appendChild(btnDel);

                    container.appendChild(row);
                });
            },

            _batesSetSep: function (sep) {
                this._batesSep = sep;
                document.querySelectorAll('.bates-sep-btn').forEach(btn => {
                    const active = btn.dataset.sep === sep;
                    btn.style.background   = active ? 'var(--accent)' : 'transparent';
                    btn.style.color        = active ? 'white' : '';
                    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
                });
                this._batesUpdatePreview();
            },

            _batesBuildText: function (counterValue) {
                const startNum = parseInt(document.getElementById('bates-start-num')?.value || 1);
                const n = (counterValue - 1) + startNum;
                return (this._batesSegments || []).map(seg => {
                    if (seg.type === 'text') return seg.value || '';
                    return String(n).padStart(seg.digits || 6, '0');
                }).join(this._batesSep != null ? this._batesSep : '-');
            },

            _batesUpdatePreview: function () {
                const el = document.getElementById('bates-preview');
                if (el) el.textContent = this._batesBuildText(1);
            },

});
