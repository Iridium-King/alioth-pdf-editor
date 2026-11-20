const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const origin = 'http://127.0.0.1:8080';

(async () => {
    const preferences = {};
    let browser;
    try {
        browser = await chromium.launch({
            executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
            headless: true
        });
        async function openEditor(seed) {
            const page = await browser.newPage({ viewport: { width: 1920, height: 1040 } });
            await page.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.protocol === 'data:') return route.continue();
                if (url.origin !== origin) return route.abort();
                const pathname = decodeURIComponent(url.pathname);
                if (pathname.startsWith('/api/') || pathname === '/config') {
                    if (pathname === '/api/preferences' && request.method() === 'POST') {
                        Object.assign(preferences, request.postDataJSON());
                    }
                    return route.fulfill({ json: {} });
                }
                const file = path.resolve(root, '.' + pathname);
                if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                    return route.fulfill({ status: 404 });
                }
                const contentType = ({
                    '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm'
                })[path.extname(file)] || 'application/octet-stream';
                return route.fulfill({ path: file, contentType });
            });
            if (seed) await page.addInitScript(values => { window.__aliothPreferences = values; }, seed);
            await page.goto(origin + '/BASE.html');
            await page.waitForFunction(() => window.__appReady && app._eventsInitialized);
            const local = page.getByRole('button', { name: 'Continuar solo con edición local' });
            await local.click();
            return page;
        }

        const page = await openEditor();
        page.on('console', message => {
            if (message.type() === 'error' && /PDF image selection failed|Continuous render error|Error rendering background page/.test(message.text())) {
                console.error(message.text());
            }
        });
        await page.evaluate(() => app.showPreferencesModal('pref-appearance'));
        await page.getByRole('button', { name: 'Apariencia' }).click();
        for (const [section, percent] of [['header', 130], ['sidebar', 120], ['ribbon', 140]]) {
            await page.locator(`#pref-scale-${section}`).fill(String(percent));
            assert.equal(await page.locator(`output[for="pref-scale-${section}"]`).textContent(), percent + '%');
        }
        const interfaceScale = page => page.evaluate(() => ['.app-header', '#sidebarContainer', '#ribbon-capsule-wrapper']
            .map(selector => Number(getComputedStyle(document.querySelector(selector)).zoom)));
        assert.deepEqual(await interfaceScale(page), [1.3, 1.2, 1.4]);
        await page.getByRole('button', { name: 'Temas y colores', exact: true }).click();
        await page.locator('#theme-modal').waitFor({ state: 'visible' });
        const colors = await page.evaluate(() => ['textColor', 'shapeFill', 'iem-sc', 'modalHeaderColor', 'link-color'].map(id => {
            const style = getComputedStyle(document.getElementById(id));
            return [style.width === style.height, style.borderRadius];
        }));
        assert.deepEqual(colors, Array(5).fill([true, '30%']));
        await page.evaluate(() => window.aliothPreferences.flush());
        assert.deepEqual(['header', 'sidebar', 'ribbon'].map(section => preferences['alioth_interface_scale_' + section]),
            ['130', '120', '140']);
        const reopened = await openEditor(preferences);
        assert.deepEqual(await interfaceScale(reopened), [1.3, 1.2, 1.4]);
        await reopened.close();
        await page.evaluate(() => app.closeAllModals());
        await page.evaluate(() => app.showPreferencesModal('pref-appearance'));
        await page.getByRole('button', { name: 'Restablecer escala' }).click();
        assert.deepEqual(await interfaceScale(page), [1, 1, 1]);
        await page.evaluate(() => app.closeAllModals());

        await page.evaluate(async () => {
            const fixture = await PythonManager.run(`
import io, pymupdf as fitz
from PIL import Image
test_doc = fitz.open()
test_page = test_doc.new_page(width=420, height=640)
scan = io.BytesIO()
Image.new('RGB', (840, 1280), (37, 110, 195)).save(scan, format='PNG')
scan_ref = test_page.insert_image(test_page.rect, stream=scan.getvalue())
test_page.insert_text((130, 160), 'Texto conservado')
test_page = test_doc.new_page(width=420, height=640)
test_page.insert_image(test_page.rect, xref=scan_ref)
for w, h in [(320, 350), (460, 900), (500, 440), (420, 700)]:
    test_doc.new_page(width=w, height=h)
bytes(test_doc.tobytes())`);
            const bytes = fixture.toJs ? fixture.toJs() : fixture;
            fixture.destroy?.();
            await app.openFile(new File([bytes], 'prueba-escaneo.pdf', { type: 'application/pdf' }));
            if (app.viewMode !== 'continuous') app.toggleViewMode();
        });
        const anchor = () => page.evaluate(() => {
            const view = document.getElementById('mainViewPrimary');
            const target = document.getElementById('page-wrapper-primary-3');
            const bounds = target.getBoundingClientRect();
            return (view.getBoundingClientRect().top + view.clientHeight / 2 - bounds.top) / bounds.height;
        });
        await page.waitForFunction(() => typeof document.getElementById('mainViewPrimary').onscroll === 'function');
        for (const width of [1920, 2560]) {
            await page.setViewportSize({ width, height: 1040 });
            await page.evaluate(() => document.getElementById('zoomBtnReset').click());
            await page.waitForTimeout(500);
            await page.evaluate(() => {
                const view = document.getElementById('mainViewPrimary');
                const bounds = document.getElementById('page-wrapper-primary-3').getBoundingClientRect();
                view.scrollTop += bounds.top + bounds.height * 0.64 - view.getBoundingClientRect().top - view.clientHeight / 2;
            });
            await page.waitForFunction(() => app.getDoc().currentIndex === 3);
            const before = await anchor();
            await page.evaluate(() => app.fitToWidth());
            await page.waitForFunction(() => !app._zoomDebounceTimer && typeof document.getElementById('mainViewPrimary').onscroll === 'function');
            assert.equal(await page.evaluate(() => app.getDoc().currentIndex), 3);
            assert.ok(Math.abs(await anchor() - before) < 0.02);
        }

        await page.evaluate(async () => {
            app.toggleViewMode();
            await app.loadPage(0);
            app.zoomPanel(1 - app.currentScale, 'primary');
            app.switchRibbon('image');
        });
        await page.waitForTimeout(500);
        await page.locator('#btn-edit-image').click();
        const canvas = await page.locator('#the-canvas').boundingBox();
        assert.ok(canvas);
        await page.mouse.move(canvas.x + canvas.width * 0.23, canvas.y + canvas.height * 0.19);
        await page.mouse.down();
        await page.mouse.move(canvas.x + canvas.width * 0.48, canvas.y + canvas.height * 0.32, { steps: 8 });
        await page.locator('.image-edit-selection').waitFor({ state: 'visible' });
        await page.mouse.up();
        await page.waitForFunction(() => app.selectedObj?.id.startsWith('img_surg_') && !app._imageEditBusy);
        const object = page.locator('.draggable.selected[data-type="image"]');
        const beforeMove = await object.boundingBox();
        await page.mouse.move(beforeMove.x + 20, beforeMove.y + 20);
        await page.mouse.down();
        await page.mouse.move(beforeMove.x + 140, beforeMove.y + 185, { steps: 10 });
        await page.mouse.up();
        const afterMove = await object.boundingBox();
        assert.ok(afterMove.x > beforeMove.x + 100 && afterMove.y > beforeMove.y + 140);
        const handle = await object.locator('.resize-handle.rh-br').boundingBox();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + 42, handle.y + 28, { steps: 8 });
        await page.mouse.up();
        assert.ok((await object.boundingBox()).width > afterMove.width + 25);

        const res = await page.evaluate(async () => {
            const bytes = await app.generatePDFBuffer();
            return JSON.parse(await PythonManager.run(`
import json
with fitz.open(stream=bytes(edited_pdf.to_py()), filetype='pdf') as reopened_pdf:
    pixels = reopened_pdf[0].get_pixmap()
    result = json.dumps({
        'hole': pixels.pixel(105, 140), 'moved': pixels.pixel(232, 313),
        'reused': reopened_pdf[1].get_pixmap().pixel(105, 140),
        'text': reopened_pdf[0].get_text()
    })
result
            `, { edited_pdf: new Uint8Array(bytes) }));
        });
        assert.deepEqual(res.hole, [255, 255, 255]);
        assert.deepEqual(res.moved, [37, 110, 195]);
        assert.deepEqual(res.reused, [37, 110, 195]);
        assert.match(res.text, /Texto conservado/);
        await page.keyboard.press('Delete');
        await object.waitFor({ state: 'detached' });
        await page.evaluate(() => app.undo());
        await page.locator('.draggable[data-type="image"]').waitFor({ state: 'visible' });
        await page.evaluate(() => app.redo());
        await page.locator('.draggable[data-type="image"]').waitFor({ state: 'detached' });
        await page.evaluate(async () => {
            await app.loadPage(1);
            app.toggleViewMode();
        });
        await page.waitForFunction(() => !!document.querySelector('#page-wrapper-primary-1 #the-canvas')?.offsetHeight);
        await page.locator('#page-wrapper-primary-1').scrollIntoViewIfNeeded();
        await page.locator('#btn-edit-image').click();
        const hit = await page.locator('#page-wrapper-primary-1').evaluate(wrapper => {
            const bounds = wrapper.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            return { x, y, page: document.elementFromPoint(x, y)?.closest('.page-wrapper')?.dataset.index };
        });
        assert.equal(hit.page, '1', JSON.stringify(hit));
        await page.mouse.click(hit.x, hit.y);
        await page.waitForFunction(() => !app.imageEditMode && !app._imageEditBusy, null, { timeout: 10000 });
        const lifted = await page.evaluate(() => ({
            size: [app.selectedObj?.width, app.selectedObj?.height],
            page: app.getDoc().currentIndex,
            objects: app.getDoc().pages[1].objects.length,
            toast: document.getElementById('toast').textContent
        }));
        assert.deepEqual(lifted.size, [420, 640], JSON.stringify(lifted));
        assert.equal(await page.evaluate(() => app.viewMode), 'continuous');
        const cleared = await page.locator('#the-canvas').evaluate(canvas => {
            const { data } = canvas.getContext('2d').getImageData(40, 40, 1, 1);
            return Array.from(data);
        });
        assert.deepEqual(cleared, [255, 255, 255, 255]);
        console.log('PASS: live and persisted scale, square color controls, fit-width page anchor, scan selection/drag/resize/delete and saved PDF pixels.');
    } finally {
        if (browser) await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
