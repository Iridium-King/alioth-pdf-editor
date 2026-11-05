const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Python proxy compiles', () => {
  const python = process.env.ALIOTH_PYTHON || ['.build-python', '_python']
    .map(folder => path.join(root, folder, 'python.exe')).find(file => fs.existsSync(file)) || 'python';
  execFileSync(python, ['-m', 'py_compile', path.join(root, '_proxy.py')]);
});

test('Gemini uses the supported stable model', () => {
  const sources = ['js/ai_functions.js', 'js/app.ai.js', 'js/app.ui.js', '_proxy.py'].map(read).join('\n');
  assert.match(sources, /gemini-3\.6-flash/);
  assert.doesNotMatch(sources.replace(/js\/version\.js/g, ''), /gemini-2\.(0|5)-flash/);
});

test('API key persistence uses Windows DPAPI and never sends a key in status', () => {
  const proxy = read('_proxy.py');
  assert.match(proxy, /CryptProtectData/);
  assert.match(proxy, /CryptUnprotectData/);
  assert.match(proxy, /api\/secure-credentials\/status/);
  assert.doesNotMatch(proxy, /'key':\s+AZURE_KEYS/);
});

test('Data Extraction modal opens even if its initialization fails', () => {
  const ui = read('js/app.ui.js');
  const start = ui.indexOf('showDataExtractionModal: function ()');
  const chunk = ui.slice(start, start + 1800);
  assert.match(chunk, /m\.style\.display = 'flex'/);
  assert.match(chunk, /try \{/);
  assert.match(ui, /getElementById\('dex-results-body'\)/);
});

test('Word export includes faithful page rendering and editable text', () => {
  const office = read('js/office_conversion.js');
  assert.match(office, /_renderPDFPagesForOffice/);
  assert.match(office, /_generateHybridDOCX/);
  assert.match(office, /Contenido editable extraído/);
});
