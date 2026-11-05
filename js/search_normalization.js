function foldSearch(value) {
    return String(value ?? '').normalize('NFC').toLowerCase()
        .replace(/ñ/g, '\uE000').normalize('NFD')
        .replace(/\p{M}/gu, '').replace(/\uE000/g, 'ñ');
}

function searchOffsets(value) {
    const text = String(value ?? '');
    let folded = '';
    const starts = [], ends = [];
    const clusters = text.matchAll(/\P{M}\p{M}*|\p{M}+/gu);
    for (const match of clusters) {
        const part = foldSearch(match[0]);
        for (let i = 0; i < part.length; i++) {
            starts.push(match.index);
            ends.push(match.index + match[0].length);
        }
        folded += part;
    }
    return { text: folded, starts, ends };
}

function pdfMatches(items, query) {
    let text = '';
    const spans = [];
    let previous;
    for (const item of items) {
        if (typeof item.str !== 'string') continue;
        if (previous) {
            const lineBreak = previous.hasEOL || Math.abs(previous.transform[5] - item.transform[5]) > Math.abs(item.transform[3]) * .5;
            const gap = item.transform[4] - previous.transform[4] - previous.width;
            if (lineBreak) text += '\n';
            else if (gap > Math.abs(item.transform[3]) * .15 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
        }
        spans.push({ item, start: text.length, end: text.length + item.str.length });
        text += item.str;
        previous = item;
    }
    const folded = searchOffsets(text), needle = foldSearch(query), matches = [];
    if (!needle) return matches;
    let offset = 0;
    while ((offset = folded.text.indexOf(needle, offset)) >= 0) {
        const start = folded.starts[offset], end = folded.ends[offset + needle.length - 1];
        matches.push(spans.filter(span => span.start < end && span.end > start).map(span => ({
            item: span.item, start: Math.max(0, start - span.start), end: Math.min(span.item.str.length, end - span.start)
        })));
        offset += needle.length;
    }
    return matches;
}

window.AliothSearch = { fold: foldSearch, offsets: searchOffsets, pdfMatches };
