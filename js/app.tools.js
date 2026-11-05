// app.tools.js
// Extiende el objeto global `app` con métodos de tools
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            isDrawingMode: false, isTextSelectMode: false, drawTool: 'pen',
            drawSettings: { color: '#000000', width: 2, alpha: 1 },
            pendingHighlightColor: null,
            isDrawing: false, currentPath: [],

            // Smart Patch (Fake Edit) State
            smartPatchMode: false,
            smartPatchData: null,

            // Font Resolution Pipeline - Session Cache
            _measureCalib: { calibrated: false, mode: 'page', pxPerUnit: null, unit: 'cm', scaleRatio: 100 },
            isMarqueeDrag: function (start, current, threshold = 4) {
                return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
            },

            normalizeMarqueeRect: function (start, current, scale = 1) {
                const safeScale = Number(scale) > 0 ? Number(scale) : 1;
                return {
                    left: Math.min(start.x, current.x) / safeScale,
                    top: Math.min(start.y, current.y) / safeScale,
                    right: Math.max(start.x, current.x) / safeScale,
                    bottom: Math.max(start.y, current.y) / safeScale
                };
            },

            applyFormFieldMarqueeSelection: function (page, rect, options = {}) {
                const append = !!options.append;
                this.multiObjectSelection = this.multiObjectSelection || new Set();
                if (!append) {
                    this.multiObjectSelection.clear();
                    this.selectedObj = null;
                }

                const intersecting = (page?.objects || []).filter(object => {
                    if (!object.fromFormField) return false;
                    const rendered = options.elementRects?.get(object.id);
                    const objectRect = rendered || {
                        left: object.x,
                        top: object.y,
                        right: object.x + object.width,
                        bottom: object.y + object.height
                    };
                    return objectRect.right > rect.left && objectRect.left < rect.right && objectRect.bottom > rect.top && objectRect.top < rect.bottom;
                });
                intersecting.forEach(object => this.multiObjectSelection.add(object.id));

                if (!this.selectedObj || !this.multiObjectSelection.has(this.selectedObj.id)) {
                    this.selectedObj = (page?.objects || []).find(object => this.multiObjectSelection.has(object.id)) || null;
                }
                return this.multiObjectSelection.size;
            },

            getFieldNudgeStep: function (fields, shiftKey = false) {
                const sizes = (fields || [])
                    .map(field => Math.min(Number(field.width) || 0, Number(field.height) || 0))
                    .filter(size => size > 0)
                    .sort((a, b) => a - b);
                if (!sizes.length) return 0;
                const middle = Math.floor(sizes.length / 2);
                const median = sizes.length % 2 ? sizes[middle] : (sizes[middle - 1] + sizes[middle]) / 2;
                const base = median <= 12 ? 0.1 : median <= 36 ? 0.3 : 0.5;
                return base * (shiftKey ? 10 : 1);
            },

            endFieldNudgeSession: function () {
                this._fieldNudgeSession = null;
            },

            nudgeSelectedFields: function (key, shiftKey = false) {
                if (!this.isFieldEditMode) {
                    this.endFieldNudgeSession();
                    return false;
                }
                const doc = this.getDoc && this.getDoc();
                const page = doc && doc.pages && doc.pages[doc.currentIndex];
                if (!page) return false;
                const selectedIds = this.multiObjectSelection || new Set();
                const selected = (page.objects || []).filter(object =>
                    selectedIds.has(object.id) || object === this.selectedObj
                );
                if (!selected.length || selected.some(object => !object.fromFormField)) {
                    this.endFieldNudgeSession();
                    return false;
                }
                const step = this.getFieldNudgeStep(selected, shiftKey);
                if (!step) return false;
                let dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
                let dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
                if (!dx && !dy) return false;

                const pageWidth = Number(page.width || page._pdfW || 595);
                const pageHeight = Number(page.height || page._pdfH || 842);
                const minDx = Math.max(...selected.map(field => -(Number(field.x) || 0)));
                const maxDx = Math.min(...selected.map(field => pageWidth - (Number(field.x) || 0) - (Number(field.width) || 0)));
                const minDy = Math.max(...selected.map(field => -(Number(field.y) || 0)));
                const maxDy = Math.min(...selected.map(field => pageHeight - (Number(field.y) || 0) - (Number(field.height) || 0)));
                dx = Math.max(minDx, Math.min(maxDx, dx));
                dy = Math.max(minDy, Math.min(maxDy, dy));
                if (!dx && !dy) return false;

                const selectionKey = selected.map(field => field.id).sort().join('|');
                if (!this._fieldNudgeSession || this._fieldNudgeSession.docId !== doc.id || this._fieldNudgeSession.selectionKey !== selectionKey) {
                    this.saveState();
                    this._fieldNudgeSession = { docId: doc.id, selectionKey };
                }
                selected.forEach(field => {
                    field.x = (Number(field.x) || 0) + dx;
                    field.y = (Number(field.y) || 0) + dy;
                });
                this.renderOverlays();
                this.syncToolbar && this.syncToolbar();
                return true;
            },

            planFieldAlignment: function (fields, axis) {
                if (!['horizontal', 'vertical'].includes(axis) || !Array.isArray(fields) || fields.length < 2 || fields.some(field => !field?.fromFormField)) {
                    return { ok: false, reason: 'invalid-selection', moves: [] };
                }
                const coordinate = axis === 'horizontal' ? 'y' : 'x';
                const dimension = axis === 'horizontal' ? 'height' : 'width';
                const center = field => (Number(field[coordinate]) || 0) + (Number(field[dimension]) || 0) / 2;
                const values = fields.map(field => Number(field[dimension]) || 0).sort((a, b) => a - b);
                const middle = Math.floor(values.length / 2);
                const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
                const threshold = Math.max(1, Math.min(8, 0.35 * median));
                const sorted = [...fields].sort((a, b) => center(a) - center(b));
                const groups = [];
                for (const field of sorted) {
                    const group = groups[groups.length - 1];
                    const groupCenter = group && group.reduce((sum, item) => sum + center(item), 0) / group.length;
                    if (!group || Math.abs(center(field) - groupCenter) > threshold) groups.push([field]);
                    else group.push(field);
                }
                if (groups.length < 2 || groups.some(group => group.length < 2)) return { ok: false, reason: 'ambiguous-partition', moves: [] };
                const targets = new Map();
                groups.forEach(group => {
                    const edges = group.map(field => Number(field[coordinate]) || 0).sort((a, b) => a - b);
                    const mid = Math.floor(edges.length / 2);
                    const target = edges.length % 2 ? edges[mid] : (edges[mid - 1] + edges[mid]) / 2;
                    group.forEach(field => targets.set(field.id, target));
                });
                return {
                    ok: true,
                    axis,
                    groups: groups.map(group => group.map(field => field.id)),
                    moves: fields.map(field => ({ id: field.id, x: axis === 'vertical' ? targets.get(field.id) : field.x, y: axis === 'horizontal' ? targets.get(field.id) : field.y }))
                };
            },

            planEqualFieldSize: function (fields, axis, anchorId, pageBounds) {
                if (!['width', 'height'].includes(axis) || !Array.isArray(fields) || fields.length < 2 || fields.some(field => !field?.fromFormField)) {
                    return { ok: false, reason: 'invalid-selection', moves: [] };
                }
                const anchor = fields.find(field => field.id === anchorId);
                if (!anchor) return { ok: false, reason: 'missing-anchor', moves: [] };
                const size = Number(anchor[axis]) || 0;
                const bounds = pageBounds || { width: 595, height: 842 };
                const moves = fields.map(field => ({ ...field, [axis]: size }));
                if (moves.some(move => move.x < 0 || move.y < 0 || move.x + move.width > bounds.width || move.y + move.height > bounds.height)) {
                    return { ok: false, reason: 'outside-page', moves: [] };
                }
                return { ok: true, axis, anchorId, moves };
            },

            equalSelectedFieldSize: function (axis) {
                if (!this.isFieldEditMode || !this.multiObjectSelection?.size) return false;
                const doc = this.getDoc && this.getDoc();
                const page = doc?.pages?.[doc.currentIndex];
                const fields = (page?.objects || []).filter(field => this.multiObjectSelection.has(field.id));
                const anchorId = [...this.multiObjectSelection][0];
                const plan = this.planEqualFieldSize(fields, axis, anchorId, { width: page?.width || page?._pdfW || 595, height: page?.height || page?._pdfH || 842 });
                if (!plan.ok) return false;
                this.saveState();
                const moves = new Map(plan.moves.map(move => [move.id, move]));
                fields.forEach(field => Object.assign(field, moves.get(field.id)));
                this.renderOverlays();
                this.showToast(axis === 'width' ? 'Ancho de campos igualado' : 'Alto de campos igualado');
                return true;
            },

            planFieldGrid: function (fields, rows) {
                if (!Array.isArray(fields) || fields.length < 2 || fields.some(field => !field?.fromFormField) || !Number.isInteger(rows) || rows < 1) {
                    return { ok: false, reason: 'invalid-selection', moves: [] };
                }
                const columns = Math.ceil(fields.length / rows);
                const ordered = [...fields].sort((a, b) => a.y - b.y || a.x - b.x);
                const minX = Math.min(...fields.map(field => field.x));
                const minY = Math.min(...fields.map(field => field.y));
                const maxX = Math.max(...fields.map(field => field.x + field.width));
                const maxY = Math.max(...fields.map(field => field.y + field.height));
                const cellWidth = Math.max(...fields.map(field => field.width));
                const cellHeight = Math.max(...fields.map(field => field.height));
                const gapX = columns > 1 ? (maxX - minX - columns * cellWidth) / (columns - 1) : 0;
                const gapY = rows > 1 ? (maxY - minY - rows * cellHeight) / (rows - 1) : 0;
                if (gapX < 0 || gapY < 0) return { ok: false, reason: 'insufficient-space', moves: [] };
                return { ok: true, rows, columns, moves: ordered.map((field, index) => ({ id: field.id, x: minX + (index % columns) * (cellWidth + gapX), y: minY + Math.floor(index / columns) * (cellHeight + gapY) })) };
            },

            applySelectedFieldGrid: function (rows) {
                if (!this.isFieldEditMode || !this.multiObjectSelection?.size) return false;
                const doc = this.getDoc && this.getDoc();
                const page = doc?.pages?.[doc.currentIndex];
                const fields = (page?.objects || []).filter(field => this.multiObjectSelection.has(field.id));
                const plan = this.planFieldGrid(fields, rows);
                if (!plan.ok) return false;
                this.saveState();
                const moves = new Map(plan.moves.map(move => [move.id, move]));
                fields.forEach(field => Object.assign(field, moves.get(field.id)));
                this.renderOverlays();
                this.showToast('Campos organizados en cuadrícula');
                return true;
            },

            handleObjectSelection: function (e, o, el) {
                // If object belongs to a group and no modifier key, select the whole group
                if (o._groupId && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    const doc = this.getDoc();
                    const page = doc.pages[doc.currentIndex];
                    this.multiObjectSelection.clear();
                    page.objects.forEach(obj => {
                        if (obj._groupId === o._groupId) this.multiObjectSelection.add(obj.id);
                    });
                    this.selectedObj = o;
                } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
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

                // Visual update: reflect full multiObjectSelection state
                document.querySelectorAll('.draggable.selected, .draggable.multi-selected').forEach(d => {
                    d.classList.remove('selected');
                    d.classList.remove('multi-selected');
                });
                const isMulti = this.multiObjectSelection.size > 1;
                document.querySelectorAll('.draggable').forEach(d => {
                    if (this.multiObjectSelection.has(d.id)) {
                        d.classList.add(isMulti ? 'multi-selected' : 'selected');
                    }
                });
                if (!isMulti && this.multiObjectSelection.has(o.id)) el.classList.add('selected');
                this.syncToolbar();
            },

            toggleMeasure: function () {
                this.measureMode = !this.measureMode;
                ['btn-measure', 'toggleMeasure', 'btn-measure-magic'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.classList.toggle('active', this.measureMode);
                    if (btn) btn.classList.toggle('measure-active', this.measureMode);
                });
                if (this.measureMode) {
                    // Si ya está calibrado, activar directo con toast informativo
                    if (this._measureCalib.calibrated) {
                        const c = this._measureCalib;
                        const modeLabel = { page: 'Hoja PDF', known: 'Objeto conocido', scale: `Escala 1:${c.scaleRatio}` };
                        this.showToast(`📐 Medición activa · ${modeLabel[c.mode] || ''} · ${c.unit} · Shift = H/V`);
                        this._activateMeasureLayers();
                    } else {
                        this._openMeasureCalibModal();
                    }
                } else {
                    ['', '-secondary'].forEach(suffix => {
                        const svg = document.getElementById('measure-layer' + suffix);
                        if (svg) svg.classList.remove('active');
                    });
                }
            },

            _activateMeasureLayers: function () {
                ['', '-secondary'].forEach(suffix => {
                    const svg = document.getElementById('measure-layer' + suffix);
                    if (!svg) return;
                    const panelId = suffix === '' ? 'primary' : 'secondary';
                    svg.classList.add('active');
                    if (!svg._measureInit) this._initMeasureEvents(svg, panelId);
                });
            },

            _openMeasureCalibModal: function () {
                const modal = document.getElementById('measure-calibration-modal');
                const overlay = document.getElementById('modal-overlay');
                if (!modal || !overlay) return;
                const c = this._measureCalib;
                document.getElementById('mcm-tab-' + c.mode)?.click();
                document.getElementById('mcm-unit').value = c.unit;
                const unitKnown = document.getElementById('mcm-unit-known');
                if (unitKnown) unitKnown.value = c.unit;
                if (c.mode === 'scale') document.getElementById('mcm-scale-ratio').value = c.scaleRatio;
                overlay.style.display = 'flex';
                modal.style.display = 'flex';
                // Renderizar tabla si hay refs acumuladas
                if (c._knownRefs?.length) setTimeout(() => this._mcmRenderKnownTable(), 30);
            },

            _applyMeasureCalibPage: function () {
                // Calibrar usando dimensiones reales de la hoja PDF
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { this.showToast('⚠️ No hay documento cargado'); return; }
                const unit = document.getElementById('mcm-unit').value;
                // px por punto PDF a escala actual: scale * 1 (PDF.js: 1pt → scale px at scale=1, 1px at scale=1)
                // En realidad: vp.width = page_pt_width * scale. Ruler usa mmToPt*scale px/mm
                const mmToPt = 2.834645669;
                const scale = this.splitView[this.splitView.activePanel]?.scale || this.currentScale || 1;
                const pxPerMm = mmToPt * scale;
                const unitFactors = { mm: 1, cm: 10, m: 1000, 'in': 25.4 };
                const pxPerUnit = pxPerMm * (unitFactors[unit] || 10);
                this._measureCalib = { calibrated: true, mode: 'page', pxPerUnit, unit, scaleRatio: 1 };
                this.closeAllModals();
                this.showToast(`✅ Calibrado por hoja · unidad: ${unit}`);
                this._activateMeasureLayers();
            },

            _applyMeasureCalibScale: function () {
                const ratio = parseFloat(document.getElementById('mcm-scale-ratio').value);
                const unit = document.getElementById('mcm-unit').value;
                if (!ratio || ratio <= 0) { this.showToast('⚠️ Escala inválida'); return; }
                const mmToPt = 2.834645669;
                const scale = this.splitView[this.splitView.activePanel]?.scale || this.currentScale || 1;
                const pxPerMmScreen = mmToPt * scale;
                // 1 unidad real = ratio mm en pantalla, dividido por la unidad elegida
                const unitFactors = { mm: 1, cm: 10, m: 1000, 'in': 25.4 };
                const mmPerUnit = unitFactors[unit] || 10;
                const pxPerUnit = pxPerMmScreen * mmPerUnit * ratio;
                this._measureCalib = { calibrated: true, mode: 'scale', pxPerUnit, unit, scaleRatio: ratio };
                this.closeAllModals();
                this.showToast(`✅ Calibrado 1:${ratio} · unidad: ${unit}`);
                this._activateMeasureLayers();
            },

            _startKnownObjectCalib: function () {
                if (!this._measureCalib._knownRefs) this._measureCalib._knownRefs = [];
                this.closeAllModals();
                const unit = document.getElementById('mcm-unit-known')?.value || document.getElementById('mcm-unit').value || 'cm';
                this._measureCalib._pendingUnit = unit;
                this._measureCalib._calibrating = true;
                this.showToast('📐 Traza una línea sobre un objeto de medida conocida…', 4000);
                this._activateMeasureLayers();
            },

            _finishKnownObjectCalib: function (pxDist) {
                const unit = this._measureCalib._pendingUnit || 'cm';
                const refs = this._measureCalib._knownRefs || [];
                const nextOrder = refs.length + 1;
                const pop = document.createElement('div');
                pop.id = 'mcm-known-popup';
                pop.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                    background:rgba(26,32,53,0.85);color:#f0f4ff;
                    border:1px solid rgba(255,255,255,0.18);border-radius:14px;
                    box-shadow:0 16px 48px rgba(0,0,0,0.6);
                    backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
                    padding:0;z-index:19000;display:flex;flex-direction:column;
                    min-width:320px;font-family:inherit;overflow:hidden;`;
                pop.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.12);">
                        <span style="font-weight:700;font-size:14px;color:#f0f4ff;">📏 Referencia #${nextOrder}</span>
                        <button onclick="document.getElementById('mcm-known-popup').remove();app._measureCalib._calibrating=false;app._openMeasureCalibModal();"
                            style="background:none;border:none;color:rgba(200,215,255,0.6);cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;">✕</button>
                    </div>
                    <div style="padding:18px;display:flex;flex-direction:column;gap:12px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <label style="font-size:11px;color:rgba(200,215,255,0.7);white-space:nowrap;">Medida real:</label>
                            <input id="mcm-known-val" type="number" min="0.001" step="any" placeholder="Ej: 10"
                                style="flex:1;padding:8px 12px;border:1px solid rgba(100,140,255,0.35);border-radius:8px;
                                       font-size:14px;background:rgba(10,15,35,0.7);color:#e8eeff;outline:none;height:36px;">
                            <span style="font-weight:600;font-size:13px;color:rgba(200,215,255,0.8);white-space:nowrap;">${unit}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <label style="font-size:11px;color:rgba(200,215,255,0.7);white-space:nowrap;">Orden de profundidad:</label>
                            <input id="mcm-known-depth" type="number" min="1" step="1" value="${nextOrder}"
                                style="width:60px;padding:8px 10px;border:1px solid rgba(100,140,255,0.35);border-radius:8px;
                                       font-size:14px;background:rgba(10,15,35,0.7);color:#e8eeff;outline:none;height:36px;text-align:center;">
                            <span style="font-size:10px;color:rgba(200,215,255,0.5);line-height:1.3;">1 = más cercano</span>
                        </div>
                        <div style="font-size:10px;color:rgba(200,215,255,0.4);background:rgba(255,255,255,0.04);border-radius:6px;padding:6px 10px;">
                            Px trazados: <strong style="color:rgba(200,215,255,0.7);">${pxDist.toFixed(1)} px</strong>
                        </div>
                        <div style="display:flex;gap:8px;justify-content:flex-end;">
                            <button onclick="document.getElementById('mcm-known-popup').remove();app._measureCalib._calibrating=false;app._openMeasureCalibModal();"
                                class="capsule-btn secondary" style="font-size:12px;">Cancelar</button>
                            <button onclick="app._confirmKnownCalib(${pxDist})"
                                class="capsule-btn primary" style="font-size:12px;">Agregar</button>
                        </div>
                    </div>`;
                document.body.appendChild(pop);
                setTimeout(() => document.getElementById('mcm-known-val')?.focus(), 50);
            },

            _confirmKnownCalib: function (pxDist) {
                const val = parseFloat(document.getElementById('mcm-known-val')?.value);
                if (!val || val <= 0) { this.showToast('⚠️ Valor inválido'); return; }
                const depthOrder = parseInt(document.getElementById('mcm-known-depth')?.value) || 1;
                const unit = this._measureCalib._pendingUnit || 'cm';
                const pxPerUnit = pxDist / val;
                if (!this._measureCalib._knownRefs) this._measureCalib._knownRefs = [];
                this._measureCalib._knownRefs.push({ pxDist, realVal: val, pxPerUnit, depthOrder, unit });
                document.getElementById('mcm-known-popup')?.remove();
                this.showToast(`✅ Referencia #${this._measureCalib._knownRefs.length} agregada`);
                this._openMeasureCalibModal();
                setTimeout(() => { this._mcmSwitchTab('known'); this._mcmRenderKnownTable(); }, 80);
            },

            _mcmRenderKnownTable: function () {
                const refs = this._measureCalib._knownRefs || [];
                const wrap = document.getElementById('mcm-known-table-wrap');
                const rows = document.getElementById('mcm-known-rows');
                const applyBtn = document.getElementById('mcm-known-apply-btn');
                const depthHint = document.getElementById('mcm-depth-hint');
                if (!rows || !wrap) return;
                wrap.style.display = refs.length ? '' : 'none';
                if (applyBtn) applyBtn.style.display = refs.length ? '' : 'none';
                const orders = [...new Set(refs.map(r => r.depthOrder))];
                if (depthHint) depthHint.style.display = refs.length >= 2 && orders.length >= 2 ? '' : 'none';
                rows.innerHTML = refs.map((r, i) => `
                    <div style="display:grid;grid-template-columns:1fr 70px 64px 28px;gap:4px;align-items:center;padding:4px 6px;border-radius:5px;background:var(--bg-ribbon,rgba(0,0,0,0.03));">
                        <span style="font-size:11px;color:var(--text-secondary,#666);">${r.pxDist.toFixed(1)} px</span>
                        <span style="font-size:11px;font-weight:600;color:var(--text-main,#222);">${r.realVal} ${r.unit}</span>
                        <div style="display:flex;align-items:center;justify-content:center;">
                            <input type="number" min="1" step="1" value="${r.depthOrder}"
                                onchange="app._mcmUpdateRefDepth(${i}, this.value)"
                                style="width:42px;padding:2px 4px;border:1px solid var(--border,#ccc);border-radius:4px;font-size:11px;text-align:center;background:var(--input-bg,#fff);color:var(--text-main,#222);">
                        </div>
                        <button onclick="app._mcmRemoveRef(${i})" style="background:none;border:none;color:var(--text-secondary,#aaa);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;" title="Eliminar">✕</button>
                    </div>`).join('');
            },

            _mcmUpdateRefDepth: function (idx, val) {
                if (this._measureCalib._knownRefs?.[idx]) {
                    this._measureCalib._knownRefs[idx].depthOrder = parseInt(val) || 1;
                    this._mcmRenderKnownTable();
                }
            },

            _mcmRemoveRef: function (idx) {
                this._measureCalib._knownRefs?.splice(idx, 1);
                this._mcmRenderKnownTable();
            },

            _applyKnownMultiCalib: function () {
                const refs = this._measureCalib._knownRefs;
                if (!refs || !refs.length) { this.showToast('⚠️ Agrega al menos una referencia'); return; }
                const unit = refs[0].unit;
                const avgPxPerUnit = refs.reduce((s, r) => s + r.pxPerUnit, 0) / refs.length;
                // Regresión lineal para curva de perspectiva (≥2 objetos con distinto depthOrder)
                let depthCurve = null;
                const orders = [...new Set(refs.map(r => r.depthOrder))];
                if (refs.length >= 2 && orders.length >= 2) {
                    const n = refs.length;
                    const sumX = refs.reduce((s, r) => s + r.depthOrder, 0);
                    const sumY = refs.reduce((s, r) => s + r.pxPerUnit, 0);
                    const sumXY = refs.reduce((s, r) => s + r.depthOrder * r.pxPerUnit, 0);
                    const sumX2 = refs.reduce((s, r) => s + r.depthOrder * r.depthOrder, 0);
                    const denom = n * sumX2 - sumX * sumX;
                    if (Math.abs(denom) > 1e-9) {
                        const b = (n * sumXY - sumX * sumY) / denom;
                        const a = (sumY - b * sumX) / n;
                        depthCurve = { a, b, basePxPerUnit: a + b * 1 };
                    }
                }
                this._measureCalib = {
                    calibrated: true, mode: 'known',
                    pxPerUnit: avgPxPerUnit, unit, scaleRatio: 1,
                    _knownRefs: refs, _depthCurve: depthCurve
                };
                this.closeAllModals();
                this._activateMeasureLayers();
                this.showToast(depthCurve
                    ? `✅ Calibrado · ${refs.length} refs · Profundidad activa`
                    : `✅ Calibrado · ${refs.length} ref(s) · 1 ${unit} = ${avgPxPerUnit.toFixed(2)} px`, 4000);
            },

            _initMeasureEvents: function (svg, panelId) {
                svg._measureInit = true;
                let drawing = false, startPt = null, tempLine = null, tempLabel = null;

                const NS = 'http://www.w3.org/2000/svg';
                const mmToPt = 2.834645669;

                const getScale = () => (this.splitView[panelId]?.scale) || this.currentScale || 1;

                // Conversión con calibración o fallback a cm por escala PDF
                const pxToUnit = px => {
                    const c = this._measureCalib;
                    if (c.calibrated && c.pxPerUnit) return px / c.pxPerUnit;
                    return px / (mmToPt * getScale() * 10); // fallback cm
                };

                const getUnit = () => (this._measureCalib.calibrated ? this._measureCalib.unit : 'cm');

                const svgPt = e => {
                    const r = svg.getBoundingClientRect();
                    return { x: e.clientX - r.left, y: e.clientY - r.top };
                };

                // Shift → restringir a H o V
                const constrainPt = (start, raw, shiftKey) => {
                    if (!shiftKey) return raw;
                    const dx = Math.abs(raw.x - start.x), dy = Math.abs(raw.y - start.y);
                    return dx >= dy ? { x: raw.x, y: start.y } : { x: start.x, y: raw.y };
                };

                const makeLine = (x1, y1, x2, y2, dashed) => {
                    const l = document.createElementNS(NS, 'line');
                    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
                    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
                    l.setAttribute('stroke', '#ffd700');
                    l.setAttribute('stroke-width', '2');
                    l.setAttribute('stroke-linecap', 'round');
                    if (dashed) l.setAttribute('stroke-dasharray', '6,3');
                    return l;
                };

                const makeEndTick = (x1, y1, x2, y2, perpLen = 7) => {
                    // Línea perpendicular al trazo en cada extremo
                    const dx = x2 - x1, dy = y2 - y1;
                    const len = Math.sqrt(dx*dx + dy*dy) || 1;
                    const nx = -dy / len * perpLen, ny = dx / len * perpLen;
                    const g = document.createElementNS(NS, 'g');
                    const mkT = (cx, cy) => {
                        const t = document.createElementNS(NS, 'line');
                        t.setAttribute('x1', cx - nx); t.setAttribute('y1', cy - ny);
                        t.setAttribute('x2', cx + nx); t.setAttribute('y2', cy + ny);
                        t.setAttribute('stroke', '#ff6b35'); t.setAttribute('stroke-width', '1.5');
                        return t;
                    };
                    g.appendChild(mkT(x1, y1)); g.appendChild(mkT(x2, y2));
                    return g;
                };

                const makeDot = (x, y) => {
                    const c = document.createElementNS(NS, 'circle');
                    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '4');
                    c.setAttribute('fill', '#ff6b35'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '1.5');
                    return c;
                };

                const makeLabel = (mx, my, lines) => {
                    const g = document.createElementNS(NS, 'g');
                    const lineH = 15, pad = 8;
                    const maxW = Math.max(...lines.map(l => l.length)) * 6.4 + pad * 2;
                    const totalH = lines.length * lineH + pad;
                    const bg = document.createElementNS(NS, 'rect');
                    bg.setAttribute('x', mx - maxW / 2); bg.setAttribute('y', my - totalH / 2);
                    bg.setAttribute('width', maxW); bg.setAttribute('height', totalH);
                    bg.setAttribute('rx', '5'); bg.setAttribute('fill', '#1a1a2e');
                    bg.setAttribute('opacity', '0.88');
                    g.appendChild(bg);
                    lines.forEach((txt, i) => {
                        const t = document.createElementNS(NS, 'text');
                        t.textContent = txt;
                        t.setAttribute('x', mx);
                        t.setAttribute('y', my - totalH / 2 + pad + i * lineH + lineH * 0.6);
                        t.setAttribute('fill', i === 0 ? '#ffd700' : '#aac8ff');
                        t.setAttribute('font-size', i === 0 ? '11.5' : '10');
                        t.setAttribute('font-family', 'Montserrat,Arial,sans-serif');
                        t.setAttribute('font-weight', i === 0 ? '700' : '500');
                        t.setAttribute('text-anchor', 'middle');
                        g.appendChild(t);
                    });
                    return g;
                };

                const calcAngle = (dx, dy) => {
                    let deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
                    return deg.toFixed(1) + '°';
                };

                svg.addEventListener('mousedown', e => {
                    if (!this.measureMode || e.button !== 0) return;
                    e.stopPropagation(); e.preventDefault();
                    drawing = true;
                    startPt = svgPt(e);
                    tempLine = makeLine(startPt.x, startPt.y, startPt.x, startPt.y, true);
                    svg.appendChild(tempLine);
                });

                svg.addEventListener('mousemove', e => {
                    if (!drawing || !startPt) return;
                    e.stopPropagation();
                    const raw = svgPt(e);
                    const pt = constrainPt(startPt, raw, e.shiftKey);
                    tempLine.setAttribute('x2', pt.x); tempLine.setAttribute('y2', pt.y);
                    const dx = pt.x - startPt.x, dy = pt.y - startPt.y;
                    const distPx = Math.sqrt(dx * dx + dy * dy);
                    const dist = pxToUnit(distPx).toFixed(3);
                    const unit = getUnit();
                    const angle = calcAngle(dx, dy);
                    if (tempLabel) tempLabel.remove();
                    const mx = (startPt.x + pt.x) / 2, my = (startPt.y + pt.y) / 2;
                    tempLabel = makeLabel(mx, my - 45, [`${dist} ${unit}`, `∠ ${angle}`]);
                    svg.appendChild(tempLabel);
                });

                svg.addEventListener('mouseup', e => {
                    if (!drawing) return;
                    e.stopPropagation();
                    drawing = false;
                    const raw = svgPt(e);
                    const pt = constrainPt(startPt, raw, e.shiftKey);
                    const dx = pt.x - startPt.x, dy = pt.y - startPt.y;
                    const distPx = Math.sqrt(dx * dx + dy * dy);
                    if (distPx < 5) { tempLine?.remove(); tempLabel?.remove(); startPt = null; return; }
                    tempLine.setAttribute('x2', pt.x); tempLine.setAttribute('y2', pt.y);
                    tempLine.setAttribute('stroke', '#ff6b35');
                    tempLine.removeAttribute('stroke-dasharray');
                    // Label final
                    if (tempLabel) tempLabel.remove();
                    const unit = getUnit();
                    const dist = pxToUnit(distPx).toFixed(3);
                    const angle = calcAngle(dx, dy);
                    const mx = (startPt.x + pt.x) / 2, my = (startPt.y + pt.y) / 2;
                    const labelLines = [`${dist} ${unit}`, `∠ ${angle}`];
                    const dc = this._measureCalib._depthCurve;
                    if (dc && this._measureCalib.calibrated) {
                        const apparentPxPerUnit = distPx / parseFloat(dist);
                        const depthRatio = dc.basePxPerUnit > 0 ? (dc.basePxPerUnit / apparentPxPerUnit) : null;
                        if (depthRatio && isFinite(depthRatio) && depthRatio > 0)
                            labelLines.push(`≈ prof. ×${depthRatio.toFixed(2)}`);
                    }
                    svg.appendChild(makeLabel(mx, my - 45, labelLines));
                    svg.appendChild(makeEndTick(startPt.x, startPt.y, pt.x, pt.y));
                    svg.appendChild(makeDot(startPt.x, startPt.y));
                    svg.appendChild(makeDot(pt.x, pt.y));

                    // Modo calibración: interceptar la primera línea
                    if (this._measureCalib._calibrating) {
                        this._measureCalib._calibrating = false;
                        this._finishKnownObjectCalib(distPx);
                    }

                    tempLine = null; tempLabel = null; startPt = null;
                });

                svg.addEventListener('contextmenu', e => {
                    e.preventDefault(); e.stopPropagation();
                    svg.innerHTML = '';
                });

                document.addEventListener('keydown', e => {
                    if (e.key === 'Escape' && this.measureMode) this.toggleMeasure();
                }, { passive: true });
            },

            _mcmSwitchTab: function (tab) {
                ['page','known','scale'].forEach(t => {
                    const btn = document.getElementById('mcm-tab-' + t);
                    const panel = document.getElementById('mcm-panel-' + t);
                    const active = t === tab;
                    if (btn) {
                        btn.style.borderBottom = active ? '2px solid var(--accent,#185abd)' : '2px solid transparent';
                        btn.style.color = active ? 'var(--accent,#185abd)' : 'var(--text-secondary,#888)';
                    }
                    if (panel) panel.style.display = active ? '' : 'none';
                });
                if (tab === 'page') this._mcmUpdatePageInfo();
            },

            _mcmUpdatePageInfo: function () {
                const info = document.getElementById('mcm-page-info');
                if (!info) return;
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) { info.textContent = '⚠️ No hay documento cargado'; return; }
                const pData = doc.pages[doc.currentIndex || 0];
                const src = doc.sources[pData?.sourceId];
                if (!src?.doc && !src?.buffer) { info.textContent = '⚠️ Fuente no disponible'; return; }
                // Usar datos de dimensión de la página actual (pts)
                const panelState = this.splitView[this.splitView.activePanel];
                const scale = panelState?.scale || this.currentScale || 1;
                const mmToPt = 2.834645669;
                const unit = document.getElementById('mcm-unit')?.value || 'cm';
                const unitFactors = { mm: 1, cm: 10, m: 1000, 'in': 25.4 };
                const mmPerUnit = unitFactors[unit] || 10;
                // Dimensiones del canvas actual
                const cvs = this.getPanelElements(this.splitView.activePanel)?.canvas;
                if (cvs && cvs.width && cvs.height) {
                    const wPt = cvs.width / scale;
                    const hPt = cvs.height / scale;
                    const wMm = wPt / mmToPt, hMm = hPt / mmToPt;
                    const wU = (wMm / mmPerUnit).toFixed(1), hU = (hMm / mmPerUnit).toFixed(1);
                    // Tamaño de página conocido
                    let sizeName = '';
                    const wMmR = Math.round(wMm), hMmR = Math.round(hMm);
                    if ((wMmR===210&&hMmR===297)||(wMmR===297&&hMmR===210)) sizeName = ' (A4)';
                    else if ((wMmR===216&&hMmR===279)||(wMmR===279&&hMmR===216)) sizeName = ' (Carta)';
                    else if ((wMmR===297&&hMmR===420)||(wMmR===420&&hMmR===297)) sizeName = ' (A3)';
                    else if ((wMmR===148&&hMmR===210)||(wMmR===210&&hMmR===148)) sizeName = ' (A5)';
                    info.innerHTML = `📄 Página actual${sizeName}: <strong>${wU} × ${hU} ${unit}</strong><br>
                        <span style="font-size:10.5px;color:var(--text-secondary,#888);">${wPt.toFixed(1)} × ${hPt.toFixed(1)} pt · ${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm · Zoom actual: ${(scale*100).toFixed(0)}%</span>`;
                } else {
                    info.textContent = '⚠️ Renderiza una página primero';
                }
            },

            clearMeasurements: function () {
                ['', '-secondary'].forEach(s => {
                    const svg = document.getElementById('measure-layer' + s);
                    if (svg) svg.innerHTML = '';
                });
            },

            addText: function (initialText = "Doble click para editar") {
                this._exitContinuousIfNeeded();
                this.saveState();
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) return;
                const center = this.getVisibleCenter();
                const o = {
                    id: 'o' + Date.now() + Math.random().toString().substr(2, 5), type: 'text',
                    x: center.x - 100, y: center.y - 20, width: 200, height: 40, text: initialText,
                    font: 'Helvetica', size: 20, color: '#000000', bgColor: '#ffffff',
                    bgAlpha: 0, bold: false, italic: false, rotation: 0, scaleX: 1, scaleY: 1, isEditing: true
                };
                doc.pages[doc.currentIndex].objects.push(o);
                this.selectedObj = o;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(o.id);
                this.renderOverlays();
                this.renderSidebar();
            },

            // ============================================================
            // SMART PATCH (FAKE EDIT) - Editar texto cubriendo el original
            // ============================================================

            /**
             * Activa el modo de edición real de texto (selección nativa + borrado + overlay editable)
             */
            enableSmartPatch: function () { this.activateRealTextEditor(); },

            // ============================================================
            // EDITAR IMÁGENES (Surgical Extraction)
            // ============================================================

            /**
             * Activa el modo para tocar una imagen y extraerla
             */
            enableImageEdit: function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) {
                    this.showToast("⚠️ Abre un documento primero");
                    return;
                }

                console.log('🖼️ Edit Image: Activando modo...');

                if (this.isTextSelectMode) this.toggleTextSelectMode();
                if (this.isHandMode) this.toggleHandMode();
                if (this.isDrawingMode) this.setDrawTool('none');
                if (this.smartPatchMode) {
                    this.smartPatchMode = false;
                    const btn = document.getElementById('btn-smart-patch');
                    if (btn) btn.classList.remove('active');
                    window.removeEventListener('mouseup', this.smartPatchMouseUp);
                }
                // FIX: Pausar vista continua (incompatible con captureImageForEdit)
                this._exitContinuousIfNeeded();

                this.imageEditMode = true;

                const canvas = document.getElementById('the-canvas');
                const overlayLayer = document.getElementById('overlay-layer');
                const annotationLayer = document.getElementById('annotation-layer');

                if (canvas) canvas.style.cursor = 'crosshair';
                if (overlayLayer) overlayLayer.style.cursor = 'crosshair';
                if (annotationLayer) annotationLayer.style.cursor = 'crosshair';
                document.body.classList.add('image-edit-mode');

                const btn = document.getElementById('btn-edit-image');
                if (btn) btn.classList.add('active');

                this.showToast("🖼️ Haz click sobre una imagen para hacerla interactiva", 4000);

                this.imageEditMouseUp = (e) => {
                    if (!this.imageEditMode) return;
                    if (e.target.closest('.modal') || e.target.closest('.toast') || e.target.closest('.toolbar')) return;

                    this.captureImageForEdit(e);
                };

                // setTimeout evita que el mouseup del botón active el listener inmediatamente
                setTimeout(() => {
                    if (this.imageEditMode) {
                        window.addEventListener('mouseup', this.imageEditMouseUp);
                    }
                }, 200);
            },

            captureImageForEdit: async function (e) {
                // Desactivar tras el primer click
                this.imageEditMode = false;
                window.removeEventListener('mouseup', this.imageEditMouseUp);

                const btn = document.getElementById('btn-edit-image');
                if (btn) btn.classList.remove('active');

                // Restaurar cursores
                const canvas = document.getElementById('the-canvas');
                const overlayLayer = document.getElementById('overlay-layer');
                const annotationLayer = document.getElementById('annotation-layer');
                if (canvas) canvas.style.cursor = 'default';
                if (overlayLayer) overlayLayer.style.cursor = 'default';
                if (annotationLayer) annotationLayer.style.cursor = 'default';
                document.body.classList.remove('image-edit-mode');

                if (!window.PythonManager || !PythonManager.isLoaded) {
                    this.showToast("⚠️ El motor avanzado (Python) no está cargado.");
                    return;
                }

                const doc = this.getDoc();
                const pageNum = doc.currentIndex;
                const page = doc.pages[pageNum];
                const src = doc.sources[page.sourceId];

                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) / this.currentScale;
                const y = (e.clientY - rect.top) / this.currentScale;

                // PDF points Y goes from bottom up para PyMuPDF get_images en algunas versiones, 
                // Pero wait, fitz.Point(x,y) en nuestro backend usaba el Y estandar Top-Down de PyMuPDF.
                // PyMuPDF usa coordinadas Top-Down (origen en top-left) a menos que se transforme.
                // Así que enviaremos 'y' directamente (origen top-left del canvas calza con top-left de fitz).

                this.toggleLoader(true, "Extrayendo imagen quirúrgicamente...");

                try {
                    const result = await PythonManager.extractAndEraseImageAtPoint(src.buffer, pageNum, x, y);

                    if (!result) {
                        this.showToast("❌ No se detectó ninguna imagen en ese punto.");
                        this.toggleLoader(false);
                        return;
                    }

                    // Guardar buffer original ANTES de modificar, luego guardar estado CON overlay
                    const origBuffer = src.buffer.slice(0);

                    // Actualizar el PDF subyacente
                    src.buffer = result.buffer;
                    src.doc = null; // Forzar recarga de pdfjs
                    await this.loadPage(doc.currentIndex);

                    // Insertar imagen como objeto frontal
                    const o = {
                        id: 'img_surg_' + Date.now(),
                        type: 'image',
                        x: result.bbox.x,
                        y: result.bbox.y,
                        width: result.bbox.w,
                        height: result.bbox.h,
                        src: result.base64,
                        rotation: 0,
                        scaleX: 1,
                        scaleY: 1,
                        opacity: 100
                    };

                    page.objects.push(o);

                    // Guardar estado DESPUÉS de agregar overlay (así undo mantiene el objeto)
                    // y también guardar buffer original para restaurar en undo
                    this.saveState();
                    // Asociar buffer original al último estado para restaurarlo en undo
                    const lastIdx = doc.historyIndex;
                    if (!doc._historyBuffers) doc._historyBuffers = {};
                    doc._historyBuffers[lastIdx] = { sourceId: page.sourceId, buffer: origBuffer };

                    this.selectedObj = o;
                    this.multiObjectSelection.clear();
                    this.multiObjectSelection.add(o.id);

                    this.renderOverlays();
                    this.renderSidebar();
                    this.showToast("✅ Imagen aislada exitosamente!");

                } catch (err) {
                    console.error("Error capturando imagen", err);
                    this.showToast("❌ Error al procesar imagen");
                }
                this.toggleLoader(false);
            },

            /**
             * Captura el área de texto donde el usuario hizo click o selección
             */
            captureTextAreaForPatch: async function (e, areaSelection = null) {
                // 🚨 RESET: Limpiar datos anteriores para que no se hereden en la nueva detección
                this.smartPatchData = null;
                this._pendingTextureSample = null;
                this._pendingTexturePromise = null;
                this._pendingEraseRect = null;
                this._preEraseBuffer = null;
                const wasActive = this.smartPatchMode;
                if (!wasActive && !areaSelection) {
                    this._realEditMode = false;
                    return;
                }
                this.smartPatchMode = false;

                console.log('🔍 Iniciando captura de texto (V4 - Enhanced)...');

                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const src = doc.sources[page.sourceId];

                // Solo funciona con páginas PDF
                if (!src || !src.buffer) {
                    console.log('⚠️ No es PDF o no tiene buffer');
                    this.showToast('⚠️ Smart Patch solo funciona en páginas PDF');
                    this.cancelSmartPatch();
                    return;
                }

                const canvas = document.getElementById('the-canvas');
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) / this.currentScale;
                const y = (e.clientY - rect.top) / this.currentScale;

                console.log(`📍 Click en coordenadas canvas: (${x.toFixed(2)}, ${y.toFixed(2)}), escala: ${this.currentScale}`);

                try {
                    // Cargar documento PDF si no está cargado
                    if (!src.doc) {
                        console.log('📄 Cargando documento PDF...');
                        src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    }

                    const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                    const textContent = await pdfPage.getTextContent({ includeMarkedContent: false });
                    const viewport = pdfPage.getViewport({ scale: 1.0 });

                    console.log(`📏 Viewport PDF: ${viewport.width} x ${viewport.height}`);
                    console.log(`📝 Total de elementos de texto: ${textContent.items.length}`);

                    // ── 🔵 V4: Extraer metadata de fuentes de PDF.js ──
                    let fontStyles = {};
                    try {
                        if (textContent.styles) {
                            fontStyles = textContent.styles;
                            console.log('📋 Estilos de fuente disponibles:', Object.keys(fontStyles).length);
                        }
                    } catch (fErr) {
                        console.warn('⚠️ No se pudieron obtener estilos de fuente:', fErr);
                    }

                    // Convertir coordenadas del canvas al sistema PDF
                    const pdfY = viewport.height - y;
                    console.log(`📍 Click en coordenadas PDF: (${x.toFixed(2)}, ${pdfY.toFixed(2)})`);

                    // Filtrar solo elementos con texto visible
                    // 🚨 V5: Ignorar elementos que ya están cubiertos por un Smart Patch previo
                    const validTextItems = textContent.items.filter(item => {
                        const text = item.str ? item.str.trim() : '';
                        if (text.length === 0) return false;

                        // Verificar si existe un objeto tipo 'text' (parche) cubriendo esta área
                        const isCovered = (page.objects || []).some(o => {
                            if (o.type !== 'text') return false;
                            const itemTop = viewport.height - (item.transform[5] + Math.abs(item.transform[3]));
                            const itemLeft = item.transform[4];
                            // Si el parche cubre el centro del item, lo ignoramos
                            return (o.x < itemLeft + item.width * 0.5 && o.x + o.width > itemLeft + item.width * 0.5 &&
                                o.y < itemTop + Math.abs(item.transform[3]) * 0.5 && o.y + o.height > itemTop + Math.abs(item.transform[3]) * 0.5);
                        });
                        return !isCovered;
                    });

                    console.log(`🔍 Elementos válidos con texto: ${validTextItems.length} de ${textContent.items.length}`);

                    if (validTextItems.length === 0) {
                        console.log('❌ No hay elementos de texto válidos en esta página');
                        this.showToast('⚠️ No se encontró texto en esta página');
                        this.cancelSmartPatch();
                        return;
                    }

                    // Buscar el texto más cercano al punto clickeado
                    let closestItem = null;
                    if (areaSelection && areaSelection.text && areaSelection.text.trim()) {
                        const selText = areaSelection.text.trim();
                        // La altura del drag no identifica líneas: en fuentes pequeñas el rectángulo
                        // de selección puede ser alto aunque el Range pertenezca a una sola fila.
                        const selectedLineCount = Math.max(1, Number(areaSelection.lineCount) || 1);
                        const isMultiLine = selText.includes('\n') || selectedLineCount > 1;

                        if (isMultiLine) {
                            // ── SELECCIÓN MULTILÍNEA: usar búsqueda geométrica del área ──
                            // El texto multilínea nunca cabe en un solo span PDF, usar coordenadas del drag.
                            // Si w=0 (drag vertical), usar ancho completo del viewport PDF.
                            const effectiveW = (areaSelection.w && areaSelection.w > 10)
                                ? areaSelection.w
                                : viewport.width * this.currentScale;
                            const effectiveH = areaSelection.h || 30;
                            const pdfX_min = areaSelection.x ? (areaSelection.x / this.currentScale) : 0;
                            const pdfY_max = viewport.height - ((areaSelection.y || 0) / this.currentScale);
                            const pdfY_min = viewport.height - (((areaSelection.y || 0) + effectiveH) / this.currentScale);
                            const pdfX_max = pdfX_min + (effectiveW / this.currentScale);

                            let selectedItems = validTextItems.filter(item => {
                                const itemXmin = item.transform[4];
                                const itemXmax = itemXmin + item.width;
                                const itemYmin = item.transform[5];
                                const itemYmax = itemYmin + Math.abs(item.transform[3]);
                                const centerX = (itemXmin + itemXmax) / 2;
                                const centerY = (itemYmin + itemYmax) / 2;
                                const centerInBox = centerX < pdfX_max + 5 && centerX > pdfX_min - 5 &&
                                    centerY < pdfY_max + 5 && centerY > pdfY_min - 5;
                                const intersectsX = Math.max(0, Math.min(itemXmax, pdfX_max) - Math.max(itemXmin, pdfX_min)) > 0;
                                const intersectsY = itemYmin < pdfY_max && itemYmax > pdfY_min;
                                return centerInBox || (intersectsX && intersectsY);
                            });

                            if (selectedItems.length === 0) {
                                // fallback: ítem más cercano al centro del área
                                const boxCX = (pdfX_min + pdfX_max) / 2;
                                const boxCY = (pdfY_min + pdfY_max) / 2;
                                let bestD = Infinity, bestItem = null;
                                validTextItems.forEach(it => {
                                    const d = Math.sqrt(Math.pow((it.transform[4] + it.width / 2) - boxCX, 2) + Math.pow((it.transform[5] + Math.abs(it.transform[3]) / 2) - boxCY, 2));
                                    if (d < bestD) { bestD = d; bestItem = it; }
                                });
                                if (bestItem) selectedItems.push(bestItem);
                            }

                            if (selectedItems.length > 0) {
                                // Ordenar top-to-bottom, left-to-right
                                selectedItems.sort((a, b) => {
                                    const avgH = Math.abs(a.transform[3]);
                                    const yDiff = b.transform[5] - a.transform[5];
                                    if (Math.abs(yDiff) > avgH * 0.4) return yDiff > 0 ? 1 : -1;
                                    return a.transform[4] - b.transform[4];
                                });

                                // Agrupar por líneas
                                const avgH = selectedItems.reduce((s, it) => s + Math.abs(it.transform[3]), 0) / selectedItems.length;
                                const lineTol = Math.max(3, avgH * 0.5);
                                const lines = [];
                                let curLine = [], curY = selectedItems[0].transform[5];
                                for (const it of selectedItems) {
                                    if (Math.abs(it.transform[5] - curY) > lineTol) { lines.push(curLine); curLine = []; curY = it.transform[5]; }
                                    curLine.push(it);
                                }
                                if (curLine.length) lines.push(curLine);

                                // Reconstruir texto desde spans PDF con detección de espacios geométrica
                                // (selText del browser concatena sin espacios en PDFs con posicionamiento por caracteres)
                                const _joinLineGeo = (line) => {
                                    let result = '';
                                    for (let i = 0; i < line.length; i++) {
                                        const item = line[i];
                                        if (i === 0) { result = item.str; continue; }
                                        const prev = line[i - 1];
                                        const prevEnd = prev.transform[4] + (prev.width || 0);
                                        const currStart = item.transform[4];
                                        const gap = currStart - prevEnd;
                                        const thr = Math.abs(item.transform[0]) * 0.25;
                                        const needsSpace = gap > thr && !result.endsWith(' ') && !item.str.startsWith(' ');
                                        result += (needsSpace ? ' ' : '') + item.str;
                                    }
                                    return result;
                                };
                                // Si hay múltiples líneas geométricas, reconstruir con \n; si es 1 item, fallback a selText
                                const _geoText = lines.length > 1
                                    ? lines.map(l => _joinLineGeo(l)).join('\n')
                                    : (lines[0] && lines[0].length > 1 ? _joinLineGeo(lines[0]) : selText);
                                console.log(`🔵 [DRAG-TEXT] lines=${lines.length} items=${selectedItems.length} selTextLen=${selText.length} geoTextLen=${_geoText.length} geoPreview="${_geoText.replace(/\n/g,'↵').substring(0,120)}"`);

                                // ── Col-capture: expandir al ancho real de las líneas ──
                                // Si el drag capturó solo parte de las líneas, buscar todos los items
                                // en las mismas filas Y y expandir texto + ancho al total real.
                                const _ltFull = Math.max(3, Math.abs(selectedItems[0].transform[3]) * 0.5);
                                const _selYKeys = [...new Set(selectedItems.map(it => Math.round(it.transform[5] / _ltFull)))];
                                const _fullItems = validTextItems.filter(it => {
                                    const yk = Math.round(it.transform[5] / _ltFull);
                                    return _selYKeys.some(k => Math.abs(yk - k) <= 1);
                                });
                                const _fAllL = _fullItems.map(it => it.transform[4]);
                                const _fAllR = _fullItems.map(it => it.transform[4] + it.width);
                                const _fMinX = _fAllL.length ? Math.min(..._fAllL) : pdfX_min;
                                const _fMaxX = _fAllR.length ? Math.max(..._fAllR) : pdfX_max;
                                const _isColCapture = _fMaxX > pdfX_max + 15 && _fullItems.length > selectedItems.length;

                                let finalText = _geoText;
                                let finalMinX = Math.min(...selectedItems.map(l => l.transform[4]));
                                let finalMaxX = Math.max(...selectedItems.map(l => l.transform[4] + l.width));

                                if (_isColCapture) {
                                    _fullItems.sort((a, b) => {
                                        const yd = b.transform[5] - a.transform[5];
                                        if (Math.abs(yd) > _ltFull) return yd > 0 ? 1 : -1;
                                        return a.transform[4] - b.transform[4];
                                    });
                                    const _fls = []; let _fc = [], _fy = _fullItems[0].transform[5];
                                    for (const it of _fullItems) {
                                        if (Math.abs(it.transform[5] - _fy) > _ltFull) { _fls.push(_fc); _fc = []; _fy = it.transform[5]; }
                                        _fc.push(it);
                                    }
                                    if (_fc.length) _fls.push(_fc);
                                    finalText = _fls.map(l => _joinLineGeo(l)).join('\n');
                                    finalMinX = _fMinX;
                                    finalMaxX = _fMaxX;
                                    console.log(`🔵 [FULL-LINE-PARA] col-capture: items ${selectedItems.length}→${_fullItems.length} w ${(pdfX_max-pdfX_min).toFixed(1)}→${(_fMaxX-_fMinX).toFixed(1)}`);
                                }

                                const allTop = selectedItems.map(l => l.transform[5] + Math.abs(l.transform[3]));
                                const allBot = selectedItems.map(l => l.transform[5]);
                                const firstItem = selectedItems[0];

                                closestItem = {
                                    ...firstItem,
                                    str: finalText,
                                    width: finalMaxX - finalMinX,
                                    transform: [firstItem.transform[0], firstItem.transform[1], firstItem.transform[2], firstItem.transform[3], finalMinX, Math.min(...allBot)],
                                    isParagraph: true,
                                    textAlign: 'left',
                                    visualHeight: Math.max(...allTop) - Math.min(...allBot)
                                };
                            }
                        } else {
                            // ── SELECCIÓN DE PALABRA/LÍNEA SIMPLE ──
                            // Si drag real (w>0,h>0), usar el centro del área para discriminar duplicados en distintas líneas.
                            let pdfClickX = x;
                            let pdfClickY = pdfY;
                            if (areaSelection && areaSelection.w > 0 && areaSelection.h > 0) {
                                pdfClickX = (areaSelection.x + areaSelection.w / 2) / this.currentScale;
                                pdfClickY = viewport.height - ((areaSelection.y + areaSelection.h / 2) / this.currentScale);
                            }

                            let exactMatch = null, bestExactD = Infinity;
                            // Primero: buscar ítem cuyo str sea EXACTAMENTE selText (máxima precisión)
                            validTextItems.forEach(it => {
                                if (!it.str || it.str.trim() !== selText) return;
                                const itCX = it.transform[4] + it.width / 2;
                                const itCY = it.transform[5] + Math.abs(it.transform[3]) / 2;
                                const d = Math.sqrt(Math.pow(pdfClickX - itCX, 2) + Math.pow(pdfClickY - itCY, 2));
                                if (d < bestExactD) { bestExactD = d; exactMatch = it; }
                            });
                            // Fallback: buscar ítem que CONTENGA selText (para selecciones parciales de span)
                            if (!exactMatch) {
                                validTextItems.forEach(it => {
                                    if (!it.str || !it.str.includes(selText)) return;
                                    const itCX = it.transform[4] + it.width / 2;
                                    const itCY = it.transform[5] + Math.abs(it.transform[3]) / 2;
                                    const d = Math.sqrt(Math.pow(pdfClickX - itCX, 2) + Math.pow(pdfClickY - itCY, 2));
                                    if (d < bestExactD) { bestExactD = d; exactMatch = it; }
                                });
                            }
                            console.log(`🔍 [Bug3] selText="${selText.substring(0,30)}" exactMatch="${exactMatch?.str?.substring(0,40)}" dist=${bestExactD.toFixed(1)}`);

                            let fontRefItem = null, bestFD = Infinity;
                            validTextItems.forEach(it => {
                                const itCX = it.transform[4] + it.width / 2;
                                const itCY = it.transform[5] + Math.abs(it.transform[3]) / 2;
                                const d = Math.sqrt(Math.pow(pdfClickX - itCX, 2) + Math.pow(pdfClickY - itCY, 2));
                                if (d < bestFD) { bestFD = d; fontRefItem = it; }
                            });

                            const refItem = exactMatch || fontRefItem;
                            if (refItem) {
                                let finalX = refItem.transform[4];
                                let finalY = refItem.transform[5];
                                let finalW = refItem.width;
                                const lineH = Math.abs(refItem.transform[3]);
                                
                                // Si usamos fontRefItem (no hubo exactMatch), NO confiamos en selText 
                                // (el navegador pudo haber concatenado spans enteros tras una edición previa).
                                // Usamos el string original del PDF (refItem.str).
                                const finalStr = exactMatch ? selText : refItem.str;

                                if (exactMatch && exactMatch.str !== selText) {
                                    // Prefer domRect (pixel-accurate) over char-ratio estimation
                                    if (areaSelection && areaSelection.domRect && areaSelection.domRect.width > 0) {
                                        const cvs = document.getElementById('the-canvas');
                                        const cvsRect = cvs ? cvs.getBoundingClientRect() : null;
                                        if (cvsRect) {
                                            const scale = this.currentScale;
                                            finalX = (areaSelection.domRect.left - cvsRect.left) / scale;
                                            finalW = areaSelection.domRect.width / scale;
                                            const domTopPdf = (areaSelection.domRect.top - cvsRect.top) / scale;
                                            finalY = viewport.height - domTopPdf - lineH * 0.77;
                                            console.log(`📐 [Bug3 domRect] selText="${selText.substring(0,20)}" finalX=${finalX.toFixed(1)} finalW=${finalW.toFixed(1)}`);
                                        }
                                    } else {
                                        const wordStart = exactMatch.str.indexOf(selText);
                                        if (wordStart >= 0) {
                                            const measureCanvas = document.createElement('canvas');
                                            const measureCtx = measureCanvas.getContext('2d');
                                            const cleanFamily = (exactMatch.fontName || '')
                                                .replace(/^[A-Z]{6}\+/, '')
                                                .replace(/[-_]/g, ' ')
                                                .replace(/\b(Bold|Italic|Oblique|MT|PS|Regular|Roman|SemiBold|Condensed|Narrow|Negrita|Black|Heavy|Demibold|DemiboldOblique)\b/gi, '')
                                                .trim() || 'Arial';
                                            const isBold = /bold/i.test(exactMatch.fontName || '');
                                            const isItalic = /italic|oblique/i.test(exactMatch.fontName || '');
                                            measureCtx.font = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${lineH}px "${cleanFamily}"`;
                                            
                                            const prefix = exactMatch.str.substring(0, wordStart);
                                            const prefixW = measureCtx.measureText(prefix).width;
                                            const selW = measureCtx.measureText(selText).width;
                                            const totalW = measureCtx.measureText(exactMatch.str).width;
                                            
                                            const scaleRatio = exactMatch.width / (totalW || 1);
                                            finalX = exactMatch.transform[4] + prefixW * scaleRatio;
                                            finalW = selW * scaleRatio;
                                            console.log(`📐 [Canvas Measure Precision] selText="${selText}" prefix="${prefix}" scaleRatio=${scaleRatio.toFixed(3)} finalX=${finalX.toFixed(1)} finalW=${finalW.toFixed(1)}`);
                                        } else {
                                            const charRatio = selText.length / exactMatch.str.length;
                                            finalX = exactMatch.transform[4];
                                            finalW = charRatio * exactMatch.width;
                                            console.log(`📐 [Canvas Measure Fallback] selText="${selText}" charRatio=${charRatio.toFixed(2)} finalW=${finalW.toFixed(1)}`);
                                        }
                                    }
                                }

                                const lineCount = finalStr.split('\n').length;
                                const finalH = lineH * lineCount * 1.2;

                                closestItem = {
                                    ...refItem,
                                    str: finalStr,
                                    width: finalW,
                                    transform: [refItem.transform[0], refItem.transform[1], refItem.transform[2], refItem.transform[3], finalX, finalY],
                                    isParagraph: finalStr.indexOf('\n') >= 0,
                                    textAlign: 'left',
                                    visualHeight: finalH,
                                    _domTopPdf: areaSelection?.domRect && document.getElementById('the-canvas')
                                        ? (areaSelection.domRect.top - document.getElementById('the-canvas').getBoundingClientRect().top) / this.currentScale
                                        : null,
                                    // Usar coords de la sub-palabra (finalX/finalW), no del span completo
                                    _refItemX: finalX,
                                    _refItemW: finalW,
                                    _isSubSpan: !!(exactMatch && exactMatch.str !== selText)
                                };
                            }
                        }
                    } else if (areaSelection) {
                        // ── DRAG SIN TEXTO: búsqueda geométrica original ──
                        const pdfX_min = areaSelection.x / this.currentScale;
                        const pdfY_max = viewport.height - (areaSelection.y / this.currentScale);
                        const pdfY_min = viewport.height - ((areaSelection.y + areaSelection.h) / this.currentScale);
                        const pdfX_max = pdfX_min + (areaSelection.w / this.currentScale);

                        console.log(`📐 PDF Area: X(${pdfX_min.toFixed(1)} to ${pdfX_max.toFixed(1)}), Y(${pdfY_min.toFixed(1)} to ${pdfY_max.toFixed(1)})`);
                        console.log(`📐 [AREA-SEL] areaSelection.text=${JSON.stringify((areaSelection.text||'').substring(0,80))} | len=${(areaSelection.text||'').length} | w=${areaSelection.w?.toFixed(0)} h=${areaSelection.h?.toFixed(0)}`);

                        let selectedItems = validTextItems.filter(item => {
                            const itemXmin = item.transform[4];
                            const itemXmax = itemXmin + item.width;
                            const itemYmin = item.transform[5];
                            const itemYmax = itemYmin + Math.abs(item.transform[3]);

                            const overlapX = Math.max(0, Math.min(itemXmax, pdfX_max) - Math.max(itemXmin, pdfX_min));

                            // Más permisivo: Si hay cualquier cruce horizontal Y vertical, lo incluimos.
                            // Esto soluciona el problema donde selecciones apuradas no atrapaban el texto.
                            const intersectsX = overlapX > 0;
                            const intersectsY = (itemYmin < pdfY_max && itemYmax > pdfY_min);

                            const centerX = (itemXmin + itemXmax) / 2;
                            const centerY = (itemYmin + itemYmax) / 2;
                            // Tolerancia para el centro (si el centro está justo en el borde, también lo tomamos)
                            const centerInBox = (centerX < pdfX_max + 1 && centerX > pdfX_min - 1 &&
                                centerY < pdfY_max + 1 && centerY > pdfY_min - 1);

                            return centerInBox || (intersectsX && intersectsY);
                        });

                        // FALLBACK: Si no hay nada "dentro", buscar lo más cercano al centro del box
                        if (selectedItems.length === 0) {
                            const boxCX = (pdfX_min + pdfX_max) / 2;
                            const boxCY = (pdfY_min + pdfY_max) / 2;
                            let bestD = Infinity;
                            let bestItem = null;
                            validTextItems.forEach(it => {
                                const dist = Math.sqrt(Math.pow((it.transform[4] + it.width / 2) - boxCX, 2) + Math.pow((it.transform[5] + Math.abs(it.transform[3]) / 2) - boxCY, 2));
                                if (dist < bestD && dist < 50) { bestD = dist; bestItem = it; }
                            });
                            if (bestItem) selectedItems.push(bestItem);
                        }

                        if (selectedItems.length > 0) {
                            // ── EXPANSIÓN DE BLOQUE ──
                            // Si todos los items seleccionados tienen la misma baseline (fragmentos de 1 línea PDF),
                            // el drag del usuario realmente abarca más líneas visuales de las que pdfjs detectó.
                            // Buscar en validTextItems los items con el mismo fontName/size que estén dentro
                            // del rango Y extendido del drag (pdfY_min..pdfY_max) para capturar el bloque completo.
                            const refFont  = selectedItems[0].fontName || '';
                            const refSize  = Math.abs(selectedItems[0].transform[3]);
                            const allBaselines = selectedItems.map(it => it.transform[5]);
                            const uniqueBaselines = [...new Set(allBaselines.map(y => Math.round(y * 10) / 10))];

                            // Solo expandir si NO hay selección de texto real del usuario
                            const hasUserTextSelection = areaSelection && areaSelection.text && areaSelection.text.trim();
                            if (!hasUserTextSelection && uniqueBaselines.length === 1) {
                                // Todos en la misma baseline → buscar ítems contiguos en el rango del drag
                                const expandedItems = validTextItems.filter(item => {
                                    const iSize = Math.abs(item.transform[3]);
                                    const iY    = item.transform[5];
                                    const iFont = item.fontName || '';
                                    const sameStyle = Math.abs(iSize - refSize) < 1.5
                                        && (iFont === refFont || refFont === '' || iFont === '');
                                    const inDragY = (iY + iSize) > pdfY_min && iY < pdfY_max;
                                    return sameStyle && inDragY;
                                });
                                if (expandedItems.length > selectedItems.length) {
                                    selectedItems = expandedItems;
                                    console.log(`📦 Real Edit: bloque expandido a ${expandedItems.length} items`);
                                }
                            }

                            // Ordenar: arriba a abajo (mayor Y PDF = más arriba), luego izq a der
                            selectedItems.sort((a, b) => {
                                const yDiff = b.transform[5] - a.transform[5];
                                if (Math.abs(yDiff) > 3) return yDiff > 0 ? 1 : -1;
                                return a.transform[4] - b.transform[4];
                            });

                            // Agrupar por línea usando tolerancia proporcional al font size
                            const avgH = selectedItems.reduce((s, it) => s + Math.abs(it.transform[3]), 0) / selectedItems.length;
                            const lineTol = Math.max(3, avgH * 0.5);
                            const lines = [];
                            let currentLine = [];
                            let currentY = selectedItems[0].transform[5];
                            for (const item of selectedItems) {
                                if (Math.abs(item.transform[5] - currentY) > lineTol) {
                                    lines.push(currentLine);
                                    currentLine = [];
                                    currentY = item.transform[5];
                                }
                                currentLine.push(item);
                            }
                            if (currentLine.length) lines.push(currentLine);
                            console.log(`📦 [EXPAND] ${selectedItems.length} items, ${lines.length} líneas | isParagraph=${lines.length > 1}`);
                            selectedItems.slice(0,3).forEach((it,i) => console.log(`   [ITEM${i}] str="${it.str}" x=${it.transform[4].toFixed(1)} y=${it.transform[5].toFixed(1)} w=${(it.width||0).toFixed(1)} fs=${Math.abs(it.transform[3]).toFixed(1)}`));

                            // Priorizar el texto exacto seleccionado por el usuario (palabra/línea/multi-línea)
                            // Solo reconstruir desde items PDF si no hay selección de texto real disponible
                            const joinLineWithSpaces = (line) => {
                                let result = '';
                                for (let i = 0; i < line.length; i++) {
                                    const item = line[i];
                                    const str = item.str;
                                    if (i === 0) { result = str; continue; }
                                    const prev = line[i - 1];
                                    const prevEnd = prev.transform[4] + prev.width;
                                    const currStart = item.transform[4];
                                    const gap = currStart - prevEnd;
                                    const spaceThreshold = Math.abs(item.transform[0]) * 0.25;
                                    const needsSpace = gap > spaceThreshold && !result.endsWith(' ') && !str.startsWith(' ');
                                    result += (needsSpace ? ' ' : '') + str;
                                }
                                return result;
                            };
                            // ── DEBUG PATH ──
                            const _hasAreaText = !!(areaSelection && areaSelection.text && areaSelection.text.trim());
                            console.log(`🔵 [PARA-PATH] hasAreaText=${_hasAreaText} | areaText="${_hasAreaText ? areaSelection.text.trim().replace(/\n/g,'↵').substring(0,100) : 'null'}"`);
                            console.log(`🔵 [PARA-LINES] ${lines.length} líneas | lineTol=${lineTol.toFixed(2)} | selectedItems=${selectedItems.length}`);
                            lines.forEach((line, li) => {
                                const strs = line.map(it => it.str);
                                const y0 = line[0]?.transform[5]?.toFixed(1);
                                console.log(`🔵 [PARA-LINE${li}] y=${y0} | ${line.length} items | strs=${JSON.stringify(strs.slice(0,5))}${strs.length>5?'…':''}`);
                                line.forEach((item, ii) => {
                                    if (ii === 0) return;
                                    const prev = line[ii-1];
                                    const prevEnd = prev.transform[4] + (prev.width||0);
                                    const currStart = item.transform[4];
                                    const gap = currStart - prevEnd;
                                    const thr = Math.abs(item.transform[0]) * 0.25;
                                    const ns = gap > thr && !prev.str.endsWith(' ') && !item.str.startsWith(' ');
                                    if (gap > 0.5 || ns) console.log(`   [GAP li=${li} ii=${ii}] "${prev.str.slice(-5)}"→"${item.str.slice(0,5)}" gap=${gap.toFixed(2)} thr=${thr.toFixed(2)} needsSpace=${ns} width=${(prev.width||0).toFixed(2)}`);
                                });
                            });
                            let combinedText = _hasAreaText
                                ? areaSelection.text.trim()
                                : lines.map(line => joinLineWithSpaces(line)).join('\n');
                            console.log(`🔵 [PARA-RESULT] path=${_hasAreaText?'areaText':'geometric'} | lines=${combinedText.split('\n').length} | chars=${combinedText.length}`);
                            console.log(`🔵 [PARA-RESULT] text="${combinedText.replace(/\n/g,'↵').substring(0,300)}"`);

                            const allL = selectedItems.map(l => l.transform[4]);
                            const allR = selectedItems.map(l => l.transform[4] + l.width);
                            const allTop = selectedItems.map(l => l.transform[5] + Math.abs(l.transform[3]));
                            const allBot = selectedItems.map(l => l.transform[5]);

                            const finalMinX = Math.min(...allL);
                            const finalMaxX = Math.max(...allR);
                            const finalTopY = Math.max(...allTop);
                            const finalBotY = Math.min(...allBot);

                            // Detectar captura parcial de columna: buscar todos los items en las mismas filas Y
                            const _avgItemH = allTop[0] !== undefined ? (allTop[0] - allBot[allBot.length - 1]) / (allTop.length || 1) : 10;
                            const _ltFull = Math.max(3, Math.abs(selectedItems[0]?.transform[3] || 10) * 0.5);
                            const _selYKeys = [...new Set(selectedItems.map(it => Math.round(it.transform[5] / _ltFull)))];
                            const _fullItems = validTextItems.filter(it => {
                                const yk = Math.round(it.transform[5] / _ltFull);
                                return _selYKeys.some(k => Math.abs(yk - k) <= 1);
                            });
                            const _fAllL = _fullItems.map(it => it.transform[4]);
                            const _fAllR = _fullItems.map(it => it.transform[4] + it.width);
                            const _fMinX = _fAllL.length ? Math.min(..._fAllL) : pdfX_min;
                            const _fMaxX = _fAllR.length ? Math.max(..._fAllR) : pdfX_max;
                            // Es captura de columna si hay items a la derecha del área de drag
                            const _isColCapture = _fMaxX > pdfX_max + 15 && _fullItems.length > selectedItems.length;
                            if (_isColCapture) {
                                _fullItems.sort((a, b) => {
                                    const yd = b.transform[5] - a.transform[5];
                                    if (Math.abs(yd) > _ltFull) return yd > 0 ? 1 : -1;
                                    return a.transform[4] - b.transform[4];
                                });
                                const _fls = []; let _fc = [], _fy = _fullItems[0].transform[5];
                                for (const it of _fullItems) {
                                    if (Math.abs(it.transform[5] - _fy) > _ltFull) { _fls.push(_fc); _fc = []; _fy = it.transform[5]; }
                                    _fc.push(it);
                                }
                                if (_fc.length) _fls.push(_fc);
                                combinedText = _fls.map(l => joinLineWithSpaces(l)).join('\n');
                                console.log(`🔵 [FULL-LINE] col-capture: items ${selectedItems.length}→${_fullItems.length} w ${(pdfX_max-pdfX_min).toFixed(1)}→${(_fMaxX-_fMinX).toFixed(1)} text="${combinedText.replace(/\n/g,'↵').substring(0,120)}"`);
                            }

                            // Calcular alineación basada en los elementos dentro del área
                            let align = 'left';
                            // Solo intentar detectar centro si la selección es lo suficientemente ancha
                            if (selectedItems.length > 0 && (pdfX_max - pdfX_min) > 100) {
                                const centers = selectedItems.map(it => it.transform[4] + it.width / 2);
                                const avgCenter = centers.reduce((a, b) => a + b) / centers.length;
                                const centerSelection = (pdfX_min + pdfX_max) / 2;
                                if (Math.abs(avgCenter - centerSelection) < (pdfX_max - pdfX_min) * 0.05) {
                                    align = 'center';
                                }
                            }

                            // Ancho: expandido si captura de columna, de lo contrario drag exacto
                            const finalX = _isColCapture ? _fMinX : pdfX_min;
                            const finalW = _isColCapture ? (_fMaxX - _fMinX) : (pdfX_max - pdfX_min);

                            // El visualHeight: span real de los ítems expandidos (ya no se recorta al drag)
                            const itemsSpanH = finalTopY - finalBotY;
                            const dragSpanH  = pdfY_max - pdfY_min;
                            const useVisualH = Math.max(itemsSpanH, dragSpanH);

                            // El bottom del bloque: el menor Y entre los items y el drag
                            const useBotY = Math.min(finalBotY, pdfY_min);

                            const finalY = useBotY;
                            const finalH = useVisualH;

                            const firstItem = selectedItems[0];
                            closestItem = {
                                ...firstItem,
                                str: combinedText,
                                width: finalW,
                                transform: [
                                    firstItem.transform[0], firstItem.transform[1],
                                    firstItem.transform[2], firstItem.transform[3],
                                    finalX, useBotY
                                ],
                                isParagraph: selectedItems.length > 1,
                                textAlign: 'left',
                                visualHeight: useVisualH
                            };
                            console.log(`✅ Área seleccionada: ${selectedItems.length} elementos. Alineación: ${align}`);
                        }
                    } else {
                        // ── 🔵 SELECCIÓN POR CLICK (COMPATIBILIDAD) ──
                        let minDistance = Infinity;
                        validTextItems.forEach(item => {
                            const itemX = item.transform[4];
                            const itemY = item.transform[5];
                            const itemWidth = item.width;
                            const itemHeight = Math.abs(item.transform[3]);

                            const expandY = itemHeight * 0.4;
                            const expandX = itemHeight * 0.2;

                            if (x >= itemX - expandX && x <= itemX + itemWidth + expandX &&
                                pdfY >= itemY - expandY && pdfY <= itemY + itemHeight + expandY) {
                                const distance = Math.sqrt(Math.pow(x - (itemX + itemWidth / 2), 2) + Math.pow(pdfY - (itemY + itemHeight / 2), 2));
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    closestItem = item;
                                }
                            }
                        });

                        if (!closestItem) {
                            // Fallback: buscar item más cercano pero con distancia máxima conservadora
                            const avgItemH = validTextItems.reduce((s, it) => s + Math.abs(it.transform[3]), 0) / (validTextItems.length || 1);
                            const MAX_DISTANCE = Math.max(20, avgItemH * 0.6);
                            validTextItems.forEach(item => {
                                const itemX = item.transform[4] + item.width / 2;
                                const itemY = item.transform[5] + Math.abs(item.transform[3]) / 2;
                                const distance = Math.sqrt(Math.pow(x - itemX, 2) + Math.pow(pdfY - itemY, 2));
                                if (distance < minDistance && distance < MAX_DISTANCE) {
                                    minDistance = distance;
                                    closestItem = item;
                                }
                            });
                        }
                    }

                    if (closestItem && closestItem.str && closestItem.str.trim().length > 0) {

                        // Alcance (párrafo o línea) determinado por la selección de área
                        const isParagraph = closestItem.isParagraph || false;

                        let fontName = closestItem.fontName || 'Helvetica';
                        // Fix for generic/obfuscated font names
                        if (fontName.length < 4 || fontName.toLowerCase().includes('g_d') || fontName.startsWith('F')) {
                            // Try to guess from detected font style in styles array if present?
                            // Or default to safer web fonts
                            if (fontName.includes('serif') || fontName.includes('Times')) fontName = 'Times New Roman';
                            else fontName = 'Helvetica';
                        }
                        const detectedFontSize = Math.abs(closestItem.transform[3]);

                        // ── 🔵 V4: DETECCIÓN DE FUENTE MEJORADA ──
                        // Usar fontStyles de PDF.js para obtener el nombre real de la fuente
                        let realFontFamily = '';
                        let fontDescent = 0;
                        let fontAscent = 0;
                        let isVertical = false;

                        if (fontStyles[fontName]) {
                            const style = fontStyles[fontName];
                            realFontFamily = style.fontFamily || '';
                            fontAscent = style.ascent || 0;
                            fontDescent = style.descent || 0;
                            isVertical = style.vertical || false;
                            console.log(`🔤 PDF.js fontStyle encontrado: family="${realFontFamily}", ascent=${fontAscent}, descent=${fontDescent}`);
                        }

                        const _textRotation = Math.atan2(
                            closestItem.transform?.[1] || 0,
                            closestItem.transform?.[0] || 1
                        ) * 180 / Math.PI;
                        if (isVertical || Math.abs(_textRotation) > 1) {
                            this.showToast('⚠️ Texto rotado/vertical: edición protegida para evitar alterar su posición');
                            this.smartPatchMode = wasActive;
                            return;
                        }

                        // Análisis mejorado de bold e italic (V5)
                        const fontNamelc = fontName.toLowerCase();
                        const realFamilylc = realFontFamily.toLowerCase();

                        const isBold = /bold|black|heavy|demi|semibold|700|800|900|[-_]bd\b|[-_]b\b/i.test(fontNamelc) ||
                            /bold|black|heavy|demi|semibold|700|800|900/i.test(realFamilylc) ||
                            (closestItem.transform && Math.abs(closestItem.transform[0]) > 1.15 * Math.abs(closestItem.transform[3]));

                        const isItalic = /italic|oblique|slant|it\b|[-_]i\b/i.test(fontNamelc) ||
                            /italic|oblique|slant|it\b|[-_]i\b/i.test(realFamilylc) ||
                            (closestItem.transform && (Math.abs(closestItem.transform[1]) > 0.05 || Math.abs(closestItem.transform[2]) > 0.05));

                        // ── MEJOR DETECCIÓN DE FAMILIA DE FUENTE ──
                        // Prioridad: realFontFamily de PDF.js > parseo del fontName
                        let baseFontFamily = '';

                        if (realFontFamily && realFontFamily.length > 1) {
                            // Usar el nombre de la fuente proporcionado por PDF.js directamente
                            baseFontFamily = realFontFamily;
                            console.log(`🎯 Usando fontFamily de PDF.js: "${baseFontFamily}"`);
                        } else {
                            // Fallback: parsear el fontName
                            baseFontFamily = fontName
                                .replace(/^[A-Z]{6}\+/, '')    // Quitar prefijo subset 'ABCDEF+'
                                .replace(/[-+]/g, ' ')
                                .replace(/,.*$/, '')             // Remover todo después de coma
                                .replace(/\bBold\b/gi, '')
                                .replace(/\bItalic\b/gi, '')
                                .replace(/\bOblique\b/gi, '')
                                .replace(/\bBlack\b/gi, '')
                                .replace(/\bHeavy\b/gi, '')
                                .replace(/\bMedium\b/gi, '')
                                .replace(/\bLight\b/gi, '')
                                .replace(/\bRegular\b/gi, '')
                                .replace(/\bRoman\b/gi, '')
                                .replace(/\bSemiBold\b/gi, '')
                                .replace(/\bDemi\b/gi, '')
                                .replace(/\bCondensed\b/gi, '')
                                .replace(/\bNarrow\b/gi, '')
                                .replace(/\bMT\b/gi, '')       // Quitar sufijo MonoType
                                .replace(/\bPS\b/gi, '')       // Quitar sufijo PostScript
                                .replace(/\s+/g, ' ')
                                .trim();
                            console.log(`🔤 Fuente parseada del fontName: "${baseFontFamily}"`);
                        }

                        // Limpieza adicional del prefijo subset
                        let cleanFontFamily = baseFontFamily.replace(/^[A-Z]{6}\+/, '');

                        console.log(`🔤 Fuente original: "${fontName}"`);
                        console.log(`🔤 Fuente base limpia: "${cleanFontFamily}"`);
                        console.log(`📐 Transform: [${closestItem.transform.join(', ')}]`);
                        console.log(`✨ Bold: ${isBold}, Italic: ${isItalic}`);

                        // Detectar espaciado entre letras
                        let letterSpacing = 0;
                        if (closestItem.transform && closestItem.transform[0]) {
                            const horizontalScale = Math.abs(closestItem.transform[0]);
                            const expectedScale = detectedFontSize;
                            if (Math.abs(horizontalScale - expectedScale) > 0.5) {
                                const ratio = horizontalScale / expectedScale;
                                if (ratio !== 1.0 && ratio > 0.5 && ratio < 2.0) {
                                    letterSpacing = (ratio - 1.0) * 100;
                                    console.log(`📊 Espaciado horizontal detectado: ${letterSpacing.toFixed(2)}%`);
                                }
                            }
                        }

                        // ══════════════════════════════════════════════════════
                        //  🎨 V4: DETECCIÓN DE COLORES MEJORADA (Fondo + Texto)
                        // ══════════════════════════════════════════════════════
                        console.log('🖼️ Detectando colores del PDF (V4 Multi-estrategia)...');
                        let bgColor = '#ffffff';
                        let textColor = '#000000';
                        let bgR = 255, bgG = 255, bgB = 255;
                        let detectedNoise = false; // Scope fix

                        try {
                            const tempCanvas = document.createElement('canvas');
                            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

                            // Escala limitada: 4x conserva muestras de color precisas sin
                            // rasterizar páginas completas a 10x/12x (picos de cientos de MB).
                            const scale = 4;

                            const renderViewport = pdfPage.getViewport({ scale: scale });
                            tempCanvas.width = renderViewport.width;
                            tempCanvas.height = renderViewport.height;

                            await pdfPage.render({
                                canvasContext: tempCtx,
                                viewport: renderViewport
                            }).promise;

                            const itemX = closestItem.transform[4];
                            const itemY = closestItem.transform[5];
                            const itemWidth = closestItem.width;
                            const itemHeight = Math.abs(closestItem.transform[3]);

                            // ── 🔵 V4: MUESTREO DE FONDO MEJORADO (8 puntos + media ponderada) ──
                            const offset = Math.max(itemHeight * 0.5, 4);
                            const samplePoints = [
                                // Arriba y abajo del texto
                                { x: itemX + itemWidth * 0.25, y: itemY + itemHeight + offset },
                                { x: itemX + itemWidth * 0.5, y: itemY + itemHeight + offset },
                                { x: itemX + itemWidth * 0.75, y: itemY + itemHeight + offset },
                                { x: itemX + itemWidth * 0.25, y: itemY - offset },
                                { x: itemX + itemWidth * 0.5, y: itemY - offset },
                                { x: itemX + itemWidth * 0.75, y: itemY - offset },
                                // Izquierda y derecha
                                { x: itemX - offset, y: itemY + itemHeight / 2 },
                                { x: itemX + itemWidth + offset, y: itemY + itemHeight / 2 }
                            ];

                            let validSamples = [];
                            for (const pt of samplePoints) {
                                const sx = Math.floor(pt.x * scale);
                                const sy = Math.floor((viewport.height - pt.y) * scale);

                                if (sx >= 0 && sx < tempCanvas.width && sy >= 0 && sy < tempCanvas.height) {
                                    // Muestrear un área 3x3 alrededor del punto
                                    const areaSize = detectedFontSize < 10 ? 1 : 2;
                                    let rSum = 0, gSum = 0, bSum = 0, pCount = 0;
                                    for (let dx = -areaSize; dx <= areaSize; dx++) {
                                        for (let dy = -areaSize; dy <= areaSize; dy++) {
                                            const px = Math.max(0, Math.min(tempCanvas.width - 1, sx + dx));
                                            const py = Math.max(0, Math.min(tempCanvas.height - 1, sy + dy));
                                            const data = tempCtx.getImageData(px, py, 1, 1).data;
                                            rSum += data[0]; gSum += data[1]; bSum += data[2];
                                            pCount++;
                                        }
                                    }
                                    if (pCount > 0) {
                                        validSamples.push({
                                            r: rSum / pCount,
                                            g: gSum / pCount,
                                            b: bSum / pCount
                                        });
                                    }
                                }
                            }

                            // ── 🔵 V5: PIL ENHANCEMENT - Texture Capture ──
                            // FIX: capturar ENCIMA o DEBAJO del texto, nunca sobre él.
                            // Capturar sobre el texto incluye las letras → manchas en la textura.
                            if (validSamples.length > 0) {
                                const sampleW = Math.max(32, Math.min(96, itemWidth));
                                const sampleH = Math.max(16, Math.min(48, itemHeight * 1.5));
                                const tGap = itemHeight * 1.2;
                                const tsx = Math.max(0, Math.floor((itemX + itemWidth * 0.25) * scale));
                                const tsyAbove = Math.floor((viewport.height - itemY - itemHeight - tGap - sampleH) * scale);
                                const tsyBelow = Math.floor((viewport.height - itemY + tGap) * scale);
                                const tsy = tsyAbove >= 0 ? tsyAbove : tsyBelow;
                                const twPx = Math.ceil(sampleW * scale);
                                const thPx = Math.ceil(sampleH * scale);

                                if (tsx + twPx <= tempCanvas.width && tsy >= 0 && tsy + thPx <= tempCanvas.height) {
                                    const tc = document.createElement('canvas');
                                    tc.width = twPx; tc.height = thPx;
                                    tc.getContext('2d').drawImage(tempCanvas, tsx, tsy, twPx, thPx, 0, 0, twPx, thPx);
                                    this._pendingTextureSample = tc.toDataURL();
                                    console.log(`🐍 Python: Texture sample ${twPx}x${thPx} (zona sin texto)`);
                                    // 🔥 Lanzar en paralelo con getSpecificBlock para eliminar parpadeo
                                    this._pendingTexturePromise = (window.PythonManager && PythonManager.isLoaded)
                                        ? PythonManager.generateSmartTexture(this._pendingTextureSample).catch(() => null)
                                        : Promise.resolve(null);
                                } else {
                                    this._pendingTextureSample = null;
                                    this._pendingTexturePromise = Promise.resolve(null);
                                    console.warn('🐍 Python: Zona de textura fuera de canvas — omitiendo');
                                }
                            }

                            // ── 🔵 V7: DETECCIÓN DE FONDO POR CLUSTERING DE COLOR ──
                            // La mediana fallaba cuando los puntos caían sobre elementos vecinos
                            // (ej: barra roja arriba, texto azul abajo del texto objetivo).
                            // Ahora agrupamos por similitud RGB: el cluster más numeroso = fondo real.
                            if (validSamples.length > 0) {
                                const _cd = (a, b) => Math.sqrt(Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2));
                                const THRESH = 40;
                                const clusters = [];
                                for (const s of validSamples) {
                                    let best = null, bestD = Infinity;
                                    for (const cl of clusters) {
                                        const d = _cd(s, cl.c);
                                        if (d < THRESH && d < bestD) { bestD = d; best = cl; }
                                    }
                                    if (best) {
                                        best.m.push(s);
                                        best.c.r = best.m.reduce((a, x) => a + x.r, 0) / best.m.length;
                                        best.c.g = best.m.reduce((a, x) => a + x.g, 0) / best.m.length;
                                        best.c.b = best.m.reduce((a, x) => a + x.b, 0) / best.m.length;
                                    } else {
                                        clusters.push({ c: { r: s.r, g: s.g, b: s.b }, m: [s] });
                                    }
                                }
                                clusters.sort((a, b) => b.m.length - a.m.length);
                                const dom = clusters[0];
                                bgR = Math.round(dom.c.r);
                                bgG = Math.round(dom.c.g);
                                bgB = Math.round(dom.c.b);
                                detectedNoise = (dom.m.length / validSamples.length) < 0.4;

                                if (bgR > 248 && bgG > 248 && bgB > 248) { bgR = 255; bgG = 255; bgB = 255; }
                                else if (bgR < 5 && bgG < 5 && bgB < 5) { bgR = 0; bgG = 0; bgB = 0; }

                                bgColor = `#${bgR.toString(16).padStart(2, '0')}${bgG.toString(16).padStart(2, '0')}${bgB.toString(16).padStart(2, '0')}`;
                                console.log(`🎯 Fondo V7 (cluster ${dom.m.length}/${validSamples.length}): ${bgColor} | todos: ${clusters.map(c => `[${c.m.length} rgb(${Math.round(c.c.r)},${Math.round(c.c.g)},${Math.round(c.c.b)})]`).join(' ')}`);
                            }

                            // ══════════════════════════════════════════════════
                            //  🟢 V4: DETECCIÓN DE COLOR DE FUENTE (HISTOGRAMA)
                            // ══════════════════════════════════════════════════
                            textColor = '#000000';
                            const tx = Math.floor(closestItem.transform[4] * scale);
                            const ty = Math.floor((viewport.height - closestItem.transform[5] - itemHeight) * scale);
                            const tw = Math.ceil(closestItem.width * scale);
                            const th = Math.ceil(itemHeight * scale);

                            // Margen interno dinámico según tamaño
                            const margin = detectedFontSize < 10 ? 0.15 : (detectedFontSize < 14 ? 0.12 : 0.08);
                            const cropX = Math.max(0, Math.floor(tx + tw * margin));
                            const cropY = Math.max(0, Math.floor(ty + th * margin));
                            const cropW = Math.max(1, Math.min(Math.floor(tw * (1 - margin * 2)), tempCanvas.width - cropX));
                            const cropH = Math.max(1, Math.min(Math.floor(th * (1 - margin * 2)), tempCanvas.height - cropY));

                            const innerData = tempCtx.getImageData(cropX, cropY, cropW, cropH).data;

                            // ── Paso 1: Separar píxeles en "fondo" y "no-fondo" usando distancia al bgColor ──
                            const textPixels = [];
                            const BG_THRESHOLD = detectedFontSize < 10 ? 35 : 45;

                            for (let i = 0; i < innerData.length; i += 4) {
                                const r = innerData[i], g = innerData[i + 1], b = innerData[i + 2], a = innerData[i + 3];
                                if (a < 128) continue; // Ignorar píxeles transparentes

                                const dist = Math.sqrt(
                                    Math.pow(r - bgR, 2) +
                                    Math.pow(g - bgG, 2) +
                                    Math.pow(b - bgB, 2)
                                );

                                if (dist > BG_THRESHOLD) {
                                    textPixels.push({ r, g, b, dist });
                                }
                            }

                            console.log(`🔍 Píxeles de texto encontrados: ${textPixels.length} (de ${innerData.length / 4} totales, umbral: ${BG_THRESHOLD})`);

                            if (textPixels.length > 5) {
                                // ── Paso 2: Histograma de colores con cuantización ──
                                // Cuantizar a bloques de 8 para agrupar colores similares
                                const quantize = (v) => Math.round(v / 8) * 8;
                                const colorBuckets = {};

                                for (const px of textPixels) {
                                    const key = `${quantize(px.r)},${quantize(px.g)},${quantize(px.b)}`;
                                    if (!colorBuckets[key]) {
                                        colorBuckets[key] = { r: 0, g: 0, b: 0, count: 0, totalDist: 0 };
                                    }
                                    colorBuckets[key].r += px.r;
                                    colorBuckets[key].g += px.g;
                                    colorBuckets[key].b += px.b;
                                    colorBuckets[key].count++;
                                    colorBuckets[key].totalDist += px.dist;
                                }

                                // ── Paso 3: Encontrar el color dominante (más frecuente entre los no-fondo) ──
                                let bestBucket = null;
                                let bestScore = -1;

                                for (const key in colorBuckets) {
                                    const bucket = colorBuckets[key];
                                    // Score = frecuencia * distancia promedio al fondo
                                    // Esto favorece colores que son frecuentes Y diferentes del fondo
                                    const avgDist = bucket.totalDist / bucket.count;
                                    const score = bucket.count * Math.sqrt(avgDist);

                                    if (score > bestScore) {
                                        bestScore = score;
                                        bestBucket = bucket;
                                    }
                                }

                                if (bestBucket && bestBucket.count > 0) {
                                    const finalR = Math.round(bestBucket.r / bestBucket.count);
                                    const finalG = Math.round(bestBucket.g / bestBucket.count);
                                    const finalB = Math.round(bestBucket.b / bestBucket.count);

                                    // ── Snap a colores comunes (negro puro, rojo, azul, etc.) ──
                                    const snapToCommon = (r, g, b) => {
                                        // Negro muy puro
                                        if (r < 25 && g < 25 && b < 25) return { r: 0, g: 0, b: 0 };
                                        // Blanco (solo si está muy cerca de blanco absoluto)
                                        if (r > 250 && g > 250 && b > 250) return { r: 255, g: 255, b: 255 };
                                        // Rojo
                                        if (r > 200 && g < 40 && b < 40) return { r: 255, g: 0, b: 0 };
                                        return { r, g, b };
                                    };

                                    const snapped = snapToCommon(finalR, finalG, finalB);
                                    textColor = `#${snapped.r.toString(16).padStart(2, '0')}${snapped.g.toString(16).padStart(2, '0')}${snapped.b.toString(16).padStart(2, '0')}`;
                                    console.log(`🎨 Color de fuente detectado: ${textColor} (cluster: ${bestBucket.count}px, pre-snap: rgb(${finalR},${finalG},${finalB}))`);
                                }
                            } else if (textPixels.length > 0) {
                                // Pocos píxeles: usar el de mayor contraste directamente
                                textPixels.sort((a, b) => b.dist - a.dist);
                                const best = textPixels[0];
                                if (best.r < 40 && best.g < 40 && best.b < 40) {
                                    textColor = '#000000';
                                } else {
                                    textColor = `#${best.r.toString(16).padStart(2, '0')}${best.g.toString(16).padStart(2, '0')}${best.b.toString(16).padStart(2, '0')}`;
                                }
                                console.log(`🎨 Color de fuente (pocos px): ${textColor}`);
                            }

                            // ── 🔵 V6: SNAP A NEGRO PURO ──
                            const cleanTC = textColor.startsWith('#') ? textColor : '#000000';
                            const tcRGB = parseInt(cleanTC.replace('#', ''), 16);
                            const tR = (tcRGB >> 16) & 255, tG = (tcRGB >> 8) & 255, tB = tcRGB & 255;
                            if (tR < 18 && tG < 18 && tB < 18) textColor = '#000000';

                            this.detectedTextColor = textColor;

                            // Liberar el canvas temporal
                            tempCanvas.width = 0;
                            tempCanvas.height = 0;

                        } catch (err) {
                            console.error('⚠️ Error en detección visual:', err);
                            bgColor = '#ffffff'; textColor = '#000000';
                        }

                        // FIX: verificar inversión por luminancia — si el "textColor" detectado
                        // es más claro que el "bgColor", los colores están invertidos.
                        const _lum = (hex) => { const c = (hex || '#000').replace('#', ''); return 0.299 * (parseInt(c.substr(0, 2), 16) || 0) + 0.587 * (parseInt(c.substr(2, 2), 16) || 0) + 0.114 * (parseInt(c.substr(4, 2), 16) || 0); };
                        let _tc = this.detectedTextColor || textColor;
                        let finalBgColor, finalTextColor;
                        if (_lum(_tc) > _lum(bgColor) + 60) {
                            console.warn(`⚠️ Colores invertidos — corrigiendo: texto=${bgColor}, fondo=${_tc}`);
                            finalTextColor = bgColor; finalBgColor = _tc;
                        } else {
                            finalBgColor = bgColor; finalTextColor = _tc;
                        }
                        console.log(`🎨 Colores finales → texto:${finalTextColor} fondo:${finalBgColor}`);

                        // ══════════════════════════════════════════════════════
                        //  📐 V4: POSICIONAMIENTO PRECISO
                        // ══════════════════════════════════════════════════════
                        const textBaseline = closestItem.transform[5];
                        const textHeight = Math.abs(closestItem.transform[3]);

                        // ── REAL EDIT: expandir al párrafo/bloque completo ──
                        // Si estamos en modo edición real Y el usuario NO seleccionó texto explícitamente,
                        // expandir al bloque contiguo con el mismo font/size.
                        // Si hay selección de texto del usuario (areaSelection.text), respetar esa selección.
                        const _hasUserText = areaSelection && areaSelection.text && areaSelection.text.trim().length > 0;
                        const _isSimpleClick = !areaSelection; // click sin drag → no expandir bloque
                        console.log(`🖱️ [Expansión] _hasUserText=${_hasUserText}, _isSimpleClick=${_isSimpleClick}, realEditMode=${this._realEditMode}, closestItem="${closestItem?.str?.substring(0,30)}"`);
                        if (this._realEditMode && closestItem && !_hasUserText && !_isSimpleClick) {
                            const baseY   = closestItem.transform[5];
                            const baseH   = Math.abs(closestItem.transform[3]);
                            const baseX   = closestItem.transform[4];
                            const lineGap = baseH * 1.4; // tolerancia entre líneas del mismo bloque

                            // Recoger todos los items del bloque: mismo font, mismo size aprox, Y continuo
                            let blockItems = validTextItems.filter(it => {
                                const itH = Math.abs(it.transform[3]);
                                const sameSize = Math.abs(itH - baseH) < baseH * 0.4;
                                // Relajado: ignorar variantes bold/italic del mismo font base
                                const baseFontBase = (closestItem.fontName || '').replace(/[,\-]?(Bold|Italic|BoldItalic|Oblique|Regular|Medium)/gi, '').trim();
                                const itFontBase = (it.fontName || '').replace(/[,\-]?(Bold|Italic|BoldItalic|Oblique|Regular|Medium)/gi, '').trim();
                                const sameFont = baseFontBase.length > 2 ? itFontBase.startsWith(baseFontBase.substring(0, Math.max(4, baseFontBase.length - 2))) : it.fontName === closestItem.fontName;
                                return sameSize && sameFont;
                            });

                            // Ahora filtrar solo los que forman un bloque contiguo con closestItem
                            // ordenar por Y descendente (PDF Y=0 es abajo)
                            blockItems.sort((a, b) => b.transform[5] - a.transform[5]);

                            // Seed: la línea del closestItem
                            const seedY = baseY;
                            const inBlock = new Set();
                            // añadir todos los items cuya línea esté conectada al seed por pasos ≤ lineGap
                            // Primero recoger las Y únicas de líneas
                            const lineYs = [...new Set(blockItems.map(it => Math.round(it.transform[5])))].sort((a,b) => b - a);
                            // Encontrar el índice de la línea seed
                            const seedIdx = lineYs.findIndex(y => Math.abs(y - seedY) < baseH * 0.5);
                            if (seedIdx >= 0) {
                                // Expandir hacia arriba
                                let prevY = lineYs[seedIdx];
                                for (let i = seedIdx - 1; i >= 0; i--) {
                                    if (Math.abs(prevY - lineYs[i]) <= lineGap) { prevY = lineYs[i]; }
                                    else break;
                                }
                                const topY = prevY;
                                // Expandir hacia abajo
                                prevY = lineYs[seedIdx];
                                for (let i = seedIdx + 1; i < lineYs.length; i++) {
                                    if (Math.abs(prevY - lineYs[i]) <= lineGap) { prevY = lineYs[i]; }
                                    else break;
                                }
                                const botY = prevY;

                                blockItems = blockItems.filter(it => {
                                    const y = it.transform[5];
                                    return y >= botY - baseH * 0.5 && y <= topY + baseH * 0.5;
                                });
                            }

                            if (blockItems.length > 1) {
                                // Sort: top-to-bottom (mayor Y PDF = arriba), luego left-to-right
                                // Sort: mayor Y PDF = más arriba visual → primero (descendente en Y)
                                blockItems.sort((a, b) => {
                                    const yDiff = b.transform[5] - a.transform[5];
                                    if (Math.abs(yDiff) > baseH * 0.4) return yDiff > 0 ? 1 : -1;
                                    return a.transform[4] - b.transform[4];
                                });

                                // Reconstruir texto agrupando por línea con tolerancia proporcional
                                const lineTol = baseH * 0.6;
                                const blines = [];
                                let curLine = [], curY = blockItems[0].transform[5];
                                for (const it of blockItems) {
                                    if (Math.abs(it.transform[5] - curY) > lineTol) {
                                        blines.push(curLine); curLine = []; curY = it.transform[5];
                                    }
                                    curLine.push(it);
                                }
                                if (curLine.length) blines.push(curLine);
                                const blockText = blines.map(l => l.map(it => it.str).join(' ')).join('\n');

                                const allL   = blockItems.map(it => it.transform[4]);
                                const allR   = blockItems.map(it => it.transform[4] + it.width);
                                const allTop = blockItems.map(it => it.transform[5] + Math.abs(it.transform[3]));
                                const allBot = blockItems.map(it => it.transform[5]);

                                const bMinX  = Math.min(...allL);
                                // Ancho real: hasta el margen derecho espejado (viewport - margen izq)
                                const bMaxX_items = Math.max(...allR);
                                const bMaxX  = Math.max(bMaxX_items, viewport.width - bMinX);
                                const bTopY  = Math.max(...allTop);
                                const bBotY  = Math.min(...allBot);

                                closestItem = {
                                    ...blockItems[0],
                                    str: blockText,
                                    width: bMaxX - bMinX,
                                    actualTextWidth: bMaxX_items - bMinX,
                                    transform: [
                                        blockItems[0].transform[0], blockItems[0].transform[1],
                                        blockItems[0].transform[2], blockItems[0].transform[3],
                                        bMinX, bBotY
                                    ],
                                    isParagraph: true,
                                    textAlign: 'left',
                                    visualHeight: bTopY - bBotY,
                                    blockItems: blockItems
                                };
                                console.log(`📦 Real Edit: bloque expandido a ${blockItems.length} items, ${blines.length} líneas`);
                            }
                        }

                        // Factor de corrección de tamaño para texto web
                        // Factor de corrección de tamaño para texto web
                        // ✅ AJUSTE: Eliminar multiplicadores que hacían la letra demasiado grande
                        let finalFontSize = textHeight;
                        finalFontSize = Math.round(finalFontSize * 10) / 10;

                        // ── V4: Corrección de posición Y usando descent de la fuente ──
                        // El transform[5] del PDF es la BASELINE del texto.
                        // En HTML/CSS, posicionamos desde el TOP del contenedor.
                        // Necesitamos: topY = viewportHeight - (baseline + ascent)
                        // Pero como usamos el fontSize como la "caja", aproximamos:
                        //   topY = viewportHeight - (baseline + textHeight)
                        // + corrección por descent (el espacio bajo la baseline)

                        const visualBlockHeight = closestItem.isParagraph ? closestItem.visualHeight : textHeight;

                        // ── 📐 V5: POSICIONAMIENTO QUIRÚRGICO BASADO EN ASCENT ──
                        // El ascent promedio es ~77% del tamaño de fuente. Usamos esto para anclar el TOP de la caja.
                        const factorAscent = (fontAscent && fontAscent > 0) ? (fontAscent / 1000) : 0.77;
                        const ascentPx = factorAscent * textHeight;

                        // Si es párrafo, el top es el top del bloque. Si es línea, el top es baseline + ascent.
                        const textTop = closestItem.isParagraph ? (textBaseline + visualBlockHeight) : (textBaseline + ascentPx);
                        const yFromTop = (!closestItem.isParagraph && Number.isFinite(closestItem._domTopPdf))
                            ? closestItem._domTopPdf
                            : (viewport.height - textTop);

                        console.log(`📐 Posición Y (V5): baseline=${textBaseline.toFixed(2)}, ascent=${ascentPx.toFixed(2)}, finalY=${yFromTop.toFixed(2)}`);

                        this.smartPatchData = {
                            text: closestItem.str.trim(),
                            isParagraph: closestItem.isParagraph || false,
                            isSimpleClick: !areaSelection,
                            x: closestItem.transform[4],
                            y: yFromTop,
                            width: closestItem.width,
                            height: closestItem.isParagraph ? closestItem.visualHeight : textHeight,
                            // Span completo del PDF (para erase): puede diferir del sub-span seleccionado
                            pdfFullSpanX: closestItem._refItemX !== undefined ? closestItem._refItemX : closestItem.transform[4],
                            pdfFullSpanW: closestItem._refItemW !== undefined ? closestItem._refItemW : closestItem.width,
                            _isSubSpan: !!closestItem._isSubSpan,
                            textAlign: closestItem.textAlign || 'left',
                            noise: detectedNoise, // V5
                            fontSize: finalFontSize,
                            fontName: fontName,
                            baseFontFamily: cleanFontFamily,
                            isBold: isBold,
                            isItalic: isItalic,
                            letterSpacing: letterSpacing,
                            textColor: finalTextColor,
                            bgColor: finalBgColor,
                            viewport: viewport,
                            transform: closestItem.transform,
                            fontDescent: fontDescent,
                            fontAscent: fontAscent,
                            ascentPx: ascentPx, // Clave para alineación baseline en PDF
                            realFontFamily: realFontFamily
                        };

                        console.log('💾 Edición Real — Datos detectados V4:', {
                            text: this.smartPatchData.text,
                            size: `${finalFontSize}px`,
                            pos: `Y:${yFromTop.toFixed(2)}`,
                            font: `"${this.smartPatchData.baseFontFamily}" (real: "${realFontFamily}")`,
                            colors: `text:${finalTextColor} / bg:${finalBgColor}`,
                            bold: isBold, italic: isItalic
                        });

                        // 🔬 DEBUG OFFSET: compara posición text-layer vs overlay
                        try {
                            const _dScale = this.currentScale;
                            const _dOX = closestItem.transform[4];
                            const _dTX = pdfjsLib.Util.transform(viewport.transform, closestItem.transform);
                            const _dTXleft = _dTX[4];
                            const _dOLeft = _dOX * _dScale;
                            const _dDiff = _dOLeft - _dTXleft;
                            const _dSpans = document.querySelectorAll('.text-layer span');
                            let _dSpan = null;
                            const _dKey = closestItem.str.trim().substring(0, 6);
                            _dSpans.forEach(s => { if (s.textContent.includes(_dKey)) _dSpan = s; });
                            const _dDOM = _dSpan ? parseFloat(_dSpan.style.left) : null;
                            console.warn(
                                '🔬 OFFSET DEBUG\n' +
                                '  texto:         ' + closestItem.str.trim() + '\n' +
                                '  escala:        ' + _dScale + '\n' +
                                '  transform[4]:  ' + _dOX.toFixed(4) + ' pt\n' +
                                '  tx[4] calcula: ' + _dTXleft.toFixed(4) + ' px  (text-layer left)\n' +
                                '  overlay left:  ' + _dOLeft.toFixed(4) + ' px  (o.x * scale)\n' +
                                '  DIFERENCIA:    ' + _dDiff.toFixed(4) + ' px  <- debe ser 0\n' +
                                '  span DOM left: ' + (_dDOM !== null ? _dDOM.toFixed(4) + ' px' : 'no encontrado') + '\n' +
                                '  diff vs DOM:   ' + (_dDOM !== null ? (_dOLeft - _dDOM).toFixed(4) + ' px' : 'N/A') + '\n' +
                                '  vp.transform:  [' + viewport.transform.map(v => v.toFixed(3)).join(', ') + ']'
                            );
                        } catch (_dbgE) { console.warn('🔬 Debug error:', _dbgE.message); }
                        // FIN DEBUG

                        // 🐍 INTEGRATION: Python PyMuPDF Enhanced Detection (V5)
                        // This provides much more accurate font names and colors directly from the PDF source
                        // NOTE: getSpecificBlock handles lazy init internally — no need to guard with isLoaded
                        if (src.buffer) {
                            try {
                                const pyHeight = closestItem.isParagraph
                                    ? (closestItem.visualHeight + 6)
                                    : (Math.abs(closestItem.transform[3]) + 4);
                                const pyY = closestItem.isParagraph
                                    ? (viewport.height - (closestItem.transform[5] + closestItem.visualHeight) - 3)
                                    : (viewport.height - (closestItem.transform[5] + Math.abs(closestItem.transform[3])) - 2);
                                const pyWidth = closestItem.isParagraph
                                    ? ((closestItem.actualTextWidth || closestItem.width) + 6)
                                    : (closestItem.width + 4);
                                const pyRect = {
                                    x: closestItem.transform[4] - 3,
                                    y: pyY,
                                    w: pyWidth,
                                    h: pyHeight
                                };
                                console.log("🐍 Python: Requesting block attributes for area:", pyRect);

                                // ── 🆕 MEJORA 1: Detectar fondo REAL del PDF en paralelo ──
                                // getPageBackground consulta get_drawings() — sin pasar por el canvas del browser.
                                // Se lanza en paralelo con getSpecificBlock para no añadir latencia.
                                const [pyBlocks, pyBg] = await Promise.all([
                                    PythonManager.getSpecificBlock(src.buffer, page.pageIndex, pyRect),
                                    PythonManager.getPageBackground(src.buffer, page.pageIndex, pyRect)
                                ]);

                                // Aplicar color de fondo PyMuPDF si es confiable y no hay imagen de fondo
                                // Validar que el color de fondo detectado no sea un color de borde/línea oscuro
                                const _bgLuminance = (hex) => {
                                    const h = (hex || '#fff').replace('#','');
                                    const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
                                    return 0.299*r + 0.587*g + 0.114*b;
                                };
                                const _pyBgIsValid = pyBg && pyBg.color && _bgLuminance(pyBg.color) >= 40;
                                if (_pyBgIsValid && pyBg.type !== "image" && pyBg.type !== "none" && pyBg.confidence >= 0.5) {
                                    console.log(`🐍 Python BG: "${pyBg.color}" (tipo: ${pyBg.type}, confianza: ${pyBg.confidence}) → reemplaza JS: "${this.smartPatchData.bgColor}"`);
                                    this.smartPatchData.bgColor = pyBg.color;
                                } else if (pyBg && pyBg.type === "image") {
                                    console.log("🐍 Python BG: imagen de fondo detectada — se mantiene captura visual del canvas");
                                } else {
                                    console.log(`🐍 Python BG: sin path de fondo confiable (${pyBg ? pyBg.type : 'null'}) — manteniendo detección JS: "${this.smartPatchData.bgColor}"`);
                                }
                                if (pyBlocks && pyBlocks.length > 0) {
                                    // Find block that matches text best
                                    // Normalize: remove extra spaces, lowercase for comparison
                                    const normalize = s => s ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '';
                                    const targetNorm = normalize(closestItem.str);

                                    let bestPy = null;

                                    if (pyBlocks.length === 1) {
                                        bestPy = pyBlocks[0];
                                    } else {
                                        // Strategy 1: Exact normalized match
                                        bestPy = pyBlocks.find(b => normalize(b.text) === targetNorm) || null;

                                        // Strategy 2: Substring match (target is part of block or vice versa)
                                        if (!bestPy) {
                                            bestPy = pyBlocks.find(b => {
                                                const bn = normalize(b.text);
                                                return bn.includes(targetNorm) || targetNorm.includes(bn);
                                            }) || null;
                                        }

                                        // Strategy 3: For fallback blocks (_fallback=true), pick by closest bbox
                                        if (!bestPy && pyBlocks[0]._fallback) {
                                            const targetX = closestItem.transform[4];
                                            const targetY = viewport.height - closestItem.transform[5];
                                            bestPy = pyBlocks.reduce((prev, curr) => {
                                                const cx = curr.bbox ? (curr.bbox[0] + curr.bbox[2]) / 2 : 0;
                                                const cy = curr.bbox ? (curr.bbox[1] + curr.bbox[3]) / 2 : 0;
                                                const px = prev.bbox ? (prev.bbox[0] + prev.bbox[2]) / 2 : 0;
                                                const py2 = prev.bbox ? (prev.bbox[1] + prev.bbox[3]) / 2 : 0;
                                                const dCurr = Math.hypot(cx - targetX, cy - targetY);
                                                const dPrev = Math.hypot(px - targetX, py2 - targetY);
                                                return dCurr < dPrev ? curr : prev;
                                            });
                                        }

                                        // Strategy 4: Score combinado (texto + bbox) para nombres cortos/numéricos
                                        if (!bestPy) {
                                            const targetX = closestItem.transform[4];
                                            const targetY = viewport.height - closestItem.transform[5];
                                            const scoredBlocks = pyBlocks.map(b => {
                                                const bn = normalize(b.text);
                                                // Similitud de texto: longitud de prefijo común / max longitud
                                                const commonLen = [...targetNorm].filter((c, i) => bn[i] === c).length;
                                                const textSim = commonLen / Math.max(targetNorm.length, bn.length, 1);
                                                // Proximidad espacial normalizada (menor distancia = mayor score)
                                                const cx = b.bbox ? (b.bbox[0] + b.bbox[2]) / 2 : 0;
                                                const cy = b.bbox ? (b.bbox[1] + b.bbox[3]) / 2 : 0;
                                                const dist = Math.hypot(cx - targetX, cy - targetY);
                                                const spatialScore = 1 / (1 + dist * 0.05);
                                                const combined = 0.6 * textSim + 0.4 * spatialScore;
                                                return { block: b, score: combined };
                                            });
                                            scoredBlocks.sort((a, b) => b.score - a.score);
                                            bestPy = scoredBlocks[0].block;
                                        }

                                        // Final fallback: first block
                                        if (!bestPy) bestPy = pyBlocks[0];
                                    }

                                    console.log("🐍 Python Enhanced Attributes Found:", bestPy.font, bestPy.size, bestPy.color);
                                    window.__aliothDiag?.trace('FONT-DIAG', 'detection-sources', {
                                        pdfJs: {
                                            fontName: closestItem?.fontName || null,
                                            text: closestItem?.str || null,
                                            transform: closestItem?.transform || null,
                                            width: closestItem?.width || null,
                                            height: closestItem?.height || null
                                        },
                                        python: {
                                            font: bestPy?.font || null,
                                            size: bestPy?.size || null,
                                            color: bestPy?.color || null,
                                            flags: bestPy?.flags ?? null,
                                            bold: bestPy?.isBold ?? bestPy?.is_bold ?? null,
                                            italic: bestPy?.isItalic ?? bestPy?.is_italic ?? null,
                                            bbox: bestPy?.bbox || null,
                                            fallback: !!bestPy?._fallback
                                        },
                                        selectedBeforeMerge: {
                                            fontName: this.smartPatchData.fontName || null,
                                            baseFontFamily: this.smartPatchData.baseFontFamily || null,
                                            bold: !!this.smartPatchData.isBold,
                                            italic: !!this.smartPatchData.isItalic
                                        }
                                    });

                                    // Update data with exact values from PDF
                                    this.smartPatchData.fontName = bestPy.font || this.smartPatchData.fontName;
                                    this.smartPatchData.fontSize = Math.round(bestPy.size * 10) / 10;
                                    // 🔵 Color de texto: Python es fuente primaria (stream PDF exacto, sin antialiasing).
                                    // Solo aplicar si el bloque NO es fallback (fallback puede ser de otro texto).
                                    if (bestPy.color && !bestPy._fallback) {
                                        this.smartPatchData.textColor = bestPy.color;
                                        console.log(`🐍 Python Color (primario): ${bestPy.color} (reemplaza JS: ${this.smartPatchData.textColor})`);
                                    } else if (bestPy.color) {
                                        // Fallback block: solo aplicar si JS no detectó nada confiable (negro por defecto)
                                        if (this.smartPatchData.textColor === '#000000') {
                                            this.smartPatchData.textColor = bestPy.color;
                                            console.log(`🐍 Python Color (fallback block, JS era negro): ${bestPy.color}`);
                                        } else {
                                            console.log(`🐍 Python Color (fallback block, manteniendo JS): ${this.smartPatchData.textColor}`);
                                        }
                                    }
                                    this.smartPatchData.pythonEnhanced = true;

                                    // ── Kerning real desde Python (rawdict) ──
                                    if (typeof bestPy.letter_spacing === 'number' && bestPy.letter_spacing !== 0) {
                                        // Python devuelve puntos; el editor y applyReflowEdit usan porcentaje.
                                        const _spacingPercent = (bestPy.letter_spacing / Math.max(bestPy.size || 0, 0.1)) * 100;
                                        if (Number.isFinite(_spacingPercent)) {
                                            this.smartPatchData.letterSpacing = Math.max(-50, Math.min(200, _spacingPercent));
                                            console.log(`🐍 Python Kerning: ${bestPy.letter_spacing.toFixed(3)}pt (${_spacingPercent.toFixed(2)}%)`);
                                        }
                                    }

                                    // ── Posición Y precisa desde bbox de Python ──
                                    if (bestPy.bbox && bestPy.bbox.length === 4 && !bestPy._fallback) {
                                        const pyTop = bestPy.bbox[1];
                                        if (Math.abs(pyTop - this.smartPatchData.y) < 30) {
                                            this.smartPatchData.jsY = this.smartPatchData.y;
                                            if (this.smartPatchData.isParagraph) {
                                                // Párrafo: bbox Python = 1 span → solo refinar X si es coherente con la detección JS
                                                // GUARD: bestPy.bbox[0] puede ser un span de columna adyacente si Python
                                                // encuentra otro bloque en el rect. Solo aplicar si está cerca del x JS.
                                                if (Math.abs(bestPy.bbox[0] - this.smartPatchData.x) < 20) {
                                                    this.smartPatchData.x = bestPy.bbox[0];
                                                }
                                            } else {
                                                // Línea simple: usar bbox completo
                                                this.smartPatchData.x = bestPy.bbox[0];
                                                this.smartPatchData.y = pyTop;
                                                this.smartPatchData.width = bestPy.bbox[2] - bestPy.bbox[0];
                                                this.smartPatchData.height = bestPy.bbox[3] - pyTop;
                                            }
                                            console.log(`🚀 Surgical Precision: [x:${this.smartPatchData.x.toFixed(1)}, y:${this.smartPatchData.y.toFixed(1)}] jsY=${this.smartPatchData.jsY.toFixed(1)}`);
                                        }
                                    }

                                    // Actualizar métricas de fuente para precisión de baseline
                                    if (bestPy.ascender) {
                                        this.smartPatchData.fontAscent = bestPy.ascender * 1000;
                                        this.smartPatchData.ascentPx = bestPy.ascender * this.smartPatchData.fontSize;
                                        console.log(`🐍 Python Ascent: ${bestPy.ascender.toFixed(3)} (ascentPx=${this.smartPatchData.ascentPx.toFixed(2)})`);
                                    }

                                    // ── 🔵 V6: ACTUALIZAR FAMILIA BASE DESDE PYTHON ──
                                    // Preferir bestPy.basefont (ya limpio por Python) sobre regex en JS
                                    const cleanPythonFont = (font) => {
                                        if (!font) return '';
                                        let s = font.replace(/^[A-Z]{6}\+/, '');
                                        s = s.replace(/[-_]/g, ' ');
                                        s = s.replace(/\b(Bold|Italic|Oblique|MT|PS|Regular|Roman|SemiBold|Condensed|Narrow)\b/gi, '');
                                        s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
                                        return s.replace(/\s+/g, ' ').trim();
                                    };

                                    let pyBaseFamily = bestPy.basefont || bestPy.font;
                                    if (pyBaseFamily) {
                                        pyBaseFamily = cleanPythonFont(pyBaseFamily);
                                    }
                                    if (pyBaseFamily) {
                                        this.smartPatchData.baseFontFamily = pyBaseFamily;
                                        const embedInfo = bestPy.embedded ? (bestPy.subset ? 'subset' : 'embedded') : 'not-embedded';
                                        console.log(`🐍 Python: Base family="${pyBaseFamily}" (${embedInfo})`);
                                    }

                                    // ── 🔵 V6: DETECCIÓN DE FORMATO USANDO FLAGS DE PYTHON ──
                                    if (bestPy.flags !== undefined) {
                                        // Flags PyMuPDF: Bit 4 (16) = Bold, Bit 1 (2) = Italic
                                        const pyBold = !!(bestPy.flags & 16);
                                        const pyItalic = !!(bestPy.flags & 2);

                                        console.log(`🐍 Python Style: bold=${pyBold}, italic=${pyItalic} (flags=${bestPy.flags})`);
                                        this.smartPatchData.isBold = pyBold;
                                        this.smartPatchData.isItalic = pyItalic;
                                    }

                                    const pyParaText = (bestPy.paragraph_text || (pyBlocks.find(b => b.paragraph_text)?.paragraph_text) || '').trim();
                                    if (pyParaText && this.smartPatchData.isParagraph) {
                                        this.smartPatchData.text = pyParaText;
                                        console.log(`🐍 [PARA-PYTEXT] Usando paragraph_text de Python: "${pyParaText.replace(/\n/g,'↵').substring(0,150)}"`);
                                    } else if (bestPy.text && bestPy.text.trim().length > 0 && !this.smartPatchData.isParagraph) {
                                        if (!this.smartPatchData._isSubSpan) {
                                            this.smartPatchData.text = bestPy.text.trim();
                                        }
                                    }

                                    // 🚀 Preservar baseline origin y metadatos del span para motor quirúrgico PdfCraft
                                    if (Array.isArray(bestPy.origin) && bestPy.origin.length === 2 && !bestPy._fallback) {
                                        this.smartPatchData.origin = this.smartPatchData._isSubSpan
                                            ? [this.smartPatchData.x, bestPy.origin[1]]
                                            : bestPy.origin;
                                    }
                                    if (Array.isArray(bestPy.line_origins) && !bestPy._fallback) {
                                        this.smartPatchData.lineOrigins = bestPy.line_origins;
                                    }
                                    if (!bestPy._fallback && bestPy.bbox) {
                                        this.smartPatchData.targetSpan = {
                                            bbox: this.smartPatchData._isSubSpan
                                                ? [this.smartPatchData.x, bestPy.bbox[1], this.smartPatchData.x + this.smartPatchData.width, bestPy.bbox[3]]
                                                : bestPy.bbox,
                                            origin: this.smartPatchData._isSubSpan
                                                ? [this.smartPatchData.x, bestPy.origin ? bestPy.origin[1] : closestItem.transform[5]]
                                                : bestPy.origin,
                                            font: bestPy.font,
                                            size: bestPy.size,
                                            text: this.smartPatchData.text
                                        };
                                    }
                                    if (this.smartPatchData._isSubSpan && this.smartPatchData.targetSpan) {
                                        this.smartPatchData.targetSpans = [this.smartPatchData.targetSpan];
                                    } else if (Array.isArray(pyBlocks) && pyBlocks.length > 0) {
                                        const _validSpans = pyBlocks.filter(b => !b._fallback && b.bbox);
                                        if (_validSpans.length > 0) {
                                            this.smartPatchData.targetSpans = _validSpans.map(b => ({
                                                bbox: b.bbox,
                                                origin: b.origin,
                                                font: b.font,
                                                size: b.size,
                                                text: b.text
                                            }));
                                        }
                                    }
                                    // Fallback garantizado para párrafos: si no se obtuvieron todos los spans de Python
                                    if (closestItem.isParagraph && (!this.smartPatchData.targetSpans || this.smartPatchData.targetSpans.length < (closestItem.blockItems?.length || 2))) {
                                        if (closestItem.blockItems && closestItem.blockItems.length > 0) {
                                            console.log(`📦 [FALLBACK-SPANS] Usando ${closestItem.blockItems.length} spans de blockItems para text_splice`);
                                            this.smartPatchData.targetSpans = closestItem.blockItems.map(it => {
                                                const itBase = it.transform[5];
                                                const itH = Math.abs(it.transform[3]);
                                                const itW = it.width;
                                                const itX = it.transform[4];
                                                return {
                                                    bbox: [itX, viewport.height - (itBase + itH), itX + itW, viewport.height - itBase],
                                                    origin: [itX, viewport.height - itBase],
                                                    font: it.fontName,
                                                    size: itH,
                                                    text: it.str
                                                };
                                            });
                                        }
                                    }
                                }
                            } catch (pyErr) {
                                console.warn("⚠️ Python enrichment failed:", pyErr);
                            }
                        }

                        await this.applyRealTimeSmartPatch();

                        // ✅ Feedback visual de la calidad de detección
                        setTimeout(() => {
                            if (!this.smartPatchData) return; // guard: patch may have been cancelled
                            const quality = this.smartPatchData.pythonEnhanced ? "Alta (Motor Python)" : "Básica (Navegador)";
                            const fontUsed = this.smartPatchData.fontName || "Predeterminada";
                            const webFont = this.selectedObj ? this.selectedObj.font : fontUsed;
                            this.showToast(`🔍 Detección: ${quality}\nFuente: ${webFont}`);
                        }, 500);
                    } else {
                        console.log('❌ No se encontró texto válido (texto vacío o muy lejos)');
                        this.showToast('⚠️ No se encontró texto en esa área.');
                        // Rehabilitar modo si falló
                        this.smartPatchMode = wasActive;
                    }

                } catch (error) {
                    console.error('❌ Error al capturar texto:', error);
                    this.showToast('❌ Error al detectar texto');
                    this.cancelSmartPatch();
                }
            },

            /**
             * Aplica el Smart Patch en tiempo real, sin modales.
             * Crea el objeto de texto inmediatamente y activa el modo de edición.
             */
            applyRealTimeSmartPatch: async function () {
                if (!this.smartPatchData) return;
                // Bug 2: evitar re-entrada concurrente (no bloquear si la sesión anterior ya terminó)
                if (this._applyingSmartPatch) return;
                this._applyingSmartPatch = true;

                try {

                console.log('🎨 Aplicando edición real en tiempo real...');

                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const data = this.smartPatchData;

                // 1. Mapeo de Fuentes y Colores
                const bgColor = data.bgColor || '#ffffff';
                let textColor = data.textColor || '#000000';

                // Evitar texto invisible (similar al fondo)
                const colorSimilarity = (c1, c2) => {
                    const h1 = (c1 || '#ffffff').replace('#', ''), h2 = (c2 || '#ffffff').replace('#', '');
                    const r1 = parseInt(h1.substr(0, 2), 16), g1 = parseInt(h1.substr(2, 2), 16), b1 = parseInt(h1.substr(4, 2), 16);
                    const r2 = parseInt(h2.substr(0, 2), 16), g2 = parseInt(h2.substr(2, 2), 16), b2 = parseInt(h2.substr(4, 2), 16);
                    return (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) < 50;
                };
                if (colorSimilarity(textColor, bgColor)) textColor = '#000000';

                // Mapeo de fuentes usando fontRecognition + pipeline híbrido
                const resolveSmartPatchFont = async (pdfInternalName, baseFamily) => {
                    const clean = (name) => {
                        if (!name) return '';
                        let s = name.replace(/^[A-Z]{6}\+/, ''); // Remove subset prefix
                        s = s.replace(/[-_,]/g, ' '); // Replace separators with space
                        s = s.replace(/\b(Bold|Italic|Oblique|MT|PS|Regular|Roman|SemiBold|Condensed|Narrow|Negrita|Black|Heavy|Demibold|DemiboldOblique)\b/gi, ''); // Strip styles
                        s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); // Split PascalCase/CamelCase
                        return s.replace(/\s+/g, ' ').trim();
                    };

                    const pName = pdfInternalName || '';
                    const bFamily = baseFamily || '';
                    const cleanP = clean(pName);
                    const cleanB = clean(bFamily);

                    console.log(`🔍 Resolviendo fuente: Internal="${pName}", Base="${bFamily}", CleanP="${cleanP}"`);

                    // Nivel 1a: Coincidencia exacta en registro de fuentes (local o sistema)
                    if (this.fontRegistry.fonts[pName]) return { font: pName, isFallback: false };
                    if (this.fontRegistry.fonts[cleanP]) return { font: cleanP, isFallback: false };
                    if (this.fontRegistry.fonts[bFamily]) return { font: bFamily, isFallback: false };
                    if (this.fontRegistry.fonts[cleanB]) return { font: cleanB, isFallback: false };

                    // Nivel 1b: Mapeo estructural PDF → fuente local
                    const matchedP = this.fontRecognition.matchFont(pName);
                    if (matchedP && this.fontRegistry.fonts[matchedP]) return { font: matchedP, isFallback: false };

                    // Nivel 1c: Fuentes del sistema cargadas (Case Insensitive)
                    const systemFamilies = Array.from(this._systemFontFamilies || []);
                    const foundSystem = systemFamilies.find(f => f.toLowerCase() === cleanP.toLowerCase() || f.toLowerCase() === cleanB.toLowerCase());
                    if (foundSystem) return { font: foundSystem, isFallback: false };

                    // Nivel 1d: Buscar en _systemFontBytes por nombre limpio (captura Calibri desde Excel, etc.)
                    if (this._systemFontBytes) {
                        const sysKeys = [...new Set([...Object.keys(this._systemFontBytes), ...Object.keys(this._systemFontSources || {})])];
                        const foundSysKey = sysKeys.find(k => k.toLowerCase() === cleanP.toLowerCase() || k.toLowerCase() === cleanB.toLowerCase());
                        if (foundSysKey && this.fontRegistry.fonts[foundSysKey]) {
                            console.log(`✅ Nivel 1d (systemFontBytes key): "${cleanP}" → "${foundSysKey}"`);
                            return { font: foundSysKey, isFallback: false };
                        }
                    }

                    // Niveles 2-5: Pipeline híbrido
                    const lookupKey = pName || bFamily;
                    if (lookupKey) {
                        const pipelineResult = await this.fontResolutionPipeline(lookupKey, this.fontRegistry.fonts[lookupKey] || null);
                        if (pipelineResult) {
                            // Registrar bytes en _systemFontBytes para que embedFont los encuentre
                            if (!this._systemFontBytes) this._systemFontBytes = {};
                            this._systemFontBytes[lookupKey] = pipelineResult.bytes;
                            const isFallback = ['metrics', 'metrics-fallback'].includes(pipelineResult.source);
                            const resolvedName = pipelineResult.resolvedAs || lookupKey;
                            // Registrar como fuente de sistema para reuso en esta sesión
                            if (this._systemFontFamilies) this._systemFontFamilies.add(resolvedName);
                            return { font: resolvedName, isFallback };
                        }
                    }

                    // Sin resultado: Helvetica como último recurso
                    return { font: 'Helvetica', isFallback: true };
                };

                // ✅ CRITICAL: Use the Python-enhanced fontName (bestPy.font) instead of PDF.js fallback
                let fontResolution = await resolveSmartPatchFont(data.fontName, data.baseFontFamily);
                let webFont = fontResolution.font;
                let isFallbackFont = fontResolution.isFallback;

                // If bold/italic, use the specific variant key
                // Para fuentes fallback (CIDFont sustituida): no aplicar variante Bold (métricas más anchas),
                // pero SÍ aplicar Italic para que el overlay CSS refleje el estilo del PDF original.
                let fontRegistryKey = webFont;
                if (data.isBold && data.isItalic) {
                    const boldItalicKey = webFont + '-BoldItalic';
                    if (!isFallbackFont && (this.fontRegistry.fonts[boldItalicKey] || this._systemFontBytes[boldItalicKey] || ['Helvetica','Arial','Times New Roman','Courier'].includes(webFont)))
                        fontRegistryKey = boldItalicKey;
                    else if (data.isItalic) {
                        const italicKey = webFont + '-Italic';
                        if (this.fontRegistry.fonts[italicKey] || this._systemFontBytes[italicKey] || ['Helvetica','Arial','Times New Roman','Courier'].includes(webFont))
                            fontRegistryKey = italicKey;
                    }
                } else if (data.isBold && !isFallbackFont) {
                    const boldKey = webFont + '-Bold';
                    if (this.fontRegistry.fonts[boldKey] || this._systemFontBytes[boldKey] || ['Helvetica','Arial','Times New Roman','Courier'].includes(webFont))
                        fontRegistryKey = boldKey;
                } else if (data.isItalic) {
                    const italicKey = webFont + '-Italic';
                    if (this.fontRegistry.fonts[italicKey] || this._systemFontBytes[italicKey] || ['Helvetica','Arial','Times New Roman','Courier'].includes(webFont))
                        fontRegistryKey = italicKey;
                }

                // 🔵 DEBUG ITALIC
                {
                    const _fi = this.fontRegistry.fonts[fontRegistryKey];
                    console.log(`🎨 [Italic Debug] webFont="${webFont}" isFallback=${isFallbackFont} isBold=${data.isBold} isItalic=${data.isItalic}`);
                    console.log(`🎨 [Italic Debug] fontRegistryKey="${fontRegistryKey}" fontInfo=${JSON.stringify(_fi || null)}`);
                    console.log(`🎨 [Italic Debug] textObj.italic will be: ${data.isItalic} → span.fontStyle will be: ${data.isItalic ? 'italic (from o.italic)' : (_fi?.style || 'normal (from fontInfo.style)')}`);
                    const _resolvedBytes = this._systemFontBytes?.[fontRegistryKey] || this.fontRegistry.loadedFonts?.[fontRegistryKey] || null;
                    window.__aliothDiag?.trace('FONT-DIAG', 'resolution', {
                        requested: {
                            fontName: data.fontName,
                            baseFontFamily: data.baseFontFamily,
                            realFontFamily: data.realFontFamily,
                            bold: !!data.isBold,
                            italic: !!data.isItalic,
                            pythonEnhanced: !!data.pythonEnhanced
                        },
                        resolved: {
                            webFont,
                            fontRegistryKey,
                            fallback: !!isFallbackFont,
                            registryInfo: _fi || null,
                            byteLength: _resolvedBytes?.byteLength || _resolvedBytes?.length || null
                        }
                    });
                }

                // ── 🔵 FASE A: BORRADO QUIRÚRGICO DIFERIDO (lazy erase) ──
                // El textarea se monta inmediatamente. El erase real ocurre al commit.
                // Un coverDiv cubre el texto original visualmente hasta entonces.
                let finalBgColor = bgColor;
                let finalBgAlpha = 1;
                let isSurgical = false;

                if (window.PythonManager && PythonManager.isLoaded) {
                    const src = doc.sources[page.sourceId];
                    // Guardar buffer pre-erase para cancel y para commit
                    this._preEraseBuffer = { sourceId: page.sourceId, pageIndex: page.pageIndex, buffer: src.buffer.slice(0) };

                    // Calcular rect de erase (igual que antes, pero no ejecutar aún)
                    const _nLines = (data.text || '').split('\n').filter(l => l.trim()).length || 1;
                    const _lh = data.fontSize * 1.2;
                    const _asc = (data.ascentPx / data.fontSize) || 0.932;
                    let eraseH;
                    if (data.isParagraph) {
                        const _calcH = data.fontSize * _asc + (_nLines - 1) * _lh + data.fontSize * (1 - _asc) + 2;
                        eraseH = Math.max(data.height, _calcH);
                    } else {
                        eraseH = data.fontSize || data.height;
                    }
                    // Guardar para que el commit lo use.
                    // IMPORTANTE: usar el span completo del PDF (no solo el sub-span seleccionado)
                    // para que el erase borre todo el texto original de esa línea.
                    const _eraseX = data.pdfFullSpanX !== undefined ? data.pdfFullSpanX : data.x;
                    const _eraseW = data.pdfFullSpanW !== undefined ? data.pdfFullSpanW : data.width;
                    this._pendingEraseRect = { x: _eraseX, y: data.y, w: _eraseW, h: eraseH, bg: data.bgColor || '#ffffff' };

                    finalBgColor = 'transparent';
                    finalBgAlpha = 0;
                    isSurgical = true;
                }

                // 2. Creación del Objeto de Texto (Snapshot Inicial)
                // Surgical+transparente: el overlay es invisible, usamos fontSize como height exacto
                // (capPx+descentPx < fontSize → el contenedor quedaba más chico que el span → padding visible)
                // Non-surgical (fondo blanco): recortar al cap-height para no tapar líneas adyacentes
                let objHeight = data.height;
                console.log(`📐 [HEIGHT-FIX] isParagraph=${data.isParagraph} isSurgical=${isSurgical} origH=${data.height?.toFixed(2)} fontSize=${data.fontSize}`);
                if (data.ascentPx && data.fontSize && !data.isParagraph) {
                    if (isSurgical) {
                        // Transparente: height = fontSize exacto (span y el tienen el mismo tamaño → sin padding)
                        objHeight = data.fontSize;
                    } else {
                        // Fondo blanco: recortar al cap+descent para no tapar líneas vecinas
                        const descentPx = data.fontSize * 0.23;
                        objHeight = data.ascentPx + descentPx;
                    }
                    console.log(`📐 [Height Fix] surgical=${isSurgical} isParagraph=false → height: ${data.height.toFixed(2)} → ${objHeight.toFixed(2)}`);
                } else {
                    // isParagraph=true o sin ascentPx: mantener data.height (altura real del bloque PDF)
                    // No recalcular al fontSize — el párrafo puede tener N líneas que necesitan más espacio
                    objHeight = data.height;
                    console.log(`📐 [Height Fix] surgical=${isSurgical} isParagraph=${data.isParagraph} → height original: ${data.height.toFixed(2)}`);
                }

                const textObj = {
                    id: 'smart_patch_' + Date.now(),
                    isSmartPatch: true,
                    isRealEdit: isSurgical || this._realEditMode, // Marcar como edición real (física)
                    type: 'text',
                    x: data.x,
                    y: data.y,
                    width: data.width,
                    height: objHeight,
                    text: (isSurgical && !this._realEditMode) ? '' : data.text,
                    isParagraph: data.isParagraph || false,
                    isSimpleClick: data.isSimpleClick || false,
                    font: fontRegistryKey,
                    fontFamilyBase: webFont, // FIX: familia sin sufijo, para recomponer -Bold/-Italic al togglear
                    size: data.fontSize,
                    color: textColor,
                    // Para fuentes fallback (CIDFont sustituida), no aplicar bold en renderizado
                    // ya que la variante Bold tiene métricas más anchas que la fuente original
                    bold: isFallbackFont ? false : data.isBold,
                    italic: data.isItalic,
                    alignment: data.textAlign || 'left',
                    bgColor: finalBgColor,
                    bgAlpha: finalBgAlpha,
                    letterSpacing: data.letterSpacing || 0,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    autoSize: false,
                    ascentPx: data.ascentPx || null,
                    jsY: data.jsY || null,
                    originalPdfFont: data.realFontFamily || data.baseFontFamily || data.fontName || null,
                    isFallbackFont: isFallbackFont
                };
                window.__aliothDiag?.trace('FONT-DIAG', 'overlay-created', {
                    objectId: textObj.id,
                    font: textObj.font,
                    fontFamilyBase: textObj.fontFamilyBase,
                    originalPdfFont: textObj.originalPdfFont,
                    bold: !!textObj.bold,
                    italic: !!textObj.italic,
                    size: textObj.size,
                    alignment: textObj.alignment,
                    rect: { x: textObj.x, y: textObj.y, width: textObj.width, height: textObj.height }
                });

                page.objects.push(textObj);

                // Bug 3: remover cualquier textObj previo de una edición anterior en la misma zona
                // (evita doble-overlay al re-editar un texto ya modificado)
                const _tol = 4;
                for (let _i = page.objects.length - 2; _i >= 0; _i--) {
                    const _o = page.objects[_i];
                    if (_o && _o.type === 'text' && _o.isRealEdit &&
                        Math.abs(_o.x - textObj.x) < _tol && Math.abs(_o.y - textObj.y) < _tol) {
                        page.objects.splice(_i, 1);
                    }
                }

                // 3. Activar Edición Inmediata
                textObj._pendingRealData = data;
                textObj.isEditing = true;
                this.editingObjId = textObj.id;
                this.selectedObj = textObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(textObj.id);

                this.renderOverlays();
                this.renderSidebar();

                // ── MODO REAL EDIT: edición directa sobre el overlay (sin popup) ──
                // Fase A: delay reducido a 0 — el textarea aparece en el siguiente frame
                setTimeout(() => {
                    const _panelEls3 = this.getPanelElements(this.splitView.activePanel);
                    const _mv3 = _panelEls3 && _panelEls3.mainView;
                    const _st3 = _mv3 ? _mv3.scrollTop : 0;
                    const _sl3 = _mv3 ? _mv3.scrollLeft : 0;

                    this.editText(textObj);
                    const el = document.getElementById(textObj.id);
                    if (el) {
                        el.style.outline = '2px solid #7c3aed';
                        el.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.25)';

                        // ── FASE A: coverDiv — misma posición que el overlay (ya tiene el offset correcto) ──
                        if (isSurgical) {
                                // El overlay se reconstruye al aplicar estilos desde el ribbon;
                                // el cover debe vivir en el canvas estable para no desaparecer.
                                const _overlayParentCover = el.closest('.canvas-container') || el.parentElement;
                            if (_overlayParentCover) {
                                const _sc = this.currentScale || 1;
                                const _coverDiv = document.createElement('div');
                                _coverDiv.id = 'real-edit-cover-' + textObj.id;
                                _coverDiv.style.cssText = [
                                    'position:absolute',
                                    `left:${el.style.left}`,
                                    `top:${el.style.top}`,
                                    `width:${el.style.width}`,
                                    `height:${((this._pendingEraseRect?.h || data.height) * _sc).toFixed(1)}px`,
                                    `background:${data.bgColor || '#ffffff'}`,
                                    'pointer-events:none',
                                    'z-index:90'
                                ].join(';');
                                _overlayParentCover.appendChild(_coverDiv);
                                textObj._coverDivId = _coverDiv.id;
                            }
                        }

                        // ── FASE B: drag handle ──
                        const _handle = document.createElement('div');
                        _handle.className = 'real-edit-drag-handle';
                        _handle.title = 'Arrastrar';
                        _handle.style.cssText = [
                            'position:absolute',
                            'top:-22px', 'left:0', 'right:0',
                            'height:20px',
                            'background:rgba(124,58,237,0.85)',
                            'border-radius:4px 4px 0 0',
                            'cursor:grab',
                            'display:flex', 'align-items:center', 'justify-content:center',
                            'font-size:11px', 'color:rgba(255,255,255,0.9)',
                            'user-select:none', 'z-index:20',
                            'letter-spacing:0.1em'
                        ].join(';');
                        _handle.textContent = '⠿ mover';
                        el.style.position = 'absolute';
                        el.appendChild(_handle);
                        // Bug 2: evitar que click en el handle propague y relance captureTextAreaForPatch
                        _handle.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
                        let _dragActive = false, _dragStartX = 0, _dragStartY = 0;
                        const _initScale = this.currentScale || 1;
                        // Guardar posición original en PDF-pt (antes del drag)
                        const _origPdfX = data.x;
                        const _origPdfY = data.y;
                        _handle.addEventListener('mousedown', (e) => {
                            e.stopPropagation(); e.preventDefault();
                            _dragActive = true;
                            _handle.style.cursor = 'grabbing';
                            _dragStartX = e.clientX;
                            _dragStartY = e.clientY;
                            
                            // Guardar coordenadas de inicio para este drag session
                            const startPdfX = textObj.x;
                            const startPdfY = textObj.y;

                            const _onMove = (me) => {
                                if (!_dragActive) return;
                                const dx = me.clientX - _dragStartX;
                                const dy = me.clientY - _dragStartY;
                                const _scale = this.currentScale || 1;

                                // Delta en px → delta en PDF-pt
                                const _dxPt = dx / _scale;
                                const _dyPt = dy / _scale;
                                
                                // Nueva posición en PDF pt
                                let newX = startPdfX + _dxPt;
                                let newY = startPdfY + _dyPt;
                                
                                // Clamp a los bounds reales del canvas (página PDF) en coords PDF
                                const _canvas = document.getElementById('the-canvas');
                                const _overlayParent = el.parentElement;
                                const _maxW_pt = (_canvas ? _canvas.offsetWidth : (_overlayParent ? _overlayParent.offsetWidth : 9999)) / _scale;
                                const _maxH_pt = (_canvas ? _canvas.offsetHeight : (_overlayParent ? _overlayParent.offsetHeight : 9999)) / _scale;
                                
                                newX = Math.max(0, Math.min(newX, _maxW_pt - (textObj.width || 0)));
                                newY = Math.max(0, Math.min(newY, _maxH_pt - (textObj.height || 0)));

                                // Actualizar objeto de datos
                                textObj.x = newX;
                                textObj.y = newY;
                                
                                // Actualizar DOM (usando el offset nativo del sistema overlay)
                                // left_px = X_pt * scale
                                el.style.left = (newX * _scale) + 'px';
                                el.style.top  = (newY * _scale) + 'px';

                                // coverDiv permanece fijo en la posición original del texto (tapa el canvas)
                            };
                            const _onUp = () => {
                                _dragActive = false;
                                _handle.style.cursor = 'grab';
                                window.removeEventListener('mousemove', _onMove);
                                window.removeEventListener('mouseup', _onUp);
                            };
                            window.addEventListener('mousemove', _onMove);
                            window.addEventListener('mouseup', _onUp);
                        });
                        // FIN Fase B

                        const span = el.querySelector('.text-content');
                        if (span) {
                            const sel = window.getSelection();
                            sel.removeAllRanges();
                            const range = document.createRange();
                            range.setStart(span, 0);
                            range.collapse(true);
                            sel.addRange(range);
                        }
                        if (textObj.isFallbackFont) {
                            this.showToast(`⚠️ Fuente original '${textObj.originalPdfFont}' no encontrada. Usando ${textObj.font}.`, 5000);
                        }
                    }
                    // Restaurar scroll tras addRange
                    if (_mv3) { _mv3.scrollTop = _st3; _mv3.scrollLeft = _sl3; }
                }, 0);

                // 4. 🔥 Mejora con Python (PyScript) Asíncrona
                // La textura ya fue lanzada en paralelo con getSpecificBlock — aquí solo consumimos el resultado
                const _texturePromise = this._pendingTexturePromise || null;
                if (_texturePromise) {
                    console.log("🐍 PyScript: Esperando textura (ya en vuelo)...");
                    // Guardar el bgColor detectado ANTES de que Python pueda sobreescribirlo
                    const _detectedBg = textObj.bgColor;
                    const _hexDist = (h1, h2) => {
                        const p = h => { const c = (h || '#fff').replace('#', ''); return [parseInt(c.substr(0, 2), 16) || 0, parseInt(c.substr(2, 2), 16) || 0, parseInt(c.substr(4, 2), 16) || 0]; };
                        const [r1, g1, b1] = p(h1), [r2, g2, b2] = p(h2);
                        return Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2));
                    };
                    _texturePromise.then(result => {
                        if (result) {
                            if (result.startsWith("solid:")) {
                                const pyColor = result.split(":")[1];
                                const dist = _hexDist(pyColor, _detectedBg);
                                if (dist <= 50) {
                                    data.bgColor = pyColor;
                                    if (this._pendingEraseRect) this._pendingEraseRect.bg = pyColor;
                                    if (!isSurgical) {
                                        textObj.bgColor = pyColor;
                                        console.log(`🐍 PyScript: Color refinado ${_detectedBg}→${pyColor} (dist=${dist.toFixed(0)})`);
                                        this.renderOverlays();
                                    }
                                } else {
                                    console.warn(`🐍 PyScript: Color descartado — ${pyColor} vs ${_detectedBg} (dist=${dist.toFixed(0)} > 50)`);
                                }
                            } else if (!isSurgical) {
                                // bgImage: solo aplicar si el fondo NO es limpio y hay ruido real
                                const isCleanBg = _hexDist(_detectedBg, '#ffffff') < 20 || _hexDist(_detectedBg, '#000000') < 20;
                                if (!isCleanBg && textObj.noise) {
                                    textObj.bgImage = result;
                                    console.log("🐍 PyScript: Textura imagen aplicada (fondo ruidoso).");
                                    this.renderOverlays();
                                } else {
                                    console.log(`🐍 PyScript: Textura imagen descartada — fondo limpio (${_detectedBg})`);
                                }
                            }
                        }
                    }).catch(e => console.warn("🐍 PyScript: Falló la textura", e));
                }

                // 5. Limpieza de interfaz
                this.smartPatchMode = false;
                this.smartPatchData = null;
                const btn = document.getElementById('btn-smart-patch');
                if (btn) btn.classList.remove('active');
                document.body.classList.remove('text-select-mode');

                if (this.smartPatchMouseUp) {
                    window.removeEventListener('mouseup', this.smartPatchMouseUp);
                    this.smartPatchMouseUp = null;
                }
                if (this._realEditMouseDownHandler) {
                    window.removeEventListener('mousedown', this._realEditMouseDownHandler);
                    this._realEditMouseDownHandler = null;
                }

                this.showToast('✏️ Edición en tiempo real activada');
                } finally {
                    this._applyingSmartPatch = false;
                }
            },

            /**
             * Muestra preview visual del texto detectado
             */
            showTextPreview: function (textItem, viewport) {
                const canvas = document.getElementById('the-canvas');
                const overlayLayer = document.getElementById('overlay-layer');
                if (!overlayLayer) return;

                // Remover preview anterior si existe
                const oldPreview = document.getElementById('text-preview-box');
                if (oldPreview) oldPreview.remove();

                // Crear elemento de preview
                const preview = document.createElement('div');
                preview.id = 'text-preview-box';
                preview.style.position = 'absolute';
                preview.style.left = (textItem.transform[4] * this.currentScale) + 'px';
                preview.style.top = ((viewport.height - textItem.transform[5] - Math.abs(textItem.transform[3])) * this.currentScale) + 'px';
                preview.style.width = (textItem.width * this.currentScale) + 'px';
                preview.style.height = (Math.abs(textItem.transform[3]) * this.currentScale) + 'px';
                preview.style.border = '2px solid #00ff00';
                preview.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
                preview.style.pointerEvents = 'none';
                preview.style.zIndex = '9999';
                preview.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.5)';

                overlayLayer.appendChild(preview);

                console.log('✨ Preview visual mostrado');
            },

            /**
             * Muestra el modal de Smart Patch con los datos detectados
             */
            /**
             * Inicializa handles de resize (8 puntos) en el overlay del smart patch activo.
             * Sincroniza con smartPatchData y con los inputs numéricos del modal.
             */
            _initPatchResizeHandles: function () {
                if (!this.smartPatchData) return;
                // Buscar el elemento overlay del smart patch (último creado)
                const overlayLayer = document.getElementById('overlay-layer') ||
                    document.querySelector('.overlay-layer');
                if (!overlayLayer) return;

                // Limpiar handles previos
                overlayLayer.querySelectorAll('.sp-resize-handle').forEach(h => h.remove());

                // Buscar el div del patch (id empieza con smart_patch_)
                const patchEl = overlayLayer.querySelector('[id^="smart_patch_"]');
                if (!patchEl) return;

                const scale = this.splitView?.[this.splitView.activePanel]?.scale || this.currentScale || 1;
                const data  = this.smartPatchData;

                const DIRS = [
                    { id:'nw', cx:0,   cy:0,   cursor:'nw-resize', dx:-1, dy:-1, dw:1,  dh:1  },
                    { id:'n',  cx:0.5, cy:0,   cursor:'n-resize',  dx:0,  dy:-1, dw:0,  dh:1  },
                    { id:'ne', cx:1,   cy:0,   cursor:'ne-resize', dx:0,  dy:-1, dw:1,  dh:1  },
                    { id:'e',  cx:1,   cy:0.5, cursor:'e-resize',  dx:0,  dy:0,  dw:1,  dh:0  },
                    { id:'se', cx:1,   cy:1,   cursor:'se-resize', dx:0,  dy:0,  dw:1,  dh:1  },
                    { id:'s',  cx:0.5, cy:1,   cursor:'s-resize',  dx:0,  dy:0,  dw:0,  dh:1  },
                    { id:'sw', cx:0,   cy:1,   cursor:'sw-resize', dx:-1, dy:0,  dw:1,  dh:1  },
                    { id:'w',  cx:0,   cy:0.5, cursor:'w-resize',  dx:-1, dy:0,  dw:1,  dh:0  },
                ];

                const SZ = 10; // tamaño handle px
                DIRS.forEach(dir => {
                    const h = document.createElement('div');
                    h.className = 'sp-resize-handle';
                    h.dataset.dir = dir.id;
                    h.style.cssText = `
                        position:absolute;
                        width:${SZ}px; height:${SZ}px;
                        background:#fff; border:2px solid #ef4444;
                        border-radius:2px; cursor:${dir.cursor};
                        z-index:100001; box-sizing:border-box;
                        left:calc(${dir.cx*100}% - ${SZ/2}px);
                        top:calc(${dir.cy*100}% - ${SZ/2}px);
                        touch-action:none;
                    `;

                    h.addEventListener('mousedown', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const startX = e.clientX, startY = e.clientY;
                        const startW = data.width, startH = data.height;
                        const startObjX = data.x, startObjY = data.y;

                        const onMove = (mv) => {
                            const dxPt = (mv.clientX - startX) / scale;
                            const dyPt = (mv.clientY - startY) / scale;

                            if (dir.dw) {
                                const newW = Math.max(20, startW + dxPt * dir.dw);
                                data.width = newW;
                                if (dir.dx < 0) data.x = startObjX + startW - newW;
                            }
                            if (dir.dh) {
                                const newH = Math.max(8, startH + dyPt * dir.dh);
                                data.height = newH;
                                if (dir.dy < 0) data.y = startObjY + startH - newH;
                            }

                            // Sync overlay element
                            patchEl.style.width  = (data.width  * scale) + 'px';
                            patchEl.style.height = (data.height * scale) + 'px';
                            patchEl.style.left   = (data.x * scale) + 'px';
                            patchEl.style.top    = (data.y * scale) + 'px';

                            // Sync handle positions
                            this._repositionPatchHandles(patchEl, scale, data);

                            // Sync textObj si existe
                            const doc = this.getDoc();
                            if (doc) {
                                const page = doc.pages[doc.currentIndex];
                                const obj = page?.objects?.find(o => o.isSmartPatch);
                                if (obj) {
                                    obj.width = data.width; obj.height = data.height;
                                    obj.x = data.x; obj.y = data.y;
                                }
                            }
                        };

                        const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    });

                    patchEl.appendChild(h);
                });
            },

            _repositionPatchHandles: function (patchEl, scale, data) {
                const SZ = 10;
                const DIRS = [
                    { id:'nw', cx:0,   cy:0   }, { id:'n',  cx:0.5, cy:0   },
                    { id:'ne', cx:1,   cy:0   }, { id:'e',  cx:1,   cy:0.5 },
                    { id:'se', cx:1,   cy:1   }, { id:'s',  cx:0.5, cy:1   },
                    { id:'sw', cx:0,   cy:1   }, { id:'w',  cx:0,   cy:0.5 },
                ];
                DIRS.forEach(dir => {
                    const h = patchEl.querySelector(`.sp-resize-handle[data-dir="${dir.id}"]`);
                    if (h) {
                        h.style.left = `calc(${dir.cx*100}% - ${SZ/2}px)`;
                        h.style.top  = `calc(${dir.cy*100}% - ${SZ/2}px)`;
                    }
                });
            },

            /** Llamado desde los inputs numéricos del modal */
            cancelSmartPatch: function () {
                this.smartPatchMode = false;
                this.smartPatchData = null;
                this._realEditMode = false;
                this._applyingSmartPatch = false;
                this._pendingTextureSample = null;
                this._pendingTexturePromise = null;
                this._pendingEraseRect = null;
                this._preEraseBuffer = null;
                const preview = document.getElementById('text-preview-box');
                if (preview) preview.remove();
                document.body.classList.remove('text-select-mode');
                if (this.smartPatchMouseUp) {
                    window.removeEventListener('mouseup', this.smartPatchMouseUp);
                    this.smartPatchMouseUp = null;
                }
                if (this._realEditMouseDownHandler) {
                    window.removeEventListener('mousedown', this._realEditMouseDownHandler);
                    this._realEditMouseDownHandler = null;
                }
                ['the-canvas','overlay-layer','annotation-layer'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.cursor = 'default';
                });
                const btn = document.getElementById('btn-smart-patch');
                if (btn) btn.classList.remove('active');
                this.closeAllModals();
                this._restoreContinuousIfNeeded();
            },


            // ============================================================
            // REDACCIÓN REAL (PyMuPDF) — elimina texto del stream PDF
            // ============================================================

            /** Activa el modo de selección de área para redacción */
            enableCensorMode: function () {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) { this.showToast('⚠️ Abre un PDF primero'); return; }
                if (!PythonManager.isLoaded) { this.showToast('⏳ Motor Python cargando...'); PythonManager.init(); return; }
                if (this.smartPatchMode) this.cancelSmartPatch();

                const btn = document.getElementById('btn-redact');

                // Toggle off si ya está activo
                if (this._redactMode) {
                    this._redactMode = false;
                    if (btn) btn.classList.remove('active');
                    document.body.style.cursor = '';
                    if (this._redactMouseDown) { window.removeEventListener('mousedown', this._redactMouseDown, true); this._redactMouseDown = null; }
                    if (this._redactKeyDown) { window.removeEventListener('keydown', this._redactKeyDown); this._redactKeyDown = null; }
                    const ov = document.getElementById('redact-select-overlay'); if (ov) ov.remove();
                    const pp = document.getElementById('censor-type-popup'); if (pp) pp.remove();
                    return;
                }

                // Popup de tipo de censura
                const existing = document.getElementById('censor-type-popup');
                if (existing) existing.remove();

                const popup = document.createElement('div');
                popup.id = 'censor-type-popup';
                popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                    z-index:99999;background:rgba(26,32,53,0.63);border:1px solid rgba(255,255,255,0.18);
                    border-radius:14px;padding:28px 28px 24px;box-shadow:0 16px 48px rgba(0,0,0,0.6);
                    -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
                    min-width:300px;font-size:13px;color:#f0f4ff;font-family:inherit;`;
                popup.innerHTML = `
                    <button class="modal-close-btn-round" onclick="document.getElementById('censor-cancel-btn')?.click();" style="position:absolute;top:14px;right:14px;">✕</button>
                    <div style="display:flex;align-items:center;gap:10px;font-weight:700;margin-bottom:16px;font-size:14px;color:#f0f4ff;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:#f0f4ff;flex-shrink:0;"><rect x="1" y="1" width="22" height="22" rx="3"/></svg>
                        <span>Censurar Región</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f0f4ff;">
                            <input type="radio" name="censor-type" value="solid" checked style="width:14px;height:14px;accent-color:var(--accent,#185abd);">
                            <span>⬛ Negro sólido</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f0f4ff;">
                            <input type="radio" name="censor-type" value="blur" style="width:14px;height:14px;accent-color:var(--accent,#185abd);">
                            <span>🌫️ Blur gaussiano</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f0f4ff;">
                            <input type="radio" name="censor-type" value="pixelate" style="width:14px;height:14px;accent-color:var(--accent,#185abd);">
                            <span>🟦 Pixelado</span>
                        </label>
                    </div>
                    <div id="censor-intensity-row" style="margin-bottom:14px;display:none;color:#f0f4ff;">
                        <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                            <span>Intensidad</span>
                            <span id="censor-val-label" style="font-weight:700;min-width:28px;text-align:right;">10</span>
                        </label>
                        <input type="range" id="censor-intensity-range" min="2" max="30" value="10" step="1"
                            style="width:100%;margin-top:6px;accent-color:var(--accent,#185abd);"
                            oninput="document.getElementById('censor-val-label').textContent=this.value">
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="censor-cancel-btn" style="padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.07);cursor:pointer;color:#c8d7ff;font-size:12px;font-family:inherit;transition:background 0.15s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">Cancelar</button>
                        <button id="censor-apply-btn" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent,#185abd);color:white;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:filter 0.15s;filter:brightness(1);"
                            onmouseover="this.style.filter='brightness(0.85)'" onmouseout="this.style.filter='brightness(1)'">Seleccionar Área</button>
                    </div>`;
                document.body.appendChild(popup);

                popup.querySelectorAll('input[name="censor-type"]').forEach(r => {
                    r.addEventListener('change', () => {
                        document.getElementById('censor-intensity-row').style.display =
                            r.value !== 'solid' ? 'block' : 'none';
                    });
                });

                // ESC key listener to close censor popup
                const _censorEscHandler = (e) => {
                    if (e.key === 'Escape') {
                        popup.remove();
                        window.removeEventListener('keydown', _censorEscHandler);
                    }
                };
                window.addEventListener('keydown', _censorEscHandler);

                document.getElementById('censor-cancel-btn').onclick = () => { popup.remove(); window.removeEventListener('keydown', _censorEscHandler); };
                document.getElementById('censor-apply-btn').onclick = () => {
                    const type = popup.querySelector('input[name="censor-type"]:checked').value;
                    const intensity = parseInt(document.getElementById('censor-intensity-range').value);
                    popup.remove();
                    window.removeEventListener('keydown', _censorEscHandler);
                    this._startCensorSelection(btn, type, intensity);
                };
            },

            _startCensorSelection: function (btn, censorType, intensity) {
                const panelId = this.splitView?.activePanel || 'primary';
                const elements = this.getPanelElements(panelId);
                const doc = this.docs.find(d => d.id === (this.splitView?.[panelId]?.docId || this.activeDocId));
                if (!doc || !elements.mainView || !elements.canvas) return;
                this._redactMode = true;
                if (btn) btn.classList.add('active');
                document.body.style.cursor = 'crosshair';
                this.showToast('⬛ Selecciona el área a censurar (arrastra) · Esc para cancelar');

                this._redactKeyDown = (e) => {
                    if (e.key === 'Escape' && this._redactMode) {
                        this._redactMode = false;
                        if (btn) btn.classList.remove('active');
                        document.body.style.cursor = '';
                        if (this._redactMouseDown) { window.removeEventListener('mousedown', this._redactMouseDown, true); this._redactMouseDown = null; }
                        window.removeEventListener('keydown', this._redactKeyDown); this._redactKeyDown = null;
                        stopDragging();
                        const ov = document.getElementById('redact-select-overlay'); if (ov) ov.remove();
                        this.showToast('❌ Censura cancelada');
                    }
                };
                window.addEventListener('keydown', this._redactKeyDown);

                let startX, startY, selBox = null, isDragging = false, onMouseMove, onMouseUp;
                const stopDragging = () => {
                    isDragging = false;
                    window.removeEventListener('mousemove', onMouseMove, true);
                    window.removeEventListener('mouseup', onMouseUp, true);
                    if (selBox) { selBox.remove(); selBox = null; }
                };

                const onMouseDown = (e) => {
                    if (!this._redactMode || isDragging || e.button !== 0 || !elements.mainView.contains(e.target)) return;
                    const wrapper = e.target.closest('.page-wrapper');
                    const pageIndex = wrapper ? Number(wrapper.dataset.index) : (this.splitView?.[panelId]?.pageIndex ?? doc.currentIndex);
                    const page = doc.pages[pageIndex];
                    const surface = wrapper || elements.canvas;
                    const cvRect = surface.getBoundingClientRect();
                    if (!page || cvRect.width <= 0 || cvRect.height <= 0 || e.clientX < cvRect.left || e.clientX > cvRect.right || e.clientY < cvRect.top || e.clientY > cvRect.bottom) return;
                    e.preventDefault();
                    isDragging = true;
                    startX = e.clientX - cvRect.left;
                    startY = e.clientY - cvRect.top;
                    e.stopPropagation();

                    selBox = document.createElement('div');
                    selBox.id = 'redact-select-overlay';
                    selBox.style.cssText = `position:fixed;border:2px dashed #ff0000;background:rgba(255,0,0,0.15);pointer-events:none;z-index:9999;left:${e.clientX}px;top:${e.clientY}px;width:0;height:0;`;
                    document.body.appendChild(selBox);

                    const point = ev => {
                        const bounds = surface.getBoundingClientRect();
                        return { bounds, x: Math.max(0, Math.min(bounds.width, ev.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, ev.clientY - bounds.top)) };
                    };
                    onMouseMove = (ev) => {
                        if (!isDragging || !selBox) return;
                        ev.stopPropagation();
                        const { bounds, x, y } = point(ev);
                        selBox.style.left = Math.min(startX, x) + bounds.left + 'px';
                        selBox.style.top = Math.min(startY, y) + bounds.top + 'px';
                        selBox.style.width = Math.abs(x - startX) + 'px';
                        selBox.style.height = Math.abs(y - startY) + 'px';
                    };

                    onMouseUp = async (ev) => {
                        if (!isDragging) return;
                        ev.stopPropagation();
                        const { bounds, x: endX, y: endY } = point(ev);
                        const selW = Math.abs(endX - startX);
                        const selH = Math.abs(endY - startY);
                        stopDragging();
                        if (!this._redactMode) return;
                        if (selW < 5 || selH < 5) { this.showToast('⚠️ Selección muy pequeña'); return; }

                        this._redactMode = false;
                        if (btn) btn.classList.remove('active');
                        document.body.style.cursor = '';
                        window.removeEventListener('mousedown', this._redactMouseDown, true);
                        this._redactMouseDown = null;
                        if (this._redactKeyDown) { window.removeEventListener('keydown', this._redactKeyDown); this._redactKeyDown = null; }

                        await this.applyCensorRegion(
                            Math.min(startX, endX), Math.min(startY, endY), selW, selH,
                            censorType, intensity, { doc, page, pageIndex, panelId, viewWidth: bounds.width, viewHeight: bounds.height }
                        );
                    };

                    window.addEventListener('mousemove', onMouseMove, true);
                    window.addEventListener('mouseup', onMouseUp, true);
                };

                this._redactMouseDown = onMouseDown;
                window.addEventListener('mousedown', this._redactMouseDown, true);
            },

            applyCensorRegion: async function (canvasX, canvasY, canvasW, canvasH, censorType, intensity, selection = {}) {
                const doc = selection.doc || this.getDoc();
                const pageIndex = selection.pageIndex ?? doc?.currentIndex;
                const page = selection.page || doc?.pages[pageIndex];
                const panelId = selection.panelId || this.splitView?.activePanel || 'primary';
                const src = page && doc.sources[page.sourceId];
                if (!src || !src.buffer) return;

                this.toggleLoader(true, 'Censurando el contenido...');
                try {
                    if (!src.doc) src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                    const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + (page.rotation || 0)) % 360 });
                    const scale = this.splitView?.[panelId]?.scale || this.currentScale || 1;
                    const sx = selection.viewWidth ? viewport.width / selection.viewWidth : 1 / scale;
                    const sy = selection.viewHeight ? viewport.height / selection.viewHeight : 1 / scale;
                    const a = viewport.convertToPdfPoint(canvasX * sx, canvasY * sy);
                    const b = viewport.convertToPdfPoint((canvasX + canvasW) * sx, (canvasY + canvasH) * sy);
                    const rect = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
                    const beforeBuffer = src.buffer;

                    let newBuffer;
                    if (censorType === 'solid') {
                        newBuffer = await PythonManager.applyRedactions(src.buffer, page.pageIndex, [rect], '#000000');
                    } else {
                        newBuffer = await PythonManager.applyCensorEffect(src.buffer, page.pageIndex, rect, censorType, intensity);
                    }

                    if (src.buffer !== beforeBuffer || doc.pages[pageIndex] !== page) throw new Error('El documento cambió durante la censura');
                    const newPdf = await pdfjsLib.getDocument({ data: newBuffer.slice(0) }).promise;
                    if (src.buffer !== beforeBuffer || !this.docs.includes(doc) || doc.pages[pageIndex] !== page) {
                        newPdf.destroy?.();
                        throw new Error('El documento cambió durante la censura');
                    }
                    this.releasePdfSource?.(src);
                    src.buffer = newBuffer;
                    if (src.originalBuffer) src.originalBuffer = newBuffer.slice(0);
                    src.doc = newPdf;
                    const rx0 = canvasX * sx, ry0 = canvasY * sy;
                    const rx1 = (canvasX + canvasW) * sx, ry1 = (canvasY + canvasH) * sy;
                    page.objects = (page.objects || []).filter(obj => !(obj.x < rx1 && obj.x + (obj.width || 0) > rx0 && obj.y < ry1 && obj.y + (obj.height || 0) > ry0));
                    doc.pages.filter(p => p.sourceId === page.sourceId).forEach(p => {
                        this.releasePageThumbnail?.(p);
                        delete p._bgBitmap;
                    });
                    document.querySelectorAll('.bg-page-canvas').forEach(canvas => {
                        const wrapper = canvas.closest('.page-wrapper');
                        const ownerPanel = wrapper?.id.startsWith('page-wrapper-secondary-') ? 'secondary' : 'primary';
                        if ((this.splitView?.[ownerPanel]?.docId || this.activeDocId) !== doc.id || doc.pages[Number(wrapper?.dataset.index)]?.sourceId !== page.sourceId) return;
                        canvas._renderedSessionToken = null;
                        canvas._pendingSessionToken = null;
                        canvas._renderRequestToken = null;
                        try { canvas._activeRenderTask?.cancel(); } catch (_) {}
                        canvas._renderPromise = null;
                    });

                    this.saveState(doc.id);
                    if ((this.splitView?.[panelId]?.docId || this.activeDocId) === doc.id) await this.loadPage(pageIndex, panelId);
                    if (this.activeDocId === doc.id) this.refreshThumbnail?.(pageIndex);
                    this.showToast('✅ Región censurada permanentemente');
                } catch (e) {
                    console.error('❌ applyCensorRegion failed:', e);
                    this.showToast('❌ Error al censurar: ' + e.message);
                } finally {
                    this.toggleLoader(false);
                }
            },

            // ─── Shape picker panel toggle ───────────────────────
            toggleShapePicker: function (btnEl) {
                const panel = document.getElementById('shape-picker-panel');
                if (!panel) return;

                if (panel.style.display === 'block') {
                    panel.style.display = 'none';
                    return;
                }

                // Position the panel below the trigger button
                const btn = btnEl || document.getElementById('btn-shape-expand');
                if (btn) {
                    const r = btn.getBoundingClientRect();
                    const pw = 270;
                    let left = r.left;
                    let top  = r.bottom + 6;
                    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
                    if (left < 4) left = 4;
                    panel.style.left = left + 'px';
                    panel.style.top  = top  + 'px';
                }

                panel.style.setProperty('display', 'block', 'important');
                console.log('🔍 Panel display after set:', panel.style.display, getComputedStyle(panel).display);

                // Close on outside click
                const close = (e) => {
                    if (!panel.contains(e.target) && !e.target.closest('#btn-shape-expand')) {
                        panel.style.removeProperty('display');
                        panel.style.display = 'none';
                        document.removeEventListener('click', close, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', close, true), 50);
            },

            // ─── Add Connector ────────────────────────────────────
            addConnector: function (connType) {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) return;
                this.saveState();
                const center = this.getVisibleCenter();
                // New model: endpoints x1,y1 → x2,y2 instead of bounding box
                const offsets = {
                    line:         { dx: 150, dy: 0   },
                    arrow:        { dx: 150, dy: 0   },
                    double_arrow: { dx: 150, dy: 0   },
                    elbow:        { dx: 120, dy: 80  },
                    elbow_arrow:  { dx: 120, dy: 80  },
                    curved:       { dx: 150, dy: 80  },
                    bracket:      { dx: 0,   dy: 100 },
                };
                const off = offsets[connType] || { dx: 150, dy: 0 };
                const newObj = {
                    id: 'conn_' + Date.now(),
                    type: 'connector',
                    connType: connType,
                    // Endpoint model — x,y,width,height kept for compatibility with selection/sidebar
                    x1: center.x - off.dx / 2,
                    y1: center.y - off.dy / 2,
                    x2: center.x + off.dx / 2,
                    y2: center.y + off.dy / 2,
                    // Anchor bindings (null = free endpoint)
                    fromId: null, fromAnchor: null,
                    toId:   null, toAnchor:   null,
                    // Style
                    stroke: document.getElementById('shapeStroke')?.value || '#000000',
                    strokeWidth: parseInt(document.getElementById('shapeStrokeWidth')?.value) || 2,
                    strokeDash: 'none',
                    opacity: 1,
                    // Compat fields so sidebar/context-menu don't break
                    x: center.x - off.dx / 2,
                    y: center.y - off.dy / 2,
                    width:  Math.max(Math.abs(off.dx), 10),
                    height: Math.max(Math.abs(off.dy), 10),
                    rotation: 0,
                    noFill: true,
                    noBorder: false,
                };
                doc.pages[doc.currentIndex].objects.push(newObj);
                this.selectedObj = newObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(newObj.id);
                this.renderOverlays();
                this.renderSidebar();
                this.saveStateDebounced(500);
            },

            // ── Connector helpers ──────────────────────────────────────────

            /** Returns the center of an anchor point on an object.
             *  anchor: 'top'|'bottom'|'left'|'right'|'center' */
            _connAnchorPoint: function (obj, anchor) {
                const cx = obj.x + obj.width  / 2;
                const cy = obj.y + obj.height / 2;
                switch (anchor) {
                    case 'top':    return { x: cx,       y: obj.y };
                    case 'bottom': return { x: cx,       y: obj.y + obj.height };
                    case 'left':   return { x: obj.x,    y: cy };
                    case 'right':  return { x: obj.x + obj.width, y: cy };
                    default:       return { x: cx,       y: cy };
                }
            },

            /** Sync compat x,y,width,height fields from x1,y1,x2,y2 */
            _connSyncBBox: function (conn) {
                conn.x      = Math.min(conn.x1, conn.x2);
                conn.y      = Math.min(conn.y1, conn.y2);
                conn.width  = Math.max(Math.abs(conn.x2 - conn.x1), 10);
                conn.height = Math.max(Math.abs(conn.y2 - conn.y1), 10);
            },

            /** Lightweight live update: only mutate existing SVG path d-attributes, no DOM rebuild */
            _connUpdatePaths: function (overlayLayer, scale) {
                const svgLayer = overlayLayer.querySelector('.conn-svg-layer');
                if (!svgLayer) return;
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) return;
                const page = doc.pages[doc.currentIndex];
                const connectors = (page.objects || []).filter(o => o.type === 'connector');
                // SVG children order: defs, then per connector: [selOutline?], hit, path
                // Easiest: just update all path[d] attributes by matching data we stored
                // We tag paths with data-conn-id during _connRenderLayer
                connectors.forEach(o => {
                    const sx1 = (o.x1 != null ? o.x1 : o.x) * scale;
                    const sy1 = (o.y1 != null ? o.y1 : o.y) * scale;
                    const sx2 = (o.x2 != null ? o.x2 : (o.x + o.width))  * scale;
                    const sy2 = (o.y2 != null ? o.y2 : (o.y + o.height)) * scale;
                    const d = this._connBuildPath(o, sx1, sy1, sx2, sy2);
                    svgLayer.querySelectorAll(`[data-conn-id="${o.id}"]`).forEach(p => p.setAttribute('d', d));
                });
            },

            /** Update all connectors anchored to a given object id */
            _connUpdateAnchored: function (movedObjId) {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) return;
                const page = doc.pages[doc.currentIndex];
                (page.objects || []).forEach(o => {
                    if (o.type !== 'connector') return;
                    let changed = false;
                    if (o.fromId === movedObjId && o.fromAnchor) {
                        const target = page.objects.find(p => p.id === o.fromId);
                        if (target) {
                            const pt = this._connAnchorPoint(target, o.fromAnchor);
                            o.x1 = pt.x; o.y1 = pt.y; changed = true;
                        }
                    }
                    if (o.toId === movedObjId && o.toAnchor) {
                        const target = page.objects.find(p => p.id === o.toId);
                        if (target) {
                            const pt = this._connAnchorPoint(target, o.toAnchor);
                            o.x2 = pt.x; o.y2 = pt.y; changed = true;
                        }
                    }
                    if (changed) this._connSyncBBox(o);
                });
            },

            /** Build SVG path d attribute from connector object */
            _connBuildPath: function (o, sx1, sy1, sx2, sy2) {
                const cType = o.connType || 'line';
                if (cType === 'line' || cType === 'arrow' || cType === 'double_arrow') {
                    return `M${sx1} ${sy1} L${sx2} ${sy2}`;
                } else if (cType === 'elbow' || cType === 'elbow_arrow') {
                    const mx = sx1 + (sx2 - sx1) / 2;
                    return `M${sx1} ${sy1} L${mx} ${sy1} L${mx} ${sy2} L${sx2} ${sy2}`;
                } else if (cType === 'curved') {
                    const cpx = sx1 + (sx2 - sx1) * 0.5;
                    return `M${sx1} ${sy1} C${cpx} ${sy1} ${cpx} ${sy2} ${sx2} ${sy2}`;
                } else if (cType === 'bracket') {
                    const mx = sx1 + (sx2 - sx1) / 2;
                    return `M${sx2} ${sy1} L${sx1} ${sy1} L${sx1} ${sy2} L${sx2} ${sy2}`;
                }
                return `M${sx1} ${sy1} L${sx2} ${sy2}`;
            },

            /** Render all connectors as a single SVG layer on top of the overlay */
            _connRenderLayer: function (overlayLayer, page, scale) {
                const svgNS = 'http://www.w3.org/2000/svg';
                // Remove old SVG layer and endpoint handles (prevents ghost repetition)
                let layer = overlayLayer.querySelector('.conn-svg-layer');
                if (layer) layer.remove();
                overlayLayer.querySelectorAll('.conn-endpoint-handle').forEach(h => h.remove());

                const connectors = (page.objects || []).filter(o => o.type === 'connector');
                if (!connectors.length) return;

                layer = document.createElementNS(svgNS, 'svg');
                layer.setAttribute('class', 'conn-svg-layer');
                layer.style.position = 'absolute';
                layer.style.top = '0'; layer.style.left = '0';
                layer.style.width = '100%'; layer.style.height = '100%';
                layer.style.overflow = 'visible';
                layer.style.pointerEvents = 'none';
                layer.style.zIndex = '5';

                const defs = document.createElementNS(svgNS, 'defs');
                layer.appendChild(defs);

                connectors.forEach(o => {
                    const sx1 = (o.x1 || o.x) * scale;
                    const sy1 = (o.y1 || o.y) * scale;
                    const sx2 = (o.x2 != null ? o.x2 : (o.x + o.width))  * scale;
                    const sy2 = (o.y2 != null ? o.y2 : (o.y + o.height)) * scale;
                    const cType = o.connType || 'line';
                    const sw = (o.strokeWidth || 2);
                    const op = o.opacity !== undefined && o.opacity <= 1 ? o.opacity : (o.opacity || 100) / 100;
                    const isSelected = this.multiObjectSelection.has(o.id);
                    const strokeColor = o.stroke || '#000000'; // always use real color

                    // Arrow markers
                    const mId = 'cm_' + o.id;
                    const mId2 = 'cm2_' + o.id;
                    if (cType === 'arrow' || cType === 'elbow_arrow' || cType === 'curved' || cType === 'double_arrow') {
                        const mk = document.createElementNS(svgNS, 'marker');
                        mk.setAttribute('id', mId);
                        mk.setAttribute('viewBox', '0 0 10 10');
                        mk.setAttribute('refX', '8'); mk.setAttribute('refY', '5');
                        mk.setAttribute('markerWidth', '5'); mk.setAttribute('markerHeight', '5');
                        mk.setAttribute('orient', 'auto-start-reverse');
                        const mp = document.createElementNS(svgNS, 'path');
                        mp.setAttribute('d', 'M2 1L8 5L2 9');
                        mp.setAttribute('fill', 'none');
                        mp.setAttribute('stroke', strokeColor);
                        mp.setAttribute('stroke-width', '2');
                        mk.appendChild(mp);
                        defs.appendChild(mk);
                        if (cType === 'double_arrow') {
                            const mk2 = mk.cloneNode(true);
                            mk2.setAttribute('id', mId2);
                            defs.appendChild(mk2);
                        }
                    }

                    // Selection outline (behind real path, slightly thicker, semi-transparent blue)
                    if (isSelected) {
                        const sel = document.createElementNS(svgNS, 'path');
                        sel.setAttribute('d', this._connBuildPath(o, sx1, sy1, sx2, sy2));
                        sel.setAttribute('data-conn-id', o.id);
                        sel.setAttribute('fill', 'none');
                        sel.setAttribute('stroke', '#4f8ef7');
                        sel.setAttribute('stroke-width', (sw * scale) + 6);
                        sel.setAttribute('stroke-linecap', 'round');
                        sel.setAttribute('stroke-linejoin', 'round');
                        sel.style.opacity = '0.35';
                        sel.style.pointerEvents = 'none';
                        layer.appendChild(sel);
                    }

                    // Wider invisible hit area
                    const hit = document.createElementNS(svgNS, 'path');
                    hit.setAttribute('d', this._connBuildPath(o, sx1, sy1, sx2, sy2));
                    hit.setAttribute('data-conn-id', o.id);
                    hit.setAttribute('fill', 'none');
                    hit.setAttribute('stroke', 'transparent');
                    hit.setAttribute('stroke-width', Math.max(sw * scale, 12));
                    hit.style.cursor = 'pointer';
                    hit.style.pointerEvents = 'stroke';
                    hit.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.multiObjectSelection.clear();
                        this.multiObjectSelection.add(o.id);
                        this.selectedObj = o;
                        this.renderOverlays();
                        this.renderSidebar();
                    });
                    layer.appendChild(hit);

                    // Visible path — always real stroke color
                    const path = document.createElementNS(svgNS, 'path');
                    path.setAttribute('class', 'conn-path');
                    path.setAttribute('data-conn-id', o.id);
                    path.setAttribute('d', this._connBuildPath(o, sx1, sy1, sx2, sy2));
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', strokeColor);
                    path.setAttribute('stroke-width', sw * scale);
                    path.setAttribute('stroke-linecap', 'round');
                    path.setAttribute('stroke-linejoin', 'round');
                    path.style.opacity = op;
                    path.style.pointerEvents = 'none';
                    if (o.strokeDash && o.strokeDash !== 'none') {
                        path.setAttribute('stroke-dasharray', o.strokeDash.split(',').map(v => parseFloat(v) * sw * scale).join(','));
                    }
                    if (cType === 'arrow' || cType === 'elbow_arrow' || cType === 'curved') {
                        path.setAttribute('marker-end', `url(#${mId})`);
                    }
                    if (cType === 'double_arrow') {
                        path.setAttribute('marker-start', `url(#${mId2})`);
                        path.setAttribute('marker-end',   `url(#${mId})`);
                    }
                    layer.appendChild(path);
                });

                overlayLayer.appendChild(layer);

                // Render endpoint handles for selected connector
                const selConn = connectors.find(o => this.multiObjectSelection.has(o.id));
                if (selConn) this._connRenderHandles(overlayLayer, selConn, scale);
            },

            /** Render draggable endpoint handles for a selected connector */
            _connRenderHandles: function (overlayLayer, o, scale) {
                const self = this;
                const makeHandle = (isEnd) => {
                    const h = document.createElement('div');
                    h.className = 'conn-endpoint-handle';
                    const px = isEnd ? (o.x2 != null ? o.x2 : o.x + o.width)  : (o.x1 || o.x);
                    const py = isEnd ? (o.y2 != null ? o.y2 : o.y + o.height) : (o.y1 || o.y);
                    h.style.left = (px * scale) + 'px';
                    h.style.top  = (py * scale) + 'px';

                    h.addEventListener('mousedown', (e) => {
                        e.stopPropagation(); e.preventDefault();
                        const overlayRect = overlayLayer.getBoundingClientRect();
                        // Show connection dots on all other objects
                        self._connShowDots(overlayLayer, o, scale);

                        const onMove = (ev) => {
                            const mx = (ev.clientX - overlayRect.left) / scale;
                            const my = (ev.clientY - overlayRect.top)  / scale;
                            if (isEnd) { o.x2 = mx; o.y2 = my; }
                            else       { o.x1 = mx; o.y1 = my; }
                            self._connSyncBBox(o);
                            // Check proximity to anchor points
                            self._connCheckSnap(o, isEnd, mx, my, overlayLayer, scale);
                            // Live update SVG layer only
                            self._connRenderLayer(overlayLayer, self.getDoc().pages[self.getDoc().currentIndex], scale);
                        };
                        const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                            self._connHideDots(overlayLayer);
                            self.saveState();
                            self.renderOverlays();
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    });
                    overlayLayer.appendChild(h);
                };
                makeHandle(false); // start
                makeHandle(true);  // end
            },

            /** Show connection anchor dots on all objects except the connector itself */
            _connShowDots: function (overlayLayer, conn, scale) {
                this._connHideDots(overlayLayer);
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                const anchors = ['top','bottom','left','right','center'];
                (page.objects || []).forEach(o => {
                    if (o.type === 'connector' || o.type === 'drawing' || o.type === 'comment') return;
                    anchors.forEach(a => {
                        const pt = this._connAnchorPoint(o, a);
                        const dot = document.createElement('div');
                        dot.className = 'conn-dot visible';
                        dot.dataset.objId = o.id;
                        dot.dataset.anchor = a;
                        dot.style.left = (pt.x * scale) + 'px';
                        dot.style.top  = (pt.y * scale) + 'px';
                        overlayLayer.appendChild(dot);
                    });
                });
            },

            _connHideDots: function (overlayLayer) {
                overlayLayer.querySelectorAll('.conn-dot').forEach(d => d.remove());
            },

            /** Snap endpoint to nearest anchor dot if within threshold */
            _connCheckSnap: function (conn, isEnd, mx, my, overlayLayer, scale) {
                const SNAP_PX = 20; // screen pixels
                let best = null, bestDist = Infinity;
                overlayLayer.querySelectorAll('.conn-dot').forEach(dot => {
                    const dotX = parseFloat(dot.style.left) / scale;
                    const dotY = parseFloat(dot.style.top)  / scale;
                    const dist = Math.hypot(mx - dotX, my - dotY);
                    if (dist < SNAP_PX / scale && dist < bestDist) {
                        bestDist = dist; best = dot;
                    }
                });
                // Clear previous anchoring on this endpoint
                if (isEnd) { conn.toId = null; conn.toAnchor = null; }
                else       { conn.fromId = null; conn.fromAnchor = null; }

                if (best) {
                    const objId = best.dataset.objId;
                    const anchor = best.dataset.anchor;
                    const doc = this.getDoc();
                    const page = doc.pages[doc.currentIndex];
                    const target = (page.objects || []).find(o => o.id === objId);
                    if (target) {
                        const pt = this._connAnchorPoint(target, anchor);
                        if (isEnd) { conn.x2 = pt.x; conn.y2 = pt.y; conn.toId = objId; conn.toAnchor = anchor; }
                        else       { conn.x1 = pt.x; conn.y1 = pt.y; conn.fromId = objId; conn.fromAnchor = anchor; }
                        this._connSyncBBox(conn);
                        // Highlight the dot
                        overlayLayer.querySelectorAll('.conn-dot').forEach(d => d.style.background = '#4f8ef7');
                        best.style.background = '#ff6b35';
                        best.style.transform = 'translate(-50%,-50%) scale(1.4)';
                    }
                }
            },

            addShape: function (type) {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) {
                    this.showToast("Abre un documento primero");
                    return;
                }

                this.saveState();
                const center = this.getVisibleCenter();
                console.log('addShape: center =', center, 'currentScale =', this.currentScale);

                const props = {
                    id: 'shape_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    type: 'shape',
                    shapeType: type,
                    x: center.x - 50,
                    y: center.y - 50,
                    width: 100,
                    height: 100,
                    fill: document.getElementById('shapeFill')?.value || '#ff0000',
                    fillOpacity: parseInt(document.getElementById('shapeFillOpacity')?.value ?? 100) / 100,
                    stroke: document.getElementById('shapeStroke')?.value || '#000000',
                    strokeWidth: parseInt(document.getElementById('shapeStrokeWidth')?.value) || 2,
                    strokeDash: document.getElementById('shapeStrokeDash')?.value || 'none',
                    cornerRadius: parseInt(document.getElementById('shapeCornerRadius')?.value) || 0,
                    opacity: 1,
                    noFill: type === 'arrow_line' || type === 'bracket' ? true : (document.getElementById('shapeNoFill')?.checked || false),
                    noBorder: document.getElementById('shapeNoBorder')?.checked || false,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1
                };
                this.addObject(props);
                this.renderSidebar();
                this.showToast("Forma insertada");
            },

            addStamp: function (text, color) {
                this.saveState();
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) return;
                const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320" height="116" viewBox="0 0 320 116">
            <defs>
                <filter id="stampShadow" x="-12%" y="-12%" width="135%" height="135%">
                    <feDropShadow dx="3" dy="4" stdDeviation="4" flood-color="rgba(0,0,0,0.45)"/>
                </filter>
            </defs>
            <g filter="url(#stampShadow)">
                <rect x="8" y="8" width="290" height="90" rx="15" ry="15"
                      style="fill:none;stroke:${color};stroke-width:5;opacity:0.85" />
                <text x="153" y="58" dominant-baseline="middle" text-anchor="middle"
                      font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="35" fill="${color}" opacity="0.65">
                    ${text}
                </text>
            </g>
        </svg>`;
                const blob = new Blob([svgString], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const reader = new FileReader();
                reader.onload = (e) => {
                    const center = this.getVisibleCenter();
                    const newObj = {
                        id: 'stamp' + Date.now(), type: 'image', src: e.target.result,
                        x: center.x - 160, y: center.y - 58, width: 320, height: 116,
                        opacity: 1, scaleX: 1, scaleY: 1, rotation: -45, filters: {},
                        isSello: true
                    };
                    doc.pages[doc.currentIndex].objects.push(newObj);
                    this.selectedObj = newObj;
                    this.multiObjectSelection.clear();
                    this.multiObjectSelection.add(newObj.id);
                    this.renderOverlays();
                    this.renderSidebar();
                    // Animate stamp insertion
                    setTimeout(()=>{
                        const el=document.getElementById(newObj.id);
                        if(el){el.classList.add('obj-insert-anim');
                            el.addEventListener('animationend',()=>el.classList.remove('obj-insert-anim'),{once:true});}
                    },30);
                };
                reader.readAsDataURL(blob);
            },

            addObject: function (props) {
                const doc = this.getDoc();
                if (doc && doc.pages.length) {
                    const newObj = { id: 'o' + Date.now() + Math.random().toString().substr(2, 5), rotation: 0, ...props };
                    doc.pages[doc.currentIndex].objects.push(newObj);
                    this.selectedObj = newObj;
                    this.multiObjectSelection.clear();
                    this.multiObjectSelection.add(newObj.id);
                    this.loadPage(doc.currentIndex);
                    setTimeout(()=>{
                        const el=document.getElementById(newObj.id);
                        if(el){el.classList.add('obj-insert-anim');
                            el.addEventListener('animationend',()=>el.classList.remove('obj-insert-anim'),{once:true});}
                    },50);
                }
            },

            toggleGroupObjects: function () {
                if (this.multiObjectSelection.size <= 1) {
                    this.showToast("Usa Shift+Click para seleccionar varios");
                } else {
                    this.showToast("Objetos agrupados");
                }
            },

            // ── COPY / PASTE PROPERTIES ──────────────────────────────────────
            // Properties that are transferable between same-type objects
            _propClipboard: null,
            _sizeClipboard: null,

            copyObjectProperties: function () {
                const obj = this.selectedObj;
                if (!obj) return;

                // All visual/style properties transferable between objects
                const allProps = [
                    // Border
                    'borderColor', 'borderWidth', 'borderStyle', 'borderRadius',
                    // Background
                    'backgroundColor', 'noBg',
                    // Opacity
                    'opacity',
                    // Font / Text
                    'fontFamily', 'font', 'fontSize', 'size',
                    'textColor', 'fontColor', 'color',
                    'bold', 'italic', 'underline', 'textAlign', 'alignment',
                    'autoSize', 'multiline',
                    // Form-field specific
                    'checkColor', 'dotColor',
                    // Shape specific
                    'fill', 'stroke', 'strokeWidth', 'noFill', 'noBorder',
                ];

                const props = { _sourceType: obj.type, _sourceFieldType: obj.fieldType };
                allProps.forEach(k => { if (obj[k] !== undefined) props[k] = obj[k]; });
                // Include size
                if (obj.width !== undefined) props.width = obj.width;
                if (obj.height !== undefined) props.height = obj.height;

                this._propClipboard = props;
                this.showToast('🎨 Propiedades copiadas');
                document.getElementById('context-menu').style.display = 'none';
                const pasteBtn = document.getElementById('btn-paste-props');
                if (pasteBtn) { pasteBtn.disabled = false; pasteBtn.style.opacity = '1'; }
            },

            pasteObjectProperties: function () {
                if (!this._propClipboard) return;
                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const targets = this.multiObjectSelection.size > 0
                    ? (page.objects || []).filter(o => this.multiObjectSelection.has(o.id))
                    : this.selectedObj ? [this.selectedObj] : [];
                if (!targets.length) return;
                this.saveState();
                const props = this._propClipboard;

                // Props always safe to paste regardless of type
                const universal = ['borderColor','borderWidth','borderStyle','borderRadius',
                                   'backgroundColor','noBg','opacity'];

                // Props only for text-like (form-field text/dropdown or text obj)
                const textProps = ['fontFamily','font','fontSize','size',
                                   'textColor','fontColor','color',
                                   'bold','italic','underline','textAlign','alignment','autoSize','multiline'];

                // Props only for checkbox
                const cbProps = ['checkColor'];
                // Props only for radio
                const rdProps = ['dotColor'];
                // Props only for shapes
                const shapeProps = ['fill','stroke','strokeWidth','noFill','noBorder'];

                targets.forEach(obj => {
                    // Universal style props
                    universal.forEach(k => { if (props[k] !== undefined) obj[k] = props[k]; });

                    // Text props: apply to text objs and text/dropdown form-fields
                    const isTextLike = obj.type === 'text' ||
                        (obj.type === 'form-field' && (obj.fieldType === 'text' || obj.fieldType === 'dropdown' || obj.fieldType === 'Ch'));
                    if (isTextLike) textProps.forEach(k => { if (props[k] !== undefined) obj[k] = props[k]; });

                    // Checkbox-specific
                    if (obj.type === 'form-field' && (obj.fieldType === 'checkbox' || obj.fieldType === 'Btn'))
                        cbProps.forEach(k => { if (props[k] !== undefined) obj[k] = props[k]; });

                    // Radio-specific
                    if (obj.type === 'form-field' && obj.fieldType === 'radio')
                        rdProps.forEach(k => { if (props[k] !== undefined) obj[k] = props[k]; });

                    // Shape-specific
                    if (obj.type === 'shape')
                        shapeProps.forEach(k => { if (props[k] !== undefined) obj[k] = props[k]; });

                    // Size: only apply to objects of the same type
                    if (obj.type === props._sourceType) {
                        if (props.width !== undefined) obj.width = props.width;
                        if (props.height !== undefined) obj.height = props.height;
                    }
                });

                this.renderOverlays();
                this.showToast(`🖌️ Propiedades aplicadas a ${targets.length} objeto${targets.length > 1 ? 's' : ''}`);
                document.getElementById('context-menu').style.display = 'none';
            },
            copyObjectSize: function () {
                const obj = this.selectedObj;
                if (!obj) return;
                this._sizeClipboard = { _sourceType: obj.type, width: obj.width, height: obj.height };
                this.showToast('📐 Tamaño copiado');
                document.getElementById('context-menu').style.display = 'none';
            },

            copyObjectWidth: function () {
                const obj = this.selectedObj;
                if (!obj) return;
                this._sizeClipboard = { _sourceType: obj.type, width: obj.width };
                this.showToast('↔️ Ancho copiado');
                document.getElementById('context-menu').style.display = 'none';
            },

            copyObjectHeight: function () {
                const obj = this.selectedObj;
                if (!obj) return;
                this._sizeClipboard = { _sourceType: obj.type, height: obj.height };
                this.showToast('↕️ Alto copiado');
                document.getElementById('context-menu').style.display = 'none';
            },

            pasteObjectSize: function () {
                if (!this._sizeClipboard) return;
                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const targets = this.multiObjectSelection.size > 0
                    ? (page.objects || []).filter(o => this.multiObjectSelection.has(o.id))
                    : this.selectedObj ? [this.selectedObj] : [];
                if (!targets.length) return;
                this.saveState();
                const sz = this._sizeClipboard;
                targets.forEach(obj => {
                    if (obj.type === sz._sourceType) {
                        if (sz.width !== undefined) obj.width = sz.width;
                        if (sz.height !== undefined) obj.height = sz.height;
                    }
                });
                this.renderOverlays();
                this.showToast(`📐 Tamaño aplicado a ${targets.length} objeto${targets.length > 1 ? 's' : ''}`);
                document.getElementById('context-menu').style.display = 'none';
            },

            // ────────────────────────────────────────────────────────────────

            groupSelectedObjects: function () {
                if (!this.multiObjectSelection || this.multiObjectSelection.size < 2) return;
                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const groupId = 'grp_' + Date.now();
                this.saveState();
                page.objects.forEach(o => {
                    if (this.multiObjectSelection.has(o.id)) o._groupId = groupId;
                });
                this.showToast(`${this.multiObjectSelection.size} objetos agrupados`);
                this.renderOverlays();
                document.getElementById('context-menu').style.display = 'none';
            },

            ungroupObject: function (obj) {
                if (!obj || !obj._groupId) return;
                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const gid = obj._groupId;
                this.saveState();
                page.objects.forEach(o => { if (o._groupId === gid) delete o._groupId; });
                this.showToast('Grupo disuelto');
                this.renderOverlays();
                document.getElementById('context-menu').style.display = 'none';
            },

            alignSelectedObjects: function (axis) {
                if (!this.multiObjectSelection || this.multiObjectSelection.size < 2) return;
                const doc = this.getDoc();
                const page = doc.pages[doc.currentIndex];
                const selected = (page.objects || []).filter(o => this.multiObjectSelection.has(o.id));
                if (selected.length < 2) return;
                const fieldsOnly = this.isFieldEditMode && selected.every(o => o.fromFormField);
                if (fieldsOnly) {
                    const plan = this.planFieldAlignment(selected, axis);
                    if (!plan.ok) {
                        this.showToast('No se alinearon campos: distribución ambigua');
                        return;
                    }
                    const byId = new Map(plan.moves.map(move => [move.id, move]));
                    const pageWidth = Number(page.width || page._pdfW || 595);
                    const pageHeight = Number(page.height || page._pdfH || 842);
                    const invalid = selected.some(field => {
                        const move = byId.get(field.id);
                        return !move || move.x < 0 || move.y < 0 || move.x + field.width > pageWidth || move.y + field.height > pageHeight;
                    });
                    if (invalid) {
                        this.showToast('No se alinearon campos: excederían la página');
                        return;
                    }
                    this.saveState();
                    selected.forEach(field => {
                        const move = byId.get(field.id);
                        field.x = move.x;
                        field.y = move.y;
                    });
                    this.showToast(axis === 'horizontal' ? 'Campos alineados por filas' : 'Campos alineados por columnas');
                    this.renderOverlays();
                    document.getElementById('context-menu')?.style && (document.getElementById('context-menu').style.display = 'none');
                    return;
                }
                this.saveState();
                const firstId = [...this.multiObjectSelection][0];
                const anchor = selected.find(o => o.id === firstId) || selected[0];
                if (axis === 'horizontal') {
                    selected.forEach(o => { if (o.id !== anchor.id) o.y = anchor.y; });
                    this.showToast('Alineados horizontalmente');
                } else {
                    selected.forEach(o => { if (o.id !== anchor.id) o.x = anchor.x; });
                    this.showToast('Alineados verticalmente');
                }
                this.renderOverlays();
                document.getElementById('context-menu').style.display = 'none';
            },

            deleteObject: function () {
                // Protection: Don't allow deleting converted form fields when edit mode is OFF
                // (isFieldEditMode is false when toggle is OFF)
                const checkProtection = (obj) => {
                    if (!obj) return false;
                    // If the object was converted from a PDF form field AND we're not in field edit mode
                    if (obj.fromFormField && !this.isFieldEditMode) {
                        this.showToast('Active el modo edición de campos para eliminar este campo');
                        return true; // Protected, don't delete
                    }
                    // Also check if the DOM element has .locked class
                    const el = document.getElementById(obj.id);
                    if (el && el.classList.contains('locked')) {
                        this.showToast('Active el modo edición de campos para eliminar este campo');
                        return true; // Protected, don't delete
                    }
                    return false; // Not protected
                };

                // Check if any selected object is protected
                if (this.selectedObj && checkProtection(this.selectedObj)) {
                    return;
                }

                this.saveState();
                const doc = this.getDoc();
                const p = doc.pages[doc.currentIndex];
                if (this.multiObjectSelection.size > 0) {
                    let deleted = 0;
                    const idsToDelete = [...this.multiObjectSelection].filter(id => {
                        const obj = p.objects.find(o => o.id === id);
                        if (!checkProtection(obj)) {
                            if (obj.fromFormField && (obj.nativeFieldName || obj.fieldName)) {
                                p.deletedNativeFields = p.deletedNativeFields || [];
                                const nativeName = obj.nativeFieldName || obj.fieldName;
                                if (!p.deletedNativeFields.includes(nativeName)) p.deletedNativeFields.push(nativeName);
                            }
                            deleted++; return true;
                        }
                        return false;
                    });
                    p.objects = p.objects.filter(o => !idsToDelete.includes(o.id));
                    this.multiObjectSelection.clear();
                    this.selectedObj = null;
                    if (deleted === 0) return;
                } else if (this.selectedObj) {
                    if (this.selectedObj.fromFormField && (this.selectedObj.nativeFieldName || this.selectedObj.fieldName)) {
                        p.deletedNativeFields = p.deletedNativeFields || [];
                        const nativeName = this.selectedObj.nativeFieldName || this.selectedObj.fieldName;
                        if (!p.deletedNativeFields.includes(nativeName)) p.deletedNativeFields.push(nativeName);
                    }
                    p.objects = p.objects.filter(o => o !== this.selectedObj);
                    this.selectedObj = null;
                }
                this.renderOverlays();
                this.renderSidebar();
                document.getElementById('context-menu').style.display = 'none';
                this._restoreContinuousIfNeeded();
            },

            moveSelectedObjects: function (dx, dy) {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                if (!page) return;

                const selectedIds = this.multiObjectSelection;
                if (!this.selectedObj && (!selectedIds || selectedIds.size === 0)) return;

                const moved = page.objects.filter(o =>
                    ((selectedIds && selectedIds.has(o.id)) || o === this.selectedObj) &&
                    !(o.fromFormField && !this.isFieldEditMode)
                );
                if (moved.length === 0) return;

                moved.forEach(o => {
                    o.x += dx;
                    o.y += dy;
                });

                this.renderOverlays();
            },

            resizeSelectedObjects: function (axis, delta) {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                if (!page) return;
                const targets = page.objects.filter(o =>
                    ((this.multiObjectSelection && this.multiObjectSelection.has(o.id)) || o === this.selectedObj) &&
                    !(o.fromFormField && !this.isFieldEditMode)
                );
                if (targets.length === 0) return;
                this.saveStateDebounced(300);
                targets.forEach(o => {
                    if (axis === 'w') {
                        o.width = Math.max(2, (o.width || 50) + delta);
                    } else {
                        o.height = Math.max(2, (o.height || 20) + delta);
                    }
                    // Sync form field element if present
                    const el = document.querySelector(`[data-id="${o.id}"]`);
                    if (el) {
                        const scale = this.currentScale || 1;
                        if (axis === 'w') el.style.width = (o.width * scale) + 'px';
                        else el.style.height = (o.height * scale) + 'px';
                    }
                });
                this.renderOverlays();
                this.renderSidebar && this.renderSidebar();
            },

            rotateSelectedObject: function (deg) {
                this.saveStateDebounced(500);
                const doc = this.getDoc();
                const p = doc.pages[doc.currentIndex];
                if (this.multiObjectSelection.size > 0) {
                    p.objects.forEach(o => {
                        if (this.multiObjectSelection.has(o.id)) {
                            o.rotation = (o.rotation || 0) + deg;
                        }
                    });
                } else if (this.selectedObj) {
                    this.selectedObj.rotation = (this.selectedObj.rotation || 0) + deg;
                }
                this.renderOverlays();
                this.renderSidebar();
            },

            moveObjectZ: function (dir) {
                if (this.selectedObj) {
                    this.saveState();
                    const doc = this.getDoc();
                    const p = doc.pages[doc.currentIndex];
                    const idx = p.objects.indexOf(this.selectedObj);
                    if (idx > -1) {
                        p.objects.splice(idx, 1);
                        if (dir === 'front') p.objects.push(this.selectedObj);
                        else p.objects.unshift(this.selectedObj);
                        this.renderOverlays();
                        this.renderSidebar();
                    }
                }
            },

            copyObject: function () {
                if (this.isInputActive()) return; // Don't copy object if editing text
                if (this.multiObjectSelection && this.multiObjectSelection.size > 1) {
                    // Copy all selected objects as a group
                    const page = this.getDoc().pages[this.getDoc().currentIndex];
                    const objs = (page.objects || []).filter(o => this.multiObjectSelection.has(o.id));
                    if (objs.length > 0) {
                        this.clipboard = { _multiGroup: true, items: JSON.parse(JSON.stringify(objs)) };
                        this.showToast(`${objs.length} objetos copiados`);
                    }
                } else if (this.selectedObj) {
                    this.clipboard = JSON.parse(JSON.stringify(this.selectedObj));
                    this.showToast('Objeto copiado');
                }
                const ctxMenu = document.getElementById('context-menu');
                if (ctxMenu) ctxMenu.style.display = 'none';
            },

            pasteObject: function () {
                if (!this.clipboard) return;

                // ── Multi-object paste ──
                if (this.clipboard._multiGroup && this.clipboard.items) {
                    this.saveState();
                    const offset = 20;
                    const newIds = [];
                    this.clipboard.items.forEach((src, idx) => {
                        const n = JSON.parse(JSON.stringify(src));
                        n.x = src.x + offset;
                        n.y = src.y + offset;
                        n.id = 'o' + (Date.now() + idx) + Math.floor(Math.random() * 1000);
                        if (n.type === 'form-field') n.fieldName = (n.fieldName || 'field') + '_' + Date.now();
                        this.getDoc().pages[this.getDoc().currentIndex].objects.push(n);
                        newIds.push(n.id);
                    });
                    this.multiObjectSelection.clear();
                    newIds.forEach(id => this.multiObjectSelection.add(id));
                    this.selectedObj = null;
                    this.renderOverlays();
                    this.showToast(`${newIds.length} objetos pegados`);
                    return;
                }

                // Determine paste location
                let targetX, targetY;
                // Use global mouse tracking if available
                const coords = this.getClientToPDFCoords(this.mouseX, this.mouseY);

                if (coords) {
                    console.log('Pasting at cursor:', coords);
                    targetX = coords.x - (this.clipboard.width || 50) / 2;
                    targetY = coords.y - (this.clipboard.height || 20) / 2;
                    // Switch to the panel where mouse is? (future improvement)
                } else {
                    console.log('Pasting with offset check');
                    // Fallback: offset from original
                    targetX = this.clipboard.x + 20;
                    targetY = this.clipboard.y + 20;
                }

                this.saveState();
                const n = JSON.parse(JSON.stringify(this.clipboard));
                n.x = targetX;
                n.y = targetY;
                n.id = 'o' + Date.now() + Math.floor(Math.random() * 1000);

                // Ensure unique name for form fields
                if (n.type === 'form-field') {
                    n.fieldName = (n.fieldName || 'field') + '_' + Date.now();
                }

                this.getDoc().pages[this.getDoc().currentIndex].objects.push(n);

                // Select new object
                this.selectedObj = n;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(n.id);

                this.renderOverlays();
                this.renderSidebar();

                const ctxMenu = document.getElementById('context-menu');
                if (ctxMenu) ctxMenu.style.display = 'none';
            },

            insertImage: function (file) {
                this.insertImageAsObject(file);
            },

            beginPendingSignature: function ({ dataURL, name = 'Firma' } = {}) {
                const doc = this.getDoc?.();
                if (!doc || !/^data:image\//i.test(String(dataURL || ''))) return false;
                this.cancelPendingSignature?.();
                this.pendingSignature = { docId: doc.id, dataURL, name, width: 200, height: 70 };
                this._installPendingSignatureHandlers();
                this.showToast?.('Haz clic en la página para colocar la firma. Esc cancela.');
                return true;
            },

            placePendingSignature: function (point, docId, pageIndex) {
                const pending = this.pendingSignature;
                const doc = this.getDoc?.();
                if (!pending || !doc || pending.docId !== docId || doc.id !== docId) return false;
                const page = doc.pages?.[pageIndex];
                if (!page || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
                const pageWidth = Math.max(1, Number(point.width) || 1);
                const pageHeight = Math.max(1, Number(point.height) || 1);
                const width = Math.min(pending.width, pageWidth);
                const height = Math.min(pending.height, pageHeight);
                const object = {
                    id: 'o' + Date.now() + Math.floor(Math.random() * 1000),
                    type: 'image', src: pending.dataURL,
                    x: Math.max(0, Math.min(pageWidth - width, point.x - width / 2)),
                    y: Math.max(0, Math.min(pageHeight - height, point.y - height / 2)),
                    width, height, opacity: 1, scaleX: 1, scaleY: 1, filters: {},
                    isSignatureImage: true, signatureName: pending.name
                };
                this.saveState?.();
                (page.objects ||= []).push(object);
                this.selectedObj = object;
                this.multiObjectSelection?.clear?.();
                this.multiObjectSelection?.add?.(object.id);
                this.cancelPendingSignature();
                this.renderSidebar?.();
                this.renderOverlays?.();
                return true;
            },

            _installPendingSignatureHandlers: function () {
                const preview = document.createElement('img');
                preview.id = 'pending-signature-preview';
                preview.className = 'pending-signature-preview';
                preview.alt = '';
                preview.src = this.pendingSignature.dataURL;
                document.body?.appendChild(preview);
                const getPlacement = event => {
                    const target = event.target;
                    const container = target?.closest?.('.canvas-container');
                    const overlay = target?.closest?.('[id^="overlay-layer"]') || container?.querySelector?.('[id^="overlay-layer"]');
                    if (!overlay) return null;
                    const panelId = overlay.id.includes('secondary') ? 'secondary' : 'primary';
                    const state = this.splitView?.[panelId] || {};
                    const docId = state.docId || this.activeDocId;
                    const doc = this.docs?.find?.(item => item.id === docId) || this.getDoc?.();
                    const pageIndex = Number.isInteger(state.pageIndex) ? state.pageIndex : doc?.currentIndex;
                    const rect = overlay.getBoundingClientRect();
                    const scale = state.scale || this.currentScale || 1;
                    if (!doc || !rect.width || !rect.height || docId !== this.pendingSignature?.docId) return null;
                    return { overlay, rect, scale, docId, pageIndex, x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale, width: rect.width / scale, height: rect.height / scale };
                };
                const onMove = event => {
                    const placement = getPlacement(event);
                    if (!placement) { preview.style.display = 'none'; return; }
                    const width = this.pendingSignature.width * placement.scale;
                    const height = this.pendingSignature.height * placement.scale;
                    preview.style.display = 'block';
                    preview.style.width = width + 'px';
                    preview.style.height = height + 'px';
                    preview.style.left = (event.clientX - width / 2) + 'px';
                    preview.style.top = (event.clientY - height / 2) + 'px';
                };
                const onDown = event => {
                    if (event.button !== 0) return;
                    const placement = getPlacement(event);
                    if (!placement) return;
                    event.preventDefault();
                    event.stopPropagation();
                    this.placePendingSignature(placement, placement.docId, placement.pageIndex);
                };
                const onCancel = event => {
                    if (event.type === 'contextmenu') { event.preventDefault(); event.stopPropagation(); }
                    this.cancelPendingSignature();
                };
                const onKeyDown = event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    this.cancelPendingSignature();
                };
                this._pendingSignatureCleanup = () => {
                    preview.remove?.();
                    document.removeEventListener('pointermove', onMove, true);
                    document.removeEventListener('pointerdown', onDown, true);
                    document.removeEventListener('pointercancel', onCancel, true);
                    document.removeEventListener('contextmenu', onCancel, true);
                    document.removeEventListener('keydown', onKeyDown, true);
                };
                document.addEventListener('pointermove', onMove, true);
                document.addEventListener('pointerdown', onDown, true);
                document.addEventListener('pointercancel', onCancel, true);
                document.addEventListener('contextmenu', onCancel, true);
                document.addEventListener('keydown', onKeyDown, true);
            },

            cancelPendingSignature: function () {
                this._pendingSignatureCleanup?.();
                this._pendingSignatureCleanup = null;
                this.pendingSignature = null;
            },

            insertImageAsObject: function (file, x, y) {
                this._exitContinuousIfNeeded();
                const reader = new FileReader();
                reader.onload = e => {
                    this.saveState();
                    const i = new Image();
                    i.onload = () => {
                        let w = 200;
                        let h = (i.height / i.width) * 200;
                        const newObj = {
                            type: 'image', src: e.target.result,
                            x: x || 50, y: y || 50, width: w, height: h,
                            opacity: 1, scaleX: 1, scaleY: 1, filters: {}, id: 'o' + Date.now()
                        };
                        this.getDoc().pages[this.getDoc().currentIndex].objects.push(newObj);
                        this.selectedObj = newObj;
                        this.multiObjectSelection.clear();
                        this.multiObjectSelection.add(newObj.id);
                        this.renderSidebar();
                        this.renderOverlays(); // FIX: Make image visible immediately
                    };
                    i.src = e.target.result;
                };
                reader.readAsDataURL(file);
            },

            // ── Fix bug formato-por-selección: runs de estilo paralelos a rtieRuns ──
            // Calcula el offset en TEXTO PLANO de un punto (node, offset) del DOM
            // dentro de `container`, recorriendo nodos de texto (soporta <span> anidados).
            _getPlainTextOffset: function (container, node, offset) {
                let plain = 0;
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                let cur;
                while ((cur = walker.nextNode())) {
                    if (cur === node) return plain + offset;
                    plain += cur.textContent.length;
                }
                return plain;
            },

            // Inserta/fusiona un run {start,end,color?,isBold?,isItalic?,isUnderline?}
            // en obj._styleRuns, dividiendo runs previos que se solapen con el rango.
            _applyStyleRunToObj: function (obj, start, end, attrs) {
                if (end <= start) return;
                const runs = obj._styleRuns || [];
                const before = [];
                const overlapping = [];
                for (const r of runs) {
                    if (r.end <= start || r.start >= end) { before.push(r); continue; }
                    if (r.start < start) before.push({ ...r, end: start });
                    if (r.end > end) before.push({ ...r, start: end });
                    overlapping.push({ ...r, start: Math.max(r.start, start), end: Math.min(r.end, end) });
                }
                overlapping.sort((a, b) => a.start - b.start);
                const merged = [];
                let cursor = start;
                for (const r of overlapping) {
                    if (r.start > cursor) merged.push({ start: cursor, end: r.start, ...attrs });
                    merged.push({ ...r, ...attrs, start: r.start, end: r.end });
                    cursor = r.end;
                }
                if (cursor < end) merged.push({ start: cursor, end, ...attrs });

                let next = [...before, ...merged].filter(r => r.end > r.start);
                next.sort((a, b) => a.start - b.start);

                const finalRuns = [];
                for (const r of next) {
                    const last = finalRuns[finalRuns.length - 1];
                    if (last && last.end === r.start &&
                        last.color === r.color && last.isBold === r.isBold &&
                        last.isItalic === r.isItalic && last.isUnderline === r.isUnderline) {
                        last.end = r.end;
                    } else {
                        finalRuns.push({ ...r });
                    }
                }
                obj._styleRuns = finalRuns;
            },

            // Calcula offsets de `range` dentro de `span` y registra el run en obj._styleRuns
            _recordStyleRun: function (obj, span, range, attrs) {
                try {
                    const start = this._getPlainTextOffset(span, range.startContainer, range.startOffset);
                    const end = this._getPlainTextOffset(span, range.endContainer, range.endOffset);
                    this._applyStyleRunToObj(obj, start, end, attrs);
                } catch (e) {
                    console.warn('No se pudo registrar run de estilo:', e);
                }
            },

            // FIX (bug #3): reajusta offsets de una lista de runs {start,end,...attrs} cuando el
            // texto cambia (typing/paste/delete). Genérico, sirve para obj._styleRuns.
            // Promovido desde closure local de showRealTextInlineEditor (app_pdf_ops.js) para
            // que también lo pueda usar el listener 'input' real del modo CTE (app_render.js).
            _reindexRunsForEdit: function (runs, start, oldEnd, delta) {
                const newEnd = oldEnd + delta;
                const _next = [];
                for (const r of (runs || [])) {
                    const { start: rStart, end: rEnd, ...attrs } = r;
                    if (rEnd <= start) { _next.push(r); continue; }
                    if (rStart >= oldEnd) { _next.push({ start: rStart + delta, end: rEnd + delta, ...attrs }); continue; }
                    // El run se solapa con la región editada: conservar solo los tramos sobrevivientes
                    if (rStart < start) _next.push({ start: rStart, end: start, ...attrs });
                    if (rEnd > oldEnd) _next.push({ start: newEnd, end: newEnd + (rEnd - oldEnd), ...attrs });
                }
                return _next.filter(r => r.end > r.start);
            },

            // FIX (bug italic/font no persisten): compone la key de variante (family+Bold+Italic)
            // replicando el degrade-if-missing de applyRealTimeSmartPatch (líneas ~2224-2242),
            // reusable de forma síncrona desde toggleStyle/updateStyle y desde _fontAt en el commit.
            _composeFontKey: function (baseFamily, isBold, isItalic, isFallbackFont) {
                if (!baseFamily) return baseFamily;
                const isBase14 = ['Helvetica', 'Arial', 'Times New Roman', 'Courier'].includes(baseFamily);
                const has = (key) => !!((this.fontRegistry && this.fontRegistry.fonts && this.fontRegistry.fonts[key]) ||
                                         (this._systemFontBytes && this._systemFontBytes[key]));
                let key = baseFamily;
                if (isBold && isItalic) {
                    const bi = baseFamily + '-BoldItalic';
                    if (!isFallbackFont && (has(bi) || isBase14)) {
                        key = bi;
                    } else if (isItalic) {
                        const it = baseFamily + '-Italic';
                        if (has(it) || isBase14) key = it;
                    }
                } else if (isBold && !isFallbackFont) {
                    const b = baseFamily + '-Bold';
                    if (has(b) || isBase14) key = b;
                } else if (isItalic) {
                    const it = baseFamily + '-Italic';
                    if (has(it) || isBase14) key = it;
                }
                return key;
            },

            updateStyle: function (prop) {
                if (!this.selectedObj) return;
                this.saveState();
                const doc = this.getDoc();
                const targets = doc.pages[doc.currentIndex].objects.filter(o => this.multiObjectSelection.has(o.id));
                targets.forEach(obj => {
                    if (prop === 'bgColor') {
                        obj.bgColor = document.getElementById('objBgColor').value;
                        obj.bgAlpha = 1;
                        document.getElementById('objBgAlpha').value = 1;
                    }
                    else if (prop === 'bgAlpha') {
                        obj.bgAlpha = parseFloat(document.getElementById('objBgAlpha').value);
                    }
                    else if (obj.type === 'text') {
                        // ── Detectar si hay selección parcial dentro del span editando ──
                        if (obj.isEditing && (prop === 'color' || prop === 'font' || prop === 'size')) {
                            const el = document.getElementById(obj.id);
                            const span = el && el.querySelector('.text-content');
                            const range = window._lastTextEditorRange;
                            if (span && range && span === window._lastTextEditorSpan) {
                                const hasPartialSelection = window._hadPartialSelection || (!range.collapsed && range.toString().length < (span.innerText || '').length);
                                if (hasPartialSelection) {
                                    // FIX (bug #1): calcular offsets ANTES de mutar el DOM.
                                    // execCommand/surroundContents pueden reemplazar los nodos de texto
                                    // seleccionados; leer el range DESPUÉS de mutar el DOM devuelve
                                    // offsets inválidos (start===end) y el run se descarta en silencio.
                                    const _runStart = this._getPlainTextOffset(span, range.startContainer, range.startOffset);
                                    const _runEnd = this._getPlainTextOffset(span, range.endContainer, range.endOffset);

                                    const sel = window.getSelection();
                                    sel.removeAllRanges();
                                    sel.addRange(range);
                                    
                                    if (prop === 'color') {
                                        const newColor = document.getElementById('textColor').value;
                                        document.execCommand('foreColor', false, newColor);
                                        this._applyStyleRunToObj(obj, _runStart, _runEnd, { color: newColor });
                                    } else if (prop === 'size') {
                                        const newSize = parseFloat(document.getElementById('textSize').value);
                                        const scale = this.currentScale || 1;
                                        const wrapper = document.createElement('span');
                                        wrapper.style.fontSize = (newSize * scale) + 'px';
                                        try { range.surroundContents(wrapper); } catch(e) { /* cross-boundary selection */ }
                                    } else if (prop === 'font') {
                                        const newFont = document.getElementById('fontFamily').value;
                                        const fontInfo = this.fontRegistry.fonts[newFont];
                                        const wrapper = document.createElement('span');
                                        wrapper.style.fontFamily = fontInfo ? `"${fontInfo.family}", sans-serif` : `"${newFont}", Arial, sans-serif`;
                                        wrapper.dataset.font = newFont;
                                        try { range.surroundContents(wrapper); } catch(e) { /* cross-boundary selection */ }
                                        // FIX (bug #2): persistir el run de fuente en _styleRuns (antes solo visual)
                                        this._applyStyleRunToObj(obj, _runStart, _runEnd, { font: newFont });
                                    }
                                    return; // Skip full-object property change
                                }
                            }
                        }
                        
                        // ── Sin selección parcial: cambiar todo el objeto ──
                        if (prop === 'font') {
                            const _newFamily = document.getElementById('fontFamily').value;
                            obj.fontFamilyBase = _newFamily; // FIX: nueva familia base elegida por el usuario
                            obj.font = this._composeFontKey(_newFamily, obj.bold, obj.italic, obj.isFallbackFont);
                        }
                        if (prop === 'size') obj.size = parseFloat(document.getElementById('textSize').value);
                        if (prop === 'color') obj.color = document.getElementById('textColor').value;
                    }
                    if (obj.isEditing) {
                        this.applyStyleLive(obj);
                    }
                });
                if (!targets.some(o => o.isEditing)) {
                    this.renderOverlays();
                }
                this.refreshThumbnail(doc.currentIndex);
            },

            toggleStyle: function (type) {
                this.saveState();
                const doc = this.getDoc();
                const targets = doc.pages[doc.currentIndex].objects.filter(o => this.multiObjectSelection.has(o.id) && o.type === 'text');
                targets.forEach(obj => {
                    // ── Detectar si hay selección parcial dentro del span editando ──
                    if (obj.isEditing) {
                        const el = document.getElementById(obj.id);
                        const span = el && el.querySelector('.text-content');
                        const range = window._lastTextEditorRange;
                        if (span && range && span === window._lastTextEditorSpan) {
                            const hasPartialSelection = window._hadPartialSelection || (!range.collapsed && range.toString().length < (span.innerText || '').length);
                            if (hasPartialSelection) {
                                // FIX (bug #1): calcular offsets ANTES de execCommand (ver mismo fix en updateStyle)
                                const _runStart = this._getPlainTextOffset(span, range.startContainer, range.startOffset);
                                const _runEnd = this._getPlainTextOffset(span, range.endContainer, range.endOffset);

                                const sel = window.getSelection();
                                sel.removeAllRanges();
                                sel.addRange(range);
                                
                                if (type === 'bold') document.execCommand('bold', false, null);
                                if (type === 'italic') document.execCommand('italic', false, null);
                                if (type === 'underline') document.execCommand('underline', false, null);

                                const attrs = {};
                                if (type === 'bold') attrs.isBold = document.queryCommandState('bold');
                                if (type === 'italic') attrs.isItalic = document.queryCommandState('italic');
                                if (type === 'underline') attrs.isUnderline = document.queryCommandState('underline');
                                this._applyStyleRunToObj(obj, _runStart, _runEnd, attrs);
                                return; // Skip full object change
                            }
                        }
                    }
                    
                    // ── Cambiar todo el objeto ──
                    if (type === 'bold') obj.bold = !obj.bold;
                    if (type === 'italic') obj.italic = !obj.italic;
                    if (type === 'underline') obj.underline = !obj.underline;

                    // FIX: recomponer obj.font (family+Bold+Italic) tras togglear, si conocemos la familia base
                    if ((type === 'bold' || type === 'italic') && obj.fontFamilyBase) {
                        obj.font = this._composeFontKey(obj.fontFamilyBase, obj.bold, obj.italic, obj.isFallbackFont);
                    }

                    if (obj.isEditing) {
                        this.applyStyleLive(obj);
                    }
                });
                if (!targets.some(o => o.isEditing)) {
                    this.renderOverlays();
                }
                this.refreshThumbnail(doc.currentIndex);
            },

            setTextAlign: function (align) {
                const doc = this.getDoc();
                if (!doc) return;

                // Update selected text objects
                const targets = doc.pages[doc.currentIndex].objects.filter(o =>
                    (this.multiObjectSelection.has(o.id) || (this.selectedObj && o.id === this.selectedObj.id)) && o.type === 'text'
                );

                if (targets.length > 0) {
                    this.saveState();
                    targets.forEach(obj => {
                        obj.alignment = align;
                        obj.textAlign = align;
                        // Para real edit activo: aplicar directo al span sin re-render (evita perder foco/cursor)
                        if (obj.isEditing && obj._pendingRealData) {
                            const el = document.getElementById(obj.id);
                            if (el) {
                                const span = el.querySelector('.text-content,[contenteditable]');
                                if (span) {
                                    span.style.textAlign = align;
                                    // En nowrap, textAlign no es visible — necesitamos wrapping temporal
                                    // o mostrar la alineación en el contenedor flex
                                    el.style.justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
                                }
                            }
                        }
                    });
                    if (!targets.some(o => o.isEditing && o._pendingRealData)) {
                        this.renderOverlays();
                    }
                    this.renderSidebar();
                }

                // Update button states
                document.querySelectorAll('.align-btn').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.id === 'align-' + align) {
                        btn.classList.add('active');
                    }
                });
            },

            incrementTextSize: function () {
                const input = document.getElementById('textSize');
                let currentSize = parseFloat(input.value) || 16;
                if (currentSize < 200) {
                    input.value = currentSize + 0.5;
                    this.updateStyle('size');
                }
            },

            decrementTextSize: function () {
                const input = document.getElementById('textSize');
                let currentSize = parseFloat(input.value) || 16;
                if (currentSize > 6) {
                    input.value = currentSize - 0.5;
                    this.updateStyle('size');
                }
            },

            changeLetterSpacing: function (delta) {
                if (!this.selectedObj || this.selectedObj.type !== 'text') return;
                this.saveState();

                // Get current value or default 0
                let current = this.selectedObj.letterSpacing !== undefined ? this.selectedObj.letterSpacing : 0;
                this.selectedObj.letterSpacing = Math.round((current + delta) * 10) / 10; // Avoid float issues

                if (this.selectedObj.isEditing) {
                    this.applyStyleLive(this.selectedObj);
                } else {
                    this.renderOverlays();
                }
                this.renderSidebar();
            },

            // Cache for system font bytes (ArrayBuffer) keyed by "Family-weight-style"
            changeLineHeight: function (delta) {
                if (!this.selectedObj || this.selectedObj.type !== 'text') return;
                this.saveState();

                // Get current value or default 1.2
                let current = this.selectedObj.lineHeight !== undefined ? this.selectedObj.lineHeight : 1.2;
                // Clamp to reasonable minimum (e.g. 0.5)
                this.selectedObj.lineHeight = Math.max(0.5, Math.round((current + delta) * 10) / 10);

                if (this.selectedObj.isEditing) {
                    this.applyStyleLive(this.selectedObj);
                } else {
                    this.renderOverlays();
                }
                this.renderSidebar();
            },

            refreshFontSelectors: function () {
                const families = Array.from(this._systemFontFamilies).sort();
                const selects = document.querySelectorAll('select[id*="font"], select[id*="Font"]');

                selects.forEach(select => {
                    // Limpiar solo las opciones de sistema previas si existen (marcadas con 💻)
                    // o simplemente asegurar que todas las familias están
                    const existing = new Set(Array.from(select.options).map(o => o.value));
                    families.forEach(family => {
                        if (!existing.has(family)) {
                            const opt = document.createElement('option');
                            opt.value = family;
                            opt.textContent = "💻 " + family;
                            select.appendChild(opt);
                        }
                    });
                });
                console.log("🔄 Font selectors refreshed with", families.length, "families");
            },

            syncAlignmentButtons: function () {
                // Sync alignment buttons with selected text object
                let align = 'center'; // default
                if (this.selectedObj && this.selectedObj.type === 'text') {
                    align = this.selectedObj.alignment || 'center';
                }
                document.querySelectorAll('.align-btn').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.id === 'align-' + align) {
                        btn.classList.add('active');
                    }
                });
            },

            syncToolbar: function () {
                // Sincroniza los selectores de la barra de herramientas con el objeto seleccionado
                const o = this.selectedObj;
                if (!o) return;

                if (o.type === 'text') {
                    const fontSel = document.getElementById('fontFamily');
                    if (fontSel) fontSel.value = o.font || 'Arial';

                    const sizeInp = document.getElementById('textSize');
                    if (sizeInp) sizeInp.value = o.size || 16;

                    const colorInp = document.getElementById('textColor');
                    if (colorInp) colorInp.value = o.color || '#000000';

                    // Botones de estilo (Bold/Italic/Underline)
                    document.querySelectorAll('.style-btn').forEach(btn => {
                        // Evitar botones de alineación aquí si tienen la misma clase pero lógica propia
                        if (btn.classList.contains('align-btn')) return;

                        btn.classList.remove('active');
                        const isBoldBtn = btn.getAttribute('onclick')?.includes("'bold'");
                        const isItalicBtn = btn.getAttribute('onclick')?.includes("'italic'");
                        const isUnderlineBtn = btn.getAttribute('onclick')?.includes("'underline'");

                        if (isBoldBtn && o.bold) btn.classList.add('active');
                        if (isItalicBtn && o.italic) btn.classList.add('active');
                        if (isUnderlineBtn && o.underline) btn.classList.add('active');
                    });

                    this.syncAlignmentButtons();
                }

                // Color de fondo y transparencia
                const bgCol = document.getElementById('objBgColor');
                if (bgCol) bgCol.value = this._toHexColor(o.bgColor, '#ffffff');

                const bgAlph = document.getElementById('objBgAlpha');
                if (bgAlph) bgAlph.value = o.bgAlpha !== undefined ? o.bgAlpha : 0;
            },

            applyStyleLive: function (obj) {
                const el = document.getElementById(obj.id);
                if (!el) return;
                const span = el.querySelector('.text-content');
                if (!span) return;

                const scale = this.currentScale || 1;

                const fontInfo = this.fontRegistry.fonts[obj.font];
                if (fontInfo) {
                    span.style.fontFamily = `"${fontInfo.family}", sans-serif`;
                    span.style.fontWeight = obj.bold ? 'bold' : (fontInfo.weight || 'normal');
                    span.style.fontStyle = obj.italic ? 'italic' : (fontInfo.style || 'normal');
                } else {
                    span.style.fontFamily = `"${obj.font}", Arial, sans-serif`;
                    span.style.fontWeight = obj.bold ? 'bold' : 'normal';
                    span.style.fontStyle = obj.italic ? 'italic' : 'normal';
                }

                span.style.textDecoration = obj.underline ? 'underline' : 'none';
                span.style.color = obj.color;
                span.style.fontSize = (obj.size * scale) + 'px';

                const lsEm = (obj.letterSpacing || 0) / 100;
                span.style.letterSpacing = (lsEm * obj.size * scale) + 'px';

                if (obj.isParagraph) {
                    span.style.lineHeight = obj.lineHeight !== undefined ? obj.lineHeight : 1.2;
                } else {
                    span.style.lineHeight = '1';
                }

                if (obj.bgColor) {
                    if (obj.bgAlpha === 0) {
                        el.style.backgroundColor = 'transparent';
                    } else {
                        el.style.backgroundColor = obj.bgColor;
                    }
                }
                
                // Refocus if it was lost during style application
                if (obj.isEditing && document.activeElement !== span) {
                    span.focus();
                }

                // Restaurar selección de texto perdida al usar controles externos (selector fuente/color)
                if (obj.isEditing && window._lastTextEditorSpan === span && window._lastTextEditorRange) {
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    try { sel.addRange(window._lastTextEditorRange); } catch (e) { /* rango inválido, ignorar */ }
                }

                // Force a direct sync of the toolbar buttons
                this.syncToolbar();
            },

            updateImageStyle: function () {
                if (this.selectedObj && this.selectedObj.type === 'image') {
                    this.saveStateDebounced(600);
                    if (!this.selectedObj.filters) this.selectedObj.filters = {};
                    this.selectedObj.filters.brightness = document.getElementById('imgBrightness').value;
                    this.selectedObj.filters.contrast = document.getElementById('imgContrast').value;
                    this.selectedObj.filters.saturate = document.getElementById('imgSaturate').value;
                    this.selectedObj.filters.hue = document.getElementById('imgHue').value;
                    this.selectedObj.filters.blur = document.getElementById('imgBlur').value;
                    // FIX: Convert slider range (10-100) to opacity range (0.1-1.0)
                    this.selectedObj.opacity = parseInt(document.getElementById('imgOpacity').value) / 100;
                    this.selectedObj.filters.grayscale = document.getElementById('imgGrayscale').checked;
                    this.selectedObj.filters.invert = document.getElementById('imgInvert').checked;
                    this.selectedObj.filters.sepia = document.getElementById('imgSepia').checked;
                    this.renderOverlays();
                    // Sidebar se actualiza solo cuando el debounce dispara saveState
                }
            },

            // ══════════════════════════════════════════════════════
            //  IMAGE EFFECTS MODAL — full rewrite
            // ══════════════════════════════════════════════════════
            _iemObj: null,
            _iemOrigSrc: null,
            _iemPreviewSrc: null, // current preview (may differ from obj.src)
            _iemFlipH: false,
            _iemFlipV: false,
            _iemFrame: 'none',
            _iemRefDir: 'bottom',
            _iemActiveFx: null,
            _iemMagicAction: 'remove',
            _iemMagicColor: null,
            _iemMagicPreviewSrc: null,

            openImageEffectsModal: function () {
                const obj = this.selectedObj;
                if (!obj || obj.type !== 'image') { this.showToast('Selecciona una imagen primero'); return; }
                this._iemObj = obj;
                this._iemOrigSrc = obj.src;
                this._iemPreviewSrc = obj.src;
                this._iemMagicPreviewSrc = obj.src;
                this._iemFlipH = (obj.scaleX || 1) < 0;
                this._iemFlipV = (obj.scaleY || 1) < 0;
                this._iemFrame = obj.clipShape || 'none';
                this._iemRefDir = 'bottom';
                this._iemActiveFx = null;
                this._iemMagicAction = 'remove';
                this._iemMagicColor = null;

                // Restore shadow values
                document.getElementById('iem-shadow-on').checked = obj.shadow || false;
                document.getElementById('iem-sc').value = obj.shadowColor || '#000000';
                document.getElementById('iem-so').value = obj.shadowOpacity !== undefined ? obj.shadowOpacity : 0.4;
                document.getElementById('iem-sb').value = obj.shadowBlur !== undefined ? obj.shadowBlur : 6;
                document.getElementById('iem-sx').value = obj.shadowX !== undefined ? obj.shadowX : 3;
                document.getElementById('iem-sy').value = obj.shadowY !== undefined ? obj.shadowY : 3;
                document.getElementById('iem-so-v').textContent = Math.round((obj.shadowOpacity||0.4)*100)+'%';
                document.getElementById('iem-sb-v').textContent = (obj.shadowBlur||6)+'px';
                document.getElementById('iem-sx-v').textContent = (obj.shadowX||3)+'px';
                document.getElementById('iem-sy-v').textContent = (obj.shadowY||3)+'px';
                const sOpts = document.getElementById('iem-shadow-opts');
                sOpts.style.opacity = (obj.shadow) ? '1' : '0.4';
                sOpts.style.pointerEvents = (obj.shadow) ? '' : 'none';

                // Flip buttons
                document.getElementById('iem-fliph').classList.toggle('active', this._iemFlipH);
                document.getElementById('iem-flipv').classList.toggle('active', this._iemFlipV);
                document.getElementById('iem-fliph').onclick = () => {
                    this._iemFlipH = !this._iemFlipH;
                    document.getElementById('iem-fliph').classList.toggle('active', this._iemFlipH);
                    this.iemRenderPreview();
                };
                document.getElementById('iem-flipv').onclick = () => {
                    this._iemFlipV = !this._iemFlipV;
                    document.getElementById('iem-flipv').classList.toggle('active', this._iemFlipV);
                    this.iemRenderPreview();
                };

                // Frame
                document.querySelectorAll('.iem-frame-opt').forEach(el => el.classList.toggle('active', el.dataset.frame === this._iemFrame));

                // Reflection defaults
                document.getElementById('iem-ref-len').value = 50;
                document.getElementById('iem-ref-op').value = 0.4;
                document.getElementById('iem-ref-gap').value = 4;
                document.getElementById('iem-ref-len-v').textContent = '50%';
                document.getElementById('iem-ref-op-v').textContent = '40%';
                document.getElementById('iem-ref-gap-v').textContent = '4px';
                document.querySelectorAll('[data-refdir]').forEach(b => b.classList.toggle('active', b.dataset.refdir === 'bottom'));

                // Fx grid
                document.querySelectorAll('.iem-fx-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('iem-fx-params').innerHTML = '<p style="font-size:11px;color:rgba(200,215,255,0.4);margin:0;">Selecciona un efecto para ver sus parámetros.</p>';

                // Sparkle defaults
                document.getElementById('iem-spark-density').value = 22;
                document.getElementById('iem-spark-size').value = 12;
                document.getElementById('iem-spark-density-v').textContent = '22';
                document.getElementById('iem-spark-size-v').textContent = '12px';

                // Switch to first tab
                this.iemSwitchTab('espejo');

                // Show magic canvas in preview area when on fondo tab (handled in tab switch)
                const mc = document.getElementById('iem-magic-canvas');
                mc.style.display = 'none';

                // Render initial preview
                this.iemRenderPreview();

                // ── Real-time preview listeners ──
                // Shadow
                const _shadowLabelFmt = {'iem-so': v=>Math.round(v*100)+'%', 'iem-sb': v=>v+'px', 'iem-sx': v=>v+'px', 'iem-sy': v=>v+'px'};
                ['iem-shadow-on','iem-sc','iem-so','iem-sb','iem-sx','iem-sy'].forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.oninput = el.onchange = () => {
                        const fmt = _shadowLabelFmt[id];
                        if (fmt) { const vel = document.getElementById(id+'-v'); if(vel) vel.textContent = fmt(parseFloat(el.value)); }
                        this.iemRenderPreview();
                    };
                });
                // Shadow enable/disable opts panel
                document.getElementById('iem-shadow-on').addEventListener('change', () => {
                    const sOpts = document.getElementById('iem-shadow-opts');
                    const on = document.getElementById('iem-shadow-on').checked;
                    sOpts.style.opacity = on ? '1' : '0.4';
                    sOpts.style.pointerEvents = on ? '' : 'none';
                    this.iemRenderPreview();
                });
                // Reflection sliders
                ['iem-ref-len','iem-ref-op','iem-ref-gap'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.oninput = () => {
                        document.getElementById(id+'-v').textContent = id==='iem-ref-op'
                            ? Math.round(parseFloat(el.value)*100)+'%'
                            : el.value+(id==='iem-ref-len'?'%':'px');
                        clearTimeout(this._iemRefTimer);
                        this._iemRefTimer = setTimeout(() => {
                            this._iemLoadImg(this._iemOrigSrc, img => {
                                this._iemPreviewSrc = this._iemComposeReflection(img);
                                this.iemRenderPreview();
                            });
                        }, 300);
                    };
                });
                // Effects slider auto-preview
                document.getElementById('iem-fx-params').addEventListener('input', () => {
                    clearTimeout(this._iemFxTimer);
                    this._iemFxTimer = setTimeout(() => this.iemRunFxPreview(), 250);
                });

                // Setup magic canvas click
                mc.onclick = (e) => {
                    const r = mc.getBoundingClientRect();
                    const x = Math.round((e.clientX - r.left) * (mc.width / r.width));
                    const y = Math.round((e.clientY - r.top) * (mc.height / r.height));
                    const ctx = mc.getContext('2d');
                    const px = ctx.getImageData(x, y, 1, 1).data;
                    const hex = '#' + [px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
                    this._iemMagicColor = hex;
                    document.getElementById('iem-magic-color').value = hex;
                };

                // Show all glass-box panels hidden, then show iem
                document.querySelectorAll('#modal-overlay .glass-box').forEach(el => el.style.display = 'none');
                const iemPanel = document.getElementById('iem-modal-content');
                iemPanel.style.display = 'flex';
                const mo = document.getElementById('modal-overlay');
                mo.style.display = 'flex';
                mo.classList.remove('anim-in'); void mo.offsetWidth; mo.classList.add('anim-in');
                setTimeout(()=>{ iemPanel.classList.remove('anim-in'); void iemPanel.offsetWidth; iemPanel.classList.add('anim-in'); }, 0);
            },

            iemSwitchTab: function(tab) {
                document.querySelectorAll('.iem-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                document.querySelectorAll('.iem-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'iem-panel-'+tab));
                const mc = document.getElementById('iem-magic-canvas');
                const prevBox = document.getElementById('iem-preview-box');
                if (tab === 'fondo') {
                    prevBox.style.display = 'none';
                    mc.style.display = 'block';
                    this._iemLoadMagicCanvas();
                } else {
                    prevBox.style.display = '';
                    mc.style.display = 'none';
                    this.iemRenderPreview();
                }
            },

            _iemLoadMagicCanvas: function() {
                const mc = document.getElementById('iem-magic-canvas');
                const img = new Image();
                img.onload = () => {
                    const maxW = 280, maxH = 250;
                    const scale = Math.min(maxW/img.width, maxH/img.height, 1);
                    mc.width = Math.round(img.width*scale);
                    mc.height = Math.round(img.height*scale);
                    mc.getContext('2d').drawImage(img, 0, 0, mc.width, mc.height);
                    this._iemMagicPreviewSrc = mc.toDataURL();
                };
                img.src = this._iemOrigSrc;
            },

            iemMagicAction: function(action) {
                this._iemMagicAction = action;
                document.getElementById('iem-magic-remove').classList.toggle('active', action==='remove');
                document.getElementById('iem-magic-keep').classList.toggle('active', action==='keep');
            },

            iemMagicApplyFlood: function() {
                if (!this._iemMagicColor) { this.showToast('Haz clic en un color de la imagen primero'); return; }
                const mc = document.getElementById('iem-magic-canvas');
                const ctx = mc.getContext('2d');
                const tol = parseInt(document.getElementById('iem-magic-tol').value);
                const imgData = ctx.getImageData(0, 0, mc.width, mc.height);
                const data = imgData.data;
                const tc = this._iemMagicColor;
                const tr = parseInt(tc.slice(1,3),16), tg = parseInt(tc.slice(3,5),16), tb = parseInt(tc.slice(5,7),16);
                const colorDist = (i) => Math.sqrt(Math.pow(data[i]-tr,2)+Math.pow(data[i+1]-tg,2)+Math.pow(data[i+2]-tb,2));
                const action = this._iemMagicAction;
                // Flood fill from all pixels matching color (global tolerance, not flood)
                for (let i=0; i<data.length; i+=4) {
                    const d = colorDist(i);
                    if (action === 'remove') {
                        if (d <= tol) data[i+3] = Math.max(0, data[i+3] - Math.round(255*(1-d/tol)));
                    } else {
                        if (d > tol) data[i+3] = Math.max(0, data[i+3] - Math.round(255*(d-tol)/255));
                    }
                }
                ctx.putImageData(imgData, 0, 0);
                this._iemMagicPreviewSrc = mc.toDataURL('image/png');
                this.showToast('✅ Vista previa actualizada');
            },

            iemRenderPreview: function() {
                const cvs = document.getElementById('iem-preview-canvas');
                const img = new Image();
                img.onload = () => {
                    const maxW = 276, maxH = 246;
                    const scale = Math.min(maxW/img.width, maxH/img.height, 1);
                    cvs.width = Math.round(img.width*scale);
                    cvs.height = Math.round(img.height*scale);
                    const ctx = cvs.getContext('2d');
                    ctx.clearRect(0,0,cvs.width,cvs.height);
                    // Shadow preview via canvas shadow
                    const shadowOn = document.getElementById('iem-shadow-on')?.checked;
                    if (shadowOn) {
                        const sc = document.getElementById('iem-sc')?.value || '#000000';
                        const so = parseFloat(document.getElementById('iem-so')?.value || 0.4);
                        const sb = parseFloat(document.getElementById('iem-sb')?.value || 6);
                        const sx = parseFloat(document.getElementById('iem-sx')?.value || 3);
                        const sy = parseFloat(document.getElementById('iem-sy')?.value || 3);
                        const r = parseInt(sc.slice(1,3),16), g = parseInt(sc.slice(3,5),16), b = parseInt(sc.slice(5,7),16);
                        ctx.shadowColor = `rgba(${r},${g},${b},${so})`;
                        ctx.shadowBlur = sb;
                        ctx.shadowOffsetX = sx;
                        ctx.shadowOffsetY = sy;
                    } else {
                        ctx.shadowColor = 'transparent';
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                    }
                    // flip
                    ctx.save();
                    ctx.translate(this._iemFlipH ? cvs.width : 0, this._iemFlipV ? cvs.height : 0);
                    ctx.scale(this._iemFlipH ? -1:1, this._iemFlipV ? -1:1);
                    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
                    ctx.restore();
                };
                img.src = this._iemPreviewSrc;
            },

            // ── Effect canvas composers ──────────────────────────────

            _iemLoadImg: function(src, cb) {
                const img = new Image();
                img.onload = () => cb(img);
                img.src = src;
            },

            _iemComposeFx: function(fxFn, params) {
                this._iemLoadImg(this._iemOrigSrc, (img) => {
                    const cvs = document.createElement('canvas');
                    cvs.width = img.width; cvs.height = img.height;
                    const ctx = cvs.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    fxFn(ctx, cvs, img, params);
                    this._iemPreviewSrc = cvs.toDataURL('image/png');
                    this.iemRenderPreview();
                });
            },

            iemPreviewFx: function(fx) {
                this._iemActiveFx = fx;
                document.querySelectorAll('.iem-fx-btn').forEach(b => b.classList.toggle('active', b.dataset.fx===fx));
                this._buildFxParams(fx);
                this.iemRunFxPreview();
            },

            _buildFxParams: function(fx) {
                const cont = document.getElementById('iem-fx-params');
                const paramDefs = {
                    vignette: [{ id:'strength', label:'Intensidad', min:0.1, max:1, step:0.05, val:0.5, fmt: v=>Math.round(v*100)+'%' }],
                    pixelate: [{ id:'size', label:'Tamaño px', min:2, max:40, step:1, val:8, fmt: v=>v+'px' }],
                    sketch:   [{ id:'strength', label:'Fuerza', min:0.3, max:1.5, step:0.05, val:0.85, fmt: v=>Math.round(v*100)+'%' }],
                    poster:   [{ id:'levels', label:'Niveles', min:2, max:8, step:1, val:4, fmt: v=>v }],
                    noise:    [{ id:'amount', label:'Cantidad', min:5, max:80, step:1, val:25, fmt: v=>v+'%' }],
                    glitch:   [{ id:'offset', label:'Offset', min:2, max:25, step:1, val:8, fmt: v=>v+'px' },
                               { id:'bands', label:'Bandas', min:3, max:15, step:1, val:6, fmt: v=>v }],
                    wrap:     [{ id:'amplitude', label:'Amplitud', min:2, max:30, step:1, val:10, fmt: v=>v+'px' },
                               { id:'frequency', label:'Frecuencia', min:1, max:20, step:1, val:6, fmt: v=>v }],
                    mono:     [{ id:'r', label:'R mix', min:0, max:1, step:0.05, val:0.3, fmt: v=>Math.round(v*100)+'%' },
                               { id:'g', label:'G mix', min:0, max:1, step:0.05, val:0.59, fmt: v=>Math.round(v*100)+'%' },
                               { id:'b', label:'B mix', min:0, max:1, step:0.05, val:0.11, fmt: v=>Math.round(v*100)+'%' }],
                    glow:     [{ id:'radius', label:'Radio', min:2, max:30, step:1, val:8, fmt: v=>v+'px' },
                               { id:'intensity', label:'Intensidad', min:0.1, max:1.5, step:0.05, val:0.6, fmt: v=>Math.round(v*100)+'%' }],
                };
                const params = paramDefs[fx] || [];
                const state = {};
                params.forEach(p => state[p.id] = p.val);
                cont.innerHTML = params.map(p => `
                    <div class="iem-row">
                        <label>${p.label}</label>
                        <input type="range" id="iem-fx-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}">
                        <span class="val" id="iem-fx-${p.id}-v">${p.fmt(p.val)}</span>
                    </div>`).join('') +
                    `<button class="iem-toggle-btn" style="margin-top:6px;width:100%;text-align:center;" onclick="app.iemRunFxPreview()">▶ Previsualizar efecto</button>`;
                params.forEach(p => {
                    const el = document.getElementById('iem-fx-'+p.id);
                    const vEl = document.getElementById('iem-fx-'+p.id+'-v');
                    if (el) el.oninput = () => { vEl.textContent = p.fmt(parseFloat(el.value)); };
                });
            },

            iemRunFxPreview: function() {
                const fx = this._iemActiveFx;
                if (!fx) return;
                const getP = id => { const e = document.getElementById('iem-fx-'+id); return e ? parseFloat(e.value) : 0; };
                const self = this;
                this._iemLoadImg(this._iemOrigSrc, (img) => {
                    const cvs = document.createElement('canvas');
                    cvs.width = img.width; cvs.height = img.height;
                    const ctx = cvs.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    self._applyFxToCtx(ctx, cvs, img, fx, getP);
                    self._iemPreviewSrc = cvs.toDataURL('image/png');
                    self.iemRenderPreview();
                });
            },

            _applyFxToCtx: function(ctx, cvs, img, fx, getP) {
                const W = cvs.width, H = cvs.height;
                if (fx === 'vignette') {
                    const s = getP('strength');
                    const grad = ctx.createRadialGradient(W/2,H/2, Math.min(W,H)*0.3, W/2,H/2, Math.max(W,H)*0.75);
                    grad.addColorStop(0,'rgba(0,0,0,0)');
                    grad.addColorStop(1,`rgba(0,0,0,${s})`);
                    ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);
                } else if (fx === 'pixelate') {
                    const sz = Math.max(2, Math.round(getP('size')));
                    const tmp = document.createElement('canvas'); tmp.width=W; tmp.height=H;
                    const tc = tmp.getContext('2d');
                    tc.imageSmoothingEnabled = false;
                    tc.drawImage(cvs, 0,0, Math.ceil(W/sz), Math.ceil(H/sz));
                    ctx.clearRect(0,0,W,H);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(tmp, 0,0, Math.ceil(W/sz), Math.ceil(H/sz), 0,0,W,H);
                    ctx.imageSmoothingEnabled = true;
                } else if (fx === 'sketch') {
                    const id = ctx.getImageData(0,0,W,H), d=id.data, s=getP('strength');
                    const gray = new Uint8ClampedArray(W*H);
                    for (let i=0;i<W*H;i++) gray[i]=(d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11);
                    const edgeD = new Uint8ClampedArray(id.data);
                    for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
                        const i=y*W+x;
                        const gx=gray[i-1]-gray[i+1]; const gy=gray[i-W]-gray[i+W];
                        const mag=Math.min(255, Math.sqrt(gx*gx+gy*gy)*s*2);
                        const inv=255-mag;
                        edgeD[i*4]=inv; edgeD[i*4+1]=inv; edgeD[i*4+2]=inv; edgeD[i*4+3]=255;
                    }
                    ctx.putImageData(new ImageData(edgeD,W,H),0,0);
                } else if (fx === 'poster') {
                    const lvl = Math.round(getP('levels'));
                    const id = ctx.getImageData(0,0,W,H), d=id.data;
                    const step=255/(lvl-1);
                    for (let i=0;i<d.length;i+=4) {
                        d[i]=Math.round(d[i]/step)*step;
                        d[i+1]=Math.round(d[i+1]/step)*step;
                        d[i+2]=Math.round(d[i+2]/step)*step;
                    }
                    ctx.putImageData(id,0,0);
                } else if (fx === 'noise') {
                    const amt = getP('amount')/100;
                    const id = ctx.getImageData(0,0,W,H), d=id.data;
                    for (let i=0;i<d.length;i+=4) {
                        const n=(Math.random()*2-1)*255*amt;
                        d[i]=Math.max(0,Math.min(255,d[i]+n));
                        d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
                        d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));
                    }
                    ctx.putImageData(id,0,0);
                } else if (fx === 'glitch') {
                    const off = Math.round(getP('offset')), bands = Math.round(getP('bands'));
                    const src = ctx.getImageData(0,0,W,H);
                    const dst = ctx.createImageData(W,H); dst.data.set(src.data);
                    const bh = Math.ceil(H/bands);
                    for (let b=0;b<bands;b++) {
                        if (Math.random()<0.5) continue;
                        const shift = (Math.random()*2-1)*off;
                        const y0=b*bh, y1=Math.min(H,(b+1)*bh);
                        for (let y=y0;y<y1;y++) for (let x=0;x<W;x++) {
                            const sx=Math.max(0,Math.min(W-1,x+shift));
                            const si=(y*W+sx)*4, di=(y*W+x)*4;
                            dst.data[di]=src.data[si]; dst.data[di+1]=src.data[si+1]; dst.data[di+2]=src.data[si+2]; dst.data[di+3]=src.data[si+3];
                        }
                    }
                    ctx.putImageData(dst,0,0);
                    // RGB channel shift for glitch feel
                    const tmp2=document.createElement('canvas'); tmp2.width=W; tmp2.height=H;
                    const tc2=tmp2.getContext('2d'); tc2.drawImage(cvs,0,0);
                    ctx.globalCompositeOperation='screen'; ctx.globalAlpha=0.3;
                    ctx.drawImage(tmp2, Math.round(off*0.5), 0); ctx.drawImage(tmp2, -Math.round(off*0.5), 0);
                    ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
                } else if (fx === 'wrap') {
                    const amp=getP('amplitude'), freq=getP('frequency');
                    const src=ctx.getImageData(0,0,W,H), dst=ctx.createImageData(W,H);
                    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
                        const sx=Math.round(x+amp*Math.sin(y/H*Math.PI*freq));
                        const sy=Math.round(y+amp*Math.cos(x/W*Math.PI*freq));
                        const sx2=Math.max(0,Math.min(W-1,sx)), sy2=Math.max(0,Math.min(H-1,sy));
                        const si=(sy2*W+sx2)*4, di=(y*W+x)*4;
                        dst.data[di]=src.data[si]; dst.data[di+1]=src.data[si+1]; dst.data[di+2]=src.data[si+2]; dst.data[di+3]=src.data[si+3];
                    }
                    ctx.putImageData(dst,0,0);
                    // Add specular highlight for plastic effect
                    const gWrap = ctx.createLinearGradient(0,0,W,H*0.4);
                    gWrap.addColorStop(0,'rgba(255,255,255,0.28)');
                    gWrap.addColorStop(0.5,'rgba(255,255,255,0.08)');
                    gWrap.addColorStop(1,'rgba(0,0,0,0.15)');
                    ctx.fillStyle=gWrap; ctx.fillRect(0,0,W,H);
                } else if (fx === 'mono') {
                    const rM=getP('r'), gM=getP('g'), bM=getP('b');
                    const id=ctx.getImageData(0,0,W,H), d=id.data;
                    for (let i=0;i<d.length;i+=4) {
                        const v=d[i]*rM+d[i+1]*gM+d[i+2]*bM;
                        d[i]=d[i+1]=d[i+2]=Math.min(255,v);
                    }
                    ctx.putImageData(id,0,0);
                } else if (fx === 'glow') {
                    const rad=getP('radius'), intens=getP('intensity');
                    const tmp3=document.createElement('canvas'); tmp3.width=W; tmp3.height=H;
                    const tc3=tmp3.getContext('2d');
                    tc3.filter=`blur(${rad}px)`;
                    tc3.drawImage(cvs,0,0);
                    ctx.globalCompositeOperation='screen';
                    ctx.globalAlpha=intens;
                    ctx.drawImage(tmp3,0,0);
                    ctx.globalCompositeOperation='source-over';
                    ctx.globalAlpha=1;
                }
            },

            _iemComposeReflection: function(img) {
                const dir = this._iemRefDir;
                const len = parseInt(document.getElementById('iem-ref-len').value)/100;
                const op = parseFloat(document.getElementById('iem-ref-op').value);
                const gap = parseInt(document.getElementById('iem-ref-gap').value);
                const W=img.width, H=img.height;
                let cW=W, cH=H;
                if (dir==='bottom'||dir==='top') cH = H + Math.round(H*len) + gap;
                else cW = W + Math.round(W*len) + gap;
                const cvs=document.createElement('canvas'); cvs.width=cW; cvs.height=cH;
                const ctx=cvs.getContext('2d');
                // Draw original
                const ox = (dir==='right') ? 0 : 0;
                const oy = (dir==='bottom') ? 0 : (dir==='top') ? Math.round(H*len)+gap : 0;
                ctx.drawImage(img, ox, oy);
                // Draw reflection
                const refH = Math.round(H*len), refW = Math.round(W*len);
                ctx.save();
                let rx=0, ry=0;
                if (dir==='bottom') { rx=0; ry=H+gap; ctx.translate(rx, ry+refH); ctx.scale(1,-1); ctx.drawImage(img, 0, 0, W, refH, 0, 0, W, refH); }
                else if (dir==='top') { rx=0; ry=0; ctx.translate(rx+W, ry+refH); ctx.scale(-1,-1); ctx.drawImage(img, 0, H-refH, W, refH, 0, 0, W, refH); }
                else if (dir==='right') { rx=W+gap; ry=0; ctx.translate(rx+refW, ry); ctx.scale(-1,1); ctx.drawImage(img, 0, 0, refW, H, 0, 0, refW, H); }
                else { rx=0; ry=0; ctx.translate(refW, 0); ctx.scale(-1,1); ctx.drawImage(img, W-refW, 0, refW, H, 0, 0, refW, H); }
                ctx.restore();
                // Gradient fade
                ctx.save();
                let grd;
                if (dir==='bottom') { grd=ctx.createLinearGradient(0,H+gap,0,cH); }
                else if (dir==='top') { grd=ctx.createLinearGradient(0,refH,0,0); }
                else if (dir==='right') { grd=ctx.createLinearGradient(W+gap,0,cW,0); }
                else { grd=ctx.createLinearGradient(refW,0,0,0); }
                grd.addColorStop(0,`rgba(0,0,0,${1-op})`);
                grd.addColorStop(1,'rgba(0,0,0,1)');
                ctx.globalCompositeOperation='destination-out';
                ctx.fillStyle=grd;
                if (dir==='bottom') ctx.fillRect(0,H+gap,cW,refH+2);
                else if (dir==='top') ctx.fillRect(0,0,cW,refH+2);
                else if (dir==='right') ctx.fillRect(W+gap,0,refW+2,cH);
                else ctx.fillRect(0,0,refW+2,cH);
                ctx.restore();
                return cvs.toDataURL('image/png');
            },

            _iemComposeFrame: function(src, frame, borderColor, borderWidth, cb) {
                const img=new Image(); img.onload=()=>{
                    const W=img.width, H=img.height;
                    const cvs=document.createElement('canvas'); cvs.width=W; cvs.height=H;
                    const ctx=cvs.getContext('2d');
                    ctx.clearRect(0,0,W,H);
                    // Clip path
                    ctx.save();
                    ctx.beginPath();
                    if (frame==='circle') { ctx.arc(W/2,H/2,Math.min(W,H)/2,0,Math.PI*2); }
                    else if (frame==='oval') { ctx.ellipse(W/2,H/2,W/2,H/2*0.75,0,0,Math.PI*2); }
                    else if (frame==='round-sm') { ctx.roundRect(0,0,W,H,W*0.06); }
                    else if (frame==='round-md') { ctx.roundRect(0,0,W,H,W*0.12); }
                    else if (frame==='round-lg') { ctx.roundRect(0,0,W,H,Math.min(W,H)*0.45); }
                    else if (frame==='diamond') { ctx.moveTo(W/2,0);ctx.lineTo(W,H/2);ctx.lineTo(W/2,H);ctx.lineTo(0,H/2);ctx.closePath(); }
                    else if (frame==='hexagon') {
                        const a=Math.PI/3;
                        for(let i=0;i<6;i++){ctx.lineTo(W/2+Math.min(W,H)/2*Math.cos(a*i-Math.PI/6),H/2+Math.min(W,H)/2*Math.sin(a*i-Math.PI/6));}
                        ctx.closePath();
                    }
                    else { ctx.rect(0,0,W,H); }
                    ctx.clip();
                    ctx.drawImage(img,0,0);
                    ctx.restore();
                    // Border
                    if (borderWidth>0) {
                        ctx.save();
                        ctx.strokeStyle=borderColor; ctx.lineWidth=borderWidth*2;
                        ctx.beginPath();
                        if (frame==='circle') ctx.arc(W/2,H/2,Math.min(W,H)/2,0,Math.PI*2);
                        else if (frame==='oval') ctx.ellipse(W/2,H/2,W/2,H/2*0.75,0,0,Math.PI*2);
                        else if (frame==='round-sm') ctx.roundRect(0,0,W,H,W*0.06);
                        else if (frame==='round-md') ctx.roundRect(0,0,W,H,W*0.12);
                        else if (frame==='round-lg') ctx.roundRect(0,0,W,H,Math.min(W,H)*0.45);
                        else if (frame==='diamond') {ctx.moveTo(W/2,0);ctx.lineTo(W,H/2);ctx.lineTo(W/2,H);ctx.lineTo(0,H/2);ctx.closePath();}
                        else ctx.rect(0,0,W,H);
                        ctx.stroke(); ctx.restore();
                    }
                    cb(cvs.toDataURL('image/png'));
                };
                img.src=src;
            },

            _iemComposeSparkles: function(img) {
                const W=img.width, H=img.height;
                const cvs=document.createElement('canvas'); cvs.width=W; cvs.height=H;
                const ctx=cvs.getContext('2d');
                ctx.drawImage(img,0,0);
                const c1=document.getElementById('iem-spark-c1').value;
                const c2=document.getElementById('iem-spark-c2').value;
                const density=parseInt(document.getElementById('iem-spark-density').value);
                const maxSz=parseInt(document.getElementById('iem-spark-size').value);
                const zone=document.getElementById('iem-spark-zone').value;
                const style=document.querySelector('.iem-toggle-btn[data-sparkstyle].active')?.dataset.sparkstyle||'star';
                const rng=()=>Math.random();
                const drawSpark=(cx,cy,sz,color,rot)=>{
                    ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot||0);
                    ctx.fillStyle=color; ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=sz*0.06;
                    ctx.beginPath();
                    if(style==='star'){
                        const spikes=4, outerR=sz/2, innerR=sz/5;
                        for(let i=0;i<spikes*2;i++){
                            const r=i%2===0?outerR:innerR;
                            const a=i*Math.PI/spikes;
                            i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
                        }
                        ctx.closePath();
                    } else if(style==='circle'){
                        ctx.arc(0,0,sz/2,0,Math.PI*2);
                    } else if(style==='cross'){
                        const t=sz*0.15, l=sz/2;
                        ctx.moveTo(-t,-l);ctx.lineTo(t,-l);ctx.lineTo(t,-t);ctx.lineTo(l,-t);ctx.lineTo(l,t);ctx.lineTo(t,t);ctx.lineTo(t,l);ctx.lineTo(-t,l);ctx.lineTo(-t,t);ctx.lineTo(-l,t);ctx.lineTo(-l,-t);ctx.lineTo(-t,-t);ctx.closePath();
                    } else if(style==='diamond'){
                        ctx.moveTo(0,-sz/2);ctx.lineTo(sz/3,0);ctx.lineTo(0,sz/2);ctx.lineTo(-sz/3,0);ctx.closePath();
                    }
                    const g=ctx.createRadialGradient(0,0,0,0,0,sz/2);
                    g.addColorStop(0,'rgba(255,255,255,0.95)');
                    g.addColorStop(0.4,color);
                    g.addColorStop(1,'rgba(255,255,255,0.05)');
                    ctx.fillStyle=g; ctx.fill(); ctx.stroke();
                    // inner glow lines
                    ctx.globalAlpha=0.5;
                    ['rgba(255,255,255,0.9)','rgba(255,255,255,0.4)'].forEach((lc,li)=>{
                        const len=(sz/2)*(0.9-li*0.3);
                        ctx.strokeStyle=lc; ctx.lineWidth=li===0?sz*0.04:sz*0.02;
                        ctx.beginPath(); ctx.moveTo(0,-len);ctx.lineTo(0,len); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(-len,0);ctx.lineTo(len,0); ctx.stroke();
                    });
                    ctx.restore();
                };
                const colors=[c1,c2,'rgba(255,255,255,0.9)'];
                const margin=maxSz;
                for(let k=0;k<density;k++){
                    let px,py;
                    if(zone==='border'){
                        const side=Math.floor(rng()*4);
                        if(side===0){px=rng()*W;py=rng()*margin*1.5;}
                        else if(side===1){px=rng()*W;py=H-rng()*margin*1.5;}
                        else if(side===2){px=rng()*margin*1.5;py=rng()*H;}
                        else{px=W-rng()*margin*1.5;py=rng()*H;}
                    } else if(zone==='corners'){
                        const corner=Math.floor(rng()*4);
                        const cr=W*0.25;
                        if(corner===0){px=rng()*cr;py=rng()*cr;}
                        else if(corner===1){px=W-rng()*cr;py=rng()*cr;}
                        else if(corner===2){px=rng()*cr;py=H-rng()*cr;}
                        else{px=W-rng()*cr;py=H-rng()*cr;}
                    } else {
                        px=margin+rng()*(W-margin*2);
                        py=margin+rng()*(H-margin*2);
                    }
                    const sz=maxSz*0.3+rng()*maxSz*0.7;
                    const col=colors[Math.floor(rng()*colors.length)];
                    ctx.globalAlpha=0.6+rng()*0.4;
                    drawSpark(px,py,sz,col,rng()*Math.PI*2);
                }
                ctx.globalAlpha=1;
                return cvs.toDataURL('image/png');
            },

            iemCancel: function() {
                this.closeAllModals();
            },

            iemReset: function() {
                const obj = this._iemObj;
                if (!obj) return;
                this.saveState();
                obj.src = this._iemOrigSrc;
                this._iemPreviewSrc = this._iemOrigSrc;
                this._iemFlipH = false;
                this._iemFlipV = false;
                obj.shadow = false;
                obj.scaleX = Math.abs(obj.scaleX || 1);
                obj.scaleY = Math.abs(obj.scaleY || 1);
                this.renderOverlays();
                this.renderSidebar();
                this.iemRenderPreview();
                this.showToast('↺ Imagen restablecida');
            },

            iemRenderPreviewWithFrame: function() {
                const cvs = document.getElementById('iem-preview-canvas');
                const img = new Image();
                img.onload = () => {
                    const maxW = 276, maxH = 246;
                    const scale = Math.min(maxW/img.width, maxH/img.height, 1);
                    const W = Math.round(img.width*scale);
                    const H = Math.round(img.height*scale);
                    cvs.width = W; cvs.height = H;
                    const ctx = cvs.getContext('2d');
                    ctx.clearRect(0,0,W,H);
                    const frame = this._iemFrame || 'none';
                    const bw = parseInt(document.getElementById('iem-frame-bw')?.value || 0);
                    const bc = document.getElementById('iem-frame-bc')?.value || '#ffffff';
                    // Clip path
                    ctx.save();
                    ctx.beginPath();
                    if (frame === 'circle' || frame === 'oval') {
                        const rx = frame==='oval' ? W/2 : Math.min(W,H)/2;
                        const ry = frame==='oval' ? H/2 : Math.min(W,H)/2;
                        ctx.ellipse(W/2, H/2, rx-bw, ry-bw, 0, 0, Math.PI*2);
                    } else if (frame.startsWith('round')) {
                        const rMap = {'round-sm':8,'round-md':20,'round-lg':40};
                        const r = rMap[frame]||0;
                        ctx.roundRect(bw,bw,W-bw*2,H-bw*2,r);
                    } else if (frame === 'diamond') {
                        ctx.moveTo(W/2,bw); ctx.lineTo(W-bw,H/2); ctx.lineTo(W/2,H-bw); ctx.lineTo(bw,H/2); ctx.closePath();
                    } else {
                        ctx.rect(0,0,W,H);
                    }
                    ctx.clip();
                    ctx.drawImage(img,0,0,W,H);
                    ctx.restore();
                    if (bw > 0 && frame !== 'none') {
                        ctx.strokeStyle = bc;
                        ctx.lineWidth = bw;
                        ctx.beginPath();
                        if (frame === 'circle' || frame === 'oval') {
                            const rx = frame==='oval'?W/2:Math.min(W,H)/2;
                            const ry = frame==='oval'?H/2:Math.min(W,H)/2;
                            ctx.ellipse(W/2,H/2,rx-bw/2,ry-bw/2,0,0,Math.PI*2);
                        } else { ctx.roundRect(bw/2,bw/2,W-bw,H-bw,frame.startsWith('round')?20:0); }
                        ctx.stroke();
                    }
                };
                img.src = this._iemOrigSrc;
            },

            iemApply: function() {
                const obj = this._iemObj;
                if (!obj) return;
                this.saveState();

                const activeTab = document.querySelector('.iem-tab.active')?.dataset.tab;

                if (activeTab === 'espejo') {
                    // Shadow
                    const shadowOn = document.getElementById('iem-shadow-on').checked;
                    obj.shadow = shadowOn;
                    obj.shadowColor = document.getElementById('iem-sc').value;
                    obj.shadowOpacity = parseFloat(document.getElementById('iem-so').value);
                    obj.shadowBlur = parseFloat(document.getElementById('iem-sb').value);
                    obj.shadowX = parseFloat(document.getElementById('iem-sx').value);
                    obj.shadowY = parseFloat(document.getElementById('iem-sy').value);
                    // Flip
                    const absX = Math.abs(obj.scaleX||1), absY = Math.abs(obj.scaleY||1);
                    obj.scaleX = this._iemFlipH ? -absX : absX;
                    obj.scaleY = this._iemFlipV ? -absY : absY;
                    this.renderOverlays(); this.renderSidebar();
                    this.closeAllModals(); this.showToast('✅ Espejo/sombra aplicados');

                } else if (activeTab === 'marco') {
                    const frame = this._iemFrame;
                    const bw = parseInt(document.getElementById('iem-frame-bw').value);
                    const bc = document.getElementById('iem-frame-bc').value;
                    if (frame === 'none' && bw === 0) {
                        obj.clipShape = 'none';
                        this.renderOverlays(); this.renderSidebar();
                        this.closeAllModals(); this.showToast('✅ Marco eliminado');
                    } else {
                        this._iemComposeFrame(this._iemOrigSrc, frame, bc, bw, (newSrc) => {
                            obj.src = newSrc; obj.clipShape = 'none';
                            this.renderOverlays(); this.renderSidebar();
                            this.closeAllModals(); this.showToast('✅ Marco aplicado');
                        });
                    }

                } else if (activeTab === 'reflejo') {
                    this._iemLoadImg(this._iemOrigSrc, (img) => {
                        obj.src = this._iemComposeReflection(img);
                        this.renderOverlays(); this.renderSidebar();
                        this.closeAllModals(); this.showToast('✅ Reflejo aplicado');
                    });

                } else if (activeTab === 'chispas') {
                    this._iemLoadImg(this._iemOrigSrc, (img) => {
                        obj.src = this._iemComposeSparkles(img);
                        this.renderOverlays(); this.renderSidebar();
                        this.closeAllModals(); this.showToast('✅ Chispas aplicadas');
                    });

                } else if (activeTab === 'efectos') {
                    if (!this._iemActiveFx || this._iemPreviewSrc === this._iemOrigSrc) {
                        this.closeAllModals(); return;
                    }
                    obj.src = this._iemPreviewSrc;
                    this.renderOverlays(); this.renderSidebar();
                    this.closeAllModals(); this.showToast('✅ Efecto aplicado');

                } else if (activeTab === 'fondo') {
                    obj.src = this._iemMagicPreviewSrc;
                    this.renderOverlays(); this.renderSidebar();
                    this.closeAllModals(); this.showToast('✅ Fondo modificado');
                }
            },

            openImageEffectsModal_legacy: null, // alias removed

            cropImage: function (obj) {
                if (!obj || obj.type !== 'image') {
                    // Close context menu if open
                    const ctxMenu = document.getElementById('context-menu');
                    if (ctxMenu) ctxMenu.style.display = 'none';
                    return;
                }
                // Close context menu
                const ctxMenu = document.getElementById('context-menu');
                if (ctxMenu) ctxMenu.style.display = 'none';

                const existingModal = document.getElementById('crop-modal');
                if (existingModal) existingModal.remove();

                const modal = document.createElement('div');
                modal.id = 'crop-modal';
                modal.style.cssText = `
                    position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.82);
                    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
                `;

                const title = document.createElement('div');
                title.textContent = 'Recortar Imagen — Arrastra para seleccionar área';
                title.style.cssText = 'color:#fff;font-size:14px;font-family:Montserrat,sans-serif;font-weight:600;';
                modal.appendChild(title);

                const canvasWrap = document.createElement('div');
                canvasWrap.style.cssText = 'position:relative;display:inline-block;cursor:crosshair;';
                modal.appendChild(canvasWrap);

                const canvas = document.createElement('canvas');
                const MAX_W = Math.min(window.innerWidth - 80, 900);
                const MAX_H = window.innerHeight - 180;
                canvasWrap.appendChild(canvas);

                // Overlay canvas for crop rect
                const overlay = document.createElement('canvas');
                overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
                canvasWrap.appendChild(overlay);

                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:12px;';

                const btnApply = document.createElement('button');
                btnApply.textContent = '✂️ Aplicar Recorte';
                btnApply.style.cssText = 'padding:8px 20px;background:var(--accent,#4f8ef7);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:13px;font-weight:600;';

                const btnCancel = document.createElement('button');
                btnCancel.textContent = 'Cancelar';
                btnCancel.style.cssText = 'padding:8px 20px;background:#555;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:13px;';

                btnRow.appendChild(btnApply);
                btnRow.appendChild(btnCancel);
                modal.appendChild(btnRow);
                document.body.appendChild(modal);

                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(MAX_W / img.width, MAX_H / img.height, 1);
                    const dW = Math.round(img.width * scale);
                    const dH = Math.round(img.height * scale);
                    canvas.width = dW; canvas.height = dH;
                    overlay.width = dW; overlay.height = dH;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, dW, dH);

                    let startX, startY, endX, endY, dragging = false;
                    const oc = overlay.getContext('2d');

                    function drawOverlay() {
                        oc.clearRect(0, 0, dW, dH);
                        if (startX === undefined) return;
                        const rx = Math.min(startX, endX), ry = Math.min(startY, endY);
                        const rw = Math.abs(endX - startX), rh = Math.abs(endY - startY);
                        oc.fillStyle = 'rgba(0,0,0,0.45)';
                        oc.fillRect(0, 0, dW, dH);
                        oc.clearRect(rx, ry, rw, rh);
                        oc.strokeStyle = '#4f8ef7';
                        oc.lineWidth = 2;
                        oc.strokeRect(rx, ry, rw, rh);
                        // Grid thirds
                        oc.strokeStyle = 'rgba(255,255,255,0.4)';
                        oc.lineWidth = 1;
                        [1/3,2/3].forEach(t => {
                            oc.beginPath(); oc.moveTo(rx + rw*t, ry); oc.lineTo(rx + rw*t, ry+rh); oc.stroke();
                            oc.beginPath(); oc.moveTo(rx, ry + rh*t); oc.lineTo(rx+rw, ry + rh*t); oc.stroke();
                        });
                    }

                    canvasWrap.addEventListener('mousedown', e => {
                        const r = canvas.getBoundingClientRect();
                        startX = e.clientX - r.left; startY = e.clientY - r.top;
                        endX = startX; endY = startY; dragging = true;
                    });
                    canvasWrap.style.pointerEvents = 'auto';
                    window.addEventListener('mousemove', e => {
                        if (!dragging) return;
                        const r = canvas.getBoundingClientRect();
                        endX = Math.max(0, Math.min(dW, e.clientX - r.left));
                        endY = Math.max(0, Math.min(dH, e.clientY - r.top));
                        drawOverlay();
                    });
                    window.addEventListener('mouseup', () => { dragging = false; });

                    btnApply.onclick = () => {
                        if (startX === undefined || Math.abs(endX - startX) < 4 || Math.abs(endY - startY) < 4) {
                            alert('Selecciona un área de recorte arrastrando sobre la imagen.');
                            return;
                        }
                        const rx = Math.min(startX, endX) / scale;
                        const ry = Math.min(startY, endY) / scale;
                        const rw = Math.abs(endX - startX) / scale;
                        const rh = Math.abs(endY - startY) / scale;
                        const cropCanvas = document.createElement('canvas');
                        cropCanvas.width = Math.round(rw); cropCanvas.height = Math.round(rh);
                        cropCanvas.getContext('2d').drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);
                        this.saveState();
                        obj.src = cropCanvas.toDataURL('image/png');
                        // Preserve aspect ratio in document units
                        const aspectRatio = rh / rw;
                        obj.height = obj.width * aspectRatio;
                        this.renderOverlays();
                        this.renderSidebar();
                        modal.remove();
                    };

                    btnCancel.onclick = () => { document.removeEventListener('keydown', _cropEsc); modal.remove(); };
                    const _cropEsc = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', _cropEsc); modal.remove(); } };
                    document.addEventListener('keydown', _cropEsc);
                };
                img.src = obj.src;
            },

            flipObject: function (axis) {
                this.saveState();
                const doc = this.getDoc();
                const targets = doc.pages[doc.currentIndex].objects.filter(o => this.multiObjectSelection.has(o.id));
                targets.forEach(obj => {
                    if (axis === 'h') obj.scaleX = (obj.scaleX || 1) * -1;
                    if (axis === 'v') obj.scaleY = (obj.scaleY || 1) * -1;
                });
                this.renderOverlays(); this.renderSidebar();
            },

            updateShapeStyle: function () {
                const obj = this.selectedObj;
                if (obj && (obj.type === 'shape' || obj.type === 'connector')) {
                    this.saveState();
                    const fillOpacity = parseInt(document.getElementById('shapeFillOpacity')?.value ?? 100) / 100;
                    obj.fill         = document.getElementById('shapeFill')?.value || '#ff0000';
                    obj.fillOpacity  = fillOpacity;
                    obj.stroke       = document.getElementById('shapeStroke')?.value || '#000000';
                    obj.strokeWidth  = parseInt(document.getElementById('shapeStrokeWidth')?.value) || 2;
                    obj.strokeDash   = document.getElementById('shapeStrokeDash')?.value || 'none';
                    obj.noBorder     = document.getElementById('shapeNoBorder')?.checked || false;
                    obj.noFill       = document.getElementById('shapeNoFill')?.checked || false;
                    obj.cornerRadius = parseInt(document.getElementById('shapeCornerRadius')?.value) || 0;
                    // Shadow
                    obj.shadow        = document.getElementById('shapeShadow')?.checked || false;
                    obj.shadowColor   = document.getElementById('shapeShadowColor')?.value || '#000000';
                    obj.shadowOpacity = parseInt(document.getElementById('shapeShadowOpacity')?.value ?? 40) / 100;
                    const parseShadowVal = (id, fallback) => {
                        const raw = document.getElementById(id)?.value;
                        const v = parseInt(raw, 10);
                        return isNaN(v) ? fallback : v;
                    };
                    obj.shadowBlur    = parseShadowVal('shapeShadowBlur', 6);
                    obj.shadowX       = parseShadowVal('shapeShadowX', 3);
                    obj.shadowY       = parseShadowVal('shapeShadowY', 3);
                    this.renderOverlays();
                }
            },

            /** Adjust shadow parameter by delta */
            adjustShapeShadow: function (id, delta) {
                const el = document.getElementById(id);
                if (!el) return;
                const min = el.min !== '' ? parseInt(el.min, 10) : -30;
                const max = el.max !== '' ? parseInt(el.max, 10) : 50;
                let val = parseInt(el.value, 10);
                if (isNaN(val)) val = 0;
                val += delta;
                if (val < min) val = min;
                if (val > max) val = max;
                el.value = val;
                this.updateShapeStyle();
            },

            /** Sync shape controls to selected object values */
            syncShapeControls: function (obj) {
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
                const b = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
                s('shapeFill',         obj.fill         || '#ff0000');
                s('shapeFillOpacity',  Math.round((obj.fillOpacity ?? 1) * 100));
                s('shapeStroke',       obj.stroke        || '#000000');
                s('shapeStrokeWidth',  obj.strokeWidth   || 2);
                s('shapeStrokeDash',   obj.strokeDash    || 'none');
                s('shapeCornerRadius', obj.cornerRadius  || 0);
                b('shapeNoBorder', obj.noBorder || false);
                b('shapeNoFill',   obj.noFill   || false);
                // Shadow
                b('shapeShadow', obj.shadow || false);
                s('shapeShadowColor',   obj.shadowColor   || '#000000');
                s('shapeShadowOpacity', Math.round((obj.shadowOpacity ?? 0.4) * 100));
                s('shapeShadowBlur',    obj.shadowBlur    ?? 6);
                s('shapeShadowX',       obj.shadowX       ?? 3);
                s('shapeShadowY',       obj.shadowY       ?? 3);
            },

            /** Open shape properties modal */
            openShapeProperties: function (obj) {
                if (!obj) obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.selectedObj = obj;
                this.closeAllModals();

                const modal = document.getElementById('shape-properties-modal');
                if (!modal) return;
                modal.style.display = 'flex';
                this.syncShapePropertiesModal(obj);
            },

            /** Close shape properties modal */
            closeShapeProperties: function () {
                const modal = document.getElementById('shape-properties-modal');
                if (modal) modal.style.display = 'none';
            },

            /** Sync shape properties modal with object values */
            syncShapePropertiesModal: function (obj) {
                if (!obj) obj = this.selectedObj;
                if (!obj) return;
                const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
                const b = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
                const t = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

                // Shape Type buttons
                document.querySelectorAll('#modal-shape-type-grid .shape-prop-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-shape') === (obj.shapeType || 'rect'));
                });

                // Fill
                b('modalShapeNoFill', !!obj.noFill);
                const fillCol = obj.fill || '#ff0000';
                s('modalShapeFill', fillCol);
                s('modalShapeFillHex', fillCol);
                const fillOp = Math.round((obj.fillOpacity !== undefined ? obj.fillOpacity : 1) * 100);
                s('modalShapeFillOpacity', fillOp);
                t('modalShapeFillOpacityVal', fillOp + '%');

                // Border
                b('modalShapeNoBorder', !!obj.noBorder);
                const strokeCol = obj.stroke || '#000000';
                s('modalShapeStroke', strokeCol);
                s('modalShapeStrokeHex', strokeCol);
                s('modalShapeStrokeWidth', obj.strokeWidth !== undefined ? obj.strokeWidth : 2);
                s('modalShapeStrokeDash', obj.strokeDash || 'none');
                s('modalShapeCornerRadius', obj.cornerRadius || 0);

                const crRow = document.getElementById('modalShapeCornerRadiusRow');
                if (crRow) crRow.style.display = (obj.shapeType === 'rect' || obj.shapeType === 'round_rect') ? 'flex' : 'none';

                // Shadow
                b('modalShapeShadow', !!obj.shadow);
                s('modalShapeShadowColor', obj.shadowColor || '#000000');
                s('modalShapeShadowOpacity', Math.round((obj.shadowOpacity !== undefined ? obj.shadowOpacity : 0.4) * 100));
                s('modalShapeShadowBlur', obj.shadowBlur !== undefined ? obj.shadowBlur : 6);
                s('modalShapeShadowX', obj.shadowX !== undefined ? obj.shadowX : 3);
                s('modalShapeShadowY', obj.shadowY !== undefined ? obj.shadowY : 3);
            },

            /** Update shape style from modal live */
            updateShapeFromModal: function () {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();

                obj.noFill = document.getElementById('modalShapeNoFill')?.checked || false;
                obj.fill = document.getElementById('modalShapeFill')?.value || '#ff0000';
                const fillOpVal = parseInt(document.getElementById('modalShapeFillOpacity')?.value ?? 100);
                obj.fillOpacity = fillOpVal / 100;
                const fillOpText = document.getElementById('modalShapeFillOpacityVal');
                if (fillOpText) fillOpText.textContent = fillOpVal + '%';

                obj.noBorder = document.getElementById('modalShapeNoBorder')?.checked || false;
                obj.stroke = document.getElementById('modalShapeStroke')?.value || '#000000';
                obj.strokeWidth = parseInt(document.getElementById('modalShapeStrokeWidth')?.value) || 0;
                obj.strokeDash = document.getElementById('modalShapeStrokeDash')?.value || 'none';
                obj.cornerRadius = parseInt(document.getElementById('modalShapeCornerRadius')?.value) || 0;

                obj.shadow = document.getElementById('modalShapeShadow')?.checked || false;
                obj.shadowColor = document.getElementById('modalShapeShadowColor')?.value || '#000000';
                obj.shadowOpacity = parseInt(document.getElementById('modalShapeShadowOpacity')?.value ?? 40) / 100;
                obj.shadowBlur = parseInt(document.getElementById('modalShapeShadowBlur')?.value) || 6;
                obj.shadowX = parseInt(document.getElementById('modalShapeShadowX')?.value) || 3;
                obj.shadowY = parseInt(document.getElementById('modalShapeShadowY')?.value) || 3;

                this.renderOverlays();
                this.syncShapeControls(obj);
            },

            /** Set shape type directly */
            setShapeType: function (type) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.shapeType = type;
                if (type === 'arrow_line' || type === 'bracket') {
                    obj.noFill = true;
                }
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
                this.showToast('Forma: ' + type);
            },

            /** Set fill color */
            setShapeFillColor: function (color) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.fill = color;
                obj.noFill = false;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Set fill opacity */
            setShapeFillOpacity: function (opacity) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.fillOpacity = opacity;
                obj.noFill = false;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Toggle no fill */
            toggleShapeNoFill: function () {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.noFill = !obj.noFill;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Set stroke color */
            setShapeStrokeColor: function (color) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.stroke = color;
                obj.noBorder = false;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Set stroke width */
            setShapeStrokeWidth: function (width) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.strokeWidth = width;
                obj.noBorder = false;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Set stroke dash */
            setShapeStrokeDash: function (dash) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.strokeDash = dash;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Toggle no border */
            toggleShapeNoBorder: function () {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                obj.noBorder = !obj.noBorder;
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            /** Set shadow preset */
            setShapeShadowPreset: function (preset) {
                const obj = this.selectedObj;
                if (!obj || (obj.type !== 'shape' && obj.type !== 'connector')) return;
                this.saveState();
                if (preset === 'none') {
                    obj.shadow = false;
                } else if (preset === 'soft') {
                    obj.shadow = true;
                    obj.shadowColor = '#000000';
                    obj.shadowOpacity = 0.3;
                    obj.shadowBlur = 6;
                    obj.shadowX = 2;
                    obj.shadowY = 2;
                } else if (preset === 'medium') {
                    obj.shadow = true;
                    obj.shadowColor = '#000000';
                    obj.shadowOpacity = 0.5;
                    obj.shadowBlur = 10;
                    obj.shadowX = 4;
                    obj.shadowY = 4;
                } else if (preset === 'hard') {
                    obj.shadow = true;
                    obj.shadowColor = '#000000';
                    obj.shadowOpacity = 0.75;
                    obj.shadowBlur = 16;
                    obj.shadowX = 6;
                    obj.shadowY = 6;
                }
                this.renderOverlays();
                this.syncShapeControls(obj);
                this.syncShapePropertiesModal(obj);
                const menu = document.getElementById('context-menu');
                if (menu) menu.style.display = 'none';
            },

            // NOTE: addShape is defined earlier in this file (around line 5951) using getVisibleCenter()


            // ============================================================
            // SECTION 5: DRAWING TOOLS
            // ============================================================

            /**
             * Sets the active drawing tool
             * @param {string} t - 'none' | 'pen' | 'highlighter' | 'eraser'
             */
            setDrawTool: function (t) {
                if (t === 'none' && this.drawTool === 'none') return;
                this.drawTool = t;
                document.querySelectorAll('#toolbar-draw .tool-btn').forEach(b => b.classList.remove('active'));
                if (t === 'none') {
                    this.isDrawingMode = false; document.body.classList.remove('drawing-mode');
                    document.getElementById('btn-select-tool').classList.add('active');
                } else {
                    this.isDrawingMode = true; document.body.classList.add('drawing-mode');
                    document.getElementById(t === 'pen' ? 'btn-pen' : t === 'highlighter' ? 'btn-highlighter' : 'btn-eraser').classList.add('active');
                    if (this.isHandMode) this.toggleHandMode();
                }
            },

            updateDrawStyle: function (k, v) { if (k === 'color') this.drawSettings.color = v; else this.drawSettings.width = v; },

            startDrawing: function (e) {
                if (!this.isDrawingMode) return;
                this.isDrawing = true;
                const cvs = document.getElementById('drawing-layer');
                const r = cvs.getBoundingClientRect(); const scale = this.currentScale;
                const x = (e.clientX - r.left) / scale; const y = (e.clientY - r.top) / scale;
                this.currentPath = [{ x, y }];
                const ctx = cvs.getContext('2d'); ctx.beginPath(); ctx.moveTo(x * scale, y * scale);
            },

            draw: function (e) {
                if (!this.isDrawing) return;
                const cvs = document.getElementById('drawing-layer');
                const r = cvs.getBoundingClientRect(); const scale = this.currentScale;
                const x = (e.clientX - r.left) / scale; const y = (e.clientY - r.top) / scale;
                this.currentPath.push({ x, y }); this.redrawDrawings(true);
                const ctx = cvs.getContext('2d'); this.applyDrawSettings(ctx);
                ctx.beginPath();
                if (this.currentPath.length > 1) {
                    const p0 = this.currentPath[this.currentPath.length - 2];
                    const p1 = this.currentPath[this.currentPath.length - 1];
                    ctx.moveTo(p0.x * scale, p0.y * scale);
                    ctx.lineTo(p1.x * scale, p1.y * scale);
                    ctx.stroke();
                }
            },

            stopDrawing: function () {
                if (!this.isDrawing) return; this.isDrawing = false;
                const doc = this.getDoc(); let color = this.drawSettings.color;
                this.saveState();
                doc.pages[doc.currentIndex].objects.push({
                    type: 'drawing',
                    path: this.currentPath,
                    color: color,
                    width: this.drawSettings.width,
                    isEraser: this.drawTool === 'eraser',
                    isHighlighter: this.drawTool === 'highlighter'
                });
                this.redrawDrawings(); this.renderSidebar();
            },

            applyDrawSettings: function (ctx) {
                ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const scale = this.currentScale;
                if (this.drawTool === 'eraser') { ctx.lineWidth = 20 * scale; ctx.globalCompositeOperation = 'destination-out'; }
                else {
                    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = this.drawSettings.width * scale;
                    if (this.drawTool === 'highlighter') {
                        const rgb = hexToRgbVals(this.drawSettings.color);
                        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`;
                    } else { ctx.strokeStyle = this.drawSettings.color; }
                }
            },

            clearDrawings: function () {
                this.saveState();
                const doc = this.getDoc();
                doc.pages[doc.currentIndex].objects = doc.pages[doc.currentIndex].objects.filter(o => o.type !== 'drawing');
                this.redrawDrawings(); this.renderSidebar();
            },

            // Helper para generar patrón de ruido (Cached)
            generateNoisePattern: function (opacity = 0.1) {
                if (this._cachedNoiseUrl) return this._cachedNoiseUrl;
                const size = 64;
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                // Transparent background
                ctx.clearRect(0, 0, size, size);
                // Random pixels
                for (let i = 0; i < size * size * 0.4; i++) {
                    const x = Math.floor(Math.random() * size);
                    const y = Math.floor(Math.random() * size);
                    const val = Math.floor(Math.random() * 200); // Dark noise
                    ctx.fillStyle = `rgba(${val},${val},${val},${opacity})`;
                    ctx.fillRect(x, y, 1, 1);
                }
                this._cachedNoiseUrl = canvas.toDataURL();
                return this._cachedNoiseUrl;
            },

            editText: function (obj) {
                document.getElementById('context-menu').style.display = 'none'; // Close context menu
                if (!obj || obj.type !== 'text') return;
                this.selectedObj = obj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(obj.id);
                obj.isEditing = true;
                obj._styleGlobalNoticeShown = false;
                // Issue 2: preservar scroll — renderOverlays puede causar reflow y mover el viewport
                const _editPanelEls = this.getPanelElements && this.getPanelElements(this.splitView?.activePanel);
                const _editMv = _editPanelEls?.mainView;
                const _editSt = _editMv ? _editMv.scrollTop : 0;
                const _editSl = _editMv ? _editMv.scrollLeft : 0;
                this.renderOverlays();
                if (_editMv) { _editMv.scrollTop = _editSt; _editMv.scrollLeft = _editSl; }
                setTimeout(() => {
                    const newEl = document.getElementById(obj.id);
                    if (newEl) {
                        const newSpan = newEl.querySelector('.text-content');
                        if (newSpan) {
                            newSpan.focus({ preventScroll: true });
                            const range = document.createRange();
                            const sel = window.getSelection();
                            range.selectNodeContents(newSpan);
                            if (obj.isSimpleClick) {
                                range.collapse(false); // Collapse to end for simple click
                            }
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    }
                }, 50);
            },

            startDrag: function (e, el, obj) {
                // GUARD: Internal Resize Handles should NOT trigger drag
                if (e.target.classList.contains('internal-resize-handle')) {
                    console.log('startDrag: Skipped - Internal resize handle clicked');
                    return;
                }

                // Skip native drag if Interact.js is handling it
                if (this.interactEnabled && window.interact) {
                    console.log('startDrag: Skipped - Interact.js is handling drag');
                    return;
                }

                // Defensive fix: If editingObjId is set but the properties modal is not visible, clear it
                if (this.editingObjId) {
                    const propsModal = document.getElementById('properties-modal');
                    const modalOverlay = document.getElementById('modal-overlay');
                    const isModalVisible = propsModal && (propsModal.style.display === 'flex' || propsModal.style.display === 'block');
                    const isOverlayVisible = modalOverlay && (modalOverlay.style.display === 'flex' || modalOverlay.style.display === 'block');
                    if (!isModalVisible && !isOverlayVisible) {
                        console.log('startDrag: Clearing stale editingObjId:', this.editingObjId);
                        this.editingObjId = null;
                    } else {
                        return; // Modal is actually open, block drag
                    }
                }
                const startTime = Date.now();
                console.log('startDrag called', obj?.id, 'Time:', startTime);

                const panelId = this.splitView?.activePanel || 'primary';
                const elements = this.getPanelElements(panelId);
                const panelState = this.splitView?.[panelId];
                const scale = panelState?.scale || this.currentScale || 1.0;

                // Fallback to direct getElementById if elements is null
                const container = elements?.canvasContainer || document.getElementById('canvas-container');
                if (!container) {
                    console.error('startDrag: No canvas container found');
                    return;
                }

                const containerRect = container.getBoundingClientRect();
                let lastMouseX = (e.clientX - containerRect.left) / scale;
                let lastMouseY = (e.clientY - containerRect.top) / scale;
                const doc = this.getDoc();
                if (!doc || !doc.pages || !doc.pages[doc.currentIndex]) {
                    console.error('startDrag: No valid document');
                    return;
                }
                const objectsToMove = doc.pages[doc.currentIndex].objects.filter(o => this.multiObjectSelection.has(o.id));

                const move = (ev) => {
                    ev.preventDefault();
                    const currentMouseX = (ev.clientX - containerRect.left) / scale;
                    const currentMouseY = (ev.clientY - containerRect.top) / scale;
                    const dx = currentMouseX - lastMouseX;
                    const dy = currentMouseY - lastMouseY;

                    objectsToMove.forEach(o => {
                        o.x += dx; o.y += dy;

                        // FORCE LIVE LOOKUP - Avoid "Zombie" elements from cached 'el'
                        let domEl = null;

                        // Identify the correct overlay layer (handling split view)
                        // elements.overlayLayer is the one for the panel where drag started
                        if (elements.overlayLayer) {
                            for (let child of elements.overlayLayer.children) {
                                if (child.id === o.id) {
                                    domEl = child;
                                    break;
                                }
                            }
                        }

                        // Check secondary panel if not found (edge case: dragging across split?)
                        // For now, assume object stays in its panel context or we look in current active panel
                        if (!domEl) {
                            // Fallback: search globally if not found in active panel
                            // domEl = document.getElementById(o.id);
                        }

                        console.log(`DEBUG: Dragging ${o.id} | dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} | domElFound=${!!domEl} | Pos=${domEl?.style.position}`);

                        if (domEl) {
                            domEl.style.left = (o.x * scale) + 'px';
                            domEl.style.top = (o.y * scale) + 'px';
                        }
                    });
                    lastMouseX = currentMouseX;
                    lastMouseY = currentMouseY;
                };
                const up = (ev) => {
                    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
                    const duration = Date.now() - startTime;
                    console.log('startDrag completed. Duration:', duration, 'ms. Event:', ev.type);
                    this.saveState(); this.renderSidebar(); this.renderOverlays();
                };
                window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
            },

            startResize: function (e, el, obj, handleDir) {
                // Defensive fix: If editingObjId is set but the properties modal is not visible, clear it
                if (this.editingObjId) {
                    const propsModal = document.getElementById('properties-modal');
                    const modalOverlay = document.getElementById('modal-overlay');
                    const isModalVisible = propsModal && (propsModal.style.display === 'flex' || propsModal.style.display === 'block');
                    const isOverlayVisible = modalOverlay && (modalOverlay.style.display === 'flex' || modalOverlay.style.display === 'block');
                    if (!isModalVisible && !isOverlayVisible) {
                        this.editingObjId = null;
                    } else {
                        return;
                    }
                }
                const panelState = this.splitView[this.splitView.activePanel];
                const scale = panelState?.scale || this.currentScale;
                const startX = e.clientX; const startY = e.clientY;
                const startWidth  = obj.width;
                const startHeight = obj.height;
                const startObjX   = obj.x;
                const startObjY   = obj.y;
                const startFontSize = obj.size || 16;
                const startColWidths  = obj.type === 'table' ? [...obj.colWidths]  : [];
                const startRowHeights = obj.type === 'table' ? [...obj.rowHeights] : [];

                // Snapshot all grouped objects initial sizes for proportional resize
                const isGroupResize = this.multiObjectSelection && this.multiObjectSelection.size > 1 && this.multiObjectSelection.has(obj.id);
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const groupSnapshot = new Map();
                if (isGroupResize && page) {
                    this.multiObjectSelection.forEach(id => {
                        const o = page.objects.find(ob => ob.id === id);
                        if (o) groupSnapshot.set(id, { w: o.width, h: o.height, x: o.x, y: o.y, size: o.size || 16 });
                    });
                }

                // Direction flags from handle class (default: bottom-right)
                const dir = handleDir || 'rh-br';
                const fromLeft   = dir === 'rh-tl' || dir === 'rh-ml' || dir === 'rh-bl';
                const fromRight  = dir === 'rh-tr' || dir === 'rh-mr' || dir === 'rh-br';
                const fromTop    = dir === 'rh-tl' || dir === 'rh-tc' || dir === 'rh-tr';
                const fromBottom = dir === 'rh-bl' || dir === 'rh-bc' || dir === 'rh-br';
                const affectsW   = fromLeft || fromRight;
                const affectsH   = fromTop  || fromBottom;

                const move = (ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    const dx = (ev.clientX - startX) / scale;
                    const dy = (ev.clientY - startY) / scale;

                    let newW = startWidth;
                    let newH = startHeight;

                    if (affectsW) {
                        newW = fromLeft
                            ? Math.max(50, startWidth  - dx)
                            : Math.max(50, startWidth  + dx);
                        obj.width = newW;
                        if (fromLeft) obj.x = startObjX + (startWidth - newW);
                    }
                    if (affectsH) {
                        newH = fromTop
                            ? Math.max(20, startHeight - dy)
                            : Math.max(20, startHeight + dy);
                        obj.height = newH;
                        if (fromTop) obj.y = startObjY + (startHeight - newH);
                    }

                    el.style.width  = (obj.width  * scale) + 'px';
                    el.style.height = (obj.height * scale) + 'px';
                    el.style.left   = (obj.x * scale) + 'px';
                    el.style.top    = (obj.y * scale) + 'px';

                    if (obj.type === 'text') {
                        const ratio = obj.height / startHeight;
                        const currentFontSize = startFontSize * ratio;
                        const textSpan = el.querySelector('.text-content');
                        if (textSpan) textSpan.style.fontSize = (currentFontSize * scale) + 'px';
                    } else if (obj.type === 'table') {
                        const wRatio = newW / startWidth;
                        const hRatio = newH / startHeight;

                        obj.colWidths  = startColWidths.map(w => w * wRatio);
                        obj.rowHeights = startRowHeights.map(h => h * hRatio);

                        const table = el.querySelector('table');
                        if (table) {
                            if (table.rows.length > 0) {
                                for (let i = 0; i < table.rows[0].cells.length; i++) {
                                    if (obj.colWidths[i]) table.rows[0].cells[i].style.width = (obj.colWidths[i] * scale) + 'px';
                                }
                            }
                            for (let i = 0; i < table.rows.length; i++) {
                                if (obj.rowHeights[i]) table.rows[i].style.height = (obj.rowHeights[i] * scale) + 'px';
                            }
                        }
                    }

                    // Propagate resize to all grouped objects
                    if (isGroupResize && page) {
                        const wRatio = affectsW ? newW / startWidth : 1;
                        const hRatio = affectsH ? newH / startHeight : 1;
                        this.multiObjectSelection.forEach(id => {
                            if (id === obj.id) return;
                            const snap = groupSnapshot.get(id);
                            const peer = page.objects.find(ob => ob.id === id);
                            if (!snap || !peer) return;
                            if (affectsW) { peer.width = Math.max(10, snap.w * wRatio); if (fromLeft) peer.x = snap.x + (snap.w - peer.width); }
                            if (affectsH) { peer.height = Math.max(8, snap.h * hRatio); if (fromTop) peer.y = snap.y + (snap.h - peer.height); }
                            if (peer.type === 'text') peer.size = snap.size * hRatio;
                            const peerEl = document.getElementById(id);
                            if (peerEl) {
                                peerEl.style.width  = (peer.width  * scale) + 'px';
                                peerEl.style.height = (peer.height * scale) + 'px';
                                peerEl.style.left   = (peer.x * scale) + 'px';
                                peerEl.style.top    = (peer.y * scale) + 'px';
                            }
                        });
                    }
                };
                const up = (ev) => {
                    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
                    if (obj.type === 'text') {
                        const ratio = obj.height / startHeight;
                        obj.size = startFontSize * ratio;
                        document.getElementById('textSize').value = Math.round(obj.size);
                    }
                    this.saveState(); this.renderSidebar(); this.renderOverlays();
                };
                window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
            },

            startRotate: function (e, el, obj) {
                if (this.editingObjId) return;
                e.preventDefault(); e.stopPropagation();
                // Usar el centro del CSS layout box (coincide con transform-origin: center center)
                const parent = el.offsetParent || el.parentElement;
                const parentRect = parent.getBoundingClientRect();
                const cx = parentRect.left + parseFloat(el.style.left) + parseFloat(el.style.width) / 2;
                const cy = parentRect.top + parseFloat(el.style.top) + parseFloat(el.style.height) / 2;
                el.style.transformOrigin = 'center center';
                // Offset inicial para evitar salto en el primer mousemove
                const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
                const startRot = obj.rotation || 0;
                const move = (ev) => {
                    ev.preventDefault();
                    const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
                    const rot = startRot + (angle - startAngle);
                    el.style.transform = `rotate(${rot}deg)`; obj.rotation = rot;
                };
                const up = () => {
                    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
                    this.saveState(); this.renderSidebar(); this.renderOverlays();
                };
                window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
            },

            // ============================================================
            // SECTION 6: HISTORY (Undo/Redo)
            // ============================================================

            /**
             * Saves the current state to history for undo/redo
             * Maintains a maximum of 50 history states
             */
            saveState: function (docId = this.activeDocId) {
                const doc = this.getDocumentById ? this.getDocumentById(docId) : this.getDoc(); if (!doc) return;
                if (doc.historyIndex < doc.history.length - 1) {
                    doc.history = doc.history.slice(0, doc.historyIndex + 1);
                    // Clean orphaned buffer snapshots beyond new top
                    if (doc._historyBuffers) {
                        Object.keys(doc._historyBuffers).forEach(k => {
                            if (parseInt(k) > doc.historyIndex) delete doc._historyBuffers[k];
                        });
                    }
                }
                // Excluir propiedades de caché del historial (no son parte del estado del documento)
                const _cacheKeys = ['_thumbCache', '_thumbCacheObjects', '_bgBitmap', '_bgBitmapScale', '_bgBitmapW', '_bgBitmapH'];
                const replacer = (key, val) => _cacheKeys.includes(key) ? undefined : val;
                doc.history.push(JSON.stringify(doc.pages, replacer));
                doc.historyIndex++;
                if (doc.history.length > 50) {
                    doc.history.shift();
                    doc.historyIndex--;
                    if (doc._historyBuffers) {
                        // Shift buffer keys by -1
                        const newBufs = {};
                        Object.keys(doc._historyBuffers).forEach(k => {
                            const newK = parseInt(k) - 1;
                            if (newK >= 0) newBufs[newK] = doc._historyBuffers[k];
                        });
                        doc._historyBuffers = newBufs;
                    }
                }
                this.trimDocumentHistory(doc);
                if (this.markDocumentChanged) this.markDocumentChanged(doc.id, 'history');
                this.updateUndoRedoUI();
            },

            trimDocumentHistory: function (doc) {
                const historyBytes = () => {
                    const seen = new Set();
                    let bytes = doc.history.reduce((sum, value) => sum + value.length * 2, 0);
                    for (const snapshot of Object.values(doc._historyBuffers || {})) {
                        for (const buffer of [snapshot.beforeBuffer, snapshot.afterBuffer, snapshot.buffer]) {
                            if (buffer && !seen.has(buffer)) { seen.add(buffer); bytes += buffer.byteLength || 0; }
                        }
                    }
                    return bytes;
                };
                while (historyBytes() > 64 * 1024 * 1024 && doc.history.length > 2) {
                    doc.history.shift();
                    doc.historyIndex = Math.max(0, doc.historyIndex - 1);
                    const shifted = {};
                    for (const [index, snapshot] of Object.entries(doc._historyBuffers || {})) {
                        if (Number(index) > 0) shifted[Number(index) - 1] = snapshot;
                    }
                    doc._historyBuffers = shifted;
                }
            },

            /**
             * Debounced version of saveState for high-frequency operations (like dragging)
             */
            saveStateDebounced: function (delay = 500) {
                const docId = this.activeDocId;
                const doc = this.getDocumentById ? this.getDocumentById(docId) : this.getDoc();
                if (!doc) return;
                if (!this._saveStateTimers) this._saveStateTimers = new Map();
                const previous = this._saveStateTimers.get(docId);
                if (previous) clearTimeout(previous);
                const epoch = doc.documentState?.lifecycleEpoch;
                const timer = setTimeout(() => {
                    this._saveStateTimers.delete(docId);
                    const current = this.getDocumentById ? this.getDocumentById(docId) : null;
                    if (!current || (epoch !== undefined && current.documentState?.lifecycleEpoch !== epoch)) return;
                    this.saveState(docId);
                }, delay);
                this._saveStateTimers.set(docId, timer);
            },

            undo: function () {
                const doc = this.getDoc();
                if (!doc || doc.historyIndex <= 0) return;
                // Si el estado actual modificó bytes del PDF, restaurar el extremo anterior.
                const curIdx = doc.historyIndex;
                if (doc._historyBuffers && doc._historyBuffers[curIdx]) {
                    const snapshot = doc._historyBuffers[curIdx];
                    const previousBuffer = snapshot.beforeBuffer || snapshot.buffer;
                    if (previousBuffer && doc.sources[snapshot.sourceId]) {
                        doc.sources[snapshot.sourceId].buffer = previousBuffer.slice(0);
                        doc.sources[snapshot.sourceId].doc = null;
                    }
                }
                doc.historyIndex--;
                const state = JSON.parse(doc.history[doc.historyIndex]);
                this.releaseDocumentThumbnails?.(doc);
                doc.pages = state;
                // Invalidar cachés de miniaturas y bitmaps de fondo
                if (Array.isArray(doc.pages)) {
                    doc.pages.forEach(p => {
                        delete p._thumbCache;
                        delete p._thumbCacheObjects;
                        delete p._bgBitmap;
                    });
                }
                // Invalidar tokens de render continuo para forzar redibujado real del buffer restaurado
                this._continuousSessionToken = Symbol();
                document.querySelectorAll('.bg-page-canvas').forEach(cvs => {
                    cvs._renderedSessionToken = null;
                    cvs._pendingSessionToken = null;
                    if (cvs._activeRenderTask) {
                        try { cvs._activeRenderTask.cancel(); } catch (e) {}
                        cvs._activeRenderTask = null;
                    }
                });
                this.multiSelection.clear();
                this.multiObjectSelection.clear();
                this.selectedObj = null;
                this.loadPage(doc.currentIndex);
                this.renderSidebar();
                this.updateUndoRedoUI();
                if (this.markDocumentChanged) this.markDocumentChanged(doc.id, 'history');
                this.showToast("Deshacer");
            },

            redo: function () {
                const doc = this.getDoc();
                if (!doc || doc.historyIndex >= doc.history.length - 1) return;
                doc.historyIndex++;
                // Los snapshots transaccionales conservan el PDF posterior para rehacer.
                const snapshot = doc._historyBuffers && doc._historyBuffers[doc.historyIndex];
                if (snapshot && snapshot.afterBuffer && doc.sources[snapshot.sourceId]) {
                    doc.sources[snapshot.sourceId].buffer = snapshot.afterBuffer.slice(0);
                    doc.sources[snapshot.sourceId].doc = null;
                }
                const state = JSON.parse(doc.history[doc.historyIndex]);
                this.releaseDocumentThumbnails?.(doc);
                doc.pages = state;
                // Invalidar cachés de miniaturas y bitmaps de fondo
                if (Array.isArray(doc.pages)) {
                    doc.pages.forEach(p => {
                        delete p._thumbCache;
                        delete p._thumbCacheObjects;
                        delete p._bgBitmap;
                    });
                }
                // Invalidar tokens de render continuo para forzar redibujado real del buffer restaurado
                this._continuousSessionToken = Symbol();
                document.querySelectorAll('.bg-page-canvas').forEach(cvs => {
                    cvs._renderedSessionToken = null;
                    cvs._pendingSessionToken = null;
                    if (cvs._activeRenderTask) {
                        try { cvs._activeRenderTask.cancel(); } catch (e) {}
                        cvs._activeRenderTask = null;
                    }
                });
                this.multiSelection.clear();
                this.multiObjectSelection.clear();
                this.selectedObj = null;
                this.loadPage(doc.currentIndex);
                this.renderSidebar();
                this.updateUndoRedoUI();
                if (this.markDocumentChanged) this.markDocumentChanged(doc.id, 'history');
                this.showToast("Rehacer");
            },

            updateUndoRedoUI: function () {
                const doc = this.getDoc();
                const btnUndo = document.getElementById('btn-undo');
                const btnRedo = document.getElementById('btn-redo');
                if (!doc) {
                    if (btnUndo) btnUndo.disabled = true;
                    if (btnRedo) btnRedo.disabled = true;
                    return;
                }
                if (btnUndo) btnUndo.disabled = doc.historyIndex <= 0;
                if (btnRedo) btnRedo.disabled = doc.historyIndex >= doc.history.length - 1;
            },

            takeSnapshot: function () {
                const cvs = document.getElementById('the-canvas');
                if (!cvs) return;
                const drawing = document.getElementById('drawing-layer');
                const temp = document.createElement('canvas');
                temp.width = cvs.width; temp.height = cvs.height;
                const ctx = temp.getContext('2d');
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, temp.width, temp.height);
                ctx.drawImage(cvs, 0, 0);
                ctx.drawImage(drawing, 0, 0);
                temp.toBlob(function (blob) { saveAs(blob, "captura_pagina.png"); });
                this.showToast("Captura descargada");
            },

            // Aliases usados por los botones del modo lectura
            capturePageAsImage: function () { this.startCaptureSelection(); },
            applyGrayscale:     function () { this.convertToGrayscalePDF(); },
            applyInvert:        function () { this.invertColorsPDF(); },

            startBlurRegion: function () {
                const doc = this.getDoc();
                if (!doc) { this.showToast("Abre un documento primero"); return; }

                // Show intensity picker
                const existing = document.getElementById('blur-intensity-popup');
                if (existing) existing.remove();

                const popup = document.createElement('div');
                popup.id = 'blur-intensity-popup';
                popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                    z-index:99999;background:var(--bg-panel);border:1px solid var(--border);
                    border-radius:12px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,0.4);
                    min-width:280px;font-size:13px;color:var(--text-main);`;
                popup.innerHTML = `
                    <div style="font-weight:700;margin-bottom:14px;font-size:14px;">🌫️ Blur de Región</div>
                    <div style="margin-bottom:10px;">
                        <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                            <span>Intensidad</span>
                            <span id="blur-val-label" style="font-weight:700;min-width:28px;text-align:right;">8</span>
                        </label>
                        <input type="range" id="blur-intensity-range" min="2" max="30" value="8" step="1"
                            style="width:100%;margin-top:6px;"
                            oninput="document.getElementById('blur-val-label').textContent=this.value">
                    </div>
                    <div style="margin-bottom:14px;">
                        <label style="display:flex;align-items:center;gap:8px;font-size:12px;">
                            <input type="checkbox" id="blur-pixelate" style="width:14px;height:14px;">
                            Efecto Pixelado (censura)
                        </label>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button onclick="document.getElementById('blur-intensity-popup').remove()"
                            style="padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--bg-tools);cursor:pointer;color:var(--text-main);">Cancelar</button>
                        <button id="blur-apply-btn"
                            style="padding:6px 14px;border:none;border-radius:6px;background:var(--accent,#6366f1);color:white;cursor:pointer;font-weight:600;">Seleccionar Área</button>
                    </div>`;
                document.body.appendChild(popup);

                document.getElementById('blur-apply-btn').onclick = () => {
                    const intensity = parseInt(document.getElementById('blur-intensity-range').value);
                    const pixelate  = document.getElementById('blur-pixelate').checked;
                    popup.remove();
                    this._doBlurRegion(intensity, pixelate);
                };
            },

            _doBlurRegion: function (intensity, pixelate) {
                const self = this;
                this.showToast("🌫️ Selecciona el área a difuminar");

                this.startCaptureSelection(async (rect) => {
                    try {
                        const scale = self.currentScale || 1;
                        const cvs   = document.getElementById('the-canvas');
                        if (!cvs) return;

                        // 1. Crop the canvas region
                        const temp = document.createElement('canvas');
                        temp.width  = rect.w;
                        temp.height = rect.h;
                        const ctx = temp.getContext('2d');
                        ctx.drawImage(cvs, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

                        // 2. Apply blur or pixelate
                        if (pixelate) {
                            // Pixelate: downscale then upscale (no smoothing)
                            const px = Math.max(4, intensity * 1.5) | 0;
                            const small = document.createElement('canvas');
                            small.width  = Math.max(1, (rect.w / px) | 0);
                            small.height = Math.max(1, (rect.h / px) | 0);
                            const sCtx = small.getContext('2d');
                            sCtx.drawImage(temp, 0, 0, small.width, small.height);
                            ctx.imageSmoothingEnabled = false;
                            ctx.drawImage(small, 0, 0, rect.w, rect.h);
                        } else {
                            // Gaussian blur: multi-pass box blur for quality
                            const passes = 3;
                            const radius = Math.round(intensity * 0.6);
                            for (let p = 0; p < passes; p++) {
                                ctx.filter = `blur(${radius}px)`;
                                ctx.drawImage(temp, 0, 0);
                                ctx.filter = 'none';
                                const id = ctx.getImageData(0, 0, temp.width, temp.height);
                                ctx.putImageData(id, 0, 0);
                            }
                        }

                        const dataUrl = temp.toDataURL('image/png');

                        // 3. Insert as image object at exact page coordinates
                        const doc  = self.getDoc();
                        const page = doc.pages[doc.currentIndex];
                        self.saveState();

                        // Convert overlay coordinates to page-space (divide by scale)
                        const newObj = {
                            id: 'blur_' + Date.now(),
                            type: 'image',
                            src: dataUrl,
                            x: rect.x / scale,
                            y: rect.y / scale,
                            width:  rect.w / scale,
                            height: rect.h / scale,
                            opacity: 1,
                            scaleX: 1, scaleY: 1,
                            filters: {},
                            _blurRegion: true
                        };
                        page.objects.push(newObj);
                        self.selectedObj = newObj;
                        self.multiObjectSelection.clear();
                        self.multiObjectSelection.add(newObj.id);
                        self.renderOverlays();
                        self.renderSidebar();
                        self.showToast("✅ Blur aplicado — ajusta posición si es necesario");
                    } catch (err) {
                        console.error(err);
                        self.showToast("❌ Error al aplicar blur: " + err.message);
                    }
                });
            },

            startCaptureSelection: function (callback = null) {
                const self = this;
                this._captureActionMenu?._escapeController?.abort();
                this._captureActionMenu?.remove();
                this._captureActionMenu = null;
                const overlay = document.getElementById('capture-overlay');
                const box = document.getElementById('selection-box');
                const container = document.getElementById('canvas-container');

                if (!container || container.style.display === 'none') {
                    self.showToast("Abre un documento primero");
                    return;
                }

                overlay.style.display = 'block';
                box.style.display = 'none';
                let startX, startY, isSelecting = false;
                let selectionRect = { x: 0, y: 0, w: 0, h: 0 };

                const mouseDown = (e) => {
                    isSelecting = true;
                    const r = overlay.getBoundingClientRect();
                    startX = e.clientX - r.left;
                    startY = e.clientY - r.top;
                    box.style.left = startX + 'px';
                    box.style.top = startY + 'px';
                    box.style.width = '0px';
                    box.style.height = '0px';
                    box.style.display = 'block';
                };

                const mouseMove = (e) => {
                    if (!isSelecting) return;
                    const r = overlay.getBoundingClientRect();
                    const currX = e.clientX - r.left;
                    const currY = e.clientY - r.top;
                    const width = currX - startX;
                    const height = currY - startY;

                    // Guardar coordenadas en la variable
                    selectionRect.x = width < 0 ? currX : startX;
                    selectionRect.y = height < 0 ? currY : startY;
                    selectionRect.w = Math.abs(width);
                    selectionRect.h = Math.abs(height);

                    box.style.left = selectionRect.x + 'px';
                    box.style.top = selectionRect.y + 'px';
                    box.style.width = selectionRect.w + 'px';
                    box.style.height = selectionRect.h + 'px';
                };

                const mouseUp = async (e) => {
                    isSelecting = false;

                    // Obtener dimensiones ANTES de ocultar
                    const finalW = selectionRect.w;
                    const finalH = selectionRect.h;
                    const finalX = selectionRect.x;
                    const finalY = selectionRect.y;

                    // Ocultar overlay
                    overlay.style.display = 'none';
                    box.style.display = 'none';

                    // Limpiar eventos
                    overlay.removeEventListener('mousedown', mouseDown);
                    window.removeEventListener('mousemove', mouseMove);
                    window.removeEventListener('mouseup', mouseUp);

                    if (finalW < 5 || finalH < 5) {
                        self.showToast("Área muy pequeña");
                        return;
                    }

                    if (callback && typeof callback === 'function') {
                        callback({ x: finalX, y: finalY, w: finalW, h: finalH });
                        return;
                    }

                    try {
                        const cvs = document.getElementById('the-canvas');
                        const drawing = document.getElementById('drawing-layer');
                        const temp = document.createElement('canvas');
                        temp.width = Math.round(finalW);
                        temp.height = Math.round(finalH);
                        const ctx = temp.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, finalW, finalH);
                        ctx.drawImage(cvs, -finalX, -finalY);
                        ctx.drawImage(drawing, -finalX, -finalY);
                        self.showCaptureActionMenu(temp, e.clientX, e.clientY);
                    } catch (err) {
                        console.error("Error en captura:", err);
                        self.showToast("Error: " + err.message);
                    }
                };

                overlay.addEventListener('mousedown', mouseDown);
                window.addEventListener('mousemove', mouseMove);
                window.addEventListener('mouseup', mouseUp);
                this.showToast(callback ? "Selecciona el área de la tabla" : "Selecciona área para captura");
            },

            showCaptureActionMenu: function (canvas, x, y) {
                this._captureActionMenu?._escapeController?.abort();
                this._captureActionMenu?.remove();
                const menu = document.createElement('div');
                menu.className = 'capture-action-menu';
                menu.innerHTML = `<div class="capture-action-head"><strong data-i18n="capture_title">Captura</strong><button type="button" data-action="close" data-i18n-aria="btn_close" aria-label="Cerrar">×</button></div>
                    <div class="capture-action-row"><label><span data-i18n="capture_search_engine">Buscador</span><select data-field="provider"><option value="google">Google Lens</option><option value="bing">Bing Visual Search</option><option value="tineye">TinEye</option></select></label><button type="button" data-action="search" data-i18n="capture_search_similar">Buscar similares</button></div>
                    <div class="capture-action-row"><label><span data-i18n="capture_translate_to">Traducir a</span><select data-field="language"><option value="Español" data-i18n="capture_target_es">Español</option><option value="Inglés" data-i18n="capture_target_en">Inglés</option><option value="Francés" data-i18n="capture_target_fr">Francés</option><option value="Alemán" data-i18n="capture_target_de">Alemán</option><option value="Italiano" data-i18n="capture_target_it">Italiano</option><option value="Portugués" data-i18n="capture_target_pt">Portugués</option></select></label><button type="button" data-action="translate" data-i18n="capture_translate_text">Traducir texto</button></div>
                    <div class="capture-action-buttons"><button type="button" data-action="explain" data-i18n="capture_explain_image">Explicar imagen</button><button type="button" data-action="copy" data-i18n="capture_copy">Copiar captura</button></div>
                    <div class="capture-action-result" role="log" aria-live="polite" hidden></div>
                    <form class="capture-action-followup" hidden><input type="text" data-i18n-placeholder="capture_question" data-i18n-aria="capture_question" placeholder="Pregunta sobre la imagen…" aria-label="Pregunta sobre la imagen" maxlength="1000" required><button type="button" data-action="cancel-edit" data-i18n="btn_cancel" hidden>Cancelar</button><button type="submit" data-i18n="capture_ask">Preguntar</button></form>`;
                document.body.appendChild(menu);
                this._captureActionMenu = menu;
                const escapeController = new AbortController();
                menu._escapeController = escapeController;
                const captureText = (key, fallback) => window.i18n?.t(key, fallback) || fallback;
                const translateCapture = (root = menu) => {
                    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = captureText(el.dataset.i18n, el.textContent); });
                    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = captureText(el.dataset.i18nPlaceholder, el.placeholder); });
                    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', captureText(el.dataset.i18nAria, el.getAttribute('aria-label'))); });
                };
                translateCapture();
                window.addEventListener('app:languagechange', () => translateCapture(), { signal: escapeController.signal });
                const close = () => {
                    escapeController.abort();
                    menu.remove();
                    if (this._captureActionMenu === menu) this._captureActionMenu = null;
                };
                document.addEventListener('keydown', event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    close();
                }, { capture: true, signal: escapeController.signal });
                const provider = menu.querySelector('[data-field="provider"]');
                const saved = localStorage.getItem('alioth_capture_search_provider');
                if (['google', 'bing', 'tineye'].includes(saved)) provider.value = saved;
                provider.onchange = () => localStorage.setItem('alioth_capture_search_provider', provider.value);
                const result = menu.querySelector('.capture-action-result');
                const followup = menu.querySelector('.capture-action-followup');
                const questionInput = followup.querySelector('input');
                const submitQuestion = followup.querySelector('[type="submit"]');
                const cancelEdit = followup.querySelector('[data-action="cancel-edit"]');
                const visionButtons = [...menu.querySelectorAll('[data-action="explain"], [data-action="translate"]')];
                const imageData = canvas.toDataURL('image/png').split(',')[1];
                const conversation = [];
                const turns = [];
                let editingIndex = -1;
                let busy = false;
                const place = () => {
                    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
                    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
                };
                const addMessage = (role, value) => {
                    const message = document.createElement('div');
                    message.className = 'capture-action-message ' + role;
                    if (role === 'user') {
                        const body = document.createElement('div');
                        body.textContent = value;
                        const actions = document.createElement('div');
                        actions.className = 'capture-action-message-actions';
                        actions.innerHTML = '<button type="button" data-action="edit-message" data-i18n="capture_edit">Editar</button><button type="button" data-action="resend-message" data-i18n="capture_resend">Reenviar</button>';
                        translateCapture(actions);
                        message.append(body, actions);
                    } else {
                        message.textContent = value;
                    }
                    result.appendChild(message);
                    result.scrollTop = result.scrollHeight;
                    requestAnimationFrame(place);
                    return message;
                };
                const resetEditor = () => {
                    editingIndex = -1;
                    questionInput.value = '';
                    submitQuestion.dataset.i18n = 'capture_ask';
                    submitQuestion.textContent = captureText('capture_ask', 'Preguntar');
                    cancelEdit.hidden = true;
                    requestAnimationFrame(place);
                };
                const cleanAnswer = raw => {
                    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                    const asText = value => {
                        if (typeof value === 'string') return value;
                        if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('\n');
                        if (value && typeof value === 'object') {
                            const preferred = value.text || value.answer || value.explanation || value.description;
                            return preferred ? asText(preferred) : Object.values(value).map(asText).filter(Boolean).join('\n');
                        }
                        return '';
                    };
                    try {
                        return asText(JSON.parse(text)) || captureText('capture_no_response', 'No se obtuvo respuesta.');
                    } catch (_) {}
                    return text || captureText('capture_no_response', 'No se obtuvo respuesta.');
                };
                const runVision = async (action, question = '', replaceIndex = -1) => {
                    if (busy) return;
                    busy = true;
                    visionButtons.forEach(button => button.disabled = true);
                    questionInput.disabled = true;
                    submitQuestion.disabled = true;
                    if (action !== 'ask') {
                        conversation.length = 0;
                        turns.length = 0;
                        result.replaceChildren();
                        followup.hidden = true;
                        resetEditor();
                    } else {
                        if (replaceIndex >= 0 && turns[replaceIndex]) {
                            conversation.length = turns[replaceIndex].contextLength;
                            turns.splice(replaceIndex).forEach(turn => { turn.user.remove(); turn.answer.remove(); });
                        }
                        const user = addMessage('user', question);
                        user.dataset.turnIndex = turns.length;
                        resetEditor();
                        turns.push({ question, user, contextLength: conversation.length, answer: null });
                    }
                    result.hidden = false;
                    const waitingKey = action === 'translate' ? 'capture_translating' : 'capture_analyzing';
                    const waiting = addMessage('assistant', captureText(waitingKey, action === 'translate' ? 'Traduciendo texto…' : 'Analizando imagen…'));
                    waiting.dataset.i18n = waitingKey;
                    if (action === 'ask') turns[turns.length - 1].answer = waiting;
                    try {
                        const language = menu.querySelector('[data-field="language"]').value;
                        const prompt = action === 'translate'
                            ? `Transcribe el texto visible en esta imagen y tradúcelo al ${language}. Conserva el orden. Si no hay texto legible, indícalo. Responde con texto normal, sin JSON.`
                            : action === 'explain'
                                ? 'Explica en español lo que muestra esta imagen de forma clara y breve. Responde con texto normal, sin JSON.'
                                : `Responde en español a la pregunta sobre esta misma imagen. Usa el contexto de la conversación y responde con texto normal, sin JSON.\nConversación:\n${conversation.slice(-8).map(item => `${item.role}: ${item.text}`).join('\n')}\nUsuario: ${question}`;
                        const answer = cleanAnswer(await this._callVisionWithFallback(imageData, prompt, true));
                        delete waiting.dataset.i18n;
                        waiting.textContent = answer;
                        if (action !== 'translate') {
                            if (action === 'ask') conversation.push({ role: 'Usuario', text: question });
                            conversation.push({ role: 'Asistente', text: answer });
                            followup.hidden = false;
                        }
                    } catch (error) {
                        console.error('Capture vision failed:', error);
                        waiting.dataset.i18n = 'capture_error';
                        waiting.textContent = captureText('capture_error', 'No se pudo analizar la captura. Revisa tu proveedor de IA.');
                        if (action === 'ask') followup.hidden = false;
                    } finally {
                        busy = false;
                        visionButtons.forEach(button => button.disabled = false);
                        questionInput.disabled = false;
                        submitQuestion.disabled = false;
                        result.scrollTop = result.scrollHeight;
                        requestAnimationFrame(place);
                    }
                };
                followup.addEventListener('submit', event => {
                    event.preventDefault();
                    const question = questionInput.value.trim();
                    if (question) runVision('ask', question, editingIndex);
                });
                menu.addEventListener('click', async event => {
                    const action = event.target.closest('[data-action]')?.dataset.action;
                    if (!action) return;
                    if (action === 'close') { close(); return; }
                    if (action === 'cancel-edit') { resetEditor(); return; }
                    if (action === 'edit-message' || action === 'resend-message') {
                        if (busy) return;
                        const index = Number(event.target.closest('.capture-action-message.user')?.dataset.turnIndex);
                        const turn = turns[index];
                        if (!turn) return;
                        if (action === 'resend-message') { runVision('ask', turn.question, index); return; }
                        editingIndex = index;
                        questionInput.value = turn.question;
                        submitQuestion.dataset.i18n = 'capture_save_send';
                        submitQuestion.textContent = captureText('capture_save_send', 'Guardar y enviar');
                        cancelEdit.hidden = false;
                        questionInput.focus();
                        questionInput.select();
                        requestAnimationFrame(place);
                        return;
                    }
                    if (action === 'copy' || action === 'search') {
                        const urls = { google: 'https://lens.google.com/', bing: 'https://www.bing.com/visualsearch', tineye: 'https://tineye.com/' };
                        const copyPromise = this.copyCaptureImage(canvas);
                        if (action === 'search') window.open(urls[provider.value], '_blank', 'noopener,noreferrer');
                        const copied = await copyPromise;
                        this.showToast(action === 'copy'
                            ? (copied ? 'Captura copiada' : 'Captura guardada')
                            : (copied ? 'Captura copiada. Pégala en el buscador con Ctrl+V.' : 'Captura guardada. Súbela en el buscador.'));
                        return;
                    }
                    if (action === 'explain' || action === 'translate') runVision(action);
                });
                requestAnimationFrame(place);
            },

            copyCaptureImage: async function (canvas) {
                try {
                    const blob = new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No image')), 'image/png'));
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    return true;
                } catch (_) {
                    const link = document.createElement('a');
                    link.href = canvas.toDataURL('image/png');
                    link.download = 'captura_' + Date.now() + '.png';
                    link.click();
                    return false;
                }
            },

            // ============================================================
            // SECTION 6B: LINK/HYPERLINK MANAGEMENT
            // ============================================================

            /**
             * Shows the link insertion modal
             * @param {object} existingLink - Optional existing link object to edit
             */
            showLinkModal: function (existingLink = null, targetObject = null) {
                const doc = this.getDoc();
                if (!doc || doc.pages.length === 0) {
                    this.showToast("Abre un documento primero");
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
                document.getElementById('link-modal').style.display = 'block';
                document.querySelectorAll('.glass-box').forEach(m => {
                    if (m.id !== 'link-modal') m.style.display = 'none';
                });

                const target = targetObject && targetObject.type !== 'link' ? targetObject : null;
                this._linkTargetObjectId = target ? target.id : null;
                const title = document.querySelector('#link-modal h3');
                const textRow = document.getElementById('link-text-row');
                const styleControls = document.getElementById('link-style-controls');
                if (title) title.textContent = target ? 'Vincular objeto' : 'Insertar Vínculo';
                if (textRow) textRow.style.display = target ? 'none' : 'flex';
                if (styleControls) styleControls.style.display = target ? 'none' : 'flex';

                // Reset or populate fields
                if (existingLink) {
                    app.editingLinkId = existingLink.id;
                    document.getElementById('link-type').value = existingLink.linkType || 'web';
                    document.getElementById('link-text').value = existingLink.text || '';
                    document.getElementById('link-dest').value = existingLink.url || '';
                    document.getElementById('link-font').value = existingLink.font || 'Helvetica';
                    document.getElementById('link-size').value = existingLink.size || 14;
                    document.getElementById('link-color').value = existingLink.color || '#0066cc';
                    document.getElementById('link-bold').checked = existingLink.bold || false;
                    document.getElementById('link-italic').checked = existingLink.italic || false;

                    // ✅ NUEVO: Poblar campos de vínculo interno si aplica
                    if (existingLink.linkType === 'internal') {
                        document.getElementById('link-page-num').value = existingLink.internalPage || 1;
                        document.getElementById('link-search-text').value = existingLink.searchText || '';
                        document.getElementById('link-highlight-text').checked = existingLink.highlightText || false;
                    }
                } else if (target && target.actionLink) {
                    const action = target.actionLink;
                    document.getElementById('link-type').value = action.type || 'web';
                    document.getElementById('link-text').value = '';
                    document.getElementById('link-dest').value = action.url || '';
                    document.getElementById('link-page-num').value = action.internalPage || doc.currentIndex + 1;
                    document.getElementById('link-search-text').value = action.searchText || '';
                    document.getElementById('link-highlight-text').checked = !!action.highlightText;
                } else {
                    app.editingLinkId = null;
                    document.getElementById('link-type').value = 'internal'; // ✅ Por defecto: interno
                    document.getElementById('link-text').value = '';
                    document.getElementById('link-dest').value = '';
                    document.getElementById('link-font').value = 'Helvetica';
                    document.getElementById('link-size').value = 14;
                    document.getElementById('link-color').value = '#0066cc';
                    document.getElementById('link-bold').checked = false;
                    document.getElementById('link-italic').checked = false;

                    // ✅ NUEVO: Valores por defecto para vínculo interno
                    document.getElementById('link-page-num').value = doc.currentIndex + 1;
                    document.getElementById('link-search-text').value = '';
                    document.getElementById('link-highlight-text').checked = true;
                }
                this.updateLinkTypeUI();
            },

            showObjectLinkModal: function (obj = this.selectedObj) {
                if (!obj || obj.type === 'link') return;
                this.showLinkModal(null, obj);
            },

            /**
             * Updates the link modal UI based on selected link type
             */
            updateLinkTypeUI: function () {
                const type = document.getElementById('link-type').value;
                const label = document.getElementById('link-dest-label');
                const input = document.getElementById('link-dest');
                const internalFields = document.getElementById('internal-link-fields');
                const destRow = input.parentElement;

                switch (type) {
                    case 'internal':
                        // Ocultar campo de destino y mostrar campos internos
                        destRow.style.display = 'none';
                        internalFields.style.display = 'block';

                        // Prellenar número de página actual
                        const doc = this.getDoc();
                        if (doc) {
                            document.getElementById('link-page-num').value = doc.currentIndex + 1;
                        }
                        break;
                    case 'web':
                        destRow.style.display = 'flex';
                        internalFields.style.display = 'none';
                        label.innerText = 'URL:';
                        input.placeholder = 'https://ejemplo.com';
                        break;
                    case 'email':
                        destRow.style.display = 'flex';
                        internalFields.style.display = 'none';
                        label.innerText = 'Email:';
                        input.placeholder = 'contacto@ejemplo.com';
                        break;
                    case 'phone':
                        destRow.style.display = 'flex';
                        internalFields.style.display = 'none';
                        label.innerText = 'Teléfono:';
                        input.placeholder = '+52 123 456 7890';
                        break;
                    case 'whatsapp':
                        destRow.style.display = 'flex';
                        internalFields.style.display = 'none';
                        label.innerText = 'WhatsApp:';
                        input.placeholder = '+521234567890 (sin espacios)';
                        break;
                }
            },

            /**
             * Inserts a new link or updates an existing one
             */
            insertLink: function () {
                const type = document.getElementById('link-type').value;
                const text = document.getElementById('link-text').value.trim();
                const destRaw = document.getElementById('link-dest').value.trim();
                const font = document.getElementById('link-font').value;
                const size = parseInt(document.getElementById('link-size').value) || 14;
                const color = document.getElementById('link-color').value;
                const bold = document.getElementById('link-bold').checked;
                const italic = document.getElementById('link-italic').checked;

                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                const target = this._linkTargetObjectId && page
                    ? page.objects.find(o => o.id === this._linkTargetObjectId)
                    : null;

                if (!target && !text) {
                    this.showToast("Ingresa el texto del enlace");
                    return;
                }

                // Variables para vínculos internos
                let internalPageNum = null;
                let searchText = null;
                let highlightText = false;

                // Build final URL based on type
                let finalUrl = destRaw;

                if (type === 'internal') {
                    // Validar campos de vínculo interno
                    internalPageNum = parseInt(document.getElementById('link-page-num').value);
                    searchText = document.getElementById('link-search-text').value.trim();
                    highlightText = document.getElementById('link-highlight-text').checked;

                    if (!internalPageNum || internalPageNum < 1 || internalPageNum > doc.pages.length) {
                        this.showToast("Número de página inválido (1-" + doc.pages.length + ")");
                        return;
                    }

                    // Para vínculos internos, usamos una URL especial
                    finalUrl = '#page=' + internalPageNum;
                } else {
                    // Validar destino para vínculos externos
                    if (!destRaw) {
                        this.showToast("Ingresa el destino del enlace");
                        return;
                    }

                    switch (type) {
                        case 'web':
                            if (!destRaw.startsWith('http://') && !destRaw.startsWith('https://')) {
                                finalUrl = 'https://' + destRaw;
                            }
                            break;
                        case 'email':
                            if (!destRaw.startsWith('mailto:')) {
                                finalUrl = 'mailto:' + destRaw;
                            }
                            break;
                        case 'phone':
                            const cleanPhone = destRaw.replace(/[^\d+]/g, '');
                            if (!destRaw.startsWith('tel:')) {
                                finalUrl = 'tel:' + cleanPhone;
                            }
                            break;
                        case 'whatsapp':
                            const cleanWA = destRaw.replace(/[^\d]/g, '');
                            finalUrl = 'https://wa.me/' + cleanWA;
                            break;
                    }
                }

                this.saveState();

                if (target) {
                    target.actionLink = {
                        type,
                        url: finalUrl,
                        ...(type === 'internal' ? { internalPage: internalPageNum, searchText, highlightText } : {})
                    };
                    this._linkTargetObjectId = null;
                    this.closeAllModals();
                    this.renderOverlays();
                    this.renderSidebar();
                    this.showToast('🔗 Vínculo aplicado al objeto');
                    return;
                }

                if (this.editingLinkId) {
                    // Update existing link
                    const page = doc.pages[doc.currentIndex];
                    const link = page.objects.find(o => o.id === this.editingLinkId);
                    if (link) {
                        link.text = text;
                        link.url = finalUrl;
                        link.linkType = type;
                        link.font = font;
                        link.size = size;
                        link.color = color;
                        link.bold = bold;
                        link.italic = italic;

                        // Propiedades de vínculo interno
                        if (type === 'internal') {
                            link.internalPage = internalPageNum;
                            link.searchText = searchText;
                            link.highlightText = highlightText;
                        } else {
                            delete link.internalPage;
                            delete link.searchText;
                            delete link.highlightText;
                        }
                    }
                    this.editingLinkId = null;
                } else {
                    // Create new link object
                    const center = this.getVisibleCenter();
                    const linkObj = {
                        id: 'link' + Date.now() + Math.random().toString().substr(2, 5),
                        type: 'link',
                        linkType: type,
                        x: center.x - (text.length * size * 0.3),
                        y: center.y - ((size + 10) / 2),
                        width: text.length * size * 0.6,
                        height: size + 10,
                        text: text,
                        url: finalUrl,
                        font: font,
                        size: size,
                        color: color,
                        bold: bold,
                        italic: italic,
                        rotation: 0,
                        scaleX: 1,
                        scaleY: 1
                    };

                    // Agregar propiedades de vínculo interno
                    if (type === 'internal') {
                        linkObj.internalPage = internalPageNum;
                        linkObj.searchText = searchText;
                        linkObj.highlightText = highlightText;
                    }

                    doc.pages[doc.currentIndex].objects.push(linkObj);
                    this.selectedObj = linkObj;
                    this.multiObjectSelection.clear();
                    this.multiObjectSelection.add(linkObj.id);
                }

                this.closeAllModals();
                this.renderOverlays();
                this.renderSidebar();
                this.showToast("🔗 Vínculo " + (this.editingLinkId ? "actualizado" : "insertado"));
            },

            removeObjectLink: function (obj = this.selectedObj) {
                if (!obj || !obj.actionLink) return;
                this.saveState();
                delete obj.actionLink;
                this.hideContextMenu?.();
                this.renderOverlays();
                this.showToast('Vínculo eliminado del objeto');
            },

            /**
             * Opens the edit modal for an existing link
             * @param {object} linkObj - The link object to edit
             */
            editLink: function (linkObj) {
                if (!linkObj || linkObj.type !== 'link') return;
                this.showLinkModal(linkObj);
            },

            /**
             * ✅ NUEVO: Navegar a vínculo interno con opción de highlight
             * @param {object} linkObj - El objeto de vínculo interno
             */
            navigateToInternalLink: async function (linkObj) {
                if (!linkObj || !linkObj.internalPage) return;

                const doc = this.getDoc();
                if (!doc) return;

                const targetPage = linkObj.internalPage - 1; // Convertir a índice 0-based

                // Validar que la página existe
                if (targetPage < 0 || targetPage >= doc.pages.length) {
                    this.showToast('⚠️ Página no encontrada: ' + linkObj.internalPage);
                    return;
                }

                // Navegar a la página
                await this.loadPage(targetPage);

                // Si hay texto para buscar y resaltar
                if (linkObj.searchText && linkObj.highlightText) {
                    await this.highlightTextInPage(linkObj.searchText, targetPage);
                }

                this.showToast('📄 Navegado a página ' + linkObj.internalPage);
            },

            /**
             * ✅ NUEVO: Resaltar texto en la página actual
             * @param {string} searchText - Texto a buscar y resaltar
             * @param {number} pageIndex - Índice de la página
             */
            highlightTextInPage: async function (searchText, pageIndex) {
                if (!searchText) return;

                const doc = this.getDoc();
                if (!doc || pageIndex < 0 || pageIndex >= doc.pages.length) return;

                const page = doc.pages[pageIndex];
                const src = doc.sources[page.sourceId];

                // Solo funciona con páginas PDF (no generadas)
                if (!src || !src.buffer) {
                    this.showToast('⚠️ El resaltado solo funciona en páginas PDF');
                    return;
                }

                try {
                    // ── 🆕 MEJORA 4: Buscar con PyMuPDF para coordenadas exactas de glifos ──
                    // El método anterior reconstruía el texto concatenando items de PDF.js,
                    // perdiendo precisión con spans partidos y ligaduras.
                    let minX = null, topY = null, maxX = null, height = null;
                    let usedPython = false;

                    if (PythonManager.isLoaded) {
                        try {
                            // searchInDocument busca en todo el doc — filtrar solo la página objetivo
                            const hits = await PythonManager.searchInDocument(src.buffer, searchText, false);
                            if (hits && hits.length > 0) {
                                // Buscar hit en la página correcta (pageIdx relativo al source)
                                const pageHit = hits.find(h => h.pageIdx === page.pageIndex);
                                if (pageHit) {
                                    // PyMuPDF: coordenadas Y-down desde arriba — igual que PDF.js viewport
                                    minX = pageHit.x0;
                                    topY = pageHit.y0;
                                    maxX = pageHit.x1;
                                    height = pageHit.y1 - pageHit.y0;
                                    usedPython = true;
                                    console.log(`🐍 PyMuPDF Highlight: "${searchText}" en (${minX.toFixed(1)}, ${topY.toFixed(1)}) página ${page.pageIndex}`);
                                }
                            }
                        } catch (pyErr) {
                            console.warn("🐍 PyMuPDF highlight search failed, trying JS fallback:", pyErr);
                        }
                    }

                    // ── Fallback JS: PDF.js getTextContent ───────────────────────────────────
                    if (!usedPython) {
                        if (!src.doc) {
                            src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                        }
                        const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                        const textContent = await pdfPage.getTextContent();
                        const viewport = pdfPage.getViewport({ scale: 1.0 });
                        const searchLower = searchText.toLowerCase();
                        let fullText = '';
                        let charPositions = [];
                        textContent.items.forEach((item) => {
                            const startPos = fullText.length;
                            fullText += item.str;
                            for (let i = 0; i < item.str.length; i++) {
                                charPositions.push({ char: item.str[i], item });
                            }
                        });
                        const matchIndex = fullText.toLowerCase().indexOf(searchLower);
                        if (matchIndex !== -1) {
                            const matchEndIndex = matchIndex + searchText.length - 1;
                            const startCharPos = charPositions[matchIndex];
                            const endCharPos = charPositions[matchEndIndex];
                            if (startCharPos && endCharPos) {
                                const startItem = startCharPos.item;
                                const endItem = endCharPos.item;
                                minX = Math.min(startItem.transform[4], endItem.transform[4]);
                                maxX = Math.max(startItem.transform[4] + startItem.width, endItem.transform[4] + endItem.width);
                                const pdfY = startItem.transform[5];
                                topY = viewport.height - pdfY;
                                height = Math.abs(startItem.transform[3]);
                            }
                        }
                    }

                    // ── Aplicar highlight si se encontró posición ─────────────────────────────
                    if (minX !== null && topY !== null) {
                        const highlightId = 'temp-highlight-' + Date.now();
                        const highlightObj = {
                            id: highlightId,
                            type: 'drawing',
                            path: [
                                { x: minX, y: topY },
                                { x: maxX, y: topY }
                            ],
                            color: '#ffff00',
                            width: height,
                            isHighlighter: true,
                            isTemporary: true
                        };
                        page.objects.push(highlightObj);
                        this.redrawDrawings();
                        setTimeout(() => {
                            const idx = page.objects.findIndex(o => o.id === highlightId);
                            if (idx !== -1) { page.objects.splice(idx, 1); this.redrawDrawings(); }
                        }, 3000);
                        this.showToast('✨ Texto resaltado: "' + searchText + '"');
                    } else {
                        this.showToast('⚠️ Texto no encontrado: "' + searchText + '"');
                    }

                } catch (error) {
                    console.error('Error al resaltar texto:', error);
                    this.showToast('⚠️ Error al resaltar texto');
                }
            },

            // ============================================================
            // SECTION 6C: EMOJI/ICON INSERTION
            // ============================================================

            /**
             * Shows the emoji/icon insertion modal
             */
});

// -- Rastrear la ltima seleccin de texto activa para herramientas --
document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node && (node.nodeType === 3 ? node.parentNode : node).closest('.text-content')) {
            window._lastTextEditorRange = sel.getRangeAt(0).cloneRange();
            window._lastTextEditorSpan = (node.nodeType === 3 ? node.parentNode : node).closest('.text-content');
            
            // Si la selección se colapsa (es solo cursor), quitamos el flag de hadPartialSelection
            if (sel.isCollapsed) {
                window._hadPartialSelection = false;
            }
        }
    }
});
