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

    assert.equal(await page.evaluate(() => PythonManager.isLoaded), false);
    let failedOnce = false;
    await page.route('**/libs/python_engine/pyodide.js', route => {
      if (!failedOnce) { failedOnce = true; return route.abort(); }
      return route.continue();
    });
    assert.equal(await page.evaluate(() => app._ensurePythonEngine()), false);
    const result = await page.evaluate(async () => {
      const ready = await app._ensurePythonEngine();
      if (!ready) throw new Error('Retry failed');
      const encoded = await PythonManager.run(`
import fitz, io, base64
from PIL import Image
image = Image.new('RGB', (40, 30), 'red')
stream = io.BytesIO()
image.save(stream, format='PNG')
doc = fitz.open()
doc.new_page(width=200, height=200)
page = doc.new_page(width=200, height=200)
page.insert_image(fitz.Rect(20, 20, 100, 80), stream=stream.getvalue())
encoded = base64.b64encode(doc.tobytes()).decode()
doc.close()
encoded
`);
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const selection = { width: 200, height: 200, transform: [1, 0, 0, -1, 0, 200], point: [40, 40] };
      const extracted = await PythonManager.liftPdfImage(bytes.buffer, 1, selection);
      const noImage = await PythonManager.liftPdfImage(bytes.buffer, 0, selection);
      const transparent = await PythonManager.removeImageBackground(extracted.base64);
      return { ready, image: !!extracted.base64, erased: extracted.buffer.byteLength > 0,
        correctPage: !noImage, transparent: transparent.startsWith('data:image/') };
    });
    assert.deepEqual(result, { ready: true, image: true, erased: true, correctPage: true, transparent: true });
    console.log('PASS: offline cold start, failed script retry, real PyMuPDF image extraction/erasure and Pillow background removal', result);
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
