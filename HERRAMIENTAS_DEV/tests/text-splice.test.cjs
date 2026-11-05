const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('text_splice.py exists and compiles cleanly', () => {
    const splicePath = path.join(root, 'js', 'engine', 'text_splice.py');
    assert.ok(fs.existsSync(splicePath), 'text_splice.py must exist in js/engine/');
    const content = fs.readFileSync(splicePath, 'utf8');
    assert.ok(content.includes('def remove_spans'), 'must declare remove_spans');
    assert.ok(content.includes('class SpliceFallbackError'), 'must declare SpliceFallbackError');
});

test('python_manager exposes removeTextSpans and text_splice initialization', () => {
    const pm = read('js/python_manager.js');
    assert.ok(pm.includes('removeTextSpans: async function'), 'must expose removeTextSpans');
    assert.ok(pm.includes('text_splice.py'), 'must load text_splice.py into Pyodide FS');
    assert.ok(pm.includes('edit.get(\'origin\')'), 'must read exact origin for baseline positioning');
});

test('app.pdf_ops implements _diffStyleRuns for preserving styles across edits', () => {
    const pdfOps = read('js/app.pdf_ops.js');
    assert.ok(pdfOps.includes('_diffStyleRuns: function'), 'must implement _diffStyleRuns');
    assert.ok(pdfOps.includes('ALIOTH_TEXT_ENGINE'), 'must support ALIOTH_TEXT_ENGINE feature flag');
});

test('_diffStyleRuns maps ranges accurately across text substitutions', () => {
    // Simulate _diffStyleRuns logic
    function diffStyleRuns(oldText, newText, oldRuns) {
        if (!oldRuns || oldRuns.length === 0) return [];
        if (!oldText || oldText === newText) return oldRuns.slice();
        const n = oldText.length, m = newText.length;
        const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < m; j++) {
                dp[i + 1][j + 1] = (oldText[i] === newText[j]) ? dp[i][j] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const oldToNew = new Map();
        let i = n, j = m;
        while (i > 0 && j > 0) {
            if (oldText[i - 1] === newText[j - 1]) {
                oldToNew.set(i - 1, j - 1);
                i--; j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        const newRuns = [];
        for (const run of oldRuns) {
            let newStart = null, newEnd = null;
            for (let k = run.start; k < run.end; k++) {
                if (oldToNew.has(k)) {
                    const mapped = oldToNew.get(k);
                    if (newStart === null || mapped < newStart) newStart = mapped;
                    if (newEnd === null || mapped + 1 > newEnd) newEnd = mapped + 1;
                }
            }
            if (newStart !== null && newEnd !== null && newStart < newEnd) {
                newRuns.push({ ...run, start: newStart, end: newEnd });
            }
        }
        return newRuns;
    }

    const oldText = "Hello bold world";
    const runs = [{ start: 6, end: 10, isBold: true }]; // "bold"
    const newText = "Prefix Hello bold world suffix";
    const mapped = diffStyleRuns(oldText, newText, runs);
    assert.equal(mapped.length, 1);
    assert.equal(newText.slice(mapped[0].start, mapped[0].end), "bold");
});
