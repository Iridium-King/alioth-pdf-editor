const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function canvas() {
  const c = { style: {}, pixels: 'previous', width: 100, height: 120 };
  c.getContext = () => ({
    drawImage(source) { c.pixels = source.pixels; },
    fillRect() { c.pixels = 'white'; }
  });
  return c;
}

function fixture() {
  const tasks = [], wrappers = [], annotationCalls = [];
  const container = {
    style: {}, parentElement: null,
    closest() { return this.parentElement; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const elements = { canvas: canvas(), drawingLayer: canvas(), canvasContainer: container, mainView: {} };
  const doc = { id: 'doc', currentIndex: 0, sources: {}, pages: [] };
  for (let i = 0; i < 3; i++) {
    const bg = canvas();
    const wrapper = {
      style: {}, dataset: { index: String(i) }, bg,
      querySelector() { return bg; },
      appendChild(child) { child.parentElement = this; },
      scrollIntoView() {}
    };
    wrappers.push(wrapper);
    doc.pages.push({ id: `p${i}`, sourceId: 'source', pageIndex: i });
  }
  doc.sources.source = {
    buffer: new Uint8Array([1]),
    doc: {
      async getPage(n) {
        return {
          rotate: 0,
          getViewport({ scale }) { return { width: 100 * scale, height: 120 * scale, scale }; },
          render({ canvasContext }) {
            const done = deferred();
            const task = { ...done, n, cancel() { done.reject({ name: 'RenderingCancelledException' }); } };
            task.promise = done.promise.then(() => canvasContext.drawImage({ pixels: `page-${n}` }));
            tasks.push(task);
            return task;
          }
        };
      }
    }
  };
  const context = {
    window: { app: {} }, console,
    document: {
      getElementById(id) { return id.startsWith('page-wrapper-') ? wrappers[Number(id.split('-').at(-1))] : null; },
      querySelectorAll() { return []; },
      body: { classList: { contains() { return false; } } },
      createElement() { return canvas(); }
    },
    pdfjsLib: { AnnotationMode: { ENABLE_FORMS: 2 } }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/app.render.js'), 'utf8'), context);
  const app = context.window.app;
  Object.assign(app, {
    docs: [doc], activeDocId: doc.id, viewMode: 'continuous', currentScale: 1,
    splitView: { primary: { docId: doc.id, pageIndex: 0, scale: 1 }, activePanel: 'primary' },
    _continuousSessionToken: Symbol(),
    getPanelElements() { return elements; },
    async renderAnnotationLayer(page, vp, el, panel, p) { annotationCalls.push(p.id); },
    async renderTextLayer() {}, renderOverlays() {}, redrawDrawings() {}, setPageCount() {}
  });
  return { app, doc, elements, wrappers, tasks, annotationCalls };
}

test('precarga y página activa comparten una sola tarea; el contenido aparece completo', async () => {
  const f = fixture(), bg = f.wrappers[0].bg;
  const preload = f.app.renderBackgroundPage(f.doc, 0, bg, 1, f.wrappers[0], f.app._continuousSessionToken);
  f.app._moveCContainerToWrapper('primary', 0);
  const active = f.app._renderContinuousActivePage('primary', 0);
  await tick();
  assert.equal(f.tasks.length, 1);
  assert.equal(bg.style.display, '');
  assert.equal(f.elements.canvasContainer.style.display, 'none');
  assert.equal(bg.pixels, 'previous');
  f.tasks[0].resolve();
  await Promise.all([preload, active]);
  assert.equal(f.elements.canvas.pixels, 'page-1');
  assert.equal(f.elements.canvasContainer.style.display, 'block');
  assert.equal(bg.style.display, 'none');
  assert.deepEqual(f.annotationCalls, ['p0']);
  await f.app._renderContinuousActivePage('primary', 0);
  assert.equal(f.tasks.length, 1);
});

test('an offscreen background releases its pixels and renders again when requested', async () => {
  const f = fixture(), bg = f.wrappers[1].bg;
  let pending = f.app.renderBackgroundPage(f.doc, 1, bg, 1, f.wrappers[1], f.app._continuousSessionToken);
  await tick(); f.tasks[0].resolve(); await pending;
  const width = f.wrappers[1].style.width;
  f.app.releaseBackgroundCanvas(bg);
  assert.equal(bg.width * bg.height, 0);
  assert.equal(bg._pdfPage, null);
  assert.equal(f.wrappers[1].style.width, width);
  pending = f.app.renderBackgroundPage(f.doc, 1, bg, 1, f.wrappers[1], f.app._continuousSessionToken);
  await tick(); f.tasks[1].resolve(); await pending;
  assert.equal(bg.pixels, 'page-2');
  assert.equal(bg.width, 100);
});

test('cambio rápido descarta la página anterior aunque termine después', async () => {
  const f = fixture();
  f.app._moveCContainerToWrapper('primary', 0);
  const old = f.app._renderContinuousActivePage('primary', 0);
  await tick();
  f.app._moveCContainerToWrapper('primary', 1);
  const current = f.app._renderContinuousActivePage('primary', 1);
  await tick();
  f.tasks[1].resolve();
  await current;
  f.tasks[0].resolve();
  await old;
  assert.equal(f.elements.canvas.pixels, 'page-2');
  assert.deepEqual(f.annotationCalls, ['p1']);
  assert.equal(f.wrappers[0].bg.style.display, '');
});

test('navegación directa reutiliza la carga pendiente sin mostrar el lienzo anterior', async () => {
  const f = fixture();
  f.app._moveCContainerToWrapper('primary', 0);
  const first = f.app._renderContinuousActivePage('primary', 0);
  await tick();
  const navigation = f.app.loadPage(0, 'primary');
  await tick();
  assert.equal(f.tasks.length, 1);
  assert.equal(f.elements.canvasContainer.style.display, 'none');
  f.tasks[0].resolve();
  await Promise.all([first, navigation]);
  assert.equal(f.elements.canvas.pixels, 'page-1');
  assert.deepEqual(f.annotationCalls, ['p0']);
});

test('zoom conserva los píxeles previos durante la carga y la cancelación', async () => {
  const f = fixture(), bg = f.wrappers[0].bg;
  let pending = f.app.renderBackgroundPage(f.doc, 0, bg, 1, f.wrappers[0], f.app._continuousSessionToken);
  await tick(); f.tasks[0].resolve(); await pending;
  f.app._continuousSessionToken = Symbol();
  pending = f.app.renderBackgroundPage(f.doc, 0, bg, 2, f.wrappers[0], f.app._continuousSessionToken);
  await tick();
  assert.equal(bg.pixels, 'page-1');
  assert.equal(bg.width, 100);
  bg._renderRequestToken = null;
  bg._activeRenderTask.cancel();
  await pending;
  assert.equal(bg.pixels, 'page-1');
  pending = f.app.renderBackgroundPage(f.doc, 0, bg, 2, f.wrappers[0], f.app._continuousSessionToken);
  await tick(); f.tasks[2].resolve(); await pending;
  assert.equal(bg.width, 200);
  assert.equal(bg._renderedScale, 2);
});

test('nueva sesión y cambio de documento impiden publicar renders obsoletos', async () => {
  const f = fixture();
  f.app._moveCContainerToWrapper('primary', 0);
  const old = f.app._renderContinuousActivePage('primary', 0);
  await tick();
  f.app._continuousSessionToken = Symbol();
  f.app.splitView.primary.docId = 'other';
  f.tasks[0].resolve(); await old;
  assert.equal(f.elements.canvas.pixels, 'previous');
  assert.deepEqual(f.annotationCalls, []);
  assert.equal(f.wrappers[0].bg._renderedSessionToken, undefined);
});

test('páginas insertadas y generadas se muestran sin render PDF adicional', async () => {
  for (const generated of [false, true]) {
    const f = fixture();
    if (generated) f.doc.pages[0].canvas = { width: 250, height: 300, pixels: 'generated' };
    else Object.assign(f.doc.pages[0], { _blank: true, width: 200, height: 400, rotation: 90 });
    f.app._moveCContainerToWrapper('primary', 0);
    await f.app._renderContinuousActivePage('primary', 0);
    assert.equal(f.elements.canvas.pixels, generated ? 'generated' : 'white');
    assert.equal(f.elements.canvas.width, generated ? 250 : 400);
    assert.equal(f.tasks.length, 0);
    assert.equal(f.elements.canvasContainer.style.display, 'block');
    f.app._continuousSessionToken = Symbol();
    await f.app._renderContinuousActivePage('primary', 0);
    assert.equal(f.elements.canvas.width, generated ? 250 : 400);
  }
});
