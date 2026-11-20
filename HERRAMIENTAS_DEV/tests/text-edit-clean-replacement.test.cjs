const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

test('app.pdf_ops guarantees pre-commit splice with fallback to eraseTextRegion', () => {
    const pdfOpsPath = path.join(root, 'js', 'app.pdf_ops.js');
    const content = fs.readFileSync(pdfOpsPath, 'utf8');

    // 1. Debe intentar removeTextSpans antes de caer al borrado
    assert.ok(content.includes('PythonManager.removeTextSpans'), 'debe intentar splice quirurgico con removeTextSpans');

    // 2. Debe tener red de seguridad garantizada con eraseTextRegion si !_didSplice
    assert.ok(content.includes('!_didSplice && this._pendingEraseRect'), 'debe ejecutar eraseTextRegion como fallback si el splice fallo o no aplico');
    assert.ok(content.includes('PythonManager.eraseTextRegion'), 'debe llamar a PythonManager.eraseTextRegion en el fallback');

    // 3. Debe pasar eraseBgColor y targetSpans a editData
    assert.ok(content.includes('eraseBgColor: data.bgColor'), 'debe enviar eraseBgColor a Python con el fondo detectado');
    assert.ok(content.includes('targetSpans: data.targetSpans'), 'debe propagar targetSpans para soportar bloques/parrafos');
    assert.ok(content.includes('skipErase: _didSplice'), 'skipErase debe reflejar fielmente si el splice fue exitoso');
});

test('python_manager draw_rect is guaranteed in surgical fallback', () => {
    const pyManagerPath = path.join(root, 'js', 'python_manager.js');
    const content = fs.readFileSync(pyManagerPath, 'utf8');

    // 1. is_surgical debe verificar not _skip_erase
    assert.ok(content.includes('if is_surgical and not _skip_erase:'), 'el bloque quirurgico debe estar condicionado a not _skip_erase');

    // 2. En _spans_inside_x debe llamar a page.draw_rect para garantizar borrado visual
    assert.ok(content.includes('page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)'), 'debe llamar a draw_rect con rgb_bg');

    // 3. Debe resolver _erase_bg_hex usando eraseBgColor
    assert.ok(content.includes('_erase_bg_hex = edit.get(\'eraseBgColor\')'), 'debe resolver _erase_bg_hex desde eraseBgColor');
});

test('app.tools stores targetSpans for multi-span paragraph blocks', () => {
    const toolsPath = path.join(root, 'js', 'app.tools.js');
    const content = fs.readFileSync(toolsPath, 'utf8');

    assert.ok(content.includes('this.smartPatchData.targetSpans = _validSpans.map'), 'debe guardar targetSpans para parrafos y bloques multilineales');
});


test('El rechazo de PDF.js conserva los bytes originales y descarta la previsualización', async () => {
    const vm = require('node:vm');
    const original = new Uint8Array([1, 2, 3]).buffer;
    const intermediate = new Uint8Array([8]).buffer;
    const candidate = new Uint8Array([9]).buffer;
    const src = { buffer: original };
    const overlay = { id: 'edit', isRealEdit: true, bgAlpha: 0, x: 15, y: 20, width: 35, height: 12 };
    const page = { sourceId: 'base', pageIndex: 0, objects: [overlay] };
    const doc = { sources: { base: src }, currentIndex: 0, pages: [page] };
    let message = '', disposed = false, tried = false, saved = false;
    const app = {
        getDoc: () => doc, currentScale: 1, _preEraseBuffer: { sourceId: 'base', buffer: original },
        toggleLoader() {}, renderOverlays() {}, refreshThumbnail() {}, _restoreContinuousIfNeeded() {},
        saveState() { saved = true; }, showToast(value) { message = value; }
    };
    const context = {
        window: { app }, console: { log() {}, warn() {}, error() {} },
        PythonManager: {
            async removeTextSpans() { return intermediate; },
            async applyReflowEdit(working, index, edit, before) {
                assert.equal(working, intermediate);
                assert.deepEqual(new Uint8Array(before), new Uint8Array(original));
                assert.equal(src.buffer, original);
                return { buffer: candidate };
            }
        },
        pdfjsLib: {
            getDocument(options) {
                assert.equal(options.stopAtErrors, true);
                tried = true;
                const checked = { async getOperatorList() { throw Error('Invalid XObject'); } };
                return { promise: Promise.resolve({ getPage: async () => checked }), destroy() { disposed = true; } };
            }
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/app.pdf_ops.js'), 'utf8'), context);
    const data = { x: 15, y: 20, width: 35, height: 12, fontSize: 12, targetSpans: [{text:'OLD'}] };
    await app._applyRealTextInlineCommitNow(overlay, data, 'NEW', []);
    assert.ok(tried && disposed);
    assert.match(message, /Invalid XObject/);
    assert.equal(src.buffer, original);
    assert.equal(saved, false);
    assert.deepEqual(page.objects, []);
});
