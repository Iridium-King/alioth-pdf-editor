        // ============================================================
        // CUSTOM COLOR PICKER LOGIC (ENHANCED)
        // ============================================================
        (function () {
            // Helper de luminosidad inmediato
            const _isDarkHex = (hex) => {
                if (!hex || typeof hex !== 'string') return false;
                const c = hex.trim();
                if (c.startsWith('#')) {
                    let h = c.replace('#', '');
                    if (h.length === 3) h = h.split('').map(x => x + x).join('');
                    const r = parseInt(h.substring(0, 2), 16) || 0;
                    const g = parseInt(h.substring(2, 4), 16) || 0;
                    const b = parseInt(h.substring(4, 6), 16) || 0;
                    return (r * 299 + g * 587 + b * 114) / 1000 < 135;
                }
                return false;
            };

            // 1. APPLY IMMEDIATE (No waiting)
            try {
                // Aplicar dark-mode ANTES que cualquier color para que applyThemePreset vea isDark correcto
                if (localStorage.getItem('alioth_theme') === 'dark') {
                    document.body.classList.add('dark-mode');
                }
                const hColor = localStorage.getItem('customHeaderColor');
                const rColor = localStorage.getItem('customRibbonColor');
                const aColor = localStorage.getItem('customAccentColor');
                if (hColor) {
                    document.body.style.setProperty('--primary', hColor);
                    document.body.style.setProperty('--bg-tabs', hColor);
                }
                if (rColor) {
                    document.body.style.setProperty('--bg-ribbon', rColor);
                    document.body.style.setProperty('--bg-sidebar', rColor);
                    if (_isDarkHex(rColor)) {
                        document.body.classList.add('ribbon-is-dark');
                    }
                }
                if (aColor) {
                    document.body.style.setProperty('--accent', aColor);
                }
                const bgApp = localStorage.getItem('customBgApp');
                if (bgApp) {
                    document.body.style.setProperty('--bg-app', bgApp);
                }
                const borders = localStorage.getItem('alioth_group_borders') === '1';
                if (!borders) {
                    document.body.style.setProperty('--border-ribbon', 'transparent');
                } else if (_isDarkHex(rColor) || document.body.classList.contains('dark-mode')) {
                    document.body.style.setProperty('--border-ribbon', 'rgba(255, 255, 255, 0.12)');
                }
                console.log("🎨 Immediate colors applied:", hColor, rColor, aColor);
            } catch (e) { console.error("Error applying init colors", e); }

            // 2. DEFINE LOGIC
            const initColors = () => {
                // Check if app is defined (safely)
                if (typeof app === 'undefined') {
                    setTimeout(initColors, 100);
                    return;
                }

                app.presets = {
                    original:  { name: 'Original', header: '#334155', headerDark: '#000000', ribbon: '#e2e8f0', ribbonDark: '#273649', ribbonBorder: 'transparent', bgApp: '#808393', bgAppDark: '#1d1e25', accent: '#ff0000', accentDark: '#5e0303', groupBg: 'rgba(0,0,0,0.05)', textMain: '#000000', textMainDark: '#ffffff', whiteIcons: false, whiteIconsDark: true, groupBorders: false, groupBordersDark: false, sidebarAsHeader: true, sidebarAsHeaderDark: true, glassEffect: false, glassEffectDark: false, invertColors: false, invertColorsDark: false },
                    moonlight: { name: 'Moonlight', header: '#241e42', headerDark: '#1c1735', ribbon: '#c5d4e7', ribbonDark: '#1a1f2b', ribbonBorder: 'transparent', bgApp: '#1a162b', bgAppDark: '#120f20', accent: '#818cf8' },
                    midnight:  { name: 'Medianoche', header: '#0f172a', headerDark: '#0b1120', ribbon: '#1e293b', ribbonDark: '#0f172a', ribbonBorder: 'transparent', groupBg: 'rgba(255,255,255,0.25)', bgApp: '#0b1120', bgAppDark: '#070b14', accent: '#38bdf8' },
                    negro:     { name: 'Negro', header: '#000000', headerDark: '#000000', ribbon: '#0a0a0a', ribbonDark: '#000000', ribbonBorder: 'transparent', groupBg: 'rgba(255,255,255,0.06)', textMain: '#eeeeee', bgApp: '#000000', bgAppDark: '#000000', accent: '#60a5fa' },
                    obsidian:  { name: 'Obsidian', header: '#0f1117', headerDark: '#090a0f', ribbon: '#181b24', ribbonDark: '#0f1117', ribbonBorder: 'rgba(255,255,255,0.08)', groupBg: 'rgba(255,255,255,0.04)', textMain: '#e2e8f0', bgApp: '#0b0c10', bgAppDark: '#07070a', accent: '#6366f1' },
                    espresso:  { name: 'Spotify', header: '#191414', headerDark: '#121212', ribbon: '#1db954', ribbonDark: '#191414', ribbonBorder: 'transparent', groupBg: 'rgba(29,185,84,0.12)', bgApp: '#121212', bgAppDark: '#0a0a0a', accent: '#1db954' },
                    ocean:     { name: 'Océano', header: '#0c4a6e', headerDark: '#082f49', ribbon: '#bae6fd', ribbonDark: '#0e1f29', ribbonBorder: 'transparent', bgApp: '#091e2b', bgAppDark: '#05141c', accent: '#0284c7' },
                    forest:    { name: 'Bosque', header: '#14532d', headerDark: '#052e16', ribbon: '#dcfce7', ribbonDark: '#102e1c', ribbonBorder: 'transparent', bgApp: '#0c1f13', bgAppDark: '#06130b', accent: '#16a34a' },
                    sunset:    { name: 'Slack', header: '#4a154b', headerDark: '#350d36', ribbon: '#f4ede4', ribbonDark: '#2d0d2e', ribbonBorder: 'transparent', bgApp: '#1f1021', bgAppDark: '#140815', accent: '#d97706' },
                    plum:      { name: 'Ciruela', header: '#4c1d95', headerDark: '#310e6d', ribbon: '#ede9fe', ribbonDark: '#2d1159', ribbonBorder: 'transparent', bgApp: '#190d2e', bgAppDark: '#10061e', accent: '#9333ea' },
                    nordic:    { name: 'Nordic Slate', header: '#1e293b', headerDark: '#0f172a', ribbon: '#f1f5f9', ribbonDark: '#1e293b', ribbonBorder: 'rgba(0,0,0,0.08)', groupBg: 'rgba(255,255,255,0.7)', textMain: '#0f172a', bgApp: '#0f172a', bgAppDark: '#090d16', accent: '#2563eb' },
                    emerald:   { name: 'Emerald Forest', header: '#0a1612', headerDark: '#060d0b', ribbon: '#12251e', ribbonDark: '#0a1612', ribbonBorder: 'rgba(16,185,129,0.15)', groupBg: 'rgba(16,185,129,0.05)', textMain: '#e6f4ea', bgApp: '#070f0c', bgAppDark: '#040907', accent: '#10b981' },
                    teal:      { name: 'Menta', header: '#115e59', headerDark: '#042f2e', ribbon: '#99f6e4', ribbonDark: '#082f2d', ribbonBorder: 'transparent', bgApp: '#081f1e', bgAppDark: '#041212', accent: '#0d9488' },
                    indigo:    { name: 'Índigo', header: '#3730a3', headerDark: '#1e1b4b', ribbon: '#e0e7ff', ribbonDark: '#1e1b4b', ribbonBorder: 'transparent', bgApp: '#14122d', bgAppDark: '#0d0b1d', accent: '#4f46e5' },
                    rose:      { name: 'Rosa', header: '#be123c', headerDark: '#881337', ribbon: '#ffe4e6', ribbonDark: '#5c091d', ribbonBorder: 'transparent', bgApp: '#220813', bgAppDark: '#17040c', accent: '#e11d48' }
                };

                // Helper infalible para convertir cualquier color (hex corto, rgb, estilo) a hex #rrggbb
                app._colorToHex = function (color) {
                    if (!color || typeof color !== 'string') return '#000000';
                    color = color.trim();
                    if (color.startsWith('#')) {
                        let hex = color.replace('#', '');
                        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
                        if (hex.length === 6) return '#' + hex.toLowerCase();
                    }
                    const m = color.match(/\d+/g);
                    if (m && m.length >= 3) {
                        const r = Math.min(255, Math.max(0, parseInt(m[0], 10))).toString(16).padStart(2, '0');
                        const g = Math.min(255, Math.max(0, parseInt(m[1], 10))).toString(16).padStart(2, '0');
                        const b = Math.min(255, Math.max(0, parseInt(m[2], 10))).toString(16).padStart(2, '0');
                        return '#' + r + g + b;
                    }
                    return '#000000';
                };

                app.isColorDark = function (color) {
                    if (!color || typeof color !== 'string') return false;
                    const hex = app._colorToHex(color);
                    const r = parseInt(hex.substring(1, 3), 16) || 0;
                    const g = parseInt(hex.substring(3, 5), 16) || 0;
                    const b = parseInt(hex.substring(5, 7), 16) || 0;
                    return (r * 299 + g * 587 + b * 114) / 1000 < 135;
                };

                app._syncRibbonTheme = function (rColor) {
                    if (!rColor) {
                        rColor = document.body.style.getPropertyValue('--bg-ribbon').trim() ||
                                 localStorage.getItem('customRibbonColor') ||
                                 getComputedStyle(document.body).getPropertyValue('--bg-ribbon').trim();
                    }
                    const isDarkRibbon = app.isColorDark(rColor) || document.body.classList.contains('dark-mode');
                    document.body.classList.toggle('ribbon-is-dark', isDarkRibbon);

                    const bordersEnabled = localStorage.getItem('alioth_group_borders') === '1';
                    if (!bordersEnabled) {
                        document.body.style.setProperty('--border-ribbon', 'transparent');
                    } else {
                        const borderVal = isDarkRibbon ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
                        document.body.style.setProperty('--border-ribbon', borderVal);
                        localStorage.setItem('alioth_border_ribbon_value', borderVal);
                    }

                    if (isDarkRibbon && !document.body.classList.contains('dark-mode')) {
                        document.body.style.setProperty('--bg-group', 'rgba(255, 255, 255, 0.05)');
                    } else if (!document.body.classList.contains('dark-mode')) {
                        document.body.style.setProperty('--bg-group', 'rgba(255, 255, 255, 0.1)');
                    }
                };

                // Guardar temas personalizados en almacenamiento local
                app._persistCustomThemes = function() {
                    try {
                        const customs = Object.values(app.presets).filter(p => p && p.isCustom);
                        localStorage.setItem('alioth_custom_themes', JSON.stringify(customs));
                    } catch(e) { console.error('Error guardando temas personalizados', e); }
                };

                app.setCustomColor = function (type, color) {
                    const isDark = document.body.classList.contains('dark-mode');
                    const hex = app._colorToHex(color);

                    if (type === 'header') {
                        document.body.style.setProperty('--primary', hex);
                        document.body.style.setProperty('--bg-tabs', hex);
                        localStorage.setItem('customHeaderColor', hex);
                        const picker = document.getElementById('modalHeaderColor');
                        if (picker && picker.value !== hex) picker.value = hex;
                        if (localStorage.getItem('alioth_sidebar_as_header') === '1') {
                            document.body.style.setProperty('--bg-sidebar', hex);
                        }
                    } else if (type === 'ribbon') {
                        document.body.style.setProperty('--bg-ribbon', hex);
                        if (localStorage.getItem('alioth_sidebar_as_header') !== '1') {
                            document.body.style.setProperty('--bg-sidebar', hex);
                        }
                        localStorage.setItem('customRibbonColor', hex);
                        const picker = document.getElementById('modalRibbonColor');
                        if (picker && picker.value !== hex) picker.value = hex;
                        app._syncRibbonTheme(hex);
                    } else if (type === 'accent') {
                        document.body.style.setProperty('--accent', hex);
                        localStorage.setItem('customAccentColor', hex);
                        const picker = document.getElementById('modalAccentColor');
                        if (picker && picker.value !== hex) picker.value = hex;
                    } else if (type === 'bgApp' || type === 'canvas') {
                        document.body.style.setProperty('--bg-app', hex);
                        localStorage.setItem('customBgApp', hex);
                        const picker = document.getElementById('modalBgAppColor');
                        if (picker && picker.value !== hex) picker.value = hex;
                        document.querySelectorAll('.main-view').forEach(v => v.style.removeProperty('background-color'));
                    }

                    // Conservar los ajustes del tema activo al restaurarlo.
                    const lastPreset = localStorage.getItem('alioth_last_preset');
                    if (!app._applyingThemePreset && lastPreset && app.presets[lastPreset]) {
                        const cur = app.presets[lastPreset];
                        if (type === 'header') {
                            if (isDark) cur.headerDark = hex; else cur.header = hex;
                        } else if (type === 'ribbon') {
                            if (isDark) cur.ribbonDark = hex; else cur.ribbon = hex;
                        } else if (type === 'accent') {
                            if (isDark) cur.accentDark = hex; else cur.accent = hex;
                        } else if (type === 'bgApp' || type === 'canvas') {
                            if (isDark) cur.bgAppDark = hex; else cur.bgApp = hex;
                        }
                        if (cur.isCustom) app._persistCustomThemes();
                        else {
                            let overrides = {};
                            try { overrides = JSON.parse(localStorage.getItem('alioth_preset_overrides') || '{}'); } catch (_) {}
                            const property = ({ header: 'header', ribbon: 'ribbon', accent: 'accent', bgApp: 'bgApp', canvas: 'bgApp' })[type];
                            if (property) {
                                const key = property + (isDark ? 'Dark' : '');
                                overrides[lastPreset] = { ...overrides[lastPreset], [key]: hex };
                                localStorage.setItem('alioth_preset_overrides', JSON.stringify(overrides));
                            }
                        }
                        if (app.renderThemeCollection) app.renderThemeCollection();
                    }
                };

                // Helper para actualizar visual del toggle switch
                app._syncToggleUI = function(id, checked) {
                    const track = document.getElementById(id + 'Track');
                    const thumb = document.getElementById(id + 'Thumb');
                    if (track) track.style.background = checked ? '#4f46e5' : '#ccc';
                    if (thumb) thumb.style.left = checked ? '14px' : '2px';
                    const cb = document.getElementById(id);
                    if (cb) cb.checked = checked;
                };

                app.toggleGroupBorders = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('alioth_group_borders', enabled ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_group_borders_dark' : 'alioth_group_borders_light', enabled ? '1' : '0');
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (preset) {
                        if (isDark) preset.groupBordersDark = enabled;
                        else preset.groupBorders = enabled;
                        if (preset.isCustom) app._persistCustomThemes();
                    }
                    app._syncRibbonTheme();
                    app._syncToggleUI('toggleGroupBorders', enabled);
                };

                app.toggleWhiteIcons = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('alioth_white_icons', enabled ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_white_icons_dark' : 'alioth_white_icons_light', enabled ? '1' : '0');

                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (preset) {
                        if (isDark) {
                            preset.whiteIconsDark = enabled;
                            preset.textMainDark = enabled ? '#ffffff' : null;
                        } else {
                            preset.whiteIcons = enabled;
                            preset.textMain = enabled ? '#ffffff' : null;
                        }
                        if (preset.isCustom) {
                            app._persistCustomThemes();
                        }
                    }

                    if (enabled) {
                        document.body.style.setProperty('--text-main', '#ffffff');
                    } else {
                        const fallback = isDark ? (preset?.textMainDark || null) : (preset?.textMain || null);
                        if (fallback) {
                            document.body.style.setProperty('--text-main', fallback);
                        } else {
                            document.body.style.removeProperty('--text-main');
                        }
                    }
                    app._syncToggleUI('toggleWhiteIcons', enabled);
                };

                app.toggleSidebarColor = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('alioth_sidebar_as_header', enabled ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_sidebar_as_header_dark' : 'alioth_sidebar_as_header_light', enabled ? '1' : '0');
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (preset) {
                        if (isDark) preset.sidebarAsHeaderDark = enabled;
                        else preset.sidebarAsHeader = enabled;
                        if (preset.isCustom) app._persistCustomThemes();
                    }
                    const headerColor = getComputedStyle(document.body).getPropertyValue('--primary').trim();
                    const ribbonColor = getComputedStyle(document.body).getPropertyValue('--bg-ribbon').trim();
                    document.body.style.setProperty('--bg-sidebar', enabled ? headerColor : ribbonColor);
                    document.body.classList.toggle('sidebar-header-active', enabled);
                    app._syncToggleUI('toggleSidebarColor', enabled);
                };

                app.toggleGlassEffect = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('alioth_glass_effect', enabled ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_glass_effect_dark' : 'alioth_glass_effect_light', enabled ? '1' : '0');
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (preset) {
                        if (isDark) preset.glassEffectDark = enabled;
                        else preset.glassEffect = enabled;
                        if (preset.isCustom) app._persistCustomThemes();
                    }
                    document.body.classList.toggle('glass-effect', enabled);
                    app._syncToggleUI('toggleGlassEffect', enabled);
                };

                // Toggle para Modo Oscuro directamente desde el modal de temas
                app.toggleDarkModeFromModal = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    if (enabled !== isDark) {
                        if (app.toggleTheme) {
                            app.toggleTheme();
                        } else {
                            document.body.classList.toggle('dark-mode', enabled);
                            localStorage.setItem('alioth_theme', enabled ? 'dark' : 'light');
                            const last = localStorage.getItem('alioth_last_preset');
                            if (last && app.applyThemePreset) app.applyThemePreset(last);
                        }
                    }
                    app._syncToggleUI('toggleDarkModeModal', document.body.classList.contains('dark-mode'));
                    if (app._syncModalColorPickers) app._syncModalColorPickers();
                    if (app.renderThemeCollection) app.renderThemeCollection();
                };

                // Toggle para invertir colores (Cabecera ⇄ Cinta)
                app.toggleInvertColors = function(enabled) {
                    const isDark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('alioth_invert_colors', enabled ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_invert_colors_dark' : 'alioth_invert_colors_light', enabled ? '1' : '0');
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (preset) {
                        if (isDark) preset.invertColorsDark = enabled;
                        else preset.invertColors = enabled;
                        if (preset.isCustom) app._persistCustomThemes();
                    }
                    const curHeader = document.body.style.getPropertyValue('--primary').trim() || '#1e293b';
                    const curRibbon = document.body.style.getPropertyValue('--bg-ribbon').trim() || '#f1f5f9';
                    app.setCustomColor('header', curRibbon);
                    app.setCustomColor('ribbon', curHeader);
                    app._syncToggleUI('toggleInvertColors', enabled);
                    if (app.showToast) app.showToast(enabled ? 'Colores invertidos (Cabecera ⇄ Cinta)' : 'Colores restaurados');
                };

                // Gestión de temas personalizados con auto-reparación y carga de overrides
                app._loadCustomPresets = function() {
                    try {
                        const customs = JSON.parse(localStorage.getItem('alioth_custom_themes') || '[]');
                        customs.forEach(c => {
                            if (c && c.id) {
                                // Auto-reparar temas antiguos donde ribbonDark se guardó erróneamente como header
                                if (c.ribbonDark === c.header && c.ribbon && c.ribbon !== c.header) {
                                    c.ribbonDark = c.ribbon;
                                }
                                if (!c.headerDark) c.headerDark = c.header;
                                if (!c.bgAppDark) c.bgAppDark = c.bgApp;
                                if (!c.accentDark) c.accentDark = c.accent;

                                // Auto-reparación: evitar que whiteIcons se propague a modo claro si la cinta clara no es oscura
                                if (c.whiteIcons && c.ribbon && !app.isColorDark(c.ribbon) && c.whiteIconsDark) {
                                    c.whiteIcons = false;
                                }

                                app.presets[c.id] = c;
                            }
                        });

                        // Cargar overrides de presets integrados
                        const overrides = JSON.parse(localStorage.getItem('alioth_preset_overrides') || '{}');
                        Object.keys(overrides).forEach(id => {
                            if (app.presets[id]) {
                                Object.assign(app.presets[id], overrides[id]);
                            }
                        });
                    } catch(e) { console.error('Error cargando temas personalizados', e); }
                };

                // Actualizar ajustes del tema actualmente activo sin requerir prompt de nombre
                app.updateCurrentTheme = function () {
                    const isDark = document.body.classList.contains('dark-mode');
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    if (!preset) return;

                    const header = app._colorToHex(document.getElementById('modalHeaderColor')?.value || document.body.style.getPropertyValue('--primary') || '#1e293b');
                    const ribbon = app._colorToHex(document.getElementById('modalRibbonColor')?.value || document.body.style.getPropertyValue('--bg-ribbon') || '#f1f5f9');
                    const accent = app._colorToHex(document.getElementById('modalAccentColor')?.value || document.body.style.getPropertyValue('--accent') || '#2563eb');
                    const bgApp  = app._colorToHex(document.getElementById('modalBgAppColor')?.value  || document.body.style.getPropertyValue('--bg-app')  || (isDark ? '#000000' : '#525659'));

                    const isWhiteIcons   = document.getElementById('toggleWhiteIcons') ? document.getElementById('toggleWhiteIcons').checked : false;
                    const isGroupBorders = document.getElementById('toggleGroupBorders') ? document.getElementById('toggleGroupBorders').checked : false;
                    const isSidebar      = document.getElementById('toggleSidebarColor') ? document.getElementById('toggleSidebarColor').checked : true;
                    const isGlass        = document.getElementById('toggleGlassEffect') ? document.getElementById('toggleGlassEffect').checked : false;
                    const isInvert       = document.getElementById('toggleInvertColors') ? document.getElementById('toggleInvertColors').checked : false;

                    if (isDark) {
                        // Guardar exclusivamente en las propiedades de Modo Oscuro
                        preset.headerDark = header;
                        preset.ribbonDark = ribbon;
                        preset.bgAppDark = bgApp;
                        preset.accentDark = accent;
                        preset.whiteIconsDark = isWhiteIcons;
                        preset.textMainDark = isWhiteIcons ? '#ffffff' : null;
                        preset.groupBordersDark = isGroupBorders;
                        preset.sidebarAsHeaderDark = isSidebar;
                        preset.glassEffectDark = isGlass;
                        preset.invertColorsDark = isInvert;

                        localStorage.setItem('alioth_white_icons_dark', isWhiteIcons ? '1' : '0');
                        localStorage.setItem('alioth_group_borders_dark', isGroupBorders ? '1' : '0');
                        localStorage.setItem('alioth_sidebar_as_header_dark', isSidebar ? '1' : '0');
                        localStorage.setItem('alioth_glass_effect_dark', isGlass ? '1' : '0');
                        localStorage.setItem('alioth_invert_colors_dark', isInvert ? '1' : '0');

                        // Inicializaciones seguras para modo claro solo si no existían (NUNCA transferir whiteIcons a modo claro!)
                        if (!preset.header) preset.header = header;
                        if (!preset.ribbon) preset.ribbon = ribbon;
                        if (!preset.bgApp) preset.bgApp = bgApp;
                        if (!preset.accent) preset.accent = accent;
                        if (preset.whiteIcons === undefined) preset.whiteIcons = false;
                        if (preset.groupBorders === undefined) preset.groupBorders = false;
                        if (preset.sidebarAsHeader === undefined) preset.sidebarAsHeader = true;
                        if (preset.glassEffect === undefined) preset.glassEffect = false;
                        if (preset.invertColors === undefined) preset.invertColors = false;
                    } else {
                        // Guardar exclusivamente en las propiedades de Modo Claro
                        preset.header = header;
                        preset.ribbon = ribbon;
                        preset.bgApp = bgApp;
                        preset.accent = accent;
                        preset.whiteIcons = isWhiteIcons;
                        preset.textMain = isWhiteIcons ? '#ffffff' : null;
                        preset.groupBorders = isGroupBorders;
                        preset.sidebarAsHeader = isSidebar;
                        preset.glassEffect = isGlass;
                        preset.invertColors = isInvert;

                        localStorage.setItem('alioth_white_icons_light', isWhiteIcons ? '1' : '0');
                        localStorage.setItem('alioth_group_borders_light', isGroupBorders ? '1' : '0');
                        localStorage.setItem('alioth_sidebar_as_header_light', isSidebar ? '1' : '0');
                        localStorage.setItem('alioth_glass_effect_light', isGlass ? '1' : '0');
                        localStorage.setItem('alioth_invert_colors_light', isInvert ? '1' : '0');

                        // Inicializaciones seguras para modo oscuro solo si no existían
                        if (!preset.headerDark) preset.headerDark = header;
                        if (!preset.ribbonDark) preset.ribbonDark = ribbon;
                        if (!preset.bgAppDark) preset.bgAppDark = bgApp;
                        if (!preset.accentDark) preset.accentDark = accent;
                        if (preset.whiteIconsDark === undefined) preset.whiteIconsDark = true;
                        if (preset.groupBordersDark === undefined) preset.groupBordersDark = false;
                        if (preset.sidebarAsHeaderDark === undefined) preset.sidebarAsHeaderDark = true;
                        if (preset.glassEffectDark === undefined) preset.glassEffectDark = false;
                        if (preset.invertColorsDark === undefined) preset.invertColorsDark = false;
                    }

                    if (preset.isCustom) {
                        let customs = [];
                        try { customs = JSON.parse(localStorage.getItem('alioth_custom_themes') || '[]'); } catch (e) {}
                        const idx = customs.findIndex(c => c && c.id === preset.id);
                        if (idx >= 0) {
                            customs[idx] = preset;
                        } else {
                            customs.push(preset);
                        }
                        localStorage.setItem('alioth_custom_themes', JSON.stringify(customs));
                    } else {
                        let overrides = {};
                        try { overrides = JSON.parse(localStorage.getItem('alioth_preset_overrides') || '{}'); } catch (e) {}
                        overrides[lastPreset] = {
                            header: preset.header,
                            ribbon: preset.ribbon,
                            bgApp: preset.bgApp,
                            accent: preset.accent,
                            whiteIcons: preset.whiteIcons,
                            textMain: preset.textMain,
                            groupBorders: preset.groupBorders,
                            sidebarAsHeader: preset.sidebarAsHeader,
                            glassEffect: preset.glassEffect,
                            invertColors: preset.invertColors,

                            headerDark: preset.headerDark,
                            ribbonDark: preset.ribbonDark,
                            bgAppDark: preset.bgAppDark,
                            accentDark: preset.accentDark,
                            whiteIconsDark: preset.whiteIconsDark,
                            textMainDark: preset.textMainDark,
                            groupBordersDark: preset.groupBordersDark,
                            sidebarAsHeaderDark: preset.sidebarAsHeaderDark,
                            glassEffectDark: preset.glassEffectDark,
                            invertColorsDark: preset.invertColorsDark
                        };
                        localStorage.setItem('alioth_preset_overrides', JSON.stringify(overrides));
                    }

                    if (app.applyThemePreset) {
                        app.applyThemePreset(lastPreset, true);
                    }
                    if (app.renderThemeCollection) {
                        app.renderThemeCollection();
                    }
                    if (app.showToast) {
                        app.showToast(`Tema "${preset.name || lastPreset}" actualizado`);
                    }
                };

                // Guardar la configuración actual como un nuevo tema personalizado
                app.saveCurrentCustomTheme = function() {
                    const isDark = document.body.classList.contains('dark-mode');
                    const lastPreset = localStorage.getItem('alioth_last_preset');
                    const curPreset = (lastPreset && app.presets[lastPreset]) ? app.presets[lastPreset] : null;

                    const defaultName = (curPreset && curPreset.isCustom) ? (curPreset.name + ' copia') : (isDark ? 'Mi Tema Oscuro' : 'Mi Tema');
                    const name = prompt('Nombre para tu nuevo tema personalizado:', defaultName);
                    if (!name || !name.trim()) return;
                    const themeName = name.trim();

                    const header = app._colorToHex(document.getElementById('modalHeaderColor')?.value || document.body.style.getPropertyValue('--primary') || '#1e293b');
                    const ribbon = app._colorToHex(document.getElementById('modalRibbonColor')?.value || document.body.style.getPropertyValue('--bg-ribbon') || '#f1f5f9');
                    const accent = app._colorToHex(document.getElementById('modalAccentColor')?.value || document.body.style.getPropertyValue('--accent') || '#2563eb');
                    const bgApp  = app._colorToHex(document.getElementById('modalBgAppColor')?.value  || document.body.style.getPropertyValue('--bg-app')  || (isDark ? '#000000' : '#525659'));

                    const isWhiteIcons   = document.getElementById('toggleWhiteIcons') ? document.getElementById('toggleWhiteIcons').checked : false;
                    const isGroupBorders = document.getElementById('toggleGroupBorders') ? document.getElementById('toggleGroupBorders').checked : false;
                    const isSidebar      = document.getElementById('toggleSidebarColor') ? document.getElementById('toggleSidebarColor').checked : true;
                    const isGlass        = document.getElementById('toggleGlassEffect') ? document.getElementById('toggleGlassEffect').checked : false;
                    const isInvert       = document.getElementById('toggleInvertColors') ? document.getElementById('toggleInvertColors').checked : false;

                    let customs = [];
                    try { customs = JSON.parse(localStorage.getItem('alioth_custom_themes') || '[]'); } catch(e){}

                    const id = 'custom_' + Date.now();
                    const targetTheme = {
                        id,
                        name: themeName,
                        isCustom: true
                    };

                    if (isDark) {
                        targetTheme.headerDark = header;
                        targetTheme.ribbonDark = ribbon;
                        targetTheme.bgAppDark = bgApp;
                        targetTheme.accentDark = accent;
                        targetTheme.whiteIconsDark = isWhiteIcons;
                        targetTheme.textMainDark = isWhiteIcons ? '#ffffff' : null;
                        targetTheme.groupBordersDark = isGroupBorders;
                        targetTheme.sidebarAsHeaderDark = isSidebar;
                        targetTheme.glassEffectDark = isGlass;
                        targetTheme.invertColorsDark = isInvert;

                        // Perfil separado por defecto para modo claro
                        targetTheme.header = header;
                        targetTheme.ribbon = '#f1f5f9';
                        targetTheme.bgApp = '#525659';
                        targetTheme.accent = accent;
                        targetTheme.whiteIcons = false; // NUNCA blanco en modo claro por defecto
                        targetTheme.textMain = null;
                        targetTheme.groupBorders = false;
                        targetTheme.sidebarAsHeader = isSidebar;
                        targetTheme.glassEffect = false;
                        targetTheme.invertColors = false;
                    } else {
                        targetTheme.header = header;
                        targetTheme.ribbon = ribbon;
                        targetTheme.bgApp = bgApp;
                        targetTheme.accent = accent;
                        targetTheme.whiteIcons = isWhiteIcons;
                        targetTheme.textMain = isWhiteIcons ? '#ffffff' : null;
                        targetTheme.groupBorders = isGroupBorders;
                        targetTheme.sidebarAsHeader = isSidebar;
                        targetTheme.glassEffect = isGlass;
                        targetTheme.invertColors = isInvert;

                        // Perfil separado por defecto para modo oscuro
                        targetTheme.headerDark = header;
                        targetTheme.ribbonDark = '#1e293b';
                        targetTheme.bgAppDark = '#090a0f';
                        targetTheme.accentDark = accent;
                        targetTheme.whiteIconsDark = true;
                        targetTheme.textMainDark = '#ffffff';
                        targetTheme.groupBordersDark = false;
                        targetTheme.sidebarAsHeaderDark = isSidebar;
                        targetTheme.glassEffectDark = false;
                        targetTheme.invertColorsDark = false;
                    }

                    targetTheme.groupBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

                    customs.push(targetTheme);
                    localStorage.setItem('alioth_custom_themes', JSON.stringify(customs));
                    app.presets[targetTheme.id] = targetTheme;
                    localStorage.setItem('alioth_last_preset', targetTheme.id);

                    if (app.applyThemePreset) {
                        app.applyThemePreset(targetTheme.id, true);
                    }
                    if (app.renderThemeCollection) app.renderThemeCollection();
                    if (app.showToast) app.showToast(`Tema "${themeName}" guardado`);
                };

                app.deleteCustomTheme = function(themeId, event) {
                    if (event) event.stopPropagation();
                    if (!confirm('¿Deseas eliminar este tema personalizado?')) return;
                    let customs = [];
                    try { customs = JSON.parse(localStorage.getItem('alioth_custom_themes') || '[]'); } catch(e){}
                    customs = customs.filter(c => c && c.id !== themeId);
                    localStorage.setItem('alioth_custom_themes', JSON.stringify(customs));
                    delete app.presets[themeId];
                    if (localStorage.getItem('alioth_last_preset') === themeId) {
                        app.applyThemePreset('original');
                    } else if (app.renderThemeCollection) {
                        app.renderThemeCollection();
                    }
                    if (app.showToast) app.showToast('Tema eliminado');
                };

                // Favoritos y ordenación
                app.toggleFavoriteTheme = function(presetId, event) {
                    if (event) event.stopPropagation();
                    let favs = [];
                    try { favs = JSON.parse(localStorage.getItem('alioth_theme_favorites') || '[]'); } catch(e){}
                    const idx = favs.indexOf(presetId);
                    if (idx >= 0) favs.splice(idx, 1);
                    else favs.push(presetId);
                    localStorage.setItem('alioth_theme_favorites', JSON.stringify(favs));
                    if (app.renderThemeCollection) app.renderThemeCollection();
                };

                app._getThemeOrderList = function() {
                    let savedOrder = [];
                    try { savedOrder = JSON.parse(localStorage.getItem('alioth_theme_order') || '[]'); } catch(e){}
                    const allKeys = Object.keys(app.presets);
                    const order = savedOrder.filter(k => allKeys.includes(k));
                    allKeys.forEach(k => {
                        if (!order.includes(k)) order.push(k);
                    });
                    return order;
                };

                app.moveThemeOrder = function(fromId, toId) {
                    if (!fromId || !toId || fromId === toId) return;
                    let order = app._getThemeOrderList();
                    const fromIdx = order.indexOf(fromId);
                    const toIdx = order.indexOf(toId);
                    if (fromIdx >= 0 && toIdx >= 0) {
                        order.splice(fromIdx, 1);
                        order.splice(toIdx, 0, fromId);
                        localStorage.setItem('alioth_theme_order', JSON.stringify(order));
                        if (app.renderThemeCollection) app.renderThemeCollection();
                    }
                };

                // Renderizado dinámico de tarjetas de temas
                app.renderThemeCollection = function() {
                    const container = document.getElementById('theme-collection-grid');
                    if (!container) return;

                    let favs = [];
                    try { favs = JSON.parse(localStorage.getItem('alioth_theme_favorites') || '[]'); } catch(e){}
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';

                    let order = app._getThemeOrderList();

                    // Priorizar favoritos al inicio
                    order.sort((a, b) => {
                        const aFav = favs.includes(a);
                        const bFav = favs.includes(b);
                        if (aFav && !bFav) return -1;
                        if (!aFav && bFav) return 1;
                        return 0;
                    });

                    const isDark = document.body.classList.contains('dark-mode');
                    container.innerHTML = '';
                    order.forEach(id => {
                        const p = app.presets[id];
                        if (!p) return;
                        const isFav = favs.includes(id);
                        const isSelected = lastPreset === id;

                        const cardHeader = isDark ? (p.headerDark || p.header) : p.header;
                        const cardRibbon = isDark ? (p.ribbonDark || p.ribbon) : p.ribbon;

                        const card = document.createElement('div');
                        card.className = 'theme-preset-card' + (isSelected ? ' selected' : '');
                        card.draggable = true;
                        card.style.cssText = `
                            position: relative;
                            height: 44px;
                            border-radius: 8px;
                            cursor: pointer;
                            overflow: hidden;
                            background: ${cardHeader};
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                            border: ${isSelected ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)'};
                            transition: transform 0.15s, box-shadow 0.15s;
                            user-select: none;
                        `;
                        card.title = `${p.name || id} (Arrastra para reordenar)`;

                        card.onmouseover = () => { card.style.transform = 'translateY(-1px)'; };
                        card.onmouseout = () => { card.style.transform = 'none'; };
                        card.onclick = () => {
                            app.applyThemePreset(id);
                        };

                        // Drag & Drop
                        card.ondragstart = (e) => {
                            e.dataTransfer.setData('text/plain', id);
                            card.style.opacity = '0.4';
                        };
                        card.ondragend = () => {
                            card.style.opacity = '1';
                        };
                        card.ondragover = (e) => {
                            e.preventDefault();
                            card.style.outline = '2px dashed var(--accent)';
                        };
                        card.ondragleave = () => {
                            card.style.outline = 'none';
                        };
                        card.ondrop = (e) => {
                            e.preventDefault();
                            card.style.outline = 'none';
                            const draggedId = e.dataTransfer.getData('text/plain');
                            if (draggedId && draggedId !== id) {
                                app.moveThemeOrder(draggedId, id);
                            }
                        };

                        // Botón de Favorito (Estrella)
                        const starBtn = document.createElement('span');
                        starBtn.innerHTML = isFav ? '★' : '☆';
                        starBtn.title = isFav ? 'Quitar de favoritos' : 'Marcar como favorito';
                        starBtn.style.cssText = `
                            position: absolute;
                            top: 2px;
                            left: 5px;
                            font-size: 13px;
                            color: ${isFav ? '#f59e0b' : 'rgba(255,255,255,0.5)'};
                            cursor: pointer;
                            z-index: 2;
                            transition: transform 0.15s;
                        `;
                        starBtn.onmouseover = (e) => { e.stopPropagation(); starBtn.style.transform = 'scale(1.25)'; };
                        starBtn.onmouseout = (e) => { e.stopPropagation(); starBtn.style.transform = 'none'; };
                        starBtn.onclick = (e) => app.toggleFavoriteTheme(id, e);
                        card.appendChild(starBtn);

                        // Botón de eliminar para temas personalizados
                        if (p.isCustom) {
                            const delBtn = document.createElement('span');
                            delBtn.innerHTML = '✕';
                            delBtn.title = 'Eliminar tema personalizado';
                            delBtn.style.cssText = `
                                position: absolute;
                                top: 2px;
                                right: 5px;
                                font-size: 11px;
                                color: rgba(255,255,255,0.6);
                                cursor: pointer;
                                z-index: 2;
                            `;
                            delBtn.onmouseover = (e) => { e.stopPropagation(); delBtn.style.color = '#ef4444'; };
                            delBtn.onmouseout = (e) => { e.stopPropagation(); delBtn.style.color = 'rgba(255,255,255,0.6)'; };
                            delBtn.onclick = (e) => app.deleteCustomTheme(id, e);
                            card.appendChild(delBtn);
                        }

                        // Píldora interior con muestra de ribbon y nombre
                        const pill = document.createElement('span');
                        pill.style.cssText = `
                            background: ${cardRibbon};
                            color: ${app.isColorDark(cardRibbon) ? '#eeeeee' : '#1e293b'};
                            padding: 2px 8px;
                            border-radius: 12px;
                            font-size: 10.5px;
                            font-weight: bold;
                            max-width: 80%;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            pointer-events: none;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.15);
                        `;
                        pill.textContent = p.name || id;
                        card.appendChild(pill);

                        container.appendChild(card);
                    });
                };

                app._syncModalColorPickers = function () {
                    const isDark = document.body.classList.contains('dark-mode');
                    const pHeader = document.getElementById('modalHeaderColor');
                    const pRibbon = document.getElementById('modalRibbonColor');
                    const pBgApp  = document.getElementById('modalBgAppColor');
                    const pAccent = document.getElementById('modalAccentColor');
                    const pFieldHighlight = document.getElementById('form-field-highlight-color');

                    const curHeader = app._colorToHex(document.body.style.getPropertyValue('--primary') || getComputedStyle(document.body).getPropertyValue('--primary'));
                    const curRibbon = app._colorToHex(document.body.style.getPropertyValue('--bg-ribbon') || getComputedStyle(document.body).getPropertyValue('--bg-ribbon'));
                    const curBgApp  = app._colorToHex(document.body.style.getPropertyValue('--bg-app') || getComputedStyle(document.body).getPropertyValue('--bg-app'));
                    const curAccent = app._colorToHex(document.body.style.getPropertyValue('--accent') || getComputedStyle(document.body).getPropertyValue('--accent'));

                    if (pHeader) pHeader.value = curHeader;
                    if (pRibbon) pRibbon.value = curRibbon;
                    if (pBgApp)  pBgApp.value  = curBgApp;
                    if (pAccent) pAccent.value = curAccent;

                    if (pFieldHighlight && app.restoreFormFieldHighlightColor) {
                        pFieldHighlight.value = app.restoreFormFieldHighlightColor();
                    }

                    app._syncToggleUI('toggleDarkModeModal', isDark);

                    // Sincronizar todos los 5 toggles del Ajuste Fino según el preset y el modo activo (claro/oscuro)
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    const preset = app.presets[lastPreset];
                    let isWhite = false;
                    let isBorders = false;
                    let isSidebar = true;
                    let isGlass = false;
                    let isInvert = false;

                    if (preset) {
                        if (isDark) {
                            if (preset.whiteIconsDark !== undefined) isWhite = !!preset.whiteIconsDark;
                            else if (preset.textMainDark) isWhite = (preset.textMainDark.toLowerCase() === '#ffffff' || preset.textMainDark.toLowerCase() === '#fff');
                            else if (preset.textMain) isWhite = (preset.textMain.toLowerCase() === '#ffffff' || preset.textMain.toLowerCase() === '#fff');
                            else isWhite = (localStorage.getItem('alioth_white_icons_dark') === '1');

                            if (preset.groupBordersDark !== undefined) isBorders = !!preset.groupBordersDark;
                            else isBorders = (localStorage.getItem('alioth_group_borders_dark') === '1');

                            if (preset.sidebarAsHeaderDark !== undefined) isSidebar = !!preset.sidebarAsHeaderDark;
                            else isSidebar = (localStorage.getItem('alioth_sidebar_as_header_dark') !== '0');

                            if (preset.glassEffectDark !== undefined) isGlass = !!preset.glassEffectDark;
                            else isGlass = (localStorage.getItem('alioth_glass_effect_dark') === '1');

                            if (preset.invertColorsDark !== undefined) isInvert = !!preset.invertColorsDark;
                            else isInvert = (localStorage.getItem('alioth_invert_colors_dark') === '1');
                        } else {
                            if (preset.whiteIcons !== undefined) isWhite = !!preset.whiteIcons;
                            else if (preset.textMain) isWhite = (preset.textMain.toLowerCase() === '#ffffff' || preset.textMain.toLowerCase() === '#fff');
                            else isWhite = (localStorage.getItem('alioth_white_icons_light') === '1');

                            if (preset.groupBorders !== undefined) isBorders = !!preset.groupBorders;
                            else isBorders = (localStorage.getItem('alioth_group_borders_light') === '1');

                            if (preset.sidebarAsHeader !== undefined) isSidebar = !!preset.sidebarAsHeader;
                            else isSidebar = (localStorage.getItem('alioth_sidebar_as_header_light') !== '0');

                            if (preset.glassEffect !== undefined) isGlass = !!preset.glassEffect;
                            else isGlass = (localStorage.getItem('alioth_glass_effect_light') === '1');

                            if (preset.invertColors !== undefined) isInvert = !!preset.invertColors;
                            else isInvert = (localStorage.getItem('alioth_invert_colors_light') === '1');
                        }
                    } else {
                        isWhite   = (localStorage.getItem(isDark ? 'alioth_white_icons_dark' : 'alioth_white_icons_light') === '1');
                        isBorders = (localStorage.getItem(isDark ? 'alioth_group_borders_dark' : 'alioth_group_borders_light') === '1');
                        isSidebar = (localStorage.getItem(isDark ? 'alioth_sidebar_as_header_dark' : 'alioth_sidebar_as_header_light') !== '0');
                        isGlass   = (localStorage.getItem(isDark ? 'alioth_glass_effect_dark' : 'alioth_glass_effect_light') === '1');
                        isInvert  = (localStorage.getItem(isDark ? 'alioth_invert_colors_dark' : 'alioth_invert_colors_light') === '1');
                    }

                    app._syncToggleUI('toggleWhiteIcons', isWhite);
                    app._syncToggleUI('toggleGroupBorders', isBorders);
                    app._syncToggleUI('toggleSidebarColor', isSidebar);
                    app._syncToggleUI('toggleGlassEffect', isGlass);
                    app._syncToggleUI('toggleInvertColors', isInvert);
                };

                app._loadToggles = function() {
                    const lastPreset = localStorage.getItem('alioth_last_preset') || 'original';
                    if (app.applyThemePreset) {
                        app.applyThemePreset(lastPreset, true);
                    }
                    if (app._syncModalColorPickers) {
                        app._syncModalColorPickers();
                    }
                };

                app.applyThemePreset = function (presetName, silent) {
                    // Retrocompatibilidad con nombres antiguos
                    if (presetName === 'slate') presetName = 'original';
                    if (presetName === 'default') presetName = 'original';
                    if (presetName === 'carbon') presetName = 'obsidian';
                    if (presetName === 'cherry') presetName = 'nordic';
                    if (presetName === 'gold') presetName = 'emerald';

                    const preset = app.presets[presetName];
                    if (!preset) return;

                    localStorage.setItem('alioth_last_preset', presetName);
                    const isDark = document.body.classList.contains('dark-mode');

                    let hColor;
                    let rColor;
                    let targetBgApp;
                    let targetAccent;

                    if (preset.isCustom) {
                        if (isDark) {
                            hColor = preset.headerDark || preset.header;
                            rColor = preset.ribbonDark || preset.ribbon;
                            targetBgApp = preset.bgAppDark || preset.bgApp || '#000000';
                            targetAccent = preset.accentDark || preset.accent || '#2563eb';
                        } else {
                            hColor = preset.header;
                            rColor = preset.ribbon;
                            targetBgApp = preset.bgApp || '#525659';
                            targetAccent = preset.accent || '#2563eb';
                        }
                    } else {
                        hColor = (isDark && preset.headerDark) ? preset.headerDark : preset.header;
                        rColor = (isDark && preset.ribbonDark) ? preset.ribbonDark : preset.ribbon;
                        targetBgApp = (isDark && preset.bgAppDark) ? preset.bgAppDark : (preset.bgApp || (isDark ? '#000000' : '#525659'));
                        targetAccent = (isDark && preset.accentDark) ? preset.accentDark : (preset.accent || '#185abd');
                    }

                    // 1. Invertir Colores (específico para el modo activo)
                    let isInvert = false;
                    if (isDark) {
                        if (preset.invertColorsDark !== undefined) isInvert = !!preset.invertColorsDark;
                        else isInvert = (localStorage.getItem('alioth_invert_colors_dark') === '1');
                    } else {
                        if (preset.invertColors !== undefined) isInvert = !!preset.invertColors;
                        else isInvert = (localStorage.getItem('alioth_invert_colors_light') === '1');
                    }
                    localStorage.setItem('alioth_invert_colors', isInvert ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_invert_colors_dark' : 'alioth_invert_colors_light', isInvert ? '1' : '0');

                    if (isInvert) {
                        const tmp = hColor;
                        hColor = rColor;
                        rColor = tmp;
                    }

                    hColor = app._colorToHex(hColor);
                    rColor = app._colorToHex(rColor);
                    targetBgApp = app._colorToHex(targetBgApp);
                    targetAccent = app._colorToHex(targetAccent);

                    app._applyingThemePreset = true;
                    try {
                        app.setCustomColor('header', hColor);
                        app.setCustomColor('ribbon', rColor);
                        app.setCustomColor('accent', targetAccent);
                        app.setCustomColor('bgApp', targetBgApp);
                    } finally {
                        app._applyingThemePreset = false;
                    }

                    // Limpiar fondos inline residuales en .main-view para que sea gobernado limpiamente por CSS
                    document.querySelectorAll('.main-view').forEach(v => {
                        v.style.removeProperty('background-color');
                    });

                    const defGroupBg = isDark ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.1)';
                    const gBg = preset.groupBg || defGroupBg;
                    document.body.style.setProperty('--bg-group', gBg);

                    // 2. Bordes en Grupos (específico para el modo activo)
                    let isBorders = false;
                    if (isDark) {
                        if (preset.groupBordersDark !== undefined) isBorders = !!preset.groupBordersDark;
                        else isBorders = (localStorage.getItem('alioth_group_borders_dark') === '1');
                    } else {
                        if (preset.groupBorders !== undefined) isBorders = !!preset.groupBorders;
                        else isBorders = (localStorage.getItem('alioth_group_borders_light') === '1');
                    }
                    localStorage.setItem('alioth_group_borders', isBorders ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_group_borders_dark' : 'alioth_group_borders_light', isBorders ? '1' : '0');

                    // 3. Color Barra Lateral (Sidebar as Header) (específico para el modo activo)
                    let isSidebar = true;
                    if (isDark) {
                        if (preset.sidebarAsHeaderDark !== undefined) isSidebar = !!preset.sidebarAsHeaderDark;
                        else isSidebar = (localStorage.getItem('alioth_sidebar_as_header_dark') !== '0');
                    } else {
                        if (preset.sidebarAsHeader !== undefined) isSidebar = !!preset.sidebarAsHeader;
                        else isSidebar = (localStorage.getItem('alioth_sidebar_as_header_light') !== '0');
                    }
                    localStorage.setItem('alioth_sidebar_as_header', isSidebar ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_sidebar_as_header_dark' : 'alioth_sidebar_as_header_light', isSidebar ? '1' : '0');
                    document.body.style.setProperty('--bg-sidebar', isSidebar ? hColor : rColor);
                    document.body.classList.toggle('sidebar-header-active', isSidebar);

                    // 4. Efecto Cristal (Glass Effect) (específico para el modo activo)
                    let isGlass = false;
                    if (isDark) {
                        if (preset.glassEffectDark !== undefined) isGlass = !!preset.glassEffectDark;
                        else isGlass = (localStorage.getItem('alioth_glass_effect_dark') === '1');
                    } else {
                        if (preset.glassEffect !== undefined) isGlass = !!preset.glassEffect;
                        else isGlass = (localStorage.getItem('alioth_glass_effect_light') === '1');
                    }
                    localStorage.setItem('alioth_glass_effect', isGlass ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_glass_effect_dark' : 'alioth_glass_effect_light', isGlass ? '1' : '0');
                    document.body.classList.toggle('glass-effect', isGlass);

                    // 5. Forzar color de texto/iconos según configuración del preset y modo activo
                    let whiteIconsActive = false;
                    let targetTextMain = null;

                    if (isDark) {
                        if (preset.whiteIconsDark !== undefined) {
                            whiteIconsActive = !!preset.whiteIconsDark;
                        } else if (preset.textMainDark) {
                            whiteIconsActive = (preset.textMainDark.toLowerCase() === '#ffffff' || preset.textMainDark.toLowerCase() === '#fff');
                            targetTextMain = preset.textMainDark;
                        } else if (preset.textMain && (preset.textMain.toLowerCase() === '#ffffff' || preset.textMain.toLowerCase() === '#fff')) {
                            whiteIconsActive = true;
                        } else {
                            whiteIconsActive = (localStorage.getItem('alioth_white_icons_dark') === '1');
                        }

                        if (whiteIconsActive) {
                            targetTextMain = '#ffffff';
                        } else if (!targetTextMain && preset.textMainDark) {
                            targetTextMain = preset.textMainDark;
                        }
                    } else {
                        // En Modo Claro, whiteIcons solo es true si se configuró explícitamente para el perfil claro
                        if (preset.whiteIcons !== undefined) {
                            whiteIconsActive = !!preset.whiteIcons;
                        } else if (preset.textMain) {
                            whiteIconsActive = (preset.textMain.toLowerCase() === '#ffffff' || preset.textMain.toLowerCase() === '#fff');
                            targetTextMain = preset.textMain;
                        } else {
                            whiteIconsActive = (localStorage.getItem('alioth_white_icons_light') === '1');
                        }

                        if (whiteIconsActive) {
                            targetTextMain = '#ffffff';
                        } else if (!targetTextMain && preset.textMain) {
                            targetTextMain = preset.textMain;
                        }
                    }

                    if (targetTextMain) {
                        document.body.style.setProperty('--text-main', targetTextMain);
                    } else {
                        document.body.style.removeProperty('--text-main');
                    }

                    localStorage.setItem('alioth_white_icons', whiteIconsActive ? '1' : '0');
                    localStorage.setItem(isDark ? 'alioth_white_icons_dark' : 'alioth_white_icons_light', whiteIconsActive ? '1' : '0');

                    app._syncRibbonTheme(rColor);

                    // Sincronizar todos los toggles en la UI del modal
                    app._syncToggleUI('toggleInvertColors', isInvert);
                    app._syncToggleUI('toggleGroupBorders', isBorders);
                    app._syncToggleUI('toggleSidebarColor', isSidebar);
                    app._syncToggleUI('toggleGlassEffect', isGlass);
                    app._syncToggleUI('toggleWhiteIcons', whiteIconsActive);
                    app._syncToggleUI('toggleDarkModeModal', isDark);

                    if (app._syncModalColorPickers) app._syncModalColorPickers();

                    if (app.renderThemeCollection) {
                        app.renderThemeCollection();
                    }

                    if (!silent && app.showToast) app.showToast('Tema ' + (preset.name || presetName) + ' aplicado');
                };

                app.loadCustomColors = function () {
                    app._loadCustomPresets();
                    let lastPreset = localStorage.getItem('alioth_last_preset');
                    if (lastPreset === 'carbon') lastPreset = 'obsidian';
                    if (lastPreset === 'cherry') lastPreset = 'nordic';
                    if (lastPreset === 'gold') lastPreset = 'emerald';

                    const current = app.presets[lastPreset];
                    if (current && !current.isCustom) {
                        const suffix = document.body.classList.contains('dark-mode') ? 'Dark' : '';
                        let overrides = {};
                        try { overrides = JSON.parse(localStorage.getItem('alioth_preset_overrides') || '{}'); } catch (_) {}
                        const saved = overrides[lastPreset] || {};
                        const inverted = localStorage.getItem('alioth_invert_colors') === '1';
                        for (const [property, key] of Object.entries({ header: inverted ? 'customRibbonColor' : 'customHeaderColor', ribbon: inverted ? 'customHeaderColor' : 'customRibbonColor', accent: 'customAccentColor', bgApp: 'customBgApp' })) {
                            const color = localStorage.getItem(key);
                            if (color && !((property + suffix) in saved)) {
                                current[property + suffix] = color;
                                saved[property + suffix] = color;
                            }
                        }
                        overrides[lastPreset] = saved;
                        localStorage.setItem('alioth_preset_overrides', JSON.stringify(overrides));
                    }

                    if (lastPreset && this.applyThemePreset) {
                        this.applyThemePreset(lastPreset, true);
                    } else {
                        this.applyThemePreset('original', true);
                    }

                    if (this._syncModalColorPickers) {
                        this._syncModalColorPickers();
                    }
                };

                app.loadCustomColors();
                app._loadToggles();
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initColors);
            } else {
                initColors();
            }
        })();
