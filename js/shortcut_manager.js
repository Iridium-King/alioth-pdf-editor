/**
 * Alioth PDF Editor - Shortcut Manager
 * Gestiona atajos de teclado personalizables, sincronización con la Paleta de Comandos (Ctrl+K)
 * y combinaciones clásicas populares estilo Microsoft Excel y Adobe Acrobat.
 */
(function () {
    const STORAGE_KEY = 'alioth_custom_shortcuts';

    const DEFAULT_SHORTCUTS = [
        // Formato (estilo Excel / Word / Acrobat)
        {
            id: 'format_bold',
            title: 'Negrita (Bold)',
            category: 'Formato',
            defaultKey: 'Ctrl+B',
            description: 'Aplica o desactiva negrita al texto seleccionado o al editor activo',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
            action: () => app.toggleBoldShortcut?.()
        },
        {
            id: 'format_italic',
            title: 'Cursiva (Italic)',
            category: 'Formato',
            defaultKey: 'Ctrl+I',
            description: 'Aplica o desactiva cursiva al texto seleccionado o al editor activo',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
            action: () => app.toggleItalicShortcut?.()
        },
        {
            id: 'format_underline',
            title: 'Subrayado (Underline)',
            category: 'Formato',
            defaultKey: 'Ctrl+U',
            description: 'Aplica o desactiva subrayado al texto seleccionado o al editor activo',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
            action: () => app.toggleUnderlineShortcut?.()
        },

        // Archivo (estilo Adobe Acrobat)
        {
            id: 'file_save',
            title: 'Guardar PDF',
            category: 'Archivo',
            defaultKey: 'Ctrl+S',
            description: 'Guarda los cambios realizados directamente en el archivo PDF',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3 3-1.34 3-3zm3-10H5V5h10v4z"/></svg>',
            action: () => app.savePDF?.()
        },
        {
            id: 'file_save_as',
            title: 'Guardar como...',
            category: 'Archivo',
            defaultKey: 'Ctrl+Shift+S',
            description: 'Guarda una copia del documento con otro nombre o ubicación',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
            action: () => app.showSaveModal?.()
        },
        {
            id: 'file_open',
            title: 'Abrir archivo...',
            category: 'Archivo',
            defaultKey: 'Ctrl+O',
            description: 'Abre un nuevo documento PDF o archivo de Office',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
            action: () => app.openNativeFileDialog?.()
        },
        {
            id: 'file_print',
            title: 'Imprimir documento',
            category: 'Archivo',
            defaultKey: 'Ctrl+P',
            description: 'Abre la ventana de diálogo para imprimir el documento actual',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>',
            action: () => app.showPrintModal?.()
        },
        {
            id: 'file_close',
            title: 'Cerrar documento actual',
            category: 'Archivo',
            defaultKey: 'Ctrl+W',
            description: 'Cierra la pestaña del documento activo',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
            action: () => app.closeDocument?.()
        },

        // Edición & Búsqueda
        {
            id: 'search_find',
            title: 'Buscar en documento',
            category: 'Búsqueda',
            defaultKey: 'Ctrl+F',
            description: 'Expande el widget flotante inferior para buscar texto en las páginas',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
            action: () => app.expandSearchWidget?.(true)
        },
        {
            id: 'cmd_palette',
            title: 'Paleta de Comandos',
            category: 'General',
            defaultKey: 'Ctrl+K',
            description: 'Muestra la paleta interactiva para ejecutar cualquier comando o herramienta',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
            action: () => app.toggleCommandPalette?.()
        },
        {
            id: 'edit_undo',
            title: 'Deshacer',
            category: 'Edición',
            defaultKey: 'Ctrl+Z',
            description: 'Revierte la última acción efectuada en el documento',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>',
            action: () => app.undo?.()
        },
        {
            id: 'edit_redo',
            title: 'Rehacer',
            category: 'Edición',
            defaultKey: 'Ctrl+Y',
            description: 'Vuelve a aplicar la última acción deshecha',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>',
            action: () => app.redo?.()
        },
        {
            id: 'tool_add_text',
            title: 'Añadir nuevo texto',
            category: 'Edición',
            defaultKey: 'Ctrl+T',
            description: 'Inserta un nuevo bloque de texto libre en la página',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
            action: () => app.addText?.()
        },
        {
            id: 'tool_smart_patch',
            title: 'Editar texto directo (Smart Patch)',
            category: 'Edición',
            defaultKey: 'Ctrl+Shift+E',
            description: 'Edita texto original directamente sobre el documento PDF',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg>',
            action: () => app.startSmartPatch?.()
        },

        // Vista & Zoom
        {
            id: 'zoom_in',
            title: 'Acercar zoom',
            category: 'Vista',
            defaultKey: 'Ctrl++',
            description: 'Aumenta el nivel de escala del visor',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
            action: () => app.zoomIn?.()
        },
        {
            id: 'zoom_out',
            title: 'Alejar zoom',
            category: 'Vista',
            defaultKey: 'Ctrl+-',
            description: 'Reduce el nivel de escala del visor',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
            action: () => app.zoomOut?.()
        },
        {
            id: 'zoom_reset',
            title: 'Restablecer zoom (100%)',
            category: 'Vista',
            defaultKey: 'Ctrl+0',
            description: 'Restaura la escala visual al 100% original',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>',
            action: () => app.zoom?.(1.0 - (app.currentScale || 1.0))
        },
        {
            id: 'view_continuous',
            title: 'Vista continua',
            category: 'Vista',
            defaultKey: 'Ctrl+Alt+C',
            description: 'Alterna entre vista continua vertical y vista por página individual',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h10v18H7z M7 9h10 M7 15h10"/></svg>',
            action: () => app.toggleViewMode?.()
        },
        {
            id: 'view_twoup',
            title: 'Vista dos páginas (Libro)',
            category: 'Vista',
            defaultKey: 'Ctrl+Alt+D',
            description: 'Muestra dos páginas enfrentadas en paralelo estilo revista/libro',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4h9v16H2z M13 4h9v16h-9z"/></svg>',
            action: () => app.toggleTwoUpView?.()
        },
        {
            id: 'view_reading',
            title: 'Modo lectura sin distracciones',
            category: 'Vista',
            defaultKey: 'F11',
            description: 'Oculta barras de herramientas para maximizar el área de lectura',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="14" r="4"/><circle cx="18" cy="14" r="4"/><path d="M10 14h4"/><path d="M2 14l2-6a2 2 0 0 1 2-1h1"/><path d="M22 14l-2-6a2 2 0 0 0-2-1h-1"/></svg>',
            action: () => app.toggleReadingMode?.()
        },

        // Herramientas & Navegación
        {
            id: 'tool_hand',
            title: 'Herramienta Mano (Pan & Scroll)',
            category: 'Herramientas',
            defaultKey: 'H',
            description: 'Arrastra el canvas del PDF con el cursor para desplazarte con suavidad',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7,21 L5.5,11 L5.5,7 A1.5,1.5 0 0 1 8.5,7 L8.5,11 L8.5,5 A1.5,1.5 0 0 1 11.5,5 L11.5,11 L11.5,2.45 A1.5,1.5 0 0 1 14.5,2.45 L14.5,11 L14.5,5 A1.5,1.5 0 0 1 17.5,5 L17.5,12 L20.5,10 A1.5,1.5 0 0 1 22,12.5 L18.5,15.5 Q17.5,16.5 17.5,18 L16,21 Q11.5,23 7,21 Z"/></svg>',
            action: () => app.toggleHandMode?.()
        },
        {
            id: 'tab_reopen',
            title: 'Reabrir pestaña cerrada',
            category: 'Pestañas',
            defaultKey: 'Ctrl+Shift+T',
            description: 'Restaura el último documento que fue cerrado recientemente',
            icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
            action: () => app.reopenLastClosedTab?.()
        }
    ];

    class ShortcutManager {
        constructor() {
            this.shortcuts = [];
            this.customMap = {};
            this.recordingActionId = null;
            this.recordingKeyHandler = null;
            this.filterQuery = '';
            this.filterCat = 'all';

            this.loadCustomMap();
            this.buildShortcutList();
            this.bindGlobalKeyboard();
        }

        loadCustomMap() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                this.customMap = raw ? JSON.parse(raw) : {};
            } catch (e) {
                console.warn('Error cargando atajos personalizados:', e);
                this.customMap = {};
            }
        }

        saveToStorage() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.customMap));
            } catch (e) {
                console.warn('Error guardando atajos:', e);
            }
        }

        buildShortcutList() {
            this.shortcuts = DEFAULT_SHORTCUTS.map(def => {
                const currentKey = this.customMap[def.id] !== undefined ? this.customMap[def.id] : def.defaultKey;
                return {
                    ...def,
                    currentKey: currentKey
                };
            });
        }

        getShortcutForAction(actionId) {
            if (this.customMap[actionId] !== undefined) {
                return this.customMap[actionId];
            }
            const found = DEFAULT_SHORTCUTS.find(d => d.id === actionId);
            return found ? found.defaultKey : '';
        }

        setShortcut(actionId, newKey) {
            this.customMap[actionId] = newKey;
            this.saveToStorage();
            this.buildShortcutList();
            this.renderList();
        }

        resetShortcut(actionId) {
            delete this.customMap[actionId];
            this.saveToStorage();
            this.buildShortcutList();
            this.renderList();
        }

        resetDefaults() {
            this.customMap = {};
            this.saveToStorage();
            this.buildShortcutList();
            this.renderList();
            if (window.app && typeof app.showToast === 'function') {
                app.showToast('Atajos restablecidos a los valores predeterminados');
            }
        }

        // Convierte un evento de teclado en un string estandarizado ("Ctrl+B", "Ctrl+Shift+S", etc.)
        parseKeyboardEvent(e) {
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');

            let key = e.key;
            if (key === ' ') key = 'Space';
            else if (key === '+') key = '+';
            else if (key === '-') key = '-';
            else if (key.length === 1) key = key.toUpperCase();

            // Si no hay modificadores y es una tecla imprimible normal (no F1-F12, no Escape/Enter/Home/End/Arrows)
            const isSpecialSingle = /^F\d{1,2}$/i.test(key) || ['Escape', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'H'].includes(key);
            if (parts.length === 0 && !isSpecialSingle) {
                return null; // Exigir combinación con Ctrl/Alt/Shift para teclas alfabéticas comunes
            }

            parts.push(key);
            return parts.join('+');
        }

        // Verifica si un evento de teclado coincide con un string de atajo
        matchesShortcut(e, shortcutStr) {
            if (!shortcutStr) return false;
            const parts = shortcutStr.split('+').map(p => p.trim());
            const hasCtrl = parts.some(p => p.toLowerCase() === 'ctrl');
            const hasAlt = parts.some(p => p.toLowerCase() === 'alt');
            const hasShift = parts.some(p => p.toLowerCase() === 'shift');

            if (hasCtrl !== (e.ctrlKey || e.metaKey)) return false;
            if (hasAlt !== e.altKey) return false;
            if (hasShift !== e.shiftKey) return false;

            const targetKey = parts.filter(p => !['ctrl', 'alt', 'shift'].includes(p.toLowerCase()))[0];
            if (!targetKey) return false;

            const eventKey = e.key;
            const targetLower = targetKey.toLowerCase();
            const eventLower = eventKey.toLowerCase();

            if (targetLower === '+' && (eventKey === '+' || eventKey === '=')) return true;
            if (targetLower === '-' && (eventKey === '-' || eventKey === '_')) return true;
            if (targetLower === 'space' && eventKey === ' ') return true;

            return eventLower === targetLower;
        }

        bindGlobalKeyboard() {
            window.addEventListener('keydown', (e) => {
                // Si estamos grabando un atajo para la configuración, capturarlo y salir
                if (this.recordingActionId) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.key === 'Escape') {
                        this.stopRecording();
                        return;
                    }

                    const combo = this.parseKeyboardEvent(e);
                    if (combo) {
                        this.setShortcut(this.recordingActionId, combo);
                        this.stopRecording();
                        if (window.app && typeof app.showToast === 'function') {
                            app.showToast(`Atajo asignado: ${combo}`);
                        }
                    }
                    return;
                }

                // Si un input nativo de texto de diálogo tiene foco activo, permitimos los atajos de formato (Ctrl+B, Ctrl+I, Ctrl+U)
                // y los atajos de guardado/impresión/búsqueda (Ctrl+S, Ctrl+P, Ctrl+F, Ctrl+Z, Ctrl+Y),
                // pero ignoramos teclas simples como 'H' o números para no interferir con la escritura.
                const activeEl = document.activeElement;
                const isWritingInInput = activeEl && (
                    activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'TEXTAREA' ||
                    activeEl.tagName === 'SELECT'
                );

                // Buscar si coincide con alguna acción registrada
                for (const item of this.shortcuts) {
                    if (!item.currentKey) continue;
                    if (this.matchesShortcut(e, item.currentKey)) {
                        // Si está escribiendo en un input y el atajo no tiene Ctrl ni Alt, dejar pasar la tecla
                        if (isWritingInInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
                            continue;
                        }

                        // Permitir ejecutar la acción
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            if (typeof item.action === 'function') {
                                item.action();
                            }
                        } catch (err) {
                            console.error(`Error ejecutando acción de atajo ${item.id}:`, err);
                        }
                        return;
                    }
                }
            }, true);
        }

        startRecording(actionId) {
            this.recordingActionId = actionId;
            this.renderList();
        }

        stopRecording() {
            this.recordingActionId = null;
            this.renderList();
        }

        filterUI(query) {
            this.filterQuery = (query || '').toLowerCase().trim();
            this.renderList();
        }

        filterCategory(category) {
            this.filterCat = category || 'all';
            this.renderList();
        }

        renderList() {
            const container = document.getElementById('pref-shortcuts-list');
            if (!container) return;

            const filtered = this.shortcuts.filter(item => {
                if (this.filterCat !== 'all' && item.category !== this.filterCat) return false;
                if (!this.filterQuery) return true;
                return (
                    item.title.toLowerCase().includes(this.filterQuery) ||
                    item.description.toLowerCase().includes(this.filterQuery) ||
                    (item.currentKey && item.currentKey.toLowerCase().includes(this.filterQuery)) ||
                    item.category.toLowerCase().includes(this.filterQuery)
                );
            });

            if (filtered.length === 0) {
                container.innerHTML = '<div style="padding:24px; text-align:center; color:#64748b; font-size:12px;">No se encontraron funciones coincidentes</div>';
                return;
            }

            let html = '';
            filtered.forEach(item => {
                const isRecording = this.recordingActionId === item.id;
                const hasCustom = this.customMap[item.id] !== undefined && this.customMap[item.id] !== item.defaultKey;

                // Render key badge
                let keyBadgeHtml = '';
                if (isRecording) {
                    keyBadgeHtml = `<span style="background:rgba(239,68,68,0.2); border:1px dashed #ef4444; color:#fca5a5; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; animation:pulse 1.2s infinite; display:inline-flex; align-items:center; gap:6px;">⌨️ Presiona combinación...</span>`;
                } else if (item.currentKey) {
                    const keys = item.currentKey.split('+');
                    keyBadgeHtml = `<div style="display:flex; align-items:center; gap:3px;">` +
                        keys.map(k => `<kbd style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); border-bottom:2px solid rgba(255,255,255,0.25); color:#fff; border-radius:5px; padding:3px 7px; font-size:11px; font-family:monospace; font-weight:600; box-shadow:0 1px 3px rgba(0,0,0,0.3);">${k}</kbd>`).join('<span style="color:#64748b; font-size:10px;">+</span>') +
                        `</div>`;
                } else {
                    keyBadgeHtml = `<span style="color:#64748b; font-size:11px; font-style:italic;">Sin asignar</span>`;
                }

                html += `
                    <div class="pref-shortcut-row" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; transition:border-color 0.15s ease;">
                        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                            <div style="width:30px; height:30px; border-radius:7px; background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2); display:flex; align-items:center; justify-content:center; color:var(--accent,#818cf8); flex-shrink:0;">
                                ${item.icon}
                            </div>
                            <div style="min-width:0;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <strong style="color:#f8fafc; font-size:12.5px;">${item.title}</strong>
                                    <span style="background:rgba(255,255,255,0.06); color:#94a3b8; font-size:9.5px; padding:1px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px;">${item.category}</span>
                                    ${hasCustom ? '<span style="background:rgba(16,185,129,0.15); color:#34d399; font-size:9.5px; padding:1px 6px; border-radius:4px;">Personalizado</span>' : ''}
                                </div>
                                <div style="color:#94a3b8; font-size:11px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.description}</div>
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                            ${keyBadgeHtml}

                            <div style="display:flex; gap:4px;">
                                ${isRecording ? `
                                    <button class="pref-seed-btn secondary" onclick="app.shortcutManager.stopRecording()" style="padding:4px 8px; font-size:11px;">Cancelar (Esc)</button>
                                ` : `
                                    <button class="pref-seed-btn secondary" onclick="app.shortcutManager.startRecording('${item.id}')" title="Reasignar atajo" style="padding:4px 9px; font-size:11px;">Cambiar</button>
                                    ${hasCustom ? `
                                        <button class="pref-seed-btn secondary" onclick="app.shortcutManager.resetShortcut('${item.id}')" title="Restablecer atajo predeterminado (${item.defaultKey})" style="padding:4px 7px; font-size:11px; color:#fca5a5;">↺</button>
                                    ` : ''}
                                `}
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }
    }

    // Inicializar ShortcutManager y asociarlo al objeto global app
    function initShortcutManager() {
        if (!window.app) window.app = {};
        window.app.shortcutManager = new ShortcutManager();

        // Helpers de formato para vincular con ribbon y comandos
        window.app.toggleBoldShortcut = function () {
            const doc = app.getDoc?.();
            const hasSelectedText = doc && doc.pages[doc.currentIndex] &&
                doc.pages[doc.currentIndex].objects.some(o => (app.multiObjectSelection?.has(o.id) || (app.selectedObj && o.id === app.selectedObj.id)) && o.type === 'text');

            const activeEl = document.activeElement;
            const isInline = activeEl && (activeEl.isContentEditable || activeEl.classList?.contains('text-content') || activeEl.closest?.('.text-content'));

            if (hasSelectedText || isInline) {
                app.toggleStyle?.('bold');
            } else {
                const fontSel = document.getElementById('fontFamily');
                if (fontSel) {
                    const cur = fontSel.value;
                    if (cur.includes('-Bold')) {
                        fontSel.value = cur.replace('-Bold', '');
                        app.showToast?.('Estilo normal seleccionado');
                    } else {
                        const boldVariant = cur + '-Bold';
                        if ([...fontSel.options].some(o => o.value === boldVariant)) {
                            fontSel.value = boldVariant;
                        }
                        app.showToast?.('Negrita (Bold) activada para nuevo texto');
                    }
                } else {
                    app.showToast?.('Negrita: selecciona un texto en el documento');
                }
            }
        };

        window.app.toggleItalicShortcut = function () {
            const doc = app.getDoc?.();
            const hasSelectedText = doc && doc.pages[doc.currentIndex] &&
                doc.pages[doc.currentIndex].objects.some(o => (app.multiObjectSelection?.has(o.id) || (app.selectedObj && o.id === app.selectedObj.id)) && o.type === 'text');

            const activeEl = document.activeElement;
            const isInline = activeEl && (activeEl.isContentEditable || activeEl.classList?.contains('text-content') || activeEl.closest?.('.text-content'));

            if (hasSelectedText || isInline) {
                app.toggleStyle?.('italic');
            } else {
                app.showToast?.('Cursiva (Italic): selecciona un texto en el documento');
            }
        };

        window.app.toggleUnderlineShortcut = function () {
            const doc = app.getDoc?.();
            const hasSelectedText = doc && doc.pages[doc.currentIndex] &&
                doc.pages[doc.currentIndex].objects.some(o => (app.multiObjectSelection?.has(o.id) || (app.selectedObj && o.id === app.selectedObj.id)) && o.type === 'text');

            const activeEl = document.activeElement;
            const isInline = activeEl && (activeEl.isContentEditable || activeEl.classList?.contains('text-content') || activeEl.closest?.('.text-content'));

            if (hasSelectedText || isInline) {
                app.toggleStyle?.('underline');
            } else {
                app.showToast?.('Subrayado (Underline): selecciona un texto en el documento');
            }
        };

        // Filtro para el buscador interno de la pestaña Ayuda
        window.app.filterHelpTopics = function (query) {
            const q = (query || '').toLowerCase().trim();
            const topics = document.querySelectorAll('#pref-help .pref-help-topic');
            topics.forEach(el => {
                const text = el.innerText.toLowerCase();
                if (!q || text.includes(q)) {
                    el.style.display = 'block';
                } else {
                    el.style.display = 'none';
                }
            });
        };
    }

    if (window.__appReady || window.app) {
        initShortcutManager();
    } else {
        window.addEventListener('app:ready', initShortcutManager, { once: true });
        window.addEventListener('DOMContentLoaded', initShortcutManager, { once: true });
    }
})();
