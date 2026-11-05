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
