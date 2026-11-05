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

if __name__ == '__main__':
    unittest.main()
