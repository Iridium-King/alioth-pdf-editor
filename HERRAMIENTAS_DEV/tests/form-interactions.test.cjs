const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function loadModules(relativePaths, options = {}) {
  const elements = options.elements || {};
  const canvasContext = {
    font: '12px Arial',
    measureText(value) {
      const size = Number.parseFloat(this.font) || 12;
      return { width: [...String(value)].length * size * 0.55 };
    }
  };
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    createElement: tag => tag === 'canvas'
      ? { getContext: () => canvasContext }
      : { style: {}, classList: { add() {}, remove() {} } },
    ...options.document
  };
  const window = {
    app: {},
    getComputedStyle: input => ({
      paddingLeft: input.paddingLeft || '0',
      paddingRight: input.paddingRight || '0',
      paddingTop: input.paddingTop || '0',
      paddingBottom: input.paddingBottom || '0',
      borderLeftWidth: input.borderLeftWidth || '0',
      borderRightWidth: input.borderRightWidth || '0',
      borderTopWidth: input.borderTopWidth || '0',
      borderBottomWidth: input.borderBottomWidth || '0'
    }),
    ...options.window
  };
  const context = {
    window,
    document,
    console,
    ArrayBuffer,
    Uint8Array,
    JSON,
    Math,
    Date,
    Map,
    Set,
    Promise,
    Object,
    parseInt,
    parseFloat,
    setTimeout,
    clearTimeout,
    ...options.globals
  };
  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    vm.runInNewContext(`(function () {\n${source}\n})();`, context, { filename: relativePath });
  }
  return { app: window.app, document, window };
}

function valueElement(value = '', checked = false) {
  return { value, checked, style: {}, classList: { add() {}, remove() {} } };
}

test('field highlight color is validated, persisted, and restored without document changes', () => {
  const values = new Map([['alioth-form-field-highlight-color', '#2f80ed']]);
  const cssValues = {};
  const { app } = loadModules(['js/app.annotations.js'], {
    document: { documentElement: { style: { setProperty: (name, value) => { cssValues[name] = value; } } } },
    globals: {
      localStorage: {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
      }
    }
  });
  let renders = 0;
  app.renderOverlays = () => { renders += 1; };

  assert.equal(app.restoreFormFieldHighlightColor(), '#2f80ed');
  assert.equal(cssValues['--form-field-highlight-color'], '#2f80ed');
  assert.equal(app.setFormFieldHighlightColor('invalid'), '#f59e0b');
  assert.equal(values.get('alioth-form-field-highlight-color'), '#f59e0b');
  assert.equal(renders, 2);
});

test('a pending signature stays out of the document until one bounded placement commits it', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const page = { width: 300, height: 200, objects: [] };
  const doc = { id: 'doc-1', currentIndex: 0, pages: [page] };
  let saves = 0;
  app.getDoc = () => doc;
  app.saveState = () => { saves += 1; };
  app.renderOverlays = app.renderSidebar = () => {};

  assert.equal(app.beginPendingSignature({ dataURL: 'data:image/png;base64,AA==', name: 'Aprobación' }), true);
  assert.equal(page.objects.length, 0);
  assert.equal(app.placePendingSignature({ x: 4, y: 3, width: 300, height: 200 }, 'doc-1', 0), true);
  assert.equal(page.objects.length, 1);
  assert.equal(saves, 1);
  assert.equal(page.objects[0].x, 0);
  assert.equal(page.objects[0].y, 0);
  assert.equal(app.placePendingSignature({ x: 150, y: 100, width: 300, height: 200 }, 'doc-1', 0), false);
});

test('changing form tools cancels a pending signature before changing the cursor', () => {
  const { app } = loadModules(['js/app.annotations.js'], {
    document: { body: { style: {} }, querySelectorAll: () => [] }
  });
  let cancellations = 0;
  app.cancelPendingSignature = () => { cancellations += 1; };
  app.showToast = () => {};

  app.setFormTool('text');

  assert.equal(cancellations, 1);
  assert.equal(app.currentFormTool, 'text');
});

test('auto-size remains automatic in the model when properties are applied', () => {
  const elements = {
    'prop-field-text': valueElement('Texto largo con acentos: información útil'),
    'prop-text-font': valueElement('Arial'),
    'prop-text-size': valueElement('18'),
    'prop-text-align': valueElement('left'),
    'prop-text-auto-size': valueElement('', true),
    'prop-text-multiline': valueElement('', true),
    'prop-text-columns': valueElement('', false),
    'prop-text-bold': valueElement('', false),
    'prop-text-italic': valueElement('', false)
  };
  const { app } = loadModules(['js/app.annotations.js'], { elements });
  const field = { id: 'field-1', type: 'form-field', fieldType: 'text', fontSize: 12, autoSize: false };
  app.selectedObj = field;
  app.multiObjectSelection = new Set([field.id]);
  app.getDoc = () => ({ currentIndex: 0, pages: [{ objects: [field] }] });
  app.renderOverlays = app.renderSidebar = app.saveState = app.closeAllModals = app.showToast = () => {};

  app.applyProperties();

  assert.equal(field.autoSize, true);
  assert.equal(field.fontSize, 0);
});

test('preview uses the stored fixed size and shrinks automatic text using inner dimensions', () => {
  const { app } = loadModules(['js/app.render.js']);
  const fixedInput = { value: 'Fijo', style: {} };
  app._applyNativeFieldPreviewStyle(fixedInput, { fontSize: 11, autoSize: false }, 2);
  assert.equal(fixedInput.style.fontSize, '22px');

  const autoInput = {
    value: 'Texto bastante largo que debe ajustarse',
    style: {},
    clientWidth: 100,
    clientHeight: 24,
    paddingLeft: '4', paddingRight: '4', paddingTop: '2', paddingBottom: '2',
    borderLeftWidth: '1', borderRightWidth: '1', borderTopWidth: '1', borderBottomWidth: '1'
  };
  const large = app._getFormFieldPreviewFontSize({ width: 100, height: 24, autoSize: true }, 1, autoInput.value, autoInput);
  const small = app._getFormFieldPreviewFontSize({ width: 48, height: 18, autoSize: true }, 1, autoInput.value);
  assert.ok(large > small);
  assert.ok(large <= 18);
});

test('repeated native names resolve to their own widget identity', () => {
  const { app } = loadModules(['js/app.render.js']);
  const annotations = [
    { id: '10R', subtype: 'Widget', fieldName: 'persona' },
    { id: '11R', subtype: 'Widget', fieldName: 'persona' }
  ];
  const overlays = [
    { id: 'one', fromFormField: true, nativeFieldName: 'persona', nativeWidgetIndex: 0 },
    { id: 'two', fromFormField: true, nativeFieldName: 'persona', nativeWidgetIndex: 1 }
  ];
  const page = { objects: overlays };

  assert.equal(app._findNativeFieldOverlay(page, annotations[0], annotations), overlays[0]);
  assert.equal(app._findNativeFieldOverlay(page, annotations[1], annotations), overlays[1]);
});

test('native-field detection neither bypasses the edit toggle nor restores suppressed fields', async () => {
  const editSwitch = valueElement('', false);
  const page = {
    sourceId: 'source',
    objects: [],
    deletedNativeFields: ['suprimido']
  };
  const { app } = loadModules(['js/app.annotations.js'], {
    elements: { 'switch-edit-fields': editSwitch },
    globals: {
      PythonManager: {
        isLoaded: true,
        analyzePage: async () => ({ widgets: [
          { name: 'suprimido', type: 'text', rect: [0, 0, 100, 20], value: '' },
          { name: 'activo', type: 'text', rect: [0, 30, 100, 50], value: '' }
        ] })
      }
    }
  });
  app.isFieldEditMode = false;
  app.getDoc = () => ({ currentIndex: 0, pages: [page], sources: { source: { buffer: new ArrayBuffer(2) } } });
  app.splitView = { activePanel: 'primary' };
  app.currentTab = 'form';
  app.getPanelElements = () => ({ annotationLayer: { style: {} } });
  app.showToast = app.renderOverlays = app.setupInteractDraggables = () => {};

  await app.detectNativeFields();

  assert.deepEqual(page.objects.map(object => object.nativeFieldName), ['activo']);
  assert.equal(app.isFieldEditMode, false);
  assert.equal(editSwitch.checked, false);
});

test('the edit toggle can cycle three times and fully clears structural state when off', async () => {
  const editSwitch = valueElement('', false);
  const annotationLayer = { style: {} };
  const mainView = { querySelectorAll: () => [] };
  const field = { id: 'native-1', type: 'form-field', fieldType: 'text', fromFormField: true, nativeFieldName: 'nombre', textValue: 'A' };
  const page = { sourceId: 'source', objects: [field], nativeFieldOverlaysDetected: true, nativeFormValues: {} };
  const { app } = loadModules(['js/app.annotations.js'], {
    elements: {
      'switch-edit-fields': editSwitch,
      mainViewPrimary: mainView
    }
  });
  app.getDoc = () => ({ currentIndex: 0, pages: [page], sources: { source: { buffer: new ArrayBuffer(2) } } });
  app.splitView = { activePanel: 'primary' };
  app.getPanelElements = () => ({ annotationLayer });
  app.multiObjectSelection = new Set();
  app.loadPage = async () => {};
  app.renderOverlays = app.setupInteractDraggables = app.saveState = app.showToast = () => {};
  let marqueeSetups = 0;
  let marqueeCleanups = 0;
  app._setupBoxSelectDrag = () => {
    marqueeSetups += 1;
    app._boxSelectCleanup = () => { marqueeCleanups += 1; };
  };

  for (let cycle = 0; cycle < 3; cycle += 1) {
    editSwitch.checked = true;
    await app.toggleFormFieldEdit();
    assert.equal(app.isFieldEditMode, true);
    assert.equal(annotationLayer.style.display, 'none');
    assert.equal(marqueeSetups, cycle + 1);

    app.selectedObj = field;
    app.multiObjectSelection.add(field.id);
    editSwitch.checked = false;
    await app.toggleFormFieldEdit();
    assert.equal(app.isFieldEditMode, false);
    assert.equal(annotationLayer.style.display, 'block');
    assert.equal(app.selectedObj, null);
    assert.equal(app.multiObjectSelection.has(field.id), false);
    assert.equal(marqueeCleanups, cycle + 1);
  }
});

test('re-rendering a native input does not accumulate value listeners', async () => {
  let currentInput = null;
  const createdInputs = [];
  const section = { dataset: { annotationId: '10R' }, style: {} };
  const makeInput = () => {
    const listeners = {};
    const input = {
      type: 'text', value: '', style: {}, clientWidth: 100, clientHeight: 20,
      closest: () => section,
      addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
      listeners
    };
    createdInputs.push(input);
    return input;
  };
  const annotationLayer = {
    style: {},
    addEventListener() {},
    set innerHTML(value) { if (value === '') currentInput = null; },
    get innerHTML() { return ''; },
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return currentInput ? [currentInput] : [];
      return [];
    }
  };
  class AnnotationLayer {
    async render() { currentInput = makeInput(); }
    static render() { currentInput = makeInput(); }
  }
  const annotation = { id: '10R', subtype: 'Widget', fieldName: 'nombre', fieldType: 'Tx', fieldValue: '' };
  const { app } = loadModules(['js/app.render.js'], {
    globals: { pdfjsViewer: { AnnotationLayer } }
  });
  app.isFieldEditMode = false;
  let stored = 0;
  app.storeAnnotationValue = () => { stored += 1; };
  const pageData = {
    nativeFieldOverlaysDetected: true,
    objects: [{ fromFormField: true, nativeAnnotationId: '10R', nativeFieldName: 'nombre', fontSize: 10, autoSize: false, x: 0, y: 0, width: 100, height: 20 }],
    nativeFormValues: {}
  };
  const page = { getAnnotations: async () => [annotation] };
  const viewport = { width: 100, height: 20, scale: 1, clone: () => viewport };

  await app.renderAnnotationLayer(page, viewport, { annotationLayer }, 'primary', pageData);
  await app.renderAnnotationLayer(page, viewport, { annotationLayer }, 'primary', pageData);

  assert.equal(createdInputs.length, 2);
  assert.deepEqual(createdInputs.map(input => input.listeners.input.length), [1, 1]);
  currentInput.value = 'Cambio';
  currentInput.listeners.input[0]();
  assert.equal(stored, 1);
});

test('a native choice field keeps the PDF value on its first render', async () => {
  let currentInput = null;
  const section = { dataset: { annotationId: '20R' }, style: {} };
  const annotationLayer = {
    style: {},
    addEventListener() {},
    set innerHTML(value) { if (value === '') currentInput = null; },
    get innerHTML() { return ''; },
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return currentInput ? [currentInput] : [];
      return [];
    }
  };
  class AnnotationLayer {
    async render() {
      currentInput = {
        type: 'select-one', value: 'Uno', style: {}, clientWidth: 100, clientHeight: 20,
        closest: () => section,
        addEventListener() {}
      };
    }
  }
  const annotation = {
    id: '20R', subtype: 'Widget', fieldName: 'lista', fieldType: 'Ch', fieldValue: 'Dos'
  };
  const { app } = loadModules(['js/app.render.js'], {
    globals: { pdfjsViewer: { AnnotationLayer } }
  });
  app.isFieldEditMode = false;
  app.storeAnnotationValue = () => {};

  await app.renderAnnotationLayer(
    { getAnnotations: async () => [annotation] },
    { width: 100, height: 20, scale: 1, clone() { return this; } },
    { annotationLayer },
    'primary',
    { nativeFieldOverlaysDetected: false, objects: [], nativeFormValues: {} }
  );

  assert.equal(currentInput.value, 'Dos');
});

test('PDF.js choice arrays normalize to one selected value', () => {
  const { app } = loadModules(['js/app.render.js']);

  assert.equal(app._resolveNativeChoiceValue(undefined, ['Dos']), 'Dos');
  assert.equal(app._resolveNativeChoiceValue('Uno', ['Dos']), 'Uno');
});

test('a residual native-field selection cannot move or resize while design mode is off', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const field = { id: 'native-1', fromFormField: true, x: 10, y: 20, width: 80, height: 18 };
  app.isFieldEditMode = false;
  app.selectedObj = field;
  app.multiObjectSelection = new Set([field.id]);
  app.getDoc = () => ({ currentIndex: 0, pages: [{ objects: [field] }] });
  app.renderOverlays = app.renderSidebar = app.saveStateDebounced = () => {};

  app.moveSelectedObjects(5, 7);
  app.resizeSelectedObjects('w', 20);

  assert.deepEqual({ x: field.x, y: field.y, width: field.width }, { x: 10, y: 20, width: 80 });
});

test('field marquee selects only intersecting form fields on the supplied page', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const page = {
    rotation: 90,
    objects: [
      { id: 'field-a', fromFormField: true, x: 0, y: 0, width: 20, height: 20 },
      { id: 'field-b', fromFormField: true, x: 30, y: 0, width: 20, height: 20 },
      { id: 'image', type: 'image', x: 15, y: 0, width: 20, height: 20 },
      { id: 'text', type: 'text', x: 15, y: 0, width: 20, height: 20 }
    ]
  };
  app.multiObjectSelection = new Set(['stale']);
  app.selectedObj = null;
  let saves = 0;
  app.saveState = () => { saves += 1; };

  const selected = app.applyFormFieldMarqueeSelection(
    page,
    { left: 15, top: 2, right: 35, bottom: 18 },
    { append: false }
  );

  assert.deepEqual([...app.multiObjectSelection].sort(), ['field-a', 'field-b']);
  assert.equal(app.selectedObj.id, 'field-a');
  assert.equal(selected, 2);
  assert.equal(saves, 0);
});

test('Shift marquee unions prior fields and geometry stays stable across zoom and rotation', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const page = {
    objects: [
      { id: 'field-a', fromFormField: true, x: 5, y: 5, width: 10, height: 10 },
      { id: 'field-b', fromFormField: true, x: 20, y: 5, width: 10, height: 10 }
    ]
  };

  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [0.5, 1, 2]) {
      page.rotation = rotation;
      app.multiObjectSelection = new Set(['field-a']);
      app.selectedObj = page.objects[0];
      const rect = app.normalizeMarqueeRect(
        { x: 31 * scale, y: 16 * scale },
        { x: 19 * scale, y: 4 * scale },
        scale
      );
      app.applyFormFieldMarqueeSelection(page, rect, { append: true });
      assert.deepEqual([...app.multiObjectSelection].sort(), ['field-a', 'field-b']);
    }
  }
});

test('viewport rectangles select rotated fields by their rendered boxes', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const page = {
    rotation: 90,
    objects: [
      { id: 'field-a', fromFormField: true, x: 5, y: 5, width: 10, height: 10 },
      { id: 'field-b', fromFormField: true, x: 20, y: 5, width: 10, height: 10 }
    ]
  };
  app.multiObjectSelection = new Set();
  app.selectedObj = null;
  const elementRects = new Map([
    ['field-a', { left: 100, top: 100, right: 110, bottom: 110 }],
    ['field-b', { left: 120, top: 100, right: 130, bottom: 110 }]
  ]);

  app.applyFormFieldMarqueeSelection(
    page,
    { left: 118, top: 98, right: 132, bottom: 112 },
    { elementRects }
  );

  assert.deepEqual([...app.multiObjectSelection], ['field-b']);
});

test('field marquee requires four CSS pixels and Ctrl click toggles a field', () => {
  const classes = new Set(['draggable']);
  const el = {
    id: 'field-a',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name))
    }
  };
  const { app } = loadModules(['js/app.tools.js'], {
    document: {
      querySelectorAll: selector => selector.includes('.draggable') ? [el] : []
    }
  });
  assert.equal(app.isMarqueeDrag({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
  assert.equal(app.isMarqueeDrag({ x: 0, y: 0 }, { x: 4, y: 0 }), true);

  const field = { id: 'field-a', fromFormField: true };
  app.multiObjectSelection = new Set();
  app.selectedObj = null;
  app.getDoc = () => ({ currentIndex: 0, pages: [{ objects: [field] }] });
  app.syncToolbar = () => {};
  app.handleObjectSelection({ ctrlKey: true, metaKey: false, shiftKey: false }, field, el);
  assert.deepEqual([...app.multiObjectSelection], ['field-a']);
  assert.equal(classes.has('selected'), true);
  app.handleObjectSelection({ ctrlKey: true, metaKey: false, shiftKey: false }, field, el);
  assert.deepEqual([...app.multiObjectSelection], []);
  assert.equal(classes.has('selected'), false);
});

test('edit mode starts a pointer marquee on empty space and keeps the mode active', () => {
  const listeners = {};
  const elements = {};
  let capturedPointer = null;
  const overlay = {
    id: 'overlay-layer',
    appendChild(element) { elements[element.id] = element; },
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    setPointerCapture(pointerId) { capturedPointer = pointerId; }
  };
  elements['overlay-layer'] = overlay;
  elements['btn-box-select'] = { classList: { add() {}, remove() {} } };
  const target = {
    closest(selector) {
      if (selector === '.draggable') return null;
      if (selector === '[id^="overlay-layer"]' || selector === '.canvas-container') return overlay;
      return null;
    }
  };
  const page = {
    objects: [
      { id: 'field-a', fromFormField: true, x: 5, y: 5, width: 10, height: 10 },
      { id: 'field-b', fromFormField: true, x: 20, y: 5, width: 10, height: 10 },
      { id: 'image', type: 'image', x: 20, y: 5, width: 10, height: 10 }
    ]
  };
  const { app } = loadModules(['js/app.tools.js', 'js/app.ui.js'], {
    elements,
    document: {
      createElement: () => ({ id: '', className: '', style: {}, remove() { delete elements[this.id]; } }),
      addEventListener(type, handler) { listeners[type] = handler; },
      removeEventListener(type, handler) { if (listeners[type] === handler) delete listeners[type]; },
      querySelectorAll: () => []
    }
  });
  app.isFieldEditMode = true;
  app.isBoxSelectMode = false;
  app.splitView = { activePanel: 'primary', primary: { docId: 'doc', scale: 2 } };
  app.docs = [{ id: 'doc', currentIndex: 0, pages: [page] }];
  app.multiObjectSelection = new Set(['field-a']);
  app.selectedObj = page.objects[0];
  app.showToast = app.syncToolbar = () => {};
  let renders = 0;
  let saves = 0;
  app.renderOverlays = () => { renders += 1; };
  app.saveState = () => { saves += 1; };

  app._setupBoxSelectDrag();
  assert.equal(typeof listeners.pointerdown, 'function');
  listeners.pointerdown({ button: 0, pointerId: 7, clientX: 138, clientY: 58, shiftKey: true, target, preventDefault() {}, stopPropagation() {} });
  listeners.pointermove({ pointerId: 7, clientX: 162, clientY: 82 });
  listeners.pointerup({ pointerId: 7 });

  assert.equal(capturedPointer, 7);
  assert.deepEqual([...app.multiObjectSelection].sort(), ['field-a', 'field-b']);
  assert.equal(app.isFieldEditMode, true);
  assert.equal(app.isBoxSelectMode, false);
  assert.equal(renders, 1);
  assert.equal(saves, 0);
});

test('pointer cancellation restores the selection that existed before marquee', () => {
  const listeners = {};
  const elements = {};
  const overlay = {
    id: 'overlay-layer',
    appendChild(element) { elements[element.id] = element; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {}
  };
  elements['overlay-layer'] = overlay;
  const target = { closest: selector => selector === '.draggable' ? null : overlay };
  const field = { id: 'field-a', fromFormField: true, x: 0, y: 0, width: 10, height: 10 };
  const { app } = loadModules(['js/app.tools.js', 'js/app.ui.js'], {
    elements,
    document: {
      createElement: () => ({ id: '', className: '', style: {}, remove() { delete elements[this.id]; } }),
      addEventListener(type, handler) { listeners[type] = handler; },
      removeEventListener(type, handler) { if (listeners[type] === handler) delete listeners[type]; },
      querySelectorAll: () => []
    }
  });
  app.isFieldEditMode = true;
  app.splitView = { activePanel: 'primary', primary: { docId: 'doc', scale: 1 } };
  app.docs = [{ id: 'doc', currentIndex: 0, pages: [{ objects: [field] }] }];
  app.multiObjectSelection = new Set(['field-a']);
  app.selectedObj = field;
  app.showToast = app.syncToolbar = app.renderOverlays = () => {};

  app._setupBoxSelectDrag();
  listeners.pointerdown({ button: 0, pointerId: 2, clientX: 20, clientY: 20, shiftKey: false, target, preventDefault() {}, stopPropagation() {} });
  listeners.pointermove({ pointerId: 2, clientX: 40, clientY: 40 });
  listeners.pointercancel({ pointerId: 2 });

  assert.deepEqual([...app.multiObjectSelection], ['field-a']);
  assert.equal(app.selectedObj, field);
  assert.equal(elements['box-select-rect'], undefined);
});

test('adaptive field nudge uses the specified median thresholds and one undo per key hold', () => {
  const { app } = loadModules(['js/app.tools.js']);
  assert.equal(app.getFieldNudgeStep([{ width: 12, height: 40 }], false), 0.1);
  assert.equal(app.getFieldNudgeStep([{ width: 12.01, height: 40 }], false), 0.3);
  assert.equal(app.getFieldNudgeStep([{ width: 36, height: 40 }], false), 0.3);
  assert.equal(app.getFieldNudgeStep([{ width: 36.01, height: 40 }], false), 0.5);
  assert.equal(app.getFieldNudgeStep([{ width: 8, height: 20 }, { width: 30, height: 40 }], false), 0.3);
  assert.equal(app.getFieldNudgeStep([{ width: 8, height: 20 }, { width: 10, height: 30 }, { width: 40, height: 60 }], false), 0.1);
  assert.equal(app.getFieldNudgeStep([{ width: 12, height: 40 }], true), 1);

  const fields = [
    { id: 'a', fromFormField: true, x: 10, y: 10, width: 12, height: 20 },
    { id: 'b', fromFormField: true, x: 30, y: 10, width: 12, height: 20 }
  ];
  const page = { width: 60, height: 60, objects: fields };
  app.isFieldEditMode = true;
  app.selectedObj = fields[0];
  app.multiObjectSelection = new Set(['a', 'b']);
  app.getDoc = () => ({ id: 'doc', currentIndex: 0, pages: [page] });
  let undoSnapshots = 0;
  app.saveState = () => { undoSnapshots += 1; };
  app.renderOverlays = app.syncToolbar = () => {};

  for (let repeat = 0; repeat < 10; repeat += 1) app.nudgeSelectedFields('ArrowRight', false);
  assert.equal(undoSnapshots, 1);
  assert.ok(Math.abs(fields[0].x - 11) < 1e-9);
  assert.ok(Math.abs(fields[1].x - 31) < 1e-9);
  app.endFieldNudgeSession();

  fields[0].x = 40;
  fields[1].x = 48;
  app.nudgeSelectedFields('ArrowRight', true);
  assert.equal(fields[0].x, 40);
  assert.equal(fields[1].x, 48);
});

test('arrow navigation installs one handler pair and leaves editable controls alone', () => {
  const listeners = { keydown: [], keyup: [] };
  const windowListeners = {};
  const editable = { tagName: 'INPUT', contentEditable: 'false' };
  const { app } = loadModules(['js/app.core.js'], {
    document: {
      activeElement: editable,
      addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
      removeEventListener(type, handler) { listeners[type] = (listeners[type] || []).filter(item => item !== handler); },
      getElementById: () => ({ style: {} })
    },
    window: {
      addEventListener(type, handler) { windowListeners[type] = handler; },
      removeEventListener(type, handler) { if (windowListeners[type] === handler) delete windowListeners[type]; }
    },
    globals: { location: { href: 'http://127.0.0.1/BASE.html' } }
  });
  app.setupEscapeHandler();
  app.setupEscapeHandler();
  assert.equal(listeners.keydown.length, 2);
  assert.equal(listeners.keyup.length, 1);
  let nudges = 0;
  app.getDoc = () => ({ pages: [{}], currentIndex: 0 });
  app.isFieldEditMode = true;
  app.selectedObj = { id: 'field', fromFormField: true };
  app.multiObjectSelection = new Set(['field']);
  app.nudgeSelectedFields = () => { nudges += 1; return true; };
  const preventDefault = () => { throw new Error('editable controls must not be captured'); };
  listeners.keydown[1]({ key: 'ArrowLeft', target: editable, preventDefault, isComposing: false });
  assert.equal(nudges, 0);
});

test('field alignment plans independent rows and columns without changing sizes', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const fields = [
    { id: 'a', fromFormField: true, x: 10, y: 10, width: 20, height: 10 },
    { id: 'b', fromFormField: true, x: 60, y: 11, width: 20, height: 10 },
    { id: 'c', fromFormField: true, x: 11, y: 40, width: 20, height: 10 },
    { id: 'd', fromFormField: true, x: 61, y: 41, width: 20, height: 10 }
  ];
  const horizontal = app.planFieldAlignment(fields, 'horizontal');
  assert.equal(horizontal.ok, true);
  assert.deepEqual(horizontal.moves.map(move => [move.id, move.x, move.y]), [
    ['a', 10, 10.5], ['b', 60, 10.5], ['c', 11, 40.5], ['d', 61, 40.5]
  ]);
  const vertical = app.planFieldAlignment(fields, 'vertical');
  assert.equal(vertical.ok, true);
  assert.deepEqual(vertical.moves.map(move => [move.id, move.x, move.y]), [
    ['a', 10.5, 10], ['b', 60.5, 11], ['c', 10.5, 40], ['d', 60.5, 41]
  ]);
});

test('field alignment rejects mixed objects and an unpaired outlier', () => {
  const { app } = loadModules(['js/app.tools.js']);
  assert.equal(app.planFieldAlignment([
    { id: 'field', fromFormField: true, x: 10, y: 10, width: 20, height: 10 },
    { id: 'text', type: 'text', x: 40, y: 10, width: 20, height: 10 }
  ], 'horizontal').ok, false);
  assert.equal(app.planFieldAlignment([
    { id: 'a', fromFormField: true, x: 10, y: 10, width: 20, height: 10 },
    { id: 'b', fromFormField: true, x: 60, y: 11, width: 20, height: 10 },
    { id: 'outlier', fromFormField: true, x: 10, y: 80, width: 20, height: 10 }
  ], 'horizontal').ok, false);
});

test('equal field size uses the stable first selected field as anchor', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const fields = [
    { id: 'anchor', fromFormField: true, x: 1, y: 2, width: 24, height: 10 },
    { id: 'small', fromFormField: true, x: 5, y: 6, width: 12, height: 20 },
    { id: 'wide', fromFormField: true, x: 9, y: 10, width: 40, height: 30 }
  ];
  const plan = app.planEqualFieldSize(fields, 'width', 'anchor', { width: 80, height: 80 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.moves.map(move => [move.id, move.width, move.height]), [
    ['anchor', 24, 10], ['small', 24, 20], ['wide', 24, 30]
  ]);
  assert.equal(app.planEqualFieldSize([fields[0]], 'height', 'anchor', { width: 80, height: 80 }).ok, false);
});

test('equal selected field size applies one undo only in field edit mode', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const fields = [
    { id: 'anchor', fromFormField: true, x: 1, y: 2, width: 24, height: 10 },
    { id: 'other', fromFormField: true, x: 5, y: 6, width: 12, height: 20 }
  ];
  app.isFieldEditMode = true;
  app.multiObjectSelection = new Set(['anchor', 'other']);
  app.getDoc = () => ({ currentIndex: 0, pages: [{ width: 80, height: 80, objects: fields }] });
  let saves = 0;
  app.saveState = () => { saves += 1; };
  app.renderOverlays = app.showToast = () => {};
  assert.equal(app.equalSelectedFieldSize('width'), true);
  assert.equal(fields[1].width, 24);
  assert.equal(saves, 1);
});

test('field grid plans five fields in two rows without overlap', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const fields = [
    { id: 'a', fromFormField: true, x: 10, y: 10, width: 10, height: 10 },
    { id: 'b', fromFormField: true, x: 30, y: 10, width: 10, height: 10 },
    { id: 'c', fromFormField: true, x: 50, y: 10, width: 10, height: 10 },
    { id: 'd', fromFormField: true, x: 10, y: 40, width: 10, height: 10 },
    { id: 'e', fromFormField: true, x: 30, y: 40, width: 10, height: 10 }
  ];
  const plan = app.planFieldGrid(fields, 2);
  assert.equal(plan.ok, true);
  assert.equal(plan.columns, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.moves.map(move => [move.id, move.x, move.y]))), [
    ['a', 10, 10], ['b', 30, 10], ['c', 50, 10], ['d', 10, 40], ['e', 30, 40]
  ]);
});

test('applying a field grid saves once', () => {
  const { app } = loadModules(['js/app.tools.js']);
  const fields = [
    { id: 'a', fromFormField: true, x: 10, y: 10, width: 10, height: 10 },
    { id: 'b', fromFormField: true, x: 30, y: 10, width: 10, height: 10 }
  ];
  app.isFieldEditMode = true;
  app.multiObjectSelection = new Set(['a', 'b']);
  app.getDoc = () => ({ currentIndex: 0, pages: [{ objects: fields }] });
  let saves = 0;
  app.saveState = () => { saves += 1; };
  app.renderOverlays = app.showToast = () => {};
  assert.equal(app.applySelectedFieldGrid(1), true);
  assert.equal(saves, 1);
});
