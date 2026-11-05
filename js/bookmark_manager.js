    window.BookmarkManager = {
        _colors: ['#185abd','#d32f2f','#2e7d32','#f57c00','#6a1b9a','#00838f','#c62828','#37474f'],
        _selectedColor: '#185abd',
        _showRibbons: true,
        _pendingPageIndex: null,
        _panelOpen: false,

        _key: function(doc) {
            if (!doc) return null;
            var identity = this._identity(doc);
            var a = 2166136261, b = 2246822507;
            for (var i = 0; i < identity.length; i++) {
                a = Math.imul(a ^ identity.charCodeAt(i), 16777619);
                b = Math.imul(b ^ identity.charCodeAt(i), 3266489909);
            }
            return 'alioth_bookmarks_v2' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
        },

        _identity: function(doc) {
            return JSON.stringify([doc.filePath || doc.originalPath || doc.path || doc._nativePath || doc.name || 'doc', doc.pages ? doc.pages.length : 0]);
        },

        getAll: function(doc) {
            if (!doc) return [];
            try {
                var raw = localStorage.getItem(this._key(doc));
                if (raw) {
                    var saved = JSON.parse(raw);
                    return saved.identity === this._identity(doc) ? (saved.bookmarks || []) : [];
                }
                var legacyKey = 'alioth_bookmarks_' + btoa(unescape(encodeURIComponent((doc.name || 'doc') + '_' + (doc.pages ? doc.pages.length : 0)))).slice(0, 20);
                var legacy = JSON.parse(localStorage.getItem(legacyKey) || '{}');
                var owned = (legacy.bookmarks || []).filter(function(bookmark) { return bookmark.docId === doc.id; });
                if (owned.length) this._save(doc, owned);
                return owned;
            } catch(e) { return []; }
        },

        _save: function(doc, bookmarks) {
            if (!doc) return;
            try {
                var existing;
                try { existing = JSON.parse(localStorage.getItem(this._key(doc))) || {}; } catch(e) { existing = {}; }
                existing.identity = this._identity(doc);
                existing.bookmarks = bookmarks;
                localStorage.setItem(this._key(doc), JSON.stringify(existing));
            } catch(e) { console.warn('BookmarkManager: storage error', e); }
        },

        add: function(doc, pageIndex, title, color) {
            if (!doc) return null;
            var bm = {
                id: 'bm_' + Date.now(),
                docId: doc.id,
                pageIndex: pageIndex,
                title: title || this._autoTitle(doc, pageIndex),
                color: color || this._selectedColor,
                createdAt: new Date().toISOString(),
                type: 'reader'
            };
            var all = this.getAll(doc);
            all.push(bm);
            this._save(doc, all);
            return bm;
        },

        remove: function(doc, id) {
            if (!doc) return;
            this._save(doc, this.getAll(doc).filter(function(b) { return b.id !== id; }));
        },

        removeAll: function() {
            var doc = app.getDoc();
            if (!doc) return;
            if (!confirm('¿Eliminar todos los marcadores de este documento?')) return;
            this._save(doc, []);
            this.renderPanel();
            this._refreshRibbons();
            this._refreshThumbDots();
            app.showToast('🗑️ Marcadores eliminados');
        },

        update: function(doc, id, changes) {
            if (!doc) return;
            var all = this.getAll(doc).map(function(b) {
                if (b.id === id) { var n = {}; Object.assign(n, b, changes); return n; }
                return b;
            });
            this._save(doc, all);
        },

        saveLastRead: function(doc, pageIndex) {
            if (!doc) return;
            try {
                var key = this._key(doc);
                var existing;
                try { existing = JSON.parse(localStorage.getItem(key)) || {}; } catch(e) { existing = {}; }
                existing.lastRead = { pageIndex: pageIndex, docId: doc.id, ts: Date.now() };
                localStorage.setItem(key, JSON.stringify(existing));
            } catch(e) {}
        },

        getLastRead: function(doc) {
            if (!doc) return null;
            try {
                var raw = localStorage.getItem(this._key(doc));
                return raw ? (JSON.parse(raw).lastRead || null) : null;
            } catch(e) { return null; }
        },

        _autoTitle: function(doc, pageIndex) {
            return 'Pág. ' + (pageIndex + 1);
        },

        togglePanel: function() {
            var panel = document.getElementById('bookmark-panel');
            if (!panel) return;
            // Cerrar panel de índice si está abierto
            var indexPanelSb = document.getElementById('index-panel-sidebar');
            if (indexPanelSb && indexPanelSb.classList.contains('visible')) {
                indexPanelSb.classList.remove('visible');
                if (app) app.indexPanelOpen = false;
            }
            // Cerrar panel de adjuntos si está abierto
            var apPanel = document.getElementById('attach-panel-sidebar');
            if (apPanel && apPanel.classList.contains('visible')) {
                apPanel.classList.remove('visible');
                if (app) app._attachPanelOpen = false;
            }
            // Cerrar panel de campos si está abierto
            var fpanel = document.getElementById('fields-panel-sidebar');
            if (fpanel) fpanel.classList.remove('visible');
            // Cerrar panel de capas si está abierto
            var lpanel = document.getElementById('layers-panel-sidebar');
            if (lpanel && lpanel.classList.contains('visible')) {
                lpanel.classList.remove('visible');
                if (app) app._layersPanelOpen = false;
            }
            // Si la sidebar está oculta, mostrarla antes de abrir el panel
            var sb = document.getElementById('sidebar');
            if (sb && sb.classList.contains('hidden')) {
                app.toggleSidebar();
            }
            this._panelOpen = !this._panelOpen;
            panel.classList.toggle('visible', this._panelOpen);
            if (this._panelOpen) this.renderPanel();
        },

        renderPanel: function() {
            var self = this;
            var doc = app.getDoc();
            var list = document.getElementById('bookmark-list');
            if (!list) return;
            var all = this.getAll(doc);

            if (!all.length) {
                list.innerHTML = '<div class="bm-empty">' +
                    '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
                    '<p>Sin marcadores en este documento</p></div>';
                return;
            }

            list.innerHTML = all.map(function(bm) {
                var d = new Date(bm.createdAt);
                var dateStr = d.toLocaleDateString('es', { day:'2-digit', month:'short' }) + ' ' +
                              d.toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' });
                return '<div class="bm-item" onclick="BookmarkManager._navigate(\'' + bm.id + '\')" data-bm-id="' + bm.id + '">' +
                    '<div class="bm-item-dot" style="background:' + bm.color + '"></div>' +
                    '<div class="bm-item-body">' +
                        '<div class="bm-item-title" id="bm-title-' + bm.id + '">' + self._esc(bm.title) + '</div>' +
                        '<div class="bm-item-meta">Pág. ' + (bm.pageIndex + 1) + ' &middot; ' + dateStr + '</div>' +
                    '</div>' +
                    '<div class="bm-item-actions">' +
                        '<button class="bm-item-btn" onclick="event.stopPropagation();BookmarkManager._editTitle(\'' + bm.id + '\')" title="Editar título">' +
                            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                        '</button>' +
                        '<button class="bm-item-btn danger" onclick="event.stopPropagation();BookmarkManager._deleteItem(\'' + bm.id + '\')" title="Eliminar">' +
                            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>';
            }).join('');
        },

        _esc: function(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        },

        _navigate: function(id) {
            var self = this;
            var doc = app.getDoc();
            var all = this.getAll(doc);
            var bm = null;
            for (var i = 0; i < all.length; i++) { if (all[i].id === id) { bm = all[i]; break; } }
            if (!bm) return;
            var wasOpen = this._panelOpen;
            if (this._panelOpen) this.togglePanel();
            setTimeout(function() {
                app.loadPage(bm.pageIndex);
                setTimeout(function() {
                    var panelId = (app.splitView && app.splitView.activePanel) || 'primary';
                    var elements = app.getPanelElements && app.getPanelElements(panelId);
                    var container = elements && elements.canvasContainer;
                    if (container) {
                        var ribbon = container.querySelector('.bm-ribbon[data-bm-id="' + id + '"]');
                        if (ribbon) { ribbon.classList.remove('bm-ribbon-pulse'); void ribbon.offsetWidth; ribbon.classList.add('bm-ribbon-pulse'); }
                    }
                    app.showToast('📖 Pág. ' + (bm.pageIndex + 1) + ' — ' + bm.title);
                }, 280);
            }, wasOpen ? 180 : 0);
        },

        _deleteItem: function(id) {
            var doc = app.getDoc();
            this.remove(doc, id);
            this.renderPanel();
            this._refreshRibbons();
            this._refreshThumbDots();
        },

        _editTitle: function(id) {
            var self = this;
            var doc = app.getDoc();
            var all = this.getAll(doc);
            var bm = null;
            for (var i = 0; i < all.length; i++) { if (all[i].id === id) { bm = all[i]; break; } }
            if (!bm) return;
            var titleEl = document.getElementById('bm-title-' + id);
            if (!titleEl) return;
            titleEl.contentEditable = 'true';
            titleEl.focus();
            var range = document.createRange();
            range.selectNodeContents(titleEl);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            var originalTitle = bm.title;
            var finish = function() {
                titleEl.contentEditable = 'false';
                self.update(doc, id, { title: titleEl.textContent.trim() || originalTitle });
                titleEl.removeEventListener('blur', finish);
                titleEl.removeEventListener('keydown', kd);
            };
            var kd = function(e) { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } };
            titleEl.addEventListener('blur', finish);
            titleEl.addEventListener('keydown', kd);
        },

        openModal: function(pageIndex) {
            var doc = app.getDoc();
            if (!doc || !doc.pages.length) { app.showToast('⚠️ No hay documento abierto'); return; }
            this._pendingPageIndex = (pageIndex !== undefined ? pageIndex : (doc.currentIndex || 0));
            var self = this;
            var row = document.getElementById('bm-color-row');
            if (row) {
                row.innerHTML = this._colors.map(function(c) {
                    return '<div class="bm-color-swatch' + (c === self._selectedColor ? ' selected' : '') +
                           '" style="background:' + c + '" data-color="' + c +
                           '" onclick="BookmarkManager._selectColor(\'' + c + '\',this)"></div>';
                }).join('');
            }
            var input = document.getElementById('bm-modal-title-input');
            if (input) {
                input.value = this._autoTitle(doc, this._pendingPageIndex);
                setTimeout(function() { input.select(); }, 60);
            }
            // Inyectar fecha y hora
            var dtEl = document.getElementById('bm-modal-datetime');
            if (dtEl) {
                var now = new Date();
                var dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
                var dia = dias[now.getDay()];
                var dd = String(now.getDate()).padStart(2,'0');
                var mm = String(now.getMonth()+1).padStart(2,'0');
                var yyyy = now.getFullYear();
                var hh = String(now.getHours()).padStart(2,'0');
                var min = String(now.getMinutes()).padStart(2,'0');
                dtEl.textContent = dia + ' ' + dd + '/' + mm + '/' + yyyy + '  ' + hh + ':' + min;
            }
            var modal = document.getElementById('bookmark-create-modal');
            if (!modal) return;
            modal.classList.add('visible');
            modal.style.left = '50%';
            modal.style.top = '50%';
            modal.style.transform = 'translate(-50%, -50%)';
            if (this._panelOpen) this.togglePanel();
        },

        _selectColor: function(color, el) {
            this._selectedColor = color;
            document.querySelectorAll('.bm-color-swatch').forEach(function(s) { s.classList.remove('selected'); });
            el.classList.add('selected');
        },

        closeModal: function() {
            var modal = document.getElementById('bookmark-create-modal');
            if (modal) modal.classList.remove('visible');
        },

        confirmCreate: function() {
            var self = this;
            var doc = app.getDoc();
            var input = document.getElementById('bm-modal-title-input');
            var title = (input ? input.value.trim() : '') || this._autoTitle(doc, this._pendingPageIndex);
            var bm = this.add(doc, this._pendingPageIndex, title, this._selectedColor);
            this.closeModal();
            if (bm) {
                this._refreshRibbons();
                this._refreshThumbDots();
                app.showToast('🔖 Marcador añadido — Pág. ' + (this._pendingPageIndex + 1));
                setTimeout(function() {
                    var panelId = (app.splitView && app.splitView.activePanel) || 'primary';
                    var elements = app.getPanelElements && app.getPanelElements(panelId);
                    var container = elements && elements.canvasContainer;
                    if (container) {
                        var ribbon = container.querySelector('.bm-ribbon[data-bm-id="' + bm.id + '"]');
                        if (ribbon) { ribbon.classList.remove('bm-ribbon-pulse'); void ribbon.offsetWidth; ribbon.classList.add('bm-ribbon-pulse'); }
                    }
                }, 60);
            }
        },

        _renderRibbons: function(doc, pageIndex, container) {
            if (!container) return;
            container.querySelectorAll('.bm-ribbon').forEach(function(r) { r.remove(); });
            if (!this._showRibbons || !doc) return;
            var self = this;
            var bms = this.getAll(doc).filter(function(b) { return b.pageIndex === pageIndex; });
            bms.forEach(function(bm, i) {
                var ribbon = document.createElement('div');
                ribbon.className = 'bm-ribbon';
                ribbon.dataset.bmId = bm.id;
                ribbon.style.background = bm.color;
                ribbon.style.top = (20 + i * 40) + 'px';
                ribbon.title = bm.title + ' — Pág. ' + (bm.pageIndex + 1);
                ribbon.onclick = function() { self._navigate(bm.id); };
                container.style.position = 'relative';
                container.appendChild(ribbon);
            });
        },

        _refreshRibbons: function() {
            var doc = app.getDoc();
            var panelId = (app.splitView && app.splitView.activePanel) || 'primary';
            var elements = app.getPanelElements && app.getPanelElements(panelId);
            if (!elements) return;
            var idx = doc ? (doc.currentIndex || 0) : 0;
            this._renderRibbons(doc, idx, elements.canvasContainer);
        },

        _injectThumbDot: function(thumbEl, pageIndex) {
            var doc = app.getDoc();
            if (!doc) return;
            thumbEl.querySelectorAll('.bm-thumb-dot').forEach(function(d) { d.remove(); });
            var bms = this.getAll(doc).filter(function(b) { return b.pageIndex === pageIndex; });
            if (!bms.length) return;
            var dot = document.createElement('div');
            dot.className = 'bm-thumb-dot';
            dot.style.background = bms[bms.length - 1].color;
            thumbEl.style.position = 'relative';
            thumbEl.appendChild(dot);
        },

        _refreshThumbDots: function() {
            var self = this;
            var doc = app.getDoc();
            if (!doc) return;
            document.querySelectorAll('.thumb-wrap').forEach(function(el) {
                var i = parseInt(el.dataset.index);
                if (!isNaN(i)) self._injectThumbDot(el, i);
            });
        },

        init: function() {
            var self = this;
            document.addEventListener('mousedown', function(e) {
                var modal = document.getElementById('bookmark-create-modal');
                if (modal && modal.classList.contains('visible') && !modal.contains(e.target)) {
                    self.closeModal();
                }
                if (self._panelOpen) {
                    var panel = document.getElementById('bookmark-panel');
                    if (panel && !panel.contains(e.target) &&
                        !e.target.closest('#toggleSbBookmark') &&
                        !e.target.closest('[onclick*="BookmarkManager.togglePanel"]') &&
                        !e.target.closest('[onclick*="BookmarkManager.openModal"]') &&
                        !e.target.closest('[onclick*="BookmarkManager.confirmCreate"]') &&
                        !e.target.closest('#bookmark-create-modal') &&
                        !e.target.closest('#sidebarResizer') &&
                        !e.target.closest('.sidebar-resizer')) {
                        self.togglePanel();
                    }
                }
            });
        }
    };

    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() { BookmarkManager.init(); }, 500);
    });
