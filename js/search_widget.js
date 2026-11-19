/**
 * Alioth PDF Editor - Search Float Widget
 * Gestiona la expansión y el foco del widget de búsqueda junto al panel IA.
 */
(function () {
    let initialized = false;

    function initSearchWidget() {
        const widget = document.getElementById('search-float-widget');
        const input = document.getElementById('searchInput');
        const toggle = document.getElementById('search-widget-toggle-btn');
        if (initialized || !widget || !input || !toggle) return;
        initialized = true;

        if (!window.app) window.app = {};
        let openedOnHover = false;

        window.app.expandSearchWidget = function (focusAndSelect = true) {
            openedOnHover = false;
            widget.classList.remove('collapsed');
            widget.classList.add('expanded');
            toggle.setAttribute('aria-expanded', 'true');

            if (focusAndSelect) {
                input.focus({ preventScroll: true });
                input.select();
            }
        };

        window.app.collapseSearchWidget = function (e) {
            if (e && typeof e.stopPropagation === 'function') {
                e.preventDefault();
                e.stopPropagation();
            }
            openedOnHover = false;
            widget.classList.remove('expanded');
            widget.classList.add('collapsed');
            toggle.setAttribute('aria-expanded', 'false');
            input.blur();
        };

        window.app.toggleSearchWidget = function (e) {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            if (widget.classList.contains('expanded') && !openedOnHover) {
                window.app.collapseSearchWidget(e);
            } else {
                window.app.expandSearchWidget(true);
            }
        };

        widget.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'mouse' || event.buttons) return;
            if (widget.classList.contains('collapsed')) {
                window.app.expandSearchWidget();
                openedOnHover = true;
            } else if (document.activeElement !== input) {
                input.focus({ preventScroll: true });
            }
        });
        widget.addEventListener('pointerleave', () => { openedOnHover = false; });

        // Cerrar al hacer clic o tocar fuera de la cápsula
        const handleOutsideClick = (e) => {
            if (widget.classList.contains('expanded') && !widget.contains(e.target)) {
                window.app.collapseSearchWidget();
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    }

    if (window.__appReady || window.app) {
        initSearchWidget();
    } else {
        window.addEventListener('app:ready', initSearchWidget, { once: true });
        window.addEventListener('DOMContentLoaded', initSearchWidget, { once: true });
    }
})();
