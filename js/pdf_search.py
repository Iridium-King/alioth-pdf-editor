import json
import unicodedata
import fitz


def fold_search(text, case_sensitive=False):
    text = unicodedata.normalize('NFC', text)
    if not case_sensitive:
        text = text.lower()
    return ''.join(char if char in 'ñÑ' else ''.join(
        part for part in unicodedata.normalize('NFD', char)
        if not unicodedata.combining(part)) for char in text)


def page_matches(page, term, case_sensitive=False):
    needle = fold_search(term, case_sensitive)
    if not needle:
        return []
    text, positions, line_ids = [], [], []
    for block_number, block in enumerate(page.get_text('rawdict')['blocks']):
        for line_number, line in enumerate(block.get('lines', [])):
            for span in line['spans']:
                for char in span['chars']:
                    # Combining accents share the preceding glyph's comparison position.
                    value = char['c']
                    if unicodedata.combining(value) and text:
                        text[-1] = unicodedata.normalize('NFC', text[-1] + value)
                        positions[-1] |= fitz.Rect(char['bbox'])
                    else:
                        text.append(value)
                        positions.append(fitz.Rect(char['bbox']))
                        line_ids.append((block_number, line_number))
            text.append('\n')
            positions.append(None)
            line_ids.append(None)
    folded, mapping = [], []
    for index, char in enumerate(text):
        part = fold_search(char, case_sensitive)
        folded.append(part)
        mapping.extend([index] * len(part))
    haystack = ''.join(folded)
    results, offset = [], 0
    while (offset := haystack.find(needle, offset)) >= 0:
        rects = {}
        for index in mapping[offset:offset + len(needle)]:
            if positions[index] is not None:
                key = line_ids[index]
                rects[key] = rects.get(key, fitz.Rect(positions[index])) | positions[index]
        results.extend(rects.values())
        offset += len(needle)
    # Preserve PyMuPDF's matching of ligatures and words split by line-end hyphens.
    if not case_sensitive:
        for rect in page.search_for(term, flags=fitz.TEXT_DEHYPHENATE):
            if not any(all(abs(a - b) < 1 for a, b in zip(rect, existing)) for existing in results):
                results.append(rect)
    return sorted(results, key=lambda rect: (round(rect.y0, 1), rect.x0))


def search_doc(data_bytes, search_term, case_sensitive=False):
    data = data_bytes.to_py() if hasattr(data_bytes, 'to_py') else data_bytes
    results = []
    with fitz.open(stream=bytes(data), filetype='pdf') as doc:
        for pno, page in enumerate(doc):
            for rect in page_matches(page, search_term, case_sensitive):
                results.append(dict(pageIdx=pno, x0=round(rect.x0, 3), y0=round(rect.y0, 3),
                                    x1=round(rect.x1, 3), y1=round(rect.y1, 3),
                                    pageW=page.rect.width, pageH=page.rect.height))
    return json.dumps(results)
