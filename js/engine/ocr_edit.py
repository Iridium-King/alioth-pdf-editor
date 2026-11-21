"""Isolated bridge for editing invisible OCR (3 Tr / alpha==0) spans on scanned pages.

STRICT ISOLATION: text_splice.py must NEVER import or depend on this module.
All native digital PDF edits stay in text_splice.py / apply_reflow_edit untouched.
"""

from __future__ import annotations

import base64
import os
import statistics
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


def _remove_ocr_spans_detailed(doc, page, erase_rect, target_spans=None):
    """Remove only hidden OCR spans inside erase_rect and return removed info & neighbor rects."""
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

    other_ocr_rects = [
        fitz.Rect(sp["bbox"])
        for idx, sp in enumerate(ocr_spans)
        if idx not in seen_ids and sp.get("bbox")
    ]
    if not selected:
        return [], native_rects, other_ocr_rects

    removed_info = [
        {
            "bbox": list(sp["bbox"]) if sp.get("bbox") else None,
            "origin": list(sp["origin"]) if sp.get("origin") else None,
        }
        for sp in selected
    ]

    ok, _ = text_splice.remove_spans(doc, page, selected)
    if ok:
        return removed_info, native_rects, other_ocr_rects

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
    return removed_info, native_rects, other_ocr_rects


def remove_ocr_spans_in_rect(doc, page, erase_rect, target_spans=None):
    """Remove only hidden OCR spans inside erase_rect, never touching visible native text."""
    removed, _, _ = _remove_ocr_spans_detailed(doc, page, erase_rect, target_spans=target_spans)
    return len(removed)


def _clip_probe_from_protected(probe, union_rect, protected_rects, margin=0.8):
    """Clip probe edges away from neighboring visible/unselected spans."""
    out = fitz.Rect(probe)
    for pr in (protected_rects or []):
        if pr.is_empty:
            continue
        inter_u = pr & union_rect
        min_area = max(1e-6, min(pr.get_area(), union_rect.get_area()))
        if not inter_u.is_empty and (inter_u.get_area() / min_area) > 0.35:
            continue
        inter_p = pr & out
        if inter_p.is_empty:
            continue
        if pr.y1 <= union_rect.y0 + 1.5 and pr.y1 + margin < out.y1:
            out.y0 = max(out.y0, pr.y1 + margin)
        elif pr.y0 >= union_rect.y1 - 1.5 and pr.y0 - margin > out.y0:
            out.y1 = min(out.y1, pr.y0 - margin)
        elif pr.x0 >= union_rect.x1 - 1.5 and pr.x0 - margin > out.x0:
            out.x1 = min(out.x1, pr.x0 - margin)
        elif pr.x1 <= union_rect.x0 + 1.5 and pr.x1 + margin < out.x1:
            out.x0 = max(out.x0, pr.x1 + margin)
    return out if (out.is_valid and not out.is_empty and out.get_area() > 0) else fitz.Rect(probe)


def _refine_erase_rect_to_ink(page, base_rect, removed_rects=None, protected_rects=None, dpi=300):
    """Snap erase_rect vertically/horizontally to actual dark ink strokes while protecting neighbors."""
    union_rect = fitz.Rect(base_rect)
    v_band = fitz.Rect(union_rect.x0 - 8.0, union_rect.y0 - 6.0, union_rect.x1 + 8.0, union_rect.y1 + 6.0)
    for rr in (removed_rects or []):
        if not rr.is_empty and not (rr & v_band).is_empty:
            union_rect |= rr

    probe = fitz.Rect(union_rect.x0 - 2.0, union_rect.y0 - 3.5, union_rect.x1 + 2.0, union_rect.y1 + 3.5) & page.rect
    if probe.is_empty or probe.width < 1.0 or probe.height < 1.0:
        return union_rect & page.rect
    probe = _clip_probe_from_protected(probe, union_rect, protected_rects, margin=0.8)
    if probe.is_empty or probe.width < 1.0 or probe.height < 1.0:
        return union_rect & page.rect

    max_side = max(1.0, probe.width, probe.height)
    eff_dpi = min(dpi, max(120, int(2400.0 * 72.0 / max_side)))
    try:
        pix = page.get_pixmap(clip=probe, dpi=eff_dpi, colorspace=fitz.csRGB, alpha=False)
    except Exception:
        return union_rect & probe

    cw, ch = pix.width, pix.height
    if cw < 3 or ch < 3:
        return union_rect & probe

    samples = pix.samples
    sx_pt = probe.width / cw
    sy_pt = probe.height / ch
    scale_x = cw / max(1e-6, probe.width)
    scale_y = ch / max(1e-6, probe.height)

    top_rows = list(range(0, min(3, ch)))
    bot_rows = list(range(max(0, ch - 3), ch))

    def _band_med_rgb(c, rows):
        rs = sorted(samples[(r * cw + c) * 3] for r in rows)
        gs = sorted(samples[(r * cw + c) * 3 + 1] for r in rows)
        bs = sorted(samples[(r * cw + c) * 3 + 2] for r in rows)
        mid = len(rows) // 2
        return rs[mid], gs[mid], bs[mid]

    bg_cols = []
    for c in range(cw):
        tr, tg, tb = _band_med_rgb(c, top_rows)
        br_c, bg_c, bb_c = _band_med_rgb(c, bot_rows)
        t_lum = 0.299 * tr + 0.587 * tg + 0.114 * tb
        b_lum = 0.299 * br_c + 0.587 * bg_c + 0.114 * bb_c
        bg_cols.append((tr, tg, tb, t_lum) if t_lum >= b_lum else (br_c, bg_c, bb_c, b_lum))

    col_l = max(0, int((union_rect.x0 - probe.x0) * scale_x) - int(1.5 * scale_x))
    col_r = min(cw - 1, int((union_rect.x1 - probe.x0) * scale_x) + int(1.5 * scale_x))
    if col_r < col_l:
        col_l, col_r = 0, cw - 1

    row_ink_cols = [[] for _ in range(ch)]
    for r in range(ch):
        row_off = r * cw * 3
        cols_hit = []
        for c in range(col_l, col_r + 1):
            idx = row_off + c * 3
            pr = samples[idx]
            pg = samples[idx + 1]
            pb = samples[idx + 2]
            br, bg, bb, blum = bg_cols[c]
            max_diff = max(abs(pr - br), abs(pg - bg), abs(pb - bb))
            if max_diff < 48:
                continue
            plum = 0.299 * pr + 0.587 * pg + 0.114 * pb
            if plum < (blum - 35.0) or plum > (blum + 55.0):
                cols_hit.append(c)
        row_ink_cols[r] = cols_hit

    seed_top = max(0, min(ch - 1, int((union_rect.y0 - probe.y0) * scale_y)))
    seed_bot = max(seed_top, min(ch - 1, int((union_rect.y1 - probe.y0) * scale_y)))
    seed_rows = [r for r in range(seed_top, seed_bot + 1) if row_ink_cols[r]]
    if not seed_rows:
        return (union_rect + (-0.5, -0.5, 0.5, 0.5)) & probe

    top_ink_r = seed_rows[0]
    bot_ink_r = seed_rows[-1]

    streak = 0
    for r in range(top_ink_r - 1, -1, -1):
        if row_ink_cols[r]:
            top_ink_r = r
            streak = 0
        else:
            streak += 1
            if streak >= 3:
                break

    streak = 0
    for r in range(bot_ink_r + 1, ch):
        if row_ink_cols[r]:
            bot_ink_r = r
            streak = 0
        else:
            streak += 1
            if streak >= 3:
                break

    min_c = col_r
    max_c = col_l
    any_ink = False
    for r in range(top_ink_r, bot_ink_r + 1):
        if row_ink_cols[r]:
            any_ink = True
            min_c = min(min_c, row_ink_cols[r][0])
            max_c = max(max_c, row_ink_cols[r][-1])
    if not any_ink:
        return (union_rect + (-0.5, -0.5, 0.5, 0.5)) & probe

    ink_x0 = probe.x0 + min_c * sx_pt
    ink_y0 = probe.y0 + top_ink_r * sy_pt
    ink_x1 = probe.x0 + (max_c + 1) * sx_pt
    ink_y1 = probe.y0 + (bot_ink_r + 1) * sy_pt

    pad = 1.2
    refined = fitz.Rect(
        min(union_rect.x0, ink_x0 - pad),
        min(union_rect.y0, ink_y0 - pad),
        max(union_rect.x1, ink_x1 + pad),
        max(union_rect.y1, ink_y1 + pad),
    ) & probe
    return refined if (not refined.is_empty and refined.get_area() > 0) else (union_rect & probe)


def _inpaint_scan_background_patch(page, erase_rect, fallback_rgb=(1.0, 1.0, 1.0), dpi=300):
    """Reconstruct paper/watermark/gradient background over erase_rect without white cutouts."""
    if erase_rect.is_empty or erase_rect.width < 1.0 or erase_rect.height < 1.0:
        return None, fallback_rgb

    ctx_rect = fitz.Rect(
        erase_rect.x0 - 3.0,
        erase_rect.y0 - 6.0,
        erase_rect.x1 + 3.0,
        erase_rect.y1 + 6.0,
    ) & page.rect
    if ctx_rect.is_empty:
        return None, fallback_rgb

    max_side = max(1.0, ctx_rect.width, ctx_rect.height)
    eff_dpi = min(dpi, max(120, int(2400.0 * 72.0 / max_side)))
    try:
        pix = page.get_pixmap(clip=ctx_rect, dpi=eff_dpi, colorspace=fitz.csRGB, alpha=False)
    except Exception:
        return None, fallback_rgb

    cw, ch = pix.width, pix.height
    if cw < 4 or ch < 4:
        return None, fallback_rgb

    scale_x = cw / max(1e-6, ctx_rect.width)
    scale_y = ch / max(1e-6, ctx_rect.height)
    ix0 = max(0, min(cw - 1, int(round((erase_rect.x0 - ctx_rect.x0) * scale_x))))
    iy0 = max(0, min(ch - 1, int(round((erase_rect.y0 - ctx_rect.y0) * scale_y))))
    ix1 = max(ix0 + 1, min(cw, int(round((erase_rect.x1 - ctx_rect.x0) * scale_x))))
    iy1 = max(iy0 + 1, min(ch, int(round((erase_rect.y1 - ctx_rect.y0) * scale_y))))
    pw = ix1 - ix0
    ph = iy1 - iy0
    if pw < 1 or ph < 1:
        return None, fallback_rgb

    samples = pix.samples
    top_rows = list(range(max(0, iy0 - 10), iy0))
    bot_rows = list(range(iy1, min(ch, iy1 + 10)))
    if not top_rows:
        top_rows = bot_rows[:]
    if not bot_rows:
        bot_rows = top_rows[:]
    if not top_rows and not bot_rows:
        return None, fallback_rgb

    def _clean_band_rgb(c_abs, rows):
        pts = []
        c_lo = max(0, c_abs - 1)
        c_hi = min(cw - 1, c_abs + 1)
        for rr in rows:
            off_row = rr * cw * 3
            for cc in range(c_lo, c_hi + 1):
                i = off_row + cc * 3
                r_v = samples[i]
                g_v = samples[i + 1]
                b_v = samples[i + 2]
                lum = 0.299 * r_v + 0.587 * g_v + 0.114 * b_v
                pts.append((lum, r_v, g_v, b_v))
        pts.sort(key=lambda t: t[0])
        l75 = pts[int(len(pts) * 0.75)][0]
        clean = [p for p in pts if p[0] >= l75 - 28.0]
        if not clean:
            clean = [pts[-1]]
        clean_sorted_r = sorted(p[1] for p in clean)
        clean_sorted_g = sorted(p[2] for p in clean)
        clean_sorted_b = sorted(p[3] for p in clean)
        m = len(clean) // 2
        rm, gm, bm = clean_sorted_r[m], clean_sorted_g[m], clean_sorted_b[m]
        return rm, gm, bm, (0.299 * rm + 0.587 * gm + 0.114 * bm)

    top_row = [_clean_band_rgb(ix0 + c, top_rows) for c in range(pw)]
    bot_row = [_clean_band_rgb(ix0 + c, bot_rows) for c in range(pw)]

    all_lums = sorted([t[3] for t in top_row] + [b[3] for b in bot_row])
    page_bg_lum = all_lums[int(len(all_lums) * 0.85)]

    # Protect against horizontal rules/text lines just above or below erase_rect
    for c in range(pw):
        if top_row[c][3] < (page_bg_lum - 50.0) and bot_row[c][3] >= (page_bg_lum - 35.0):
            top_row[c] = bot_row[c]
        elif bot_row[c][3] < (page_bg_lum - 50.0) and top_row[c][3] >= (page_bg_lum - 35.0):
            bot_row[c] = top_row[c]

    all_rgb = [(t[0], t[1], t[2]) for t in top_row] + [(b[0], b[1], b[2]) for b in bot_row]
    r_vals = [p[0] for p in all_rgb]
    g_vals = [p[1] for p in all_rgb]
    b_vals = [p[2] for p in all_rgb]
    spread = max(max(r_vals) - min(r_vals), max(g_vals) - min(g_vals), max(b_vals) - min(b_vals))
    if spread <= 4:
        avg_r = round(sum(r_vals) / len(r_vals)) / 255.0
        avg_g = round(sum(g_vals) / len(g_vals)) / 255.0
        avg_b = round(sum(b_vals) / len(b_vals)) / 255.0
        return None, (avg_r, avg_g, avg_b)

    def _smooth_row(row):
        if len(row) < 3:
            return [(t[0], t[1], t[2]) for t in row]
        out = []
        for idx in range(len(row)):
            lo = max(0, idx - 1)
            hi = min(len(row) - 1, idx + 1)
            win = row[lo:hi + 1]
            sr = sorted(p[0] for p in win)[len(win) // 2]
            sg = sorted(p[1] for p in win)[len(win) // 2]
            sb = sorted(p[2] for p in win)[len(win) // 2]
            out.append((sr, sg, sb))
        return out

    top_sm = _smooth_row(top_row)
    bot_sm = _smooth_row(bot_row)

    out_rgb = bytearray(pw * ph * 3)
    for r_i in range(ph):
        t = (r_i + 0.5) / ph
        omt = 1.0 - t
        row_off = r_i * pw * 3
        for c_i in range(pw):
            tr, tg, tb = top_sm[c_i]
            br_c, bg_c, bb_c = bot_sm[c_i]
            o = row_off + c_i * 3
            out_rgb[o] = max(0, min(255, int(round(omt * tr + t * br_c))))
            out_rgb[o + 1] = max(0, min(255, int(round(omt * tg + t * bg_c))))
            out_rgb[o + 2] = max(0, min(255, int(round(omt * tb + t * bb_c))))

    pm = fitz.Pixmap(fitz.csRGB, pw, ph, bytes(out_rgb), False)
    return pm.tobytes("png"), None


def _pick_visible_font(font_name="helv", font_buffer=None, font_dir=None, is_bold=False, is_italic=False):
    """Resolve a fitz.Font supporting full Unicode/Spanish accents for visible replacement text."""
    if font_buffer:
        try:
            raw = _decode_data_url_bytes(font_buffer) if isinstance(font_buffer, str) else bytes(font_buffer)
            if raw and len(raw) > 1024:
                fb = fitz.Font(fontbuffer=raw)
                if bool(fb.is_bold) == bool(is_bold) and bool(fb.is_italic) == bool(is_italic):
                    return fb
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
    else:
        base = "ti" if lower.startswith("ti") else ("co" if lower.startswith("co") else "he")
        if is_bold and is_italic:
            fn = base + "bi"
        elif is_bold:
            fn = base + "bo"
        elif is_italic:
            fn = base + "it"
    try:
        return fitz.Font(fontname=fn)
    except Exception:
        return fitz.Font(fontname="helv")


def _compute_baseline_y(irec, fs, fobj, origin=None, removed_spans=None, dragged_y=False):
    """Compute exact baseline Y coordinate for replacement text."""
    if not dragged_y and isinstance(origin, (list, tuple)) and len(origin) >= 2:
        try:
            oy = float(origin[1])
            if abs(oy - irec.y1) <= max(fs * 1.4, 18.0):
                return oy
        except Exception:
            pass

    if not dragged_y and removed_spans:
        origins_y = []
        for sp in removed_spans:
            orig = sp.get("origin")
            if isinstance(orig, (list, tuple)) and len(orig) >= 2:
                try:
                    origins_y.append(float(orig[1]))
                except Exception:
                    pass
        if origins_y:
            top_oy = min(origins_y)
            first_line_oys = [y for y in origins_y if abs(y - top_oy) <= max(2.0, fs * 0.6)]
            if first_line_oys:
                return float(statistics.median(first_line_oys))

    asc = float(getattr(fobj, "ascender", 0.90) or 0.90)
    desc = abs(float(getattr(fobj, "descender", -0.21) or 0.21))
    return float(irec.y0 + fs * (asc / max(0.5, asc + desc)))


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
    origin=None,
    line_origins=None,
    dragged_y=False,
    segments=None,
):
    """Remove old hidden OCR span(s), patch background seamlessly, and insert visible text at exact baseline."""
    erect = fitz.Rect(erase_rect)
    irec = fitz.Rect(insert_rect)
    removed_spans, native_rects, other_ocr_rects = _remove_ocr_spans_detailed(
        doc, page, erect, target_spans=target_spans
    )

    removed_rects = [fitz.Rect(s["bbox"]) for s in removed_spans if s.get("bbox")]
    final_erase_rect = erect
    if not erect.is_empty:
        final_erase_rect = _refine_erase_rect_to_ink(
            page, erect, removed_rects=removed_rects, protected_rects=native_rects + other_ocr_rects
        )

    # 1. Visual background patch over scanned image area
    img_bytes = _decode_data_url_bytes(bg_image_bytes)
    if img_bytes and not final_erase_rect.is_empty:
        page.insert_image(final_erase_rect, stream=img_bytes, keep_proportion=False, overlay=True)
    elif not final_erase_rect.is_empty:
        png_bytes, uni_rgb = _inpaint_scan_background_patch(page, final_erase_rect, fallback_rgb=rgb_bg)
        if png_bytes:
            page.insert_image(final_erase_rect, stream=png_bytes, keep_proportion=False, overlay=True)
        else:
            fill_rgb = uni_rgb if uni_rgb is not None else rgb_bg
            page.draw_rect(final_erase_rect, color=fill_rgb, fill=fill_rgb, width=0, overlay=True)

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
        baseline_y = _compute_baseline_y(
            irec, fs, fobj, origin=origin, removed_spans=removed_spans, dragged_y=dragged_y
        )
        asc = float(getattr(fobj, "ascender", 0.90) or 0.90)
        lh_mult = max(1.05, float(line_height or 1.2))
        has_newlines = "\n" in text_val.rstrip("\n")

        if not has_newlines:
            single_text = text_val.replace("\n", "")
            seg_list = segments if (isinstance(segments, list) and len(segments) > 1) else None
            if seg_list:
                seg_fonts = [
                    _pick_visible_font(
                        font_name=s.get("font") or font_name,
                        font_buffer=font_buffer if (bool(s.get("isBold", is_bold)) == bool(is_bold) and bool(s.get("isItalic", is_italic)) == bool(is_italic)) else None,
                        font_dir=font_dir,
                        is_bold=bool(s.get("isBold", is_bold)),
                        is_italic=bool(s.get("isItalic", is_italic)),
                    )
                    for s in seg_list
                ]
                text_w = sum(sf.text_length(str(s.get("text") or ""), fontsize=fs) for s, sf in zip(seg_list, seg_fonts))
            else:
                text_w = fobj.text_length(single_text, fontsize=fs)

            align_i = int(alignment or 0)
            if align_i == 2:
                x_start = max(irec.x0, irec.x1 - text_w)
            elif align_i == 1:
                x_start = irec.x0 + max(0.0, (irec.width - text_w) * 0.5)
            else:
                x_start = irec.x0

            if x_start + text_w <= page.rect.x1 - 4.0 or not expand_if_needed:
                if seg_list:
                    cur_x = x_start
                    for s, sf in zip(seg_list, seg_fonts):
                        stxt = str(s.get("text") or "")
                        if not stxt:
                            continue
                        srgb = _hex_to_rgb(s.get("color"), fallback=rgb_text) if s.get("color") else rgb_text
                        tw_s = fitz.TextWriter(page.rect)
                        tw_s.append(fitz.Point(cur_x, baseline_y), stxt, font=sf, fontsize=fs)
                        tw_s.write_text(page, color=srgb, overlay=True)
                        cur_x += sf.text_length(stxt, fontsize=fs)
                else:
                    tw = fitz.TextWriter(page.rect)
                    tw.append(fitz.Point(x_start, baseline_y), single_text, font=fobj, fontsize=fs)
                    tw.write_text(page, color=rgb_text, overlay=True)
                expanded_h = float(max(orig_h, fs * 1.15))
                return {"overflow": False, "expanded_h": expanded_h, "original_h": orig_h}

        # Multi-line or long wrapped line anchored via baseline_y
        y0_top = max(0.0, baseline_y - fs * asc)
        lines = text_val.splitlines() or [text_val]
        if len(lines) > 1 and not any(len(ln) > 120 for ln in lines):
            max_line_w = max(fobj.text_length(ln, fontsize=fs) for ln in lines)
            avail_w = max(irec.width, page.rect.x1 - irec.x0 - 4.0) if expand_if_needed else irec.width
            if max_line_w <= avail_w + 2.0:
                tw = fitz.TextWriter(page.rect)
                last_by = baseline_y
                for idx, ln in enumerate(lines):
                    if (
                        not dragged_y
                        and isinstance(line_origins, (list, tuple))
                        and idx < len(line_origins)
                        and isinstance(line_origins[idx], (list, tuple))
                        and len(line_origins[idx]) >= 2
                    ):
                        by = float(line_origins[idx][1])
                        bx = float(line_origins[idx][0]) if alignment == 0 else irec.x0
                    else:
                        by = baseline_y + idx * (fs * lh_mult)
                        bx = irec.x0
                    if ln:
                        lw = fobj.text_length(ln, fontsize=fs)
                        if int(alignment or 0) == 2:
                            bx = max(irec.x0, irec.x1 - lw)
                        elif int(alignment or 0) == 1:
                            bx = irec.x0 + max(0.0, (irec.width - lw) * 0.5)
                        tw.append(fitz.Point(bx, by), ln, font=fobj, fontsize=fs)
                    last_by = by
                tw.write_text(page, color=rgb_text, overlay=True)
                expanded_h = float(max(orig_h, (last_by - baseline_y) + fs * lh_mult))
                return {"overflow": False, "expanded_h": expanded_h, "original_h": orig_h}

        min_line_h = fs * max(1.25, float(line_height or 1.2))
        trial_rect = fitz.Rect(irec.x0, y0_top, irec.x1, max(irec.y1, y0_top + min_line_h))
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
            origin=edit.get('origin'),
            line_origins=edit.get('lineOrigins'),
            dragged_y=bool(edit.get('draggedY', False)),
            segments=edit.get('segments'),
        )
        out_bytes = doc.tobytes(garbage=1, deflate=True)
    return out_bytes, meta
