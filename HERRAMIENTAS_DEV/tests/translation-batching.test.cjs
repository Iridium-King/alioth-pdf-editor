const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { loadAppModules } = require('./helpers/document-harness.cjs');

function fixture(texts = ['Hola mundo'], runtime = {}) {
  const harness = loadAppModules(['js/app.agentic.js'], { console: { info() {} }, ...runtime });
  harness.windowObject.PythonManager.extractTranslatableText = async () => texts.map((text, index) => ({
    pageIndex: 0, text, fontName: 'Helvetica', fontKey: 'helv', fontSize: 12,
    rect: { x: 20, y: 20 + index * 20, width: 150, height: 20 },
    origin: [20, 32 + index * 20], pageHeight: 4000
  }));
  harness.windowObject.PythonManager.preflightTranslatedOccurrences = async (_, { occurrences }) =>
    occurrences.map(item => ({ id: item.id, status: 'READY' }));
  harness.prepare = extra => harness.app.prepareTextTranslationReview({
    docId: harness.first.id, scope: { pages: [0] }, targetLanguage: 'English', ...extra
  });
  return harness;
}

async function cancelAtRetry(h) {
  const controller = new AbortController();
  let retryShown = false;
  const review = await h.prepare({ signal: controller.signal, onProgress: update => {
    if (update.label?.includes('Reintento automático')) { retryShown = true; controller.abort(); }
  } });
  assert.equal(retryShown, true);
  assert.equal(review.errorCode, 'TRANSLATION_CANCELLED');
}

const translated = units => JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: 'Translated ' + unit.text })));

test('long selection preview translates two fragments concurrently and reuses the completed result', async () => {
  let active = 0, peak = 0, requests = 0;
  const h = fixture(undefined, {
    AbortController, AbortSignal,
    fetch: async (_, options) => {
      requests++;
      active++;
      peak = Math.max(peak, active);
      const body = JSON.parse(options.body);
      const item = JSON.parse(body.prompt.slice(body.prompt.lastIndexOf('\n') + 1));
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return { ok: true, status: 200, json: async () => ({ ok: true, text: JSON.stringify({ unitId: 'selection', translatedText: item.text.toUpperCase() }) }) };
    }
  });
  const source = Array.from({ length: 220 }, (_, index) => `Sentence ${index}.`).join(' ');
  const result = await h.app.translateSelectedTextPreview(source, 'Español');
  assert.equal(result, source.toUpperCase());
  assert.ok(requests > 1);
  assert.equal(peak, 2);
  const count = requests;
  assert.equal(await h.app.translateSelectedTextPreview(source, 'Español'), result);
  assert.equal(requests, count);
});

test('translation deduplicates text, remaps all IDs, bypasses numbers/URLs and limits concurrency to two', async () => {
  const texts = [...Array.from({ length: 49 }, (_, index) => 'Texto ' + index), 'Texto 0', 'Texto 0', '12345', 'https://example.org'];
  const h = fixture(texts);
  let active = 0, peak = 0;
  const calls = [], sent = [];
  const review = await h.prepare({ request: async ({ units }) => {
    active++;
    peak = Math.max(peak, active);
    calls.push(units.length);
    sent.push(...units.map(unit => unit.text));
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return translated(units);
  } });
  assert.equal(review.status, 'review');
  assert.equal(review.readyCount, 51);
  assert.equal(review.retainedCount, 2);
  assert.deepEqual(calls, [24, 24, 1]);
  assert.equal(peak, 2);
  assert.equal(new Set(sent).size, 49);
  assert.equal(sent.filter(text => text === 'Texto 0').length, 1);
  assert.equal(sent.includes('12345'), false);
  assert.equal(sent.includes('https://example.org'), false);
  for (const item of review.items.filter(item => item.originalText === 'Texto 0')) {
    assert.equal(item.translatedText, 'Translated Texto 0');
  }
  assert.equal(review.items.some(item => ['12345', 'https://example.org'].includes(item.originalText)), false);
});

test('unchanged punctuation and dates are retained while a tiny connector uses a compact translation', async () => {
  const h = fixture([',', '2004.', 'y']);
  let sent;
  const review = await h.prepare({ targetLanguage: 'Inglés', request: async ({ units }) => {
    sent = units.map(unit => unit.text);
    return JSON.stringify(units.map(unit => ({ unitId: unit.unitId, translatedText: 'and' })));
  } });
  assert.deepEqual(Array.from(sent), ['y']);
  assert.equal(review.retainedCount, 2);
  assert.equal(review.exceptionCount, 0);
  assert.equal(review.readyCount, 1);
  assert.equal(review.items[0].originalText, 'y');
  assert.equal(review.items[0].translatedText, '&');
});

test('character limit splits long batches even before the item limit', async () => {
  const h = fixture(['A'.repeat(4000), 'B'.repeat(4000), 'C'.repeat(4000)]);
  const sizes = [];
  const review = await h.prepare({ request: async ({ units }) => {
    sizes.push(units.reduce((sum, unit) => sum + unit.text.length, 0));
    return translated(units);
  } });
  assert.equal(review.status, 'review');
  assert.deepEqual(sizes, [4000, 4000, 4000]);
});

test('translation requests activate backend budgets and browser timeout', async () => {
  let body, signal, timeout;
  const h = fixture(undefined, {
    AbortSignal: { timeout(ms) { timeout = ms; return { bounded: true }; } },
    fetch: async (url, options) => {
      assert.equal(url, '/api/ai/generate-json');
      body = JSON.parse(options.body);
      signal = options.signal;
      const units = JSON.parse(body.prompt.slice(body.prompt.lastIndexOf('\n') + 1));
      return { ok: true, status: 200, json: async () => ({ ok: true, text: translated(units), provider: 'groq', model: 'test-model', elapsedMs: 120, attempts: 1 }) };
    }
  });
  assert.equal((await h.prepare()).readyCount, 1);
  assert.equal(body.task, 'translation');
  assert.equal(body.temperature, 0);
  assert.equal(timeout, 50000);
  assert.deepEqual(signal, { bounded: true });
});

test('missing AbortSignal support does not prevent the translation request', async () => {
  let called = false;
  const h = fixture(undefined, { fetch: async (_, options) => {
    called = true;
    assert.equal(options.signal, undefined);
    const prompt = JSON.parse(options.body).prompt;
    const units = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    return { ok: true, status: 200, json: async () => ({ ok: true, text: translated(units) }) };
  } });
  assert.equal((await h.prepare()).readyCount, 1);
  assert.equal(called, true);
});

test('structured backend errors distinguish missing/rejected keys, quota, timeout and other failures', async () => {
  for (const code of ['PROVIDER_KEY_REQUIRED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_PAYMENT_REQUIRED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_REQUEST_FAILED']) {
    const h = fixture(undefined, { fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: code, elapsedMs: 45000, attempts: 3 }) }) });
    if (['PROVIDER_KEY_REQUIRED', 'PROVIDER_AUTH_FAILED'].includes(code)) assert.equal((await h.prepare()).errorCode, code);
    else await cancelAtRetry(h);
  }
});

test('generic 503 no longer claims configured credentials are missing', async () => {
  for (const [status, expected] of [[503, 'PROVIDER_REQUEST_FAILED'], [401, 'PROVIDER_AUTH_FAILED'], [402, 'PROVIDER_PAYMENT_REQUIRED'], [403, 'PROVIDER_AUTH_FAILED'], [429, 'PROVIDER_RATE_LIMITED'], [408, 'PROVIDER_TIMEOUT'], [504, 'PROVIDER_TIMEOUT'], [502, 'PROVIDER_REQUEST_FAILED']]) {
    const h = fixture(undefined, { fetch: async () => ({ ok: false, status, json: async () => ({ error: 'Unknown upstream failure' }) }) });
    if (expected === 'PROVIDER_AUTH_FAILED') assert.equal((await h.prepare()).errorCode, expected, String(status));
    else await cancelAtRetry(h);
  }
});

test('client timeout and network rejection are reported without suggesting a missing key', async () => {
  for (const [name, expected] of [['TimeoutError', 'PROVIDER_TIMEOUT'], ['AbortError', 'PROVIDER_TIMEOUT'], ['TypeError', 'PROVIDER_REQUEST_FAILED']]) {
    const h = fixture(undefined, { fetch: async () => { const error = new Error('Network error'); error.name = name; throw error; } });
    await cancelAtRetry(h);
  }
});

test('timeout while receiving the response body remains a timeout', async () => {
  const h = fixture(undefined, { fetch: async () => ({ ok: true, status: 200, json: async () => {
    const error = new Error('Timed out while reading');
    error.name = 'TimeoutError';
    throw error;
  } }) });
  await cancelAtRetry(h);
});

test('omitted batch entries are retried in small groups and unresolved entries stay unselected', async () => {
  const h = fixture(Array.from({ length: 25 }, (_, index) => 'Texto ' + index));
  const calls = [];
  const review = await h.prepare({ request: async ({ units }) => {
    calls.push(units.length);
    return translated(units.slice(0, 1));
  } });
  assert.equal(review.status, 'review');
  assert.ok(calls.some(size => size > 1 && size <= 6));
  assert.ok(review.readyCount > 2);
  assert.equal(review.items.filter(item => item.selected).length, review.readyCount);
  assert.equal(review.items.filter(item => item.translatedText === '').length, review.exceptionCount);
});

test('a paragraph omitted from a provider batch is translated on retry', async () => {
  const h = fixture(['Título', 'Párrafo extenso sobre salud ocupacional y prevención de accidentes.']);
  let calls = 0;
  const review = await h.prepare({ request: async ({ units }) => {
    calls++;
    return translated(calls === 1 ? units.slice(0, 1) : units);
  } });
  assert.equal(calls, 2);
  assert.equal(review.readyCount, 2);
  assert.equal(review.exceptionCount, 0);
});

test('translation accepts fenced object responses returned by providers', async () => {
  const h = fixture(['Hola', 'Mundo']);
  const review = await h.prepare({ request: async ({ units }) =>
    '```json\n' + JSON.stringify({ translations: units.map(unit => ({ unitId: unit.unitId, translatedText: 'EN ' + unit.text })) }) + '\n```'
  });
  assert.equal(review.status, 'review');
  assert.equal(review.readyCount, 2);
  assert.equal(review.items.map(item => item.translatedText).join('|'), 'EN Hola|EN Mundo');
});

test('failed batches stop queued requests and never create an applicable partial review', async () => {
  const h = fixture(Array.from({ length: 73 }, (_, index) => 'Texto ' + index));
  let calls = 0;
  const review = await h.prepare({ request: async ({ units }) => {
    calls++;
    if (calls === 1) throw new Error('PROVIDER_AUTH_FAILED');
    await new Promise(resolve => setImmediate(resolve));
    return translated(units);
  } });
  assert.equal(calls, 2);
  assert.equal(review.status, 'failed');
  assert.equal(review.errorCode, 'PROVIDER_AUTH_FAILED');
  assert.equal(h.app._translationReviews.size, 0);
});

test('transient failures keep retrying a pending batch beyond three attempts', async () => {
  const h = fixture(['Texto para traducir'], {
    setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {}
  });
  let calls = 0, waits = 0;
  const review = await h.prepare({
    onProgress: update => { if (update.label?.includes('Reintento automático')) waits++; },
    request: async ({ units }) => {
      calls++;
      if (calls < 5) {
        const error = new Error(calls % 2 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_TIMEOUT');
        error.retryAfterSeconds = 4;
        throw error;
      }
      return translated(units);
    }
  });
  assert.equal(review.status, 'review');
  assert.equal(review.readyCount, 1);
  assert.equal(calls, 5);
  assert.equal(waits, 4);
});

test('a repeated translation restores complete encrypted checkpoints and sends only pending batches', async () => {
  const texts = Array.from({ length: 73 }, (_, index) => 'Texto ' + index);
  const saved = new Map();
  let failOnce = true, firstRun = true, providerCalls = 0;
  const run = async (sourceId = 'source-a', sourceBytes) => {
    const h = fixture(texts);
    if (sourceId !== 'source-a') {
      h.first.sources[sourceId] = h.first.sources['source-a'];
      delete h.first.sources['source-a'];
      h.first.pages.forEach(page => { page.sourceId = sourceId; });
    }
    if (sourceBytes) h.first.sources[sourceId].buffer = new Uint8Array(sourceBytes).buffer;
    h.windowObject.AliothSecureKeys = { gemini: firstRun ? 'original-key' : 'rotated-key' };
    h.windowObject.location = { protocol: 'http:' };
    h.windowObject.crypto = webcrypto;
    h.context.TextEncoder = TextEncoder;
    h.context.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === '/api/translation/metrics') return { ok: true, json: async () => ({ ok: true }) };
      if (url === '/api/translation/checkpoint') {
        const id = `${body.key}:${body.batchIndex}`;
        if (body.operation === 'store') saved.set(id, body.translations);
        return { ok: true, json: async () => ({ ok: true, translations: body.operation === 'load' ? saved.get(id) || {} : {} }) };
      }
      assert.equal(url, '/api/ai/generate-json');
      providerCalls++;
      const units = JSON.parse(body.prompt.slice(body.prompt.lastIndexOf('\n') + 1));
      if (failOnce && units.some(unit => unit.text === 'Texto 48')) {
        failOnce = false;
        return { ok: false, status: 503, json: async () => ({ ok: false, error: 'PROVIDER_REQUEST_FAILED' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, text: translated(units) }) };
    };
    const controller = new AbortController();
    return h.prepare({ signal: controller.signal, onProgress: update => {
      if (firstRun && update.label?.includes('Reintento automático')) controller.abort();
    } });
  };
  assert.equal((await run()).status, 'failed');
  firstRun = false;
  assert.ok(saved.size >= 2);
  const previousCalls = providerCalls;
  const review = await run('reopened-source');
  assert.equal(review.status, 'review');
  assert.equal(review.readyCount, 73);
  assert.ok(providerCalls - previousCalls < 4);
  const callsAfterRestore = providerCalls;
  const changedPdf = await run('another-source', [9, 8, 7, 6]);
  assert.equal(changedPdf.status, 'review');
  assert.equal(providerCalls - callsAfterRestore, 4);
});

test('cancelling a rate-limit wait stops the review without another provider request', async () => {
  const h = fixture(['Texto para traducir']);
  const controller = new AbortController();
  let calls = 0;
  const review = await h.prepare({
    signal: controller.signal,
    onProgress: update => { if (update.label?.includes('Reintento automático')) controller.abort(); },
    request: async () => {
      calls++;
      const error = new Error('PROVIDER_RATE_LIMITED');
      error.retryAfterSeconds = 300;
      throw error;
    }
  });
  assert.equal(review.errorCode, 'TRANSLATION_CANCELLED');
  assert.equal(calls, 1);
  assert.equal(h.app._translationReviews.size, 0);
});

test('cancelling an active provider request stops the review immediately', async () => {
  const controller = new AbortController();
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const h = fixture(['Texto para traducir'], { AbortSignal, fetch: (_, options) => {
    requestStarted(options.signal);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('Cancelled');
      error.name = 'AbortError';
      reject(error);
    }, { once: true }));
  } });
  const pending = h.prepare({ signal: controller.signal });
  const requestSignal = await started;
  assert.equal(requestSignal.aborted, false);
  controller.abort();
  assert.equal((await pending).errorCode, 'TRANSLATION_CANCELLED');
  assert.equal(h.app._translationReviews.size, 0);
});

test('manual retry wakes the pending batch once without waiting for its timer', async () => {
  const h = fixture(['Texto pendiente']);
  let calls = 0, manualRetries = 0;
  const review = await h.prepare({
    onProgress: update => {
      if (update.retryNow) {
        manualRetries++;
        update.retryNow();
        update.retryNow();
      }
    },
    request: async ({ units }) => {
      if (++calls === 1) {
        const error = new Error('PROVIDER_RATE_LIMITED');
        error.retryAfterSeconds = 88;
        throw error;
      }
      return translated(units);
    }
  });
  assert.equal(review.status, 'review');
  assert.equal(calls, 2);
  assert.equal(manualRetries, 1);
  assert.equal(h.timers.size, 0);
});
