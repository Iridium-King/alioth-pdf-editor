// app.annotations.js
// Extiende el objeto global `app` con métodos de annotations
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            dropdownPresets: {
                months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
                days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
                positions: ["Arriba", "Abajo", "Izquierda", "Derecha", "Centro"],
                yesno: ["Sí", "No"],
                years: ["2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029", "2030"],
                numbers1to10: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                numbers1to31: Array.from({ length: 31 }, (_, i) => (i + 1).toString()),
                civilstatus: ["Soltero/a", "Casado/a", "Divorciado/a", "Viudo/a", "Unión Libre"],
                gender: ["Masculino", "Femenino", "Otro", "Prefiero no decir"],
                grades: ["A", "B", "C", "D", "F", "NA"],
                bloodtypes: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
                cities: ["Ciudad de México", "Nueva York", "Londres", "París", "Tokio", "Los Ángeles", "Madrid", "Barcelona", "Buenos Aires", "Bogotá", "Lima", "Sao Paulo", "Santiago", "Roma", "Berlín", "Toronto", "Sydney", "Dubái", "Singapur", "Hong Kong"],
                mx_states: ["Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"],
                countries: ["México", "Estados Unidos", "Canadá", "España", "Argentina", "Colombia", "Brasil", "Chile", "Perú", "Venezuela", "Ecuador", "Guatemala", "Cuba", "República Dominicana", "Francia", "Alemania", "Italia", "Reino Unido", "China", "Japón", "India", "Rusia", "Australia"],
                continents: ["África", "América", "Antártida", "Asia", "Europa", "Oceanía"],
                education: ["PRIMARIA", "SECUNDARIA", "PREPARATORIA", "TECNICA", "LICENCIATURA", "ESPECIALIDAD", "MAESTRIA", "DOCTORADO"],
                jobs: [
                    "ABASTECEDOR", "ALMACENISTA", "ANALISTA ADMINISTRATIVO", "ANALISTA DE ALMACEN", "ANALISTA DE LOGISTICA", "ANALISTA DE NOMINAS",
                    "ANALISTA DE OPERACIONES", "ANALISTA DE RH", "AUXILIAR DE ALMACEN", "AUXILIAR DE HOTELERIA", "AUXILIAR DE LIMPIEZA",
                    "AUXILIAR DE MANTENIMIENTO", "AUXILIAR DE OPERACIONES", "AUXILIAR DE RH", "AYUDANTE DE COCINA", "AYUDANTE DE ALMACEN",
                    "CAJERA", "CHEF", "CHEF INSTRUCTOR", "CHOFER", "COCINERO", "COMPRADOR", "CONTADOR",
                    "COORDINADOR DE COMPRAS Y CUENTAS POR PAGAR", "COORDINADOR HSE", "CUSTODIO", "ELECTROMECANICO", "FOOD PLANNER", "FUMIGADOR",
                    "GERENTE DE ALMACEN", "GERENTE DE COMPRAS", "GERENTE DE OPERACIONES", "GERENTE DE RH", "GERENTE DE UNIDAD",
                    "GERENTE NACIONAL DE CALIDAD Y SEGURIDAD ALIMENTARIA", "GERENTE REGIONAL", "HVAC", "JEFE DE ALMACEN",
                    "JEFE DE CALIDAD Y SEGURIDAD ALIMENTARIA", "JEFE DE HSEQ", "JEFE DE MANTENIMIENTO", "LIDER DE ALIMENTACION", "MESERO",
                    "NUTRIOLOGO", "PANADERO", "RECAMARERO", "RECLUTADOR", "REPOSTERO", "SUBGERENTE DE UNIDAD", "SUBGERENTE HSE",
                    "SUPERVISOR HSE", "TECNICO DE MUESTREO", "TECNICO EN MANTENIMIENTO", "TORTILLERO", "MEDICO", "ENFERMERA",
                    "INGENIERO CIVIL", "INGENIERO INDUSTRIAL", "INGENIERO PETROLERO", "INGENIERO QUIMICO", "INGENIERO MECANICO",
                    "INGENIERO BIOMEDICO", "QUIMICO FARMACOBIOLOGO", "AYUDANTE GENERAL", "SOLDADOR", "TUBERO", "CARPINTERO",
                    "ANAQUELERO", "ADMINISTRADOR"
                ],
                world_cities: ["New York", "London", "Paris", "Tokyo", "Dubai", "Singapore", "Barcelona", "Los Angeles", "Rome", "Madrid", "Berlin", "Hong Kong", "Toronto", "Sydney", "Amsterdam"]
            },

            openProperties: function (obj) {
                if (!obj) return;
                this.selectedObj = obj;
                this.closeAllModals(); // Close others first
                // Sync paste props button
                setTimeout(() => {
                    const pasteBtn = document.getElementById('btn-paste-props');
                    if (pasteBtn) { pasteBtn.disabled = !this._propClipboard; pasteBtn.style.opacity = this._propClipboard ? '1' : '0.5'; }
                }, 50);

                if (obj.isPageNum) {
                    this.showPageNumModal(obj);
                    return;
                }

                this.editingObjId = obj.id;
                const modal = document.getElementById('properties-modal');
                if (!modal) {
                    console.error("Properties modal not found!");
                    return;
                }
                modal.style.display = 'flex';

                // Common fields
                const nameInput = document.getElementById('prop-field-name');
                const reqCheck = document.getElementById('prop-required');
                const readCheck = document.getElementById('prop-readonly');

                if (nameInput) nameInput.value = obj.fieldName || '';
                if (reqCheck) reqCheck.checked = !!obj.required;
                if (readCheck) readCheck.checked = !!obj.readOnly;
                const tabIdxInput = document.getElementById('prop-tab-index');
                if (tabIdxInput) tabIdxInput.value = obj.tabIndex || 1;

                const sectionText = document.getElementById('prop-section-text');
                const sectionDropdown = document.getElementById('prop-section-dropdown');
                const sectionCheckbox = document.getElementById('prop-section-checkbox');
                const sectionCalendar = document.getElementById('prop-section-calendar');
                const sectionRadio = document.getElementById('prop-section-radio');
                const sectionSignature = document.getElementById('prop-section-signature');

                if (sectionText) sectionText.style.display = 'none';
                if (sectionDropdown) sectionDropdown.style.display = 'none';
                if (sectionCheckbox) sectionCheckbox.style.display = 'none';
                if (sectionRadio) sectionRadio.style.display = 'none';
                if (sectionSignature) sectionSignature.style.display = 'none';
                if (sectionCalendar) sectionCalendar.style.display = 'none';

                if (obj.type === 'form-field') {
                    if (obj.fieldType === 'text') {
                        if (sectionText) {
                            sectionText.style.display = 'block';
                            document.getElementById('prop-field-text').value = obj.textValue || obj.value || '';
                            document.getElementById('prop-text-font').value = obj.font || 'Helvetica';
                            document.getElementById('prop-text-size').value = obj.fontSize || 12;
                            document.getElementById('prop-text-align').value = obj.textAlign || 'left';
                            document.getElementById('prop-text-auto-size').checked = !!obj.autoSize;
                            document.getElementById('prop-text-multiline').checked = !!obj.multiline;
                            document.getElementById('prop-text-columns').checked = !!obj.twoColumns;
                            document.getElementById('prop-text-bold').checked = !!obj.bold;
                            document.getElementById('prop-text-italic').checked = !!obj.italic;
                        }
                    } else if (obj.fieldType === 'dropdown' || obj.fieldType === 'Ch') {
                        if (sectionDropdown) {
                            sectionDropdown.style.display = 'block';
                            document.getElementById('prop-dropdown-options').value = (obj.options || []).join('\n');
                            document.getElementById('prop-dropdown-font').value = obj.font || 'Arial';
                            document.getElementById('prop-dropdown-size').value = obj.fontSize || 12;
                            // Color de fuente: usar el selector compartido (prop-font-color), no el duplicado
                            const _fcEl = document.getElementById('prop-font-color');
                            if (_fcEl) _fcEl.value = obj.textColor || obj.fontColor || '#000000';
                            document.getElementById('prop-dropdown-bold').checked = !!obj.bold;
                            document.getElementById('prop-dropdown-italic').checked = !!obj.italic;
                            const _ddAs = document.getElementById('prop-dropdown-auto-size');
                            if (_ddAs) _ddAs.checked = !!obj.autoSize;
                        }
                    } else if (obj.fieldType === 'checkbox' || obj.fieldType === 'Btn') {
                        if (sectionCheckbox) {
                            sectionCheckbox.style.display = 'block';
                            document.getElementById('prop-field-checked').checked = !!obj.checked;
                            const ckColorEl = document.getElementById('prop-check-color');
                            if (ckColorEl) ckColorEl.value = obj.checkColor || '#333333';
                            // Populate group dropdown
                            const cbGroupSel = document.getElementById('prop-checkbox-group');
                            app._populateGroupDropdown(cbGroupSel, 'checkbox', obj.groupName || '');
                            // Set value explicitly after populating
                            if (cbGroupSel && obj.groupName) cbGroupSel.value = obj.groupName;
                            const cbBehavior = document.getElementById('prop-checkbox-group-behavior');
                            if (cbBehavior) cbBehavior.style.display = (cbGroupSel && cbGroupSel.value) ? 'block' : 'none';
                            const cbRuleSel = document.getElementById('prop-checkbox-group-rule');
                            if (cbRuleSel) {
                                cbRuleSel.value = obj.groupRule || 'none';
                            }
                            if (cbGroupSel) cbGroupSel.onchange = () => {
                                if (cbBehavior) cbBehavior.style.display = cbGroupSel.value ? 'block' : 'none';
                            };
                        }
                    } else if (obj.fieldType === 'radio') {
                        if (sectionRadio) {
                            sectionRadio.style.display = 'block';
                            document.getElementById('prop-radio-selected').checked = !!obj.selected;
                            const dotColorEl = document.getElementById('prop-dot-color');
                            if (dotColorEl) dotColorEl.value = obj.dotColor || '#333333';
                            // Populate group dropdown
                            const rgGroupSel = document.getElementById('prop-radio-group');
                            app._populateGroupDropdown(rgGroupSel, 'radio', obj.groupName || '');
                        }
                    } else if (obj.fieldType === 'signature') {
                        if (sectionSignature) {
                            sectionSignature.style.display = 'block';
                            document.getElementById('prop-sign-user').value = obj.signerId || '';
                            const signMode = obj.signMode || 'field';
                            const modeEl = document.getElementById('prop-sign-mode');
                            if (modeEl) modeEl.value = signMode;
                            app._onSignModeChange(signMode);
                            // Restore image preview if exists
                            if (signMode === 'image' && obj.signImageData) {
                                const thumb = document.getElementById('prop-sign-img-thumb');
                                const placeholder = document.getElementById('prop-sign-img-placeholder');
                                if (thumb) { thumb.src = obj.signImageData; thumb.style.display = 'block'; }
                                if (placeholder) placeholder.style.display = 'none';
                            }
                            const opacityEl = document.getElementById('prop-sign-opacity');
                            const opacityVal = document.getElementById('prop-sign-opacity-val');
                            if (opacityEl) { opacityEl.value = obj.signOpacity || 100; }
                            if (opacityVal) opacityVal.textContent = (obj.signOpacity || 100) + '%';
                            const removeBgEl = document.getElementById('prop-sign-remove-bg');
                            if (removeBgEl) removeBgEl.checked = !!obj.signRemoveBg;
                        }
                    } else if (obj.fieldType === 'calendar') {
                        if (sectionCalendar) {
                            sectionCalendar.style.display = 'block';
                            if (!obj.calendarState) obj.calendarState = {
                                selectedDays: [], month: new Date().getMonth(), year: new Date().getFullYear(),
                                style: 'circle', format: 'MM/YYYY', align: 'center',
                                headerColor: '#f0f0f0', selectColor: '#ff0000', bgColor: '#ffffff',
                                headerTextColor: '#000000', weekdayTextColor: '#333333', dayTextColor: '#000000',
                                headerFontSize: 12, weekdayFontSize: 10, dayFontSize: 10,
                                font: 'Arial', headerBold: false, headerItalic: false,
                                weekdayBold: true, weekdayItalic: false, dayBold: false, dayItalic: false
                            };
                            const cs = obj.calendarState;
                            document.getElementById('prop-cal-month').value = cs.month;
                            document.getElementById('prop-cal-year').value = cs.year;
                            document.getElementById('prop-cal-style').value = cs.style || 'circle';
                            document.getElementById('prop-cal-format').value = cs.format || 'MM/YYYY';
                            document.getElementById('prop-cal-align').value = cs.align || 'center';
                            document.getElementById('prop-cal-header-color').value = cs.headerColor || '#f0f0f0';
                            document.getElementById('prop-cal-select-color').value = cs.selectColor || '#ff0000';
                            document.getElementById('prop-cal-bg-color').value = cs.bgColor || '#ffffff';

                            document.getElementById('prop-cal-header-text-color').value = cs.headerTextColor || '#000000';
                            document.getElementById('prop-cal-header-font-size').value = cs.headerFontSize || 12;
                            document.getElementById('prop-cal-weekday-text-color').value = cs.weekdayTextColor || '#333333';
                            document.getElementById('prop-cal-weekday-font-size').value = cs.weekdayFontSize || 10;
                            document.getElementById('prop-cal-day-text-color').value = cs.dayTextColor || '#000000';
                            document.getElementById('prop-cal-day-font-size').value = cs.dayFontSize || 10;
                            document.getElementById('prop-cal-font').value = cs.font || 'Arial';

                            document.getElementById('prop-cal-header-bold').checked = !!cs.headerBold;
                            document.getElementById('prop-cal-header-italic').checked = !!cs.headerItalic;
                            document.getElementById('prop-cal-weekday-bold').checked = cs.weekdayBold !== undefined ? !!cs.weekdayBold : true;
                            document.getElementById('prop-cal-weekday-italic').checked = !!cs.weekdayItalic;
                            document.getElementById('prop-cal-day-bold').checked = !!cs.dayBold;
                            document.getElementById('prop-cal-day-italic').checked = !!cs.dayItalic;

                            this.renderCalendarGridProperties(cs);
                        }
                    }
                } else if (obj.type === 'text') {
                    if (sectionText) {
                        sectionText.style.display = 'block';
                        document.getElementById('prop-field-text').value = obj.text || '';
                        document.getElementById('prop-text-font').value = obj.font || 'Helvetica';
                        document.getElementById('prop-text-size').value = obj.fontSize || 12;
                        document.getElementById('prop-text-align').value = obj.textAlign || obj.alignment || 'left';
                        document.getElementById('prop-text-auto-size').checked = !!obj.autoSize;
                        document.getElementById('prop-text-multiline').checked = !!obj.multiline;
                        document.getElementById('prop-text-columns').checked = !!obj.twoColumns;
                        document.getElementById('prop-text-bold').checked = !!obj.bold;
                        document.getElementById('prop-text-italic').checked = !!obj.italic;
                    }
                } else if (obj.type === 'table') {
                    modal.style.display = 'none';
                    this.openTableProperties(obj);
                    return;
                }

                // Styling properties
                const borderColorEl = document.getElementById('prop-border-color');
                const borderWidthEl = document.getElementById('prop-border-width');
                const borderStyleEl = document.getElementById('prop-border-style');
                const bgColorEl = document.getElementById('prop-bg-color');
                const noBgEl = document.getElementById('prop-no-bg');
                const borderRadiusEl = document.getElementById('prop-border-radius');
                const fontColorEl = document.getElementById('prop-font-color');

                if (borderColorEl) borderColorEl.value = obj.borderColor || '#000000';
                if (borderWidthEl) borderWidthEl.value = obj.borderWidth !== undefined ? obj.borderWidth : (obj.type === 'form-field' ? 1 : 0);
                if (borderStyleEl) borderStyleEl.value = obj.borderStyle || 'solid';
                if (bgColorEl) bgColorEl.value = (obj.backgroundColor && !obj.backgroundColor.startsWith('rgba')) ? obj.backgroundColor : '#ffffff';
                // Load bg opacity from object
                const bgOpacityEl = document.getElementById('prop-bg-opacity');
                const bgOpacityVal = document.getElementById('prop-bg-opacity-val');
                let _bgOpVal = 0;
                if (!obj.noBg && obj.backgroundColor) {
                    const _rgba = obj.backgroundColor.match(/rgba\([^)]+,\s*([\d.]+)\)/);
                    if (_rgba) _bgOpVal = Math.round(parseFloat(_rgba[1]) * 100);
                    else if (!obj.backgroundColor.includes('rgba')) _bgOpVal = 100;
                }
                if (bgOpacityEl) { bgOpacityEl.value = _bgOpVal; }
                if (bgOpacityVal) bgOpacityVal.textContent = _bgOpVal + '%';
                if (noBgEl) noBgEl.checked = _bgOpVal === 0;
                if (borderRadiusEl) borderRadiusEl.value = obj.borderRadius || 0;
                if (fontColorEl) fontColorEl.value = obj.fontColor || obj.textColor || obj.color || '#000000';

                // Hide/show font color based on context
                if (obj.fieldType === 'calendar') {
                    if (fontColorEl) fontColorEl.parentElement.style.display = 'none';
                    if (bgColorEl) bgColorEl.parentElement.style.display = 'none';
                } else {
                    if (fontColorEl) fontColorEl.parentElement.style.display = 'flex';
                    if (bgColorEl) bgColorEl.parentElement.style.display = 'flex';
                }
            },

            openTableProperties: function (obj) {
                this.selectedObj = obj;
                this.editingTableObj = obj;
                const modal = document.getElementById('table-props-modal');
                if (!modal) return;
                // Switch to edit mode
                modal.dataset.mode = 'edit';
                const titleEl = modal.querySelector('h3');
                if (titleEl) titleEl.textContent = 'Propiedades de Tabla';
                const confirmBtn = document.getElementById('tbl-confirm-btn');
                if (confirmBtn) { confirmBtn.textContent = 'Aplicar'; confirmBtn.onclick = () => app.applyTableProperties(); }
                // Show/hide sections
                const insertSection = document.getElementById('tbl-insert-section');
                const editSection = document.getElementById('tbl-edit-section');
                if (insertSection) insertSection.style.display = 'none';
                if (editSection) editSection.style.display = 'block';
                // Populate fields
                document.getElementById('tbl-prop-border-color').value = obj.borderColor || '#000000';
                document.getElementById('tbl-prop-border-width').value = obj.borderWidth !== undefined ? obj.borderWidth : 1;
                document.getElementById('tbl-prop-bg-color').value = (obj.backgroundColor && obj.backgroundColor !== 'transparent') ? obj.backgroundColor : '#ffffff';
                document.getElementById('tbl-prop-transparent').checked = (!obj.backgroundColor || obj.backgroundColor === 'transparent');
                document.getElementById('tbl-prop-align').value = obj.textAlign || 'left';
                document.getElementById('tbl-prop-autosize').checked = !!obj.autoSize;
                document.getElementById('tbl-prop-font-size').value = obj.fontSize || 12;
                document.getElementById('tbl-prop-text-color').value = obj.textColor || '#000000';
                // Row/col counters
                document.getElementById('tbl-edit-rows').textContent = obj.rows;
                document.getElementById('tbl-edit-cols').textContent = obj.cols;
                modal.style.display = 'flex';
            },

            applyTableProperties: function () {
                const obj = this.editingTableObj;
                if (!obj) return;
                this.saveState();
                obj.borderColor = document.getElementById('tbl-prop-border-color').value;
                obj.borderWidth = parseFloat(document.getElementById('tbl-prop-border-width').value) || 0;
                const isTransp = document.getElementById('tbl-prop-transparent').checked;
                obj.backgroundColor = isTransp ? 'transparent' : document.getElementById('tbl-prop-bg-color').value;
                obj.textAlign = document.getElementById('tbl-prop-align').value;
                obj.autoSize = document.getElementById('tbl-prop-autosize').checked;
                obj.fontSize = parseInt(document.getElementById('tbl-prop-font-size').value) || 12;
                obj.textColor = document.getElementById('tbl-prop-text-color').value;
                this.renderOverlays();
                document.getElementById('table-props-modal').style.display = 'none';
                this.editingTableObj = null;
                this.showToast('✓ Propiedades de tabla actualizadas');
            },

            addTableRow: function () {
                const obj = this.editingTableObj || this.selectedObj;
                if (!obj || obj.type !== 'table') return;
                this.saveState();
                const avgH = obj.rowHeights.reduce((a, b) => a + b, 0) / obj.rows;
                obj.rows++;
                obj.rowHeights.push(avgH);
                obj.data.push(Array(obj.cols).fill(''));
                if (obj.cellStyles) obj.cellStyles.push(Array(obj.cols).fill(null));
                obj.height += avgH;
                const counter = document.getElementById('tbl-edit-rows');
                if (counter) counter.textContent = obj.rows;
                this.renderOverlays();
            },

            removeTableRow: function () {
                const obj = this.editingTableObj || this.selectedObj;
                if (!obj || obj.type !== 'table' || obj.rows <= 1) return;
                this.saveState();
                obj.rows--;
                const removed = obj.rowHeights.pop();
                obj.data.pop();
                if (obj.cellStyles) obj.cellStyles.pop();
                obj.height -= removed;
                const counter = document.getElementById('tbl-edit-rows');
                if (counter) counter.textContent = obj.rows;
                this.renderOverlays();
            },

            addTableCol: function () {
                const obj = this.editingTableObj || this.selectedObj;
                if (!obj || obj.type !== 'table') return;
                this.saveState();
                const avgW = obj.colWidths.reduce((a, b) => a + b, 0) / obj.cols;
                obj.cols++;
                obj.colWidths.push(avgW);
                obj.data.forEach(row => row.push(''));
                if (obj.cellStyles) obj.cellStyles.forEach(row => row.push(null));
                obj.width += avgW;
                const counter = document.getElementById('tbl-edit-cols');
                if (counter) counter.textContent = obj.cols;
                this.renderOverlays();
            },

            removeTableCol: function () {
                const obj = this.editingTableObj || this.selectedObj;
                if (!obj || obj.type !== 'table' || obj.cols <= 1) return;
                this.saveState();
                obj.cols--;
                const removed = obj.colWidths.pop();
                obj.data.forEach(row => row.pop());
                if (obj.cellStyles) obj.cellStyles.forEach(row => row.pop());
                obj.width -= removed;
                const counter = document.getElementById('tbl-edit-cols');
                if (counter) counter.textContent = obj.cols;
                this.renderOverlays();
            },

            fillPreset: function (presetName) {
                // Usar app.presets directamente para evitar problemas de contexto con 'this'
                const optArea = document.getElementById('prop-dropdown-options');
                if (!optArea || optArea.offsetParent === null) {
                    app.showToast('⚠️ Abre primero las propiedades de una lista desplegable');
                    return;
                }
                const presetData = app.dropdownPresets || this.dropdownPresets;
                const options = presetData[presetName];
                if (options) {
                    const current = optArea.value.trim();
                    optArea.value = (current ? current + '\n' : '') + options.join('\n');
                    app.showToast('✓ ' + options.length + ' opciones cargadas');
                } else {
                    // Fallback: buscar en el objeto presets directamente
                    console.warn('Preset no encontrado:', presetName, '| Presets disponibles:', Object.keys(presetData));
                    app.showToast('⚠️ Preset no encontrado: ' + presetName);
                }
            },

            addPreset: function (presetName) { this.fillPreset(presetName); },

            // ============================================================
            // TAB ORDER MANAGER
            // ============================================================
            showTabOrderPanel: function () {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                if (!page) return;

                const fields = (page.objects || [])
                    .filter(o => o.type === 'form-field')
                    .sort((a, b) => (a.tabIndex || 999) - (b.tabIndex || 999));

                if (!fields.length) {
                    this.showToast('⚠️ No hay campos de formulario en esta página');
                    return;
                }

                const existing = document.getElementById('_tab_order_panel');
                if (existing) existing.remove();

                const fieldTypeIcon = {
                    text: '📝', checkbox: '☑', radio: '🔘',
                    dropdown: '▾', signature: '✍', calendar: '📅'
                };

                const modal = document.createElement('div');
                modal.id = '_tab_order_panel';
                modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

                modal.innerHTML = `
                <div style="background:rgba(26,32,53,0.63);border:1px solid rgba(255,255,255,0.18);border-radius:14px;
                            padding:20px;width:460px;max-width:94vw;max-height:85vh;
                            overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.6);color:#f0f4ff;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">

                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="2">
                            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                        </svg>
                        <strong style="font-size:15px;flex:1;">Orden de Tabulación</strong>
                        <button onclick="document.getElementById('_tab_order_panel').remove()"
                            style="background:var(--btn-hover);border:1px solid var(--border);border-radius:50%;
                                   width:26px;height:26px;cursor:pointer;color:var(--text-main);font-size:13px;">✕</button>
                    </div>

                    <div style="font-size:11px;color:var(--text-muted,#888);margin-bottom:12px;">
                        Arrastra las filas o usa ↑↓ para cambiar el orden. El número indica cuándo se activa ese campo al presionar Tab.
                    </div>

                    <div id="_tab_order_list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
                        ${fields.map((f, i) => `
                        <div class="_tab_row" data-field-id="${f.id}"
                            style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                                   background:var(--bg-tools);border:1px solid var(--border);
                                   border-radius:8px;cursor:grab;user-select:none;"
                            draggable="true">
                            <span style="font-size:16px;min-width:20px;text-align:center;">${fieldTypeIcon[f.fieldType] || '📋'}</span>
                            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                                title="${app.escapeHtml(f.fieldName)}">${app.escapeHtml(f.fieldName || f.id)}</span>
                            <span style="font-size:10px;color:var(--text-muted,#888);min-width:40px;text-align:right;">${f.fieldType}</span>
                            <div style="display:flex;gap:2px;">
                                <button onclick="app._tabOrderMove('${f.id}', -1)"
                                    style="width:22px;height:22px;border:1px solid var(--border);border-radius:4px;
                                           background:var(--btn-hover);cursor:pointer;font-size:11px;color:var(--text-main);">↑</button>
                                <button onclick="app._tabOrderMove('${f.id}', 1)"
                                    style="width:22px;height:22px;border:1px solid var(--border);border-radius:4px;
                                           background:var(--btn-hover);cursor:pointer;font-size:11px;color:var(--text-main);">↓</button>
                            </div>
                            <div style="background:var(--accent);color:white;border-radius:50%;
                                        width:22px;height:22px;display:flex;align-items:center;justify-content:center;
                                        font-size:11px;font-weight:700;flex-shrink:0;" class="_tab_badge">${i + 1}</div>
                        </div>`).join('')}
                    </div>

                    <div style="display:flex;gap:8px;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border);">
                        <button onclick="app._tabOrderAutoSort()"
                            style="padding:7px 14px;font-size:12px;background:var(--bg-tools);border:1px solid var(--border);
                                   border-radius:6px;cursor:pointer;color:var(--text-main);">
                            ✦ Auto (↗ posición)
                        </button>
                        <div style="display:flex;gap:8px;">
                            <button onclick="document.getElementById('_tab_order_panel').remove()"
                                style="padding:7px 16px;font-size:12px;background:var(--btn-hover);border:1px solid var(--border);
                                       border-radius:6px;cursor:pointer;color:var(--text-main);">Cancelar</button>
                            <button onclick="app._tabOrderApply()"
                                style="padding:7px 16px;font-size:12px;background:var(--accent);border:none;
                                       border-radius:6px;cursor:pointer;color:white;font-weight:600;">Aplicar</button>
                        </div>
                    </div>
                </div>`;

                document.body.appendChild(modal);

                // ESC to close
                const escHandler = (e) => {
                    if (e.key === 'Escape') {
                        modal.remove();
                        document.removeEventListener('keydown', escHandler);
                    }
                };
                document.addEventListener('keydown', escHandler);

                // Drag & drop to reorder
                this._initTabOrderDragDrop();
            },

            _initTabOrderDragDrop: function () {
                const list = document.getElementById('_tab_order_list');
                if (!list) return;
                let dragging = null;

                list.querySelectorAll('._tab_row').forEach(row => {
                    row.addEventListener('dragstart', () => {
                        dragging = row;
                        setTimeout(() => row.style.opacity = '0.4', 0);
                    });
                    row.addEventListener('dragend', () => {
                        row.style.opacity = '';
                        dragging = null;
                        app._tabOrderUpdateBadges();
                    });
                    row.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        if (dragging && dragging !== row) {
                            const rect = row.getBoundingClientRect();
                            const mid  = rect.top + rect.height / 2;
                            list.insertBefore(dragging, e.clientY < mid ? row : row.nextSibling);
                        }
                    });
                });
            },

            _tabOrderUpdateBadges: function () {
                const rows = document.querySelectorAll('#_tab_order_list ._tab_row');
                rows.forEach((row, i) => {
                    const badge = row.querySelector('._tab_badge');
                    if (badge) badge.textContent = i + 1;
                });
            },

            _tabOrderMove: function (fieldId, dir) {
                const list = document.getElementById('_tab_order_list');
                if (!list) return;
                const rows = Array.from(list.querySelectorAll('._tab_row'));
                const idx  = rows.findIndex(r => r.dataset.fieldId === fieldId);
                if (idx === -1) return;
                const newIdx = idx + dir;
                if (newIdx < 0 || newIdx >= rows.length) return;
                if (dir === -1) list.insertBefore(rows[idx], rows[newIdx]);
                else            list.insertBefore(rows[newIdx], rows[idx]);
                this._tabOrderUpdateBadges();
            },

            _tabOrderAutoSort: function () {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                const fields = (page.objects || []).filter(o => o.type === 'form-field');

                // Sort by Y first (top to bottom), then X (left to right)
                // Use 20pt tolerance for same-line detection
                const ROW_TOLERANCE = 20;
                fields.sort((a, b) => {
                    const rowA = Math.round(a.y / ROW_TOLERANCE);
                    const rowB = Math.round(b.y / ROW_TOLERANCE);
                    if (rowA !== rowB) return rowA - rowB;
                    return a.x - b.x;
                });

                // Rebuild list in sorted order
                const list = document.getElementById('_tab_order_list');
                if (!list) return;
                const allRows = Array.from(list.querySelectorAll('._tab_row'));
                fields.forEach((f, i) => {
                    const row = allRows.find(r => r.dataset.fieldId === f.id);
                    if (row) list.appendChild(row);
                });
                this._tabOrderUpdateBadges();
                this.showToast('✦ Orden calculado por posición');
            },

            _tabOrderApply: function () {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                const rows = document.querySelectorAll('#_tab_order_list ._tab_row');

                rows.forEach((row, i) => {
                    const field = (page.objects || []).find(o => o.id === row.dataset.fieldId);
                    if (field) field.tabIndex = i + 1;
                });

                document.getElementById('_tab_order_panel')?.remove();
                this.saveState();
                this.showToast('✅ Orden de tabulación aplicado');
            },

            applyProperties: function () {
                if (!this.selectedObj) return;
                const obj = this.selectedObj;

                // Collect all targets: selected objects of same type (and fieldType if applicable)
                const doc = this.getDoc();
                const page = doc ? doc.pages[doc.currentIndex] : null;
                const multiIds = this.multiObjectSelection && this.multiObjectSelection.size > 1 ? this.multiObjectSelection : null;
                let targets = [obj];
                if (multiIds && page) {
                    targets = (page.objects || []).filter(o =>
                        multiIds.has(o.id) && o.type === obj.type &&
                        (!obj.fieldType || o.fieldType === obj.fieldType)
                    );
                    if (targets.length === 0) targets = [obj];
                }

                // Helper: read common values from modal once, apply to all targets
                const nameInput = document.getElementById('prop-field-name');
                const reqCheck = document.getElementById('prop-required');
                const readCheck = document.getElementById('prop-readonly');
                const _tabEl = document.getElementById('prop-tab-index');
                const borderColorEl = document.getElementById('prop-border-color');
                const borderWidthEl = document.getElementById('prop-border-width');
                const borderStyleEl = document.getElementById('prop-border-style');
                const bgColorEl = document.getElementById('prop-bg-color');
                const noBgEl = document.getElementById('prop-no-bg');
                const borderRadiusEl = document.getElementById('prop-border-radius');
                const fColorInput = document.getElementById('prop-font-color');

                targets.forEach(o => {
                    if (o.fromFormField) o.nativeStyleChanged = true;
                    if (nameInput && targets.length === 1) o.fieldName = nameInput.value; // name only for single
                    if (reqCheck) o.required = reqCheck.checked;
                    if (readCheck) o.readOnly = readCheck.checked;
                    if (_tabEl && targets.length === 1) o.tabIndex = Math.max(1, parseInt(_tabEl.value) || 1);

                if (o.type === 'form-field') {
                    if (o.fieldType === 'text') {
                        if (targets.length === 1) {
                            const textInput = document.getElementById('prop-field-text');
                            if (textInput) { o.textValue = textInput.value; o.value = textInput.value; }
                        }
                        o.font = document.getElementById('prop-text-font').value;
                        o.textAlign = document.getElementById('prop-text-align').value;
                        o.autoSize = document.getElementById('prop-text-auto-size').checked;
                        o.fontSize = o.autoSize ? 0 : (parseInt(document.getElementById('prop-text-size').value) || 12);
                        o.multiline = document.getElementById('prop-text-multiline').checked;
                        o.twoColumns = document.getElementById('prop-text-columns').checked;
                        o.bold = document.getElementById('prop-text-bold').checked;
                        o.italic = document.getElementById('prop-text-italic').checked;

                    } else if (o.fieldType === 'dropdown' || o.fieldType === 'Ch') {
                        if (targets.length === 1) {
                            const optionsArea = document.getElementById('prop-dropdown-options');
                            if (optionsArea) o.options = optionsArea.value.split('\n').map(l => l.trim()).filter(l => l);
                        }
                        o.font = document.getElementById('prop-dropdown-font').value;
                        const _fcSave = document.getElementById('prop-font-color');
                        o.textColor = _fcSave ? _fcSave.value : '#000000';
                        o.fontColor = o.textColor;
                        o.bold = document.getElementById('prop-dropdown-bold').checked;
                        o.italic = document.getElementById('prop-dropdown-italic').checked;
                        const _ddAs = document.getElementById('prop-dropdown-auto-size');
                        o.autoSize = _ddAs ? _ddAs.checked : false;
                        o.fontSize = o.autoSize ? 0 : (parseInt(document.getElementById('prop-dropdown-size').value) || 12);

                    } else if (o.fieldType === 'checkbox' || o.fieldType === 'Btn') {
                        const checkEl = document.getElementById('prop-field-checked');
                        if (checkEl) o.checked = checkEl.checked;
                        const ckColorEl = document.getElementById('prop-check-color');
                        if (ckColorEl) o.checkColor = ckColorEl.value;
                        const cbGroup = document.getElementById('prop-checkbox-group');
                        o.groupName = cbGroup ? cbGroup.value : '';
                        const cbRule = document.getElementById('prop-checkbox-group-rule');
                        o.groupRule = cbRule ? cbRule.value : 'none';
                        if (o.groupName) app._applyCheckboxGroupRule(o);

                    } else if (o.fieldType === 'radio') {
                        const rgGroup = document.getElementById('prop-radio-group');
                        o.groupName = rgGroup ? rgGroup.value : '';
                        if (targets.length === 1) o.selected = document.getElementById('prop-radio-selected').checked;
                        const dotColorEl = document.getElementById('prop-dot-color');
                        if (dotColorEl) o.dotColor = dotColorEl.value;
                        if (o.groupName && o.selected) app._applyRadioGroupExclusion(o);

                    } else if (o.fieldType === 'signature') {
                        if (targets.length === 1) {
                            o.signerId  = document.getElementById('prop-sign-user').value;
                            o.signMode  = document.getElementById('prop-sign-mode')?.value || 'field';
                        }
                        o.signOpacity = parseInt(document.getElementById('prop-sign-opacity')?.value || 100);
                        o.signRemoveBg = document.getElementById('prop-sign-remove-bg')?.checked || false;

                    } else if (o.fieldType === 'calendar') {
                        if (o === obj) { // calendar state only for primary object
                            const cs = o.calendarState;
                            const monthEl = document.getElementById('prop-cal-month');
                            const yearEl = document.getElementById('prop-cal-year');
                            if (monthEl) cs.month = parseInt(monthEl.value);
                            if (yearEl) cs.year = parseInt(yearEl.value);
                            cs.style = document.getElementById('prop-cal-style').value;
                            cs.format = document.getElementById('prop-cal-format').value;
                            cs.align = document.getElementById('prop-cal-align').value;
                            cs.headerColor = document.getElementById('prop-cal-header-color').value;
                            cs.selectColor = document.getElementById('prop-cal-select-color').value;
                            cs.bgColor = document.getElementById('prop-cal-bg-color').value;
                            cs.headerTextColor = document.getElementById('prop-cal-header-text-color').value;
                            cs.headerFontSize = parseInt(document.getElementById('prop-cal-header-font-size').value);
                            cs.weekdayTextColor = document.getElementById('prop-cal-weekday-text-color').value;
                            cs.weekdayFontSize = parseInt(document.getElementById('prop-cal-weekday-font-size').value);
                            cs.dayTextColor = document.getElementById('prop-cal-day-text-color').value;
                            cs.dayFontSize = parseInt(document.getElementById('prop-cal-day-font-size').value);
                            cs.font = document.getElementById('prop-cal-font').value;
                            cs.headerBold = document.getElementById('prop-cal-header-bold').checked;
                            cs.headerItalic = document.getElementById('prop-cal-header-italic').checked;
                            cs.weekdayBold = document.getElementById('prop-cal-weekday-bold').checked;
                            cs.weekdayItalic = document.getElementById('prop-cal-weekday-italic').checked;
                            cs.dayBold = document.getElementById('prop-cal-day-bold').checked;
                            cs.dayItalic = document.getElementById('prop-cal-day-italic').checked;
                        }
                    }
                } else if (o.type === 'text') {
                    if (targets.length === 1) {
                        const textInput = document.getElementById('prop-field-text');
                        if (textInput) o.text = textInput.value;
                    }
                    o.font = document.getElementById('prop-text-font').value;
                    o.textAlign = document.getElementById('prop-text-align').value;
                    o.alignment = o.textAlign;
                    o.autoSize = document.getElementById('prop-text-auto-size').checked;
                    o.fontSize = o.autoSize ? 0 : (parseInt(document.getElementById('prop-text-size').value) || 12);
                    o.multiline = document.getElementById('prop-text-multiline').checked;
                    o.twoColumns = document.getElementById('prop-text-columns').checked;
                    o.bold = document.getElementById('prop-text-bold').checked;
                    o.italic = document.getElementById('prop-text-italic').checked;
                }

                // Sync styling to all targets
                if (borderColorEl) o.borderColor = borderColorEl.value;
                if (borderWidthEl) o.borderWidth = parseFloat(borderWidthEl.value) || 0;
                if (borderStyleEl) o.borderStyle = borderStyleEl.value;
                const _bgOpacityEl2 = document.getElementById('prop-bg-opacity');
                const _bgOpacity2 = _bgOpacityEl2 ? parseInt(_bgOpacityEl2.value) : 0;
                if (bgColorEl) {
                    const _bgHex = bgColorEl.value;
                    const _r2 = parseInt(_bgHex.slice(1,3),16), _g2 = parseInt(_bgHex.slice(3,5),16), _b2 = parseInt(_bgHex.slice(5,7),16);
                    o.backgroundColor = _bgOpacity2 > 0 ? `rgba(${_r2},${_g2},${_b2},${_bgOpacity2/100})` : 'rgba(0,0,0,0)';
                    o.noBg = _bgOpacity2 === 0;
                }
                if (borderRadiusEl) o.borderRadius = parseInt(borderRadiusEl.value) || 0;
                if (fColorInput) { o.fontColor = fColorInput.value; o.textColor = fColorInput.value; o.color = fColorInput.value; }
                }); // end targets.forEach

                this.renderOverlays();
                this.renderSidebar();
                this.saveState();
                this.closeAllModals();
                this.showToast(targets.length > 1 ? `✓ Propiedades aplicadas a ${targets.length} objetos` : '✓ Propiedades guardadas');
            },


            // ── Group Management ─────────────────────────────────────────────────

            /** Returns all group names of given type ('checkbox'|'radio') in current doc */
            _getGroupNames: function(type) {
                const doc = this.getDoc(); if (!doc) return [];
                const names = new Set();
                // From stored groups
                if (doc.groups && doc.groups[type]) doc.groups[type].forEach(g => names.add(g));
                // From objects that already have a group assigned
                doc.pages.forEach(p => (p.objects||[]).forEach(o => {
                    if (o.fieldType === type && o.groupName) names.add(o.groupName);
                }));
                return [...names].sort();
            },

            /** Populates a <select> with existing group names + current value */
            _populateGroupDropdown: function(sel, type, currentVal) {
                if (!sel) return;
                const groups = this._getGroupNames(type);
                sel.innerHTML = '<option value="">Sin grupo</option>';
                groups.forEach(g => {
                    const opt = document.createElement('option');
                    opt.value = g; opt.textContent = g;
                    if (g === currentVal) opt.selected = true;
                    sel.appendChild(opt);
                });
                if (currentVal && !groups.includes(currentVal)) {
                    const opt = document.createElement('option');
                    opt.value = currentVal; opt.textContent = currentVal;
                    opt.selected = true;
                    sel.appendChild(opt);
                }
            },

            /** Opens group manager modal */
            openGroupManager: function(type) {
                // Cerrar modal de propiedades, deseleccionar objeto y abrir modal de grupos
                this.closeAllModals();
                // Deselect to hide resize handles
                this.selectedObj = null;
                document.querySelectorAll('.draggable.selected').forEach(el => el.classList.remove('selected'));

                const groups = this._getGroupNames(type);
                const label = type === 'radio' ? 'Radio' : 'Checkbox';
                const existing = groups.map(g => `<li style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
                    <span>${g}</span>
                    <button onclick="app._deleteGroup('${type}','${g}');app.openGroupManager('${type}')"
                        style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Eliminar</button>
                </li>`).join('') || '<li style="color:var(--text-muted);font-size:12px;padding:4px 0;">No hay grupos creados</li>';

                const html = `<div style="padding:20px;min-width:320px;">
                    <h3 style="margin:0 0 16px;color:#f0f4ff;">Grupos de ${label}</h3>
                    <div style="margin-bottom:16px;">
                        <label style="display:block;margin-bottom:6px;font-size:13px;color:#e2e8f0;">Nuevo grupo:</label>
                        <div style="display:flex;gap:8px;">
                            <input id="new-group-input" type="text" placeholder="Nombre del grupo..."
                                style="flex:1;padding:8px;background:var(--input-bg);border:1px solid var(--border);color:#f0f4ff;border-radius:4px;"
                                onkeydown="if(event.key==='Enter'){app._createGroupAndRefresh('${type}');}">
                            <button onclick="app._createGroupAndRefresh('${type}')"
                                style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;">Crear</button>
                        </div>
                    </div>
                    <label style="display:block;margin-bottom:8px;font-size:13px;font-weight:600;color:#e2e8f0;">Grupos existentes:</label>
                    <ul id="group-list-${type}" style="list-style:none;margin:0;padding:0;max-height:200px;overflow-y:auto;">${existing}</ul>
                    <div style="text-align:right;margin-top:16px;">
                        <button onclick="document.getElementById('generic-modal').style.display='none';setTimeout(()=>app.openProperties(app.selectedObj),50)"
                            style="padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;">Cerrar</button>
                    </div>
                </div>`;

                let modal = document.getElementById('generic-modal');
                if (!modal) {
                    modal = document.createElement('div');
                    modal.id = 'generic-modal';
                    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99998;';
                    modal.innerHTML = '<div id="generic-modal-content" style="background:rgba(26,32,53,0.63);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.18);position:relative;z-index:99999;color:#f0f4ff;"></div>';
                    document.body.appendChild(modal);
                    modal.onclick = (e) => { if (e.target === modal) { modal.style.display='none'; setTimeout(()=>app.openProperties(app.selectedObj),50); } };
                }
                modal.style.zIndex = '99998';
                document.getElementById('generic-modal-content').innerHTML = html;
                modal.style.display = 'flex';
                // Focus input
                setTimeout(() => { const inp = document.getElementById('new-group-input'); if(inp) inp.focus(); }, 50);
            },

            _createGroupAndRefresh: function(type) {
                const input = document.getElementById('new-group-input');
                if (!input || !input.value.trim()) return;
                const doc = this.getDoc(); if (!doc) return;
                if (!doc.groups) doc.groups = {};
                if (!doc.groups[type]) doc.groups[type] = [];
                const name = input.value.trim();
                if (!doc.groups[type].includes(name)) doc.groups[type].push(name);
                // Refresh list without rebuilding entire modal
                const groups = this._getGroupNames(type);
                const list = document.getElementById('group-list-' + type);
                if (list) {
                    list.innerHTML = groups.map(g => `<li style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
                        <span>${g}</span>
                        <button onclick="app._deleteGroup('${type}','${g}');app.openGroupManager('${type}')"
                            style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Eliminar</button>
                    </li>`).join('') || '<li style="color:var(--text-muted);font-size:12px;padding:4px 0;">No hay grupos creados</li>';
                }
                input.value = '';
                input.focus();
            },

            _createGroup: function(type) {
                this._createGroupAndRefresh(type);
            },

            _deleteGroup: function(type, name) {
                const doc = this.getDoc(); if (!doc) return;
                doc.pages.forEach(p => (p.objects||[]).forEach(o => {
                    if (o.fieldType === type && o.groupName === name) {
                        o.groupName = ''; o.groupRule = 'none';
                    }
                }));
                if (doc.groups && doc.groups[type])
                    doc.groups[type] = doc.groups[type].filter(g => g !== name);
                this.renderOverlays(); this.saveState();
            },

            // ── Signature helpers ───────────────────────────────────────────────

            _onSignModeChange: function(mode) {
                const fieldOpts = document.getElementById('prop-sign-field-opts');
                const imageOpts = document.getElementById('prop-sign-image-opts');
                if (fieldOpts) fieldOpts.style.display = mode === 'field' ? 'block' : 'none';
                if (imageOpts) imageOpts.style.display = mode === 'image' ? 'block' : 'none';
            },

            _onSignImageUpload: async function(event) {
                const file = event.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const originalData = e.target.result; // base64 data URL
                    const removeBg = document.getElementById('prop-sign-remove-bg')?.checked;
                    let finalData = originalData;

                    if (removeBg && PythonManager.isLoaded) {
                        try {
                            this.showToast('⏳ Quitando fondo...');
                            finalData = await PythonManager.removeImageBackground(originalData);
                            this.showToast('✓ Fondo eliminado');
                        } catch(err) {
                            console.warn('removeBackground failed:', err);
                            this.showToast('⚠️ No se pudo quitar el fondo');
                        }
                    }

                    // Store in selected object
                    if (this.selectedObj) {
                        this.selectedObj.signImageData = finalData;
                        this.renderOverlays();
                        this.saveState();
                    }

                    // Update preview
                    const thumb = document.getElementById('prop-sign-img-thumb');
                    const placeholder = document.getElementById('prop-sign-img-placeholder');
                    if (thumb) { thumb.src = finalData; thumb.style.display = 'block'; }
                    if (placeholder) placeholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            },

            _updateSignPreview: function() {
                if (!this.selectedObj) return;
                this.selectedObj.signOpacity = parseInt(document.getElementById('prop-sign-opacity')?.value || 100);
                this.renderOverlays();
            },

            _applyCheckboxGroupRule: function(changedObj) {
                const doc = this.getDoc(); if (!doc) return;
                if (changedObj.groupRule === 'max1' && changedObj.checked) {
                    doc.pages.forEach(p => (p.objects||[]).forEach(o => {
                        if (o.fieldType === 'checkbox' && o.groupName === changedObj.groupName && o.id !== changedObj.id)
                            o.checked = false;
                    }));
                }
            },

            _applyRadioGroupExclusion: function(changedObj) {
                const doc = this.getDoc(); if (!doc) return;
                doc.pages.forEach(p => (p.objects||[]).forEach(o => {
                    if (o.fieldType === 'radio' && o.groupName === changedObj.groupName && o.id !== changedObj.id) {
                        o.selected = false;
                        o.checked  = false;
                    }
                }));
            },

            isFieldHighlightMode: true,

            _isNativeFieldSuppressed: function (pageData, fieldName, widgetIndex = 0, annotationId = '') {
                return (pageData?.deletedNativeFields || []).some(entry => {
                    if (typeof entry === 'string') return entry === fieldName;
                    if (!entry || typeof entry !== 'object') return false;
                    if (annotationId && entry.nativeAnnotationId) {
                        return String(entry.nativeAnnotationId) === String(annotationId);
                    }
                    return entry.nativeFieldName === fieldName && Number(entry.nativeWidgetIndex || 0) === Number(widgetIndex || 0);
                });
            },

            detectNativeFields: async function () {
                const doc = this.getDoc();
                if (!doc) return;
                const page = doc.pages[doc.currentIndex];
                const src = doc.sources[page.sourceId];
                if (!src || !src.buffer) {
                    this.showToast("⚠️ Solo disponible en páginas PDF originales");
                    return;
                }

                if (!PythonManager.isLoaded) {
                    this.showToast("🐍 Cargando motor de detección...");
                    await PythonManager.init();
                }

                this.showToast("🐍 Analizando estructura nativa...");
                const analysis = await PythonManager.analyzePage(src.buffer, page.pageIndex);

                if (!analysis || !analysis.widgets || analysis.widgets.length === 0) {
                    this.showToast("📍 No se encontraron campos nativos en esta página");
                    return;
                }

                console.log(`🐍 Python detectó ${analysis.widgets.length} campos:`, analysis.widgets);

                let addedCount = 0;
                const widgetIndexByName = new Map();
                analysis.widgets.forEach(w => {
                    // rect: [x0, y0, x1, y1]
                    const x = w.rect[0];
                    const y = w.rect[1];
                    const width = w.rect[2] - w.rect[0];
                    const height = w.rect[3] - w.rect[1];

                    // Map widget types
                    let type = 'text';
                    const wType = String(w.type).toLowerCase();
                    if (wType.includes('check')) type = 'checkbox';
                    else if (wType.includes('radio')) type = 'radio';
                    else if (wType.includes('combo') || wType.includes('list') || wType.includes('choice')) type = 'dropdown';

                    const nativeFieldName = w.name || '';
                    const nativeWidgetIndex = widgetIndexByName.get(nativeFieldName) || 0;
                    widgetIndexByName.set(nativeFieldName, nativeWidgetIndex + 1);
                    if (this._isNativeFieldSuppressed(page, nativeFieldName, nativeWidgetIndex)) return;
                    // Evitar duplicados
                    page.objects = page.objects || [];
                    const exists = page.objects.some(o =>
                        o.fromFormField && o.nativeFieldName === nativeFieldName && o.nativeWidgetIndex === nativeWidgetIndex
                    );

                    if (!exists) {
                        const newObj = {
                            id: 'native-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                            type: 'form-field',
                            fieldType: type, // 'text', 'checkbox', etc.
                            x: x,
                            y: y,
                            width: width,
                            height: height,
                            value: w.value || '',
                            textValue: w.value || '', // Consistency
                            fieldName: nativeFieldName,
                            nativeFieldName,
                            nativeWidgetIndex,
                            isNative: true,
                            fromFormField: true, // Crucial for savePDFInternal logic
                            // Visual properties from PyMuPDF
                            backgroundColor: w.fillColor || 'rgba(0,0,0,0)',
                            noBg: !w.fillColor,
                            borderColor: w.borderColor || '#3b82f6',
                            borderWidth: w.borderWidth || 1,
                            fontSize: Number(w.fontSize) > 0 && Number(w.fontSize) < height * 0.9 ? Number(w.fontSize) : 0,
                            autoSize: !(Number(w.fontSize) > 0 && Number(w.fontSize) < height * 0.9),
                            fontName: w.fontName || '',
                            textColor: w.textColor || '#000000',
                            readOnly: !!w.isReadonly,
                            required: !!w.isRequired,
                            multiline: !!w.isMultiline
                        };
                        page.objects.push(newObj);
                        addedCount++;
                    }
                });

                if (addedCount > 0) {
                    const activePanel = this.splitView.activePanel;
                    const elements = this.getPanelElements(activePanel);
                    if (this.isFieldEditMode && elements.annotationLayer) {
                        elements.annotationLayer.style.display = 'none';
                        elements.annotationLayer.style.visibility = 'hidden';
                        elements.annotationLayer.style.pointerEvents = 'none';
                    }
                    page.nativeFieldOverlaysDetected = true;

                    this.showToast(`✅ Detectados ${addedCount} campos nativos`);
                    this.renderOverlays();
                    this.setupInteractDraggables();

                    // Si no estamos en la pestaña de formularios, avisar
                    if (this.currentTab !== 'form') {
                        setTimeout(() => this.showToast("💡 Ve a la pestaña FORMULARIO para editarlos", 4000), 2000);
                    }
                } else {
                    this.showToast("📍 Los campos ya están detectados");
                }
            },

            /**
             * ACTIVATES A FORM TOOL
             */
            setFormTool: function (type) {
                this.cancelPendingSignature?.();
                // If clicking the same tool, deactivate it
                if (this.currentFormTool === type && type !== 'none') {
                    type = 'none';
                }

                this.currentFormTool = type;
                this.pendingHighlightColor = null; // Clear auto-highlight when switching to form tools
                document.querySelectorAll('#toolbar-form .tool-btn').forEach(b => b.classList.remove('active'));

                if (type === 'none') {
                    document.body.style.cursor = 'default';
                    // Optional: Activate hand mode or selection mode?
                    // For now, just default pointer
                    return;
                }

                // Highlight active button
                const btnMap = {
                    'text': 'btn-form-text', 'checkbox': 'btn-form-check',
                    'radio': 'btn-form-radio', 'dropdown': 'btn-form-combo',
                    'signature': 'btn-form-sign', 'calendar': 'btn-form-calendar'
                };
                if (btnMap[type]) {
                    const btn = document.getElementById(btnMap[type]);
                    if (btn) btn.classList.add('active');
                }

                document.body.style.cursor = 'crosshair';
                this.showToast('Herramienta: ' + type.toUpperCase());
            },

            // ── STAMP MODE ────────────────────────────────────────────
            stampFieldTemplate: null,
            isStampMode: false,

            activateFieldStamp: function () {
                // Toggle: si ya está activo, salir
                if (this.isStampMode) {
                    this._exitStampMode();
                    this.showToast('Modo sello desactivado');
                    return;
                }
                const obj = this.selectedObj;
                if (!obj || obj.type !== 'form-field' || (obj.fieldType !== 'checkbox' && obj.fieldType !== 'radio')) {
                    this.showToast('⚠ Selecciona un campo Checkbox o Radio primero');
                    return;
                }
                if (obj.fieldType === 'radio') {
                    const currentGroup = obj.groupName || '';
                    const groupName = prompt('Nombre del grupo de radio para el sello:', currentGroup || 'radio_grupo_1');
                    if (groupName === null) return;
                    if (!groupName.trim()) { this.showToast('⚠ El nombre de grupo no puede estar vacío'); return; }
                    this.stampFieldTemplate = JSON.parse(JSON.stringify(obj));
                    this.stampFieldTemplate._stampGroupName = groupName.trim();
                } else {
                    this.stampFieldTemplate = JSON.parse(JSON.stringify(obj));
                }
                this.isStampMode = true;
                document.body.style.cursor = 'copy';
                const btn = document.getElementById('btn-field-stamp');
                if (btn) btn.classList.add('active');
                this.showToast('🎯 Modo sello activo — clic para pegar · crea un campo nuevo para salir');
            },

            _exitStampMode: function () {
                if (!this.isStampMode) return;
                this.isStampMode = false;
                this.stampFieldTemplate = null;
                document.body.style.cursor = 'default';
                const btn = document.getElementById('btn-field-stamp');
                if (btn) btn.classList.remove('active');
            },

            placeStampField: function (x, y) {
                if (!this.isStampMode || !this.stampFieldTemplate) return;
                const doc = this.getDoc();
                if (!doc) return;
                this.saveState();
                const tpl = this.stampFieldTemplate;
                const newObj = JSON.parse(JSON.stringify(tpl));
                newObj.id = 'field_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
                newObj.fieldName = tpl.fieldType + '_' + Date.now();
                newObj.x = x - (tpl.width / 2);
                newObj.y = y - (tpl.height / 2);
                if (tpl.fieldType === 'radio' && tpl._stampGroupName) {
                    newObj.groupName = tpl._stampGroupName;
                    newObj.groupRule = 'max1';
                    const d = this.getDoc();
                    if (d) {
                        if (!d.groups) d.groups = {};
                        if (!d.groups.radio) d.groups.radio = [];
                        if (!d.groups.radio.includes(tpl._stampGroupName)) d.groups.radio.push(tpl._stampGroupName);
                    }
                }
                delete newObj._stampGroupName;
                const page = doc.pages[doc.currentIndex];
                const existingFields = (page.objects || []).filter(o => o.type === 'form-field');
                newObj.tabIndex = existingFields.length > 0 ? Math.max(...existingFields.map(o => o.tabIndex || 0)) + 1 : 1;
                page.objects.push(newObj);
                this.renderOverlays();
                this.renderSidebar();
            },

            // ── ACTIVAR CAMPOS (interact mode) ────────────────────────
            isFieldInteractMode: false,

            setFormFieldHighlightColor: function (value) {
                const color = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#f59e0b';
                this.formFieldHighlightColor = color;
                document.documentElement.style.setProperty('--form-field-highlight-color', color);
                try { localStorage.setItem('alioth-form-field-highlight-color', color); } catch (_) {}
                this.renderOverlays?.();
                return color;
            },

            restoreFormFieldHighlightColor: function () {
                let value = null;
                try { value = localStorage.getItem('alioth-form-field-highlight-color'); } catch (_) {}
                return this.setFormFieldHighlightColor(value);
            },

            toggleFieldHighlight: function () {
                const sw = document.getElementById('switch-highlight-fields');
                this.isFieldHighlightMode = sw ? sw.checked : true;
                document.body.classList.toggle('fields-highlighted', this.isFieldHighlightMode);
                this.showToast(this.isFieldHighlightMode ? '🎨 Resaltado de campos activado' : 'Resaltado de campos desactivado');
            },

            toggleFieldInteract: async function () {
                const sw = document.getElementById('switch-interact-fields');
                const shouldInteract = sw ? sw.checked : false;
                if (shouldInteract) {
                    const swEdit = document.getElementById('switch-edit-fields');
                    if (swEdit && swEdit.checked) {
                        swEdit.checked = false;
                        await this.toggleFormFieldEdit();
                    }
                    this.isFieldInteractMode = true;
                    this.setFormTool('none');
                    this.showToast('✅ Campos interactivos — puedes marcar y clicar');
                } else {
                    this.isFieldInteractMode = false;
                    this.showToast('Modo interacción desactivado');
                }
                this.renderOverlays();
                this.setupInteractDraggables();
            },

            // Form interaction mode: 'select' = move/resize/delete, 'interact' = fill fields
            formInteractionMode: 'select',

            setFormMode: function (mode) {
                this.formInteractionMode = mode;
                // Also deactivate any active form drawing tool
                this.setFormTool('none');

                // Update button states
                const selectBtn = document.getElementById('btn-form-select');
                const interactBtn = document.getElementById('btn-form-interact');
                if (selectBtn) selectBtn.classList.toggle('active', mode === 'select');
                if (interactBtn) interactBtn.classList.toggle('active', mode === 'interact');

                // Update cursor and re-render
                if (mode === 'select') {
                    document.body.style.cursor = 'default';
                    this.showToast('Modo: SELECCIONAR (mover, redimensionar, borrar)');
                } else {
                    document.body.style.cursor = 'default';
                    this.showToast('Modo: INTERACTUAR (llenar campos)');
                }
                this.renderOverlays();
            },

            // FORM CREATION EVENTS
            formStartPoint: null,
            isCreatingForm: false,
            currentFormTool: 'none', // Initialize current form tool

            setupFormEvents: function () {
                if (this.formEventsSetup) return;
                this.formEventsSetup = true;
                const handleMouseDown = (e) => {
                    // ── STAMP MODE ──
                    if (this.isStampMode) {
                        const target = e.target;
                        if (!target.closest('.main-view')) return;
                        if (target.closest('.draggable') || target.closest('.form-field-object')) return;
                        e.preventDefault(); e.stopPropagation();
                        const panelId = this.splitView.activePanel;
                        const elements = this.getPanelElements(panelId);
                        const container = elements.canvasContainer;
                        const cRect = container.getBoundingClientRect();
                        const pScale = (this.splitView[panelId]?.scale) || this.currentScale;
                        const x = (e.clientX - cRect.left) / pScale;
                        const y = (e.clientY - cRect.top) / pScale;
                        this.placeStampField(x, y);
                        return;
                    }
                    if (!this.currentFormTool || this.currentFormTool === 'none') return;
                    // Determine which canvas/panel we are on
                    const target = e.target;

                    // ALLOW INTERACTION with existing form objects (selection, dragging, properties)
                    if (target.closest('.draggable') || target.closest('.form-field-object')) {
                        return; // Let the default object interaction handle this
                    }

                    if (!target.closest('.main-view')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const mainView = target.closest('.main-view');
                    // Identify panel based on ID or parent
                    const panelId = mainView.id === 'mainViewPrimary' ? 'primary' : 'secondary';
                    // Only allow if it's the active panel (or switch active?)
                    // Simpler: Just rely on active panel
                    if (panelId !== this.splitView.activePanel) return;

                    const rect = mainView.getBoundingClientRect();
                    const scale = this.currentScale; // Should use panel scale ideally
                    const panelState = this.splitView[panelId];
                    const pScale = panelState?.scale || this.currentScale;

                    // Calculate relative to content (scroll)
                    const scrollLeft = mainView.scrollLeft;
                    const scrollTop = mainView.scrollTop;

                    // We need the position relative to the PAGE content which is transformed by scale
                    // The 'the-canvas' or 'overlay-layer' are children of canvas-container
                    // It's easier to use getPanelElements
                    const elements = this.getPanelElements(panelId);
                    const container = elements.canvasContainer;
                    const cRect = container.getBoundingClientRect();

                    const x = (e.clientX - cRect.left) / pScale;
                    const y = (e.clientY - cRect.top) / pScale;

                    this.formStartPoint = { x, y };
                    this.isCreatingForm = true;

                    // Create temporary visual feedback element
                    const feedback = document.createElement('div');
                    feedback.id = 'form-creation-feedback';
                    feedback.style.position = 'absolute';
                    feedback.style.border = '2px dashed #0056b3';
                    feedback.style.backgroundColor = 'rgba(0, 86, 179, 0.2)';
                    feedback.style.left = (x * pScale) + 'px';
                    feedback.style.top = (y * pScale) + 'px';
                    feedback.style.width = '0px';
                    feedback.style.height = '0px';
                    feedback.style.zIndex = '999999';
                    feedback.style.pointerEvents = 'none';
                    elements.overlayLayer.appendChild(feedback);
                };

                const handleMouseMove = (e) => {
                    if (!this.isCreatingForm || !this.formStartPoint) return;
                    e.preventDefault();

                    const panelId = this.splitView.activePanel;
                    const elements = this.getPanelElements(panelId);
                    const container = elements.canvasContainer;
                    const cRect = container.getBoundingClientRect();
                    const panelState = this.splitView[panelId];
                    const pScale = panelState?.scale || this.currentScale;

                    const currentX = (e.clientX - cRect.left) / pScale;
                    const currentY = (e.clientY - cRect.top) / pScale;

                    const width = Math.abs(currentX - this.formStartPoint.x);
                    const height = Math.abs(currentY - this.formStartPoint.y);
                    const left = Math.min(currentX, this.formStartPoint.x);
                    const top = Math.min(currentY, this.formStartPoint.y);

                    const feedback = document.getElementById('form-creation-feedback');
                    if (feedback) {
                        feedback.style.left = (left * pScale) + 'px';
                        feedback.style.top = (top * pScale) + 'px';
                        feedback.style.width = (width * pScale) + 'px';
                        feedback.style.height = (height * pScale) + 'px';
                    }
                };

                const handleMouseUp = (e) => {
                    if (!this.isCreatingForm) return;
                    this.isCreatingForm = false;

                    const feedback = document.getElementById('form-creation-feedback');
                    if (feedback) feedback.remove();

                    const panelId = this.splitView.activePanel;
                    const elements = this.getPanelElements(panelId);
                    const container = elements.canvasContainer;
                    const cRect = container.getBoundingClientRect();
                    const panelState = this.splitView[panelId];
                    const pScale = panelState?.scale || this.currentScale;

                    const currentX = (e.clientX - cRect.left) / pScale;
                    const currentY = (e.clientY - cRect.top) / pScale;

                    const width = Math.abs(currentX - this.formStartPoint.x);
                    const height = Math.abs(currentY - this.formStartPoint.y);
                    const left = Math.min(currentX, this.formStartPoint.x);
                    const top = Math.min(currentY, this.formStartPoint.y);

                    // Min size constraint
                    if (width < 5 || height < 5) return;


                    if (this.currentFormTool === 'table') {
                        this.addTable(left, top, width, height);
                    } else {
                        this.addFormField(left, top, width, height, this.currentFormTool);
                    }

                }

                // Reset tool? Maybe keep it active for multiple fields.
                // this.setFormTool('none');

                // Attach to document to catch events anywhere (delegation)
                // But prevent conflict with other tools
                document.addEventListener('mousedown', handleMouseDown);
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            },

            addFormField: function (x, y, w, h, type) {
                // Salir de stamp mode si estaba activo
                if (this.isStampMode) this._exitStampMode();
                this.saveState();
                const doc = this.getDoc();
                if (!doc) return;

                const fieldName = type + '_' + Date.now();
                // Calcular el siguiente tabIndex disponible en la página
                const _existingFields = (doc.pages[doc.currentIndex].objects || [])
                    .filter(o => o.type === 'form-field');
                const _nextTab = _existingFields.length > 0
                    ? Math.max(..._existingFields.map(o => o.tabIndex || 0)) + 1
                    : 1;

                const newObj = {
                    id: 'field_' + Date.now(),
                    type: 'form-field',
                    fieldType: type,
                    fieldName: fieldName,
                    x: x, y: y, width: w, height: h,
                    rotation: 0,
                    backgroundColor: null,
                    noBg: true,
                    borderColor: null,
                    borderWidth: 0,
                    borderStyle: 'none',
                    tabIndex: _nextTab
                };

                // Checkbox/Radio: auto-group con max1 si ya hay campos del mismo tipo en la página
                if (type === 'checkbox' || type === 'radio') {
                    const sameTypeFields = _existingFields.filter(o => o.fieldType === type);
                    if (sameTypeFields.length > 0) {
                        // Find existing group name or create one
                        const existingGroup = sameTypeFields.find(o => o.groupName)?.groupName || (type + '_group_1');
                        newObj.groupName = existingGroup;
                        newObj.groupRule = 'max1';
                        // Ensure group exists in doc
                        const doc2 = this.getDoc();
                        if (doc2) {
                            if (!doc2.groups) doc2.groups = {};
                            if (!doc2.groups[type]) doc2.groups[type] = [];
                            if (!doc2.groups[type].includes(existingGroup)) doc2.groups[type].push(existingGroup);
                        }
                        // Also set first field to same group if not already
                        sameTypeFields.forEach(o => {
                            if (!o.groupName) { o.groupName = existingGroup; o.groupRule = 'max1'; }
                        });
                    }
                }

                if (type === 'calendar') {
                    const d = new Date();
                    newObj.calendarState = {
                        month: d.getMonth(),
                        year: d.getFullYear(),
                        selectedDays: [],
                        style: 'circle',
                        format: 'MM/YYYY',
                        align: 'center',
                        headerColor: '#f0f0f0',
                        selectColor: '#ff0000',
                        bgColor: '#ffffff'
                    };
                }

                doc.pages[doc.currentIndex].objects.push(newObj);
                this.selectedObj = newObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(newObj.id);
                this.renderOverlays();
                this.renderSidebar();
                this.showToast('Campo agregado: ' + type);
            },

            addTable: function (x, y, w, h) {
                // Store coordinates temporarily
                this.tempTableCoords = { x, y, w, h };

                // Show Modal
                document.getElementById('table-props-modal').style.display = 'flex';
            },

            confirmAddTable: function () {
                const doc = this.getDoc();
                if (!doc || !this.tempTableCoords) return;

                this.saveState();
                const coords = this.tempTableCoords;

                // Read props
                const rows = parseInt(document.getElementById('tbl-prop-rows').value) || 3;
                const cols = parseInt(document.getElementById('tbl-prop-cols').value) || 3;
                const borderColor = document.getElementById('tbl-prop-border-color').value;
                const borderWidth = parseFloat(document.getElementById('tbl-prop-border-width').value) || 0;
                const bgColor = document.getElementById('tbl-prop-bg-color').value;
                const isTransparent = document.getElementById('tbl-prop-transparent').checked;
                const textAlign = document.getElementById('tbl-prop-align').value;
                const fontSize = parseInt(document.getElementById('tbl-prop-font-size').value) || 12;
                const textColor = document.getElementById('tbl-prop-text-color').value || '#000000';
                const autoSize = document.getElementById('tbl-prop-autosize').checked;

                // Ensure minimum sizes
                let w = coords.w;
                let h = coords.h;
                if (w < 100) w = 150;
                if (h < 60) h = 90;

                // Adjust default height if many rows
                if (h / rows < 20) h = rows * 20;

                const rowHeight = h / rows;
                const colWidth = w / cols;

                const tableObj = {
                    id: 'table_' + Date.now(),
                    type: 'table',
                    x: coords.x, y: coords.y, width: w, height: h,
                    rows: rows,
                    cols: cols,
                    rowHeights: Array(rows).fill(rowHeight),
                    colWidths: Array(cols).fill(colWidth),
                    data: Array(rows).fill(0).map(() => Array(cols).fill('')),
                    cellStyles: Array(rows).fill(0).map(() => Array(cols).fill(null)), // {bgColor, textColor}
                    rotation: 0,
                    borderColor: borderColor,
                    borderWidth: borderWidth,
                    backgroundColor: isTransparent ? 'transparent' : bgColor,
                    fontFamily: 'Arial',
                    fontSize: fontSize,
                    textColor: textColor,
                    align: 'left',
                    textAlign: textAlign,
                    autoSize: autoSize
                };

                doc.pages[doc.currentIndex].objects.push(tableObj);
                this.selectedObj = tableObj;
                this.multiObjectSelection.clear();
                this.multiObjectSelection.add(tableObj.id);
                this.renderOverlays();
                this.renderSidebar();

                // Close modal and reset to insert mode
                const _tblModal = document.getElementById('table-props-modal');
                _tblModal.style.display = 'none';
                _tblModal.dataset.mode = 'insert';
                const _tblTitle = _tblModal.querySelector('h3');
                if (_tblTitle) _tblTitle.textContent = 'Insertar Tabla';
                const _tblBtn = document.getElementById('tbl-confirm-btn');
                if (_tblBtn) { _tblBtn.textContent = 'Insertar'; _tblBtn.onclick = () => app.confirmAddTable(); }
                const _ins = document.getElementById('tbl-insert-section');
                const _edt = document.getElementById('tbl-edit-section');
                if (_ins) _ins.style.display = 'block';
                if (_edt) _edt.style.display = 'none';
                this.tempTableCoords = null;
                this.showToast('Tabla agregada');
            },

            startInternalResize: function (e, obj, type, index) {
                e.preventDefault(); e.stopPropagation();
                const panelId = this.splitView.activePanel;
                const panelState = this.splitView[panelId];
                const scale = panelState?.scale || this.currentScale;

                const startX = e.clientX;
                const startY = e.clientY;

                const startSizes = type === 'col' ? [...obj.colWidths] : [...obj.rowHeights];

                const move = (ev) => {
                    ev.preventDefault(); e.stopPropagation();
                    const dx = (ev.clientX - startX) / scale;
                    const dy = (ev.clientY - startY) / scale;

                    if (type === 'col') {
                        // Resizing column 'index'
                        // We affect index and index+1 to keep total width constant (if possible)
                        // But if index+1 gets too small, we stop.

                        const currentW = startSizes[index];
                        const nextW = startSizes[index + 1];

                        // Min col width: 10 units
                        const maxDeltaNeg = -(currentW - 10); // max we can shrink current
                        const maxDeltaPos = (nextW - 10);     // max we can grow current (shrink next)

                        const constrainedDx = Math.min(Math.max(dx, maxDeltaNeg), maxDeltaPos);

                        obj.colWidths[index] = startSizes[index] + constrainedDx;
                        obj.colWidths[index + 1] = startSizes[index + 1] - constrainedDx;

                    } else {
                        // Row resizing
                        const currentH = startSizes[index];
                        const nextH = startSizes[index + 1] !== undefined ? startSizes[index + 1] : null;

                        const MIN_ROW = 6;
                        const maxDeltaNeg = -(currentH - MIN_ROW);
                        const maxDeltaPos = nextH !== null ? (nextH - MIN_ROW) : Infinity;

                        const constrainedDy = Math.min(Math.max(dy, maxDeltaNeg), maxDeltaPos);

                        obj.rowHeights[index] = startSizes[index] + constrainedDy;
                        if (nextH !== null) {
                            obj.rowHeights[index + 1] = startSizes[index + 1] - constrainedDy;
                        } else {
                            // Last row: grow table total height
                            obj.height = (obj.height || 0) + constrainedDy;
                        }
                    }

                    // Update DOM immediately for smoothness
                    // Find the table element
                    // We need to re-render overlays? Or just update styles?
                    // Re-rendering is safest but maybe slow. Let's try re-rendering.
                    this.renderOverlays(); // Optimize later if needed
                };

                const up = (ev) => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                    this.saveState();
                    this.renderOverlays();
                };

                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
            },

            editTableCell: function (tableObj, r, c) {
                // Initialize cellStyles if missing (for legacy tables)
                if (!tableObj.cellStyles) {
                    tableObj.cellStyles = Array(tableObj.rows).fill(0).map(() => Array(tableObj.cols).fill(null));
                }

                // Store reference for modal
                this.editingCell = { tableObj, r, c };

                // Get current values
                const currentText = tableObj.data[r][c] || '';
                const currentStyle = tableObj.cellStyles[r][c] || {};

                // Populate modal fields - Text
                document.getElementById('cell-text').value = currentText;
                document.getElementById('cell-modal-title').innerText = `Celda (${r + 1}, ${c + 1})`;

                // Font family
                const fontFamily = currentStyle.fontFamily || tableObj.fontFamily || 'Arial';
                document.getElementById('cell-font-family').value = fontFamily;

                // Font size
                const fontSize = currentStyle.fontSize || tableObj.fontSize || 12;
                document.getElementById('cell-font-size').value = fontSize;

                // Text color
                const textColor = currentStyle.textColor || tableObj.textColor || '#000000';
                document.getElementById('cell-text-color').value = textColor;
                document.getElementById('cell-text-color-hex').innerText = textColor;

                // Bold & Italic
                document.getElementById('cell-bold').checked = currentStyle.bold || false;
                document.getElementById('cell-italic').checked = currentStyle.italic || false;

                // Background color
                const bgColor = currentStyle.bgColor || '#ffffff';
                const hasColor = !!currentStyle.bgColor;
                document.getElementById('cell-bg-color').value = bgColor;
                document.getElementById('cell-bg-color-hex').innerText = bgColor;
                document.getElementById('cell-no-bg').checked = !hasColor;

                // Alignment
                const alignH = currentStyle.alignH || tableObj.textAlign || 'left';
                const alignV = currentStyle.alignV || 'top';
                document.getElementById('cell-align-h').value = alignH;
                document.getElementById('cell-align-v').value = alignV;

                // Setup color change listeners for hex display
                document.getElementById('cell-text-color').onchange = function () {
                    document.getElementById('cell-text-color-hex').innerText = this.value;
                };
                document.getElementById('cell-bg-color').onchange = function () {
                    document.getElementById('cell-bg-color-hex').innerText = this.value;
                };

                // Show modal
                document.getElementById('table-cell-modal').style.display = 'flex';
            },

            applyCellProperties: function () {
                if (!this.editingCell) return;
                const { tableObj, r, c } = this.editingCell;

                this.saveState();

                // Get values from modal
                const text = document.getElementById('cell-text').value;
                const fontFamily = document.getElementById('cell-font-family').value;
                const fontSize = parseInt(document.getElementById('cell-font-size').value) || 12;
                const textColor = document.getElementById('cell-text-color').value;
                const bold = document.getElementById('cell-bold').checked;
                const italic = document.getElementById('cell-italic').checked;
                const alignH = document.getElementById('cell-align-h').value;
                const alignV = document.getElementById('cell-align-v').value;
                const bgColor = document.getElementById('cell-bg-color').value;
                const noBg = document.getElementById('cell-no-bg').checked;

                // Update data
                tableObj.data[r][c] = text;

                // Update cell style with all properties
                if (!tableObj.cellStyles[r]) tableObj.cellStyles[r] = [];
                tableObj.cellStyles[r][c] = {
                    fontFamily: fontFamily,
                    fontSize: fontSize,
                    textColor: textColor,
                    bold: bold,
                    italic: italic,
                    alignH: alignH,
                    alignV: alignV,
                    bgColor: noBg ? null : bgColor
                };

                // Close modal and re-render
                document.getElementById('table-cell-modal').style.display = 'none';
                this.editingCell = null;
                this.renderOverlays();
                this.showToast('Celda actualizada');
            },

            // ===================== RIBBON COLLAPSE FUNCTIONS =====================
            isFormMode: true, // Form fields enabled by default
            annotationValues: {},
            storeAnnotationValue: function (panelId, annotationId, value, pageData = null, annotation = null) {
                if (!this.annotationValues[panelId]) {
                    this.annotationValues[panelId] = {};
                }
                this.annotationValues[panelId][annotationId] = value;

                if (!pageData || !annotation || !annotation.fieldName) return;
                const fieldType = annotation.fieldType || '';
                let kind = 'text';
                let storedValue = value;

                if (fieldType === 'Btn') {
                    if (annotation.radioButton) {
                        if (!value) return;
                        kind = 'radio';
                        storedValue = annotation.buttonValue || annotation.exportValue || '';
                    } else if (annotation.checkBox) {
                        kind = 'checkbox';
                        storedValue = !!value;
                    } else {
                        return;
                    }
                } else if (fieldType === 'Ch') {
                    kind = 'choice';
                }

                if (!pageData.nativeFormValues) pageData.nativeFormValues = {};
                pageData.nativeFormValues[annotation.fieldName] = { kind, value: storedValue };
                if (this.markDocumentChanged && this.activeDocId) this.markDocumentChanged(this.activeDocId, 'native-field-input');
            },

            syncNativeFormValuesToOverlays: function (pageData) {
                const values = pageData?.nativeFormValues || {};
                for (const field of (pageData?.objects || []).filter(object => object.fromFormField)) {
                    const fieldName = field.nativeFieldName || field.fieldName;
                    if (!fieldName || !Object.prototype.hasOwnProperty.call(values, fieldName)) continue;
                    const entry = values[fieldName];
                    const storedValue = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')
                        ? entry.value
                        : entry;

                    if (field.fieldType === 'checkbox') {
                        field.checked = !!storedValue;
                    } else if (field.fieldType === 'radio') {
                        const optionValue = field.value || field.exportValue || '';
                        field.selected = storedValue === optionValue;
                        field.checked = field.selected;
                    } else if (field.fieldType === 'dropdown') {
                        field.selectedValue = storedValue ?? '';
                        field.value = storedValue ?? '';
                    } else {
                        field.textValue = storedValue ?? '';
                        field.value = storedValue ?? '';
                    }
                }
            },

            /**
             * Converts PDF form fields to editable objects
             */
            convertFormFieldsToObjects: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) {
                    this.showToast('No hay documento abierto');
                    return;
                }

                const idx = doc.currentIndex;
                const pData = doc.pages[idx];
                const src = doc.sources[pData.sourceId];

                try {
                    if (!src.doc) {
                        src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                    }
                    const page = await src.doc.getPage(pData.pageIndex + 1);
                    const annotations = await page.getAnnotations({ intent: 'display' });

                    if (!annotations || annotations.length === 0) {
                        this.showToast('No se encontraron campos de formulario en esta página');
                        return;
                    }

                    const activePanel = this.splitView.activePanel;
                    const elements = this.getPanelElements(activePanel);
                    const panelState = this.splitView[activePanel];
                    const scale = panelState?.scale || this.currentScale;
                    const rot = (page.rotate + pData.rotation) % 360;
                    const vp = page.getViewport({ scale: scale, rotation: rot });

                    let converted = 0;
                    const formFields = annotations.filter(a => a.subtype === 'Widget');
                    const widgetIndexByName = new Map();

                    formFields.forEach(annotation => {
                        const rect = annotation.rect;
                        if (!rect || rect.length < 4) return;

                        // Convert PDF coordinates to UNSCALED canvas coordinates
                        // (renderOverlays will apply scale when displaying)
                        const left = rect[0];
                        const bottom = rect[1];
                        const right = rect[2];
                        const top = rect[3];
                        const width = right - left;
                        const height = top - bottom;
                        // vp.height is scaled, so divide by scale to get unscaled page height
                        const yPos = (vp.height / scale) - top;

                        const nativeFieldName = annotation.fieldName || '';
                        const nativeWidgetIndex = widgetIndexByName.get(nativeFieldName) || 0;
                        widgetIndexByName.set(nativeFieldName, nativeWidgetIndex + 1);
                        const nativeAnnotationId = String(annotation.id || '');
                        if (this._isNativeFieldSuppressed(pData, nativeFieldName, nativeWidgetIndex, nativeAnnotationId)) return;
                        const exists = pData.objects.some(o => o.fromFormField && (
                            (nativeAnnotationId && o.nativeAnnotationId === nativeAnnotationId) ||
                            (o.nativeFieldName === nativeFieldName && o.nativeWidgetIndex === nativeWidgetIndex)
                        ));
                        if (exists) return;

                        // Create object based on field type
                        let obj = null;
                        const fieldType = annotation.fieldType;
                        const appearanceFontSize = Number(annotation.defaultAppearanceData?.fontSize);
                        const fontSizeFits = Number.isFinite(appearanceFontSize) && appearanceFontSize > 0 && appearanceFontSize < height * 0.9;
                        const fontSize = fontSizeFits ? appearanceFontSize : 0;
                        const common = {
                            id: 'obj-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                            type: 'form-field',
                            fromFormField: true,
                            isNative: true,
                            nativeFieldName,
                            nativeAnnotationId,
                            nativeWidgetIndex,
                            fieldName: nativeFieldName,
                            x: left,
                            y: yPos,
                            width,
                            height,
                            readOnly: !!annotation.readOnly,
                            required: !!annotation.required,
                            rotation: 0
                        };

                        if (fieldType === 'Tx') {
                            obj = {
                                ...common,
                                fieldType: 'text',
                                textValue: annotation.fieldValue || '',
                                value: annotation.fieldValue || '',
                                fontSize,
                                autoSize: fontSize <= 0,
                                font: annotation.defaultAppearanceData?.fontFamily || 'Helvetica',
                                textColor: annotation.defaultAppearanceData?.fontColor || '#000000',
                                textAlign: ['left', 'center', 'right'][annotation.textAlignment || 0] || 'left',
                                multiline: !!annotation.multiLine
                            };
                        } else if (fieldType === 'Btn') {
                            const mappedType = annotation.checkBox ? 'checkbox' : (annotation.radioButton ? 'radio' : 'button');
                            obj = {
                                ...common,
                                fieldType: mappedType,
                                subtype: mappedType,
                                checked: annotation.checkBox && annotation.fieldValue === annotation.exportValue,
                                selected: annotation.radioButton && annotation.fieldValue === annotation.buttonValue,
                                value: annotation.buttonValue || '',
                                exportValue: annotation.exportValue || annotation.buttonValue || 'Yes'
                            };
                        } else if (fieldType === 'Ch') {
                            const options = (annotation.options || []).map(option =>
                                typeof option === 'string' ? option : (option.exportValue || option.displayValue || '')
                            ).filter(Boolean);
                            obj = {
                                ...common,
                                fieldType: 'dropdown',
                                subtype: 'select',
                                options,
                                selectedValue: annotation.fieldValue || '',
                                value: annotation.fieldValue || '',
                                fontSize,
                                autoSize: fontSize <= 0
                            };
                        }

                        if (obj) {
                            pData.objects.push(obj);
                            converted++;
                        }
                    });

                    if (converted > 0) {
                        pData.nativeFieldOverlaysDetected = true;

                        // AGGRESSIVELY hide all annotation layer form elements
                        // The PDF.js annotation layer creates input/select elements we need to hide
                        const mainView = document.getElementById(activePanel === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary');
                        if (mainView) {
                            // Hide any element with annotationLayer class
                            mainView.querySelectorAll('.annotationLayer, .annotation-layer, [class*="annotation"]').forEach(el => {
                                el.style.visibility = 'hidden';
                                el.style.pointerEvents = 'none';
                                el.style.display = 'none';
                            });
                            // Also hide any orphan form inputs that have no ID (PDF.js creates these)
                            mainView.querySelectorAll('input:not([id]), select:not([id]), textarea:not([id])').forEach(el => {
                                // Only hide if parent doesn't have an obj- id (not our overlay)
                                if (!el.closest('[id^="obj-"]')) {
                                    el.style.visibility = 'hidden';
                                    el.style.pointerEvents = 'none';
                                }
                            });
                        }
                        // Also hide using elements reference
                        if (elements.annotationLayer) {
                            elements.annotationLayer.style.display = 'none';
                            elements.annotationLayer.style.visibility = 'hidden';
                            elements.annotationLayer.style.pointerEvents = 'none';
                        }

                        // Re-render overlays to show new objects
                        this.renderOverlays(activePanel);
                        this.setupInteractDraggables();
                        this.saveState();

                        this.showToast(`${converted} campo(s) convertido(s) a objetos editables`);
                    } else {
                        this.showToast('No se pudieron convertir campos');
                    }

                } catch (e) {
                    console.error('Error converting form fields:', e);
                    this.showToast('Error al convertir campos: ' + e.message);
                }
            },

            /** Toggles structural editing for native form fields without replacing their AcroForm objects. */
            toggleFormFieldEdit: async function () {
                const doc = this.getDoc();
                if (!doc || !doc.pages.length) {
                    this.showToast('No hay documento abierto');
                    const sw = document.getElementById('switch-edit-fields');
                    if (sw) sw.checked = false;
                    return;
                }

                const idx = doc.currentIndex;
                const pData = doc.pages[idx];
                const activePanel = this.splitView.activePanel;
                const elements = this.getPanelElements(activePanel);
                const sw = document.getElementById('switch-edit-fields');
                const isEditModeOn = sw ? sw.checked : false;

                const src = doc.sources[pData.sourceId];

                if (isEditModeOn) {
                    if (pData.fieldsConverted && src?.originalBuffer) {
                        src.buffer = src.originalBuffer;
                        src.doc = null;
                        delete pData.fieldsConverted;
                    }
                    if (!pData.nativeFieldOverlaysDetected) {
                        await this.convertFormFieldsToObjects();
                    }
                    this.syncNativeFormValuesToOverlays(pData);
                    const nativeOverlays = (pData.objects || []).filter(o => o.fromFormField);
                    if (nativeOverlays.length === 0) {
                        if (sw) sw.checked = false;
                        this.isFieldEditMode = false;
                        return;
                    }

                    const interactSwitch = document.getElementById('switch-interact-fields');
                    if (interactSwitch) interactSwitch.checked = false;
                    this.isFieldInteractMode = false;

                    if (elements.annotationLayer) {
                        elements.annotationLayer.style.display = 'none';
                        elements.annotationLayer.style.visibility = 'hidden';
                        elements.annotationLayer.style.pointerEvents = 'none';
                    }
                    const mainView = document.getElementById(activePanel === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary');
                    if (mainView) {
                        mainView.querySelectorAll('.annotationLayer, .annotation-layer, [class*="annotation"]').forEach(el => {
                            el.style.visibility = 'hidden';
                            el.style.pointerEvents = 'none';
                            el.style.display = 'none';
                        });
                    }

                    this.isFieldEditMode = true;
                    if (typeof this._setupBoxSelectDrag === 'function') this._setupBoxSelectDrag();
                    this.renderOverlays(activePanel);
                    this.setupInteractDraggables();
                    this.showToast(`Modo edición activado: ${nativeOverlays.length} campos`);

                } else {
                    this.isFieldEditMode = false;
                    if (typeof this.endFieldNudgeSession === 'function') this.endFieldNudgeSession();
                    if (!this.isBoxSelectMode && this._boxSelectCleanup) {
                        this._boxSelectCleanup();
                        this._boxSelectCleanup = null;
                    }
                    if (pData.fieldsConverted && src?.originalBuffer) {
                        src.buffer = src.originalBuffer;
                        src.doc = null;
                    }
                    delete pData.fieldsConverted;

                    pData.nativeFormValues = pData.nativeFormValues || {};
                    for (const field of (pData.objects || []).filter(o => o.fromFormField)) {
                        const fieldName = field.nativeFieldName || field.fieldName;
                        if (!fieldName) continue;
                        if (field.fieldType === 'checkbox') {
                            pData.nativeFormValues[fieldName] = { kind: 'checkbox', value: !!field.checked };
                        } else if (field.fieldType === 'radio') {
                            if (field.selected || field.checked) pData.nativeFormValues[fieldName] = { kind: 'radio', value: field.value || field.exportValue || '' };
                        } else if (field.fieldType === 'dropdown') {
                            pData.nativeFormValues[fieldName] = { kind: 'choice', value: field.selectedValue ?? field.value ?? '' };
                        } else {
                            pData.nativeFormValues[fieldName] = { kind: 'text', value: field.textValue ?? field.value ?? '' };
                        }
                    }

                    if (this.selectedObj?.fromFormField) this.selectedObj = null;
                    if (this.multiObjectSelection) {
                        for (const field of (pData.objects || []).filter(o => o.fromFormField)) this.multiObjectSelection.delete(field.id);
                    }

                    await this.loadPage(idx, activePanel);

                    if (elements.annotationLayer) {
                        elements.annotationLayer.style.display = 'block';
                        elements.annotationLayer.style.visibility = 'visible';
                        elements.annotationLayer.style.pointerEvents = 'none';
                    }
                    const mainView = document.getElementById(activePanel === 'secondary' ? 'mainViewSecondary' : 'mainViewPrimary');
                    if (mainView) {
                        mainView.querySelectorAll('.annotationLayer, .annotation-layer, [class*="annotation"]').forEach(el => {
                            el.style.visibility = 'visible';
                            el.style.pointerEvents = 'none';
                            el.style.display = 'block';
                        });
                    }

                    this.renderOverlays(activePanel);
                    this.setupInteractDraggables(); // Re-evaluar .locked después de desactivar
                    this.saveState();
                    this.showToast('Modo edición desactivado: campos nativos restaurados');
                }
            },

            toggleFieldsPanel: function () {
                const panel = document.getElementById('fields-panel-sidebar');
                if (!panel) return;
                const isVisible = panel.classList.contains('visible');
                // Close other panels
                ['bookmark-panel','index-panel-sidebar','attach-panel-sidebar','layers-panel-sidebar'].forEach(id => {
                    document.getElementById(id)?.classList.remove('visible');
                });
                if (!isVisible) {
                    panel.classList.add('visible');
                    // Open sidebar if hidden
                    const cont = document.getElementById('sidebarContainer');
                    if (cont?.classList.contains('hidden')) this.toggleSidebar();
                    this.refreshFieldsPanel();
                } else {
                    panel.classList.remove('visible');
                }
            },

            refreshFieldsPanel: function () {
                const listEl = document.getElementById('fields-list-sidebar');
                const emptyEl = document.getElementById('fields-empty-state-sb');
                if (!listEl) return;
                // Collect all form-field objects from all pages
                const allFields = [];
                const doc = this.getDoc ? this.getDoc() : null;
                ((doc && doc.pages) || []).forEach(function(page, pageIdx) {
                    (page.objects || []).forEach(function(obj) {
                        if (obj.type === 'form-field') {
                            allFields.push({ obj: obj, pageIdx: pageIdx });
                        }
                    });
                });
                listEl.querySelectorAll('.fields-row').forEach(function(r) { r.remove(); });
                if (!allFields.length) {
                    if (emptyEl) emptyEl.style.display = '';
                    return;
                }
                if (emptyEl) emptyEl.style.display = 'none';
                const typeIcons = {
                    text:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/></svg>',
                    checkbox:  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 12 11 14 15 10"/></svg>',
                    Btn:       '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 12 11 14 15 10"/></svg>',
                    radio:     '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
                    select:    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="8 10 12 14 16 10"/></svg>',
                    dropdown:  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="8 10 12 14 16 10"/></svg>',
                    Ch:        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="8 10 12 14 16 10"/></svg>',
                    signature: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17 Q6 10 9 17 Q12 24 15 17 Q18 10 21 17"/></svg>',
                    list:      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6" stroke-width="3"/><line x1="3" y1="12" x2="3.01" y2="12" stroke-width="3"/><line x1="3" y1="18" x2="3.01" y2="18" stroke-width="3"/></svg>',
                };
                const searchVal = (document.getElementById('fields-search-sb') ? document.getElementById('fields-search-sb').value : '').toLowerCase();
                const typeFilter = document.getElementById('fields-filter-type') ? document.getElementById('fields-filter-type').value : '';
                const self = this;
                allFields.forEach(function(item, idx) {
                    const f = item.obj;
                    const pageIdx = item.pageIdx;
                    const name = f.fieldName || f.name || ('Campo ' + (idx + 1));
                    const type = f.fieldType || f.subtype || 'text';
                    const pageNum = pageIdx + 1;
                    if (searchVal && name.toLowerCase().indexOf(searchVal) === -1) return;
                    if (typeFilter && type !== typeFilter) return;
                    const row = document.createElement('div');
                    row.className = 'fields-row';
                    row.dataset.idx = idx;
                    row.dataset.pageIdx = pageIdx;
                    row.dataset.fieldId = f.id;
                    row.innerHTML =
                        '<span class="fields-row-icon">' + (typeIcons[type] || typeIcons.text) + '</span>' +
                        '<span class="fields-row-name" title="' + name + '">' + name + '</span>' +
                        '<span class="fields-row-page">p.' + pageNum + '</span>';

                    // ── Selección en canvas ──────────────────────────────────
                    function selectRowInCanvas(e) {
                        if (e.ctrlKey || e.metaKey) {
                            row.classList.toggle('selected');
                        } else {
                            listEl.querySelectorAll('.fields-row').forEach(function(r) { r.classList.remove('selected'); });
                            row.classList.add('selected');
                        }
                        const doc = self.getDoc ? self.getDoc() : null;
                        if (doc && doc.currentIndex !== pageIdx) {
                            if (self.goToPage) self.goToPage(pageIdx);
                        }
                        self.multiObjectSelection = self.multiObjectSelection || new Set();
                        if (e.ctrlKey || e.metaKey) {
                            if (self.multiObjectSelection.has(f.id)) {
                                self.multiObjectSelection.delete(f.id);
                            } else {
                                self.multiObjectSelection.add(f.id);
                                self.selectedObj = f;
                            }
                        } else {
                            self.multiObjectSelection.clear();
                            self.multiObjectSelection.add(f.id);
                            self.selectedObj = f;
                        }
                        const isMulti = self.multiObjectSelection.size > 1;
                        document.querySelectorAll('.draggable.selected, .draggable.multi-selected').forEach(function(d) {
                            d.classList.remove('selected'); d.classList.remove('multi-selected');
                        });
                        document.querySelectorAll('.draggable').forEach(function(d) {
                            if (self.multiObjectSelection.has(d.id)) {
                                d.classList.add(isMulti ? 'multi-selected' : 'selected');
                            }
                        });
                        if (self.syncToolbar) self.syncToolbar();
                    }

                    row.addEventListener('click', function(e) {
                        if (e.target.tagName === 'INPUT') return;
                        selectRowInCanvas(e);
                    });

                    // ── Doble clic: renombrar inline ─────────────────────────
                    row.addEventListener('dblclick', function(e) {
                        if (e.target.tagName === 'INPUT') return;
                        e.preventDefault();
                        const nameSpan = row.querySelector('.fields-row-name');
                        if (!nameSpan) return;
                        const currentName = f.fieldName || f.name || '';
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.value = currentName;
                        input.style.cssText = 'width:100%;background:rgba(255,255,255,0.15);border:1px solid rgba(99,102,241,0.7);border-radius:4px;padding:1px 4px;font-size:9px;color:white;outline:none;font-family:inherit;';
                        nameSpan.replaceWith(input);
                        input.focus(); input.select();
                        function commitRename() {
                            const newName = input.value.trim() || currentName;
                            if (f.fieldName !== undefined) f.fieldName = newName;
                            if (f.name !== undefined) f.name = newName;
                            if (self.saveState) self.saveState();
                            self.refreshFieldsPanel();
                        }
                        input.addEventListener('blur', commitRename);
                        input.addEventListener('keydown', function(ev) {
                            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                            if (ev.key === 'Escape') { input.value = currentName; input.blur(); }
                        });
                    });

                    // ── Menú contextual propio ───────────────────────────────
                    row.addEventListener('contextmenu', function(e) {
                        e.preventDefault(); e.stopPropagation();
                        if (!row.classList.contains('selected')) {
                            listEl.querySelectorAll('.fields-row').forEach(function(r) { r.classList.remove('selected'); });
                            row.classList.add('selected');
                            selectRowInCanvas(e);
                        }
                        const menu = document.getElementById('context-menu');
                        const content = document.getElementById('ctx-dynamic-content');
                        if (!menu || !content) return;
                        content.innerHTML = '';

                        function addItem(icon, label, action, danger) {
                            const div = document.createElement('div');
                            div.className = 'ctx-item';
                            if (danger) div.style.color = '#ff7070';
                            div.innerHTML = '<span>' + icon + '</span> ' + label;
                            div.addEventListener('mousedown', function(ev) {
                                ev.preventDefault(); ev.stopPropagation();
                                menu.style.display = 'none';
                                action();
                            });
                            content.appendChild(div);
                        }
                        function addDivider() {
                            const d = document.createElement('div'); d.className = 'ctx-divider'; content.appendChild(d);
                        }

                        const hdr = document.createElement('div');
                        hdr.className = 'ctx-divider';
                        hdr.style.cssText = 'margin-top:0;color:#aaa;font-size:10px;';
                        hdr.innerText = (f.fieldName || f.name || 'Campo') + ' (' + (f.fieldType || f.subtype || 'text') + ')';
                        content.appendChild(hdr);

                        const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                        addItem('✏️', t('btn_rename', 'Renombrar'), function() {
                            const nameSpan2 = row.querySelector('.fields-row-name');
                            if (!nameSpan2) return;
                            const cur = f.fieldName || f.name || '';
                            const inp = document.createElement('input');
                            inp.type = 'text'; inp.value = cur;
                            inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.15);border:1px solid rgba(99,102,241,0.7);border-radius:4px;padding:1px 4px;font-size:9px;color:white;outline:none;font-family:inherit;';
                            nameSpan2.replaceWith(inp);
                            inp.focus(); inp.select();
                            function commitRename2() {
                                const newName2 = inp.value.trim() || cur;
                                if (f.fieldName !== undefined) f.fieldName = newName2;
                                if (f.name !== undefined) f.name = newName2;
                                if (self.saveState) self.saveState();
                                self.refreshFieldsPanel();
                            }
                            inp.addEventListener('blur', commitRename2);
                            inp.addEventListener('keydown', function(ev) {
                                if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
                                if (ev.key === 'Escape') { inp.value = cur; inp.blur(); }
                            });
                        });

                        addItem('⚙️', t('btn_properties', 'Propiedades'), function() {
                            self.selectedObj = f;
                            if (self.openProperties) self.openProperties(f);
                        });

                        addDivider();

                        addItem('📋', t('btn_duplicate', 'Duplicar'), function() {
                            self._changeSidebarFields('duplicate', [{ pageIdx, field: f }]);
                        });

                        addDivider();

                        addItem('⬆️', t('ctx_move_tab_prev', 'Mover antes en Tab'), function() {
                            const doc3 = self.getDoc ? self.getDoc() : null;
                            const page3 = doc3 && doc3.pages && doc3.pages[pageIdx];
                            if (!page3) return;
                            const objs = page3.objects;
                            const fi = objs.indexOf(f);
                            let prev = -1;
                            for (let k = fi - 1; k >= 0; k--) { if (objs[k].type === 'form-field') { prev = k; break; } }
                            if (prev !== -1) { objs.splice(fi, 1); objs.splice(prev, 0, f); }
                            if (self.renderOverlays) self.renderOverlays();
                            if (self.saveState) self.saveState();
                            self.refreshFieldsPanel();
                        });

                        addItem('⬇️', t('ctx_move_tab_next', 'Mover después en Tab'), function() {
                            const doc4 = self.getDoc ? self.getDoc() : null;
                            const page4 = doc4 && doc4.pages && doc4.pages[pageIdx];
                            if (!page4) return;
                            const objs4 = page4.objects;
                            const fi4 = objs4.indexOf(f);
                            let next = -1;
                            for (let k = fi4 + 1; k < objs4.length; k++) { if (objs4[k].type === 'form-field') { next = k; break; } }
                            if (next !== -1) { objs4.splice(fi4, 1); objs4.splice(next, 0, f); }
                            if (self.renderOverlays) self.renderOverlays();
                            if (self.saveState) self.saveState();
                            self.refreshFieldsPanel();
                        });

                        addDivider();

                        addItem('🗑️', t('btn_delete', 'Eliminar'), function() {
                            self._changeSidebarFields('delete', [{ pageIdx, field: f }]);
                        }, true);

                        menu.style.left = e.clientX + 'px';
                        menu.style.top  = e.clientY + 'px';
                        menu.style.display = 'flex';
                        requestAnimationFrame(function() {
                            const r = menu.getBoundingClientRect();
                            if (r.right  > window.innerWidth)  menu.style.left = (e.clientX - r.width)  + 'px';
                            if (r.bottom > window.innerHeight)  menu.style.top  = (e.clientY - r.height) + 'px';
                        });
                        const closeMenu = function() { menu.style.display = 'none'; document.removeEventListener('click', closeMenu); };
                        setTimeout(function() { document.addEventListener('click', closeMenu); }, 10);
                    });

                    listEl.appendChild(row);
                });
            },

            filterFieldsPanel: function (val) {
                this.refreshFieldsPanel();
            },

            deleteSelectedFields: function () {
                return this._changeSidebarFields('delete');
            },

            duplicateSelectedFields: function () {
                return this._changeSidebarFields('duplicate');
            },

            _changeSidebarFields: async function (action, targets) {
                const doc = this.getDoc();
                if (!doc) return;
                const listEl = document.getElementById('fields-list-sidebar');
                targets ||= Array.from(listEl?.querySelectorAll('.fields-row.selected') || []).map(row => ({
                    pageIdx: Number(row.dataset.pageIdx),
                    field: doc.pages[Number(row.dataset.pageIdx)]?.objects.find(field => field.id === row.dataset.fieldId)
                }));
                let changed = false;
                for (const { pageIdx, field } of targets) {
                    const page = doc.pages[pageIdx];
                    if (!field || !page?.objects.includes(field)) continue;
                    if (action === 'delete') {
                        const nativeName = field.nativeFieldName || field.fieldName;
                        if (field.fromFormField && nativeName) {
                            page.deletedNativeFields ||= [];
                            if (!page.deletedNativeFields.includes(nativeName)) page.deletedNativeFields.push(nativeName);
                            if (page.nativeFormValues) delete page.nativeFormValues[nativeName];
                        }
                        page.objects.splice(page.objects.indexOf(field), 1);
                        this.multiObjectSelection?.delete(field.id);
                        if (this.selectedObj === field) this.selectedObj = null;
                    } else {
                        const clone = JSON.parse(JSON.stringify(field));
                        const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                        clone.id = 'field_' + suffix;
                        clone.fieldName = (field.fieldName || field.name || 'Campo') + '_copia_' + suffix;
                        clone.name = clone.fieldName;
                        clone.fromFormField = false;
                        delete clone.nativeFieldName;
                        delete clone.nativeAnnotationId;
                        delete clone.nativeWidgetIndex;
                        clone.x = (clone.x || 0) + 10;
                        clone.y = (clone.y || 0) + 10;
                        page.objects.push(clone);
                    }
                    changed = true;
                }
                if (!changed) return;
                this.saveState(doc.id);
                if (this.loadPage) await this.loadPage(doc.currentIndex);
                else this.renderOverlays?.();
                this.refreshFieldsPanel();
            },

});
