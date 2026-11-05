const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function bridge() {
  const h = loadAppModules(['js/app.core.js'], { fetch: () => { throw Error('Unexpected path scan'); } });
  const handlers = {}, messages = [];
  h.windowObject.top = h.windowObject;
  h.windowObject.addEventListener = (type, handler) => { handlers[type] = handler; };
  h.context.location = { origin: 'http://alioth.localhost' };
  h.context.chrome = { webview: {
    addEventListener: (type, handler) => { handlers['native-' + type] = handler; },
    postMessageWithAdditionalObjects: (message, files) => messages.push({ message, files })
  } };
  const source = fs.readFileSync(path.resolve(__dirname, '../../native_host/AliothPDFHost.cs'), 'utf8');
  const script = source.match(/private const string NativeScript = @"([\s\S]*?)";\s*\}/)[1].replace(/""/g, '"');
  vm.runInNewContext(script, h.context);
  return { ...h, handlers, messages };
}

test('native drop preserves distinct paths for identical filenames without hashing or Explorer scans', async () => {
  const h = bridge();
  const files = [{ name: 'base.pdf' }, { name: 'base.pdf' }];
  h.handlers.drop({ dataTransfer: { files } });
  const paths = files.map(file => h.app.resolveFileOriginPath(file));
  const request = h.messages[0];
  assert.equal(request.files[0], files[0]);
  await h.handlers['native-message']({ data: { channel: 'alioth-file-paths', id: request.message.id,
    paths: ['C:\\uno ñ\\base.pdf', 'D:\\dos\\base.pdf'] } });
  assert.deepEqual(await Promise.all(paths), ['C:\\uno ñ\\base.pdf', 'D:\\dos\\base.pdf']);
  assert.equal(h.timers.size, 0);
});

test('a native file input obtains its path before the application opens it', async () => {
  const h = bridge(), file = { name: 'base.pdf' };
  h.handlers.change({ target: { type: 'file', files: [file] } });
  await h.handlers['native-message']({ data: { channel: 'alioth-file-paths', id: h.messages[0].message.id,
    paths: ['C:\\original\\base.pdf'] } });
  assert.equal(await h.app.resolveFileOriginPath(file), 'C:\\original\\base.pdf');
});

test('missing native response settles safely instead of preventing opening indefinitely', async () => {
  const h = bridge(), file = { name: 'base.pdf' };
  h.handlers.drop({ dataTransfer: { files: [file] } });
  for (const timer of [...h.timers.values()]) timer();
  assert.equal(await h.app.resolveFileOriginPath(file), null);
});
