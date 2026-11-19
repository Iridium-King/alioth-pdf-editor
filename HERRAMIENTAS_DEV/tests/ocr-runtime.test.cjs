const assert = require('node:assert/strict');
const test = require('node:test');
const { loadAppModules } = require('./helpers/document-harness.cjs');

test('OCR uses local assets and clears a failed worker initialization for the next attempt', async () => {
  const settings = [];
  let attempts = 0;
  const worker = { async setParameters() {}, async terminate() {} };
  const { app } = loadAppModules(['js/app.ocr.js'], {
    Tesseract: {
      async createWorker(language, mode, options) {
        settings.push({ language, mode, options });
        if (++attempts === 1) throw new Error('Worker unavailable');
        return worker;
      }
    }
  });

  const first = app._getOCRWorker();
  assert.equal(first, app._getOCRWorker());
  await assert.rejects(first, /Worker unavailable/);
  assert.equal(await app._getOCRWorker(), worker);
  assert.equal(attempts, 2);
  assert.equal(settings[1].language, 'spa');
  assert.equal(settings[1].options.workerPath, 'libs/tesseract.worker.min.js');
  assert.equal(settings[1].options.corePath, 'libs/ocr-offline');
  assert.equal(settings[1].options.langPath, 'libs/ocr-offline');
});
