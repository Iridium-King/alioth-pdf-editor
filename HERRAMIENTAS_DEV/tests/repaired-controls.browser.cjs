const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');

(async () => {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/') || pathname === '/config') {
      response.setHeader('Content-Type', 'application/json'); response.end('{}'); return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/BASE.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await page.goto(origin + '/BASE.html');
    await page.waitForFunction(() => window.__appReady && app._eventsInitialized);
    const result = await page.evaluate(async () => {
      const missing = [];
      for (const element of document.querySelectorAll('*')) for (const attr of element.attributes) {
        if (!/^on\w+/.test(attr.name)) continue;
        for (const match of attr.value.matchAll(/\bapp\.([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)) {
          if (typeof app[match[1]] !== 'function') missing.push(match[1]);
        }
      }
      app._buildShortcutGroups();
      for (const item of app._shortcutPickerGroups.flatMap(group => group.items)) {
        for (const match of String(item.fn).matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)) {
          if (typeof app[match[1]] !== 'function') missing.push(match[1]);
        }
      }
      const palette = app._getPaletteCommandList();
      for (const command of palette) {
        for (const match of String(command.action).matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)) {
          if (typeof app[match[1]] !== 'function') missing.push(match[1]);
        }
      }
      const calls = [];
      for (const method of ['movePage', 'zoom', 'activateRealTextEditor', 'showFirmasModal', 'extractText', 'deletePage', 'extractPage', 'showCompressPDFModal', 'aiQuickAction', 'showTextTranslationModal', 'detectAndShowTables', 'enableCensorMode']) app[method] = (...args) => calls.push([method, ...args]);
      for (const id of ['nav_next', 'nav_prev', 'zoom_in', 'zoom_out', 'tool_splice_edit', 'tool_sign', 'tool_ocr', 'page_delete', 'page_extract', 'doc_compress', 'ai_summarize', 'ai_translate', 'ai_tables']) await palette.find(command => command.id === id).action();
      app._shortcutPickerGroups.flatMap(group => group.items).find(item => item.id === 'redactReal').fn();
      app.showDataExtractionModal(); app.dexSwitchExtractMode('batch');
      const input = document.getElementById('dex-batch-file-input');
      const transfer = new DataTransfer(); transfer.items.add(new File(['%PDF-1.4\n%%EOF'], 'audit.pdf', { type: 'application/pdf' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change'));
      const queued = app._dexBatchFiles.length;
      document.querySelector('[onclick="app.dexClearBatchFiles()"]').click();
      const cleared = app._dexBatchFiles.length;
      let copied;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
      app._dexRenderedFields = [{ key: 'Nombre', value: 'PRUEBA' }]; await app.dexCopyToClipboard();
      app.getDoc = () => ({ id: 'audit', pages: [{ objects: [] }] });
      app.savePDFInternal = async () => new Uint8Array([37, 80, 68, 70]);
      app._dexRenderResults = async () => {};
      localStorage.setItem('gemini_api_key', 'audit-placeholder-not-a-real-key');
      window.fetch = async () => new Response(JSON.stringify({ fields: [{ key: 'Nombre', value: 'PRUEBA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      await app.dexExtract();
      return { missing, paletteCount: palette.length, calls, queued, cleared, copied, extractionStatus: document.getElementById('dex-status').textContent, extractionBusy: app._dexBusy };
    });
    assert.deepEqual(result.missing, []);
    assert.equal(result.calls.length, 14);
    assert.deepEqual(result.calls[0], ['movePage', 1]);
    assert.deepEqual(result.calls[1], ['movePage', -1]);
    assert.equal(result.queued, 1); assert.equal(result.cleared, 0);
    assert.equal(result.copied, 'Nombre\nPRUEBA');
    assert.ok(result.extractionStatus.startsWith('Extracción completa:'), result.extractionStatus);
    assert.equal(result.extractionBusy, false);
    console.log(`PASS: ${result.paletteCount} palette bindings, shortcut catalogue, inline handlers, batch upload/clear, TSV and successful extraction`);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
