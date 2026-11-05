const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/ai_float_btn.js'), 'utf8');

function harness({ savedY, savedVersion = 2, togglesVisible = true } = {}) {
  let now = 1000, nextFrame = 1, opened = 0;
  const frames = new Map(), storage = new Map(), elements = new Map(), observers = [];
  const width = 1000, height = 900;
  const eventTarget = target => Object.assign(target, {
    events: new Map(),
    addEventListener(type, callback) {
      const callbacks = this.events.get(type) || [];
      callbacks.push(callback);
      this.events.set(type, callbacks);
    },
    emit(type, event = {}) {
      const data = { type, target: this, preventDefault() {}, ...event };
      for (const callback of this.events.get(type) || []) callback(data);
    }
  });
  function element(id, left, top, boxWidth, boxHeight, display = 'block') {
    const node = eventTarget({ id, style: {}, css: { display, visibility: 'visible' }, contains: () => false });
    node.getBoundingClientRect = () => {
      const x = node.style.right !== undefined ? width - parseFloat(node.style.right) - boxWidth : left;
      const y = node.style.top !== undefined ? parseFloat(node.style.top) : top;
      return { x, y, left: x, top: y, width: boxWidth, height: boxHeight, right: x + boxWidth, bottom: y + boxHeight };
    };
    elements.set(id, node);
    return node;
  }
  const btn = element('ai-floating-btn', 960, 400, 40, 50);
  const topArrow = element('ai-nav-btn-top', 967.5, 0, 25, 25);
  const bottomArrow = element('ai-nav-btn-bottom', 967.5, 0, 25, 25);
  element('ribbonContainer', 0, 60, 1000, 100);
  element('view-toggle-widget', 800, 160, 200, 25, togglesVisible ? 'block' : 'none');
  element('reading-mode-float-widget', 930, 700, 60, 26);
  element('zoom-float-widget', 930, 740, 60, 150);
  element('autoscroll-widget', 800, 500, 100, 120, 'none');
  const document = eventTarget({ body: element('body', 0, 0, width, height), getElementById: id => elements.get(id) });
  const window = eventTarget({ innerWidth: width, innerHeight: height });
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
  }
  if (savedY !== undefined) storage.set('ai_btn_pos', JSON.stringify({ x: 0, y: savedY, version: savedVersion }));
  vm.runInNewContext(source, { document, window, app: { toggleAIPanel: () => opened++ },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    getComputedStyle: node => ({ ...node.css, ...node.style }), Date: { now: () => now },
    requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
    ResizeObserver: Observer, MutationObserver: Observer });
  function flush() {
    for (let count = 0; frames.size; count++) {
      if (count > 20) throw new Error('Unbounded animation loop');
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback());
    }
  }
  flush();
  return { btn, topArrow, bottomArrow, document, window, elements, storage, observers, flush,
    advance: ms => now += ms, opened: () => opened };
}

test('obsolete saved positions do not displace the fixed dock', () => {
  for (const savedY of [-500, 0, 2000]) {
    const h = harness({ savedY });
    assert.equal(h.btn.getBoundingClientRect().top, 425);
    assert.equal(JSON.parse(h.storage.get('ai_btn_pos')).y, savedY);
  }
});

test('reading mode without toggles uses the ribbon as the upper boundary', () => {
  const h = harness({ togglesVisible: false });
  h.window.innerHeight = 350;
  h.window.emit('resize'); h.flush();
  assert.equal(h.btn.getBoundingClientRect().top, 193);
  assert.equal(h.topArrow.getBoundingClientRect().top, h.elements.get('ribbonContainer').getBoundingClientRect().bottom + 4);
});

test('the dock respects reading and zoom widgets when the viewport grows', () => {
  const h = harness();
  h.window.innerHeight = 1600;
  h.window.emit('resize'); h.flush();
  assert.equal(h.btn.getBoundingClientRect().top, 617);
  assert.equal(h.bottomArrow.getBoundingClientRect().bottom, h.elements.get('reading-mode-float-widget').getBoundingClientRect().top - 4);
  assert.ok(h.bottomArrow.getBoundingClientRect().bottom < h.elements.get('zoom-float-widget').getBoundingClientRect().top);
});

test('dragging neither moves the dock nor writes preferences; clicking opens AI', () => {
  const h = harness({ savedY: 400 });
  h.btn.emit('mousedown', { clientY: 420 });
  h.document.emit('mousemove', { clientY: 490 });
  h.advance(100);
  h.document.emit('mouseup');
  assert.equal(h.btn.getBoundingClientRect().top, 425);
  assert.deepEqual(JSON.parse(h.storage.get('ai_btn_pos')), { x: 0, y: 400, version: 2 });
  assert.equal(h.opened(), 0);
  h.btn.emit('click');
  assert.equal(h.opened(), 1);
});

test('the group starts vertically centered and ignores the former header-relative position', () => {
  const h = harness({ savedY: 230, savedVersion: 1 });
  const rect = h.btn.getBoundingClientRect();
  assert.equal(rect.top + rect.height / 2, h.window.innerHeight / 2);
  h.window.innerHeight = 1000;
  h.window.emit('resize');
  h.flush();
  const resized = h.btn.getBoundingClientRect();
  assert.equal(resized.top + resized.height / 2, h.window.innerHeight / 2);
});

test('both arrows keep four pixels of vertical spacing and share the AI button center', () => {
  const h = harness({ savedY: 400 });
  h.btn.emit('mousedown', { clientY: 425 });
  h.document.emit('mousemove', { clientY: 600 });
  h.document.emit('mouseup');
  const ai = h.btn.getBoundingClientRect(), top = h.topArrow.getBoundingClientRect(), bottom = h.bottomArrow.getBoundingClientRect();
  assert.equal(ai.top - top.bottom, 4);
  assert.equal(bottom.top - ai.bottom, 4);
  assert.equal(top.left + top.width / 2, ai.left + ai.width / 2);
  assert.equal(bottom.left + bottom.width / 2, ai.left + ai.width / 2);
  assert.ok(h.observers.some(observer => observer.targets.some(({ target }) => target.id === 'reading-mode-float-widget')));
  assert.ok(h.observers.some(observer => observer.targets.some(({ target }) => target.id === 'zoom-float-widget')));
});
