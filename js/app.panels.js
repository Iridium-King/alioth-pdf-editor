// app.panels.js
// Extiende el objeto global `app` con métodos de panels
// Compatible con ESM futuro: cada función también se exporta individualmente

if (!window.app) window.app = {};
const app = window.app;


Object.assign(app, {
            indexEntries: [], // Array de {id, title, page, level, type: 'auto'|'manual'}
            indexPanelOpen: false,
            currentActiveIndexEntry: null,

            // SPLIT VIEW STATE
            toggleIndexPanel: function () {
                const sidebarPanel = document.getElementById('index-panel-sidebar');
                const oldPanel = document.getElementById('index-panel');
                // Cerrar panel de marcadores si está abierto
                if (BookmarkManager && BookmarkManager._panelOpen) {
                    BookmarkManager._panelOpen = false;
                    const bmPanel = document.getElementById('bookmark-panel');
                    if (bmPanel) bmPanel.classList.remove('visible');
                }
                // Cerrar panel de adjuntos si está abierto
                if (this._attachPanelOpen) {
                    this._attachPanelOpen = false;
                    const apPanel = document.getElementById('attach-panel-sidebar');
                    if (apPanel) apPanel.classList.remove('visible');
                }
                // Cerrar panel de campos si está abierto
                const fpanel = document.getElementById('fields-panel-sidebar');
                if (fpanel) fpanel.classList.remove('visible');
                // Cerrar panel de capas si está abierto
                if (this._layersPanelOpen) {
                    this._layersPanelOpen = false;
                    const lpPanel = document.getElementById('layers-panel-sidebar');
                    if (lpPanel) lpPanel.classList.remove('visible');
                }
                // Si la sidebar está oculta, mostrarla antes de abrir el panel
                const sb = document.getElementById('sidebar');
                if (sb && sb.classList.contains('hidden')) {
                    this.toggleSidebar();
                }
                this.indexPanelOpen = !this.indexPanelOpen;

                if (this.indexPanelOpen) {
                    if (sidebarPanel) sidebarPanel.classList.add('visible');
                    if (oldPanel) oldPanel.classList.remove('visible');
                    this.updateIndexCount();

                    // Sincronizar desde doc persistido si indexEntries está vacío
                    const doc = this.getDoc();
                    if (this.indexEntries.length === 0 && doc && doc.indexEntries && doc.indexEntries.length > 0) {
                        this.indexEntries = doc.indexEntries;
                    }

                    // Auto-detectar si el índice está vacío (primera vez que se abre)
                    if (this.indexEntries.length === 0) {
                        this.showIndexEmptyState(true);
                        // Detectar automáticamente sin avisos
                        setTimeout(() => {
                            this.detectIndexTitles(true); // true = modo silencioso
                        }, 300);
                    } else {
                        this.renderIndexEntries();
                    }
                } else {
                    if (sidebarPanel) sidebarPanel.classList.remove('visible');
                    if (oldPanel) oldPanel.classList.remove('visible');
                }
            },

            showIndexEmptyState: function (show) {
                const emptyState = document.getElementById('index-empty-state');
                const content = document.getElementById('index-content');
                const emptyStateSb = document.getElementById('index-empty-state-sb');
                const contentSb = document.getElementById('index-content-sidebar');

                if (show) {
                    if (emptyState) emptyState.style.display = 'block';
                    if (emptyStateSb) emptyStateSb.style.display = 'block';
                    if (content) { const entries = content.querySelectorAll('.index-entry'); entries.forEach(e => e.remove()); }
                    if (contentSb) { const entries = contentSb.querySelectorAll('.index-entry'); entries.forEach(e => e.remove()); }
                } else {
                    if (emptyState) emptyState.style.display = 'none';
                    if (emptyStateSb) emptyStateSb.style.display = 'none';
                }
            },

            renderIndexEntries: function (filteredEntries = null) {
                const content = document.getElementById('index-content');
                const contentSb = document.getElementById('index-content-sidebar');
                const entries = filteredEntries || this.indexEntries;

                // Limpiar entradas anteriores (excepto empty state)
                if (content) { const oldEntries = content.querySelectorAll('.index-entry'); oldEntries.forEach(e => e.remove()); }
                if (contentSb) { const oldEntries = contentSb.querySelectorAll('.index-entry'); oldEntries.forEach(e => e.remove()); }

                if (entries.length === 0) {
                    this.showIndexEmptyState(true);
                    return;
                }

                this.showIndexEmptyState(false);

                const buildEntry = (entry, container) => {
                    const entryDiv = document.createElement('div');
                    entryDiv.className = `index-entry level-${entry.level}`;
                    entryDiv.dataset.entryId = entry.id;
                    entryDiv.dataset.page = entry.page;
                    entryDiv.title = entry.title;

                    const doc = this.getDoc();
                    if (doc && doc.currentIndex === (entry.page - 1)) {
                        entryDiv.classList.add('active');
                    }

                    // Toggle para nivel 1 (colapsar/expandir hijos)
                    if (entry.level === 1) {
                        const toggleBtn = document.createElement('span');
                        toggleBtn.className = 'idx-toggle';
                        toggleBtn.textContent = '▾';
                        toggleBtn.title = 'Expandir/Contraer';
                        toggleBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const isCollapsed = entryDiv.classList.toggle('collapsed');
                            // Ocultar/mostrar entradas de nivel 2 y 3 hasta el próximo nivel-1
                            let sibling = entryDiv.nextElementSibling;
                            while (sibling && !sibling.classList.contains('level-1')) {
                                sibling.classList.toggle('child-hidden', isCollapsed);
                                sibling = sibling.nextElementSibling;
                            }
                        });
                        entryDiv.appendChild(toggleBtn);
                    }

                    const textSpan = document.createElement('span');
                    textSpan.className = 'index-entry-text';
                    textSpan.textContent = entry.title;
                    textSpan.title = entry.title;
                    textSpan.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        this.editIndexEntry(entry.id);
                    });

                    const pageSpan = document.createElement('span');
                    pageSpan.className = 'index-entry-page';
                    pageSpan.textContent = `p.${entry.page}`;

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'index-entry-delete';
                    deleteBtn.innerHTML = '✕';
                    deleteBtn.title = 'Eliminar entrada';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.deleteIndexEntry(entry.id);
                    };

                    entryDiv.appendChild(textSpan);
                    entryDiv.appendChild(pageSpan);
                    entryDiv.appendChild(deleteBtn);

                    entryDiv.addEventListener('click', () => {
                        this.goToPage(entry.page - 1);
                        this.highlightActiveIndexEntry(entry.page);
                    });

                    // Menú contextual con Renombrar, Cambiar nivel, Eliminar
                    entryDiv.addEventListener('contextmenu', (e) => {
                        const t = (k, fb) => (window.i18n ? window.i18n.t(k, fb) : fb);
                        e.preventDefault();
                        e.stopPropagation();
                        // Eliminar cualquier menú previo
                        const prev = document.getElementById('_idx-ctx-menu');
                        if (prev) prev.remove();

                        const menu = document.createElement('div');
                        menu.id = '_idx-ctx-menu';
                        menu.style.cssText = `position:fixed;z-index:99999;background:rgba(14,14,18,0.72);border:1px solid rgba(102,126,234,0.35);border-radius:9px;padding:4px 0;min-width:160px;box-shadow:0 8px 32px rgba(0,0,0,0.7);font-size:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);`;
                        menu.style.left = e.clientX + 'px';
                        menu.style.top  = e.clientY + 'px';

                        const items = [
                            { label: '✏️ ' + t('btn_rename', 'Renombrar'), action: () => this.editIndexEntry(entry.id) },
                            { label: '📄 ' + t('ctx_change_page', 'Cambiar página'), action: () => {
                                const doc = this.getDoc();
                                const np = prompt('Nueva página:', entry.page);
                                const n = parseInt(np);
                                if (!isNaN(n) && n >= 1 && (!doc || n <= doc.pages.length)) {
                                    entry.page = n;
                                    this.indexEntries.sort((a,b) => a.page - b.page);
                                    this.renderIndexEntries();
                                    this._persistIndexEntries();
                                }
                            }},
                            { label: '⬆️ Nivel 1 (Título)', action: () => { entry.level = 1; this.renderIndexEntries(); this._persistIndexEntries(); } },
                            { label: '⬇️ Nivel 2 (Subtítulo)', action: () => { entry.level = 2; this.renderIndexEntries(); this._persistIndexEntries(); } },
                            { label: '↘️ Nivel 3 (Sección)', action: () => { entry.level = 3; this.renderIndexEntries(); this._persistIndexEntries(); } },
                            { label: '🗑️ ' + t('btn_delete', 'Eliminar'), action: () => this.deleteIndexEntry(entry.id), danger: true },
                        ];

                        items.forEach(item => {
                            const div = document.createElement('div');
                            div.textContent = item.label;
                            div.style.cssText = `padding:7px 14px;cursor:pointer;color:${item.danger ? '#ff6b6b' : '#e0e0e0'};white-space:nowrap;`;
                            div.onmouseenter = () => div.style.background = 'rgba(102,126,234,0.2)';
                            div.onmouseleave = () => div.style.background = '';
                            div.onclick = () => { menu.remove(); item.action(); };
                            menu.appendChild(div);
                        });

                        document.body.appendChild(menu);
                        window.positionFloatingMenu?.(menu, { x: e.clientX, y: e.clientY });

                        const close = () => { menu.remove(); document.removeEventListener('click', close); };
                        setTimeout(() => document.addEventListener('click', close), 10);
                    });

                    container.appendChild(entryDiv);
                };

                entries.forEach(entry => {
                    if (content) buildEntry(entry, content);
                    if (contentSb) buildEntry(entry, contentSb);
                });
            },

            highlightActiveIndexEntry: function (page) {
                const entries = document.querySelectorAll('.index-entry');
                entries.forEach(entry => {
                    if (parseInt(entry.dataset.page) === page) {
                        entry.classList.add('active');
                        // Auto-scroll al elemento activo
                        entry.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else {
                        entry.classList.remove('active');
                    }
                });
            },

            addIndexEntryManual: function () {
                const doc = this.getDoc();
                if (!doc) {
                    alert('No hay documento abierto');
                    return;
                }

                const title = prompt('Título de la entrada:');
                if (!title) return;

                const page = prompt(`Número de página (1-${doc.pages.length}):`, (doc.currentIndex + 1).toString());
                if (!page) return;

                const pageNum = parseInt(page);
                if (isNaN(pageNum) || pageNum < 1 || pageNum > doc.pages.length) {
                    alert('Número de página inválido');
                    return;
                }

                const levelStr = prompt('Nivel del título (1=Principal, 2=Subtítulo, 3=Sección):', '1');
                const level = parseInt(levelStr) || 1;

                const newEntry = {
                    id: `manual-${Date.now()}`,
                    title: title,
                    page: pageNum,
                    level: Math.min(Math.max(level, 1), 3),
                    type: 'manual'
                };

                this.indexEntries.push(newEntry);
                this.indexEntries.sort((a, b) => a.page - b.page);

                this.renderIndexEntries();
                this.updateIndexCount();
                this._persistIndexEntries();
            },

            editIndexEntry: function (entryId) {
                const entry = this.indexEntries.find(e => e.id === entryId);
                if (!entry) return;

                const newTitle = prompt('Editar título:', entry.title);
                if (newTitle && newTitle !== entry.title) {
                    entry.title = newTitle;
                    this.renderIndexEntries();
                    this._persistIndexEntries();
                }
            },

            addIndexEntryFromSidebar: function (pageIndex) {
                const doc = this.getDoc();
                if (!doc) { alert('No hay documento abierto'); return; }
                const pageNum = (pageIndex !== undefined ? pageIndex : (doc.currentIndex || 0)) + 1;
                const title = prompt(`Título de la entrada en índice para página ${pageNum}:`);
                if (!title) return;
                const levelStr = prompt('Nivel (1=Principal, 2=Subtítulo, 3=Sección):', '1');
                const level = parseInt(levelStr) || 1;
                const newEntry = {
                    id: `manual-${Date.now()}`,
                    title: title,
                    page: pageNum,
                    level: Math.min(Math.max(level, 1), 3),
                    type: 'manual'
                };
                this.indexEntries.push(newEntry);
                this.indexEntries.sort((a, b) => a.page - b.page);
                this.renderIndexEntries();
                this.updateIndexCount();
                this._persistIndexEntries();
                this.showToast('📑 Entrada añadida al índice');
            },

            deleteIndexEntry: function (entryId) {
                if (!confirm('¿Eliminar esta entrada del índice?')) return;

                this.indexEntries = this.indexEntries.filter(e => e.id !== entryId);
                this.renderIndexEntries();
                this.updateIndexCount();
                this._persistIndexEntries();
            },

            filterIndex: function (searchTerm) {
                if (!searchTerm.trim()) {
                    this.renderIndexEntries();
                    return;
                }

                const filtered = this.indexEntries.filter(entry =>
                    entry.title.toLowerCase().includes(searchTerm.toLowerCase())
                );

                this.renderIndexEntries(filtered);
            },

            updateIndexCount: function () {
                const countEl = document.getElementById('index-count');
                const count = (this.indexEntries || []).length;
                if (countEl) countEl.textContent = count === 1 ? '1 entrada' : `${count} entradas`;
            },

            // Persiste indexEntries en el doc activo y en IndexedDB
            _persistIndexEntries: function () {
                const doc = this.getDoc();
                if (doc) doc.indexEntries = this.indexEntries.slice();
                this.saveSessionLight();
            },

            exportIndex: function () {
                if (this.indexEntries.length === 0) {
                    alert('No hay entradas para exportar');
                    return;
                }

                const data = JSON.stringify(this.indexEntries, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'indice.json';
                a.click();
                URL.revokeObjectURL(url);
            },

            importIndex: function () {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const data = JSON.parse(event.target.result);
                            if (!Array.isArray(data)) {
                                throw new Error('Formato inválido');
                            }

                            this.indexEntries = data;
                            this.renderIndexEntries();
                            this.updateIndexCount();
                            this._persistIndexEntries();
                            alert(`Se importaron ${data.length} entradas`);
                        } catch (err) {
                            alert('Error al importar: ' + err.message);
                        }
                    };
                    reader.readAsText(file);
                };
                input.click();
            },

            clearIndex: function () {
                if (!confirm('¿Limpiar todo el índice?\nEsta acción no se puede deshacer.')) return;

                this.indexEntries = [];
                this.renderIndexEntries();
                this.updateIndexCount();
                this.showIndexEmptyState(true);
                this._persistIndexEntries();
            },

            createIndexPage: async function () {
                const doc = this.getDoc();
                if (!doc || this.indexEntries.length === 0) {
                    alert('No hay entradas en el índice para crear la página');
                    return;
                }

                this.saveState();
                this.toggleLoader(true);
                document.getElementById('loader-msg').innerText = "Creando página con índice...";

                try {
                    // Buscar la primera página PDF (no generada) para obtener dimensiones
                    let referencePage = null;
                    let referenceWidth = 612; // Tamaño carta por defecto
                    let referenceHeight = 792;

                    for (let i = 0; i < doc.pages.length; i++) {
                        const page = doc.pages[i];
                        const src = doc.sources[page.sourceId];

                        // Si es una página PDF (no generada)
                        if (src && src.buffer) {
                            referencePage = page;

                            if (!src.doc) {
                                src.doc = await pdfjsLib.getDocument({ data: src.buffer.slice(0) }).promise;
                            }

                            const pdfPage = await src.doc.getPage(page.pageIndex + 1);
                            const viewport = pdfPage.getViewport({ scale: 1.0 });
                            referenceWidth = viewport.width;
                            referenceHeight = viewport.height;
                            break;
                        }
                        // Si es una página generada con canvas
                        else if (page.canvas) {
                            referenceWidth = page.canvas.width;
                            referenceHeight = page.canvas.height;
                            break;
                        }
                    }

                    // Crear canvas para la nueva página
                    const canvas = document.createElement('canvas');
                    canvas.width = referenceWidth;
                    canvas.height = referenceHeight;

                    const ctx = canvas.getContext('2d');

                    // Fondo blanco
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Crear nueva página con ID único
                    const indexPage = {
                        id: 'index-page-' + Date.now(),
                        canvas: canvas,
                        objects: [],
                        rotation: 0,
                        sourceId: 'generated-index',
                        pageIndex: 0,
                        width: referenceWidth,
                        height: referenceHeight
                    };

                    // Agregar sourceId si no existe
                    if (!doc.sources['generated-index']) {
                        doc.sources['generated-index'] = {
                            id: 'generated-index',
                            buffer: null,
                            doc: null
                        };
                    }

                    const leftMargin = 70;
                    const rightMargin = canvas.width - 70;
                    let yPosition = 100;
                    const lineHeight = 30;

                    // Título principal - más elegante
                    indexPage.objects.push({
                        id: 'index-title-' + Date.now(),
                        type: 'text',
                        x: leftMargin,
                        y: yPosition,
                        width: 200,
                        height: 40,
                        text: 'ÍNDICE',
                        font: 'Helvetica-Bold',
                        size: 28,
                        color: '#2c3e50',
                        bold: true,
                        italic: false,
                        alignment: 'left',
                        bgColor: '#ffffff',
                        bgAlpha: 0
                    });

                    yPosition += 60;

                    // Línea decorativa debajo del título
                    indexPage.objects.push({
                        id: 'index-line-' + Date.now(),
                        type: 'rect', // ✅ CORRECCIÓN: Cambiar de 'drawing' a 'rect'
                        x: leftMargin,
                        y: yPosition - 10,
                        width: canvas.width - 140,
                        height: 2,
                        color: '#667eea',
                        borderWidth: 0
                    });

                    yPosition += 20;

                    // Agregar entradas del índice
                    // ✅ CORRECCIÓN: Validación defensiva adicional
                    const entries = this.indexEntries || [];
                    for (let i = 0; i < entries.length; i++) {
                        const entry = entries[i];

                        // Verificar si necesitamos nueva página
                        if (yPosition > canvas.height - 100) {
                            break; // Por ahora, limitamos a una página
                        }

                        const indent = (entry.level - 1) * 25;
                        const fontSize = entry.level === 1 ? 14 : (entry.level === 2 ? 12 : 11);
                        const fontWeight = entry.level === 1 ? 'bold' : 'normal';
                        const textColor = entry.level === 1 ? '#2c3e50' : '#34495e';

                        // Icono según nivel
                        const icon = entry.level === 1 ? '■' : (entry.level === 2 ? '▸' : '•');
                        const iconColor = entry.level === 1 ? '#667eea' : '#95a5a6';

                        // Agregar icono
                        indexPage.objects.push({
                            id: `index-icon-${i}-${Date.now()}`,
                            type: 'text',
                            x: leftMargin + indent,
                            y: yPosition,
                            width: 20,
                            height: 20,
                            text: icon,
                            font: 'Helvetica',
                            size: fontSize - 2,
                            color: iconColor,
                            bold: false,
                            italic: false,
                            alignment: 'left',
                            bgColor: '#ffffff',
                            bgAlpha: 0
                        });

                        // Título con hipervínculo EDITABLE
                        const titleWidth = canvas.width - leftMargin - rightMargin - indent - 100;
                        indexPage.objects.push({
                            id: `index-link-${i}-${Date.now()}`,
                            type: 'text',
                            x: leftMargin + indent + 25,
                            y: yPosition,
                            width: titleWidth,
                            height: 20,
                            text: entry.title,
                            font: fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica',
                            size: fontSize,
                            color: '#3498db',
                            bold: fontWeight === 'bold',
                            italic: false,
                            alignment: 'left',
                            bgColor: '#ffffff',
                            bgAlpha: 0,
                            linkTarget: entry.page - 1,
                            isIndexLink: true
                        });

                        // Línea punteada
                        const dotsY = yPosition + fontSize - 2;
                        for (let x = leftMargin + indent + 25 + titleWidth + 10; x < rightMargin - 40; x += 8) {
                            indexPage.objects.push({
                                id: `index-dot-${i}-${x}-${Date.now()}`,
                                type: 'text',
                                x: x,
                                y: dotsY,
                                width: 5,
                                height: 5,
                                text: '·',
                                font: 'Helvetica',
                                size: 8,
                                color: '#bdc3c7',
                                bold: false,
                                italic: false,
                                alignment: 'center',
                                bgColor: '#ffffff',
                                bgAlpha: 0
                            });
                        }

                        // Número de página - con fondo
                        indexPage.objects.push({
                            id: `index-pagenum-bg-${i}-${Date.now()}`,
                            type: 'rect',
                            x: rightMargin - 35,
                            y: yPosition - 2,
                            width: 30,
                            height: fontSize + 4,
                            color: '#ecf0f1',
                            borderWidth: 0,
                            borderRadius: 4
                        });

                        indexPage.objects.push({
                            id: `index-pagenum-${i}-${Date.now()}`,
                            type: 'text',
                            x: rightMargin - 30,
                            y: yPosition,
                            width: 25,
                            height: 20,
                            text: entry.page.toString(),
                            font: 'Helvetica-Bold',
                            size: fontSize,
                            color: textColor,
                            bold: true,
                            italic: false,
                            alignment: 'center',
                            bgColor: '#ffffff',
                            bgAlpha: 0
                        });

                        yPosition += lineHeight;
                    }

                    // Nota al pie
                    indexPage.objects.push({
                        id: 'index-footer-' + Date.now(),
                        type: 'text',
                        x: leftMargin,
                        y: canvas.height - 50,
                        width: canvas.width - 140,
                        height: 20,
                        text: '• Click en los títulos para navegar a la página correspondiente',
                        font: 'Helvetica',
                        size: 9,
                        color: '#95a5a6',
                        bold: false,
                        italic: true,
                        alignment: 'left',
                        bgColor: '#ffffff',
                        bgAlpha: 0
                    });

                    // Insertar la página de índice al inicio
                    doc.pages.unshift(indexPage);

                    // Actualizar índices de todas las entradas (+1 porque agregamos una página)
                    // ✅ CORRECCIÓN: Validación defensiva
                    if (this.indexEntries && Array.isArray(this.indexEntries)) {
                        this.indexEntries.forEach(entry => {
                            entry.page += 1;
                        });
                    }

                    // Renderizar la sidebar para mostrar la nueva página
                    this.renderSidebar();

                    // Cargar y mostrar la página de índice creada
                    await this.loadPage(0);

                    // Actualizar el índice
                    this.renderIndexEntries();
                    this.updateIndexCount(); // ✅ CORRECCIÓN: Actualizar contador de entradas

                    this.toggleLoader(false);
                    this.showToast('✅ Página con índice creada exitosamente');

                } catch (error) {
                    this.toggleLoader(false);
                    console.error('Error creando página de índice:', error);
                    alert('Error al crear página de índice: ' + error.message);
                }
            },

            // ============================================================
            // DOCUMENTOS RECIENTES
            // ============================================================
            currentRecentTab: 'recent',

            toggleRecentDocs: async function () {
                const dropdown = document.getElementById('recent-docs-dropdown');
                dropdown.classList.toggle('show');
                if (dropdown.classList.contains('show')) {
                    await this.renderRecentDocs();
                    await this.renderHomeDocuments();
                }
            },

            switchRecentTab: async function (tab) {
                this.currentRecentTab = tab;

                // Actualizar tabs activas
                document.querySelectorAll('.recent-tab').forEach(t => {
                    t.classList.remove('active');
                    t.style.background = 'white';
                    t.style.color = '#666';
                    t.style.borderBottom = '2px solid transparent';
                });
                event.target.classList.add('active');
                event.target.style.background = 'white';
                event.target.style.color = '#8b5cf6';
                event.target.style.borderBottom = '2px solid #8b5cf6';

                await this.renderRecentDocs();
                await this.renderHomeDocuments();
            },

            // ============================================================
            // DATA MIGRATION - localStorage to IndexedDB
            // ============================================================

            migrateOldFavoritesAndRecents: async function () {
                try {
                    // Check if migration already done
                    const migrated = localStorage.getItem('favRecents_migrated');
                    if (migrated === 'true') {
                        console.log('✅ Migration already completed');
                        return;
                    }

                    console.log('🔄 Starting migration from localStorage to IndexedDB...');

                    // Migrate recents
                    const oldRecents = JSON.parse(localStorage.getItem('recentDocs') || '[]');
                    for (const rec of oldRecents) {
                        const recents = await this.db.recents.toArray();
                        let existing = null;
                        for (const r of recents) {
                            const dec = await this.decryptRecord(r, ['name']);
                            if (dec.name === rec.name) {
                                existing = r;
                                break;
                            }
                        }
                        if (!existing) {
                            const newRecord = {
                                name: rec.name,
                                lastOpened: rec.lastAccess || Date.now(),
                                count: rec.count || 1,
                                path: ''
                            };
                            const encRecord = await this.encryptRecord(newRecord, ['name', 'path']);
                            await this.db.recents.add(encRecord);
                        }
                    }
                    console.log(`✅ Migrated ${oldRecents.length} recent documents`);

                    // Note: Old favorites only had names, not file data
                    // We can't migrate them as cached favorites without the file
                    // They will remain as recents only
                    const oldFavorites = JSON.parse(localStorage.getItem('favoriteDocs') || '[]');
                    console.log(`ℹ️ Found ${oldFavorites.length} old favorites (metadata only, not migrated as cached)`);

                    // Mark migration as complete
                    localStorage.setItem('favRecents_migrated', 'true');
                    console.log('✅ Migration completed successfully');

                } catch (error) {
                    console.error('❌ Error during migration:', error);
                }
            },

            // ============================================================
            // FAVORITES & RECENTS SYSTEM (HYBRID APPROACH)
            // ============================================================

            getFavoriteDocs: async function () {
                try {
                    if (!this.db) return [];
                    const favorites = await this.db.favorites.toArray();
                    const decrypted = [];
                    for (const f of favorites) {
                        decrypted.push(await this.decryptRecord(f, ['name', 'data']));
                    }
                    return decrypted.sort((a, b) => b.cachedDate - a.cachedDate);
                } catch (error) {
                    console.error('Error loading favorites:', error);
                    return [];
                }
            },

            getRecentDocs: async function () {
                try {
                    if (!this.db) return [];
                    const recents = await this.db.recents.orderBy('lastOpened').reverse().limit(10).toArray();
                    const decrypted = [];
                    for (const r of recents) {
                        decrypted.push(await this.decryptRecord(r, ['name', 'data', 'path']));
                    }
                    return decrypted;
                } catch (error) {
                    console.error('Error loading recents:', error);
                    return [];
                }
            },

            getMostUsedDocs: async function () {
                try {
                    if (!this.db) return [];
                    const recents = await this.db.recents.orderBy('count').reverse().limit(10).toArray();
                    const decrypted = [];
                    for (const r of recents) {
                        decrypted.push(await this.decryptRecord(r, ['name', 'data', 'path']));
                    }
                    return decrypted;
                } catch (error) {
                    console.error('Error loading most used:', error);
                    return [];
                }
            },

            toggleFavorite: async function (docName, event) {
                if (event) event.stopPropagation();

                try {
                    if (!this.db) {
                        this.showToast('❌ Base de datos no disponible');
                        return;
                    }

                    // Check if already favorite in memory
                    const favorites = await this.db.favorites.toArray();
                    let existing = null;
                    for (const f of favorites) {
                        const dec = await this.decryptRecord(f, ['name']);
                        if (dec.name === docName) {
                            existing = f;
                            break;
                        }
                    }

                    if (existing) {
                        // Remove from favorites
                        await this.db.favorites.delete(existing.id);
                        this.showToast(`☆ Eliminado de favoritos: ${docName}`);
                    } else {
                        // Add to favorites - need to get the file data
                        const doc = this.docs.find(d => d.name === docName);
                        if (!doc) {
                            this.showToast('❌ Documento no encontrado en memoria');
                            return;
                        }

                        this.showToast('💾 Guardando en favoritos...'); // Feedback inmediato

                        // OPTIMIZACIÓN: Intentar usar buffer original si existe
                        let pdfData = null;

                        // Si el documento tiene un solo source, usar su buffer original
                        const sourceIds = Object.keys(doc.sources);
                        if (sourceIds.length === 1 && doc.sources[sourceIds[0]].buffer) {
                            pdfData = doc.sources[sourceIds[0]].buffer;
                            console.log('⚡ Usando buffer original (rápido)');
                        } else {
                            // Solo regenerar si tiene múltiples sources o modificaciones
                            console.log('🔄 Generando PDF (puede tardar)');
                            pdfData = await this.generatePDFBuffer(doc);
                        }

                        // Store in favorites with complete file
                        const favRecord = {
                            name: docName,
                            data: pdfData,
                            size: pdfData.byteLength,
                            cachedDate: Date.now()
                        };
                        const encRecord = await this.encryptRecord(favRecord, ['name', 'data']);
                        await this.db.favorites.add(encRecord);

                        this.showToast(`⭐ Agregado a favoritos: ${docName}`);
                    }

                    await this.renderRecentDocs();
                    await this.renderHomeDocuments();
                } catch (error) {
                    console.error('Error toggling favorite:', error);
                    this.showToast('❌ Error al modificar favoritos');
                }
            },

            addToRecentDocs: async function (filename, filePath = '', fileData = null) {
                try {
                    if (!this.db) return;

                    const now = Date.now();

                    // Check if already exists in memory
                    const recents = await this.db.recents.toArray();
                    let existing = null;
                    for (const r of recents) {
                        const dec = await this.decryptRecord(r, ['name']);
                        if (dec.name === filename) {
                            existing = r;
                            break;
                        }
                    }

                    if (existing) {
                        // Update existing (mantener data si ya existe o actualizar si hay nueva)
                        const updateData = {
                            lastOpened: now,
                            count: (existing.count || 0) + 1,
                            path: filePath || existing.path
                        };

                        // Solo actualizar data si se proporciona nueva
                        if (fileData) {
                            updateData.data = fileData;
                            updateData.size = fileData.byteLength;
                        }

                        const decExisting = await this.decryptRecord(existing, ['name', 'data', 'path']);
                        const mergedRecord = { ...decExisting, ...updateData };
                        const encRecord = await this.encryptRecord(mergedRecord, ['name', 'data', 'path']);
                        await this.db.recents.put(encRecord);
                    } else {
                        // Add new
                        const newRecord = {
                            name: filename,
                            lastOpened: now,
                            count: 1,
                            path: filePath
                        };

                        // Agregar data si está disponible
                        if (fileData) {
                            newRecord.data = fileData;
                            newRecord.size = fileData.byteLength;
                        }

                        const encRecord = await this.encryptRecord(newRecord, ['name', 'data', 'path']);
                        await this.db.recents.add(encRecord);
                    }

                    // Keep only last 20 recents
                    const allRecents = await this.db.recents.orderBy('lastOpened').reverse().toArray();
                    if (allRecents.length > 20) {
                        const toDelete = allRecents.slice(20);
                        for (const rec of toDelete) {
                            await this.db.recents.delete(rec.id);
                        }
                    }
                } catch (error) {
                    console.error('Error adding to recents:', error);
                }
            },

            renderRecentDocs: async function () {
                const list = document.getElementById('recent-docs-list');
                if (!list) return;

                try {
                    const favorites = await this.getFavoriteDocs();
                    const favoriteNames = favorites.map(f => f.name);

                    let docs = [];
                    let emptyMessage = '';

                    if (this.currentRecentTab === 'recent') {
                        docs = await this.getRecentDocs();
                        emptyMessage = 'No hay documentos recientes';
                    } else if (this.currentRecentTab === 'frequent') {
                        docs = await this.getMostUsedDocs();
                        emptyMessage = 'No hay documentos usados';
                    } else if (this.currentRecentTab === 'favorites') {
                        docs = favorites;
                        emptyMessage = 'No hay documentos favoritos';
                    }

                    if (docs.length === 0) {
                        list.innerHTML = `<div class="recent-docs-empty">${emptyMessage}</div>`;
                        return;
                    }

                    list.innerHTML = docs.map(doc => {
                        const date = new Date(doc.lastOpened || doc.cachedDate);
                        const dateStr = date.toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                        });
                        const timeStr = date.toLocaleTimeString('es-MX', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });

                        const isFavorite = favoriteNames.includes(doc.name);
                        const sizeStr = doc.size ? `${(doc.size / 1024 / 1024).toFixed(1)} MB` : '';
                        const isCached = this.currentRecentTab === 'favorites';

                        const escapedName = window.escapeHTML(doc.name);

                        return `
                            <div class="recent-doc-item" onclick="app.openRecentDoc('${escapedName.replace(/'/g, "\\'")}', ${isCached})">
                                <div class="recent-doc-content">
                                    <div class="recent-doc-name">
                                        ${isCached ? '💾 ' : '📄 '}${escapedName}
                                    </div>
                                    <div class="recent-doc-meta">
                                        <span>📅 ${dateStr}</span>
                                        <span>🕐 ${timeStr}</span>
                                        ${doc.count ? `<span>📊 ${doc.count} ${doc.count === 1 ? 'vez' : 'veces'}</span>` : ''}
                                        ${sizeStr ? `<span>💾 ${sizeStr}</span>` : ''}
                                    </div>
                                </div>
                                <div class="recent-doc-star" onclick="app.toggleFavorite('${escapedName.replace(/'/g, "\\'")}', event)">
                                    ${isFavorite ? '⭐' : '☆'}
                                </div>
                            </div>
                        `;
                    }).join('');
                } catch (error) {
                    console.error('Error rendering recent docs:', error);
                    list.innerHTML = '<div class="recent-docs-empty">Error al cargar documentos</div>';
                }
            },

            openRecentDoc: async function (filename, isCached = false) {
                // Close dropdown
                const dropdown = document.getElementById('recent-docs-dropdown');
                if (dropdown) dropdown.classList.remove('show');

                try {
                    // OPCIÓN 1: Intentar abrir desde favoritos (prioridad máxima)
                    if (isCached) {
                        const favorites = await this.db.favorites.toArray();
                        let favorite = null;
                        for (const f of favorites) {
                            const dec = await this.decryptRecord(f, ['name']);
                            if (dec.name === filename) {
                                favorite = await this.decryptRecord(f, ['name', 'data']);
                                break;
                            }
                        }

                        if (favorite && favorite.data) {
                            this.showToast(`💾 Abriendo desde favoritos: ${window.escapeHTML(filename)}`);

                            const blob = new Blob([favorite.data], { type: 'application/pdf' });
                            const file = new File([blob], filename, { type: 'application/pdf' });

                            await this.openFile(file);
                            await this.addToRecentDocs(filename, '', favorite.data);
                            return;
                        }
                    }

                    // OPCIÓN 2: Intentar abrir desde recientes cacheados
                    const recents = await this.db.recents.toArray();
                    let recent = null;
                    for (const r of recents) {
                        const dec = await this.decryptRecord(r, ['name']);
                        if (dec.name === filename) {
                            recent = await this.decryptRecord(r, ['name', 'data', 'path']);
                            break;
                        }
                    }

                    if (recent && recent.data) {
                        this.showToast(`💾 Abriendo desde caché: ${window.escapeHTML(filename)}`);

                        const blob = new Blob([recent.data], { type: 'application/pdf' });
                        const file = new File([blob], filename, { type: 'application/pdf' });

                        await this.openFile(file);
                        await this.addToRecentDocs(filename, recent.path || '', recent.data);
                        return;
                    }

                    // OPCIÓN 3: Fallback - Pedir al usuario que seleccione el archivo
                    this.showToast(`📁 Selecciona el archivo: ${window.escapeHTML(filename)}`);

                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.pdf';
                    input.onchange = async (e) => {
                        if (e.target.files.length > 0) {
                            const file = e.target.files[0];

                            // Leer el contenido del archivo para cachearlo
                            const arrayBuffer = await file.arrayBuffer();
                            await this.openFile(file);
                            await this.addToRecentDocs(filename, '', arrayBuffer);
                        }
                    };
                    input.click();

                } catch (error) {
                    console.error('Error opening recent doc:', error);
                    this.showToast('❌ Error al abrir el documento');
                }
            },

            clearRecentDocs: async function () {
                try {
                    if (!this.db) {
                        this.showToast('❌ Base de datos no disponible');
                        return;
                    }

                    await this.db.recents.clear();
                    this.showToast('🗑️ Historial de recientes eliminado');
                    await this.renderRecentDocs();
                    await this.renderHomeDocuments();
                } catch (error) {
                    console.error('Error clearing recents:', error);
                    this.showToast('❌ Error al limpiar historial');
                }
            },

            clearOldRecents: async function () {
                // Auto-clear recents older than 3 days
                try {
                    if (!this.db) return;

                    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
                    const oldRecents = await this.db.recents.where('lastOpened').below(threeDaysAgo).toArray();

                    if (oldRecents.length > 0) {
                        for (const rec of oldRecents) {
                            await this.db.recents.delete(rec.id);
                        }
                        console.log(`🗑️ Auto-cleared ${oldRecents.length} old recents (>3 days)`);
                    }
                } catch (error) {
                    console.error('Error auto-clearing old recents:', error);
                }
            },

            // ============================================================
            // RENDERIZAR DOCUMENTOS EN PANTALLA PRINCIPAL
            // ============================================================
            renderHomeDocuments: async function () {
                // Renderizar documentos más usados
                const mostUsedList = document.getElementById('most-used-docs-list');
                if (mostUsedList) {
                    const mostUsedDocs = await this.getMostUsedDocs();
                    const displayDocs = mostUsedDocs.filter(Boolean).slice(0, 4);

                    if (displayDocs.length === 0) {
                        mostUsedList.innerHTML = '<div class="home-docs-empty">No hay documentos más usados aún</div>';
                    } else {
                        mostUsedList.innerHTML = displayDocs.map(doc => {
                            if (!doc) return '';
                            const date = new Date(doc.lastOpened || doc.cachedDate || Date.now());
                            const dateStr = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
                            const escapedName = window.escapeHTML(doc.name);

                            return `
                                <div class="home-doc-card" onclick="app.openRecentDoc('${escapedName.replace(/'/g, "\\'")}', false)">
                                    <div class="home-doc-card-name" title="${escapedName}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:5px; flex-shrink:0;"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>${escapedName}</div>
                                    <div class="home-doc-card-meta">
                                        <span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; flex-shrink:0;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>${doc.openCount || 1}</span>
                                        <span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateStr}</span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                }

                // Renderizar documentos favoritos
                const favoriteList = document.getElementById('favorite-docs-list');
                if (favoriteList) {
                    const favoriteDocs = await this.getFavoriteDocs();
                    const displayDocs = favoriteDocs.slice(0, 4);

                    if (displayDocs.length === 0) {
                        favoriteList.innerHTML = '<div class="home-docs-empty">No tienes documentos favoritos</div>';
                    } else {
                        favoriteList.innerHTML = displayDocs.map(doc => {
                            const date = new Date(doc.cachedDate);
                            const dateStr = date.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
                            const sizeStr = doc.size ? `${(doc.size / 1024 / 1024).toFixed(1)} MB` : '';
                            const escapedName = window.escapeHTML(doc.name);

                            return `
                                <div class="home-doc-card" onclick="app.openRecentDoc('${escapedName.replace(/'/g, "\\'")}', true)">
                                    <div class="home-doc-card-name" title="${escapedName}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:5px; flex-shrink:0;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${escapedName}</div>
                                    <div class="home-doc-card-meta">
                                        ${sizeStr ? `<span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; flex-shrink:0;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>${sizeStr}</span>` : ''}
                                        <span style="display:inline-flex; align-items:center; gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; flex-shrink:0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateStr}</span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    }
                }
            },

            // ============================================================
            // OCR CON TESSERACT
            // ============================================================
            _attachPanelOpen: false,
            _layersPanelOpen: false,

            toggleAttachPanel: function () {
                this._attachPanelOpen = !this._attachPanelOpen;
                const panel = document.getElementById('attach-panel-sidebar');
                if (!panel) return;
                if (this._attachPanelOpen) {
                    const idx = document.getElementById('index-panel-sidebar');
                    const bm  = document.getElementById('bookmark-panel');
                    const fp  = document.getElementById('fields-panel-sidebar');
                    const lp  = document.getElementById('layers-panel-sidebar');
                    if (idx) idx.classList.remove('visible');
                    if (bm)  bm.classList.remove('visible');
                    if (fp)  fp.classList.remove('visible');
                    if (lp)  lp.classList.remove('visible');
                    if (this.indexPanelOpen) this.indexPanelOpen = false;
                    if (this._layersPanelOpen) this._layersPanelOpen = false;
                    if (typeof BookmarkManager !== 'undefined' && BookmarkManager._panelOpen) {
                        BookmarkManager._panelOpen = false;
                    }
                    const sb = document.getElementById('sidebar');
                    if (sb && sb.classList.contains('hidden')) this.toggleSidebar();
                    panel.classList.add('visible');
                    this._loadAttachments();
                } else {
                    panel.classList.remove('visible');
                }
            },

            // ── OCG Layers Panel (PdfCraft style) ────────────────────────
            toggleLayersPanel: function () {
                this._layersPanelOpen = !this._layersPanelOpen;
                const panel = document.getElementById('layers-panel-sidebar');
                if (!panel) return;
                if (this._layersPanelOpen) {
                    const idx = document.getElementById('index-panel-sidebar');
                    const bm  = document.getElementById('bookmark-panel');
                    const fp  = document.getElementById('fields-panel-sidebar');
                    const ap  = document.getElementById('attach-panel-sidebar');
                    if (idx) idx.classList.remove('visible');
                    if (bm)  bm.classList.remove('visible');
                    if (fp)  fp.classList.remove('visible');
                    if (ap)  ap.classList.remove('visible');
                    if (this.indexPanelOpen) this.indexPanelOpen = false;
                    if (this._attachPanelOpen) this._attachPanelOpen = false;
                    if (typeof BookmarkManager !== 'undefined' && BookmarkManager._panelOpen) {
                        BookmarkManager._panelOpen = false;
                    }
                    const sb = document.getElementById('sidebar');
                    if (sb && sb.classList.contains('hidden')) this.toggleSidebar();
                    panel.classList.add('visible');
                    this._loadLayers();
                } else {
                    panel.classList.remove('visible');
                }
            },

            _loadLayers: async function () {
                const emptyEl = document.getElementById('layers-empty-state');
                const listEl = document.getElementById('layers-list');
                const footerEl = document.querySelector('#layers-panel-sidebar .layers-footer');
                if (!listEl) return;

                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) {
                    if (emptyEl) emptyEl.style.display = 'flex';
                    listEl.style.display = 'none';
                    if (footerEl) footerEl.style.display = 'none';
                    return;
                }

                try {
                    if (!ds.src.doc) {
                        ds.src.doc = await pdfjsLib.getDocument({ data: ds.src.buffer.slice(0) }).promise;
                    }
                    if (!ds.src.optionalContentConfigPromise) {
                        ds.src.optionalContentConfigPromise = ds.src.doc.getOptionalContentConfig();
                    }
                    const ocConfig = await ds.src.optionalContentConfigPromise;
                    const groups = ocConfig ? ocConfig.getGroups() : null;

                    if (!groups || Object.keys(groups).length === 0) {
                        if (emptyEl) emptyEl.style.display = 'flex';
                        listEl.style.display = 'none';
                        if (footerEl) footerEl.style.display = 'none';
                        return;
                    }

                    if (emptyEl) emptyEl.style.display = 'none';
                    listEl.style.display = 'block';
                    if (footerEl) footerEl.style.display = 'flex';

                    let html = '';
                    const groupIds = Object.keys(groups);
                    groupIds.forEach(id => {
                        const grp = groups[id];
                        const name = grp.name || id || 'Capa sin nombre';
                        const isVis = ocConfig.isVisible(id);
                        html += `
                            <div class="layers-row" data-id="${id}">
                                <label class="layer-checkbox-label">
                                    <input type="checkbox" class="layer-toggle-checkbox" data-group-id="${id}" ${isVis ? 'checked' : ''} onchange="app.toggleLayerVisibility('${id}', this.checked)">
                                    <span class="layer-name" title="${name.replace(/"/g, '&quot;')}">${name}</span>
                                </label>
                            </div>
                        `;
                    });
                    listEl.innerHTML = html;
                } catch (e) {
                    console.error('Error cargando capas OCG:', e);
                    if (emptyEl) emptyEl.style.display = 'flex';
                    listEl.style.display = 'none';
                    if (footerEl) footerEl.style.display = 'none';
                }
            },

            toggleLayerVisibility: async function (groupId, isVisible) {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.optionalContentConfigPromise) return;
                try {
                    const ocConfig = await ds.src.optionalContentConfigPromise;
                    if (ocConfig) {
                        ocConfig.setVisibility(groupId, isVisible);
                        await this._refreshLayerView(ds);
                    }
                } catch (e) {
                    console.error('Error cambiando visibilidad de capa:', e);
                }
            },

            showAllLayers: async function (isVisible) {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.optionalContentConfigPromise) return;
                try {
                    const ocConfig = await ds.src.optionalContentConfigPromise;
                    if (ocConfig) {
                        const groups = ocConfig.getGroups() || {};
                        Object.keys(groups).forEach(id => {
                            ocConfig.setVisibility(id, isVisible);
                        });
                        const checkboxes = document.querySelectorAll('#layers-list .layer-toggle-checkbox');
                        checkboxes.forEach(cb => { cb.checked = isVisible; });
                        await this._refreshLayerView(ds);
                    }
                } catch (e) {
                    console.error('Error cambiando todas las capas:', e);
                }
            },

            _refreshLayerView: async function ({ doc, src }) {
                for (const page of doc.pages) {
                    if (doc.sources[page.sourceId] === src) this.releasePageThumbnail?.(page);
                }
                const active = this.splitView?.activePanel || 'primary';
                const panels = ['primary', 'secondary'].filter(id => (this.splitView?.[id]?.docId || (id === active ? this.activeDocId : null)) === doc.id);
                panels.sort((a, b) => Number(a === active) - Number(b === active));
                for (const id of panels) {
                    const elements = this.getPanelElements(id);
                    elements.mainView?.querySelectorAll('.bg-page-canvas').forEach(canvas => {
                        canvas._renderedSessionToken = null;
                        canvas._pendingSessionToken = null;
                        canvas._renderRequestToken = null;
                        canvas._renderPromise = null;
                        try { canvas._activeRenderTask?.cancel(); } catch (_) {}
                    });
                    await this.loadPage(this.splitView?.[id]?.pageIndex ?? doc.currentIndex, id);
                }
                if (!panels.length && this.getDoc()?.id === doc.id) await this.loadPage(doc.currentIndex);
            },

            // ── TTS Widget ──────────────────────────────────────────────
            _getDocSource: function () {
                const doc = this.getDoc();
                const page = doc && doc.pages[doc.currentIndex];
                return page ? { doc, src: doc.sources[page.sourceId] } : null;
            },

            _loadAttachments: async function () {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) { this._renderAttachments([]); return; }
                try {
                    const list = await PythonManager.getAttachments(ds.src.buffer);
                    this._renderAttachments(list);
                } catch (e) {
                    this.showToast('❌ Error leyendo adjuntos: ' + e.message);
                }
            },

            _attachMimeIcon: function (mime) {
                if (!mime) mime = '';
                if (mime.startsWith('image/'))
                    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
                if (mime.startsWith('video/'))
                    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
                if (mime.startsWith('audio/'))
                    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
                if (mime === 'application/pdf')
                    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
            },

            _attachMimeLabel: function (mime, name) {
                const ext = (name || '').split('.').pop().toLowerCase();
                const m = (mime || '').toLowerCase();
                if (m === 'application/pdf' || ext === 'pdf') return 'PDF';
                if (m.startsWith('image/') || ['jpg','jpeg','png','gif','bmp','webp','svg','tiff','ico'].includes(ext)) return 'Imagen';
                if (m.startsWith('video/') || ['mp4','avi','mov','mkv','webm','flv','wmv'].includes(ext)) return 'Video';
                if (m.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a','wma'].includes(ext)) return 'Audio';
                if (['xlsx','xls','xlsm','ods','csv'].includes(ext) || m.includes('spreadsheet') || m.includes('excel')) return 'Excel';
                if (['docx','doc','odt','rtf'].includes(ext) || m.includes('word') || m.includes('opendocument.text')) return 'Word';
                if (['pptx','ppt','odp'].includes(ext) || m.includes('presentation') || m.includes('powerpoint')) return 'PowerPoint';
                if (['zip','rar','7z','tar','gz','bz2'].includes(ext) || m.includes('zip') || m.includes('compressed')) return 'Archivo';
                if (['txt','md','log','ini','cfg','conf'].includes(ext) || m === 'text/plain') return 'Texto';
                if (['html','htm','xml','json','js','css','py','java','cpp','c','ts'].includes(ext) || m.startsWith('text/')) return 'Código';
                if (['exe','msi','dmg','apk','deb','rpm'].includes(ext)) return 'Ejecutable';
                if (ext) return ext.toUpperCase();
                return 'Archivo';
            },

            _fmtSize: function (b) {
                if (!b) return '—';
                if (b < 1024) return b + ' B';
                if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
                return (b/1048576).toFixed(1) + ' MB';
            },

            _renderAttachments: function (list) {
                const empty = document.getElementById('attach-empty-state');
                const listEl = document.getElementById('attach-list');
                if (!empty || !listEl) return;
                if (!list || list.length === 0) {
                    empty.style.display = 'flex';
                    listEl.style.display = 'none';
                    listEl.innerHTML = '';
                    return;
                }
                empty.style.display = 'none';
                listEl.style.display = 'block';
                listEl.innerHTML = list.map(a => {
                    const safeName = (a.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
                    const safeMime = (a.mime||'').replace(/'/g,"\\'");
                    const displayName = a.filename || a.name || '';
                    return `<div class="attach-item">
                        <div class="attach-item-row1">
                            <div class="attach-item-icon">
                                ${this._attachMimeIcon(a.mime)}
                                <span class="attach-type">${this._attachMimeLabel(a.mime, displayName)}</span>
                                <span class="attach-size">${this._fmtSize(a.size)}</span>
                            </div>
                            <div class="attach-item-info"></div>
                            <div class="attach-item-actions">
                                <button class="attach-action-btn" title="Descargar" onclick="app._downloadAttachment('${safeName}','${safeMime}')">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </button>
                                <button class="attach-action-btn" title="Previsualizar" onclick="app._previewAttachment('${safeName}','${safeMime}')">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                    </svg>
                                </button>
                                <button class="attach-action-btn danger" title="Eliminar" onclick="app._removeAttachment('${safeName}')">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                        <path d="M10 11v6"/><path d="M14 11v6"/>
                                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="attach-item-meta" title="${displayName}">${displayName}</div>
                    </div>`;
                }).join('');
            },

            attachFileToDoc: function () {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) { this.showToast('⚠️ Abre un PDF primero'); return; }
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.onchange = async (e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;
                    this.toggleLoader(true, 'Adjuntando archivos al PDF...');
                    try {
                        let currentBuffer = ds.src.buffer;
                        for (const file of files) {
                            const fileBuffer = await file.arrayBuffer();
                            const mime = file.type || 'application/octet-stream';
                            currentBuffer = await PythonManager.addAttachment(currentBuffer, file.name, fileBuffer, mime);
                        }
                        ds.src.buffer = currentBuffer;
                        this.showToast(`📎 ${files.length} archivo(s) adjuntado(s)`);
                        if (this._attachPanelOpen) this._loadAttachments();
                        await this.saveSession();
                        if (ds.doc?.name) await this.addToRecentDocs(ds.doc.name, '', currentBuffer).catch(() => {});
                    } catch (err) {
                        this.showToast('❌ Error: ' + err.message);
                    }
                    this.toggleLoader(false);
                };
                input.click();
            },

            _downloadAttachment: async function (name, mime) {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) return;
                this.toggleLoader(true, 'Extrayendo adjunto...');
                try {
                    const b64 = await PythonManager.getAttachmentData(ds.src.buffer, name);
                    const bin = atob(b64);
                    const buf = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                    const blob = new Blob([buf], { type: mime || 'application/octet-stream' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
                } catch (err) {
                    this.showToast('❌ Error: ' + err.message);
                }
                this.toggleLoader(false);
            },

            _previewAttachment: async function (name, mime) {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) return;
                this.toggleLoader(true, 'Cargando previsualización...');
                let blobUrl = null;
                try {
                    const b64 = await PythonManager.getAttachmentData(ds.src.buffer, name);
                    const bin = atob(b64);
                    const buf = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                    const blob = new Blob([buf], { type: mime || 'application/octet-stream' });
                    blobUrl = URL.createObjectURL(blob);
                } catch (err) {
                    this.showToast('❌ Error: ' + err.message);
                    this.toggleLoader(false);
                    return;
                }
                this.toggleLoader(false);

                // Si no es previsualizable, descargar directamente
                const previewable = mime.startsWith('image/') || mime.startsWith('video/') ||
                                    mime.startsWith('audio/') || mime === 'application/pdf';
                if (!previewable) { this._downloadAttachment(name, mime); URL.revokeObjectURL(blobUrl); return; }

                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
                const hdr = document.createElement('div');
                hdr.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:12px;';
                hdr.innerHTML = `<span style="color:rgba(220,230,255,0.85);font-size:13px;font-family:inherit;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                    <button style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);border-radius:6px;padding:5px 14px;color:#e0eaff;cursor:pointer;font-family:inherit;font-size:12px;" id="_attachCloseBtn">✕ Cerrar</button>`;
                overlay.appendChild(hdr);
                document.getElementById('_attachCloseBtn')?.addEventListener('click', () => { overlay.remove(); URL.revokeObjectURL(blobUrl); });

                let mediaEl;
                if (mime.startsWith('image/')) {
                    mediaEl = document.createElement('img');
                    mediaEl.src = blobUrl;
                    mediaEl.style.cssText = 'max-width:90vw;max-height:82vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);object-fit:contain;';
                } else if (mime.startsWith('video/')) {
                    mediaEl = document.createElement('video');
                    mediaEl.src = blobUrl; mediaEl.controls = true;
                    mediaEl.style.cssText = 'max-width:90vw;max-height:82vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);';
                } else if (mime.startsWith('audio/')) {
                    mediaEl = document.createElement('audio');
                    mediaEl.src = blobUrl; mediaEl.controls = true;
                    mediaEl.style.cssText = 'width:400px;';
                } else {
                    mediaEl = document.createElement('iframe');
                    mediaEl.src = blobUrl;
                    mediaEl.style.cssText = 'width:88vw;height:82vh;border:none;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);';
                }
                overlay.appendChild(mediaEl);
                overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); URL.revokeObjectURL(blobUrl); } });
                document.body.appendChild(overlay);
                // Fix close btn reference after DOM insert
                overlay.querySelector('#_attachCloseBtn')?.addEventListener('click', () => { overlay.remove(); URL.revokeObjectURL(blobUrl); });
            },

            _removeAttachment: async function (name) {
                const ds = this._getDocSource();
                if (!ds || !ds.src?.buffer) return;
                this.toggleLoader(true, 'Eliminando adjunto...');
                try {
                    const newBuffer = await PythonManager.removeAttachment(ds.src.buffer, name);
                    ds.src.buffer = newBuffer;
                    this.showToast('🗑️ Adjunto eliminado');
                    this._loadAttachments();
                    // Persist the modified buffer in session AND recents
                    await this.saveSession();
                    if (ds.doc?.name) await this.addToRecentDocs(ds.doc.name, '', newBuffer).catch(() => {});
                } catch (err) {
                    this.showToast('❌ Error: ' + err.message);
                }
                this.toggleLoader(false);
            }

});
