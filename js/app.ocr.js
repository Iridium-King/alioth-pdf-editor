// Browser OCR workers backed by bundled Tesseract assets.
if (!window.app) window.app = {};

Object.assign(window.app, {
    _ocrWorkers: new Map(),

    _createLocalOCRWorker: async function (languages, logger = () => {}) {
        if (typeof Tesseract === 'undefined') await this.lazyLoad('tesseract');
        if (typeof Tesseract === 'undefined') throw new Error('OCR_LOCAL_UNAVAILABLE');
        const worker = Tesseract.createWorker(languages, 1, {
            workerPath: 'libs/tesseract.worker.min.js',
            workerBlobURL: false,
            corePath: 'libs/ocr-offline',
            langPath: 'libs/ocr-offline',
            logger
        });
        let timer;
        try {
            return await Promise.race([worker, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('OCR_LOCAL_START_TIMEOUT')), 30000);
            })]);
        } catch (error) {
            worker.then(instance => instance.terminate()).catch(() => {});
            throw error;
        } finally {
            clearTimeout(timer);
        }
    },

    _getOCRWorker: function (psmMode = 3) {
        if (!this._ocrWorkers.has(psmMode)) {
            const pending = (async () => {
                const worker = await this._createLocalOCRWorker('spa', message => {
                    if (message.status !== 'recognizing text') return;
                    const label = document.getElementById('loader-msg');
                    if (label) label.innerText = `OCR: ${Math.round(message.progress * 100)}% completado...`;
                });
                try {
                    await worker.setParameters({ tessedit_pageseg_mode: psmMode, preserve_interword_spaces: '1' });
                    return worker;
                } catch (error) {
                    await worker.terminate().catch(() => {});
                    throw error;
                }
            })().catch(error => {
                this._ocrWorkers.delete(psmMode);
                throw error;
            });
            this._ocrWorkers.set(psmMode, pending);
        }
        return this._ocrWorkers.get(psmMode);
    },
});
