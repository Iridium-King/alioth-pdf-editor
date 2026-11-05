const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture(runtime = {}) {
  const h = loadAppModules([], { AbortController, AbortSignal, TextEncoder,
    console: { info() {} }, ...runtime });
  vm.runInNewContext('(function(){' + fs.readFileSync('js/app.agentic.js', 'utf8') +
    '\nwindow.recoveryTest=requestTranslationPayload;})();', h.context);
  h.run = (units, request, extra = {}) => h.windowObject.recoveryTest(units, 'Español', request,
    extra.onProgress, {}, extra.key || '', extra.signal,
    { requireComplete: true, concurrency: 1, maxBatchItems: 60, maxBatchCharacters: 8000, ...extra.options });
  return h;
}
const units = count => Array.from({ length: count }, (_, i) => ({ id: 'id-' + i, text: 'Paragraph ' + i }));
const translated = items => JSON.stringify(items.map(x => ({ unitId: x.unitId, translatedText: 'ES ' + x.text })));

test('repeated omissions remain pending and valid translations are never resent', async () => {
  const h = fixture(), sent = [];
  const result = JSON.parse(await h.run(units(4), async ({ units: batch }) => {
    sent.push(Array.from(batch, x => x.unitId));
    return translated(batch.slice(0, 1));
  }));
  assert.equal(result.length, 4);
  assert.deepEqual(sent, [['u0', 'u1', 'u2', 'u3'], ['u1', 'u2', 'u3'], ['u2', 'u3'], ['u3']]);
  assert.equal(result.find(x => x.unitId === 'id-0').translatedText, 'ES Paragraph 0');
});

test('a singleton omitted twice is recovered on its final bounded retry', async () => {
  const h = fixture();
  let calls = 0;
  const result = JSON.parse(await h.run(units(2), async ({ units: batch }) => {
    calls++;
    return translated(calls === 1 ? batch.slice(0, 1) : calls < 4 ? [] : batch);
  }));
  assert.equal(result.length, 2);
  assert.equal(calls, 4);
});

test('unrecoverable omissions stop after three retries per ID without publishing incomplete results', async () => {
  const h = fixture(), counts = new Map(), sizes = [];
  await assert.rejects(h.run(units(6), async ({ units: batch }) => {
    sizes.push(batch.length);
    for (const x of batch) counts.set(x.unitId, (counts.get(x.unitId) || 0) + 1);
    return '[]';
  }), /TRANSLATION_INCOMPLETE/);
  assert.ok([...counts.values()].every(n => n === 4));
  assert.ok(sizes.includes(6) && sizes.includes(3) && sizes.includes(1));
});

function checkpoints(h, saved, response, onStore) {
  h.windowObject.location = { protocol: 'http:' };
  h.windowObject.crypto = webcrypto;
  h.context.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === '/api/translation/metrics') return { ok: true };
    if (url === '/api/translation/checkpoint') {
      const key = body.key + ':' + body.batchIndex;
      if (body.operation === 'store') {
        assert.equal(body.allowPartial, true);
        saved.set(key, { ...saved.get(key), ...body.translations });
        onStore?.();
      }
      return { ok: true, json: async () => ({ ok: true, translations: saved.get(key) || {} }) };
    }
    assert.equal(url, '/api/ai/generate-json');
    const batch = JSON.parse(body.prompt.slice(body.prompt.lastIndexOf('\n') + 1));
    return { ok: true, status: 200, json: async () => ({ ok: true, text: await response(batch) }) };
  };
}

test('cancelled partial batches resume only missing IDs and then become complete checkpoints', async () => {
  const saved = new Map(), key = 'a'.repeat(64), controller = new AbortController(), first = fixture();
  checkpoints(first, saved, async batch => translated(batch.slice(0, 1)), () => controller.abort());
  await assert.rejects(first.run(units(4), null, { key, signal: controller.signal }), /TRANSLATION_CANCELLED/);
  assert.equal(Object.keys(saved.get(key + ':0')).length, 1);
  const second = fixture(), resumed = [];
  checkpoints(second, saved, async batch => { resumed.push(...batch.map(x => x.unitId)); return translated(batch); });
  assert.equal(JSON.parse(await second.run(units(4), null, { key })).length, 4);
  assert.deepEqual(resumed, ['u1', 'u2', 'u3']);
  const third = fixture();
  checkpoints(third, saved, async () => { throw new Error('Completed batch must be reused'); });
  assert.equal(JSON.parse(await third.run(units(4), null, { key })).length, 4);
});

test('a failed recovery preserves the partial batch for a later run', async () => {
  const saved = new Map(), key = 'b'.repeat(64), h = fixture();
  let calls = 0;
  checkpoints(h, saved, async batch => translated(++calls === 1 ? batch.slice(0, 1) : []));
  await assert.rejects(h.run(units(2), null, { key }), /TRANSLATION_INCOMPLETE/);
  assert.deepEqual(Object.keys(saved.get(key + ':0')), ['u0']);
});

test('429 workers share Retry-After and serialize subsequent requests', async () => {
  let now = 1000, active = 0, recoveredActive = 0, peakRecovered = 0, calls = 0;
  const delays = [];
  class Clock extends Date { static now() { return now; } }
  const h = fixture({ Date: Clock,
    setTimeout(callback, delay) { delays.push(delay); return setImmediate(() => { now += delay; callback(); }); },
    clearTimeout: clearImmediate });
  const result = JSON.parse(await h.run(units(5), async ({ units: batch }) => {
    const number = ++calls;
    active++;
    if (number > 2) peakRecovered = Math.max(peakRecovered, ++recoveredActive);
    await new Promise(setImmediate);
    active--;
    if (number > 2) recoveredActive--;
    if (number <= 2) {
      const error = new Error('PROVIDER_RATE_LIMITED');
      error.retryAfterSeconds = 120;
      throw error;
    }
    assert.ok(now >= 121000);
    return translated(batch);
  }, { options: { concurrency: 2, maxBatchItems: 1 } }));
  assert.equal(result.length, 5);
  assert.equal(calls, 7);
  assert.equal(active, 0);
  assert.equal(peakRecovered, 1);
  assert.deepEqual(delays, [120000]);
});

test('manual retry wakes the shared quota wait without a parallel request burst', async () => {
  const h = fixture();
  let calls = 0, waiting = 0;
  const result = JSON.parse(await h.run(units(2), async ({ units: batch }) => {
    if (++calls === 1) {
      const error = new Error('PROVIDER_RATE_LIMITED'); error.retryAfterSeconds = 120; throw error;
    }
    return translated(batch);
  }, { onProgress: update => {
    if (update.waitingSeconds) { waiting++; update.retryNow(); update.retryNow(); }
  } }));
  assert.equal(result.length, 2);
  assert.equal(waiting, 1);
  assert.equal(calls, 2);
  assert.equal(h.timers.size, 0);
});

test('cancelling a shared quota wait stops all workers and clears timers', async () => {
  const h = fixture(), controller = new AbortController();
  let calls = 0;
  await assert.rejects(h.run(units(5), async () => {
    calls++;
    const error = new Error('PROVIDER_RATE_LIMITED'); error.retryAfterSeconds = 120; throw error;
  }, { signal: controller.signal, options: { concurrency: 2, maxBatchItems: 1 },
    onProgress: update => { if (update.waitingSeconds) controller.abort(); } }), /TRANSLATION_CANCELLED/);
  assert.equal(calls, 2);
  assert.equal(h.timers.size, 0);
});

test('a successful provider fallback reporting 429 also reduces subsequent concurrency', async () => {
  const h = fixture();
  let calls = 0, active = 0, recovering = 0, peakAfterQuota = 0;
  h.context.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/generate-json');
    const number = ++calls;
    active++;
    if (number > 2) peakAfterQuota = Math.max(peakAfterQuota, ++recovering);
    await new Promise(setImmediate);
    active--;
    if (number > 2) recovering--;
    const prompt = JSON.parse(options.body).prompt;
    const batch = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    return { ok: true, status: 200, json: async () => ({ ok: true, text: translated(batch), rateLimited: number <= 2 }) };
  };
  assert.equal(JSON.parse(await h.run(units(5), null, { options: { concurrency: 2, maxBatchItems: 1 } })).length, 5);
  assert.equal(calls, 5);
  assert.equal(active, 0);
  assert.equal(peakAfterQuota, 1);
});
