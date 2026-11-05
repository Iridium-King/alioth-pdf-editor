import fitz, io, json, base64, hashlib, os, re, time
from collections import Counter
from contextlib import contextmanager
from statistics import median
import unicodedata

class TranslationOccurrenceError(ValueError):
    def __init__(self, code, item, index, stage):
        super().__init__(code)
        self.occurrence_id = item.get("id")
        self.occurrence_index = index
        self.page_index = item.get("pageIndex")
        self.stage = stage

class TranslationVerificationError(ValueError):
    def __init__(self, page_index, stage):
        super().__init__("TRANSLATION_OUTPUT_UNVERIFIED")
        self.page_index = page_index
        self.stage = stage

class TranslationRedactionBatchError(ValueError):
    def __init__(self, occurrence_ids, page_index):
        super().__init__("TRANSLATION_NEIGHBOR_INTERSECTION")
        self.occurrence_ids = occurrence_ids
        self.page_index = page_index
        self.stage = "redaction_verify"

def _normal(value):
    return "".join(str(value).split()).casefold()

def _translation_apply_diagnostic(data_bytes, occurrences, item, index, stage, code):
    try:
        identifier = str(item.get("id", ""))
        if not re.fullmatch(r"native:[A-Za-z0-9_-]+:\d+:\d+", identifier):
            identifier = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:16]
        entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "event": "translation_apply_item_failed",
            "pdfSha256": hashlib.sha256(data_bytes).hexdigest()[:16],
            "selectedUnits": len(occurrences),
            "occurrenceIndex": index,
            "occurrenceId": identifier,
            "pageIndex": item.get("pageIndex"),
            "stage": stage,
            "errorCode": code if re.fullmatch(r"(?:INVALID_TRANSLATION|TRANSLATION)_[A-Z0-9_]{1,80}", code) else "TRANSLATION_NATIVE_FAILED",
        }
        path = os.environ.get("ALIOTH_TRANSLATION_DIAGNOSTIC_LOG") or os.path.join(os.path.dirname(__file__), "..", "logs", "translation-reconstruction.jsonl")
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except (OSError, TypeError, ValueError):
        pass

def _translation_apply_phase(data_bytes, occurrences, stage, started, page_index=None):
    if len(occurrences) < 100:
        return
    try:
        entry = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
                 "event": "translation_apply_phase", "pdfSha256": hashlib.sha256(data_bytes).hexdigest()[:16],
                 "selectedUnits": len(occurrences), "stage": stage,
                 "durationMs": round((time.perf_counter() - started) * 1000)}
        if page_index is not None:
            entry["pageIndex"] = page_index
        path = os.environ.get("ALIOTH_TRANSLATION_DIAGNOSTIC_LOG") or os.path.join(os.path.dirname(__file__), "..", "logs", "translation-reconstruction.jsonl")
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except (OSError, TypeError, ValueError):
        pass

def _pdf_rect(page, rect):
    clip = fitz.Rect(rect["x0"], page.rect.height - rect["y1"], rect["x1"], page.rect.height - rect["y0"])
    if not clip.is_valid or clip.is_empty:
        raise ValueError("INVALID_TRANSLATION_RECT")
    return clip

def _is_scanned_page(page):
    images = [rect for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])]
    page_area = page.rect.get_area()
    return (page_area > 0 and sum((image & page.rect).get_area() for image in images) >= page_area * 0.90
            and not _translation_visible_text_regions(page))

def _translation_visible_text_regions(page):
    try:
        image_layers = [(fitz.Rect(box), index) for index, (kind, box, *_) in enumerate(page.get_bboxlog())
                        if kind == "fill-image"]
        visible = []
        for trace in page.get_texttrace():
            if trace.get("type") not in (0, 1) or trace.get("opacity", 1) < 0.1:
                continue
            rect = fitz.Rect(trace["bbox"])
            if rect.is_empty:
                continue
            if any(sequence > trace.get("seqno", -1) and (image & rect).get_area() >= rect.get_area() * 0.9
                   for image, sequence in image_layers):
                continue
            visible.append(rect)
        return visible
    except Exception:
        return []

def _translation_span_is_visible(span, visible_regions):
    parts = span.get("selectionParts") or [span]
    for part in parts:
        rect = fitz.Rect(part["bbox"])
        center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
        if not any((region + (-1, -1, 1, 1)).contains(center) for region in visible_regions):
            return False
    return bool(parts)

def _translation_font(doc, key, fonts):
    if key.startswith("embedded:"):
        buffer = doc.extract_font(int(key.split(":")[1]))[3]
    elif key in fonts:
        buffer = base64.b64decode(fonts[key])
    else:
        return fitz.Font(key), None, key
    return fitz.Font(fontbuffer=buffer), buffer, "alioth_translation_" + str(len(buffer))

def _translation_page(doc, pno, cache):
    if pno not in cache["pages"]:
        page = doc[pno]
        textpage = page.get_textpage(flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
        spans = _translation_spans(textpage)
        cache["pages"][pno] = {"page": page, "textpage": textpage, "spans": spans,
                               "scan": _is_scanned_page(page), "widgets": [widget.rect for widget in (page.widgets() or [])],
                               "lines": _translation_thin_lines(page)}
    return cache["pages"][pno]

def _translation_thin_lines(page):
    lines = []
    try:
        for drawing in page.get_drawings():
            rect = drawing.get("rect")
            if rect and (rect.width <= 1.5 or rect.height <= 1.5):
                lines.append(fitz.Rect(rect))
    except Exception:
        pass
    return lines

def _translation_reflow_padding(context, clip, targets, horizontal=7.5, vertical=10.0):
    """Extiende una caja de reflow únicamente por espacio que no contiene texto, campos ni líneas."""
    occupied = [fitz.Rect(span["bbox"]) for span in context["spans"]
                if span not in targets and str(span.get("text", "")).strip()]
    occupied.extend(context["widgets"])
    occupied.extend(context.get("lines", ()))
    padded = fitz.Rect(clip)

    def clear(candidate, strip):
        return (not candidate.is_empty and candidate in context["page"].rect and
                not any(strip.intersects(rect) for rect in occupied))

    for side, amount in (("x0", horizontal), ("x1", horizontal), ("y1", vertical), ("y0", vertical)):
        candidate = fitz.Rect(padded)
        if side == "x0":
            candidate.x0 = max(context["page"].rect.x0, padded.x0 - amount)
            strip = fitz.Rect(candidate.x0, padded.y0, padded.x0, padded.y1)
        elif side == "x1":
            candidate.x1 = min(context["page"].rect.x1, padded.x1 + amount)
            strip = fitz.Rect(padded.x1, padded.y0, candidate.x1, padded.y1)
        elif side == "y0":
            candidate.y0 = max(context["page"].rect.y0, padded.y0 - amount)
            strip = fitz.Rect(padded.x0, candidate.y0, padded.x1, padded.y0)
        else:
            candidate.y1 = min(context["page"].rect.y1, padded.y1 + amount)
            strip = fitz.Rect(padded.x0, padded.y1, padded.x1, candidate.y1)
        if clear(candidate, strip):
            padded = candidate
    return padded

def _translation_spans(textpage):
    spans = [span for block in textpage.extractRAWDICT().get("blocks", []) if block.get("type") == 0
             for line in block.get("lines", []) for span in line.get("spans", [])]
    for span in spans:
        span["text"] = "".join(char["c"] for char in span["chars"])
    return spans

def _translation_glyphs(spans):
    return Counter(_translation_glyph_key(span, char)
                   for span in spans for char in span["chars"] if char["c"].strip())

def _translation_glyph_key(span, char):
    return (char["c"], span["font"], round(span["size"], 3), span["color"],
            *[round(value, 2) for value in char["origin"]])

def _translation_safe_erases(items, spans):
    selected = Counter()
    for plan in items:
        selected.update(plan[5])
    protected = []
    for span in spans:
        for char in span["chars"]:
            if not char["c"].strip():
                continue
            key = _translation_glyph_key(span, char)
            if selected[key]:
                selected[key] -= 1
            else:
                protected.append(fitz.Rect(char["bbox"]))
    for plan in items:
        item, clip = plan[:2]
        if item.get("reflow") or item.get("renderMode") == "scan-overlay":
            continue
        if not any(clip.intersects(char) for char in protected):
            plan[4][:] = [clip]

def _translation_characters(spans):
    # Al reabrir, el motor PDF puede cambiar alias de fuente o redondear
    # coordenadas sin modificar el contenido visible.
    return Counter(char["c"] for span in spans for char in span["chars"] if char["c"].strip())

def _translation_unerased_items(items, written_spans, excess):
    remaining = _translation_glyphs(written_spans)
    affected = []
    matched = Counter()
    for plan in items:
        survivors = remaining & plan[5]
        if survivors:
            affected.append(plan[0]["id"])
            matched.update(glyph[0] for glyph in survivors.elements())
            remaining.subtract(survivors)
    return affected if affected and matched == excess else []


def _translation_reopen_glyphs(spans):
    # Al guardar, algunas fuentes PDF dañadas cambian de alias aunque el texto,
    # geometría, tamaño y color permanezcan iguales.
    return Counter((char["c"], round(span["size"], 2), span["color"],
                    *[round(value, 1) for value in char["origin"]])
                   for span in spans for char in span["chars"] if char["c"].strip())

def _scan_background_color(page, clip):
    margin = 2.0
    outer = (clip + (-margin, -margin, margin, margin)) & page.rect
    if outer.is_empty or outer.width <= clip.width or outer.height <= clip.height:
        raise ValueError("TRANSLATION_SCAN_COMPLEX_BACKGROUND")
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=outer, alpha=False)
    if pix.n < 3 or pix.width < 4 or pix.height < 4:
        raise ValueError("TRANSLATION_SCAN_COMPLEX_BACKGROUND")
    border = max(1, min(4, int(min(pix.width, pix.height) * 0.16)))
    samples = []
    for y in range(pix.height):
        for x in range(pix.width):
            if x < border or y < border or x >= pix.width - border or y >= pix.height - border:
                index = (y * pix.width + x) * pix.n
                samples.append(tuple(pix.samples[index + channel] for channel in range(3)))
    if len(samples) < 12:
        raise ValueError("TRANSLATION_SCAN_COMPLEX_BACKGROUND")
    channels = list(zip(*samples))
    return tuple(sorted(channel)[len(channel) // 2] / 255.0 for channel in channels)

def _scan_overlay_rect(page, clip, targets, spans):
    cover = (clip + (-0.5, -0.5, 0.5, 0.5)) & page.rect
    if cover.is_empty:
        raise ValueError("TRANSLATION_SCAN_COMPLEX_LAYOUT")
    target_origin = targets[0]["origin"][1] if targets else None
    for span in spans:
        if any(span is target for target in targets) or not span["text"].strip():
            continue
        neighbor = fitz.Rect(span["bbox"])
        if not cover.intersects(neighbor):
            continue
        if target_origin is None or abs(span["origin"][1] - target_origin) < min(span["size"], targets[0]["size"]) * 0.5:
            raise ValueError("TRANSLATION_SCAN_COMPLEX_LAYOUT")
        if span["origin"][1] > target_origin:
            cover.y1 = min(cover.y1, neighbor.y0 - 0.1)
        else:
            cover.y0 = max(cover.y0, neighbor.y1 + 0.1)
    if cover.is_empty or cover.height < clip.height * 0.65:
        raise ValueError("TRANSLATION_SCAN_COMPLEX_LAYOUT")
    return cover

def _translation_erase_rect(clip, targets, spans):
    chars = [char for span in targets for char in span["chars"] if char["c"].strip()]
    if not chars:
        raise ValueError("TRANSLATION_SOURCE_TEXT_MISMATCH")
    top = max(clip.y0, max(char["bbox"][1] for char in chars)) + 0.05
    bottom = min(clip.y1, min(char["bbox"][3] for char in chars)) - 0.05
    bands = [(top, bottom)] if bottom > top else []
    # Una franja interior elimina los glifos sin tocar las cajas de líneas vecinas.
    for span in spans:
        if any(span is target for target in targets) or not span["text"].strip():
            continue
        neighbor = fitz.Rect(span["bbox"])
        if neighbor.x1 <= clip.x0 + 0.001 or neighbor.x0 >= clip.x1 - 0.001:
            continue
        neighbor += (0, -0.05, 0, 0.05)
        bands = [(a, b) for start, end in bands
                 for a, b in [(start, min(end, neighbor.y0)), (max(start, neighbor.y1), end)] if b > a]
    if not bands:
        raise ValueError("TRANSLATION_NEIGHBOR_INTERSECTION")
    start, end = max(bands, key=lambda band: band[1] - band[0])
    if end - start <= 0.1:
        raise ValueError("TRANSLATION_NEIGHBOR_INTERSECTION")
    center, half = (start + end) / 2, min(0.5, (end - start) / 4)
    erase = fitz.Rect(clip.x0, center - half, clip.x1, center + half)
    if not all(erase.intersects(fitz.Rect(char["bbox"])) for char in chars):
        raise ValueError("TRANSLATION_NEIGHBOR_INTERSECTION")
    return erase

def _translation_text(page, clip, textpage=None):
    # Tolerancia de lectura de 0.05 pt; nunca amplía el área que se elimina.
    return _normal(page.get_textbox(clip + (-0.05, -0.05, 0.05, 0.05), textpage=textpage))

def _translation_text_from_spans(spans, clip):
    chars = []
    for span in spans:
        x0, y0, x1, y1 = span["bbox"]
        if x1 < clip.x0 or x0 > clip.x1 or y1 < clip.y0 or y0 > clip.y1:
            continue
        for char in span["chars"]:
            left, top, right, bottom = char["bbox"]
            x, y = (left + right) / 2, (top + bottom) / 2
            if clip.x0 - 0.05 <= x <= clip.x1 + 0.05 and clip.y0 - 0.05 <= y <= clip.y1 + 0.05:
                chars.append(char["c"])
    return _normal("".join(chars))

def _translation_layout(targets, item):
    layout = {"scale_x": 1.0, "scale_y": 1.0, "spacing": 0.0, "positions": None}
    if len(targets) != 1 or not item.get("origin"):
        return layout
    span = targets[0]
    metric_height = (span["ascender"] - span["descender"]) * span["size"]
    if metric_height > 0:
        scale_y = (span["bbox"][3] - span["bbox"][1]) / metric_height
        if scale_y > 0 and abs(scale_y - 1) > 0.00001:
            layout.update(scale_x=1 / scale_y, scale_y=scale_y)
    chars = span["chars"]
    gaps = [right["origin"][0] - left["bbox"][2] for left, right in zip(chars, chars[1:])]
    if gaps and max(gaps) - min(gaps) <= 0.05:
        layout["spacing"] = median(gaps)
    base = lambda value: "".join(char for char in unicodedata.normalize("NFD", value) if not unicodedata.combining(char))
    if len(chars) == len(item["translatedText"]) and base(span["text"]) == base(item["translatedText"]):
        layout["positions"] = [char["origin"] for char in chars]
    return layout

def _translation_write(page, item, clip, name, layout):
    origin, text, size = item.get("origin"), item["translatedText"], item["fontSize"]
    if not origin:
        return page.insert_textbox(clip, text, fontname=name, fontsize=size, color=tuple(item["color"]))
    morph = (fitz.Point(origin), fitz.Matrix(layout["scale_x"], layout["scale_y"]))
    if layout["positions"] is not None or abs(layout["spacing"]) > 0.01:
        for index, char in enumerate(text):
            point = layout["positions"][index] if layout["positions"] is not None else (origin[0] + layout["advances"][index], origin[1])
            page.insert_text(point, char, fontname=name, fontsize=size, color=tuple(item["color"]),
                             morph=(fitz.Point(point), morph[1]))
    else:
        page.insert_text(origin, text, fontname=name, fontsize=size, color=tuple(item["color"]), morph=morph)
    return 0

def _translation_plan(doc, item, fonts, cache):
    pno = item["pageIndex"]
    if pno < 0 or pno >= doc.page_count:
        raise ValueError("TRANSLATION_PAGE_UNAVAILABLE")
    context = _translation_page(doc, pno, cache)
    page = context["page"]
    clip = _pdf_rect(page, item["rect"])
    scan_overlay = item.get("renderMode") == "scan-overlay"
    reflow = item.get("reflow") is True
    if context["scan"] and not scan_overlay:
        raise ValueError("TRANSLATION_SCAN_REQUIRES_RECONSTRUCTION")
    if any(clip.intersects(rect) for rect in context["widgets"]):
        raise ValueError("TRANSLATION_FORM_INTERSECTION")
    matches = [span for span in context["spans"] if _normal(span.get("text", "")) == _normal(item["sourceText"])
               and all(abs(a - b) <= 0.05 for a, b in zip(span["bbox"], clip))
               and (not item.get("origin") or all(abs(a - b) <= 0.05 for a, b in zip(span["origin"], item["origin"])))]
    targets = matches or [span for span in context["spans"] if (clip + (-0.05, -0.05, 0.05, 0.05)).contains(fitz.Rect(span["bbox"]))]
    source_match = (matches and all(_normal(span["text"]) == _normal(matches[0]["text"]) and
                                    all(abs(a - b) <= 0.05 for a, b in zip(span["bbox"], matches[0]["bbox"]))
                                    for span in matches))
    actual_text = matches[0]["text"] if source_match else "".join(span["text"] for span in targets)
    if (not scan_overlay or targets) and _normal(actual_text) != _normal(item["sourceText"]):
        raise ValueError("TRANSLATION_SOURCE_TEXT_MISMATCH")
    if reflow and (scan_overlay or len({round(span["origin"][1], 1) for span in targets}) < 2):
        raise ValueError("TRANSLATION_UNSUPPORTED_REFLOW")
    background = None
    if scan_overlay:
        erase = [_scan_overlay_rect(page, clip, targets, context["spans"])]
        background = _scan_background_color(page, erase[0])
    elif reflow:
        rows = {}
        for span in targets:
            rows.setdefault(round(span["origin"][1], 1), []).append(span)
        erase = []
        for row in rows.values():
            boxes = [fitz.Rect(span["bbox"]) for span in row]
            row_clip = fitz.Rect(min(box.x0 for box in boxes), min(box.y0 for box in boxes),
                                 max(box.x1 for box in boxes), max(box.y1 for box in boxes))
            erase.append(_translation_erase_rect(row_clip, row, context["spans"]))
    else:
        erase = [_translation_erase_rect(clip, targets, context["spans"])]
    item = dict(item)
    if scan_overlay or reflow:
        # La geometría OCR puede provenir de una capa invisible. Insertar en
        # caja evita usar una línea base que no representa la imagen visible.
        item["origin"] = None
    mode = item.get("fitMode", "strict")
    composable = len(targets) >= 1 or scan_overlay
    fit_enabled = mode in ("shrink", "adaptive") and composable
    adaptive = mode == "adaptive" and composable
    original_size = targets[0]["size"] if fit_enabled and targets else item["fontSize"]
    text, size = item["translatedText"], original_size
    item["fontSize"] = size
    requested_key = item["fontKey"]
    def load_font(key):
        if key not in cache["fonts"]:
            cache["fonts"][key] = _translation_font(doc, key, fonts)
        return cache["fonts"][key]
    try:
        font, buffer, name = load_font(requested_key)
    except Exception:
        font = buffer = name = None
    source_name = str(item.get("sourceFontName", "")).lower()
    bold = any(token in source_name for token in ("bold", "black", "heavy", "semibold", "demi"))
    italic = any(token in source_name for token in ("italic", "oblique"))
    fallbacks = (["hebi", "tibi"] if bold and italic else ["hebo", "tibo"] if bold else
                 ["heit", "tiit"] if italic else ["helv", "tiro"])
    missing_glyph = font is None or any(not font.has_glyph(ord(char)) for char in text if not char.isspace())
    # Las fuentes incrustadas fragmentadas producen métricas distintas entre
    # viñetas. Una familia base equivalente conserva una lista homogénea.
    if adaptive and item.get("listItem"):
        for key in fallbacks:
            try:
                candidate = load_font(key)
                if all(candidate[0].has_glyph(ord(char)) for char in text if not char.isspace()):
                    font, buffer, name = candidate
                    item["fontKey"] = key
                    item["fontSubstituted"] = True
                    break
            except Exception:
                continue
    if missing_glyph and adaptive:
        for key in fallbacks:
            try:
                candidate = load_font(key)
                if all(candidate[0].has_glyph(ord(char)) for char in text if not char.isspace()):
                    font, buffer, name = candidate
                    item["fontKey"] = key
                    item["fontSubstituted"] = True
                    break
            except Exception:
                continue
    if font is None or any(not font.has_glyph(ord(char)) for char in text if not char.isspace()):
        raise ValueError("TRANSLATION_FONT_UNAVAILABLE")
    origin = item.get("origin")
    layout = _translation_layout(targets, item)
    def measure(candidate):
        lengths = [width * layout["scale_x"] for width in font.char_lengths(text, fontsize=size)]
        if candidate != size:
            lengths = [length * candidate / size for length in lengths]
        advances, advance = [], 0.0
        for length in lengths:
            advances.append(advance)
            advance += length + layout["spacing"]
        layout["advances"] = advances
        return (layout["positions"][-1][0] - origin[0] if layout["positions"] else advances[-1]) + lengths[-1]
    if origin:
        if "\n" in text or "\r" in text:
            raise ValueError("TRANSLATION_OVERFLOW")
        if not matches and not (clip + (-0.05, -0.05, 0.05, 0.05)).contains(fitz.Point(origin)):
            raise ValueError("TRANSLATION_ORIGIN_INVALID")
    if "probe" not in context:
        probe = fitz.open()
        context["probe"] = probe
        context["probe_page"] = probe.new_page(width=page.rect.width, height=page.rect.height)
        context["probe_fonts"] = {}
        blank = probe.get_new_xref()
        probe.update_object(blank, "<<>>")
        probe.update_stream(blank, b"")
        context["blank"] = blank
    test_page = context["probe_page"]
    if buffer:
        if item["fontKey"] not in context["probe_fonts"]:
            name = "translation_probe_" + str(len(context["probe_fonts"]))
            test_page.insert_font(fontname=name, fontbuffer=buffer)
            context["probe_fonts"][item["fontKey"]] = name
        name = context["probe_fonts"][item["fontKey"]]
    def probe(candidate):
        if origin and measure(candidate) > clip.x1 - origin[0] + 0.05:
            return None
        item["fontSize"] = candidate
        test_page.set_contents(context["blank"])
        if _translation_write(test_page, item, clip, name, layout) < 0 or _translation_text(test_page, clip) != _normal(text):
            return None
        return _translation_glyphs(_translation_spans(test_page.get_textpage()))

    original_scale_x = layout["scale_x"]
    minimum = min(size, max(size * (0.55 if adaptive else 0.8), 6.0 if adaptive else 8.0))
    def fit_current_font():
        layout["scale_x"] = original_scale_x
        item["fontSize"] = size
        inserted = probe(size)
        if inserted is None and fit_enabled and size > minimum:
            candidate = size
            if origin:
                fixed = layout["positions"][-1][0] - origin[0] if layout["positions"] else layout["spacing"] * (len(text) - 1)
                variable = measure(size) - fixed
                if variable > 0:
                    candidate = min(size, (clip.x1 - origin[0] + 0.04 - fixed) / variable * size)
            if candidate >= minimum:
                inserted = probe(candidate)
                if inserted is None:
                    inserted = probe(minimum)
                    if inserted is not None:
                        low, high = minimum, candidate
                        for _ in range(12):
                            middle = (low + high) / 2
                            if probe(middle) is None:
                                high = middle
                            else:
                                low = middle
                        inserted = probe(low)
        if inserted is None and adaptive and origin:
            current_width = measure(minimum)
            available = clip.x1 - origin[0] + 0.04
            ratio = available / current_width if current_width > 0 else 0
            if 0.68 <= ratio < 1:
                layout["scale_x"] = original_scale_x * ratio * 0.998
                inserted = probe(minimum)
        return inserted
    inserted = fit_current_font()
    if inserted is None and adaptive and reflow:
        original_clip = fitz.Rect(clip)
        padded = _translation_reflow_padding(context, clip, targets)
        if padded != clip:
            clip = padded
            item["reflowPadding"] = [round(clip.x0 - original_clip.x0, 2), round(clip.y0 - original_clip.y0, 2),
                                      round(clip.x1 - original_clip.x1, 2), round(clip.y1 - original_clip.y1, 2)]
            inserted = fit_current_font()
    if inserted is None and adaptive:
        for key in fallbacks:
            if key == item["fontKey"]:
                continue
            try:
                candidate = load_font(key)
            except Exception:
                continue
            if any(not candidate[0].has_glyph(ord(char)) for char in text if not char.isspace()):
                continue
            font, buffer, name = candidate
            inserted = fit_current_font()
            if inserted is not None:
                item["fontKey"] = key
                item["fontSubstituted"] = True
                break
    if inserted is None:
        raise ValueError("TRANSLATION_OVERFLOW")
    item["originalFontSize"] = original_size
    item["originalHorizontalScale"] = original_scale_x
    item["horizontalScale"] = layout["scale_x"]
    item["fontName"] = font.name
    item["fontSubstituted"] = bool(item.get("fontSubstituted"))
    item["adjusted"] = item["fontSize"] < original_size - 0.0001 or layout["scale_x"] < original_scale_x - 0.0001 or item["fontSubstituted"]
    return item, clip, buffer, name, erase, _translation_glyphs(targets), inserted, layout, background

def reconstruct_translated_occurrences(data_bytes, occurrences_json, fonts_json, check_only):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    occurrences = json.loads(occurrences_json)
    fonts = json.loads(fonts_json)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    cache = {"fonts": {}, "pages": {}}
    try:
        def verification_failed(page_index, stage):
            _translation_apply_diagnostic(data_bytes, occurrences,
                                          {"id": f"page:{page_index}", "pageIndex": page_index},
                                          -1, stage, "TRANSLATION_OUTPUT_UNVERIFIED")
            raise TranslationVerificationError(page_index, stage)

        by_page, checks = {}, []
        phase_started = time.perf_counter()
        def ready_check(item, planned):
            return {"id": item["id"], "status": "READY", "fontSize": planned["fontSize"],
                    "originalFontSize": planned["originalFontSize"], "adjusted": planned["adjusted"],
                    "horizontalScale": planned["horizontalScale"], "originalHorizontalScale": planned["originalHorizontalScale"],
                    "fontSubstituted": planned["fontSubstituted"], "fontName": planned["fontName"],
                    "reflowPadding": planned.get("reflowPadding", [0, 0, 0, 0])}

        def rejected_check(item, error):
            code = str(error)
            status = "FONT_UNAVAILABLE" if code == "TRANSLATION_FONT_UNAVAILABLE" else "OVERFLOW" if code == "TRANSLATION_OVERFLOW" else "UNSUPPORTED_LAYOUT"
            return {"id": item["id"], "status": status, "code": code}

        for occurrence_index, item in enumerate(occurrences):
            try:
                plan = _translation_plan(doc, item, fonts, cache)
                checks.append(ready_check(item, plan[0]))
                by_page.setdefault(item["pageIndex"], []).append(plan)
            except ValueError as error:
                if not check_only:
                    _translation_apply_diagnostic(data_bytes, occurrences, item, occurrence_index, "plan", str(error))
                    raise TranslationOccurrenceError(str(error), item, occurrence_index, "plan") from error
                checks.append(rejected_check(item, error))
        if check_only:
            by_id = {check["id"]: check for check in checks}
            ready = [item for item in occurrences if by_id[item["id"]]["status"] == "READY"]
            if len(ready) < len(occurrences):
                for _ in range(8):
                    for context in cache["pages"].values():
                        if "probe" in context:
                            context["probe"].close()
                    cache = {"fonts": cache["fonts"], "pages": {}}
                    next_ready = []
                    for item in ready:
                        try:
                            plan = _translation_plan(doc, item, fonts, cache)
                            by_id[item["id"]] = ready_check(item, plan[0])
                            next_ready.append(item)
                        except ValueError as error:
                            by_id[item["id"]] = rejected_check(item, error)
                    if len(next_ready) == len(ready):
                        break
                    ready = next_ready
                else:
                    for item in ready:
                        by_id[item["id"]] = {"id": item["id"], "status": "UNSUPPORTED_LAYOUT", "code": "TRANSLATION_PREFLIGHT_UNSTABLE"}
            checks = [by_id[item["id"]] for item in occurrences]
            return json.dumps(checks)

        _translation_apply_phase(data_bytes, occurrences, "plan", phase_started)
        phase_started = time.perf_counter()

        expected_pages = {}
        redaction_failures = []
        for pno, items in by_page.items():
            page_started = time.perf_counter()
            page = doc[pno]
            _translation_safe_erases(items, cache["pages"][pno]["spans"])
            expected = _translation_characters(cache["pages"][pno]["spans"])
            for _, _, _, _, erases, removed, _, _, background in items:
                expected.subtract(glyph[0] for glyph in removed.elements())
                for erase in erases:
                    page.add_redact_annot(erase, fill=background)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=0)
            _translation_apply_phase(data_bytes, occurrences, "redaction_page", page_started, pno)
            written_spans = _translation_spans(page.get_textpage())
            actual = _translation_characters(written_spans)
            if actual != expected:
                affected = _translation_unerased_items(items, written_spans, actual - expected) if not expected - actual else []
                if not affected:
                    verification_failed(pno, "redaction_verify")
                redaction_failures.extend((pno, identifier) for identifier in affected)
            expected_pages[pno] = expected
        if redaction_failures:
            _translation_apply_phase(data_bytes, occurrences, "redaction", phase_started)
            positions = {item["id"]: index for index, item in enumerate(occurrences)}
            for pno, identifier in redaction_failures:
                item = occurrences[positions[identifier]]
                _translation_apply_diagnostic(data_bytes, occurrences, item, positions[identifier],
                                              "redaction_verify", "TRANSLATION_NEIGHBOR_INTERSECTION")
            raise TranslationRedactionBatchError([identifier for _, identifier in redaction_failures], redaction_failures[0][0])
        _translation_apply_phase(data_bytes, occurrences, "redaction", phase_started)
        phase_started = time.perf_counter()
        for pno, items in by_page.items():
            page_started = time.perf_counter()
            page = doc[pno]
            expected = expected_pages[pno]
            font_names = {entry[4] for entry in page.get_fonts(full=True)}
            inserted_fonts = {}
            for index, (item, clip, buffer, name, _, _, inserted, layout, _) in enumerate(items):
                expected.update(char for char in item["translatedText"] if char.strip())
                if buffer:
                    if item["fontKey"] not in inserted_fonts:
                        name = "alioth_translation_" + str(index)
                        while name in font_names:
                            name += "_new"
                        font_names.add(name)
                        page.insert_font(fontname=name, fontbuffer=buffer)
                        inserted_fonts[item["fontKey"]] = name
                    name = inserted_fonts[item["fontKey"]]
                remaining = _translation_write(page, item, clip, name, layout)
                if remaining < 0:
                    occurrence_index = next((position for position, candidate in enumerate(occurrences) if candidate.get("id") == item.get("id")), -1)
                    _translation_apply_diagnostic(data_bytes, occurrences, item, occurrence_index, "write", "TRANSLATION_OVERFLOW")
                    raise TranslationOccurrenceError("TRANSLATION_OVERFLOW", item, occurrence_index, "write")

            written = _translation_spans(page.get_textpage())
            if _translation_characters(written) != expected:
                verification_failed(pno, "write_verify")
            for item, clip, *_ in items:
                if (_normal(item["translatedText"]) not in _translation_text_from_spans(written, clip)
                        and _normal(item["translatedText"]) not in _translation_text(page, clip)):
                    verification_failed(pno, "location_verify")
            _translation_apply_phase(data_bytes, occurrences, "write_page", page_started, pno)
        _translation_apply_phase(data_bytes, occurrences, "write_verify", phase_started)
        phase_started = time.perf_counter()
        output = io.BytesIO()
        # No usar clean=True: reescribe fuentes TrueType defectuosas de terceros,
        # aumenta el tiempo y puede cambiar sus alias aunque la página sea igual.
        doc.save(output, garbage=4, deflate=True)
        _translation_apply_phase(data_bytes, occurrences, "save", phase_started)
        phase_started = time.perf_counter()
        with fitz.open(stream=output.getvalue(), filetype="pdf") as reopened:
            for pno, expected in expected_pages.items():
                if _translation_characters(_translation_spans(reopened[pno].get_textpage())) != expected:
                    verification_failed(pno, "reopen_verify")
        _translation_apply_phase(data_bytes, occurrences, "reopen_verify", phase_started)
        return bytes(output.getvalue())
    finally:
        for context in cache["pages"].values():
            if "probe" in context:
                context["probe"].close()
        doc.close()

import fitz, json, re

def _translation_font_name(name):
    value = re.sub(r"[\s,_-]", "", re.sub(r"^[A-Z]{6}\+", "", name))
    return re.sub(r"(?:(?:PS)?MT|Regular)$", "", value, flags=re.I).lower()

def _translation_extract_entries(page, blocks, images=(), allow_reflow=True):
    entries = []
    bullets = ("•", "●", "◦", "▪", "*")
    backgrounds = sorted((fitz.Rect(drawing["rect"]) for drawing in page.get_drawings()
                          if drawing.get("fill") is not None and drawing.get("rect")),
                         key=lambda rect: rect.get_area())
    def background_for(span):
        box = fitz.Rect(span["bbox"])
        center = fitz.Point((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
        return next((index for index, rect in enumerate(backgrounds) if rect.contains(center)), None)
    for block_index, block in enumerate(blocks):
        if block.get("type") != 0:
            continue
        rows = []
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if not str(span.get("text", "")).strip():
                    continue
                candidate = dict(span, direction=tuple(line.get("dir", (1, 0))), blockIndex=block_index,
                                 backgroundRegion=background_for(span))
                baseline = candidate.get("origin", (0, candidate["bbox"][3]))[1]
                row = next((row for row in rows if abs(row["baseline"] - baseline) <= max(0.5, candidate.get("size", 0) * 0.12)), None)
                if row is None:
                    row = {"baseline": baseline, "spans": []}
                    rows.append(row)
                row["spans"].append(candidate)
        widths = [max(span["bbox"][2] for span in row["spans"]) -
                  min(span["bbox"][0] for span in row["spans"]) for row in rows]
        widest = max(widths, default=0)
        list_block = (len(widths) >= 3 and
                      sum(width < widest * 0.65 for width in widths) >= max(2, len(widths) * 0.35))
        for row in rows:
            visible = sorted(row["spans"], key=lambda span: span["bbox"][0])
            row_has_bullet = any(str(span.get("text", "")).strip() in bullets for span in visible)
            for span in visible:
                span["listBlock"] = list_block
            parts = []
            def flush():
                if not parts:
                    return
                first = parts[0]
                if len(parts) == 1:
                    entry = dict(first)
                    entry["listItem"] = row_has_bullet
                    entries.append(entry)
                else:
                    entry = dict(first)
                    words = [str(part["text"]).strip() for part in parts]
                    entry["text"] = ""
                    for word in words:
                        entry["text"] += ("" if not entry["text"] or word[0] in ",.;:!?)]" or
                                          entry["text"].endswith(("(", "[")) else " ") + word
                    entry["bbox"] = (min(part["bbox"][0] for part in parts), min(part["bbox"][1] for part in parts),
                                     max(part["bbox"][2] for part in parts), max(part["bbox"][3] for part in parts))
                    entry["lineGroup"] = True
                    entry["listItem"] = row_has_bullet
                    entry["selectionParts"] = list(parts)
                    entries.append(entry)
                parts.clear()
            for span in visible:
                text = str(span["text"]).strip()
                if text in bullets:
                    flush()
                    entries.append(span)
                    continue
                previous = parts[-1] if parts else None
                gap = span["bbox"][0] - previous["bbox"][2] if previous else 0
                styled = next((part for part in parts if any(char.isalnum() for char in str(part["text"]))), previous)
                previous_text = str(previous.get("text", "")).strip() if previous else ""
                # Etiquetas como "Perfil A" se almacenan con la palabra y la
                # letra en fuentes/tamaños distintos. Se reemplazan juntas para
                # no bloquear la letra contigua como si fuera texto vecino.
                label_suffix = previous and -1 <= gap <= 1 and len(previous_text) <= 16 and len(text) <= 3 and \
                    previous_text.replace(" ", "").isalpha() and text.isalpha()
                compatible = previous and previous.get("backgroundRegion") == span.get("backgroundRegion") and \
                    (-1 <= gap <= max(2, styled.get("size", 0) * 3)) and (label_suffix or
                    not any(char.isalnum() for char in text) or
                    span.get("font") == styled.get("font") and
                    abs(span.get("size", 0) - styled.get("size", 0)) <= 0.05 and
                    span.get("color") == styled.get("color") and span.get("direction") == styled.get("direction"))
                if previous and not compatible:
                    flush()
                parts.append(span)
            flush()

    grouped = []
    index = 0
    while index < len(entries):
        current = entries[index]
        run = [current]
        while index + len(run) < len(entries):
            following = entries[index + len(run)]
            previous = run[-1]
            left, top, right, bottom = previous["bbox"]
            next_left, next_top, next_right, next_bottom = following["bbox"]
            size = float(current.get("size", 0))
            if not (allow_reflow and size > 0 and current.get("direction") == (1, 0) and
                    following.get("direction") == (1, 0) and
                    (not current.get("listBlock") and not following.get("listBlock") or
                     current.get("listItem") and not following.get("listItem")) and
                    not previous["text"].rstrip().endswith((".", ":", ";", "!", "?")) and
                    not any(fitz.Rect(previous["bbox"]).intersects(image) or
                            fitz.Rect(following["bbox"]).intersects(image) for image in images) and
                    previous["text"].strip() not in bullets and
                    following["text"].strip() not in bullets and
                    abs(next_left - left) <= 2 and
                    -0.5 <= next_top - bottom <= size * 0.9 and
                    following.get("font") == current.get("font") and
                    abs(float(following.get("size", 0)) - size) <= 0.05 and
                    following.get("color") == current.get("color")):
                break
            run.append(following)
        widest = max(entry["bbox"][2] - entry["bbox"][0] for entry in run)
        paragraph_lines = all(entry["bbox"][2] - entry["bbox"][0] >= widest * 0.7 for entry in run[:-1])
        if len(run) > 1 and (paragraph_lines or current.get("listItem")) and sum(len(entry["text"].strip()) for entry in run) >= 30:
            merged = dict(current)
            merged["text"] = " ".join(entry["text"].strip() for entry in run)
            merged["bbox"] = (min(entry["bbox"][0] for entry in run),
                              min(entry["bbox"][1] for entry in run),
                              max(entry["bbox"][2] for entry in run),
                              max(entry["bbox"][3] for entry in run))
            merged["reflow"] = True
            merged["selectionParts"] = [part for entry in run for part in entry.get("selectionParts", [entry])]
            grouped.append(merged)
        else:
            grouped.extend(run)
        index += len(run)
    return grouped

def _is_translatable_text(text):
    if not text or not isinstance(text, str):
        return False
    cleaned = text.strip()
    if len(cleaned) < 2:
        return False
    letters = re.findall(r'[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]', cleaned)
    if len(letters) < 2:
        return False
    non_space = [c for c in cleaned if not c.isspace()]
    if not non_space:
        return False
    if len(letters) / len(non_space) < 0.40:
        return False
    vowels = re.findall(r'[aeiouáéíóúüAEIOUÁÉÍÓÚÜyY]', cleaned)
    if len(cleaned) <= 6 and not vowels:
        return False
    words = [w for w in re.split(r'[\s\W_]+', cleaned) if w]
    if len(words) >= 3:
        avg_len = sum(len(w) for w in words) / len(words)
        max_len = max(len(w) for w in words)
        if avg_len < 1.7 and max_len <= 2:
            return False
    return True


def _split_translation_note_line(line, raw_line):
    if not raw_line:
        return None
    source = "".join(span.get("text", "") for span in line.get("spans", []))
    chars = [(char.get("c", ""), char.get("bbox"), span)
             for span in raw_line.get("spans", []) for char in span.get("chars", [])]
    if "".join(char for char, _, _ in chars) != source:
        return None
    breaks = list(re.finditer(r'(?<=\S) {3,}(?=\S)', source))
    if not breaks:
        return None
    parts = []
    start = 0
    for match in [*breaks, None]:
        end = match.start() if match else len(source)
        while start < end and source[start].isspace():
            start += 1
        while end > start and source[end - 1].isspace():
            end -= 1
        if start < end:
            visible = [(fitz.Rect(bbox), span) for char, bbox, span in chars[start:end]
                       if not char.isspace() and bbox]
            if not visible:
                return None
            rect = fitz.Rect(visible[0][0])
            for box, _ in visible[1:]:
                rect |= box
            parts.append((source[start:end], rect, visible[0][1], [span for _, span in visible]))
        if match:
            start = match.end()
    return parts if len(parts) > 1 else None


@contextmanager
def _translation_extraction_stage(diagnostics, stage, **fields):
    if not callable(diagnostics):
        yield fields
        return
    def emit(event, **extra):
        try:
            diagnostics({"event": event, "stage": stage, **fields, **extra})
        except Exception:
            pass
    started = time.perf_counter()
    emit("extraction_stage_started")
    try:
        yield fields
    except Exception as exc:
        emit("extraction_stage_completed", status="failed", errorType=type(exc).__name__,
             durationMs=round((time.perf_counter() - started) * 1000))
        raise
    else:
        emit("extraction_stage_completed", status="ok",
             durationMs=round((time.perf_counter() - started) * 1000))


def extract_translation_notes(data_bytes, pages_json, diagnostics=None):
    data = bytes(data_bytes.to_py()) if hasattr(data_bytes, 'to_py') else bytes(data_bytes)
    result = []
    with _translation_extraction_stage(diagnostics, "native_pdf_open", byteLength=len(data)):
        document = fitz.open(stream=data, filetype="pdf")
    with document:
        selected = json.loads(pages_json)
        for pno in sorted(set(selected if selected is not None else range(len(document)))):
            if type(pno) is not int or not 0 <= pno < len(document):
                raise ValueError("TRANSLATION_PAGE_UNAVAILABLE")
            page = document[pno]
            with _translation_extraction_stage(diagnostics, "native_page_text", pageIndex=pno):
                flags = fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES
                blocks = page.get_text("dict", flags=flags).get("blocks", [])
            ocr_textpage = None
            raw_blocks = None
            with _translation_extraction_stage(diagnostics, "native_page_images", pageIndex=pno) as metric:
                images = page.get_image_info()
                metric["imageCount"] = len(images)
            if images:
                has_text = any(span.get("text", "").strip() for block in blocks
                               for line in block.get("lines", []) for span in line.get("spans", []))
                try:
                    with _translation_extraction_stage(diagnostics, "native_page_ocr", pageIndex=pno,
                                                       imageCount=len(images), ocrRegionCount=len(images) if has_text else 1):
                        ocr_textpage = page.get_textpage_ocr(flags=flags, language="spa+eng", dpi=240,
                                                             full=not has_text)
                        blocks = ocr_textpage.extractDICT().get("blocks", [])
                except Exception:
                    for image_index, image in enumerate(images):
                        rect = fitz.Rect(image["bbox"]) & page.rect
                        if rect.is_empty:
                            continue
                        result.append({"pageIndex": pno, "needsOcr": True, "imageIndex": image_index,
                                       "pageWidth": page.rect.width, "pageHeight": page.rect.height,
                                       "rect": {"x": rect.x0, "y": rect.y0, "width": rect.width, "height": rect.height}})
            with _translation_extraction_stage(diagnostics, "native_page_parse", pageIndex=pno) as metric:
                previous_count = len(result)
                widgets = [widget.rect for widget in (page.widgets() or [])]
                for block_index, block in enumerate(blocks):
                    for line_index, line in enumerate(block.get("lines", [])):
                        spans = [span for span in line.get("spans", []) if span.get("text", "")]
                        if not any(span["text"].strip() for span in spans):
                            continue
                        text = "".join(span["text"] for span in spans).strip()
                        if not _is_translatable_text(text):
                            continue
                        rect = fitz.Rect(line["bbox"])
                        if rect.is_empty or any((rect & widget).get_area() >= rect.get_area() * 0.98 for widget in widgets):
                            continue
                        first_visible = next(span for span in spans if span["text"].strip())
                        parts = [(text, rect, first_visible, spans)]
                        if re.search(r'\S {3,}\S', text):
                            if raw_blocks is None:
                                try:
                                    raw = (ocr_textpage.extractRAWDICT() if ocr_textpage else
                                           page.get_text("rawdict", flags=flags))
                                    raw_blocks = raw.get("blocks", [])
                                except Exception:
                                    raw_blocks = []
                            raw_lines = raw_blocks[block_index].get("lines", []) if block_index < len(raw_blocks) else []
                            raw_line = raw_lines[line_index] if line_index < len(raw_lines) else None
                            parts = _split_translation_note_line(line, raw_line) or parts
                        for part_index, (part_text, part_rect, first, part_spans) in enumerate(parts):
                            if not _is_translatable_text(part_text):
                                continue
                            origin = list(first.get("origin", (part_rect.x0, part_rect.y1)))
                            if len(parts) > 1:
                                origin[0] = part_rect.x0
                            result.append({"pageIndex": pno, "text": part_text,
                                           "fontName": first.get("font", ""), "fontSize": first.get("size", 12),
                                           "origin": origin,
                                           "pageWidth": page.rect.width, "pageHeight": page.rect.height,
                                           "rect": {"x": part_rect.x0, "y": part_rect.y0,
                                                    "width": part_rect.width, "height": part_rect.height},
                                           "noteBlock": (f"{pno}:{block_index}:space:{line_index}:{part_index}"
                                                         if len(parts) > 1 else f"{pno}:{block_index}"),
                                           "isScan": any(span.get("font") == "GlyphLessFont" for span in part_spans),
                                           "rotation": page.rotation})
                metric["unitCount"] = len(result) - previous_count
    return json.dumps(result)


def extract_translatable_text(data_bytes, pages_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    document = fitz.open(stream=data_bytes, filetype="pdf")
    spans = []
    font_cache = {}
    try:
        selected_pages = json.loads(pages_json)
        for pno in sorted(set(selected_pages if selected_pages is not None else range(len(document)))):
            if not isinstance(pno, int) or not 0 <= pno < len(document):
                raise ValueError("TRANSLATION_PAGE_UNAVAILABLE")
            page = document[pno]
            embedded_fonts = {}
            for entry in page.get_fonts(full=True):
                try:
                    if entry[0] not in font_cache:
                        buffer = document.extract_font(entry[0])[3]
                        font_cache[entry[0]] = fitz.Font(fontbuffer=buffer).name if buffer else ""
                    real_name = font_cache[entry[0]]
                    if real_name:
                        metadata = {"key": "embedded:" + str(entry[0]), "name": real_name}
                        embedded_fonts[_translation_font_name(entry[3])] = metadata
                        embedded_fonts[_translation_font_name(real_name)] = metadata
                except Exception:
                    pass
            images = [rect for image in page.get_images(full=True) for rect in page.get_image_rects(image[0])]
            visible_text_regions = _translation_visible_text_regions(page)
            widgets = [widget.rect for widget in (page.widgets() or [])]
            page_area = page.rect.get_area()
            image_coverage = sum((image & page.rect).get_area() for image in images)
            is_scanned_page = page_area > 0 and image_coverage >= page_area * 0.90 and not visible_text_regions
            blocks = page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES).get("blocks", [])
            has_native_text = any(str(span.get("text", "")).strip()
                                  for block in blocks if block.get("type") == 0
                                  for line in block.get("lines", []) for span in line.get("spans", []))
            if is_scanned_page and not has_native_text and hasattr(page, "get_textpage_ocr"):
                try:
                    blocks = page.get_textpage_ocr(
                        flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES,
                        language="spa+eng", dpi=240, full=True
                    ).extractDICT().get("blocks", [])
                except Exception:
                    pass
            seen = set()
            for span in _translation_extract_entries(page, blocks, images, not is_scanned_page):
                text = str(span.get("text", "")).strip()
                bbox = span.get("bbox", ())
                if not text or len(bbox) != 4 or not _is_translatable_text(text):
                    continue
                x0, y0, x1, y1 = (float(value) for value in bbox)
                if x1 <= x0 or y1 <= y0:
                    continue
                identity = (text, *(round(value, 2) for value in (x0, y0, x1, y1)))
                if identity in seen:
                    continue
                seen.add(identity)
                vector_visible = _translation_span_is_visible(span, visible_text_regions)
                color = int(span.get("color", 0))
                clip = fitz.Rect(x0, y0, x1, y1)
                font_metadata = embedded_fonts.get(_translation_font_name(str(span.get("font", ""))), {})
                selection_parts = []
                for part in span.get("selectionParts", []):
                    part_text = str(part.get("text", "")).strip()
                    px0, py0, px1, py1 = part["bbox"]
                    if part_text and px1 > px0 and py1 > py0:
                        selection_parts.append({"text": part_text, "origin": list(part["origin"]),
                                                "rect": {"x": px0, "y": py0, "width": px1 - px0, "height": py1 - py0}})
                spans.append({
                    "pageIndex": pno,
                    "text": text,
                    "fontName": str(span.get("font", "")),
                    "fontKey": font_metadata.get("key", ""),
                    "fontAlias": font_metadata.get("name", ""),
                    "fontSize": float(span.get("size", 0)),
                    "origin": list(span.get("origin", (x0, y1))),
                    "pageHeight": page.rect.height,
                    "pageWidth": page.rect.width,
                    "color": [((color >> 16) & 255) / 255.0, ((color >> 8) & 255) / 255.0, (color & 255) / 255.0],
                    "rect": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                    "overImage": not vector_visible and any(clip.intersects(image) for image in images),
                    "isFormValue": any((clip & widget).get_area() >= clip.get_area() * 0.98 for widget in widgets),
                    "isScan": is_scanned_page and not vector_visible,
                    "reflow": bool(span.get("reflow")),
                    "lineGroup": bool(span.get("lineGroup")),
                    "isListItem": bool(span.get("listItem")),
                    "selectionParts": selection_parts,
                    "rotation": page.rotation,
                    "unsupportedDirection": span.get("direction", (1, 0)) != (1, 0),
                    "isRtl": any("֐" <= char <= "ࣿ" for char in text),
                    "hasLigatures": any("ﬀ" <= char <= "ﬆ" for char in text)
                })
    finally:
        document.close()
    return json.dumps(spans)
