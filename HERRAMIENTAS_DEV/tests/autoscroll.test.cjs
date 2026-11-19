const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('auto-scroll follows the active viewer and pauses by button or at the boundary', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../BASE.html'), 'utf8');
  const script = html.match(/\/\/ ── AUTO SCROLL WIDGET ──\s*([\s\S]+?)<\/script>/)[1];
  const primary = { scrollLeft: 0, scrollWidth: 500, clientWidth: 100 };
  const secondary = { scrollLeft: 0, scrollWidth: 500, clientWidth: 100 };
  const widget = { style: { display: 'none' } };
  const play = { setAttribute(name, value) { this[name] = value; } };
  const nodes = { mainViewPrimary: primary, mainViewSecondary: secondary, 'autoscroll-widget': widget, 'as-btn-play': play };
  const app = { splitView: { activePanel: 'secondary' } };
  const flags = new Set(['h-layout']);
  let nextId = 0;
  const frames = new Map();
  vm.runInNewContext(script, {
    document: {
      getElementById: id => nodes[id] || null,
      body: { classList: { add: flag => flags.add(flag), remove: flag => flags.delete(flag), contains: flag => flags.has(flag) } }
    },
    window: { app, dispatchEvent() {} },
    Event: class Event {},
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  function tick(time) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  }
  app.toggleAutoScrollWidget();
  app.autoScrollPlayPause();
  tick(0);
  tick(30);
  assert.equal(primary.scrollLeft, 0);
  assert.ok(secondary.scrollLeft > 0);
  app.autoScrollPlayPause();
  assert.equal(play['aria-pressed'], 'false');
  assert.equal(frames.size, 0);

  secondary.scrollLeft = 400;
  app.autoScrollPlayPause();
  tick(60);
  assert.equal(play['aria-pressed'], 'false');
  assert.equal(frames.size, 0);
});
