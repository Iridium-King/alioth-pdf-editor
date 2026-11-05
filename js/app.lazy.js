// app.lazy.js — Sistema de Carga Dinámica Bajo Demanda (On-Demand Lazy Loading)
// Permite que librerías pesadas (Tesseract, Pyodide, Mammoth, SheetJS, QR, Barcode)
// se descarguen e instancien únicamente en el momento exacto en que el usuario usa la función.
// Compatible con llamadas concurrentes (Promise Caching) y 100% no-destructivo.

(function () {
    if (!window.app) window.app = {};
    const app = window.app;

    const _scriptPromises = new Map();

    /**
     * Carga un archivo JS de forma asíncrona mediante inyección en el DOM.
     * Retorna una Promesa que resuelve cuando el script está listo.
     */
    function loadScript(src) {
        if (_scriptPromises.has(src)) {
            return _scriptPromises.get(src);
        }

        // Si el script ya existe en el DOM por cualquier motivo
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            const p = Promise.resolve();
            _scriptPromises.set(src, p);
            return p;
        }

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                resolve();
            };
            script.onerror = (err) => {
                _scriptPromises.delete(src);
                console.error(`[AppLazy] Error al cargar script: ${src}`, err);
                reject(new Error(`No se pudo cargar la librería: ${src}`));
            };
            document.head.appendChild(script);
        });

        _scriptPromises.set(src, promise);
        return promise;
    }

    /**
     * Diccionario de bundles bajo demanda disponibles
     */
    const BUNDLES = {
        'tesseract': ['libs/tesseract.min.js'],
        'mammoth': ['libs/mammoth.browser.min.js'],
        'xlsx': ['libs/xlsx.full.min.js'],
        'office': ['libs/mammoth.browser.min.js', 'libs/xlsx.full.min.js'],
        'qrcode': ['libs/qrcode.min.js'],
        'jsqr': ['libs/jsqr.min.js'],
        'jsbarcode': ['libs/JsBarcode.all.min.js'],
        'zxing': ['libs/zxing.min.js'],
        'barcode': ['libs/JsBarcode.all.min.js', 'libs/qrcode.min.js', 'libs/jsqr.min.js'],
        'pyodide': ['libs/python_engine/pyodide.js']
    };

    /**
     * Método principal para requerir una librería bajo demanda
     * @param {string} bundleName - Clave del bundle ('tesseract', 'office', 'xlsx', 'pyodide', etc.)
     * @returns {Promise<boolean>}
     */
    app.lazyLoad = async function (bundleName) {
        const key = (bundleName || '').toLowerCase().trim();
        const files = BUNDLES[key];
        if (!files) {
            console.warn(`[AppLazy] Bundle desconocido: "${bundleName}"`);
            return false;
        }

        try {
            await Promise.all(files.map(src => loadScript(src)));
            return true;
        } catch (e) {
            console.error(`[AppLazy] Falló la carga on-demand de "${bundleName}":`, e);
            if (app.showToast) {
                app.showToast(`⚠️ Error al cargar componente: ${bundleName}`);
            }
            throw e;
        }
    };

    window.AppLazy = {
        load: app.lazyLoad,
        loadScript: loadScript
    };

})();
