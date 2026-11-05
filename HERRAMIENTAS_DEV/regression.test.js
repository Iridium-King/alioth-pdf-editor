const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Python proxy compiles', () => {
  execFileSync(path.join(root, '_python', 'python.exe'), ['-m', 'py_compile', path.join(root, '_proxy.py')]);
});

test('Python engine stays unloaded until an advanced tool requests it', async () => {
  let pythonInitializations = 0;
  const pythonManager = {
    init() {
      pythonInitializations += 1;
      return Promise.resolve();
    }
  };
  const windowObject = {
    app: {},
    PythonManager: pythonManager,
    addEventListener() {}
  };
  const context = {
    window: windowObject,
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      body: { classList: { add() {}, remove() {} } },
      activeElement: null
    },
    console,
    location: { href: 'http://127.0.0.1/' },
    performance: { now() { return 0; } },
    setTimeout,
    clearTimeout,
    Uint8Array,
    ArrayBuffer,
    JSON,
    Math,
    Set,
    Map,
    Date,
    URL,
    URLSearchParams,
    crypto: globalThis.crypto,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    Dexie: class {
      version() { return { stores() {} }; }
      async open() {}
    },
    PythonManager: pythonManager,
    CustomEvent: class {},
    Event: class {}
  };

  vm.runInNewContext(read('js/app.core.js'), context, { filename: 'app.core.js' });
  const app = windowObject.app;
  Object.assign(app, {
    migrateOldFavoritesAndRecents: async () => {},
    clearOldRecents: async () => {},
    createNewTab() {},
    loadSystemFonts() {},
    startAutoSave() {},
    renderHomeDocuments() {},
    t() { return 'Nuevo Doc'; }
  });

  await app.initDatabaseAndApp();
  assert.equal(pythonInitializations, 0);
});

test('Legal notices expose all supported locales and the AI data boundary', () => {
  const source = read('js/legal.js');
  const context = { window: {}, console, Object, JSON };
  vm.runInNewContext(source, context, { filename: 'legal.js' });
  const legal = context.window.aliothLegal;
  assert.ok(legal, 'the legal module must be available before the first-run notice');
  assert.deepEqual(Array.from(legal.locales), ['es', 'en', 'it', 'fr', 'de', 'ja', 'ko', 'zh', 'zh-TW']);
  for (const locale of legal.locales) {
    const copy = legal.getCopy(locale);
    assert.ok(copy.privacy.title && copy.privacy.body);
    assert.ok(copy.ai.title && copy.ai.body);
    assert.ok(copy.terms.title && copy.terms.body);
    const actions = legal.getActions(locale);
    assert.ok(actions.local && actions.ai && actions.details);
  }
  const allCopy = JSON.stringify(legal);
  assert.match(allCopy, /aliothgm@gmail\.com/);
  assert.match(allCopy, /API/);
  assert.match(allCopy, /IA|AI|KI|KI|ИИ/);
  assert.match(allCopy, /PyMuPDF/);
  assert.doesNotMatch(allCopy, /dpapi:|AIza|sk-[A-Za-z0-9]/);
});

test('Legal notice state distinguishes local-only and AI-enabled choices', () => {
  const context = { window: {}, console, Object, JSON };
  vm.runInNewContext(read('js/legal.js'), context, { filename: 'legal.js' });
  const legal = context.window.aliothLegal;
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
  assert.equal(legal.getNoticeState(storage), null);
  legal.setNoticeState(storage, 'local');
  assert.equal(legal.getNoticeState(storage), 'local');
  legal.setNoticeState(storage, 'ai');
  assert.equal(legal.getNoticeState(storage), 'ai');
});

test('Preferences modal exposes the translated Legal/About tab', () => {
  const html = read('BASE.html');
  const core = read('js/app.core.js');
  assert.match(html, /app\.switchPreferencesTab\('pref-legal'\)/);
  assert.match(html, /data-i18n="pref_tab_legal_short"/);
  assert.match(html, /id="pref-legal" class="pref-pane"/);
  assert.match(html, /id="pref-legal-tabs"/);
  assert.match(html, /id="pref-legal-body"/);
  assert.match(core, /switchPreferencesTab: function \(tabId\)/);
});

test('AI network calls remain blocked when the user chose local-only mode', async () => {
  const calls = [];
  const values = new Map([['alioth_legal_notice_v1', 'local']]);
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const windowObject = { location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1' }, addEventListener() {}, aliothLegal: null };
  windowObject.localStorage = storage;
  const context = {
    window: windowObject,
    localStorage: storage,
    document: { addEventListener() {} },
    console,
    fetch: async (...args) => { calls.push(args); return { ok: true, json: async () => ({}) }; }
  };
  windowObject.fetch = context.fetch;
  vm.runInNewContext(read('js/legal.js'), context, { filename: 'legal.js' });
  vm.runInNewContext(read('js/init.js'), context, { filename: 'init.js' });
  calls.length = 0;
  await assert.rejects(() => context.window.fetch('https://api.groq.com/openai/v1/chat/completions'), /AI notice/i);
  assert.equal(calls.length, 0);
  context.window.aliothLegal.setNoticeState(storage, 'ai');
  await context.window.fetch('https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0][0], 'http://127.0.0.1/groq/openai/v1/chat/completions');
});

test('Gemini uses the supported stable model', () => {
  const sources = ['js/ai_functions.js', 'js/app.ai.js', 'js/app.ui.js', '_proxy.py'].map(read).join('\n');
  assert.match(sources, /gemini-3\.6-flash/);
  assert.match(sources, /_gemini_generate_json/);
  assert.match(sources, /_GEMINI_MODEL_CACHE/);
  assert.doesNotMatch(sources, /gemini-2\.(0|5)-flash/);
});

test('Gemini auto-model policy prefers newest stable Flash before Pro', () => {
  const py = path.join(root, '_python', 'python.exe');
  const script = String.raw`
import json, runpy
m = runpy.run_path(r'${path.join(root, '_proxy.py').replace(/\\/g, '\\\\')}', run_name='regression_models')
class Response:
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return json.dumps(self.data).encode()
models = {'models': [
    {'name': 'models/gemini-3.7-flash', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-5-flash', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-5-pro', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-6-flash-preview', 'supportedGenerationMethods': ['generateContent']}
]}
original = m['urllib'].request.urlopen
m['urllib'].request.urlopen = lambda *args, **kwargs: Response(models)
assert m['_list_gemini_models']('regression-flash') == ['gemini-5-flash', 'gemini-3.7-flash']
m['urllib'].request.urlopen = lambda *args, **kwargs: Response({'models': [
    {'name': 'models/gemini-5-pro', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-6-flash-preview', 'supportedGenerationMethods': ['generateContent']}
]})
assert m['_list_gemini_models']('regression-pro') == ['gemini-5-pro']
m['urllib'].request.urlopen = original
`;
  execFileSync(py, ['-c', script], { timeout: 30000, stdio: 'pipe' });
});

test('API key persistence uses Windows DPAPI and never sends a key in status', () => {
  const proxy = read('_proxy.py');
  const core = read('js/app.core.js');
  assert.match(proxy, /CryptProtectData/);
  assert.match(proxy, /CryptUnprotectData/);
  assert.match(proxy, /api\/secure-credentials\/status/);
  assert.match(proxy, /'counts': counts/);
  assert.match(proxy, /api_key_\{index\}/);
  assert.match(core, /_renderSecureKeySlots/);
  assert.match(core, /toggleApiKeyCard/);
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

test('Existing visual comparison and PDF cleanup tools remain wired', () => {
  const html = read('BASE.html');
  const ui = read('js/app.ui.js');
  const ops = read('js/app.pdf_ops.js');
  assert.match(html, /id="splitContainer"/);
  assert.match(html, /app\.setSplitView\('horizontal'\)/);
  assert.match(ui, /setSplitView: function/);
  assert.match(html, /app\.repairAndOptimizePDF\(\)/);
  assert.match(html, /app\.flattenFormPDF\(\)/);
  assert.match(ops, /repairAndOptimizePDF: async function/);
  assert.match(ops, /flattenFormPDF: async function/);
  assert.match(read('js/app.pdf.js'), /doc\.currentIndex = newIdx/);
  assert.match(read('js/app.render.js'), /_renderContinuousActivePage\(panelId, activeIdxBeforeZoom, sessionToken\)/);
});

test('Native PDF form values survive page copying and save', async () => {
  const annotationContext = {
    window: { app: {} }, console, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, setTimeout, clearTimeout
  };
  vm.runInNewContext(read('js/app.annotations.js'), annotationContext, { filename: 'app.annotations.js' });
  const app = annotationContext.window.app;
  const pageData = {};
  app.storeAnnotationValue('primary', 'widget_text', 'CAMBIO', pageData, {
    fieldName: 'nombre', fieldType: 'Tx'
  });
  app.storeAnnotationValue('primary', 'widget_check', true, pageData, {
    fieldName: 'acepta', fieldType: 'Btn', checkBox: true, exportValue: 'Yes'
  });

  assert.ok(pageData.nativeFormValues, 'the edited values must be attached to their PDF page');
  assert.deepEqual(JSON.parse(JSON.stringify(pageData.nativeFormValues)), {
    nombre: { kind: 'text', value: 'CAMBIO' },
    acepta: { kind: 'checkbox', value: true }
  });

  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const result = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    const sourcePage = source.addPage();
    const sourceForm = source.getForm();
    const text = sourceForm.createTextField('nombre');
    text.setText('ORIGINAL');
    text.addToPage(sourcePage, { x: 30, y: 220, width: 150, height: 25 });
    const checkbox = sourceForm.createCheckBox('acepta');
    checkbox.addToPage(sourcePage, { x: 30, y: 180, width: 20, height: 20 });
    const sourceBytes = await source.save();
    const page = {
      sourceId: 'pdf', pageIndex: 0, objects: [], rotation: 0,
      flipH: false, flipV: false,
      nativeFormValues: {
        nombre: { kind: 'text', value: 'CAMBIO' },
        acepta: { kind: 'checkbox', value: true }
      }
    };
    const doc = {
      name: 'formulario.pdf', pages: [page], currentIndex: 0,
      sources: { pdf: { buffer: sourceBytes, originalBuffer: sourceBytes } }
    };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};

    const savedBytes = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(savedBytes);
    return {
      fieldNames: reopened.getForm().getFields().map(field => field.getName()),
      text: reopened.getForm().getTextField('nombre').getText(),
      checked: reopened.getForm().getCheckBox('acepta').isChecked(),
      bytes: Array.from(savedBytes)
    };
  })()`, context);

  assert.deepEqual(Array.from(result.fieldNames), ['nombre', 'acepta']);
  assert.equal(result.text, 'CAMBIO');
  assert.equal(result.checked, true);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alioth_form_regression_'));
  const inputPdf = path.join(tempDir, 'input.pdf');
  const compressedPdf = path.join(tempDir, 'compressed.pdf');
  try {
    fs.writeFileSync(inputPdf, Buffer.from(result.bytes));
    execFileSync(path.join(root, '_python', 'python.exe'), ['-c', String.raw`
import fitz
source = fitz.open(r'${inputPdf.replace(/\\/g, '\\\\')}')
source.save(r'${compressedPdf.replace(/\\/g, '\\\\')}', garbage=4, deflate=True, deflate_images=True, clean=True)
source.close()
reopened = fitz.open(r'${compressedPdf.replace(/\\/g, '\\\\')}')
values = {widget.field_name: widget.field_value for widget in reopened[0].widgets()}
reopened.close()
assert values['nombre'] == 'CAMBIO', values
assert values['acepta'] == 'Yes', values
`], { timeout: 30000, stdio: 'pipe' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Edit fields toggle never erases native widgets and restores the native layer when disabled', async () => {
  const editSwitch = { checked: true };
  const interactSwitch = { checked: false };
  const annotationLayer = { style: {} };
  const mainView = { querySelectorAll: () => [] };
  let destructiveCalls = 0;
  const originalBuffer = Uint8Array.from([1, 2, 3]).buffer;
  const page = { sourceId: 'pdf', pageIndex: 0, objects: [] };
  const doc = { pages: [page], currentIndex: 0, sources: { pdf: { buffer: originalBuffer } } };
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout, clearTimeout,
    document: {
      body: { classList: { toggle() {} } },
      getElementById(id) {
        if (id === 'switch-edit-fields') return editSwitch;
        if (id === 'switch-interact-fields') return interactSwitch;
        if (id === 'mainViewPrimary') return mainView;
        return null;
      }
    },
    PythonManager: {
      isLoaded: true,
      async convertAndEraseFormFields() {
        destructiveCalls += 1;
        return { buffer: Uint8Array.from([9, 9, 9]).buffer, widgets: [] };
      }
    }
  };
  vm.runInNewContext(read('js/app.annotations.js'), context, { filename: 'app.annotations.js' });
  const app = context.window.app;
  Object.assign(app, {
    getDoc: () => doc,
    splitView: { activePanel: 'primary', primary: { scale: 1 } },
    getPanelElements: () => ({ annotationLayer }),
    toggleLoader() {}, showToast() {}, renderOverlays() {}, setupInteractDraggables() {}, saveState() {},
    async loadPage() {},
    async convertFormFieldsToObjects() {
      page.nativeFieldOverlaysDetected = true;
      page.objects.push({
        id: 'native-name', type: 'form-field', fromFormField: true,
        nativeFieldName: 'nombre', fieldName: 'nombre', fieldType: 'text',
        textValue: 'ORIGINAL', value: 'ORIGINAL'
      });
    }
  });

  await app.toggleFormFieldEdit();
  assert.equal(destructiveCalls, 0);
  assert.strictEqual(doc.sources.pdf.buffer, originalBuffer);
  assert.equal(page.nativeFieldOverlaysDetected, true);
  assert.notEqual(page.fieldsConverted, true);
  assert.equal(app.isFieldEditMode, true);
  assert.equal(annotationLayer.style.display, 'none');

  page.fieldsConverted = true; // Simula una sesión creada por la implementación anterior.
  doc.sources.pdf.originalBuffer = originalBuffer;
  editSwitch.checked = false;
  await app.toggleFormFieldEdit();
  assert.equal(app.isFieldEditMode, false);
  assert.notEqual(page.fieldsConverted, true);
  assert.equal(annotationLayer.style.display, 'block');
  assert.equal(annotationLayer.style.visibility, 'visible');

  page.nativeFormValues.nombre = { kind: 'text', value: 'UI-EDITABLE' };
  editSwitch.checked = true;
  await app.toggleFormFieldEdit();
  assert.equal(page.objects[0].textValue, 'UI-EDITABLE');
  assert.equal(page.objects[0].value, 'UI-EDITABLE');
});

test('Native field mapping preserves identity, widget index, autosize and flags', async () => {
  const annotations = [
    {
      id: '42R', subtype: 'Widget', fieldType: 'Tx', fieldName: 'nombre',
      rect: [30, 220, 180, 245], fieldValue: 'ORIGINAL', readOnly: true,
      required: true, multiLine: true, defaultAppearanceData: { fontSize: 0, fontFamily: 'Helvetica' }
    },
    {
      id: '43R', subtype: 'Widget', fieldType: 'Tx', fieldName: 'nombre',
      rect: [30, 180, 180, 205], fieldValue: 'SEGUNDO', readOnly: true,
      required: true, multiLine: true, defaultAppearanceData: { fontSize: 0, fontFamily: 'Helvetica' }
    },
    {
      id: '44R', subtype: 'Widget', fieldType: 'Tx', fieldName: 'estrecho',
      rect: [30, 160, 180, 168], fieldValue: 'RECORTADO', readOnly: false,
      required: false, multiLine: false, defaultAppearanceData: { fontSize: 12, fontFamily: 'Helvetica' }
    }
  ];
  const pdfPage = {
    rotate: 0,
    async getAnnotations() { return annotations; },
    getViewport() { return { height: 300 }; }
  };
  const page = { sourceId: 'pdf', pageIndex: 0, objects: [] };
  const doc = { pages: [page], currentIndex: 0, sources: { pdf: { buffer: new ArrayBuffer(8), doc: { getPage: async () => pdfPage } } } };
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout, clearTimeout,
    document: { getElementById: () => null, body: { classList: { toggle() {} } } },
    PythonManager: { isLoaded: false },
    pdfjsLib: { getDocument() { throw new Error('the loaded source document must be reused'); } }
  };
  vm.runInNewContext(read('js/app.annotations.js'), context, { filename: 'app.annotations.js' });
  const app = context.window.app;
  Object.assign(app, {
    getDoc: () => doc,
    splitView: { activePanel: 'primary', primary: { scale: 1 } },
    currentScale: 1,
    getPanelElements: () => ({ annotationLayer: { style: {} } }),
    renderOverlays() {}, setupInteractDraggables() {}, saveState() {}, showToast() {}
  });

  await app.convertFormFieldsToObjects();
  assert.equal(page.nativeFieldOverlaysDetected, true);
  assert.notEqual(page.fieldsConverted, true);
  assert.equal(page.objects.length, 3);
  assert.deepEqual(page.objects.map(o => o.nativeFieldName), ['nombre', 'nombre', 'estrecho']);
  assert.deepEqual(page.objects.map(o => o.nativeWidgetIndex), [0, 1, 0]);
  assert.deepEqual(page.objects.map(o => o.nativeAnnotationId), ['42R', '43R', '44R']);
  assert.equal(page.objects[0].fontSize, 0);
  assert.equal(page.objects[0].autoSize, true);
  assert.equal(page.objects[0].readOnly, true);
  assert.equal(page.objects[0].required, true);
  assert.equal(page.objects[0].multiline, true);
  assert.equal(page.objects[2].autoSize, true);
  assert.equal(page.objects[2].fontSize, 0);
});

test('Native form preview applies auto-size after structural editing is disabled', () => {
  const context = {
    window: { app: {} }, console, setTimeout, clearTimeout,
    Uint8Array, ArrayBuffer, JSON, Math, Set, Map, Symbol, Date,
    document: {
      createElement(tag) {
        if (tag !== 'canvas') return { style: {} };
        return {
          getContext() {
            return {
              font: '',
              measureText(value) {
                const size = parseFloat(this.font) || 10;
                return { width: String(value).length * size * 0.5 };
              }
            };
          }
        };
      }
    }
  };
  vm.runInNewContext(read('js/app.render.js'), context, { filename: 'app.render.js' });
  const input = { value: '12345678901234567890', style: {} };

  context.window.app._applyNativeFieldPreviewStyle(input, {
    fieldType: 'text', autoSize: true, width: 100, height: 20,
    font: 'Arial', textValue: input.value
  }, 1);

  const size = parseFloat(input.style.fontSize);
  assert.ok(size >= 3 && size * 1.15 <= 20.25);
  assert.ok(input.value.length * size * 0.5 <= 100.25);
});

test('Edited native fields retain identity, autosize and editability across repeated saves', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const result = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    const sourcePage = source.addPage([400, 300]);
    const form = source.getForm();
    const text = form.createTextField('nombre');
    text.setText('ORIGINAL');
    text.setMaxLength(64);
    text.enableReadOnly();
    text.addToPage(sourcePage, { x: 30, y: 220, width: 150, height: 25 });
    text.acroField.setFontSize(0);
    const checkbox = form.createCheckBox('acepta');
    checkbox.addToPage(sourcePage, { x: 30, y: 180, width: 20, height: 20 });
    const radio = form.createRadioGroup('opcion');
    radio.addOptionToPage('A', sourcePage, { x: 30, y: 145, width: 16, height: 16 });
    radio.addOptionToPage('B', sourcePage, { x: 60, y: 145, width: 16, height: 16 });
    radio.select('A');
    const dropdown = form.createDropdown('lista');
    dropdown.setOptions(['Uno', 'Dos']);
    dropdown.select('Uno');
    dropdown.addToPage(sourcePage, { x: 30, y: 105, width: 100, height: 22 });
    const sourceBytes = await source.save();

    const page = {
      sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false,
      objects: [
        {
          id: 'native-nombre', type: 'form-field', fieldType: 'text', fromFormField: true,
          nativeFieldName: 'nombre', fieldName: 'nombre', x: 40, y: 55, width: 170, height: 25,
          textValue: 'CAMBIO', value: 'CAMBIO', autoSize: true, fontSize: 0,
          readOnly: false, required: false
        },
        {
          id: 'native-acepta', type: 'form-field', fieldType: 'checkbox', subtype: 'checkbox', fromFormField: true,
          nativeFieldName: 'acepta', fieldName: 'acepta', x: 40, y: 100, width: 20, height: 20,
          checked: true, readOnly: false, required: false
        },
        {
          id: 'native-opcion-a', type: 'form-field', fieldType: 'radio', subtype: 'radio', fromFormField: true,
          nativeFieldName: 'opcion', fieldName: 'opcion', nativeWidgetIndex: 0,
          x: 40, y: 135, width: 16, height: 16, value: 'A', exportValue: 'A', selected: false
        },
        {
          id: 'native-opcion-b', type: 'form-field', fieldType: 'radio', subtype: 'radio', fromFormField: true,
          nativeFieldName: 'opcion', fieldName: 'opcion', nativeWidgetIndex: 1,
          x: 70, y: 135, width: 16, height: 16, value: 'B', exportValue: 'B', selected: true
        },
        {
          id: 'native-lista', type: 'form-field', fieldType: 'dropdown', subtype: 'select', fromFormField: true,
          nativeFieldName: 'lista', fieldName: 'lista', x: 40, y: 175, width: 100, height: 22,
          selectedValue: 'Dos', value: 'Dos', options: ['Uno', 'Dos'], readOnly: false, required: false
        }
      ],
      nativeFormValues: {
        nombre: { kind: 'text', value: 'ORIGINAL' },
        acepta: { kind: 'checkbox', value: false },
        opcion: { kind: 'radio', value: 'A' },
        lista: { kind: 'choice', value: 'Uno' }
      },
      fieldsConverted: true
    };
    const doc = {
      name: 'formulario.pdf', pages: [page], currentIndex: 0,
      sources: { pdf: { buffer: Uint8Array.from(sourceBytes), originalBuffer: Uint8Array.from(sourceBytes) } }
    };
    app.getDoc = () => doc;
    app.isFieldEditMode = true;
    app.toggleLoader = () => {};
    app.showToast = () => {};

    const firstBytes = await app.savePDFInternal(false, null, false, true);
    const first = await PDFLib.PDFDocument.load(firstBytes);
    const firstForm = first.getForm();
    const firstText = firstForm.getTextField('nombre');
    const firstSavedText = firstText.getText();
    const firstCheckboxChecked = firstForm.getCheckBox('acepta').isChecked();
    const firstRadioValue = firstForm.getRadioGroup('opcion').getSelected();
    const firstDropdownValue = firstForm.getDropdown('lista').getSelected();
    const firstFieldNames = firstForm.getFields().map(field => field.getName());
    const firstWidgetCount = first.getPages().reduce((count, pdfPage) => {
      const annots = pdfPage.node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
      if (!annots) return count;
      let widgets = 0;
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookup(i, PDFLib.PDFDict);
        if (annot && String(annot.get(PDFLib.PDFName.of('Subtype'))) === '/Widget') widgets += 1;
      }
      return count + widgets;
    }, 0);
    const firstWidgetsHaveCorrectPageRefs = first.getPages().every(pdfPage => {
      const annots = pdfPage.node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
      if (!annots) return true;
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookup(i, PDFLib.PDFDict);
        if (!annot || String(annot.get(PDFLib.PDFName.of('Subtype'))) !== '/Widget') continue;
        if (String(annot.get(PDFLib.PDFName.of('P'))) !== String(pdfPage.ref)) return false;
      }
      return true;
    });

    const firstDefaultAppearance = firstText.acroField.getDefaultAppearance();
    firstText.setText('EDITADO EXTERNAMENTE');
    const externallyEditedBytes = await first.save();
    const externallyReopened = await PDFLib.PDFDocument.load(externallyEditedBytes);

    doc.sources.pdf = { buffer: Uint8Array.from(firstBytes), originalBuffer: Uint8Array.from(firstBytes) };
    page.fieldsConverted = false;
    const secondBytes = await app.savePDFInternal(false, null, false, true);
    const second = await PDFLib.PDFDocument.load(secondBytes);

    return {
      firstFieldNames,
      firstWidgetCount,
      firstWidgetsHaveCorrectPageRefs,
      firstSavedText,
      firstCheckboxChecked,
      firstRadioValue,
      firstDropdownValue,
      text: firstText.getText(),
      maxLength: firstText.getMaxLength(),
      isReadOnly: firstText.isReadOnly(),
      defaultAppearance: firstDefaultAppearance,
      externalText: externallyReopened.getForm().getTextField('nombre').getText(),
      secondFieldNames: second.getForm().getFields().map(field => field.getName()),
      secondWidgetCount: second.getPages()[0].node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).size(),
      secondWidgetsHaveCorrectPageRefs: (() => {
        const pdfPage = second.getPages()[0];
        const annots = pdfPage.node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray);
        for (let i = 0; i < annots.size(); i++) {
          const annot = annots.lookup(i, PDFLib.PDFDict);
          if (!annot || String(annot.get(PDFLib.PDFName.of('Subtype'))) !== '/Widget') continue;
          if (String(annot.get(PDFLib.PDFName.of('P'))) !== String(pdfPage.ref)) return false;
        }
        return true;
      })()
    };
  })()`, context);

  assert.deepEqual(Array.from(result.firstFieldNames), ['nombre', 'acepta', 'opcion', 'lista']);
  assert.equal(result.firstWidgetCount, 5);
  assert.equal(result.firstWidgetsHaveCorrectPageRefs, true);
  assert.equal(result.firstSavedText, 'CAMBIO');
  assert.equal(result.firstCheckboxChecked, true);
  assert.equal(result.firstRadioValue, 'B');
  assert.deepEqual(Array.from(result.firstDropdownValue), ['Dos']);
  assert.equal(result.text, 'EDITADO EXTERNAMENTE');
  assert.equal(result.maxLength, 64);
  assert.equal(result.isReadOnly, false);
  assert.match(result.defaultAppearance, /\s0(?:\.0+)?\s+Tf/);
  assert.equal(result.externalText, 'EDITADO EXTERNAMENTE');
  assert.deepEqual(Array.from(result.secondFieldNames), ['nombre', 'acepta', 'opcion', 'lista']);
  assert.equal(result.secondWidgetCount, 5);
  assert.equal(result.secondWidgetsHaveCorrectPageRefs, true);
});

test('Saving normalizes untouched native text fields with missing appearances', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const result = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    const sourcePage = source.addPage([300, 220]);
    const form = source.getForm();

    const missing = form.createTextField('sin_da');
    missing.setText('VISIBLE');
    missing.addToPage(sourcePage, { x: 20, y: 160, width: 180, height: 20 });

    const automatic = form.createTextField('auto_sin_editar');
    automatic.setText('AUTOMATICO');
    automatic.addToPage(sourcePage, { x: 20, y: 120, width: 180, height: 20 });

    const fixed = form.createTextField('fijo');
    fixed.setText('FIJO');
    fixed.addToPage(sourcePage, { x: 20, y: 80, width: 180, height: 20 });
    fixed.setFontSize(10);

    const sourceBytesWithAppearances = await source.save();
    const brokenSource = await PDFLib.PDFDocument.load(sourceBytesWithAppearances);
    brokenSource.getForm().getTextField('sin_da').acroField.dict.delete(PDFLib.PDFName.of('DA'));
    brokenSource.getForm().getTextField('auto_sin_editar').acroField.setFontSize(0);
    const sourceBytes = await brokenSource.save({ updateFieldAppearances: false });
    const page = { sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false, objects: [] };
    const doc = { name: 'missing-da.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: sourceBytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};

    const saved = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(saved);
    const savedForm = reopened.getForm();
    const acroForm = savedForm.acroForm.dict;
    const drValue = acroForm.get(PDFLib.PDFName.of('DR'));
    const dr = drValue ? reopened.context.lookup(drValue, PDFLib.PDFDict) : undefined;
    const fontValue = dr?.get(PDFLib.PDFName.of('Font'));
    const fonts = fontValue ? reopened.context.lookup(fontValue, PDFLib.PDFDict) : undefined;

    return {
      missingDa: savedForm.getTextField('sin_da').acroField.getDefaultAppearance(),
      automaticDa: savedForm.getTextField('auto_sin_editar').acroField.getDefaultAppearance(),
      fixedDa: savedForm.getTextField('fijo').acroField.getDefaultAppearance(),
      hasHelvetica: !!fonts?.get(PDFLib.PDFName.of('Helvetica')),
      hasHelv: !!fonts?.get(PDFLib.PDFName.of('Helv')),
      needAppearances: String(acroForm.get(PDFLib.PDFName.of('NeedAppearances')) || '')
    };
  })()`, context);

  assert.match(result.missingDa, /\/Helvetica\s+0(?:\.0+)?\s+Tf/);
  assert.match(result.automaticDa, /\s0(?:\.0+)?\s+Tf/);
  assert.match(result.fixedDa, /\s10(?:\.0+)?\s+Tf/);
  assert.equal(result.hasHelvetica, true);
  assert.equal(result.hasHelv, true);
  assert.notEqual(result.needAppearances, 'true');
});

test('Saving a source page without annotations does not fail', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const byteLength = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([300, 220]);
    const sourceBytes = await source.save();
    const page = { sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false, objects: [] };
    const doc = { name: 'blank.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: sourceBytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};
    const saved = await app.savePDFInternal(false, null, false, true);
    return saved.length;
  })()`, context);

  assert.ok(byteLength > 0);
});

test('New auto-size text fields remain auto-size after saving', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const result = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([300, 220]);
    const sourceBytes = await source.save();
    const page = {
      sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false,
      objects: [{
        id: 'auto-nuevo', type: 'form-field', fieldType: 'text', fieldName: 'auto_nuevo',
        x: 20, y: 30, width: 180, height: 24, textValue: 'TEXTO AUTOAJUSTABLE', value: 'TEXTO AUTOAJUSTABLE',
        autoSize: true, fontSize: 0, font: 'Helvetica', borderWidth: 1, borderStyle: 'solid',
        borderRadius: 0, backgroundColor: '#ffffff', textColor: '#000000'
      }]
    };
    const doc = { name: 'auto-size.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: sourceBytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};

    const saved = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(saved);
    const field = reopened.getForm().getTextField('auto_nuevo');
    const widget = field.acroField.getWidgets()[0];
    return {
      value: field.getText(),
      defaultAppearance: field.acroField.getDefaultAppearance(),
      hasAppearance: !!widget.dict.get(PDFLib.PDFName.of('AP'))
    };
  })()`, context);

  assert.equal(result.value, 'TEXTO AUTOAJUSTABLE');
  assert.match(result.defaultAppearance, /\s0(?:\.0+)?\s+Tf/);
  assert.equal(result.hasAppearance, true);
});

test('New auto-size dropdown fields remain auto-size after saving', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const result = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([300, 220]);
    const sourceBytes = await source.save();
    const page = {
      sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false,
      objects: [{
        id: 'auto-lista', type: 'form-field', fieldType: 'dropdown', fieldName: 'auto_lista',
        x: 20, y: 30, width: 180, height: 24, options: ['Uno', 'Dos'], selectedValue: 'Dos', value: 'Dos',
        autoSize: true, fontSize: 12, font: 'Helvetica', borderWidth: 1, borderStyle: 'solid',
        borderRadius: 0, backgroundColor: '#ffffff', textColor: '#000000'
      }]
    };
    const doc = { name: 'auto-dropdown.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: sourceBytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};

    const saved = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(saved);
    const field = reopened.getForm().getDropdown('auto_lista');
    return { selected: field.getSelected(), defaultAppearance: field.acroField.getDefaultAppearance() };
  })()`, context);

  assert.deepEqual(Array.from(result.selected), ['Dos']);
  assert.match(result.defaultAppearance, /\s0(?:\.0+)?\s+Tf/);
});

test('Two-column auto-size text keeps both generated fields auto-size', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const appearances = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage([300, 220]);
    const sourceBytes = await source.save();
    const page = {
      sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false,
      objects: [{
        id: 'auto-doble', type: 'form-field', fieldType: 'text', fieldName: 'auto_doble',
        x: 20, y: 30, width: 220, height: 24, textValue: 'PRIMERA COLUMNA SEGUNDA COLUMNA',
        value: 'PRIMERA COLUMNA SEGUNDA COLUMNA', autoSize: true, twoColumns: true,
        fontSize: 0, font: 'Helvetica', borderWidth: 1, borderStyle: 'solid',
        borderRadius: 0, backgroundColor: '#ffffff', textColor: '#000000'
      }]
    };
    const doc = { name: 'auto-columns.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: sourceBytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};
    const saved = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(saved);
    return ['auto_doble_col1', 'auto_doble_col2'].map(name =>
      reopened.getForm().getTextField(name).acroField.getDefaultAppearance()
    );
  })()`, context);

  assert.equal(appearances.length, 2);
  for (const appearance of appearances) assert.match(appearance, /\s0(?:\.0+)?\s+Tf/);
});

test('Renaming a native field updates it in place instead of creating a duplicate', async () => {
  const context = {
    window: { app: {} }, console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
    clearTimeout,
    document: { getElementById: () => ({ innerText: '', textContent: '', style: {} }) },
    PythonManager: { isLoaded: false },
    alert: message => { throw new Error(message); }
  };
  vm.runInNewContext(read('libs/pdf-lib.min.js'), context, { filename: 'pdf-lib.min.js' });
  vm.runInNewContext(read('js/app.pdf.js'), context, { filename: 'app.pdf.js' });

  const names = await vm.runInNewContext(`(async () => {
    const source = await PDFLib.PDFDocument.create();
    const sourcePage = source.addPage([300, 200]);
    const field = source.getForm().createTextField('nombre');
    field.setText('VALOR');
    field.setMaxLength(20);
    field.addToPage(sourcePage, { x: 20, y: 120, width: 120, height: 20 });
    const bytes = await source.save();
    const page = {
      sourceId: 'pdf', pageIndex: 0, rotation: 0, flipH: false, flipV: false, objects: [{
        id: 'native-nombre', type: 'form-field', fieldType: 'text', fromFormField: true,
        nativeFieldName: 'nombre', fieldName: 'nombre_editado', x: 20, y: 60, width: 120, height: 20,
        textValue: 'VALOR NUEVO', value: 'VALOR NUEVO', readOnly: false, required: false
      }]
    };
    const doc = { name: 'rename.pdf', pages: [page], currentIndex: 0, sources: { pdf: { buffer: bytes } } };
    app.getDoc = () => doc;
    app.toggleLoader = () => {};
    app.showToast = () => {};
    const saved = await app.savePDFInternal(false, null, false, true);
    const reopened = await PDFLib.PDFDocument.load(saved);
    const renamed = reopened.getForm().getTextField('nombre_editado');
    return {
      fieldNames: reopened.getForm().getFields().map(item => item.getName()),
      value: renamed.getText(),
      maxLength: renamed.getMaxLength()
    };
  })()`, context);

  assert.deepEqual(Array.from(names.fieldNames), ['nombre_editado']);
  assert.equal(names.value, 'VALOR NUEVO');
  assert.equal(names.maxLength, 20);
});

test('Objects can carry a PDF link without adding visible text', () => {
  const html = read('BASE.html');
  const tools = read('js/app.tools.js');
  const ui = read('js/app.ui.js');
  const pdf = read('js/app.pdf.js');
  assert.match(html, /id="link-text-row"/);
  assert.match(tools, /showObjectLinkModal: function/);
  assert.match(tools, /target\.actionLink =/);
  assert.match(tools, /removeObjectLink: function/);
  assert.match(ui, /Agregar vínculo/);
  assert.match(pdf, /transparent PDF link annotations/);
  assert.match(pdf, /const action = o\.actionLink/);
});

test('Real text editing keeps transactional PDF history and releases async state', () => {
  const toolsSource = read('js/app.tools.js');
  const opsSource = read('js/app.pdf_ops.js');
  const renderSource = read('js/app.render.js');
  const uiSource = read('js/app.ui.js');
  const managerSource = read('js/python_manager.js');
  const coreSource = read('js/app.core.js');
  const context = {
    window: { app: {}, getSelection: () => ({ rangeCount: 0 }) },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => [],
      body: { classList: { add: () => {}, remove: () => {} } }
    },
    console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, JSON, Math, Set, Map
  };
  vm.runInNewContext(toolsSource, context, { filename: 'app.tools.js' });
  const app = context.window.app;
  const before = Uint8Array.from([1, 2, 3]);
  const after = Uint8Array.from([7, 8, 9]);
  const doc = {
    history: ['[]', '[]'], historyIndex: 1, pages: [], currentIndex: 0,
    sources: { pdf: { buffer: after.slice(0), doc: {} } },
    _historyBuffers: { 1: { sourceId: 'pdf', beforeBuffer: before, afterBuffer: after, buffer: before } }
  };
  Object.assign(app, {
    getDoc: () => doc,
    multiSelection: new Set(), multiObjectSelection: new Set(), selectedObj: null,
    loadPage: () => {}, renderSidebar: () => {}, updateUndoRedoUI: () => {}, showToast: () => {}
  });

  for (let cycle = 0; cycle < 100; cycle++) {
    app.undo();
    assert.deepEqual(Array.from(doc.sources.pdf.buffer), Array.from(before));
    assert.equal(doc.sources.pdf.doc, null);
    app.redo();
    assert.deepEqual(Array.from(doc.sources.pdf.buffer), Array.from(after));
    assert.equal(doc.sources.pdf.doc, null);
  }

  assert.match(opsSource, /beforeBuffer:\s*_transactionBeforeBuffer/);
  assert.match(opsSource, /afterBuffer:\s*result\.buffer\.slice\(0\)/);
  assert.match(toolsSource, /await this\.applyRealTimeSmartPatch\(\)/);
  assert.match(toolsSource, /finally\s*\{\s*this\._applyingSmartPatch = false/);
  assert.match(toolsSource, /const scale = 4/);
  assert.doesNotMatch(toolsSource, /detectedFontSize < 8\) scale = 12/);
  assert.match(toolsSource, /bestPy\.letter_spacing \/ Math\.max\(bestPy\.size/);
  assert.match(toolsSource, /Texto rotado\/vertical: edición protegida/);
  assert.match(opsSource, /newText\.length > 0 \? newText : ' '/);
  assert.match(renderSource, /_rawText\.length > 0 \? _rawText : ' '/);
  assert.match(opsSource, /w:\s*_cW/);
  assert.match(opsSource, /alignment:\s*textObj\.alignment \|\| data\.textAlign \|\| 'left'/);
  assert.match(opsSource, /_registeredInfo\?\.path[\s\S]*const _fontBytes = _regBytes \|\| _sysBytes/);
  assert.match(opsSource, /this\._realTextCommitInProgress = true/);
  assert.match(uiSource, /if \(this\._realTextCommitInProgress\) return/);
  assert.match(uiSource, /this\.selectedObj\?\._pendingRealData[\s\S]*pendingSpan\.blur\(\)/);
  assert.match(toolsSource, /el\.closest\('\.canvas-container'\) \|\| el\.parentElement/);
  assert.match(opsSource, /removeEventListener\('mouseup', this\.smartPatchMouseUp\)/);
  assert.match(opsSource, /lineCount:\s*_selLineCount/);
  assert.match(opsSource, /this\._realEditSelectionPending/);
  assert.match(toolsSource, /selectedLineCount[\s\S]*selectedLineCount > 1/);
  assert.doesNotMatch(toolsSource, /hInPdf > 12/);
  assert.match(toolsSource, /Number\.isFinite\(closestItem\._domTopPdf\)/);
  assert.match(coreSource, /systemFontByteScores[\s\S]*cacheScore < systemFontByteScores\[fontKey\]/);
  assert.match(managerSource, /_alignment = 2 if _alignment_name == 'right'/);
  const commitStart = opsSource.indexOf('_applyRealTextInlineCommitNow: async function');
  assert.ok(commitStart >= 0);
  const commitEnd = opsSource.indexOf('\n            scanQR:', commitStart);
  const commitSource = opsSource.slice(commitStart, commitEnd);
  assert.ok(commitSource.indexOf('await this.loadPage') < commitSource.indexOf('_removeCover();'));
  assert.ok(commitSource.indexOf('this.selectedObj = null') < commitSource.indexOf('this._restoreContinuousIfNeeded();'));
  assert.ok(commitSource.indexOf('this._realTextCommitInProgress = false') < commitSource.indexOf('this._restoreContinuousIfNeeded();'));
});

test('Pointer zoom restores the same visual point after re-render', () => {
  const renderSource = read('js/app.render.js');
  const target = {
    id: 'canvas-container',
    rect: { left: 100, top: 80, width: 400, height: 600 },
    getBoundingClientRect() { return this.rect; },
    closest() { return this; }
  };
  const mainView = {
    scrollLeft: 120, scrollTop: 240,
    clientWidth: 300, scrollWidth: 1000,
    contains: node => node === target
  };
  const context = {
    window: { app: {} },
    document: {
      elementFromPoint: () => target,
      getElementById: id => id === target.id ? target : null
    },
    console, setTimeout, clearTimeout, requestAnimationFrame: fn => fn(),
    Uint8Array, ArrayBuffer, JSON, Math, Set, Map, Symbol, Date
  };
  vm.runInNewContext(renderSource, context, { filename: 'app.render.js' });
  const app = context.window.app;
  app.getPanelElements = () => ({ mainView, canvasContainer: target });

  const anchor = app._captureZoomAnchor('primary', 250, 260);
  assert.equal(anchor.localX, 150);
  assert.equal(anchor.localY, 180);
  assert.equal(anchor.baseWidth, 400);
  target.rect = { left: 40, top: 20, width: 800, height: 1200 };
  assert.equal(app._restoreZoomAnchor(anchor), true);
  assert.equal(mainView.scrollLeft, 210);
  assert.equal(mainView.scrollTop, 360);

  mainView.clientWidth = 900;
  mainView.scrollWidth = 900;
  mainView.scrollLeft = 75;
  target.rect = { left: 100, top: 80, width: 400, height: 600 };
  const centeredAnchor = app._captureZoomAnchor('primary', 250, 260);
  target.rect = { left: 50, top: 20, width: 800, height: 1200 };
  assert.equal(app._restoreZoomAnchor(centeredAnchor), true);
  assert.equal(mainView.scrollLeft, 0);
  assert.match(read('js/app.ui.js'), /zoomPanel\(e\.deltaY > 0[\s\S]*clientX:\s*e\.clientX/);
  assert.match(read('js/app.ui.js'), /-0\.06075\s*:\s*0\.06075/);
  assert.match(renderSource, /if \(this\._pendingZoomAnchor && delta > 0\) this\._pendingZoomAnchor\.preserveX = true/);
  assert.match(renderSource, /const originX = anchor\.preserveX[\s\S]*anchor\.localX[\s\S]*anchor\.baseWidth \/ 2/);
  assert.match(renderSource, /_moveCContainerToWrapper[\s\S]*if \(pointerZoomAnchor\) this\._restoreZoomAnchor/);
  assert.match(renderSource, /_pendingContinuousScrollOffset/);
  assert.match(renderSource, /if \(pendingReturnOffset\)[\s\S]*scrollOffsetInPage = pendingReturnOffset\.offset/);
});

test('PyMuPDF real text edit replaces native text in a valid PDF', () => {
  const managerSource = read('js/python_manager.js');
  const methodStart = managerSource.indexOf('applyReflowEdit: async function');
  const marker = 'const result = await this.run(`';
  const codeStart = managerSource.indexOf(marker, methodStart) + marker.length;
  const codeEnd = managerSource.indexOf('\napply_reflow_edit(js_data, js_pno, js_edit)', codeStart);
  assert.ok(methodStart >= 0 && codeStart >= marker.length && codeEnd > codeStart);
  const functionCode = managerSource.slice(codeStart, codeEnd);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alioth_text_regression_'));
  const runner = path.join(tempDir, 'runner.py');
  const harness = String.raw`
source_doc = fitz.open()
source_page = source_doc.new_page()
source_page.insert_text((72, 100), 'ORIGINAL 123', fontsize=12, fontname='helv')
bbox = source_page.search_for('ORIGINAL 123')[0]
source_bytes = source_doc.tobytes()
source_doc.close()
edit = {
    'x': bbox.x0, 'y': bbox.y0, 'w': bbox.width, 'h': bbox.height,
    'eraseFullX': bbox.x0, 'eraseFullW': bbox.width, 'eraseFullY': bbox.y0,
    'text': 'NUEVO 456', 'size': 12, 'color': '#000000',
    'bgColor': 'transparent', 'font': 'Helvetica', 'expandIfNeeded': True,
    'isSurgical': True, 'letterSpacing': 0, 'alignment': 'right'
}
result = json.loads(apply_reflow_edit(source_bytes, 0, json.dumps(edit)))
edited_bytes = base64.b64decode(result['pdf'])
edited_doc = fitz.open(stream=edited_bytes, filetype='pdf')
edited_text = edited_doc[0].get_text()
edited_spans = [sp for block in edited_doc[0].get_text('dict')['blocks'] for line in block.get('lines', []) for sp in line.get('spans', []) if 'NUEVO 456' in sp.get('text', '')]
edited_doc.close()
assert 'NUEVO 456' in edited_text, edited_text
assert 'ORIGINAL 123' not in edited_text, edited_text
assert edited_spans and abs(edited_spans[0]['bbox'][2] - bbox.x1) < 1.5, edited_spans

arial_path = r'C:\Windows\Fonts\arial.ttf'
if os.path.exists(arial_path):
    exact_edit = dict(edit)
    exact_edit['text'] = 'TIPOGRAFIA'
    exact_edit['font'] = 'Arial'
    exact_edit['fontBufferName'] = 'Arial'
    exact_edit['fontBuffer'] = base64.b64encode(open(arial_path, 'rb').read()).decode()
    exact_result = json.loads(apply_reflow_edit(source_bytes, 0, json.dumps(exact_edit)))
    exact_doc = fitz.open(stream=base64.b64decode(exact_result['pdf']), filetype='pdf')
    exact_spans = [sp for block in exact_doc[0].get_text('dict')['blocks'] for line in block.get('lines', []) for sp in line.get('spans', []) if 'TIPOGRAFIA' in sp.get('text', '')]
    exact_doc.close()
    assert exact_spans and 'arial' in exact_spans[0]['font'].lower(), exact_spans
`;
  try {
    fs.writeFileSync(runner, functionCode + harness, 'utf8');
    execFileSync(path.join(root, '_python', 'python.exe'), [runner], {
      timeout: 120000,
      stdio: 'pipe',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PDF to Office uses native reconstruction paths', () => {
  const office = read('js/office_conversion.js');
  const proxy = read('_proxy.py');
  const html = read('BASE.html');
  assert.match(office, /convert-pdf-to-word/);
  assert.match(office, /convert-pdf-to-excel/);
  assert.match(office, /convert-pdf-to-excel-ai/);
  assert.match(office, /showOfficeAIModal/);
  assert.match(office, /convert-pdf-to-\$\{target\}-ai/);
  assert.match(office, /exportToPptx/);
  assert.match(html, /Office<br>IA/);
  assert.ok(html.indexOf('app.exportToPptx()') < html.indexOf('app.showOfficeAIModal()'));
  assert.match(proxy, /convert_pdf_to_docx/);
  assert.match(proxy, /convert_pdf_to_xlsx/);
  assert.match(proxy, /convert_pdf_to_pptx/);
  assert.match(proxy, /convert_pdf_to_docx_ai/);
  assert.match(proxy, /convert_pdf_to_pptx_ai/);
  assert.match(proxy, /_lock_pptx_background/);
  assert.match(proxy, /_prefer_native_office_conversion/);
  assert.match(proxy, /_page_is_image_composed/);
  assert.match(proxy, /"shapes"/);
  assert.match(proxy, /PDF vectorial: preservando/);
  assert.match(proxy, /tables = native_tables \+/);
  assert.match(proxy, /doc\.Tables\.Add\(shape\.TextFrame\.TextRange/);
  assert.match(proxy, /doc\.Shapes\.AddShape/);
  assert.match(proxy, /page\.get_drawings/);
  assert.match(proxy, /page\.get_text\('words'\)/);
  assert.match(proxy, /slide\.shapes\.add_textbox/);
  assert.match(proxy, /_configure_excel_page/);
  assert.match(proxy, /_add_pdf_image_clips/);
  assert.match(proxy, /"images"/);
  assert.match(proxy, /responseJsonSchema/);
  assert.match(html, /id="excel-ai-progress"/);
  assert.match(office, /setProgress\(100, 'Excel listo'\)/);
});

test('PDF to Office produces valid editable Office packages', () => {
  const py = path.join(root, '_python', 'python.exe');
  const script = String.raw`
import fitz, json, os, runpy, tempfile, shutil, zipfile, openpyxl
tmp = tempfile.mkdtemp(prefix='alioth_regression_', dir=r'${root.replace(/\\/g, '\\\\')}')
try:
    pdf = os.path.join(tmp, 'sample.pdf')
    doc = fitz.open(); page = doc.new_page()
    page.draw_rect((50, 50, 400, 110), color=(0,0,0), fill=(.26,.45,.77))
    page.insert_text((70, 85), 'REPORTE 2026', fontsize=16, color=(1,1,1))
    page.insert_text((70, 145), 'FECHA'); page.insert_text((220, 145), 'VALOR')
    page.insert_text((70, 175), '01'); page.insert_text((220, 175), '120')
    grid_x, grid_y = (50, 167, 284, 400), (210, 235, 260)
    for y in grid_y:
      for x0, x1 in zip(grid_x, grid_x[1:]): page.draw_rect(fitz.Rect(x0, y, x1, y + .4), color=(0,0,0), width=.4)
    for x in grid_x:
      for y0, y1 in zip(grid_y, grid_y[1:]): page.draw_rect(fitz.Rect(x, y0, x + .4, y1), color=(0,0,0), width=.4)
    doc.save(pdf); doc.close()
    m = runpy.run_path(r'${path.join(root, '_proxy.py').replace(/\\/g, '\\\\')}', run_name='regression_proxy')
    assert m['_prefer_native_office_conversion'](pdf)
    grid_source = fitz.open(pdf); detected_grids = m['_rect_grid_tables'](grid_source[0]); grid_source.close()
    assert any(rows == 2 and cols == 3 for _, rows, cols, *_ in detected_grids)
    xlsx, pptx, docx = [os.path.join(tmp, 'out.' + ext) for ext in ('xlsx','pptx','docx')]
    ai_xlsx = os.path.join(tmp, 'out_ai.xlsx')
    m['convert_pdf_to_xlsx'](pdf, xlsx); m['convert_pdf_to_pptx'](pdf, pptx); m['convert_pdf_to_docx'](pdf, docx, timeout=120)
    class FakeResponse:
      def __enter__(self): return self
      def __exit__(self, *args): return False
      def read(self): return b'{"candidates":[{"content":{"parts":[{"text":"{\\\"x\\\":[0,250,500],\\\"y\\\":[0,100,200],\\\"cells\\\":[[0,0,500,100,\\\"REPORTE\\\",\\\"4472C4\\\",true,\\\"center\\\",16],[0,100,250,200,\\\"FECHA\\\"],[250,100,500,200,\\\"120\\\"]],\\\"images\\\":[]}"}]}}]}'
    m['convert_pdf_to_xlsx_ai'].__globals__['GEMINI_KEYS']=['test']; original=m['urllib'].request.urlopen; m['urllib'].request.urlopen=lambda *args, **kwargs: FakeResponse()
    m['convert_pdf_to_xlsx_ai'](pdf, ai_xlsx); m['urllib'].request.urlopen=original
    class BrokenResponse(FakeResponse):
      def read(self): return b'{"candidates":[{"content":{"parts":[{"text":"{\\\"blocks\\\":["}]}}]}'
    m['urllib'].request.urlopen=lambda *args, **kwargs: BrokenResponse()
    source = fitz.open(pdf); fallback_blocks, fallback_tables, fallback_shapes = m['_gemini_text_blocks'](source[0]); source.close(); m['urllib'].request.urlopen=original
    assert fallback_blocks or fallback_tables or fallback_shapes
    class ShapeResponse:
      def __enter__(self): return self
      def __exit__(self, *args): return False
      def read(self): return json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps({'blocks': [], 'tables': [], 'shapes': [['roundRect', 100, 100, 400, 250, 'FFFFFF', '21409A', 1]]})}]}}]}).encode()
    m['urllib'].request.urlopen=lambda *args, **kwargs: ShapeResponse()
    source = fitz.open(pdf); _, _, detected_shapes = m['_gemini_text_blocks'](source[0]); source.close(); m['urllib'].request.urlopen=original
    assert len(detected_shapes) == 1 and detected_shapes[0][0] == 'roundRect'
    values = ' '.join(str(c.value) for row in openpyxl.load_workbook(xlsx).active.iter_rows() for c in row if c.value)
    assert all(token in values for token in ('FECHA', 'VALOR', '120'))
    assert 'REPORTE' in ' '.join(str(c.value) for row in openpyxl.load_workbook(ai_xlsx).active.iter_rows() for c in row if c.value)
    with zipfile.ZipFile(pptx) as z:
      slide = z.read('ppt/slides/slide1.xml').decode('utf-8', 'replace')
      assert slide.count('<p:sp>') > 1 and 'FECHA' in slide
      assert 'noSelect="1"' in slide
    with zipfile.ZipFile(docx) as z: assert 'REPORTE' in z.read('word/document.xml').decode('utf-8', 'replace')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`;
  execFileSync(py, ['-c', script], { timeout: 180000, stdio: 'pipe' });
});

test('Stamp cleanup scans every page, removes every selected stamp and preserves editable form fields', () => {
  const cleanup = require(path.join(root, 'js', 'pdf_link_cleanup.js'));
  const py = path.join(root, '_python', 'python.exe');
  const script = cleanup.PYTHON_SOURCE + String.raw`
import json

doc = fitz.open()
for page_index in range(3):
    page = doc.new_page(width=400, height=300)
    page.insert_text((20, 38), f'STAMP {page_index}', fontsize=12)
    page.insert_link({
        'kind': fitz.LINK_URI,
        'from': fitz.Rect(10, 10, 150, 60),
        'uri': f'https://stamps.example/{page_index}',
    })
    widget = fitz.Widget()
    widget.field_name = f'nombre_{page_index}'
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_value = f'VALOR {page_index}'
    widget.rect = fitz.Rect(20, 120, 220, 150)
    page.add_widget(widget)

source = doc.tobytes(garbage=4, deflate=True)
doc.close()
links = json.loads(scan_pdf_links(source, 'all', False))
assert len(links) == 3, links
assert {item['pageIndex'] for item in links} == {0, 1, 2}, links

cleaned = remove_pdf_links(source, json.dumps(links), True)
result = fitz.open(stream=cleaned, filetype='pdf')
assert sum(len(page.get_links()) for page in result) == 0
assert all('STAMP' not in page.get_text() for page in result)
assert [next(page.widgets()).field_value for page in result] == ['VALOR 0', 'VALOR 1', 'VALOR 2']

first_page = result[0]
widget = next(first_page.widgets())
widget.field_value = 'EDITABLE DESPUES'
widget.update()
edited = result.tobytes(garbage=4, deflate=True)
result.close()
reopened = fitz.open(stream=edited, filetype='pdf')
reopened_page = reopened[0]
assert next(reopened_page.widgets()).field_value == 'EDITABLE DESPUES'
reopened.close()
`;
  execFileSync(py, ['-c', script], { timeout: 30000, stdio: 'pipe' });
});

test('Area unlink removes only intersecting PDF links without erasing visible content', () => {
  const cleanup = require(path.join(root, 'js', 'pdf_link_cleanup.js'));
  const py = path.join(root, '_python', 'python.exe');
  const fixtureScript = String.raw`
import fitz, sys
doc = fitz.open(); page = doc.new_page(width=400, height=300)
page.insert_text((20, 38), 'AREA LINK', fontsize=12)
page.insert_text((220, 238), 'OUTSIDE LINK', fontsize=12)
page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(10, 10, 150, 60), 'uri': 'https://area.example'})
page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(210, 210, 370, 260), 'uri': 'https://outside.example'})
sys.stdout.buffer.write(doc.tobytes(garbage=4, deflate=True))
`;
  const source = execFileSync(py, ['-c', fixtureScript], { timeout: 30000 });
  const scanScript = cleanup.PYTHON_SOURCE + String.raw`
import sys
source = sys.stdin.buffer.read()
sys.stdout.write(scan_pdf_links(source, 'all', False))
`;
  const links = JSON.parse(execFileSync(py, ['-c', scanScript], { input: source, timeout: 30000, encoding: 'utf8' }));
  const selected = cleanup.selectLinksInArea(links, { x0: 0, y0: 0, x1: 180, y1: 80 }, 0);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].uri, 'https://area.example');

  const removeScript = cleanup.PYTHON_SOURCE + String.raw`
import json, sys
source = sys.stdin.buffer.read()
targets = json.loads(sys.argv[1])
sys.stdout.buffer.write(remove_pdf_links(source, json.dumps(targets), False))
`;
  const result = execFileSync(py, ['-c', removeScript, JSON.stringify(selected)], { input: source, timeout: 30000 });
  const inspectScript = String.raw`
import fitz, json, sys
doc = fitz.open(stream=sys.stdin.buffer.read(), filetype='pdf')
print(json.dumps({'links': [link.get('uri', '') for link in doc[0].get_links()], 'text': doc[0].get_text()}))
`;
  const inspected = JSON.parse(execFileSync(py, ['-c', inspectScript], { input: result, timeout: 30000, encoding: 'utf8' }));
  assert.deepEqual(inspected.links, ['https://outside.example']);
  assert.match(inspected.text, /AREA LINK/);
  assert.match(inspected.text, /OUTSIDE LINK/);
});

test('Area unlink detaches app object links while keeping their visible content', () => {
  const cleanup = require(path.join(root, 'js', 'pdf_link_cleanup.js'));
  const pageObjects = [
    { id: 'standalone', type: 'link', x: 10, y: 10, width: 100, height: 20, text: 'Visible', size: 14, url: 'https://one.example' },
    { id: 'shape', type: 'shape', x: 30, y: 40, width: 50, height: 50, actionLink: { type: 'web', url: 'https://two.example' } },
    { id: 'outside', type: 'shape', x: 250, y: 220, width: 50, height: 50, actionLink: { type: 'web', url: 'https://three.example' } },
  ];
  const result = cleanup.unlinkAppObjectsInArea(pageObjects, { x0: 0, y0: 0, x1: 150, y1: 120 });
  assert.equal(result.removedCount, 2);
  assert.equal(result.objects[0].type, 'text');
  assert.equal(result.objects[0].text, 'Visible');
  assert.equal(result.objects[0].fontSize, 14);
  assert.equal(result.objects[0].url, undefined);
  assert.equal(result.objects[1].type, 'shape');
  assert.equal(result.objects[1].actionLink, undefined);
  assert.deepEqual(result.objects[2].actionLink, { type: 'web', url: 'https://three.example' });

  const selectedOnly = cleanup.unlinkAppObjectsById(pageObjects, new Set(['shape']));
  assert.equal(selectedOnly.removedCount, 1);
  assert.equal(selectedOnly.objects[0].type, 'link');
  assert.equal(selectedOnly.objects[1].actionLink, undefined);
  assert.deepEqual(selectedOnly.objects[2].actionLink, { type: 'web', url: 'https://three.example' });
});

test('Area selection maps rendered canvas coordinates to PDF page coordinates', () => {
  const cleanup = require(path.join(root, 'js', 'pdf_link_cleanup.js'));
  assert.deepEqual(
    cleanup.canvasAreaToPageArea(
      { x0: 600, y0: 400, x1: 200, y1: 100 },
      { width: 800, height: 1000 },
      { width: 400, height: 500 }
    ),
    { x0: 100, y0: 50, x1: 300, y1: 200 }
  );
  assert.throws(
    () => cleanup.canvasAreaToPageArea({ x0: 0, y0: 0, x1: 10, y1: 10 }, { width: 0, height: 10 }, { width: 10, height: 10 }),
    /canvas size/i
  );
});

test('Python link bridge scans requested pages and rejects an invalid cleanup result', async () => {
  const context = {
    window: { PDFLinkCleanup: { PYTHON_SOURCE: 'def scan_pdf_links(*args): pass\ndef remove_pdf_links(*args): pass' } },
    console, Uint8Array, ArrayBuffer, JSON, Object, Promise
  };
  vm.runInNewContext(read('js/python_manager.js'), context, { filename: 'python_manager.js' });
  const manager = context.window.PythonManager;
  manager.isLoaded = true;
  manager.run = async (_code, globals) => {
    assert.equal(globals.js_pages, '[0,2]');
    return JSON.stringify([{ id: '0:10', pageIndex: 0, xref: 10 }]);
  };
  const links = await manager.extractLinksWithPreview(new ArrayBuffer(16), [0, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(links)), [{ id: '0:10', pageIndex: 0, xref: 10 }]);

  manager.run = async () => null;
  await assert.rejects(
    () => manager.deleteLinks(new ArrayBuffer(16), links, false),
    /valid PDF buffer/i
  );
});

test('Committing PDF link cleanup updates the canonical source and preserves live form values', () => {
  const context = {
    window: { app: {} }, console, Uint8Array, ArrayBuffer, JSON, Object,
    document: { querySelectorAll: () => [] },
    PythonManager: {}, PDFLinkCleanup: {}
  };
  vm.runInNewContext(read('js/app.pdf_ops.js'), context, { filename: 'app.pdf_ops.js' });
  const app = context.window.app;
  const oldBuffer = Uint8Array.from([1, 2, 3]).buffer;
  const newBuffer = Uint8Array.from([9, 8, 7]).buffer;
  const activePage = {
    sourceId: 'source', pageIndex: 0, nativeFormValues: {},
    objects: [{ id: 'field', fromFormField: true, nativeFieldName: 'nombre', fieldType: 'text', textValue: 'CAMBIO' }]
  };
  const otherPage = { sourceId: 'source', pageIndex: 1, objects: [] };
  const doc = {
    currentIndex: 0,
    pages: [activePage, otherPage],
    sources: { source: { buffer: oldBuffer, originalBuffer: oldBuffer, doc: { cached: true } } }
  };
  let synced = 0;
  let snapshots = 0;
  Object.assign(app, {
    getDoc: () => doc,
    _syncNativeOverlayValuesForSave(pages, page) {
      synced += 1;
      assert.strictEqual(page, activePage);
      page.nativeFormValues.nombre = { kind: 'text', value: page.objects[0].textValue };
    },
    saveState() { snapshots += 1; }
  });

  app._commitPdfLinkCleanup(doc, new Map([['source', newBuffer]]), new Set(['source:0']));
  assert.equal(synced, 1);
  assert.equal(snapshots, 1);
  assert.strictEqual(doc.sources.source.buffer, newBuffer);
  assert.strictEqual(doc.sources.source.originalBuffer, newBuffer);
  assert.equal(doc.sources.source.doc, null);
  assert.deepEqual(JSON.parse(JSON.stringify(activePage.nativeFormValues)), { nombre: { kind: 'text', value: 'CAMBIO' } });
  assert.equal(activePage._thumbCache, null);
  assert.notEqual(otherPage._thumbCache, null);
});

test('Document link scan plan covers every displayed source page exactly once', () => {
  const cleanup = require(path.join(root, 'js', 'pdf_link_cleanup.js'));
  const bufferA = Uint8Array.from([1]).buffer;
  const canonicalA = Uint8Array.from([2]).buffer;
  const bufferB = Uint8Array.from([3]).buffer;
  const doc = {
    pages: [
      { sourceId: 'a', pageIndex: 2 },
      { sourceId: 'b', pageIndex: 0 },
      { sourceId: 'a', pageIndex: 0 },
      { sourceId: 'a', pageIndex: 2 }
    ],
    sources: {
      a: { buffer: bufferA, originalBuffer: canonicalA },
      b: { buffer: bufferB }
    }
  };
  const plan = cleanup.buildSourceScanPlan(doc);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].sourceId, 'a');
  assert.strictEqual(plan[0].buffer, canonicalA);
  assert.deepEqual(plan[0].pageIndexes, [0, 2]);
  assert.equal(plan[1].sourceId, 'b');
  assert.strictEqual(plan[1].buffer, bufferB);
  assert.deepEqual(plan[1].pageIndexes, [0]);
});

test('Stamp and area-link controls are translated in every supported locale', () => {
  const context = {
    window: { app: {}, dispatchEvent() {} },
    document: {
      documentElement: {},
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    localStorage: { getItem() { return 'es'; }, setItem() {} },
    CustomEvent: class {}, console
  };
  vm.runInNewContext(read('js/i18n.js'), context, { filename: 'i18n.js' });
  const required = [
    'btn_remove_stamps', 'btn_remove_links_area', 'tit_remove_stamps', 'tit_remove_links_area',
    'remove_stamps_title', 'remove_links_area_title', 'remove_links_apply', 'remove_stamps_done',
    'remove_links_area_done', 'remove_links_area_empty'
  ];
  for (const [locale, messages] of Object.entries(context.window.i18n.languages)) {
    for (const key of required) assert.ok(messages[key], `${locale} is missing ${key}`);
  }
});
