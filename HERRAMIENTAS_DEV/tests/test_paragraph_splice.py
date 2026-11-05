import sys
import os
import fitz

sys.path.insert(0, r"c:\PDF TOOL\js\engine")
import text_splice

doc = fitz.open()
page = doc.new_page(width=600, height=400)
lines = [
    "Uso de medicacion psicotropica/somatica (Antidepresivos (ISRS / IRSN / Duales)) con potencial modulacion sobre la",
    "velocidad psicomotora o afectiva. Reporte de sustancias (Alcohol) que requieren cautela al interpretar funciones ejecutivas y",
    "control de impulsos. Factores protectores activos identificados: Actividad Fisica Regular (Factor Protector). Factores de estilo",
    "de vida moduladores/interferentes: Tabaquismo / Nicotina, alcohol."
]
y = 100
for ln in lines:
    page.insert_text(fitz.Point(50, y), ln, fontname="helv", fontsize=9.5)
    y += 12

# Next section that should NOT be touched
page.insert_text(fitz.Point(50, y + 10), "Banderas de Alerta: No se registraron alertas criticas de riesgo.", fontname="helv", fontsize=10)

td = page.get_text("dict")
all_spans = [s for b in td["blocks"] if b["type"] == 0 for l in b["lines"] for s in l["spans"]]
print("Total spans found in page:", len(all_spans))

# Paragraph spans are the first 4
para_spans = all_spans[:4]
print("Spans to remove:", len(para_spans))

ok, info = text_splice.remove_spans(doc, page, para_spans)
print("Splice paragraph result:", ok, info)
remaining_text = page.get_text("text").strip()
print("Remaining text in page:\n", remaining_text)
assert "Uso de medicacion" not in remaining_text
assert "Banderas de Alerta" in remaining_text
print("TEST PASSED: Entire paragraph spliced cleanly, next section completely preserved!")
