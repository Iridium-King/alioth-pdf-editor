"""Isolated bridge for editing invisible OCR (3 Tr / alpha==0) spans on scanned pages.

STRICT ISOLATION: text_splice.py must NEVER import or depend on this module.
All native digital PDF edits stay in text_splice.py / apply_reflow_edit untouched.
"""

from __future__ import annotations

import base64
import os
import fitz

import text_splice


def _hex_to_rgb(hex_str, fallback=(0.0, 0.0, 0.0)):
    """Convert #rrggbb hex string to 0..1 RGB tuple."""
    s = str(hex_str or '').strip()
    if s.startswith('#') and len(s) >= 7:
        h = s[1:7]
        try:
            return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
        except Exception:
            pass
    return fallback


def _decode_data_url_bytes(value):
    """Decode base64 string or data:...;base64,... URL to raw bytes."""
    if not value:
        return None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if not isinstance(value, str):
        return None
    s = value.strip()
    if ',' in s and s.lower().startswith('data:'):
        s = s.split(',', 1)[1]
    try:
        return base64.b64decode(s)
    except Exception:
        return None


def _extract_all_spans(page):
    """Return flattened text spans from page.get_text('dict')."""
    spans = []
    td = page.get_text("dict")
    for block in td.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for sp in line.get("spans", []):
                if sp.get("bbox"):
                    spans.append(sp)
    return spans


def is_ocr_hidden_span(page, span, _trace_cache=None):
    """Return True iff span is an invisible OCR text span (alpha==0 or type==3 trace)."""
    if not isinstance(span, dict):
        return False
    if span.get("alpha", 255) == 0:
        return True
    bbox = span.get("bbox")
    if not bbox or len(bbox) != 4:
        return False
    srect = fitz.Rect(bbox)
    sarea = srect.get_area()
    if sarea <= 0:
        return False
    traces = _trace_cache if _trace_cache is not None else page.get_texttrace()
    has_hidden = False
    has_visible = False
    for tr in traces:
        tb = tr.get("bbox")
        if not tb or len(tb) != 4:
            continue
        inter = fitz.Rect(tb) & srect
        if inter.is_empty:
            continue
        if (inter.get_area() / sarea) < 0.45:
            continue
        if tr.get("type") == 3 or tr.get("opacity") == 0:
            has_hidden = True
        else:
            has_visible = True
    return bool(has_hidden and not has_visible)


def _match_span_identity(sp, target):
    """Check whether dict span matches target span dict by bbox + text."""
    sb = sp.get("bbox")
    tb = target.get("bbox")
    if not sb or not tb or len(sb) != 4 or len(tb) != 4:
        return False
    inter = fitz.Rect(sb) & fitz.Rect(tb)
    if inter.is_empty:
        return False
    area = min(fitz.Rect(sb).get_area(), fitz.Rect(tb).get_area())
    if area <= 0 or (inter.get_area() / area) < 0.5:
        return False
    tt = (target.get("text") or "").strip()
    st = (sp.get("text") or "").strip()
    return not tt or not st or (tt == st) or (tt in st) or (st in tt)


def _subtract_protected_boxes(rect, native_rects):
    """Shrink/clip rect horizontally or vertically if it touches any visible native span."""
    out = fitz.Rect(rect)
    for nr in native_rects:
        inter = out & nr
        if inter.is_empty:
            continue
        # Only preserve if intersection is non-trivial; shrink away along smallest overlap edge
        dx_left = max(0.0, out.x1 - nr.x0)
        dx_right = max(0.0, nr.x1 - out.x0)
        dy_top = max(0.0, out.y1 - nr.y0)
        dy_bot = max(0.0, nr.y1 - out.y0)
        best = min(dx_left, dx_right, dy_top, dy_bot)
        if best == dy_top and nr.y0 > out.y0:
            out.y1 = nr.y0 - 0.5
        elif best == dy_bot and nr.y1 < out.y1:
            out.y0 = nr.y1 + 0.5
        elif best == dx_left and nr.x0 > out.x0:
            out.x1 = nr.x0 - 0.5
        elif nr.x1 < out.x1:
            out.x0 = nr.x1 + 0.5
        else:
            return fitz.Rect()
    return out if (out.is_valid and not out.is_empty and out.get_area() > 0) else fitz.Rect()


def remove_ocr_spans_in_rect(doc, page, erase_rect, target_spans=None):
    """Remove only hidden OCR spans inside erase_rect, never touching visible native text."""
    text_splice.isolate_resources(doc, page)
    erect = fitz.Rect(erase_rect)
    all_spans = _extract_all_spans(page)
    traces = page.get_texttrace()

    ocr_spans = []
    native_rects = []
    for sp in all_spans:
        if is_ocr_hidden_span(page, sp, _trace_cache=traces):
            ocr_spans.append(sp)
        elif sp.get("bbox"):
            native_rects.append(fitz.Rect(sp["bbox"]))

    selected = []
    seen_ids = set()
    if target_spans:
        for ts in target_spans:
            for idx, sp in enumerate(ocr_spans):
                if idx not in seen_ids and _match_span_identity(sp, ts):
                    selected.append(sp)
                    seen_ids.add(idx)

    for idx, sp in enumerate(ocr_spans):
        if idx in seen_ids:
            continue
        sb = fitz.Rect(sp["bbox"])
        sarea = sb.get_area()
        if sarea <= 0:
            continue
        inter = sb & erect
        if not inter.is_empty and (inter.get_area() / sarea) >= 0.35:
            selected.append(sp)
            seen_ids.add(idx)

    if not selected:
        return 0

    ok, _ = text_splice.remove_spans(doc, page, selected)
    if ok:
        return len(selected)

    # Fallback: redact strictly the OCR span bboxes clipped away from native visible spans
    added = 0
    for sp in selected:
        safe_rect = _subtract_protected_boxes(fitz.Rect(sp["bbox"]), native_rects)
        if not safe_rect.is_empty:
            page.add_redact_annot(safe_rect, fill=None)
            added += 1
    if added > 0:
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
        )
    return len(selected)


def _pick_visible_font(font_name="helv", font_buffer=None, font_dir=None, is_bold=False, is_italic=False):
    """Resolve a fitz.Font supporting full Unicode/Spanish accents for visible replacement text."""
    if font_buffer:
        try:
            raw = _decode_data_url_bytes(font_buffer) if isinstance(font_buffer, str) else bytes(font_buffer)
            if raw and len(raw) > 1024:
                return fitz.Font(fontbuffer=raw)
        except Exception:
            pass

    if font_dir and os.path.isdir(font_dir):
        if is_bold and is_italic:
            fname = "LiberationSans-BoldItalic.ttf"
        elif is_bold:
            fname = "LiberationSans-Bold.ttf"
        elif is_italic:
            fname = "LiberationSans-Italic.ttf"
        else:
            fname = "LiberationSans-Regular.ttf"
        fpath = os.path.join(font_dir, fname)
        if os.path.exists(fpath):
            try:
                return fitz.Font(fontfile=fpath)
            except Exception:
                pass

    fn = str(font_name or "helv").strip()
    lower = fn.lower()
    if lower not in {"helv", "hebo", "heit", "hebi", "tiro", "tibo", "tiit", "tibi", "cour", "cobo", "coit", "cobi"}:
        if "times" in lower or "serif" in lower:
            fn = "tibi" if (is_bold and is_italic) else ("tibo" if is_bold else ("tiit" if is_italic else "tiro"))
        elif "cour" in lower or "mono" in lower:
            fn = "cobi" if (is_bold and is_italic) else ("cobo" if is_bold else ("coit" if is_italic else "cour"))
        else:
            fn = "hebi" if (is_bold and is_italic) else ("hebo" if is_bold else ("heit" if is_italic else "helv"))
    try:
        return fitz.Font(fontname=fn)
    except Exception:
        return fitz.Font(fontname="helv")


def replace_ocr_region(
    doc,
    page,
    erase_rect,
    insert_rect,
    new_text,
    font_name="helv",
    font_size=12,
    rgb_text=(0.0, 0.0, 0.0),
    rgb_bg=(1.0, 1.0, 1.0),
    font_buffer=None,
    font_dir=None,
    bg_image_bytes=None,
    target_spans=None,
    alignment=0,
    line_height=1.2,
    is_bold=False,
    is_italic=False,
    expand_if_needed=True,
):
    """Remove old hidden OCR span(s), patch background pixels, and insert visible text."""
    erect = fitz.Rect(erase_rect)
    irec = fitz.Rect(insert_rect)
    remove_ocr_spans_in_rect(doc, page, erect, target_spans=target_spans)

    # 1. Visual background patch over scanned image area
    img_bytes = _decode_data_url_bytes(bg_image_bytes)
    if img_bytes and not erect.is_empty:
        page.insert_image(erect, stream=img_bytes, keep_proportion=False, overlay=True)
    elif not erect.is_empty:
        page.draw_rect(erect, color=rgb_bg, fill=rgb_bg, width=0, overlay=True)

    text_val = str(new_text or "")
    orig_h = float(irec.height)
    expanded_h = orig_h
    overflow = False

    if text_val.strip():
        fs = max(4.0, float(font_size or 12.0))
        fobj = _pick_visible_font(
            font_name=font_name,
            font_buffer=font_buffer,
            font_dir=font_dir,
            is_bold=is_bold,
            is_italic=is_italic,
        )
        # Ensure minimum single-line height & width slack for slightly wider replacement words
        min_line_h = fs * max(1.25, float(line_height or 1.2))
        trial_rect = fitz.Rect(irec.x0, irec.y0, irec.x1, max(irec.y1, irec.y0 + min_line_h))
        if "\n" not in text_val.strip():
            needed_w = fobj.text_length(text_val, fontsize=fs) + 4.0
            if needed_w > trial_rect.width and expand_if_needed:
                max_x1 = max(trial_rect.x1, page.rect.x1 - 4.0)
                trial_rect.x1 = min(max_x1, trial_rect.x0 + needed_w)

        def _try_fill(rect_box):
            tw = fitz.TextWriter(page.rect)
            rem = tw.fill_textbox(rect_box, text_val, font=fobj, fontsize=fs, align=int(alignment or 0))
            return tw, rem

        tw, rem = _try_fill(trial_rect)
        if rem and expand_if_needed:
            max_h = max(trial_rect.height, page.rect.height - trial_rect.y0 - 2.0)
            cur_h = trial_rect.height
            for _ in range(18):
                cur_h = min(max_h, cur_h * 1.25 + fs * 0.5)
                candidate_rect = fitz.Rect(trial_rect.x0, trial_rect.y0, trial_rect.x1, trial_rect.y0 + cur_h)
                tw_next, rem_next = _try_fill(candidate_rect)
                tw, rem = tw_next, rem_next
                if not rem or cur_h >= max_h:
                    trial_rect = candidate_rect
                    break
        expanded_h = float(max(orig_h, trial_rect.height))
        overflow = bool(rem)
        tw.write_text(page, color=rgb_text, overlay=True)

    return {"overflow": overflow, "expanded_h": expanded_h, "original_h": orig_h}


def apply_ocr_text_edit_bytes(pdf_bytes, page_num, edit_dict, font_dir=None):
    """High-level byte-to-byte entry point for editing an OCR-detected text region."""
    if hasattr(pdf_bytes, 'to_py'):
        pdf_bytes = bytes(pdf_bytes.to_py())
    else:
        pdf_bytes = bytes(pdf_bytes)

    edit = dict(edit_dict or {})
    x = float(edit.get('x', 0.0))
    y = float(edit.get('y', 0.0))
    w = max(1.0, float(edit.get('w', 20.0)))
    h = max(1.0, float(edit.get('h', 12.0)))

    ex0 = float(edit.get('eraseFullX', x))
    ey0 = float(edit.get('eraseFullY', y))
    ew = max(1.0, float(edit.get('eraseFullW', w)))
    eh = max(1.0, float(edit.get('eraseFullH', h)))

    erase_rect = fitz.Rect(ex0, ey0, ex0 + ew, ey0 + eh)
    insert_rect = fitz.Rect(x, y, x + w, y + h)

    rgb_text = _hex_to_rgb(edit.get('color'), fallback=(0.0, 0.0, 0.0))
    rgb_bg = _hex_to_rgb(edit.get('eraseBgColor') or edit.get('bgColor'), fallback=(1.0, 1.0, 1.0))

    align_name = str(edit.get('alignment') or 'left').lower()
    align_val = 2 if align_name == 'right' else (1 if align_name == 'center' else 0)

    font_buf = _decode_data_url_bytes(edit.get('fontBuffer'))
    target_spans = edit.get('targetSpans') or ([edit.get('targetSpan')] if edit.get('targetSpan') else None)

    with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
        if page_num < 0 or page_num >= doc.page_count:
            raise ValueError('INVALID_OCR_EDIT_PAGE')
        page = doc[page_num]
        meta = replace_ocr_region(
            doc,
            page,
            erase_rect,
            insert_rect,
            edit.get('text', ''),
            font_name=edit.get('font') or 'helv',
            font_size=float(edit.get('size', 12.0)),
            rgb_text=rgb_text,
            rgb_bg=rgb_bg,
            font_buffer=font_buf,
            font_dir=font_dir,
            bg_image_bytes=edit.get('bgImage'),
            target_spans=target_spans,
            alignment=align_val,
            line_height=float(edit.get('lineHeight', 1.2)),
            is_bold=bool(edit.get('isBold', False)),
            is_italic=bool(edit.get('isItalic', False)),
            expand_if_needed=bool(edit.get('expandIfNeeded', True)),
        )
        out_bytes = doc.tobytes(garbage=1, deflate=True)
    return out_bytes, meta
