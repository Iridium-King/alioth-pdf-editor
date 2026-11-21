"""Suite de pruebas y benchmark sobre PDFs complejos para OCR y edición de texto.

Cubre 5 escenarios complejos:
1. PDF real complejo de laboratorio (Lapi, 140 ImageMasks 1200 DPI + JPEGs + vectores) cuando existe localmente.
2. PDF híbrido multipágina (página digital con tabla + página escaneada 300 DPI con 2 columnas y acentos + página rotada 90°).
3. Reporte denso de 8 páginas con >300 líneas vectoriales, fondos de color, negrita/cursiva/acentos y /Contents+/Resources compartidos (incluye benchmark de latencia).
4. PDF con Form XObject, gráficos con transparencia y párrafo multilínea denso.
5. PDF mixto (imagen + capa OCR 3 Tr + encabezado nativo visible): verifica aislamiento estricto entre ruta nativa y ruta OCR.
"""
import base64
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest

import fitz
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "js" / "engine"))

import text_splice

LAPI_PDF_PATH = Path(
    r"C:\Users\Alioth.Gomezm\.gemini\antigravity\brain\1f654352-c0e0-4501-a2ec-cd96484ecdd2\.user_uploaded\media_1795225015436_8d2acdbc.pdf"
)


def _load_reflow_fn():
    capture = """
        global.window = {};
        require('./js/python_manager.js');
        const manager = window.PythonManager;
        manager.isLoaded = true;
        console.log = () => {};
        manager.run = async (program) => {
            process.stdout.write(program);
            return JSON.stringify({pdf: ''});
        };
        manager.applyReflowEdit(new ArrayBuffer(0), 0, {});
    """
    code = subprocess.check_output(["node", "-e", capture], cwd=ROOT, encoding="utf-8")
    definitions, marker, _ = code.rpartition("apply_reflow_edit(js_data, js_pno, js_edit, js_original)")
    if not marker:
        raise ValueError("No se encontró el punto de entrada de apply_reflow_edit")
    scope = {}
    exec(compile(definitions, "apply_reflow_edit", "exec"), scope)
    return scope["apply_reflow_edit"]


def _build_heavy_vector_report(pages_count=8):
    """Genera un PDF complejo de 8 páginas con >300 trazos vectoriales, fondos, estilos y página compartida."""
    doc = fitz.open()
    for pno in range(pages_count):
        page = doc.new_page(width=612, height=792)
        # Banda de encabezado y celdas con color de fondo
        page.draw_rect(fitz.Rect(36, 36, 576, 72), color=None, fill=(0.90, 0.94, 0.99))
        page.draw_rect(fitz.Rect(36, 90, 576, 114), color=(0.75, 0.82, 0.90), fill=(0.95, 0.97, 1.0), width=0.5)
        # Rejilla densa: >40 líneas vectoriales por página (>320 en 8 páginas)
        for row in range(18):
            y = 120 + row * 32
            page.draw_line(fitz.Point(36, y), fitz.Point(576, y), color=(0.78, 0.80, 0.84), width=0.5)
        for col_x in (36, 210, 390, 576):
            page.draw_line(fitz.Point(col_x, 90), fitz.Point(col_x, 664), color=(0.70, 0.74, 0.80), width=0.6)
        for tick in range(12):
            tx = 50 + tick * 42
            page.draw_line(fitz.Point(tx, 680), fitz.Point(tx + 20, 680), color=(0.2, 0.4, 0.7), width=1.0)

        page.insert_text(fitz.Point(44, 58), f"Resumen Clínico Página {pno + 1}", fontname="hebo", fontsize=14, color=(0.08, 0.16, 0.35))
        page.insert_text(fitz.Point(44, 106), "Parámetro Evaluado", fontname="hebo", fontsize=10, color=(0.1, 0.1, 0.1))
        page.insert_text(fitz.Point(220, 106), "Resultado", fontname="heit", fontsize=10, color=(0.1, 0.1, 0.1))
        page.insert_text(fitz.Point(400, 106), "Observación", fontname="hebo", fontsize=10, color=(0.1, 0.1, 0.1))

        page.insert_text(fitz.Point(44, 142), "Evaluación Inicial", fontname="helv", fontsize=11, color=(0.0, 0.0, 0.0))
        page.insert_text(fitz.Point(220, 142), "Negativo", fontname="helv", fontsize=11, color=(0.05, 0.45, 0.2))
        page.insert_text(fitz.Point(400, 142), "Sin hallazgos agudos", fontname="helv", fontsize=11, color=(0.2, 0.2, 0.2))
        page.insert_text(fitz.Point(44, 174), "Glucosa Sérica (ayuno)", fontname="helv", fontsize=11, color=(0.0, 0.0, 0.0))
        page.insert_text(fitz.Point(44, 206), "Colesterol Total", fontname="helv", fontsize=11, color=(0.0, 0.0, 0.0))
        page.insert_text(fitz.Point(44, 710), "Pie protegido con descenders: gyqpj", fontname="helv", fontsize=10, color=(0.3, 0.3, 0.3))

    # Compartir /Contents y heredar /Resources entre página 0 y página 1 para probar aislamiento
    p0 = doc[0]
    p1 = doc[1]
    res0 = doc.xref_get_key(p0.xref, "Resources")[1]
    cont0 = doc.xref_get_key(p0.xref, "Contents")[1]
    parent = int(doc.xref_get_key(p0.xref, "Parent")[1].split()[0])
    doc.xref_set_key(parent, "Resources", res0)
    doc.xref_set_key(p1.xref, "Contents", cont0)
    doc.xref_set_key(p1.xref, "Resources", "null")
    doc.xref_set_key(p0.xref, "Resources", "null")
    return doc.tobytes()


def _build_form_xobject_and_alpha_pdf():
    """Genera un PDF con Form XObject embebido, rectángulo semitransparente y párrafo denso."""
    # Crear página fuente para el Form XObject
    src_doc = fitz.open()
    src_page = src_doc.new_page(width=180, height=50)
    src_page.draw_rect(fitz.Rect(2, 2, 178, 48), color=(0.1, 0.3, 0.7), fill=(0.92, 0.96, 1.0), width=1.2)
    src_page.insert_text(fitz.Point(12, 30), "SELLO FORM XOBJECT", fontname="hebo", fontsize=11, color=(0.1, 0.25, 0.6))

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.show_pdf_page(fitz.Rect(390, 40, 570, 90), src_doc, 0)
    src_doc.close()

    # Gráfico con transparencia
    page.draw_rect(fitz.Rect(40, 120, 540, 150), color=None, fill=(1.0, 0.92, 0.35), fill_opacity=0.28)
    page.insert_text(fitz.Point(50, 140), "Objetivo Editable Sobre Transparencia", fontname="helv", fontsize=12, color=(0.1, 0.1, 0.1))

    # Párrafo denso multilínea debajo
    para_lines = [
        "Primera línea del párrafo denso con descenders gypqj.",
        "Segunda línea intermedia que se reemplazará en bloque.",
        "Tercera línea final que debe permanecer completamente intacta.",
    ]
    y = 200
    for line in para_lines:
        page.insert_text(fitz.Point(50, y), line, fontname="helv", fontsize=11, color=(0.0, 0.0, 0.0))
        y += 16

    return doc.tobytes()


def _build_hybrid_multipage_pdf():
    """Página 0 digital, Página 1 escaneo 300 DPI de 2 columnas con acentos, Página 2 escaneo rotado 90°."""
    # Renderizar página 1 como imagen pura (2 columnas)
    tmp = fitz.open()
    p_src = tmp.new_page(width=612, height=792)
    p_src.insert_text(fitz.Point(48, 90), "Diagnóstico Clínico", fontname="hebo", fontsize=18)
    p_src.insert_text(fitz.Point(48, 130), "Árbol Médico: áéíóúñü", fontname="helv", fontsize=14)
    p_src.insert_text(fitz.Point(340, 90), "Sección Derecha", fontname="hebo", fontsize=18)
    p_src.insert_text(fitz.Point(340, 130), "Folio 2026 Clínica", fontname="helv", fontsize=14)
    pix1 = p_src.get_pixmap(dpi=300, colorspace=fitz.csRGB, alpha=False)

    p_rot_src = tmp.new_page(width=792, height=612)
    p_rot_src.insert_text(fitz.Point(70, 120), "REPORTE ROTADO 90", fontname="hebo", fontsize=22)
    pix2 = p_rot_src.get_pixmap(dpi=300, colorspace=fitz.csRGB, alpha=False)
    tmp.close()

    doc = fitz.open()
    # Página 0: digital nativa
    p0 = doc.new_page(width=612, height=792)
    p0.draw_rect(fitz.Rect(40, 40, 560, 140), color=(0.2, 0.2, 0.2), width=1.0)
    p0.insert_text(fitz.Point(55, 75), "Tabla de Resultados Digitales", fontname="hebo", fontsize=14)
    p0.insert_text(fitz.Point(55, 110), "Paciente Control: 100 mg/dL", fontname="helv", fontsize=12)

    # Página 1: imagen pura sin texto
    p1 = doc.new_page(width=612, height=792)
    p1.insert_image(p1.rect, pixmap=pix1)

    # Página 2: imagen escaneada con /Rotate 90 para mostrarse horizontalmente
    p2 = doc.new_page(width=612, height=792)
    p2.insert_image(fitz.Rect(0, 0, 612, 792), pixmap=pix2, rotate=90)
    p2.set_rotation(90)
    return doc.tobytes()


class ComplexPdfOcrAndEditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reflow = staticmethod(_load_reflow_fn())

    def _run_fixture3_benchmark(self, reflow_callable, label, binary_return=False):
        original = _build_heavy_vector_report(pages_count=8)
        with fitz.open(stream=original, filetype="pdf") as d0:
            p1_pixels_before = d0[1].get_pixmap().samples
            drawings_before = len(d0[0].get_drawings())
        self.assertGreater(drawings_before, 20)

        timings = []
        current_bytes = original
        edits = [
            ("Evaluación Inicial", "Evaluación Final"),
            ("Negativo", "Positivo"),
            ("Sin hallazgos agudos", "Seguimiento normal"),
            ("Glucosa Sérica (ayuno)", "Glucosa Postprandial"),
            ("Colesterol Total", "Perfil Lipídico"),
        ]

        for old_txt, new_txt in edits:
            with fitz.open(stream=current_bytes, filetype="pdf") as doc:
                page = doc[0]
                before_snapshot = current_bytes
                span = None
                for b in page.get_text("dict")["blocks"]:
                    if b["type"] != 0:
                        continue
                    for l in b["lines"]:
                        for s in l["spans"]:
                            if old_txt in s["text"]:
                                span = s
                                break
                        if span:
                            break
                    if span:
                        break
                self.assertIsNotNone(span, f"No se encontró span '{old_txt}'")

                t0 = time.perf_counter()
                ok, _ = text_splice.remove_spans(doc, page, [span])
                self.assertTrue(ok)
                working = doc.tobytes(garbage=0, deflate=False)
                t_splice = (time.perf_counter() - t0) * 1000.0

                x0, y0, x1, y1 = span["bbox"]
                edit_dict = {
                    "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                    "text": new_txt, "size": span["size"],
                    "font": "helv", "origin": span["origin"],
                    "targetSpans": [span], "isSurgical": True,
                    "skipErase": True, "bgColor": "transparent",
                    "eraseBgColor": "#ffffff",
                }
                if binary_return:
                    edit_dict["_binaryReturn"] = True
                t1 = time.perf_counter()
                res = reflow_callable(working, 0, json.dumps(edit_dict), before_snapshot)
                t_reflow = (time.perf_counter() - t1) * 1000.0
                timings.append((t_splice, t_reflow, t_splice + t_reflow))
                if binary_return:
                    current_bytes = res["pdf_bytes"]
                else:
                    current_bytes = base64.b64decode(json.loads(res)["pdf"])

        avg_splice = sum(t[0] for t in timings) / len(timings)
        avg_reflow = sum(t[1] for t in timings) / len(timings)
        avg_total = sum(t[2] for t in timings) / len(timings)
        print(
            f"\n[{label}] edits={len(timings)} "
            f"avg_splice={avg_splice:.1f}ms avg_reflow_validate={avg_reflow:.1f}ms avg_total={avg_total:.1f}ms"
        )

        with fitz.open(stream=current_bytes, filetype="pdf") as final_doc:
            p0_text = final_doc[0].get_text()
            for old_txt, new_txt in edits:
                self.assertNotIn(old_txt, p0_text)
                self.assertIn(new_txt, p0_text)
            self.assertIn("Pie protegido con descenders: gyqpj", p0_text)
            self.assertGreaterEqual(len(final_doc[0].get_drawings()), drawings_before)
            self.assertEqual(final_doc[1].get_pixmap().samples, p1_pixels_before)
            self.assertIn("Evaluación Inicial", final_doc[1].get_text())

    def test_fixture3_heavy_vector_report_edit_and_benchmark(self):
        self._run_fixture3_benchmark(self.reflow, "BENCHMARK Fixture3 8p-vector", binary_return=False)

    def test_fixture4_form_xobject_alpha_and_dense_paragraph(self):
        original = _build_form_xobject_and_alpha_pdf()
        with fitz.open(stream=original, filetype="pdf") as doc:
            page = doc[0]
            td = page.get_text("dict")
            target = None
            for b in td["blocks"]:
                if b["type"] != 0:
                    continue
                for l in b["lines"]:
                    for s in l["spans"]:
                        if "Segunda línea intermedia" in s["text"]:
                            target = s
                            break
                    if target:
                        break
                if target:
                    break
            self.assertIsNotNone(target)
            ok, _ = text_splice.remove_spans(doc, page, [target])
            self.assertTrue(ok)
            working = doc.tobytes(garbage=0, deflate=False)

        x0, y0, x1, y1 = target["bbox"]
        payload = json.dumps({
            "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
            "text": "Segunda línea actualizada con éxito.",
            "size": target["size"], "font": "helv", "origin": target["origin"],
            "targetSpans": [target], "isSurgical": True, "skipErase": True,
            "bgColor": "transparent", "eraseBgColor": "#ffffff",
        })
        res = json.loads(self.reflow(working, 0, payload, original))
        candidate = base64.b64decode(res["pdf"])

        with fitz.open(stream=candidate, filetype="pdf") as out:
            txt = out[0].get_text()
            self.assertNotIn("Segunda línea intermedia", txt)
            self.assertIn("Segunda línea actualizada con éxito.", txt)
            self.assertIn("Primera línea del párrafo denso", txt)
            self.assertIn("Tercera línea final", txt)
            self.assertIn("SELLO FORM XOBJECT", txt)
            self.assertIn("Objetivo Editable Sobre Transparencia", txt)

    @unittest.skipUnless(LAPI_PDF_PATH.exists(), "Requiere el PDF real Lapi local")
    def test_fixture1_real_lapi_pdf_ocr_accuracy_alignment_and_pixel_identity(self):
        import _ocr_service
        if not _ocr_service.list_windows_ocr_languages():
            self.skipTest("Windows OCR sin idiomas instalados")
        raw = LAPI_PDF_PATH.read_bytes()
        with fitz.open(stream=raw, filetype="pdf") as orig_doc:
            self.assertEqual(orig_doc[0].get_text().strip(), "")
            orig_images = len(orig_doc[0].get_images(full=True))
            orig_drawings = len(orig_doc[0].get_drawings())
            pix_before = orig_doc[0].get_pixmap(dpi=150, colorspace=fitz.csRGB, alpha=False)
            img_before = Image.frombytes("RGB", (pix_before.width, pix_before.height), pix_before.samples)

        out_bytes, stats = _ocr_service.apply_ocr_to_pdf(
            raw, page_indices=[0], lang="es", dpi=300, skip_digital=True,
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertEqual(stats["processed_pages"], [0])
        self.assertGreater(stats["words_inserted"], 40)

        with fitz.open(stream=out_bytes, filetype="pdf") as ocr_doc:
            page = ocr_doc[0]
            txt = page.get_text()
            for expected in ("MUÑOZ", "760666", "Coprocultivo", "Negativo", "Universidad", "08770043", "catalogo.consultaema.mx"):
                self.assertIn(expected, txt)

            # Todas las letras agregadas deben ser invisibles (alpha == 0 / texttrace type == 3)
            spans = [s for b in page.get_text("dict")["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"]]
            self.assertTrue(spans)
            self.assertTrue(all(s.get("alpha", 255) == 0 for s in spans))
            traces = page.get_texttrace()
            self.assertTrue(traces and all(t["type"] == 3 for t in traces))

            # Alineación geométrica real: el bbox de "Negativo" debe contener píxeles oscuros visibles en la imagen original
            hits = page.search_for("Negativo")
            self.assertEqual(len(hits), 2)
            for hrect in hits:
                ix = fitz.IRect((hrect * fitz.Matrix(150 / 72.0, 150 / 72.0)))
                crop = img_before.crop((max(0, ix.x0), max(0, ix.y0), min(img_before.width, ix.x1), min(img_before.height, ix.y1)))
                extrema = crop.convert("L").getextrema()
                self.assertLess(extrema[0], 120, f"Bbox {hrect} no coincide visualmente con 'Negativo'")

            # Recursos intactos e imagen visual idéntica píxel a píxel
            self.assertEqual(len(page.get_images(full=True)), orig_images)
            self.assertEqual(len(page.get_drawings()), orig_drawings)
            pix_after = page.get_pixmap(dpi=150, colorspace=fitz.csRGB, alpha=False)
            img_after = Image.frombytes("RGB", (pix_after.width, pix_after.height), pix_after.samples)
            self.assertIsNone(ImageChops.difference(img_before, img_after).getbbox())

    def test_fixture2_hybrid_multipage_and_rotated_ocr(self):
        import _ocr_service
        if not _ocr_service.list_windows_ocr_languages():
            self.skipTest("Windows OCR sin idiomas instalados")
        raw = _build_hybrid_multipage_pdf()
        out_bytes, stats = _ocr_service.apply_ocr_to_pdf(
            raw, page_indices=None, lang="es", dpi=300, skip_digital=True,
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertEqual(stats["skipped_pages"], [0])
        self.assertEqual(stats["processed_pages"], [1, 2])

        with fitz.open(stream=out_bytes, filetype="pdf") as doc:
            # Página 0 intacta (solo texto visible nativo)
            p0_spans = [s for b in doc[0].get_text("dict")["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"]]
            self.assertTrue(all(s.get("alpha", 255) == 255 for s in p0_spans))
            self.assertIn("Tabla de Resultados Digitales", doc[0].get_text())

            # Página 1 escaneada con dos columnas y acentos
            p1_txt = doc[1].get_text()
            self.assertIn("Diagnóstico", p1_txt)
            self.assertIn("áéíóúñü", p1_txt)
            self.assertIn("Sección Derecha", p1_txt)

            # Página 2 rotada 90° alineada
            p2_hits = doc[2].search_for("REPORTE")
            self.assertTrue(p2_hits, "No se encontró 'REPORTE' en página rotada 90°")

    def test_fixture5_mixed_sandwich_firewall(self):
        import _ocr_service
        import ocr_edit

        # Construir imagen con dos palabras y superponer encabezado nativo visible
        img_doc = fitz.open()
        ip = img_doc.new_page(width=400, height=200)
        ip.insert_text(fitz.Point(40, 120), "PalabraOCR", fontname="hebo", fontsize=16, color=(0, 0, 0))
        ip.insert_text(fitz.Point(210, 120), "VecinoOCR", fontname="hebo", fontsize=16, color=(0, 0, 0))
        pix = ip.get_pixmap(dpi=200, colorspace=fitz.csRGB, alpha=False)
        img_doc.close()

        doc = fitz.open()
        page = doc.new_page(width=400, height=200)
        page.insert_image(fitz.Rect(0, 60, 400, 190), pixmap=pix)
        page.insert_text(fitz.Point(40, 35), "ENCABEZADO NATIVO VISIBLE", fontname="hebo", fontsize=14, color=(0.1, 0.2, 0.6))
        base_pdf = doc.tobytes()
        doc.close()

        # Inyectar capa OCR simulando palabras detectadas sobre la imagen
        sandwich_pdf, _ = _ocr_service.inject_ocr_layer_with_stats(
            base_pdf,
            [{
                "page": 0,
                "words": [
                    {"text": "PalabraOCR", "bbox": [40.0, 122.0, 145.0, 142.0], "color": "#000000"},
                    {"text": "VecinoOCR", "bbox": [210.0, 122.0, 310.0, 142.0], "color": "#000000"},
                ],
            }],
            font_dir=str(ROOT / "fonts" / "fallback"),
        )

        # 1. Editar encabezado nativo con ruta nativa text_splice.py: no debe tocar capa OCR ni imagen
        with fitz.open(stream=sandwich_pdf, filetype="pdf") as d_nat:
            p = d_nat[0]
            nat_span = next(
                s for b in p.get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "ENCABEZADO" in s["text"] and s.get("alpha", 255) == 255
            )
            self.assertFalse(ocr_edit.is_ocr_hidden_span(p, nat_span))
            ok, _ = text_splice.remove_spans(d_nat, p, [nat_span])
            self.assertTrue(ok)
            p.insert_text(fitz.Point(*nat_span["origin"]), "ENCABEZADO EDITADO", fontname="hebo", fontsize=14, color=(0.1, 0.2, 0.6))
            after_nat = d_nat.tobytes()

        with fitz.open(stream=after_nat, filetype="pdf") as d_chk1:
            txt1 = d_chk1[0].get_text()
            self.assertIn("ENCABEZADO EDITADO", txt1)
            self.assertNotIn("ENCABEZADO NATIVO VISIBLE", txt1)
            self.assertIn("PalabraOCR", txt1)
            self.assertIn("VecinoOCR", txt1)

        # 2. Editar palabra OCR con ocr_edit.py: elimina span 3 Tr viejo, parchea pixels y escribe texto visible
        with fitz.open(stream=after_nat, filetype="pdf") as d_ocr:
            p = d_ocr[0]
            ocr_span = next(
                s for b in p.get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "PalabraOCR" in s["text"]
            )
            self.assertTrue(ocr_edit.is_ocr_hidden_span(p, ocr_span))
            r = fitz.Rect(ocr_span["bbox"])
            ocr_edit.replace_ocr_region(
                d_ocr, p, r, r, "NuevoTexto",
                font_name="helv", font_size=14, rgb_text=(0.0, 0.0, 0.0), rgb_bg=(1.0, 1.0, 1.0),
            )
            after_ocr = d_ocr.tobytes()

        with fitz.open(stream=after_ocr, filetype="pdf") as d_chk2:
            txt2 = d_chk2[0].get_text()
            self.assertNotIn("PalabraOCR", txt2)
            self.assertIn("NuevoTexto", txt2)
            self.assertIn("VecinoOCR", txt2)
            self.assertIn("ENCABEZADO EDITADO", txt2)
            new_span = next(
                s for b in d_chk2[0].get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "NuevoTexto" in s["text"]
            )
            self.assertEqual(new_span.get("alpha", 255), 255)

    def test_ci_ocr_layer_injection_pixel_identity_and_rotation(self):
        import _ocr_service

        raw = _build_hybrid_multipage_pdf()
        before_imgs = []
        with fitz.open(stream=raw, filetype="pdf") as d_before:
            for p in d_before:
                pix = p.get_pixmap(dpi=120, colorspace=fitz.csRGB, alpha=False)
                before_imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))

        out_bytes, stats = _ocr_service.inject_ocr_layer_with_stats(
            raw,
            [
                {
                    "page": 1,
                    "words": [
                        {"text": "Diagnóstico", "bbox": [48.0, 74.0, 160.0, 96.0], "color": "#000000"},
                        {"text": "áéíóúñü", "bbox": [125.0, 118.0, 195.0, 134.0], "color": "#000000"},
                        {"text": "Derecha", "bbox": [415.0, 74.0, 495.0, 96.0], "color": "#000000"},
                    ],
                },
                {
                    "page": 2,
                    "words": [
                        {"text": "REPORTE", "bbox": [70.0, 100.0, 180.0, 126.0], "color": "#000000"},
                    ],
                },
            ],
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertEqual(stats["pages_modified"], [1, 2])
        self.assertEqual(stats["words_inserted"], 4)

        with fitz.open(stream=out_bytes, filetype="pdf") as d_after:
            for idx, page in enumerate(d_after):
                pix_a = page.get_pixmap(dpi=120, colorspace=fitz.csRGB, alpha=False)
                img_a = Image.frombytes("RGB", (pix_a.width, pix_a.height), pix_a.samples)
                self.assertIsNone(ImageChops.difference(before_imgs[idx], img_a).getbbox())
            self.assertIn("Diagnóstico", d_after[1].get_text())
            self.assertIn("áéíóúñü", d_after[1].get_text())
            p2_hits = d_after[2].search_for("REPORTE")
            self.assertTrue(p2_hits)
            for idx in (1, 2):
                streams = b"\n".join(d_after.xref_stream(xref) for xref in d_after[idx].get_contents())
                self.assertIn(b"/AliothOCR", streams)
                traces = d_after[idx].get_texttrace()
                self.assertTrue(traces and all(t["type"] == 3 for t in traces))

    def test_ci_proxy_reflow_callable_font_cache_and_binary_return(self):
        import _proxy

        fn = _proxy._load_reflow_callable()
        self.assertTrue(callable(fn))
        self._run_fixture3_benchmark(fn, "BENCHMARK Fixture3 proxy-native", binary_return=True)

        font_path = ROOT / "fonts" / "fallback" / "LiberationSans-Regular.ttf"
        font_b64 = base64.b64encode(font_path.read_bytes()).decode("ascii")
        ck = "ci_test_liberation_regular"
        with _proxy._REFLOW_LOCK:
            _proxy._REFLOW_FONT_CACHE.pop(ck, None)

        cached, missing = _proxy._ingest_reflow_fonts({"fontCacheKey": ck})
        self.assertEqual(cached, [])
        self.assertEqual(missing, [ck])

        cached2, missing2 = _proxy._ingest_reflow_fonts({"fontCacheKey": ck, "fontBuffer": font_b64})
        self.assertEqual(cached2, [ck])
        self.assertEqual(missing2, [])

        cached3, missing3 = _proxy._ingest_reflow_fonts({"fontCacheKey": ck})
        self.assertEqual(cached3, [ck])
        self.assertEqual(missing3, [])

    def test_ci_ocr_edit_bytes_roundtrip_and_isolation(self):
        import _ocr_service
        import ocr_edit

        doc = fitz.open()
        page = doc.new_page(width=420, height=200)
        page.insert_text(fitz.Point(30, 35), "REPORTE OFICIAL", fontname="hebo", fontsize=14, color=(0.1, 0.2, 0.5))
        base_pdf = doc.tobytes()
        doc.close()

        sandwich, _ = _ocr_service.inject_ocr_layer_with_stats(
            base_pdf,
            [{
                "page": 0,
                "words": [
                    {"text": "OCRViejo", "bbox": [30.0, 90.0, 120.0, 110.0], "color": "#000000"},
                    {"text": "OtroOCR", "bbox": [220.0, 90.0, 310.0, 110.0], "color": "#000000"},
                ],
            }],
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        with fitz.open(stream=sandwich, filetype="pdf") as d_pre:
            ocr_span = next(
                s for b in d_pre[0].get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "OCRViejo" in s["text"]
            )
            self.assertTrue(ocr_edit.is_ocr_hidden_span(d_pre[0], ocr_span))
            x0, y0, x1, y1 = ocr_span["bbox"]

        edited_bytes, meta = ocr_edit.apply_ocr_text_edit_bytes(
            sandwich,
            0,
            {
                "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                "eraseFullX": x0, "eraseFullY": y0, "eraseFullW": x1 - x0, "eraseFullH": y1 - y0,
                "text": "Diagnóstico rápido",
                "size": 14,
                "color": "#112233",
                "eraseBgColor": "#ffffff",
                "targetSpans": [ocr_span],
            },
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertIn("overflow", meta)
        with fitz.open(stream=edited_bytes, filetype="pdf") as d_out:
            txt = d_out[0].get_text()
            self.assertNotIn("OCRViejo", txt)
            self.assertIn("Diagnóstico rápido", txt)
            self.assertIn("OtroOCR", txt)
            self.assertIn("REPORTE OFICIAL", txt)
            vis = next(
                s for b in d_out[0].get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "Diagnóstico" in s["text"]
            )
            self.assertEqual(vis.get("alpha", 255), 255)

    def test_ci_ocr_service_bold_injection_and_column_split(self):
        import _ocr_service

        doc = fitz.open()
        doc.new_page(width=612, height=792)
        blank_pdf = doc.tobytes()
        doc.close()

        out_bytes, stats = _ocr_service.inject_ocr_layer_with_stats(
            blank_pdf,
            [{
                "page": 0,
                "lines": [[
                    {"text": "NOMBRE", "bbox": [36.0, 134.5, 85.0, 143.8], "color": "#000000", "is_bold": True},
                    {"text": "COMPLETO", "bbox": [89.0, 134.5, 160.0, 143.8], "color": "#000000", "is_bold": True},
                    {"text": "meses", "bbox": [164.0, 137.0, 198.0, 143.8], "color": "#000000", "is_bold": True},
                    {"text": "Metepec", "bbox": [512.0, 134.5, 555.0, 144.2], "color": "#000000", "is_bold": False},
                ]],
            }],
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertEqual(stats["words_inserted"], 4)

        with fitz.open(stream=out_bytes, filetype="pdf") as d_out:
            spans = [
                sp
                for b in d_out[0].get_text("rawdict")["blocks"]
                if b["type"] == 0
                for ln in b["lines"]
                for sp in ln["spans"]
            ]
            by_txt = {}
            for sp in spans:
                txt = (sp.get("text") or "".join(c.get("c", "") for c in sp.get("chars", [])))
                by_txt[txt.strip()] = (txt, sp)

            self.assertTrue(bool(by_txt["NOMBRE"][1]["flags"] & 16))
            self.assertTrue(bool(by_txt["COMPLETO"][1]["flags"] & 16))
            self.assertTrue(bool(by_txt["meses"][1]["flags"] & 16))
            self.assertFalse(bool(by_txt["Metepec"][1]["flags"] & 16))
            # Columna izquierda NO debe llevar espacio puenteando hacia la columna derecha
            self.assertEqual(by_txt["meses"][0], "meses")
            # Todas las palabras de la corrida comparten misma baseline (origin[1]) y tamaño real >= 8.5pt
            self.assertLessEqual(abs(by_txt["NOMBRE"][1]["origin"][1] - by_txt["meses"][1]["origin"][1]), 0.5)
            self.assertGreaterEqual(by_txt["meses"][1]["size"], 8.5)

    def test_ci_ocr_watermark_preserving_inpainting_bold_and_baseline(self):
        import io
        from PIL import ImageDraw, ImageFont
        import _ocr_service
        import ocr_edit

        bold_ttf = ROOT / "fonts" / "fallback" / "LiberationSans-Bold.ttf"
        dpi = 250
        w_pt, h_pt = 420.0, 160.0
        w_px, h_px = int(w_pt * dpi / 72.0), int(h_pt * dpi / 72.0)

        img = Image.new("RGB", (w_px, h_px), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        # Círculo marca de agua color durazno detrás de la mitad derecha del texto
        cx, cy, rad = int(w_px * 0.62), int(h_px * 0.50), int(h_px * 0.38)
        draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=(253, 231, 210))

        font_px = int(round(12.0 * dpi / 72.0))
        pil_font = ImageFont.truetype(str(bold_ttf), font_px)
        text_x_px, text_y_px = int(w_px * 0.12), int(h_px * 0.36)
        old_text = "FIN: 05/05/1989 Edad: 36 años 7 meses"
        draw.text((text_x_px, text_y_px), old_text, fill=(15, 15, 15), font=pil_font)

        # Medir bbox real de tinta oscura en el scan sintético
        gray = img.convert("L")
        pxs = gray.load()
        dark_xs = [x for y in range(h_px) for x in range(w_px) if pxs[x, y] < 100]
        dark_ys = [y for y in range(h_px) for x in range(w_px) if pxs[x, y] < 100]
        bx0 = min(dark_xs) * 72.0 / dpi
        by0 = min(dark_ys) * 72.0 / dpi
        bx1 = (max(dark_xs) + 1) * 72.0 / dpi
        by1 = (max(dark_ys) + 1) * 72.0 / dpi

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        scan_doc = fitz.open()
        scan_pg = scan_doc.new_page(width=w_pt, height=h_pt)
        scan_pg.insert_image(scan_pg.rect, stream=buf.getvalue())
        scan_pdf = scan_doc.tobytes()
        scan_doc.close()

        sandwich, _ = _ocr_service.inject_ocr_layer_with_stats(
            scan_pdf,
            [{
                "page": 0,
                "lines": [[{
                    "text": old_text,
                    "bbox": [bx0, by0, bx1, by1],
                    "color": "#000000",
                    "is_bold": True,
                    "fontsize": 12.0,
                }]],
            }],
            font_dir=str(ROOT / "fonts" / "fallback"),
        )

        with fitz.open(stream=sandwich, filetype="pdf") as d_pre:
            ocr_span = next(
                s for b in d_pre[0].get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "Edad:" in s["text"]
            )
            orig_oy = float(ocr_span["origin"][1])

        edited_bytes, meta = ocr_edit.apply_ocr_text_edit_bytes(
            sandwich,
            0,
            {
                "x": bx0, "y": by0, "w": bx1 - bx0, "h": by1 - by0,
                "eraseFullX": bx0, "eraseFullY": by0, "eraseFullW": bx1 - bx0, "eraseFullH": by1 - by0,
                "text": "F/N: 05/05/1989 Edad: 36",
                "size": 12.0,
                "color": "#000000",
                "eraseBgColor": "#ffffff",
                "isBold": True,
                "origin": [bx0, orig_oy],
                "targetSpans": [ocr_span],
            },
            font_dir=str(ROOT / "fonts" / "fallback"),
        )
        self.assertFalse(meta.get("overflow"))

        with fitz.open(stream=edited_bytes, filetype="pdf") as d_after:
            pg = d_after[0]
            vis = next(
                s for b in pg.get_text("dict")["blocks"] if b["type"] == 0
                for l in b["lines"] for s in l["spans"]
                if "F/N:" in s["text"]
            )
            self.assertEqual(vis.get("alpha", 255), 255)
            self.assertTrue(bool(vis["flags"] & 16), "Texto editado debe conservar peso Bold")
            self.assertLessEqual(abs(float(vis["origin"][1]) - orig_oy), 1.5)

            # Verificar que no quedan píxeles oscuros del texto anterior a la derecha del nuevo texto ni debajo
            tail_probe = fitz.Rect(bx1 - 65.0, by0 - 1.0, bx1 + 2.0, by1 + 2.0)
            pix_tail = pg.get_pixmap(clip=tail_probe, dpi=200, colorspace=fitz.csRGB, alpha=False)
            ts = pix_tail.samples
            peach_count = 0
            pure_white_count = 0
            dark_stray = 0
            for i in range(0, len(ts), 3):
                r, g, b = ts[i], ts[i + 1], ts[i + 2]
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                if lum < 140:
                    dark_stray += 1
                elif r >= 245 and 220 <= g <= 245 and 200 <= b <= 230 and (r - b) >= 18:
                    peach_count += 1
                elif r >= 253 and g >= 253 and b >= 253:
                    pure_white_count += 1
            self.assertEqual(dark_stray, 0, "No deben quedar píxeles oscuros del texto antiguo")
            self.assertGreater(peach_count, pure_white_count * 2, "Debe preservar el círculo durazno sin cuadro blanco")


if __name__ == "__main__":
    unittest.main()
