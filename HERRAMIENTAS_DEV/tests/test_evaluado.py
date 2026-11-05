import sys
import os
import fitz

sys.path.insert(0, r"c:\PDF TOOL\js\engine")
import text_splice

doc = fitz.open()
page = doc.new_page(width=500, height=200)
# Insert text as a single string
page.insert_text(fitz.Point(50, 100), "Candidato / Evaluado:", fontname="helv", fontsize=12)

d = page.get_text("dict")
full_span = d["blocks"][0]["lines"][0]["spans"][0]
print("Full span:", full_span["text"], "bbox:", full_span["bbox"], "origin:", full_span["origin"])

font = fitz.Font("helv")
prefix_w = font.text_length("Candidato / ", fontsize=12)
eval_w = font.text_length("Evaluado:", fontsize=12)
eval_x0 = full_span["origin"][0] + prefix_w
eval_x1 = eval_x0 + eval_w
sub_span = {
    "bbox": [eval_x0, full_span["bbox"][1], eval_x1, full_span["bbox"][3]],
    "origin": [eval_x0, full_span["origin"][1]],
    "size": 12,
    "text": "Evaluado:"
}
print("Sub span to remove:", sub_span)

try:
    ok, info = text_splice.remove_spans(doc, page, [sub_span])
    print("Splice result:", ok, info)
    print("Remaining text in page:", repr(page.get_text("text")))
except Exception as e:
    print("Splice error:", type(e), e)
