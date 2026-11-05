"""
Test suite de reemplazo limpio de texto (Anti-Double-Text / Anti-Ghost-Text).
Verifica:
1. Reemplazo de título (BACKGROUND -> NUEVO TÍTULO): texto previo desaparece 100%, 0 solapamiento.
2. Reemplazo de párrafo multilínea (estilo paper médico): texto previo desaparece 100%, 0 solapamiento.
3. Preservación estricta de líneas vecinas superiores e inferiores con ascenders/descenders.
4. Fallback quirúrgico con draw_rect cuando text_splice no puede operar.
"""
import unittest
import os, sys, io
import fitz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "js", "engine")))
import text_splice

class TestCleanTextReplacement(unittest.TestCase):
    def test_heading_clean_replacement(self):
        doc = fitz.open()
        page = doc.new_page(width=500, height=300)
        # Línea vecina arriba
        page.insert_text(fitz.Point(50, 45), "SECCIÓN PREVIA CON DESCENDERS: gyqpj", fontname="helv", fontsize=11)
        # Título objetivo en rojo (caso screenshot 2)
        page.insert_text(fitz.Point(50, 75), "BACKGROUND", fontname="helv", fontsize=14, color=(0.8, 0.1, 0.1))
        # Línea vecina abajo
        page.insert_text(fitz.Point(50, 105), "Texto inferior con ascenders: Tlhbdfk", fontname="helv", fontsize=11)

        td = page.get_text("dict")
        spans = [s for b in td["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"]]
        target_sp = [s for s in spans if "BACKGROUND" in s["text"]][0]

        # 1. Intentar text_splice
        ok, info = text_splice.remove_spans(doc, page, [target_sp])
        self.assertTrue(ok, "text_splice debe remover 'BACKGROUND' del stream")

        # 2. Insertar nuevo texto en la misma posición
        page.insert_text(fitz.Point(target_sp["origin"][0], target_sp["origin"][1]), "NUEVO ENCABEZADO", fontname="helv", fontsize=14, color=(0.1, 0.6, 0.1))

        final_text = page.get_text("text")
        self.assertNotIn("BACKGROUND", final_text, "El texto viejo 'BACKGROUND' no debe existir en el documento")
        self.assertIn("NUEVO ENCABEZADO", final_text, "El nuevo texto debe estar presente")
        self.assertIn("SECCIÓN PREVIA CON DESCENDERS: gyqpj", final_text, "Línea superior debe estar intacta")
        self.assertIn("Texto inferior con ascenders: Tlhbdfk", final_text, "Línea inferior debe estar intacta")

    def test_paragraph_clean_replacement_fallback(self):
        """Simula reemplazo de párrafo médico donde el borrado fallback garantiza cero texto duplicado"""
        doc = fitz.open()
        page = doc.new_page(width=500, height=400)
        
        # Párrafo original (screenshot 1)
        lines = [
            "Semaglutide, a glucagon-like peptide-1 receptor",
            "agonist with proven efficacy in weight management,",
            "has shown promising cardiovascular benefits in patients",
            "with established chronic conditions."
        ]
        page.insert_text(fitz.Point(50, 50), "ENCABEZADO CLÍNICO INTACTO", fontname="helv", fontsize=12)
        y = 90
        for l in lines:
            page.insert_text(fitz.Point(50, y), l, fontname="helv", fontsize=10)
            y += 16
        page.insert_text(fitz.Point(50, y + 20), "PIE DE PÁGINA INTACTO CON DESCENDERS: ypqgj", fontname="helv", fontsize=11)

        initial_text = page.get_text("text")
        self.assertIn("Semaglutide", initial_text)
        self.assertIn("cardiovascular benefits", initial_text)

        # Rect del párrafo
        td = page.get_text("dict")
        para_spans = [s for b in td["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"] if any(w in s["text"] for w in ["Semaglutide", "efficacy", "cardiovascular", "chronic"])]
        self.assertEqual(len(para_spans), 4)

        x0 = min(s["bbox"][0] for s in para_spans)
        y0 = min(s["bbox"][1] for s in para_spans)
        x1 = max(s["bbox"][2] for s in para_spans)
        y1 = max(s["bbox"][3] for s in para_spans)
        orig_rect = fitz.Rect(x0, y0, x1, y1)

        # Fallback quirúrgico garantizado: draw_rect + add_redact_annot
        page.draw_rect(orig_rect, color=(1, 1, 1), fill=(1, 1, 1), width=0)
        page.add_redact_annot(orig_rect, fill=None)
        page.apply_redactions()

        # Insertar nuevo texto en el área
        new_lines = [
            "NUEVO TEXTO EDITADO: Resultados preliminares",
            "del ensayo clínico de fase 3 confirmados exitosamente."
        ]
        ny = 90
        for nl in new_lines:
            page.insert_text(fitz.Point(50, ny), nl, fontname="helv", fontsize=10, color=(0, 0, 0.8))
            ny += 16

        final_text = page.get_text("text")
        # Asegurar que NINGUNA palabra del párrafo viejo sobrevivió
        self.assertNotIn("Semaglutide", final_text)
        self.assertNotIn("glucagon-like", final_text)
        self.assertNotIn("cardiovascular", final_text)
        self.assertNotIn("chronic conditions", final_text)
        
        # Asegurar que el nuevo texto está presente
        self.assertIn("NUEVO TEXTO EDITADO: Resultados preliminares", final_text)
        self.assertIn("del ensayo clínico de fase 3 confirmados exitosamente.", final_text)

        # Asegurar que las líneas adyacentes están intactas
        self.assertIn("ENCABEZADO CLÍNICO INTACTO", final_text)
        self.assertIn("PIE DE PÁGINA INTACTO CON DESCENDERS: ypqgj", final_text)

if __name__ == '__main__':
    unittest.main()
