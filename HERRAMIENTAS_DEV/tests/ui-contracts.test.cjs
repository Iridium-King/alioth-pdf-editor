const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '../../BASE.html'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../../js/app.ui.js'), 'utf8');
const core = fs.readFileSync(path.resolve(__dirname, '../../js/app.core.js'), 'utf8');
const agentic = fs.readFileSync(path.resolve(__dirname, '../../js/app.agentic.js'), 'utf8');

function ribbonToolbar(id) {
  const start = html.indexOf(`id="${id}"`);
  const end = html.indexOf('<div class="toolbar-area"', start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

test('header save controls have accessible names and current coordinators', () => {
  assert.match(html, /id="btn-header-save"[^>]*onclick="app\.saveFromHeader\('save', this\)"[^>]*aria-label="Guardar"/);
  assert.match(html, /id="btn-header-save-as"[^>]*onclick="app\.showSaveModal\(\)"[^>]*aria-label="Guardar como"/);
  assert.match(html, /id="btn-header-close"[^>]*onclick="app\.closeDocument\(\)"[^>]*aria-label="Cerrar documento"/);
});

test('theme modal exposes the persisted form-field highlight color preference', () => {
  const modal = html.match(/<div id="theme-modal"[\s\S]*?<\/div>\s*<!-- FIN DEL THEME MODAL -->/);
  assert.ok(modal);
  assert.match(modal[0], /id="form-field-highlight-color"/);
  assert.match(modal[0], /oninput="app\.setFormFieldHighlightColor\(this\.value\)"/);
});

test('form ribbon controls use a compact toggle layout instead of scaled inline switches', () => {
  assert.match(html, /class="tool-group-vertical form-field-controls-group"/);
  assert.equal((html.match(/class="form-field-toggle-row"/g) || []).length, 3);
  const controls = html.match(/form-field-controls-group[\s\S]*?<!-- AGRUPAR — Inputs -->/);
  assert.ok(controls);
  assert.doesNotMatch(controls[0], /transform:scale/);
  assert.doesNotMatch(controls[0], /form-field-control-actions|form-field-control-line/);
});

test('every API key provider exposes a persistent collapse control', () => {
  for (const provider of ['gemini', 'groq', 'mistral', 'azure', 'huggingface', 'openrouter', 'nvidia', 'fishaudio']) {
    assert.match(html, new RegExp(`class="pref-key-collapse" onclick="app\\.toggleApiKeyCard\\('${provider}'\\)"`));
  }
  assert.doesNotMatch(core, /else if \(toggle\) \{\s*toggle\.remove\(\)/);
  assert.match(core, /toggle\.setAttribute\('aria-expanded', String\(!collapsed\)\)/);
});

test('AI ribbon groups the existing AI commands outside the other tabs', () => {
  assert.match(html, /<button class="tab-btn" onclick="app\.switchRibbon\('ai'\)" id="tab-btn-ai"[^>]*data-i18n="btn_ai"/);
  const aiToolbar = ribbonToolbar('toolbar-ai');
  assert.ok(aiToolbar, 'AI toolbar must be part of the ribbon');
  for (const command of ['tableToFormAI', 'showSensitiveReview', 'showDataExtractionModal', 'generateIndexWithAI']) {
    assert.match(aiToolbar, new RegExp(`app\\.${command}`));
  }
  assert.match(aiToolbar, /data-i18n="tab_forms"/);
  assert.match(aiToolbar, /data-i18n="dyn_t_1065"/);
  assert.match(aiToolbar, /data-i18n="dyn_t_1070"/);
  assert.doesNotMatch(aiToolbar, /showAnalysisReportModal/);
  const magicToolbar = ribbonToolbar('toolbar-magic');
  assert.ok(magicToolbar);
  for (const command of ['showSensitiveReview', 'showDataExtractionModal']) {
    assert.doesNotMatch(magicToolbar, new RegExp(`app\\.${command}`));
  }
});

test('sensitive-data tools open a local occurrence review before any censor action', () => {
  const aiToolbar = ribbonToolbar('toolbar-ai');
  assert.match(aiToolbar, /onclick="app\.showSensitiveReview\('email'\)"/);
  assert.match(aiToolbar, /onclick="app\.showSensitiveReview\('phone'\)"/);
  const modal = html.match(/<div id="sensitive-review-modal"[\s\S]*?<\/div>\s*<!-- FIN REVISIÓN DE DATOS SENSIBLES -->/);
  assert.ok(modal);
  assert.match(modal[0], /id="sensitive-review-items"/);
  assert.match(modal[0], /value="birth-date"/);
  assert.match(modal[0], /id="sensitive-review-action"[\s\S]*?value="censor"[\s\S]*?value="delete"/);
  assert.match(modal[0], /selectSensitiveReviewItems\(true\)[\s\S]*?selectSensitiveReviewItems\(false\)/);
  assert.match(modal[0], /id="sensitive-review-confirm"[^>]*onclick="app\.applySensitiveReviewSelection\(\)"[^>]*disabled/);
  assert.match(agentic, /prepareSensitiveReview: async function/);
  assert.match(agentic, /applySensitiveReviewSelection: async function/);
});

test('the current AI interface does not expose the removed analysis modal', () => {
  assert.doesNotMatch(html, /id="analysis-review-modal"|app\.showAnalysisReportModal\(\)/);
  assert.match(html, /id="sensitive-review-modal"/);
  assert.match(html, /id="translation-review-modal"/);
});

test('AI translation creates a copy with translation notes from the modal', () => {
  const aiToolbar = ribbonToolbar('toolbar-ai');
  assert.match(aiToolbar, /id="btn-translate-review"[^>]*onclick="app\.showTextTranslationModal\(\)"/);
  assert.match(aiToolbar, /id="btn-translate-review"[\s\S]*?>[\s\S]*?Traducir<br>Documento/);
  assert.match(aiToolbar, /data-i18n="dyn_t_2003_document"/);
  const modal = html.match(/<div id="translation-review-modal"[\s\S]*?<\/div>\s*<!-- FIN REVISIÓN DE TRADUCCIÓN -->/);
  assert.ok(modal);
  assert.match(modal[0], /Traducir documento/);
  assert.match(modal[0], /id="translation-review-items"/);
  assert.match(modal[0], /value="selection">Texto seleccionado/);
  assert.doesNotMatch(modal[0], /id="translation-review-prepare"/);
  assert.match(modal[0], /id="translation-review-apply"[^>]*>Aplicar en copia/);
  assert.match(modal[0], /id="translation-review-progress"[\s\S]*?role="progressbar"[\s\S]*?id="translation-review-progress-bar"/);
  assert.match(agentic, /Página escaneada: reconstrucción visual pendiente/);
  assert.match(agentic, /createTranslationNotesCopyFromModal: async function/);
});

test('translation review shows staged progress for preparation and copy creation', () => {
  assert.match(agentic, /function setTranslationReviewProgress/);
  assert.match(agentic, /Capturando una copia temporal del documento/);
  assert.match(agentic, /Enviando \$\{eligible\.length\} fragmento\(s\) al proveedor de IA/);
  assert.match(agentic, /Comprobando fuente, posición y espacio disponible/);
  assert.match(agentic, /Reconstruyendo el texto en una copia temporal/);
  assert.match(agentic, /Publicando la copia traducida/);
});

test('shortcut catalog keeps AI action identifiers stable and searches accent-insensitively', () => {
  for (const id of ['tableToFormAI', 'dataExtractionAI', 'dexExtractDirect', 'generateIndexAI', 'saveAs', 'equalFieldWidth', 'equalFieldHeight', 'fieldGrid']) {
    assert.equal((ui.match(new RegExp(`id: '${id}'`, 'g')) || []).length, 1, `${id} must be unique`);
  }
  assert.match(ui, /tab: 'IA', items:/);
  assert.match(ui, /keywords: \['extracción', 'extraction', 'datos'\]/);
  assert.match(ui, /normalize\('NFD'\)\.replace/);
  assert.match(ui, /item\.available === false/);
});
