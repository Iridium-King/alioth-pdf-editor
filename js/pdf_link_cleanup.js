(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PDFLinkCleanup = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const PYTHON_SOURCE = String.raw`
import base64
import io
import json
import fitz

def _pdf_bytes(value):
    if hasattr(value, 'to_py'):
        return bytes(value.to_py())
    return bytes(value)

def _page_numbers(doc, pages_json):
    pages = pages_json
    if isinstance(pages_json, str) and pages_json != 'all':
        pages = json.loads(pages_json)
    if pages == 'all':
        return range(len(doc))
    return [int(page) for page in pages if 0 <= int(page) < len(doc)]

def _rect_values(rect):
    return [round(float(value), 3) for value in rect]

def _same_rect(left, right, tolerance=0.05):
    return len(left) == 4 and len(right) == 4 and all(
        abs(float(left[index]) - float(right[index])) <= tolerance for index in range(4)
    )

def _widget_signatures(doc):
    signatures = []
    for page_index, page in enumerate(doc):
        widgets = page.widgets()
        if widgets is None:
            continue
        for widget in widgets:
            signatures.append((
                page_index,
                widget.field_name or '',
                int(widget.field_type or 0),
                str(widget.field_value if widget.field_value is not None else ''),
                tuple(_rect_values(widget.rect)),
                int(widget.field_flags or 0),
            ))
    return signatures

def _link_record(page, page_index, link_index, link, include_preview):
    source_rect = link.get('from')
    if not source_rect:
        return None
    rect = fitz.Rect(source_rect)
    if rect.is_empty or rect.width < 2 or rect.height < 2:
        return None
    xref = int(link.get('xref') or 0)
    preview = ''
    if include_preview:
        clip = (rect + fitz.Rect(-4, -4, 4, 4)) & page.rect
        if not clip.is_empty:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
            preview = 'data:image/png;base64,' + base64.b64encode(pixmap.tobytes('png')).decode()
    return {
        'id': f'{page_index}:{xref if xref else link_index}',
        'pageIndex': page_index,
        'pageNumber': page_index + 1,
        'idx': link_index,
        'xref': xref,
        'kind': int(link.get('kind') or 0),
        'uri': link.get('uri') or '',
        'page': int(link.get('page')) + 1 if link.get('page') is not None and int(link.get('page')) >= 0 else None,
        'from': _rect_values(rect),
        'preview': preview,
        'w': round(rect.width, 1),
        'h': round(rect.height, 1),
    }

def scan_pdf_links(data_bytes, pages_json='all', include_previews=True):
    doc = fitz.open(stream=_pdf_bytes(data_bytes), filetype='pdf')
    try:
        records = []
        for page_index in _page_numbers(doc, pages_json):
            page = doc[page_index]
            for link_index, link in enumerate(page.get_links()):
                record = _link_record(page, page_index, link_index, link, include_previews)
                if record:
                    records.append(record)
        return json.dumps(records)
    finally:
        doc.close()

def _matches_target(page_index, link, target):
    if int(target.get('pageIndex', -1)) != page_index:
        return False
    target_xref = int(target.get('xref') or 0)
    link_xref = int(link.get('xref') or 0)
    if target_xref and link_xref:
        return target_xref == link_xref
    source_rect = link.get('from')
    target_rect = target.get('from') or []
    if not source_rect or not _same_rect(list(fitz.Rect(source_rect)), target_rect):
        return False
    return (link.get('uri') or '') == (target.get('uri') or '')

def remove_pdf_links(data_bytes, targets_json, remove_visual=False):
    targets = json.loads(targets_json) if isinstance(targets_json, str) else list(targets_json)
    unique_targets = {str(target.get('id') or json.dumps(target, sort_keys=True)): target for target in targets}
    if not unique_targets:
        raise ValueError('No PDF links were selected')

    doc = fitz.open(stream=_pdf_bytes(data_bytes), filetype='pdf')
    before_widgets = _widget_signatures(doc)
    removed = 0
    try:
        targets_by_page = {}
        for target in unique_targets.values():
            targets_by_page.setdefault(int(target.get('pageIndex', -1)), []).append(target)

        for page_index, page_targets in targets_by_page.items():
            if page_index < 0 or page_index >= len(doc):
                continue
            page = doc[page_index]
            matched = []
            for link in page.get_links():
                if any(_matches_target(page_index, link, target) for target in page_targets):
                    matched.append(link)
            if remove_visual:
                for link in matched:
                    source_rect = link.get('from')
                    if source_rect:
                        rect = fitz.Rect(source_rect) & page.rect
                        if not rect.is_empty:
                            page.add_redact_annot(rect, fill=(1, 1, 1))
            for link in reversed(matched):
                page.delete_link(link)
                removed += 1
            if remove_visual and matched:
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

        if removed != len(unique_targets):
            raise RuntimeError(f'Only {removed} of {len(unique_targets)} selected links were removed')

        output = io.BytesIO()
        doc.save(output, garbage=4, deflate=True, clean=True)
        result = output.getvalue()
    finally:
        doc.close()

    reopened = fitz.open(stream=result, filetype='pdf')
    try:
        if _widget_signatures(reopened) != before_widgets:
            raise RuntimeError('PDF form fields changed while removing links')
        remaining = json.loads(scan_pdf_links(result, 'all', False))
        for target in unique_targets.values():
            for link in remaining:
                if int(link.get('pageIndex', -1)) != int(target.get('pageIndex', -1)):
                    continue
                if _same_rect(link.get('from') or [], target.get('from') or []) and (link.get('uri') or '') == (target.get('uri') or ''):
                    raise RuntimeError('A selected PDF link remains after cleanup')
    finally:
        reopened.close()
    return result
`;

    function normalizeRect(rect) {
        const x0 = Math.min(Number(rect?.x0 ?? rect?.[0] ?? 0), Number(rect?.x1 ?? rect?.[2] ?? 0));
        const y0 = Math.min(Number(rect?.y0 ?? rect?.[1] ?? 0), Number(rect?.y1 ?? rect?.[3] ?? 0));
        const x1 = Math.max(Number(rect?.x0 ?? rect?.[0] ?? 0), Number(rect?.x1 ?? rect?.[2] ?? 0));
        const y1 = Math.max(Number(rect?.y0 ?? rect?.[1] ?? 0), Number(rect?.y1 ?? rect?.[3] ?? 0));
        return { x0, y0, x1, y1 };
    }

    function intersects(left, right) {
        const a = normalizeRect(left);
        const b = normalizeRect(right);
        return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    }

    function selectLinksInArea(links, area, pageIndex) {
        return (links || []).filter(link => Number(link.pageIndex) === Number(pageIndex) && intersects(link.from, area));
    }

    function canvasAreaToPageArea(area, canvasSize, pageSize) {
        const canvasWidth = Number(canvasSize?.width || 0);
        const canvasHeight = Number(canvasSize?.height || 0);
        const pageWidth = Number(pageSize?.width || 0);
        const pageHeight = Number(pageSize?.height || 0);
        if (canvasWidth <= 0 || canvasHeight <= 0) throw new Error('Invalid canvas size');
        if (pageWidth <= 0 || pageHeight <= 0) throw new Error('Invalid PDF page size');
        const normalized = normalizeRect(area);
        return {
            x0: normalized.x0 * pageWidth / canvasWidth,
            y0: normalized.y0 * pageHeight / canvasHeight,
            x1: normalized.x1 * pageWidth / canvasWidth,
            y1: normalized.y1 * pageHeight / canvasHeight,
        };
    }

    function unlinkAppObjectsById(objects, objectIds) {
        let removedCount = 0;
        const nextObjects = (objects || []).map(object => {
            if (!objectIds.has(object.id)) return object;
            if (object.type === 'link') {
                removedCount += 1;
                const converted = {
                    ...object,
                    type: 'text',
                    fontSize: Number(object.fontSize || object.size || 12),
                    fontFamily: object.fontFamily || object.font || 'Helvetica',
                };
                delete converted.url;
                delete converted.linkType;
                delete converted.internalPage;
                delete converted.searchText;
                delete converted.highlightText;
                delete converted.actionLink;
                return converted;
            }
            if (object.actionLink) {
                removedCount += 1;
                const detached = { ...object };
                delete detached.actionLink;
                return detached;
            }
            return object;
        });
        return { objects: nextObjects, removedCount };
    }

    function unlinkAppObjectsInArea(objects, area) {
        const objectIds = new Set((objects || []).filter(object => {
            if (object.type !== 'link' && !object.actionLink) return false;
            return intersects({
                x0: Number(object.x || 0),
                y0: Number(object.y || 0),
                x1: Number(object.x || 0) + Number(object.width || 0),
                y1: Number(object.y || 0) + Number(object.height || 0),
            }, area);
        }).map(object => object.id));
        return unlinkAppObjectsById(objects, objectIds);
    }

    function buildSourceScanPlan(doc) {
        const sources = new Map();
        for (const page of doc?.pages || []) {
            if (!sources.has(page.sourceId)) sources.set(page.sourceId, new Set());
            sources.get(page.sourceId).add(Number(page.pageIndex));
        }
        return [...sources.entries()].map(([sourceId, pageIndexes]) => {
            const source = doc.sources[sourceId];
            return {
                sourceId,
                buffer: source.originalBuffer || source.buffer,
                pageIndexes: [...pageIndexes].sort((left, right) => left - right),
            };
        });
    }

    return {
        PYTHON_SOURCE,
        normalizeRect,
        intersects,
        selectLinksInArea,
        canvasAreaToPageArea,
        unlinkAppObjectsById,
        unlinkAppObjectsInArea,
        buildSourceScanPlan,
    };
});
