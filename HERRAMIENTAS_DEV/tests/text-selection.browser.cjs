const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const sourceDir = process.env.ALIOTH_TEST_SOURCE_DIR || path.join(root, 'js');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="context-menu"></div><div id="sidebar-context-menu"></div>
      <div id="mainViewPrimary" class="view-panel main-view"><div id="canvas-container" style="position:relative;width:600px;height:700px">
      <canvas id="the-canvas" width="600" height="700" style="position:absolute;left:0;top:0"></canvas>
      <canvas id="drawing-layer"></canvas><div id="overlay-layer"></div></div></div>`);
    for (const file of ['app.tools.js', 'app.ui.js', 'app.render.js']) {
      await page.addScriptTag({ content: `(function(){${fs.readFileSync(path.join(sourceDir, file), 'utf8')}\n})();` });
    }
    await page.evaluate(() => {
      const obj = { id: 'test-text', type: 'text', text: 'Seleccionar palabras sin confirmar', x: 40, y: 50, width: 330, height: 35, size: 18, font: 'Helvetica', rotation: 0, isEditing: true, _pendingRealData: {} };
      const doc = { id: 'test', currentIndex: 0, pages: [{ objects: [obj] }] };
      Object.assign(app, {
        docs: [doc], activeDocId: doc.id, currentScale: 1,
        splitView: { activePanel: 'primary', primary: { docId: doc.id, scale: 1 } },
        selectedObj: obj, multiObjectSelection: new Set([obj.id]), multiSelection: new Set(),
        fontRegistry: { fonts: {} }, searchResults: [], commits: 0,
        getDoc: () => doc, _connRenderLayer() {}, syncToolbar() {}, renderCommentPins() {},
        renderSidebar() {}, saveState() {}, closeCommentPopup() {},
        _applyRealTextInlineCommit() { this.commits++; }
      });
      app.renderOverlays();
      app.setupDelegatedEvents();
      app.setupEvents();
    });
    const span = page.locator('#test-text .text-content');
    await span.dblclick({ position: { x: 35, y: 10 } });
    assert.equal(await page.evaluate(() => app.commits), 0);
    assert.ok(await page.evaluate(() => getSelection().toString().length > 0));
    await page.setViewportSize({ width: 950, height: 650 });
    await page.evaluate(() => app.renderOverlays());
    assert.equal(await page.evaluate(() => app.commits), 0, 'reconstruir el editor no debe confirmar');
    await span.dblclick({ position: { x: 35, y: 10 } });
    assert.equal(await page.evaluate(() => app.commits), 0);

    await page.evaluate(() => {
      const floating = document.createElement('div');
      floating.id = 'real-text-inline-editor';
      floating.style.cssText = 'position:absolute;top:180px;left:40px';
      floating.innerHTML = '<textarea>Seleccionar palabras en textarea</textarea>';
      document.getElementById('overlay-layer').appendChild(floating);
    });
    const textarea = page.locator('#real-text-inline-editor textarea');
    await textarea.dblclick();
    assert.equal(await textarea.count(), 1);
    assert.ok(await textarea.evaluate(el => el.selectionEnd > el.selectionStart));
    assert.equal(await page.evaluate(() => app.commits), 0);
    await page.evaluate(() => document.getElementById('real-text-inline-editor').remove());
    await span.click();
    await span.press('Control+Enter');
    assert.equal(await page.evaluate(() => app.commits), 1, 'Ctrl+Enter debe confirmar exactamente una vez');
    await page.evaluate(() => {
      app.censorCalls = [];
      app.showToast = () => {};
      app.applyCensorRegion = async (...args) => { app.censorCalls.push(args); };
      app._startCensorSelection(null, 'solid', 10);
    });
    const bounds = await span.boundingBox();
    await page.mouse.move(bounds.x + 10, bounds.y + 5);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 120, bounds.y + 25);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => app.censorCalls.length), 1, 'el overlay no debe interceptar el arrastre de censura');
    console.log('PASS: double click, resize/rebuild, floating textarea, explicit confirmation and censorship over overlays');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
