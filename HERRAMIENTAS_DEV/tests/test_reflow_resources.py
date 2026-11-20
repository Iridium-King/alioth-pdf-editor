"""Prueba del código Python que entrega el puente JavaScript del editor."""
import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "js" / "engine"))
import text_splice


class ReflowResourcesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Recoger el programa ya decodificado por JS, tal como lo recibe Pyodide.
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
            raise ValueError("No se encontró el punto de entrada de reflow")
        scope = {}
        exec(compile(definitions, "apply_reflow_edit", "exec"), scope)
        cls.reflow = staticmethod(scope["apply_reflow_edit"])

    def test_reflow_rejects_damaged_intermediate(self):
        with fitz.open() as doc:
            page = doc.new_page(width=300, height=240)
            page.insert_text((40, 60), "OLD", fontsize=12)
            page.insert_text((40, 160), "OTHER TEXT")
            page.draw_line((20, 192), (230, 192), stroke_opacity=0.4)
            original = doc.tobytes()
            span = page.get_text("dict")["blocks"][0]["lines"][0]["spans"][0]
            text_splice.remove_spans(doc, page, [span])
            working = doc.tobytes(garbage=1)
            page.draw_rect(fitz.Rect(10, 144, 200, 175), color=None, fill=(1, 1, 1))
            damaged = doc.tobytes()
        x, y, right, bottom = span["bbox"]
        edit = json.dumps(dict(x=x, y=y, w=right-x, h=bottom-y, size=12, text="REPLACEMENT",
                               font="helv", origin=span["origin"], targetSpans=[span],
                               isSurgical=True, skipErase=True, bgColor="transparent"))
        result = json.loads(self.reflow(working, 0, edit, original))
        with fitz.open(stream=base64.b64decode(result["pdf"]), filetype="pdf") as output:
            self.assertIn("REPLACEMENT", output[0].get_text())
            self.assertIn("OTHER TEXT", output[0].get_text())
            self.assertNotIn("OLD", output[0].get_text())
        with self.assertRaisesRegex(ValueError, "fuera del texto"):
            self.reflow(damaged, 0, edit, original)

    def test_new_missing_graphics_resource_is_rejected(self):
        with fitz.open() as doc:
            page = doc.new_page(width=240, height=240)
            page.insert_text((20, 50), "SAMPLE")
            area = page.search_for("SAMPLE")[0]
            original = doc.tobytes()
            xref = page.get_contents()[0]
            doc.update_stream(xref, b"q /AbsentState gs Q\n" + doc.xref_stream(xref))
            damaged = doc.tobytes()
        with self.assertRaisesRegex(ValueError, "errores al leer"):
            text_splice.validate_replacement(original, damaged, 0, [area], area, "SAMPLE")
