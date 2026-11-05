import io
import json
import re
import unittest
from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageFilter


SOURCE = (Path(__file__).resolve().parents[2] / 'js/python_manager.js').read_text(encoding='utf-8')


def engine(name):
    code = re.search(r'def ' + name + r'\([\s\S]*?\n(?=' + name + r'\(js_pdf_data)', SOURCE).group()
    scope = dict(fitz=fitz, io=io, json=json, Image=Image, ImageFilter=ImageFilter)
    exec(code, scope)
    return scope[name]


class CensorRegionTests(unittest.TestCase):
    def test_all_effects_remove_text_and_preserve_scan_outside_region(self):
        for rotation in (0, 90, 180, 270):
            for effect in ('solid', 'blur', 'pixelate'):
                with self.subTest(rotation=rotation, effect=effect):
                    image = Image.new('RGB', (300, 300))
                    image.putdata([((x * 17) % 256, (y * 19) % 256, (x * y) % 256) for y in range(300) for x in range(300)])
                    png = io.BytesIO()
                    image.save(png, format='PNG')
                    doc = fitz.open()
                    page = doc.new_page(width=300, height=300)
                    page.insert_image(page.rect, stream=png.getvalue())
                    page.insert_text((100, 140), 'SECRETO', fontsize=12)
                    page.insert_text((20, 30), 'CONSERVAR', fontsize=12)
                    page.set_rotation(rotation)
                    before = Image.frombytes('RGB', (300, 300), page.get_pixmap().samples)
                    bounds = fitz.Rect(90, 110, 190, 165)
                    pdf_bounds = bounds * ~page.transformation_matrix
                    rect = dict(zip(('x0', 'y0', 'x1', 'y1'), pdf_bounds))
                    data = doc.tobytes()
                    if effect == 'solid':
                        result = engine('apply_redact')(data, 0, json.dumps([rect]), '#000000')
                    else:
                        result = engine('apply_censor_effect')(data, 0, json.dumps(rect), effect, 10)
                    output = fitz.open(stream=result, filetype='pdf')
                    self.assertNotIn('SECRETO', output[0].get_text())
                    self.assertIn('CONSERVAR', output[0].get_text())
                    after = Image.frombytes('RGB', (300, 300), output[0].get_pixmap().samples)
                    visual_bounds = bounds * page.rotation_matrix
                    box = tuple(round(v) for v in visual_bounds)
                    self.assertIsNotNone(ImageChops.difference(before.crop(box), after.crop(box)).getbbox())
                    outside = ImageChops.difference(before, after)
                    outside.paste((0, 0, 0), (box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2))
                    self.assertIsNone(outside.getbbox(), 'Cambió contenido fuera de la selección')
                    if effect == 'solid':
                        self.assertEqual(after.crop(box).getextrema(), ((0, 0), (0, 0), (0, 0)))
                    output.close()
                    doc.close()


if __name__ == '__main__':
    unittest.main()
