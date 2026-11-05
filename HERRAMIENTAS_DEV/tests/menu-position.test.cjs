const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/menu_position.js'), 'utf8');

function position(menuRect, anchor, viewport) {
  const window = {};
  vm.runInNewContext(source, { window });
  const menu = { style: {}, getBoundingClientRect: () => menuRect };
  return { result: window.positionFloatingMenu(menu, anchor, viewport), style: menu.style };
}

test('floating menu flips above and stays inside the visible viewport', () => {
  const { result, style } = position(
    { width: 180, height: 140 },
    { left: 290, top: 260, right: 290, bottom: 260 },
    { left: 0, top: 0, right: 320, bottom: 300 }
  );

  assert.deepEqual({ ...result }, { left: 132, top: 112, maxWidth: 304, maxHeight: 284 });
  assert.equal(style.left, '132px');
  assert.equal(style.top, '112px');
  assert.equal(style.maxHeight, '284px');
});

test('floating menu constrains an oversized menu before clamping it', () => {
  const { result, style } = position(
    { width: 800, height: 700 },
    { x: 20, y: 20 },
    { left: 10, top: 10, right: 410, bottom: 310 }
  );

  assert.deepEqual({ ...result }, { left: 18, top: 18, maxWidth: 384, maxHeight: 284 });
  assert.equal(style.overflowY, 'auto');
});

test('floating submenu opens left when the right edge has no space', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  const submenu = { style: {}, getBoundingClientRect: () => ({ width: 160, height: 200 }) };
  const result = window.positionFloatingSubmenu(
    submenu,
    { left: 280, top: 260, right: 300, bottom: 280 },
    { left: 0, top: 0, right: 320, bottom: 300 }
  );

  assert.deepEqual({ ...result }, { left: 120, top: 92, maxWidth: 304, maxHeight: 284 });
  assert.equal(submenu.style.left, '120px');
  assert.equal(submenu.style.top, '92px');
});
