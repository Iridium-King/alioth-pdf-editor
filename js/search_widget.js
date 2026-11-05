/**
 * Alioth PDF Editor - Search Float Widget
 * Controla el widget flotante de búsqueda centrado en el borde inferior de la ventana,
 * con animación suave de expansión/colapso y atajo rápido Ctrl+F.
 */
(function () {
    function initSearchWidget() {
        if (!window.app) window.app = {};

        window.app.expandSearchWidget = function (focusAndSelect = true) {
            const widget = document.getElementById('search-float-widget');
            if (!widget) return;

            widget.classList.remove('collapsed');
            widget.classList.add('expanded');

            if (focusAndSelect) {
                setTimeout(() => {
                    const input = document.getElementById('searchInput');
                    if (input) {
                        input.focus();
                        input.select();
                    }
                }, 100);
            }
        };

        window.app.collapseSearchWidget = function (e) {
            if (e && typeof e.stopPropagation === 'function') {
                e.preventDefault();
                e.stopPropagation();
            }
            const widget = document.getElementById('search-float-widget');
            if (!widget) return;

            widget.classList.remove('expanded');
            widget.classList.add('collapsed');

            const input = document.getElementById('searchInput');
            if (input) input.blur();
        };

        window.app.toggleSearchWidget = function (e) {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            const widget = document.getElementById('search-float-widget');
            if (!widget) return;

            if (widget.classList.contains('expanded')) {
                window.app.collapseSearchWidget(e);
            } else {
                window.app.expandSearchWidget(true);
            }
        };

        // Cerrar al hacer clic o tocar fuera de la cápsula
        const handleOutsideClick = (e) => {
            const widget = document.getElementById('search-float-widget');
            if (!widget || !widget.classList.contains('expanded')) return;

            if (!widget.contains(e.target)) {
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
