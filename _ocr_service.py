"""Servicio aislado de OCR para Alioth PDF Editor.

Usa Windows.Media.Ocr nativo (0 MB adicionales en el portable, ejecución por lote en un
único subproceso oculto) e inyecta una capa de texto invisible (render_mode=3) alineada
por línea base y escalada horizontalmente (morph) sin alterar imágenes ni texto nativo.
"""
import json
import os
from pathlib import Path
import statistics
import subprocess
import tempfile
import threading

import fitz

_LANG_CACHE = None
_LANG_LOCK = threading.Lock()
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _isolate_resources(doc, page):
    """Localiza los recursos heredados antes de registrar la fuente OCR en la página."""
    node = page.xref
    seen = set()
    while node not in seen:
        seen.add(node)
        kind, value = doc.xref_get_key(node, "Resources")
        if kind != "null":
            break
        kind, parent = doc.xref_get_key(node, "Parent")
        if kind == "null":
            return
        if kind != "xref":
            raise ValueError("Referencia Parent inválida en la página")
        node = int(parent.split()[0])
    else:
        raise ValueError("Referencia circular en los recursos de la página")

    if kind == "xref":
        value = doc.xref_object(int(value.split()[0]))
    elif kind != "dict":
        raise ValueError("Diccionario de recursos inválido")
    if not value.lstrip().startswith("<<"):
        raise ValueError("Diccionario de recursos inválido")
    doc.xref_set_key(page.xref, "Resources", value)
    for group in ("Font", "ExtGState", "XObject"):
        key = "Resources/" + group
        kind, value = doc.xref_get_key(page.xref, key)
        if kind == "xref":
            group_dict = doc.xref_object(int(value.split()[0]))
            if not group_dict.lstrip().startswith("<<"):
                raise ValueError("Diccionario de recursos inválido: " + group)
            doc.xref_set_key(page.xref, key, group_dict)


def list_windows_ocr_languages(force_refresh=False):
    """Lista los paquetes de idioma disponibles en Windows.Media.Ocr."""
    global _LANG_CACHE
    with _LANG_LOCK:
        if _LANG_CACHE is not None and not force_refresh:
            return list(_LANG_CACHE)

    if os.name != "nt":
        with _LANG_LOCK:
            _LANG_CACHE = []
        return []

    ps_script = r"""
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object {
        @{ tag = $_.LanguageTag; name = $_.DisplayName }
    })
    @{ ok = $true; langs = $langs } | ConvertTo-Json -Depth 4 -Compress
} catch {
    @{ ok = $false; langs = @() } | ConvertTo-Json -Depth 3 -Compress
}
"""
    langs = []
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", ps_script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            creationflags=_CREATE_NO_WINDOW,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            payload = json.loads(proc.stdout.strip().splitlines()[-1])
            raw_langs = payload.get("langs") or []
            if isinstance(raw_langs, dict):
                raw_langs = [raw_langs]
            for item in raw_langs:
                if isinstance(item, dict) and item.get("tag"):
                    langs.append({"tag": str(item["tag"]), "name": str(item.get("name") or item["tag"])})
    except Exception:
        langs = []

    with _LANG_LOCK:
        _LANG_CACHE = list(langs)
    return list(langs)


def resolve_windows_ocr_language(requested_lang, available_langs):
    """Mapea códigos ('es', 'spa', 'en', 'eng', 'spa+eng', 'auto') al mejor tag instalado."""
    tags = []
    for item in (available_langs or []):
        if isinstance(item, dict) and item.get("tag"):
            tags.append(str(item["tag"]))
        elif isinstance(item, str) and item.strip():
            tags.append(item.strip())
    if not tags:
        return None

    req = (requested_lang or "es").strip().lower()
    lower_map = {t.lower(): t for t in tags}

    if req in lower_map:
        return lower_map[req]

    def _pick(prefixes):
        for pref in prefixes:
            if pref in lower_map:
                return lower_map[pref]
        for pref in prefixes:
            base = pref.split("-")[0]
            for t in tags:
                tl = t.lower()
                if tl == base or tl.startswith(base + "-"):
                    return t
        return None

    if req in ("es", "spa", "es+en", "spa+eng", "auto"):
        hit = _pick(["es-mx", "es-es", "es-419", "es"])
        if hit:
            return hit
        if req in ("es", "spa"):
            return None
        if req in ("es+en", "spa+eng", "auto"):
            hit_en = _pick(["en-us", "en-gb", "en"])
            if hit_en:
                return hit_en
    elif req in ("en", "eng"):
        return _pick(["en-us", "en-gb", "en"])
    else:
        return _pick([req])

    return tags[0]


def page_has_native_text(page, min_words=3):
    """Devuelve True si la página tiene >= min_words palabras visibles (excluye capa OCR alpha==0)."""
    count = 0
    try:
        td = page.get_text("dict")
    except Exception:
        return False
    for block in td.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if span.get("alpha", 255) == 0:
                    continue
                for token in (span.get("text") or "").split():
                    if len(token.strip()) >= 3:
                        count += 1
                        if count >= min_words:
                            return True
    return False


def _hex_to_rgb(color_hex):
    s = (color_hex or "#000000").strip().lstrip("#")
    if len(s) != 6:
        return (0.0, 0.0, 0.0)
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except Exception:
        return (0.0, 0.0, 0.0)


def _analyze_word_ink(pil_img, px0, py0, pw, ph, sx_pt=None, sy_pt=None):
    """Analiza tinta real, bbox apretado y grosor de trazo de una palabra a resolución nativa."""
    fallback = {"color": "#000000"}
    if pil_img is None:
        return fallback
    try:
        iw, ih = pil_img.size
        x0 = max(0, min(iw - 1, int(px0) - 1))
        y0 = max(0, min(ih - 1, int(py0) - 1))
        x1 = max(x0 + 1, min(iw, int(px0 + max(1.0, pw)) + 2))
        y1 = max(y0 + 1, min(ih, int(py0 + max(1.0, ph)) + 2))
        crop = pil_img.crop((x0, y0, x1, y1))
        cw, ch = crop.size
        if cw < 1 or ch < 1:
            return fallback

        rgb_pixels = list(crop.get_flattened_data() if hasattr(crop, "get_flattened_data") else crop.getdata())
        gray_crop = crop.convert("L")
        pxs = list(gray_crop.get_flattened_data() if hasattr(gray_crop, "get_flattened_data") else gray_crop.getdata())
        if not pxs:
            return fallback

        bdr = []
        for c in range(cw):
            bdr.append(pxs[c])
            bdr.append(pxs[(ch - 1) * cw + c])
        for r in range(ch):
            bdr.append(pxs[r * cw])
            bdr.append(pxs[r * cw + (cw - 1)])
        bdr_sorted = sorted(bdr)
        bg_lum = bdr_sorted[int(len(bdr_sorted) * 0.7)]
        mn = min(pxs)
        mx = max(pxs)
        is_light_bg = bg_lum >= 128

        if is_light_bg:
            thr = bg_lum - max(35.0, (bg_lum - mn) * 0.45)
        else:
            thr = bg_lum + max(35.0, (mx - bg_lum) * 0.45)

        xs = []
        ys = []
        ink_rgbs = []
        runs = []
        for r in range(ch):
            row_off = r * cw
            run = 0
            for c in range(cw):
                lum = pxs[row_off + c]
                is_ink = (lum < thr) if is_light_bg else (lum > thr)
                if is_ink:
                    xs.append(c)
                    ys.append(r)
                    rgb = rgb_pixels[row_off + c]
                    ink_rgbs.append((lum, rgb[0], rgb[1], rgb[2]))
                    run += 1
                else:
                    if run > 0:
                        runs.append(run)
                        run = 0
            if run > 0:
                runs.append(run)

        if not xs:
            return fallback

        ink_rgbs.sort(key=lambda t: t[0], reverse=(not is_light_bg))
        sample_n = max(1, int(len(ink_rgbs) * 0.4))
        top_ink = ink_rgbs[:sample_n]
        mr_c = int(statistics.median([t[1] for t in top_ink]))
        mg_c = int(statistics.median([t[2] for t in top_ink]))
        mb_c = int(statistics.median([t[3] for t in top_ink]))
        color_hex = f"#{mr_c:02x}{mg_c:02x}{mb_c:02x}"

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        iw_px = max_x - min_x + 1
        ih_px = max_y - min_y + 1
        dens = len(xs) / max(1, iw_px * ih_px)
        runs_f = [r_len for r_len in runs if r_len <= iw_px * 0.7] or runs
        mean_run = (sum(runs_f) / len(runs_f)) if runs_f else 0.0

        res = {
            "color": color_hex,
            "ink_dens": round(dens, 4),
            "ink_mean_run": round(mean_run, 3),
            "ink_h_px": ih_px,
        }
        if sx_pt is not None and sy_pt is not None:
            res["ink_bbox"] = [
                round((x0 + min_x) * sx_pt, 3),
                round((y0 + min_y) * sy_pt, 3),
                round((x0 + max_x + 1) * sx_pt, 3),
                round((y0 + max_y + 1) * sy_pt, 3),
            ]
        return res
    except Exception:
        return fallback


def _sample_word_ink_hex(pil_img, px0, py0, pw, ph):
    """Muestrea el color más contrastante respecto al borde dentro de la caja de palabra."""
    return _analyze_word_ink(pil_img, px0, py0, pw, ph).get("color", "#000000")


def ocr_pages_windows(pdf_bytes, page_indices=None, lang="es", dpi=300, skip_digital=True):
    """Ejecuta Windows.Media.Ocr en un único subproceso PowerShell por lote sobre páginas PDF."""
    langs = list_windows_ocr_languages()
    if not langs:
        raise RuntimeError("WINDOWS_OCR_UNAVAILABLE")

    lang_tag = resolve_windows_ocr_language(lang, langs)
    if not lang_tag:
        raise RuntimeError("WINDOWS_OCR_UNAVAILABLE")

    dpi = max(72, min(400, int(dpi or 300)))
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total_pages = len(doc)
        if page_indices is None:
            target_pages = list(range(total_pages))
        else:
            seen = set()
            target_pages = []
            for pno in page_indices:
                idx = int(pno)
                if idx < 0 or idx >= total_pages:
                    raise ValueError(f"Índice de página fuera de rango: {idx}")
                if idx not in seen:
                    seen.add(idx)
                    target_pages.append(idx)

        skipped_pages = []
        pages_to_ocr = []
        for pno in target_pages:
            if skip_digital and page_has_native_text(doc[pno]):
                skipped_pages.append(pno)
            else:
                pages_to_ocr.append(pno)

        if not pages_to_ocr:
            return {
                "ok": True,
                "engine": "windows-ocr",
                "lang_used": lang_tag,
                "pages_words": [],
                "skipped_pages": skipped_pages,
                "processed_pages": [],
            }

        with tempfile.TemporaryDirectory(prefix="alioth_ocr_") as tmpdir:
            jobs = []
            for pno in pages_to_ocr:
                page = doc[pno]
                max_side_pt = max(1.0, page.rect.width, page.rect.height)
                eff_dpi = min(dpi, max(72, int(3600.0 * 72.0 / max_side_pt)))
                pix = page.get_pixmap(dpi=eff_dpi, colorspace=fitz.csRGB, alpha=False)
                png_path = os.path.join(tmpdir, f"page_{pno}.png")
                pix.save(png_path)
                jobs.append({
                    "page": pno,
                    "path": png_path,
                    "eff_dpi_x": pix.width / max(1.0, page.rect.width / 72.0),
                    "eff_dpi_y": pix.height / max(1.0, page.rect.height / 72.0),
                })

            manifest_path = os.path.join(tmpdir, "manifest.json")
            out_path = os.path.join(tmpdir, "ocr_out.json")
            Path(manifest_path).write_text(
                json.dumps({"lang": lang_tag, "jobs": jobs}, ensure_ascii=False),
                encoding="utf-8",
            )

            ps_script = r"""
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]

$manifest = Get-Content -LiteralPath $env:ALIOTH_OCR_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json
$langObj = [Windows.Globalization.Language]::new($manifest.lang)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw "WINDOWS_OCR_UNAVAILABLE" }

$results = @()
foreach ($job in $manifest.jobs) {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($job.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        } finally {
            if ($bitmap) { $bitmap.Dispose() }
        }
    } finally {
        if ($stream) { $stream.Dispose() }
    }
    $linesOut = @()
    foreach ($line in $res.Lines) {
        $wordsOut = @()
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            $wordsOut += @{
                t = $w.Text
                x = [Math]::Round($r.X, 2)
                y = [Math]::Round($r.Y, 2)
                w = [Math]::Round($r.Width, 2)
                h = [Math]::Round($r.Height, 2)
            }
        }
        if ($wordsOut.Count -gt 0) {
            $linesOut += ,@($wordsOut)
        }
    }
    $results += @{ page = [int]$job.page; lines = $linesOut }
}
$json = @{ lang = $engine.RecognizerLanguage.LanguageTag; pages = $results } | ConvertTo-Json -Depth 7 -Compress
[System.IO.File]::WriteAllText($env:ALIOTH_OCR_OUT, $json, [System.Text.UTF8Encoding]::new($false))
"""
            env = dict(os.environ, ALIOTH_OCR_MANIFEST=manifest_path, ALIOTH_OCR_OUT=out_path)
            timeout_s = max(30, 15 * len(jobs))
            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command", ps_script],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_s,
                env=env,
                creationflags=_CREATE_NO_WINDOW,
            )
            if proc.returncode != 0 or not os.path.exists(out_path):
                raise RuntimeError("WINDOWS_OCR_FAILED: " + (proc.stderr or proc.stdout or "").strip()[:300])

            raw_out = json.loads(Path(out_path).read_text(encoding="utf-8"))
            job_by_page = {j["page"]: j for j in jobs}
            pages_words = []

            try:
                from PIL import Image
            except Exception:
                Image = None

            for page_entry in (raw_out.get("pages") or []):
                pno = int(page_entry["page"])
                j = job_by_page[pno]
                sx_pt = 72.0 / j["eff_dpi_x"]
                sy_pt = 72.0 / j["eff_dpi_y"]
                pil_img = Image.open(j["path"]).convert("RGB") if Image is not None else None
                try:
                    lines_converted = []
                    for line_words in (page_entry.get("lines") or []):
                        if isinstance(line_words, dict):
                            line_words = [line_words]
                        w_list = []
                        for w in line_words:
                            txt = str(w.get("t") or "").strip()
                            if not txt:
                                continue
                            px, py, pw, ph = float(w["x"]), float(w["y"]), float(w["w"]), float(w["h"])
                            ink = _analyze_word_ink(pil_img, px, py, pw, ph, sx_pt=sx_pt, sy_pt=sy_pt) if pil_img is not None else {"color": "#000000"}
                            word_entry = {
                                "text": txt,
                                "bbox": [
                                    round(px * sx_pt, 3),
                                    round(py * sy_pt, 3),
                                    round((px + pw) * sx_pt, 3),
                                    round((py + ph) * sy_pt, 3),
                                ],
                                "color": ink.get("color", "#000000"),
                            }
                            if "ink_bbox" in ink:
                                word_entry["ink_bbox"] = ink["ink_bbox"]
                            if "ink_dens" in ink:
                                word_entry["ink_dens"] = ink["ink_dens"]
                                word_entry["ink_mean_run"] = ink["ink_mean_run"]
                                word_entry["ink_h_px"] = ink["ink_h_px"]
                            w_list.append(word_entry)
                        if w_list:
                            lines_converted.append(w_list)
                finally:
                    if pil_img is not None:
                        pil_img.close()

                pages_words.append({"page": pno, "lines": lines_converted})

            return {
                "ok": True,
                "engine": "windows-ocr",
                "lang_used": raw_out.get("lang") or lang_tag,
                "pages_words": pages_words,
                "skipped_pages": skipped_pages,
                "processed_pages": pages_to_ocr,
            }
    finally:
        doc.close()


def _group_flat_words_into_lines(words):
    """Agrupa palabras planas en líneas ordenadas de arriba hacia abajo y de izquierda a derecha."""
    valid = []
    for w in words:
        txt = str(w.get("text") or "").strip()
        bbox = w.get("bbox") or []
        if not txt or len(bbox) != 4:
            continue
        x0, y0, x1, y1 = [float(v) for v in bbox]
        if x1 <= x0 or y1 <= y0:
            continue
        item = {
            "text": txt,
            "bbox": [x0, y0, x1, y1],
            "color": w.get("color", "#000000"),
            "fontsize": w.get("fontsize"),
        }
        for extra_k in ("ink_bbox", "ink_dens", "ink_mean_run", "ink_h_px", "is_bold"):
            if extra_k in w:
                item[extra_k] = w[extra_k]
        valid.append(item)
    valid.sort(key=lambda it: ((it["bbox"][1] + it["bbox"][3]) * 0.5, it["bbox"][0]))

    lines = []
    for w in valid:
        cy = (w["bbox"][1] + w["bbox"][3]) * 0.5
        wh = max(1.0, w["bbox"][3] - w["bbox"][1])
        placed = False
        for line in reversed(lines[-5:]):
            lcy = sum((x["bbox"][1] + x["bbox"][3]) * 0.5 for x in line) / len(line)
            lh = sum(max(1.0, x["bbox"][3] - x["bbox"][1]) for x in line) / len(line)
            if abs(cy - lcy) <= 0.45 * min(wh, lh):
                line.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])

    for line in lines:
        line.sort(key=lambda it: it["bbox"][0])
    return lines


def _normalize_pages_words(pages_words):
    """Acepta lista por página ({page, lines}|{page, words}) o lista plana de items ({text, bbox, page})."""
    if not pages_words:
        return {}
    if isinstance(pages_words, list) and all(isinstance(x, dict) and "text" in x and "bbox" in x for x in pages_words):
        by_page = {}
        for item in pages_words:
            pno = int(item.get("page", 0))
            by_page.setdefault(pno, []).append(item)
        return {pno: _group_flat_words_into_lines(ws) for pno, ws in by_page.items()}

    normalized = {}
    for entry in pages_words:
        pno = int(entry.get("page", 0))
        if "lines" in entry and entry["lines"] is not None:
            lines = []
            for ln in entry["lines"]:
                clean_ln = [w for w in ln if str(w.get("text") or "").strip() and len(w.get("bbox") or []) == 4]
                if clean_ln:
                    lines.append(clean_ln)
            normalized[pno] = lines
        elif "words" in entry and entry["words"] is not None:
            normalized[pno] = _group_flat_words_into_lines(entry["words"])
    return normalized


_DESCENDER_CHARS = set("gjpqyQ,;()[]{}")
_UPPER_ACCENT_CHARS = set("ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇ")
_ASCENDER_EXTRA = set("bdfhklt¡!¿?()[]{}/\\áéíóúñü")


def _word_box(word):
    b = word.get("ink_bbox") or word["bbox"]
    return [float(b[0]), float(b[1]), float(b[2]), float(b[3])]


def _split_line_into_column_runs(line_words):
    """Divide una línea OCR en corridas horizontales separadas cuando hay saltos entre columnas."""
    ordered = sorted(
        [w for w in line_words if str(w.get("text") or "").strip() and len(w.get("bbox") or []) == 4],
        key=lambda w: _word_box(w)[0],
    )
    if len(ordered) <= 1:
        return [ordered] if ordered else []

    heights = [max(1.0, _word_box(w)[3] - _word_box(w)[1]) for w in ordered]
    med_h = statistics.median(heights)
    max_gap = max(18.0, med_h * 2.5)

    runs = [[ordered[0]]]
    for w in ordered[1:]:
        prev_x1 = _word_box(runs[-1][-1])[2]
        curr_x0 = _word_box(w)[0]
        if (curr_x0 - prev_x1) > max_gap:
            runs.append([w])
        else:
            runs[-1].append(w)
    return runs


def _classify_run_bold(run_words):
    """Determina is_bold por palabra a partir del grosor de trazo medido en la imagen fuente."""
    if not run_words:
        return []
    if all(w.get("is_bold") is not None for w in run_words):
        return [bool(w.get("is_bold")) for w in run_words]

    cap_px_vals = [
        float(w["ink_h_px"])
        for w in run_words
        if w.get("ink_h_px") and any(c.isupper() or c.isdigit() or c in _ASCENDER_EXTRA for c in str(w.get("text") or ""))
    ]
    all_px_vals = [float(w["ink_h_px"]) for w in run_words if w.get("ink_h_px")]
    line_cap_px = statistics.median(cap_px_vals) if cap_px_vals else (max(all_px_vals) if all_px_vals else 1.0)
    cap_pts = [
        max(1.0, _word_box(w)[3] - _word_box(w)[1])
        for w in run_words
        if any(c.isupper() or c.isdigit() or c in _ASCENDER_EXTRA for c in str(w.get("text") or ""))
    ]
    cap_pt = statistics.median(cap_pts) if cap_pts else 8.0

    raw_flags = []
    confident = []
    for w in run_words:
        if w.get("is_bold") is not None:
            raw_flags.append(bool(w["is_bold"]))
            confident.append(True)
            continue
        dens = w.get("ink_dens")
        mean_run = w.get("ink_mean_run")
        if dens is None or mean_run is None:
            raw_flags.append(False)
            confident.append(True)
            continue
        dens_f = float(dens)
        ih_px = float(w.get("ink_h_px") or line_cap_px or 1.0)
        denom = max(line_cap_px * 0.90, min(ih_px, line_cap_px * 1.08), 1.0)
        sr = float(mean_run) / denom
        is_b = (dens_f >= 0.365 and sr >= 0.205) or (dens_f >= 0.415 and sr >= 0.175) or (sr >= 0.25 and dens_f >= 0.28)
        raw_flags.append(bool(is_b))
        alnum_cnt = sum(1 for ch in str(w.get("text") or "") if ch.isalnum())
        confident.append(alnum_cnt >= 3)

    gap_thr = max(8.0, cap_pt * 1.1)
    smoothed = list(raw_flags)
    for i in range(len(run_words)):
        if confident[i]:
            continue
        b_cur = _word_box(run_words[i])
        neighbors = []
        if i > 0:
            b_prev = _word_box(run_words[i - 1])
            if (b_cur[0] - b_prev[2]) < gap_thr:
                neighbors.append((raw_flags[i - 1], confident[i - 1]))
        if i + 1 < len(run_words):
            b_next = _word_box(run_words[i + 1])
            if (b_next[0] - b_cur[2]) < gap_thr:
                neighbors.append((raw_flags[i + 1], confident[i + 1]))
        if len(neighbors) == 2 and neighbors[0][0] == neighbors[1][0]:
            smoothed[i] = neighbors[0][0]
        elif len(neighbors) == 1 and neighbors[0][1]:
            smoothed[i] = neighbors[0][0]
    return smoothed


def _compute_run_typography(run_words):
    """Calcula la línea base común y el tamaño tipográfico real (em pt) de una corrida OCR."""
    no_desc_bases = []
    all_bases = []
    for w in run_words:
        txt = str(w.get("text") or "").strip()
        _, y0, _, y1 = _word_box(w)
        h = max(1.0, y1 - y0)
        if any(c in _DESCENDER_CHARS for c in txt):
            all_bases.append(y1 - 0.21 * h)
        else:
            no_desc_bases.append(y1)
            all_bases.append(y1)

    line_y_base = statistics.median(no_desc_bases) if no_desc_bases else statistics.median(all_bases)

    high_conf_fs = []
    all_fs = []
    for w in run_words:
        if w.get("fontsize"):
            val = float(w["fontsize"])
            if val > 0:
                high_conf_fs.append(val)
                all_fs.append(val)
            continue
        txt = str(w.get("text") or "").strip()
        _, y0, _, y1 = _word_box(w)
        asc_h = max(1.0, line_y_base - y0)
        if any(c in _UPPER_ACCENT_CHARS for c in txt):
            est = asc_h / 0.90
            high_conf_fs.append(est)
        elif any(c.isupper() or c.isdigit() or c in _ASCENDER_EXTRA for c in txt):
            est = asc_h / 0.72
            high_conf_fs.append(est)
        else:
            est = asc_h / 0.53
        all_fs.append(est)

    raw_fs = statistics.median(high_conf_fs) if high_conf_fs else statistics.median(all_fs)
    line_fs = max(5.0, min(72.0, raw_fs))
    return line_y_base, line_fs


def _resolve_ocr_font_path(font_dir=None, bold=False):
    fname = "LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"
    candidates = []
    if font_dir:
        candidates.append(os.path.join(font_dir, fname))
    here = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(here, "fonts", "fallback", fname))
    for p in candidates:
        if p and os.path.isfile(p):
            return p
    return None


def inject_ocr_layer_with_stats(pdf_bytes, pages_words, font_dir=None):
    """Inyecta una capa de texto invisible (3 Tr) sin alterar imágenes ni streams previos."""
    by_page = _normalize_pages_words(pages_words)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    words_inserted = 0
    pages_modified = []
    try:
        had_existing_fonts = any(bool(doc[i].get_fonts()) for i in range(len(doc)))
        ttf_reg = _resolve_ocr_font_path(font_dir, bold=False)
        ttf_bold = _resolve_ocr_font_path(font_dir, bold=True)
        fobj_reg = fitz.Font(fontfile=ttf_reg) if ttf_reg else fitz.Font("helv")
        fobj_bold = fitz.Font(fontfile=ttf_bold) if ttf_bold else fitz.Font("hebo")
        reg_name_default = "AliothOCRFont" if ttf_reg else "helv"
        bold_name_default = "AliothOCRFontBold" if ttf_bold else "hebo"
        any_bold_pages = False
        any_reg_pages = False

        for pno, lines in sorted(by_page.items()):
            if pno < 0 or pno >= len(doc) or not lines:
                continue
            page = doc[pno]
            _isolate_resources(doc, page)
            before_xrefs = set(page.get_contents() or [])

            prepared_runs = []
            has_reg_words = False
            has_bold_words = False
            for line_words in lines:
                for run_words in _split_line_into_column_runs(line_words):
                    line_y_base, line_fs = _compute_run_typography(run_words)
                    bold_flags = _classify_run_bold(run_words)
                    for bflag in bold_flags:
                        if bflag:
                            has_bold_words = True
                        else:
                            has_reg_words = True
                    prepared_runs.append((run_words, line_y_base, line_fs, bold_flags))

            if has_bold_words:
                any_bold_pages = True
            if has_reg_words or not has_bold_words:
                any_reg_pages = True

            used_reg_name = reg_name_default
            used_reg_fobj = fobj_reg
            if ttf_reg and (has_reg_words or not has_bold_words):
                try:
                    page.insert_font(fontname=reg_name_default, fontfile=ttf_reg)
                except Exception:
                    used_reg_name = "helv"
                    used_reg_fobj = fitz.Font("helv")

            used_bold_name = bold_name_default
            used_bold_fobj = fobj_bold
            if has_bold_words and ttf_bold:
                try:
                    page.insert_font(fontname=bold_name_default, fontfile=ttf_bold)
                except Exception:
                    used_bold_name = "hebo"
                    used_bold_fobj = fitz.Font("hebo")

            sh = page.new_shape()
            page_word_count = 0
            for run_words, line_y_base, line_fs, bold_flags in prepared_runs:
                for idx, (word, is_bold) in enumerate(zip(run_words, bold_flags)):
                    raw_text = str(word.get("text") or "").strip()
                    if not raw_text:
                        continue
                    x0, y0, x1, y1 = _word_box(word)
                    box_w = max(1.0, x1 - x0)
                    y_base = max(y0 + 1.0, min(y1 + 2.0, line_y_base))
                    fs = float(word.get("fontsize") or line_fs)
                    if fs <= 0:
                        fs = line_fs

                    w_font_name = used_bold_name if is_bold else used_reg_name
                    w_fobj = used_bold_fobj if is_bold else used_reg_fobj
                    try:
                        nat_w = w_fobj.text_length(raw_text, fontsize=fs)
                    except Exception:
                        nat_w = len(raw_text) * fs * 0.5
                    if not nat_w or nat_w <= 0:
                        nat_w = max(0.5, len(raw_text) * fs * 0.5)
                    sx = max(0.35, min(3.0, box_w / max(nat_w, 0.5)))

                    insert_str = raw_text + (" " if idx < len(run_words) - 1 else "")
                    pt = fitz.Point(x0, y_base)
                    rgb_ink = _hex_to_rgb(word.get("color"))
                    sh.insert_text(
                        pt,
                        insert_str,
                        fontname=w_font_name,
                        fontsize=fs,
                        color=rgb_ink,
                        render_mode=3,
                        morph=(pt, fitz.Matrix(sx, 1.0)),
                    )
                    page_word_count += 1

            if page_word_count == 0:
                continue

            sh.commit(overlay=True)
            after_xrefs = list(page.get_contents() or [])
            new_xrefs = [xr for xr in after_xrefs if xr not in before_xrefs]
            for nx in new_xrefs:
                try:
                    raw_stream = doc.xref_stream(nx)
                    if b"BT" in raw_stream and b"/AliothOCR" not in raw_stream:
                        wrapped = b"/AliothOCR << /Type /OCR >> BDC\n" + raw_stream + b"\nEMC\n"
                        doc.update_stream(nx, wrapped)
                except Exception:
                    pass

            words_inserted += page_word_count
            pages_modified.append(pno)

        if ((any_reg_pages and ttf_reg) or (any_bold_pages and ttf_bold)) and not had_existing_fonts and pages_modified:
            try:
                doc.subset_fonts()
            except Exception:
                pass

        out_bytes = doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()

    # Verificar que el PDF resultante abre limpio
    with fitz.open(stream=out_bytes, filetype="pdf") as check_doc:
        if len(check_doc) < 1:
            raise RuntimeError("El PDF resultante del OCR quedó vacío")

    return out_bytes, {
        "pages_modified": pages_modified,
        "words_inserted": words_inserted,
    }


def inject_ocr_layer(pdf_bytes, pages_words, font_dir=None):
    out_bytes, _ = inject_ocr_layer_with_stats(pdf_bytes, pages_words, font_dir=font_dir)
    return out_bytes


def check_pdf_protection(pdf_bytes):
    """Detecta si el PDF está cifrado o contiene firmas digitales que se invalidarían."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None
    try:
        if getattr(doc, "is_encrypted", False) or getattr(doc, "needs_pass", False):
            return "PDF_ENCRYPTED"
        for page in doc:
            for w in page.widgets():
                if getattr(w, "is_signed", False) or getattr(w, "field_type", None) == getattr(fitz, "PDF_WIDGET_TYPE_SIGNATURE", 6):
                    return "PDF_SIGNED"
        for i in range(1, doc.xref_length()):
            try:
                keys = doc.xref_get_keys(i)
                if "ByteRange" in keys and "Contents" in keys:
                    return "PDF_SIGNED"
            except Exception:
                pass
        return None
    finally:
        try:
            doc.close()
        except Exception:
            pass


def apply_ocr_to_pdf(pdf_bytes, page_indices=None, lang="es", dpi=300, skip_digital=True, font_dir=None):
    """Ejecuta Windows OCR y agrega la capa invisible sin alterar contenido existente."""
    prot = check_pdf_protection(pdf_bytes)
    if prot == "PDF_SIGNED":
        raise ValueError("PDF_HAS_SIGNATURE")
    if prot == "PDF_ENCRYPTED":
        raise ValueError("PDF_IS_ENCRYPTED")

    ocr_res = ocr_pages_windows(
        pdf_bytes,
        page_indices=page_indices,
        lang=lang,
        dpi=dpi,
        skip_digital=skip_digital,
    )
    pages_words = ocr_res.get("pages_words") or []
    if not pages_words:
        return pdf_bytes, {
            "engine": ocr_res.get("engine", "windows-ocr"),
            "lang_used": ocr_res.get("lang_used"),
            "skipped_pages": ocr_res.get("skipped_pages", []),
            "processed_pages": [],
            "words_inserted": 0,
        }

    out_bytes, inj_stats = inject_ocr_layer_with_stats(pdf_bytes, pages_words, font_dir=font_dir)
    return out_bytes, {
        "engine": ocr_res.get("engine", "windows-ocr"),
        "lang_used": ocr_res.get("lang_used"),
        "skipped_pages": ocr_res.get("skipped_pages", []),
        "processed_pages": ocr_res.get("processed_pages", []),
        "words_inserted": inj_stats["words_inserted"],
    }
