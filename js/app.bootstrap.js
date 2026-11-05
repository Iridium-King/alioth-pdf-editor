// app.bootstrap.js — punto de entrada
// Se carga DESPUÉS de todos los app.*.js

if (!window.app) window.app = {};
const app = window.app;


        function hexToRgb(hex) {
            const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
            return PDFLib.rgb(r, g, b);
        }
        function hexToRgbVals(hex) {
            return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
        }
        function hexToRgba(hex, alpha) {
            const c = hexToRgbVals(hex);
            return `rgba(${c.r},${c.g},${c.b},${alpha})`;
        }

        // Expose helpers globally so other modules (app.render.js, app.tools.js) can use them
        window.hexToRgb = hexToRgb;
        window.hexToRgbVals = hexToRgbVals;
        window.hexToRgba = hexToRgba;

        // GLOBAL KEYDOWN: Delete selected objects with Delete/Backspace
        document.addEventListener('keydown', (e) => {
            // Ignore if focus is in an input/textarea
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (app.multiObjectSelection && app.multiObjectSelection.size > 0) {
                    e.preventDefault();
                    app.deleteObject();
                }
            }
        });

        window.app = app;
        document.addEventListener('DOMContentLoaded', () => app.init());

        // ── Ribbon interaction flag: prevenir blur-commit del editor de texto
        // cuando el usuario interactúa con controles del ribbon (select, color, etc.) ──
        document.addEventListener('DOMContentLoaded', () => {
            const ribbon = document.getElementById('ribbon-capsule-wrapper');
            if (ribbon) {
                ribbon.addEventListener('mousedown', () => {
                    window._ribbonInteracting = true;
                    // Capturar si había una selección parcial activa en el editor
                    if (window.app && window.app.editingObjId) {
                        const el = document.getElementById(window.app.editingObjId);
                        const span = el && el.querySelector('.text-content');
                        const sel = window.getSelection();
                        if (span && sel.rangeCount > 0) {
                            const range = sel.getRangeAt(0);
                            const hasPartial = !range.collapsed && range.toString().length < (span.innerText || '').length;
                            if (hasPartial) {
                                window._lastTextEditorRange = range.cloneRange();
                                window._lastTextEditorSpan = span;
                                window._hadPartialSelection = true;
                            } else {
                                window._hadPartialSelection = false;
                            }
                        }
                    }
                }, true);
                ribbon.addEventListener('mouseup', () => {
                    setTimeout(() => { window._ribbonInteracting = false; }, 150);
                }, true);
                ribbon.addEventListener('mouseleave', () => {
                    setTimeout(() => { window._ribbonInteracting = false; }, 150);
                }, true);
                
                // Si un select del ribbon pierde el foco, o cambia, devolvemos foco al editor activo
                const returnFocus = () => {
                    if (window.app && window.app.editingObjId) {
                        const el = document.getElementById(window.app.editingObjId);
                        const span = el && el.querySelector('.text-content');
                        if (span) setTimeout(() => { if (document.body.contains(span)) span.focus(); }, 10);
                    }
                };
                const selects = ribbon.querySelectorAll('select');
                selects.forEach(sel => {
                    sel.addEventListener('change', returnFocus);
                });
                const inputs = ribbon.querySelectorAll('input');
                inputs.forEach(inp => {
                    inp.addEventListener('change', returnFocus);
                    inp.addEventListener('blur', returnFocus);
                });
            }
        });

        // Cerrar dropdown de recientes al hacer clic fuera
        document.addEventListener('click', function (e) {
            const dropdown = document.getElementById('recent-docs-dropdown');
            const btn = document.getElementById('recent-docs-btn');
            if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        // Auto-resize textarea del chat de IA
        document.addEventListener('DOMContentLoaded', () => {
            // Auto-apply round close button to all static glass-box and properties modals
            const modals = [...document.querySelectorAll('.glass-box'), ...document.querySelectorAll('#properties-modal > div')];
            modals.forEach(modal => {
                if (modal.id === 'drop-modal-content' || modal.id === 'loading-overlay' || modal.id === 'loader' || modal.id === 'command-palette-modal' || modal.closest('#theme-modal') || modal.querySelector('.modal-close-btn-round')) return;

                // Remove existing top-right corner close buttons to avoid duplicates
                const potentialCloses = modal.querySelectorAll('button, span');
                potentialCloses.forEach(btn => {
                    const txt = btn.textContent.trim();
                    const style = btn.getAttribute('style') || '';
                    if (btn.classList.contains('iem-close-btn') || 
                        txt === '✕' || 
                        txt === '✕' ||
                        (btn.onclick && (btn.onclick.toString().includes('closeAllModals') || btn.onclick.toString().includes('closeShapeProperties') || btn.onclick.toString().includes('ttf-props-dialog')) && 
                         (style.includes('position:absolute') || style.includes('right:') || style.includes('background:none') || style.includes('background:transparent')))) {
                        // Avoid removing standard bottom buttons like "Cerrar" or "Cancelar"
                        if (!btn.classList.contains('capsule-btn')) {
                            btn.remove();
                        }
                    }
                });

                // Ensure the modal has position relative for absolute positioning of the close button
                const currentStyle = modal.getAttribute('style') || '';
                if (!currentStyle.includes('position:relative') && !currentStyle.includes('position: relative')) {
                    modal.style.position = 'relative';
                }

                // Create round close button
                const closeBtn = document.createElement('button');
                closeBtn.className = 'modal-close-btn-round';
                closeBtn.innerHTML = '✕';
                closeBtn.title = 'Cerrar';
                
                // Specific handlers for some modals
                if (modal.id === 'shape-properties-modal') {
                    closeBtn.onclick = (e) => { e.preventDefault(); app.closeShapeProperties(); };
                } else if (modal.id === 'translation-review-modal') {
                    closeBtn.onclick = (e) => { e.preventDefault(); app.closeTextTranslationModal(); };
                } else if (modal.id === 'ttf-props-dialog') {
                    closeBtn.onclick = (e) => { e.preventDefault(); document.getElementById('ttf-props-dialog').style.display='none'; };
                } else {
                    closeBtn.onclick = (e) => { e.preventDefault(); app.closeAllModals(); };
                }

                modal.appendChild(closeBtn);
            });

            const aiInput = document.getElementById('ai-input');
            if (aiInput) {
                aiInput.addEventListener('input', function () {
                    this.style.height = 'auto';
                    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
                });
            }

            // Verificar que el panel AI existe y tiene los estilos correctos
            const aiPanel = document.getElementById('ai-panel');
            if (aiPanel) {
                console.log('✅ Panel AI encontrado en DOM');
                console.log('Estilos iniciales del panel:');
                console.log('- Position:', window.getComputedStyle(aiPanel).position);
                console.log('- Right:', window.getComputedStyle(aiPanel).right);
                console.log('- Display:', window.getComputedStyle(aiPanel).display);
                console.log('- Z-index:', window.getComputedStyle(aiPanel).zIndex);
                console.log('- Width:', window.getComputedStyle(aiPanel).width);
            } else {
                console.error('❌ Panel AI NO encontrado en DOM');
            }

            // Event listener del botón AI ya está en el onclick del HTML
            // No agregamos listener adicional para evitar doble toggle

            // Botón del índice: ahora es el toggle en la sidebar (toggleSbIndex)
        });

// Emitir evento app:ready para módulos tardíos
window.__appReady = true;
window.dispatchEvent(new Event('app:ready'));
