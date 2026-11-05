        // Setup object context menu listener after page loads
        document.addEventListener('DOMContentLoaded', function () {
            if (window._contextMenuInitialized) return;
            window._contextMenuInitialized = true;
            
            console.log('🔧 [DOM Ready] Setting up object context menu...');

            // Global right-click handler for all objects in overlay layer
            document.addEventListener('contextmenu', function (e) {
                // Skip if it's the custom shortcut button (has its own handler)
                if (e.target.closest('#btn-custom-shortcut') || e.target.closest('#btn-custom-shortcut2')) return;

                // Check if app exists and text select mode is not active
                if (!window.app) {
                    return;
                }
                if (app.isTextSelectMode) {
                    return;
                }

                // Try multiple methods to find target element
                // Method 1: Direct .draggable
                let target = e.target.closest('.draggable');

                // Method 2: Find parent with ID starting with 'obj-'
                if (!target) {
                    let el = e.target;
                    while (el && el !== document.body) {
                        if (el.id && el.id.startsWith('obj-')) {
                            target = el;
                            break;
                        }
                        el = el.parentElement;
                    }
                }

                // Method 3: Check if inside overlay-layer and find wrapper with id
                if (!target) {
                    const overlayLayer = e.target.closest('[id^="overlay-layer"]');
                    if (overlayLayer) {
                        // Look for any element with an obj- ID
                        let el = e.target;
                        while (el && el !== overlayLayer) {
                            if (el.id && el.id.startsWith('obj-')) {
                                target = el;
                                break;
                            }
                            el = el.parentElement;
                        }
                    }
                }

                console.log('🔧 [Right-click] Found target element:', target);

                if (!target) {
                    console.log('🔧 [Right-click] No valid target found, using default menu');
                    return; // Not an object, let default menu appear
                }

                e.preventDefault();
                e.stopPropagation();

                console.log('🔧 [Right-click] Context menu on object:', target.id);

                // Find the panel
                const overlayParent = target.closest('[id^="overlay-layer"]');
                const panelId = overlayParent?.id.includes('secondary') ? 'secondary' : 'primary';

                // Get object data
                const obj = app.getObjectById ? app.getObjectById(target.id, panelId) : null;
                console.log('🔧 [Right-click] Object data:', obj);

                if (obj && typeof app.showContextMenu === 'function') {
                    // If right-clicking an object already in multi-selection, preserve the selection
                    // If right-clicking outside the current selection, switch to that single object
                    if (!app.multiObjectSelection || !app.multiObjectSelection.has(obj.id)) {
                        app.multiObjectSelection = app.multiObjectSelection || new Set();
                        app.multiObjectSelection.clear();
                        app.multiObjectSelection.add(obj.id);
                    }
                    app.selectedObj = obj;
                    app.showContextMenu(e, obj, panelId);
                } else {
                    console.warn('🔧 Could not find object or showContextMenu', { obj, target: target.id, panelId });
                }
            });

            console.log('🔧 [DOM Ready] Context menu listener registered!');
        });

        // Use capturing phase to intercept before any other context menu listeners
        window.addEventListener('contextmenu', function (e) {
            // Block right-click if no document is loaded (i.e. app is not ready, or active document has no pages)
            const doc = window.app && typeof app.getDoc === 'function' && app.getDoc();
            const hasDoc = !!(doc && doc.pages && doc.pages.length > 0);
            if (!hasDoc && !e.target.closest('[id^="btn-custom-shortcut"]')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Allow the custom shortcut button to handle its own right-click
            if (e.target.closest('[id^="btn-custom-shortcut"]')) return;
            // Block right-click only if the target is inside the header or the ribbon
            if (e.target.closest('.app-header, .ribbon-container, #ribbonContainer, .header-tabs-wrapper, .tabs-container')) {
                e.preventDefault();
                e.stopPropagation(); // Stops other handlers (like the object context listener) from processing it
            }
        }, true);
