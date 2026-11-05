const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(panelId = 'primary') {
  const mainView = {
    clientWidth: 1000, clientHeight: 700, scrollWidth: 1000,
    scrollLeft: 0, scrollTop: 1500,
    contains(target) { return target === container || wrappers.includes(target); },
    getBoundingClientRect() { return { left: 0, top: 0, right: 1000, bottom: 700 }; },
    querySelectorAll() { return wrappers; }
  };
  const wrappers = [0, 1, 2].map(index => ({
    id: `page-wrapper-${panelId}-${index}`, dataset: { index: String(index) },
    rect: { left: 300, top: (index - 1) * 440 + 50, width: 400, height: 400 },
    closest(selector) { return selector.includes('.page-wrapper') ? this : null; },
    getBoundingClientRect() {
      const r = this.rect;
      return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    }
  }));
  const container = {
    id: `canvas-container${panelId === 'secondary' ? '-secondary' : ''}`,
    hidden: false,
    closest(selector) {
      return selector.startsWith('.page-wrapper') && !selector.includes(',') ? wrappers[1] : this;
    },
    getBoundingClientRect() {
      return this.hidden ? { left: 0, top: 0, width: 0, height: 0 } : wrappers[1].getBoundingClientRect();
    }
  };
  let hit = container;
  const context = {
    window: { app: {} },
    document: {
      body: { classList: { contains() { return false; } } },
      elementFromPoint() { return hit; },
      getElementById(id) { return [container, ...wrappers].find(target => target.id === id); }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../js/app.render.js'), 'utf8'), context);
  const app = context.window.app;
  app.viewMode = 'continuous';
  app.getPanelElements = () => ({ mainView, canvasContainer: container });
  return { app, mainView, container, wrappers, setHit(target) { hit = target; } };
}

for (const panel of ['primary', 'secondary']) {
  test(`Ctrl + rueda conserva la página al ocultar y mover el canvas (${panel})`, () => {
    const f = fixture(panel);
    const anchor = f.app._captureZoomAnchor(panel, 500, 250);
    assert.equal(anchor.targetId, f.wrappers[1].id);
    f.container.hidden = true;
    f.wrappers[1].rect.top += 180;
    f.wrappers[1].rect.height = 500;
    assert.equal(f.app._restoreZoomAnchor(anchor), true);
    assert.equal(f.mainView.scrollTop, 1730);
  });
}

test('con zoom pequeño y cursor en el margen elige la página visible más cercana', () => {
  const f = fixture();
  f.setHit(null);
  const anchor = f.app._captureZoomAnchor('primary', 850, 600);
  assert.equal(anchor.targetId, f.wrappers[2].id);
});

test('en vista individual conserva el ancla del canvas', () => {
  const f = fixture();
  f.app.viewMode = 'single';
  const anchor = f.app._captureZoomAnchor('primary', 500, 250);
  assert.equal(anchor.targetId, f.container.id);
});
