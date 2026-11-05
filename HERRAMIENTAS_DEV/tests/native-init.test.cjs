const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../js/init.js'), 'utf8');
const interceptor = source.slice(0, source.indexOf('})();') + 5);

test('native and legacy origins retain local provider routing', async () => {
  for (const hostname of ['alioth.localhost', '127.0.0.1', 'localhost']) {
    const calls = [], origin = 'http://' + hostname;
    const window = { location: { hostname, origin }, localStorage: {}, aliothLegal: { isAiEnabled: () => true },
      fetch: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } };
    vm.runInNewContext(interceptor, { window, console: { log() {} } });
    await window.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST' });
    await window.fetch('https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(calls[0][0], origin + '/groq/openai/v1/chat/completions');
    assert.equal(calls[1][0], origin + '/v1beta/models');
    window.aliothLegal.isAiEnabled = () => false;
    await assert.rejects(window.fetch('https://api.groq.com/openai/v1/chat/completions'), /AI notice/);
    assert.equal(calls.length, 2);
  }
});
