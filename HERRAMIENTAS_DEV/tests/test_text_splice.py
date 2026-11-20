"""
Test suite nativo para el motor text_splice y anclaje de origin.
Verifica:
1. Remoción quirúrgica de texto en /Contents stream.
2. Invarianza de líneas vecinas con descenders/ascenders.
3. Preservación micrométrica de baseline (delta <= 0.05 pt).
"""
import unittest
import os, sys
import fitz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "js", "engine")))
import text_splice

class TestTextSplice(unittest.TestCase):
    def test_single_span_removal(self):
        doc = fitz.open()
        page = doc.new_page(width=400, height=200)
        page.insert_text(fitz.Point(50, 50), "Line One with g, p, y", fontname="helv", fontsize=12)
        page.insert_text(fitz.Point(50, 70), "Line Two to be removed", fontname="helv", fontsize=12)
        page.insert_text(fitz.Point(50, 90), "Line Three intact", fontname="helv", fontsize=12)
        
        td = page.get_text("dict")
        spans = [s for b in td["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"]]
        self.assertEqual(len(spans), 3)
        target = spans[1] # "Line Two to be removed"
        
        ok, info = text_splice.remove_spans(doc, page, [target])
        self.assertTrue(ok)
        self.assertGreater(info["glyphs_removed"], 0)
        
        # Verify page text
        text_remaining = page.get_text("text")
        self.assertIn("Line One with g, p, y", text_remaining)
        self.assertNotIn("Line Two to be removed", text_remaining)
        self.assertIn("Line Three intact", text_remaining)

    def test_baseline_preservation(self):
        doc = fitz.open()
        page = doc.new_page(width=400, height=200)
        orig_pt = fitz.Point(62.5, 114.8)
        page.insert_text(orig_pt, "Preserve My Baseline Exactly", fontname="helv", fontsize=14)
        
        td = page.get_text("dict")
        span = td["blocks"][0]["lines"][0]["spans"][0]
        self.assertAlmostEqual(span["origin"][1], 114.8, places=1)
        
        ok, info = text_splice.remove_spans(doc, page, [span])
        self.assertTrue(ok)
        
        # Re-insert at span["origin"]
        page.insert_text(fitz.Point(span["origin"][0], span["origin"][1]), "New Replacement Text", fontname="helv", fontsize=14)
        td_new = page.get_text("dict")
        span_new = td_new["blocks"][0]["lines"][0]["spans"][0]
        self.assertAlmostEqual(span_new["origin"][1], 114.8, places=1)


    def test_shared_content_and_inherited_resources(self):
        with fitz.open() as doc:
            page = doc.new_page(width=300, height=240)
            page.insert_text((40, 60), "SOURCE")
            page.insert_text((40, 140), "KEEP")
            page.draw_line((20, 180), (250, 180), color=(0, 0, 1), stroke_opacity=0.5)
            image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 8, 8), False)
            image.clear_with(60)
            page.insert_image(fitz.Rect(190, 20, 240, 48), pixmap=image)
            # Dos objetos de página distintos que comparten /Contents y heredan /Resources.
            page = doc[0]
            other = doc.new_page(width=300, height=240)
            page = doc[0]
            resource = doc.xref_get_key(page.xref, "Resources")[1]
            contents = doc.xref_get_key(page.xref, "Contents")[1]
            parent = int(doc.xref_get_key(page.xref, "Parent")[1].split()[0])
            doc.xref_set_key(parent, "Resources", resource)
            doc.xref_set_key(other.xref, "Contents", contents)
            doc.xref_set_key(other.xref, "Resources", "null")
            doc.xref_set_key(page.xref, "Resources", "null")
            original = doc.tobytes()
        with fitz.open(stream=original, filetype="pdf") as doc:
            other_pixels = doc[1].get_pixmap().samples
            page = doc[0]
            target = page.get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
            text_splice.remove_spans(doc, page, [target])
            text_splice.isolate_resources(doc, page)
            page.insert_text(target["origin"], "LONGER TEXT", fontname="cour", fontsize=11)
            candidate = doc.tobytes(garbage=1, deflate=True)
        text_splice.validate_replacement(original, candidate, 0, [target["bbox"]],
                                         target["bbox"], "LONGER TEXT")
        with fitz.open(stream=candidate, filetype="pdf") as check:
            self.assertEqual(check[1].get_pixmap().samples, other_pixels)
            self.assertIn("SOURCE", check[1].get_text())
            self.assertNotIn("SOURCE", check[0].get_text())
            self.assertIn("KEEP", check[0].get_text())
            check[0].draw_rect(fitz.Rect(30, 125, 80, 145), fill=(1, 1, 1))
            damaged = check.tobytes()
        with self.assertRaisesRegex(ValueError, "fuera del texto"):
            text_splice.validate_replacement(original, damaged, 0, [target["bbox"]],
                                             target["bbox"], "LONGER TEXT")
        with self.assertRaisesRegex(ValueError, "verificar"):
            text_splice.validate_replacement(original, candidate, 0, [target["bbox"]],
                                             target["bbox"], "ABSENT")

    def test_zoomed_rotated_page_allows_only_the_two_edit_regions(self):
        with fitz.open() as doc:
            page = doc.new_page(width=400, height=300)
            page.insert_text((30, 60), "OLD")
            page.insert_text((30, 180), "KEEP")
            page.set_rotation(90)
            original = doc.tobytes()
            old = page.search_for("OLD")[0]
            page.add_redact_annot(old, fill=False)
            page.apply_redactions(images=0, graphics=0)
            page.insert_text((40, 120), "NEW")
            new = page.search_for("NEW")[0]
            result = doc.tobytes()
        text_splice.validate_replacement(original, result, 0, [old], new, "NEW")

if __name__ == '__main__':
    unittest.main()
