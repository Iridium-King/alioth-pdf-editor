    (function(){
        const legalTabs = ['terms', 'privacy', 'ai', 'licenses', 'windows'];
        let activeLegalTab = 'privacy';
        let activeAboutTab = 'features';
        const featureGroups = [
            {
                title: 'Documentos',
                items: ['Abrir, cerrar y organizar documentos en pestañas', 'Guardar, Guardar como, compresión y protección PDF', 'Mover, copiar, extraer, combinar y reordenar páginas', 'Deshacer, rehacer y restaurar versiones originales']
            },
            {
                title: 'Edición y anotación',
                items: ['Editar texto, imágenes y objetos PDF', 'Resaltar, subrayar, tachar, dibujar y agregar formas', 'Insertar comentarios, sellos, firmas y campos de formulario', 'Detectar, rellenar y revisar tablas y áreas de tabla']
            },
            {
                title: 'IA y automatización',
                items: ['Traducir documentos con revisión y reconstrucción verificadas', 'Extraer datos, formularios, emails, teléfonos y texto OCR', 'Usar proveedores de IA configurados por el usuario con fallback', 'Conectar asistentes compatibles mediante MCP (Model Context Protocol)', 'Consultar, buscar, editar y organizar PDF con el servidor MCP local del proyecto']
            },
            {
                title: 'Visualización y salida',
                items: ['Zoom, navegación continua, miniaturas y panel de índice', 'Imprimir y exportar páginas o imágenes', 'Convertir documentos de Office a PDF', 'Gestionar metadatos, permisos, formularios y firmas digitales']
            }
        ];

        function renderLegalInto(prefix){
            const legal = window.aliothLegal;
            const tabs = document.getElementById(prefix + '-legal-tabs');
            const title = document.getElementById(prefix + '-legal-title');
            const body = document.getElementById(prefix + '-legal-body');
            const contact = document.getElementById(prefix + '-legal-contact');
            const enableAi = document.getElementById(prefix + '-enable-ai');
            if(!legal || !tabs || !title || !body || !contact) return;
            const locale = window.i18n?.getCurrentLanguage?.() || document.documentElement.lang || 'es';
            const copy = legal.getCopy(locale);
            const actions = legal.getActions(locale);
            tabs.replaceChildren();
            legalTabs.forEach(key => {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('role', 'tab');
                button.setAttribute('aria-selected', String(key === activeLegalTab));
                button.textContent = copy[key].title;
                button.style.cssText = `border:1px solid ${key === activeLegalTab ? 'rgba(99,102,241,.7)' : 'rgba(255,255,255,.14)'};border-radius:999px;background:${key === activeLegalTab ? 'rgba(99,102,241,.22)' : 'rgba(255,255,255,.04)'};color:${key === activeLegalTab ? '#e0e7ff' : '#aeb8d4'};padding:6px 10px;font-size:10px;cursor:pointer;`;
                button.onclick = () => { activeLegalTab = key; renderLegal(); };
                tabs.append(button);
            });
            title.textContent = copy[activeLegalTab].title;
            body.textContent = copy[activeLegalTab].body;
            body.style.whiteSpace = activeLegalTab === 'windows' ? 'pre-line' : '';
            contact.textContent = `${legal.common.project} · ${legal.common.contact}`;
            if (enableAi) {
                const enabled = legal.isAiEnabled(window.localStorage);
                enableAi.style.display = activeLegalTab === 'ai' && !enabled ? 'inline-block' : 'none';
                enableAi.textContent = actions.ai;
                enableAi.onclick = () => {
                    legal.setNoticeState(window.localStorage, 'ai');
                    renderLegal();
                    window.dispatchEvent(new CustomEvent('alioth:legal-ready', { detail: { state: 'ai' } }));
                };
            }
        }
        function renderLegal(){ renderLegalInto('about'); renderLegalInto('pref'); }

        function renderFeatures(){
            const container = document.getElementById('about-features-container');
            if(!container) return;
            container.replaceChildren();
            featureGroups.forEach(group => {
                const section = document.createElement('section');
                section.className = 'about-feature-card';
                section.style.cssText = 'padding:12px 14px;border:1px solid rgba(99,102,241,0.22);border-radius:12px;background:rgba(99,102,241,0.06);';
                const heading = document.createElement('h4');
                heading.textContent = group.title;
                heading.style.cssText = 'margin:0 0 8px;color:rgba(225,230,255,0.96);font-size:12px;';
                section.append(heading);
                const list = document.createElement('ul');
                list.style.cssText = 'list-style:none;padding:0;margin:0;display:grid;gap:5px;';
                group.items.forEach(text => {
                    const item = document.createElement('li');
                    item.textContent = `• ${text}`;
                    item.style.cssText = 'font-size:11px;line-height:1.4;color:rgba(220,225,255,0.82);';
                    list.append(item);
                });
                section.append(list);
                container.append(section);
            });
        }

        function renderAboutTabs(){
            const tabs = document.getElementById('about-main-tabs');
            const features = document.getElementById('about-features-container');
            const changelog = document.getElementById('about-changelog-panel');
            const legal = document.getElementById('about-legal-panel');
            if(!tabs || !features || !changelog || !legal) return;
            const labels = { features: 'Funciones', changelog: 'Changelog', legal: 'Legal' };
            tabs.replaceChildren();
            Object.entries(labels).forEach(([key, label]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('role', 'tab');
                button.setAttribute('aria-selected', String(key === activeAboutTab));
                button.textContent = label;
                button.style.cssText = `border:1px solid ${key === activeAboutTab ? 'rgba(129,140,248,.82)' : 'transparent'};border-radius:8px;background:${key === activeAboutTab ? 'rgba(99,102,241,.24)' : 'transparent'};color:${key === activeAboutTab ? '#eef2ff' : '#aeb8d4'};padding:8px 12px;font-size:10px;font-weight:700;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease;`;
                button.onclick = () => { activeAboutTab = key; renderAboutTabs(); };
                tabs.append(button);
            });
            features.style.display = activeAboutTab === 'features' ? 'grid' : 'none';
            changelog.style.display = activeAboutTab === 'changelog' ? 'block' : 'none';
            legal.style.display = activeAboutTab === 'legal' ? 'block' : 'none';
        }

        // ═══════════════════════════════════════════════════════════════
        // ── CHANGELOG ───
        // ═══════════════════════════════════════════════════════════════
        let changelogSearch = '';
        let changelogTypeFilter = 'all';
        const CHANGELOG_PAGE_SIZE = 5;
        let recentLimit = CHANGELOG_PAGE_SIZE;

        const OUTLINE_ICONS = {
            check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;display:inline-block;"><polyline points="20 6 9 17 4 12"/></svg>',
            wrench: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;display:inline-block;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
            zap: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;display:inline-block;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
            sparkle: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;display:inline-block;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>'
        };

        const TYPE_CONFIG = {
            new: { label: 'Novedades', icon: OUTLINE_ICONS.check, color: '#10b981' },
            feature: { label: 'Novedades', icon: OUTLINE_ICONS.check, color: '#10b981' },
            feat: { label: 'Novedades', icon: OUTLINE_ICONS.check, color: '#10b981' },
            fix: { label: 'Correcciones', icon: OUTLINE_ICONS.wrench, color: '#f59e0b' },
            improve: { label: 'Mejoras', icon: OUTLINE_ICONS.zap, color: '#3b82f6' },
            improvement: { label: 'Mejoras', icon: OUTLINE_ICONS.zap, color: '#3b82f6' },
            change: { label: 'Cambios', icon: OUTLINE_ICONS.sparkle, color: '#a855f7' },
            ui: { label: 'Interfaz', icon: OUTLINE_ICONS.sparkle, color: '#a855f7' }
        };

        function renderChangelogItem(item, highlight) {
            const t = item.type || 'new';
            const cfg = TYPE_CONFIG[t] || TYPE_CONFIG.new;
            let text = item.text || '';
            if (highlight && highlight.length >= 2) {
                try {
                    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})`, 'gi');
                    text = text.replace(regex, '<mark style="background:rgba(99,102,241,0.45);color:#fff;border-radius:2px;padding:0 2px;">$1</mark>');
                } catch(e){}
            }
            return `<li style="display:flex;gap:9px;align-items:flex-start;font-size:11px;line-height:1.45;color:rgba(220,225,255,0.85);">
                <span style="color:${cfg.color};font-size:12px;flex-shrink:0;margin-top:1px;">${cfg.icon}</span>
                <span>${text}</span>
            </li>`;
        }

        function renderVersionCard(entry, isCurrent, highlight) {
            let html = `<article style="margin-bottom:8px;padding:12px 14px;border:1px solid ${isCurrent ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'};border-radius:12px;background:${isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.025)'};">`;
            html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">`;
            html += `<div style="display:flex;align-items:center;gap:7px;">`;
            html += `<span style="font-size:12px;font-weight:700;color:${isCurrent ? '#c7d2fe' : 'rgba(180,190,255,0.95)'};">v${entry.version}</span>`;
            if (isCurrent) {
                html += `<span style="padding:2px 7px;border-radius:999px;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Versión Actual</span>`;
            }
            html += `</div>`;
            if (entry.date) {
                html += `<span style="font-size:10px;color:rgba(180,190,220,0.55);">${entry.date}</span>`;
            }
            html += `</div>`;
            html += `<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;">`;
            (entry.items || []).forEach(it => {
                html += renderChangelogItem(it, highlight);
            });
            html += `</ul></article>`;
            return html;
        }

        function getChangelogStats() {
            let total = ALIOTH_CHANGELOG.length;
            let fixes = 0, news = 0, improves = 0;
            ALIOTH_CHANGELOG.forEach(e => {
                (e.items || []).forEach(it => {
                    const t = it.type || 'new';
                    if (t === 'fix') fixes++;
                    else if (['new', 'feature', 'feat'].includes(t)) news++;
                    else if (['improve', 'improvement'].includes(t)) improves++;
                });
            });
            return { total, fixes, news, improves };
        }

        function updateChangelogView(container) {
            const listEl = container.querySelector('#about-cl-list');
            const statusEl = container.querySelector('#about-cl-status');
            const filtersEl = container.querySelector('#about-cl-filters');
            if (!listEl) return;

            // Actualizar botones de filtro
            if (filtersEl) {
                const stats = getChangelogStats();
                const filterDefs = [
                    { key: 'all', label: 'Todos', count: stats.total, icon: '' },
                    { key: 'new', label: 'Novedades', count: stats.news, icon: OUTLINE_ICONS.check },
                    { key: 'improve', label: 'Mejoras', count: stats.improves, icon: OUTLINE_ICONS.zap },
                    { key: 'fix', label: 'Correcciones', count: stats.fixes, icon: OUTLINE_ICONS.wrench }
                ];
                filtersEl.replaceChildren();
                filterDefs.forEach(f => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'about-cl-filter-btn';
                    btn.dataset.filter = f.key;
                    btn.innerHTML = `${f.icon ? f.icon + ' ' : ''}${f.label} (${f.count})`;
                    const isActive = changelogTypeFilter === f.key;
                    btn.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:5px 10px;font-size:10px;font-weight:600;border-radius:999px;cursor:pointer;transition:all .15s ease;border:1px solid ${isActive ? 'rgba(129,140,248,0.85)' : 'rgba(255,255,255,0.1)'};background:${isActive ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.04)'};color:${isActive ? '#eef2ff' : '#aeb8d4'};`;
                    filtersEl.append(btn);
                });
            }

            const isFiltering = !!(changelogSearch || changelogTypeFilter !== 'all');

            if (isFiltering) {
                // Modo búsqueda / filtro activo
                const q = changelogSearch.trim().toLowerCase();
                const tf = changelogTypeFilter;
                const filtered = [];
                let totalMatchingItems = 0;

                ALIOTH_CHANGELOG.forEach(entry => {
                    let items = entry.items || [];
                    if (tf !== 'all') {
                        items = items.filter(it => {
                            const t = it.type || 'new';
                            if (tf === 'new') return ['new', 'feature', 'feat'].includes(t);
                            if (tf === 'fix') return t === 'fix';
                            if (tf === 'improve') return ['improve', 'improvement'].includes(t);
                            return true;
                        });
                    }
                    if (q) {
                        const vMatch = (entry.version || '').toLowerCase().includes(q) || (entry.date && entry.date.toLowerCase().includes(q));
                        if (!vMatch) {
                            items = items.filter(it => (it.text || '').toLowerCase().includes(q));
                        }
                    }
                    if (items.length > 0) {
                        filtered.push({ ...entry, items });
                        totalMatchingItems += items.length;
                    }
                });

                if (statusEl) {
                    statusEl.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-radius:8px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);font-size:11px;color:#c7d2fe;">
                            <span>Encontradas <strong>${filtered.length}</strong> versiones (<strong>${totalMatchingItems}</strong> cambios) coincidentes</span>
                            <button type="button" id="about-cl-reset-btn" style="background:none;border:none;color:#818cf8;font-size:10px;font-weight:700;cursor:pointer;text-decoration:underline;display:inline-flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Limpiar filtros</button>
                        </div>
                    `;
                }

                if (filtered.length === 0) {
                    listEl.innerHTML = `<div style="text-align:center;padding:36px 12px;color:rgba(200,210,255,0.6);font-size:12px;">No se encontraron cambios que coincidan con la búsqueda o filtro seleccionado.</div>`;
                    return;
                }

                let html = '';
                filtered.forEach(entry => {
                    html += renderVersionCard(entry, entry.version === ALIOTH_VERSION, q);
                });
                listEl.innerHTML = html;
            } else {
                if (statusEl) statusEl.replaceChildren();

                let html = ALIOTH_CHANGELOG.slice(0, recentLimit)
                    .map(entry => renderVersionCard(entry, entry.version === ALIOTH_VERSION, ''))
                    .join('');
                const remaining = ALIOTH_CHANGELOG.length - recentLimit;
                if (remaining > 0) {
                    const count = Math.min(CHANGELOG_PAGE_SIZE, remaining);
                    const label = count === 1 ? 'versión anterior' : 'versiones anteriores';
                    html += `<button type="button" id="about-cl-more" style="width:100%;padding:9px;margin-bottom:16px;background:rgba(99,102,241,0.14);border:1px dashed rgba(99,102,241,0.4);border-radius:10px;color:#c7d2fe;font-size:11px;font-weight:600;cursor:pointer;">
                        Ver ${count} ${label}
                    </button>`;
                }

                listEl.innerHTML = html;
            }
        }

        function setupChangelogContainer(container) {
            container.innerHTML = `
                <div id="about-cl-toolbar" style="margin-bottom:12px;">
                    <div style="position:relative;margin-bottom:8px;">
                        <input type="text" id="about-cl-search" placeholder="Buscar cambios, funciones, versiones..." value="${changelogSearch}" style="width:100%;box-sizing:border-box;padding:8px 32px 8px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#eef2ff;font-size:11px;outline:none;transition:border-color .15s ease;" />
                        <button type="button" id="about-cl-clear" style="display:${changelogSearch ? 'flex' : 'none'};align-items:center;justify-content:center;position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;padding:4px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                    </div>
                    <div id="about-cl-filters" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                </div>
                <div id="about-cl-status" style="margin-bottom:10px;"></div>
                <div id="about-cl-list"></div>
            `;

            const searchInput = container.querySelector('#about-cl-search');
            const clearBtn = container.querySelector('#about-cl-clear');

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    changelogSearch = e.target.value;
                    if (clearBtn) clearBtn.style.display = changelogSearch ? 'block' : 'none';
                    updateChangelogView(container);
                });
            }
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    changelogSearch = '';
                    if (searchInput) searchInput.value = '';
                    clearBtn.style.display = 'none';
                    updateChangelogView(container);
                });
            }

            container.addEventListener('click', (e) => {
                const target = e.target.closest('button');
                if (!target) return;

                if (target.classList.contains('about-cl-filter-btn')) {
                    changelogTypeFilter = target.dataset.filter;
                    updateChangelogView(container);
                } else if (target.id === 'about-cl-more') {
                    recentLimit += CHANGELOG_PAGE_SIZE;
                    updateChangelogView(container);
                } else if (target.id === 'about-cl-reset-btn') {
                    changelogSearch = '';
                    changelogTypeFilter = 'all';
                    if (searchInput) searchInput.value = '';
                    if (clearBtn) clearBtn.style.display = 'none';
                    updateChangelogView(container);
                }
            });

            updateChangelogView(container);
        }

        function renderAbout(){
            const vLabel = document.getElementById('about-version-label');
            if(vLabel) vLabel.textContent = 'Versión ' + ALIOTH_VERSION;
            const btn = document.getElementById('about-btn');
            const _sp = document.getElementById('about-btn-label') || (btn && btn.querySelector('span:last-child')); if(_sp) _sp.textContent='About v'+ALIOTH_VERSION;
            renderLegal();
            renderFeatures();
            const container = document.getElementById('about-changelog-container');
            if(!container || typeof ALIOTH_CHANGELOG === 'undefined') { renderAboutTabs(); return; }

            if (!container.querySelector('#about-cl-toolbar')) {
                setupChangelogContainer(container);
            } else {
                updateChangelogView(container);
            }

            renderAboutTabs();
        }

        window.renderAbout = renderAbout;
        window.renderAliothLegal = renderLegal;
        window.addEventListener('app:languagechange', renderAbout);
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', renderAbout);
        else renderAbout();
    })();
