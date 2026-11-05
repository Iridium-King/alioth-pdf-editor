const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');

(async () => {
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/') { response.end('<!doctype html><title>Censor engine regression</title>'); return; }
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ url: '/libs/python_engine/pyodide.js' });
    await page.addScriptTag({ url: '/js/python_manager.js' });
    const results = await page.evaluate(async () => {
      await PythonManager.init();
      const source = await PythonManager.run(`
import fitz, io
from PIL import Image
doc = fitz.open()
page = doc.new_page(width=300, height=300)
img = Image.new('RGB', (300, 300), (40, 150, 220))
buf = io.BytesIO()
img.save(buf, format='PNG')
page.insert_image(page.rect, stream=buf.getvalue())
page.insert_text((100, 140), 'SECRETO', fontsize=12)
page.insert_text((20, 30), 'CONSERVAR', fontsize=12)
bytes(doc.tobytes())`);
      const data = source.toJs ? source.toJs() : source;
      const rect = { x0: 90, y0: 135, x1: 190, y1: 190 };
      const results = [];
      for (const effect of ['solid', 'blur', 'pixelate']) {
        const bytes = effect === 'solid'
          ? await PythonManager.applyRedactions(data.buffer, 0, [rect])
          : await PythonManager.applyCensorEffect(data.buffer, 0, rect, effect, 10);
        const check = await PythonManager.run(`
import json
out = fitz.open(stream=bytes(js_result.to_py()), filetype='pdf')
pix = out[0].get_pixmap()
json.dumps({'text': out[0].get_text(), 'outside': pix.pixel(15, 200), 'inside': pix.pixel(95, 120)})`, { js_result: new Uint8Array(bytes) });
        results.push({ effect, ...JSON.parse(String(check)) });
      }
      return results;
    });
    for (const result of results) {
      assert.ok(!result.text.includes('SECRETO'), JSON.stringify(result));
      assert.ok(result.text.includes('CONSERVAR'), JSON.stringify(result));
      assert.deepEqual(result.outside, [40, 150, 220]);
      if (result.effect === 'solid') assert.deepEqual(result.inside, [0, 0, 0]);
    }
    console.log('PASS: real Pyodide/PyMuPDF/Pillow for solid, blur and pixelate; reopened PDF verified');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
