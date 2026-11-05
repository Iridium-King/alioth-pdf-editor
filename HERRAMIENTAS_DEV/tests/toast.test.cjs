const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function loadToast() {
  const classes = new Set(['toast-notification']);
  const createNode = tagName => ({
    tagName, className: '', textContent: '', children: [], attributes: {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  });
  const toast = {
    children: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name))
    },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; }
  };
  const document = {
    getElementById: id => id === 'toast' ? toast : null,
    createElement: createNode,
    createElementNS: (_namespace, tagName) => createNode(tagName)
  };
  const window = { app: {}, addEventListener() {} };
  let timeoutMs;
  const source = fs.readFileSync(path.join(root, 'js/app.core.js'), 'utf8');
  vm.runInNewContext(`(function () {\n${source}\n})();`, {
    window, document, location: { href: 'http://127.0.0.1/BASE.html' }, console,
    performance: { now: () => 0 }, Map, Set, Promise, Object,
    Array, ArrayBuffer, Uint8Array, Math, Date,
    setTimeout: (_callback, ms) => { timeoutMs = ms; return 1; },
    clearTimeout() {}
  }, { filename: 'js/app.core.js' });
  return { app: window.app, toast, classes, timeout: () => timeoutMs };
}

test('saved notification uses an outlined disk-check icon and green success tone', () => {
  const { app, toast, classes, timeout } = loadToast();

  app.showToast('PDF guardado correctamente.', 4200);

  assert.equal(toast.children.length, 2);
  assert.match(toast.children[0].className, /toast-icon--success/);
  assert.equal(toast.children[0].children[0].tagName, 'svg');
  assert.equal(toast.children[0].children[0].children.some(child => child.tagName === 'polyline'), true);
  assert.equal(toast.children[1].textContent, 'PDF guardado correctamente.');
  assert.equal(classes.has('toast--success'), true);
  assert.equal(classes.has('show'), true);
  assert.equal(timeout(), 4200);
});

test('toast maps alert, error and informational notices to semantic tones', () => {
  const { app, classes } = loadToast();

  app.showToast('⚠️ Revisa el archivo');
  assert.equal(classes.has('toast--warning'), true);

  app.showToast('❌ No se pudo guardar');
  assert.equal(classes.has('toast--error'), true);
  assert.equal(classes.has('toast--warning'), false);

  app.showToast('Proceso en curso');
  assert.equal(classes.has('toast--info'), true);
  assert.equal(classes.has('toast--error'), false);
});

test('toast keeps message content as text and uses a 25 percent transparent background', () => {
  const { app, toast } = loadToast();
  app.showToast('<img src=x onerror=alert(1)>');
  assert.equal(toast.children[1].textContent, '<img src=x onerror=alert(1)>');

  const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
  assert.match(css, /\.toast-notification\s*\{[\s\S]*?background:\s*rgba\([^;]+,\s*0\.75\)/);
  assert.match(css, /\.toast-icon--success\s*\{[^}]*color:\s*#22c55e/i);
  assert.match(css, /\.toast-icon--warning\s*\{[^}]*color:\s*#facc15/i);
  assert.match(css, /\.toast-icon--error\s*\{[^}]*color:\s*#ef4444/i);
  assert.match(css, /\.toast-icon--info\s*\{[^}]*color:\s*#3b82f6/i);
});
