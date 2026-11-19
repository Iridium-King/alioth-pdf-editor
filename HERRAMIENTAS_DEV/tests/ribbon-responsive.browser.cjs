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
    const page = await browser.newPage({ deviceScaleFactor: 1.25 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    await page.goto(origin + '/BASE.html');
    await page.waitForFunction(() => window.__appReady && app._eventsInitialized);

    const localButton = page.getByRole('button', { name: 'Continuar solo con edición local' });
    if (await localButton.isVisible()) await localButton.click();
    const iconColors = await page.locator('#btn-header-save-as').evaluate(button => ({
      body: getComputedStyle(button.querySelector('svg > path:not(.save-as-pencil)')).stroke,
      pencil: getComputedStyle(button.querySelector('.save-as-pencil')).stroke,
      normal: getComputedStyle(button).color,
      border: getComputedStyle(button).borderBottomColor
    }));
    assert.equal(iconColors.pencil, 'rgb(74, 222, 128)');
    assert.equal(iconColors.body, iconColors.normal);
    assert.notEqual(iconColors.border, iconColors.pencil);
    const results = [];
    for (const width of [960, 972, 1024, 1216, 1280, 1366, 1920, 960, 1920, 972]) {
      await page.setViewportSize({ width, height: 648 });
      for (const tab of ['home', 'image', 'draw', 'form', 'magic', 'ai']) {
        const result = await page.evaluate(tab => {
          app.switchRibbon(tab);
          app.fitRibbon();
          const bar = document.querySelector('.toolbar-area.active');
          const shortcut = bar.querySelector('[id^="shortcut-btn-section"]');
          const children = [...bar.children].filter(child => getComputedStyle(child).display !== 'none');
          const bounds = bar.getBoundingClientRect();
          const left = Math.min(...children.map(child => child.getBoundingClientRect().left));
          const right = Math.max(...children.map(child => child.getBoundingClientRect().right));
          const commands = [...bar.querySelectorAll('.tool-btn, .page-op-btn, .group-col-btn')].flatMap(button => {
            const icon = button.querySelector('svg, img');
            const label = button.querySelector(':scope > span:last-child');
            if (!icon || !label || !button.getClientRects().length) return [];
            const iconBounds = icon.getBoundingClientRect();
            return [{
              label: label.textContent.trim(),
              iconY: iconBounds.top + iconBounds.height / 2 - bounds.top,
              labelY: label.getBoundingClientRect().top - bounds.top
            }];
          });
          return { tab, hasShortcuts: !!shortcut, hidden: !!shortcut && getComputedStyle(shortcut).display === 'none',
            width: bar.clientWidth, content: right-left, centered: Math.abs((left+right)/2-(bounds.left+bounds.right)/2),
            overflow: bar.classList.contains('ribbon-overflow'), compact: bar.classList.contains('ribbon-compact'), tight: bar.classList.contains('ribbon-tight'), fitted: bar.classList.contains('ribbon-fit'), commands };
        }, tab);
        if (width > 1280) {
          assert.equal(result.hidden, false, JSON.stringify(result));
          assert.equal(result.fitted, false, JSON.stringify(result));
          assert.equal(result.compact, false, JSON.stringify(result));
        }
        assert.equal(result.overflow, false, JSON.stringify(result));
        assert.ok(result.centered < 4, JSON.stringify(result));
        const { commands, ...layout } = result;
        assert.ok(commands.length > 0, tab);
        for (const command of commands) {
          assert.ok(Math.abs(command.iconY - 17) < 1, JSON.stringify({ width, tab, ...command }));
          assert.ok(Math.abs(command.labelY - 31.5) < 1, JSON.stringify({ width, tab, ...command }));
        }
        results.push({ viewport: width, ...layout });
      }
    }

    const clippedHomeLabels = await page.evaluate(() => {
      app.switchRibbon('home');
      return [...document.querySelectorAll('.home-text-actions > .tool-btn')].flatMap(button => {
        const label = button.querySelector(':scope > span:last-child');
        const range = document.createRange();
        range.selectNodeContents(label);
        const clipBottom = button.getBoundingClientRect().bottom - parseFloat(getComputedStyle(button).borderBottomWidth);
        return range.getBoundingClientRect().bottom > clipBottom ? [label.textContent.trim()] : [];
      });
    });
    assert.deepEqual(clippedHomeLabels, []);

    const flipRows = await page.evaluate(() => {
      app.switchRibbon('image');
      return [...document.querySelectorAll('.image-flip-controls > button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { x: bounds.left, top: bounds.top, bottom: bounds.bottom };
      });
    });
    assert.equal(flipRows.length, 2);
    assert.equal(flipRows[0].x, flipRows[1].x);
    assert.ok(flipRows[0].bottom <= flipRows[1].top);

    fs.writeFileSync(path.join(root, 'HERRAMIENTAS_DEV/qa-runtime/ribbon-responsive-3238.json'), JSON.stringify(results,null,2));
    await page.evaluate(() => app.switchRibbon('home'));
    if (await localButton.isVisible()) await localButton.click();
    await page.waitForTimeout(300);
    const apiNotice = page.getByRole('button', { name: 'No mostrar nunca más', exact: true });
    if (await apiNotice.isVisible()) await apiNotice.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(root, 'HERRAMIENTAS_DEV/qa-runtime/ribbon-972-3238.png') });
    for (const tab of ['image', 'form', 'ai']) {
      await page.evaluate(tab => app.switchRibbon(tab), tab);
      await page.screenshot({ path: path.join(root, `HERRAMIENTAS_DEV/qa-runtime/ribbon-${tab}-972-3238.png`) });
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
