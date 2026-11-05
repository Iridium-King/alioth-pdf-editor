        /**
         * PythonManager: Centralized bridge between JS and Python.
         * Handles initialization, package loading, and task execution.
         */
        window.PythonManager = {
            pyodide: null,
            isLoaded: false,
            isLoading: false,

            _initPromise: null,

            // Initialization: Loads core Pyodide and pre-downloaded wheels
            init: async function () {
                if (this.isLoaded) return;
                if (this._initPromise) return this._initPromise;
                this.isLoading = true;
                console.log("🐍 PythonManager: Initializing Python Engine (Offline)...");

                this._initPromise = (async () => {
                    try {
                        // Cargar pyodide.js bajo demanda si no está presente
                        if (typeof loadPyodide === 'undefined') {
                            if (window.app && window.app.lazyLoad) {
                                await window.app.lazyLoad('pyodide');
                            }
                        }

                        // Initialize core from local folder
                        this.pyodide = await loadPyodide({
                            indexURL: "./libs/python_engine/"
                        });

                        // Load primary wheels we downloaded
                        const enginePath = "./libs/python_engine/";
                        const wheels = [
                            "pillow-11.3.0-cp313-cp313-pyodide_2025_0_wasm32.whl",
                            "pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl",
                            // pillow_heif: eliminado — requiere libheif.so (no disponible en WASM)
                            // cryptography: eliminado — requiere libssl.so (no disponible en WASM)
                            // Ninguna de las dos se usa en el código.
                            "beautifulsoup4-4.13.3-py3-none-any.whl",
                            "soupsieve-2.6-py3-none-any.whl"
                        ];

                        // Carga paralela: todos los wheels simultáneamente (~3x más rápido)
                        await Promise.all(wheels.map(wheel =>
                            this.pyodide.loadPackage(enginePath + wheel)
                                .then(() => console.log(`🐍 PythonManager: Loaded ${wheel}`))
                                .catch(e => console.warn(`🐍 PythonManager: Could not load ${wheel}`, e))
                        ));

                        // Initial Python environment setup
                        await this.pyodide.runPythonAsync(`
                            import sys
                            import os
                            import PIL
                            import pymupdf
                            print(f"Python {sys.version} initialized with PIL {PIL.__version__} and PyMuPDF {pymupdf.version}")
                        `);

                        // Cargar motor quirúrgico text_splice en el sistema de archivos virtual de Pyodide
                        try {
                            const _spliceResp = await fetch('./js/engine/text_splice.py');
                            if (_spliceResp.ok) {
                                const _spliceSource = await _spliceResp.text();
                                this.pyodide.FS.writeFile('/home/pyodide/text_splice.py', _spliceSource);
                                console.log("🚀 PythonManager: text_splice engine loaded successfully.");
                            }
                        } catch (_err) {
                            console.warn("⚠️ PythonManager: Could not load text_splice.py, using legacy fallback", _err);
                        }

                        this.isLoaded = true;
                        console.log("🐍 PythonManager: Engine Ready.");
                    } catch (error) {
                        console.error("🐍 PythonManager: Failed to initialize.", error);
                        this.isLoaded = false;
                        this._initPromise = null;
                        if (window.location.protocol === 'file:') {
                            console.warn("⚠️ ALERTA CORS: Estás ejecutando el editor desde archivos locales (file://). " + 
                                         "Esto bloquea el motor Python (Pyodide). Algunas funciones avanzadas como " +
                                         "borrado de fondo por IA o marcadores PDF estarán desactivadas. " +
                                         "Usa un servidor local (ej: Live Server) para habilitarlas.");
                        }
                        throw error;
                    } finally {
                        this.isLoading = false;
                    }
                })();

                return this._initPromise;
            },

            // High-level wrapper for running Python scripts with JS data
            run: async function (code, globals = {}) {
                if (!this.isLoaded) await this.init();

                // Inject globals if any
                for (const [key, value] of Object.entries(globals)) {
                    this.pyodide.globals.set(key, value);
                }

                return await this.pyodide.runPythonAsync(code);
            },

            /**
             * Generates a high-quality background texture from a sample.
             * Uses PIL to analyze and synthesize a seamless patch.
             * @param {string} base64Image - Sample image of the background
             * @returns {string} - Optimized texture as DataURL
             */
            generateSmartTexture: async function (base64Image) {
                if (!this.isLoaded) await this.init();

                console.log("🐍 Python (PIL): Synthesizing smart texture (V7 adaptive)...");

                try {
                    const result = await this.run(`
import base64
import io
import random
import PIL.Image as Image
import PIL.ImageFilter as ImageFilter
import PIL.ImageStat as ImageStat
import PIL.ImageChops as ImageChops

def create_texture(b64_data):
    img_data = base64.b64decode(b64_data.split(',')[1] if ',' in b64_data else b64_data)
    img = Image.open(io.BytesIO(img_data)).convert("RGB")

    stat = ImageStat.Stat(img)
    mean_color = tuple(map(int, stat.mean))
    std_dev_per_ch = stat.stddev
    std_dev = sum(std_dev_per_ch) / 3.0
    width, height = img.size
    target_w, target_h = 256, 256

    # ── MODO 1: Sólido puro ──────────────────────────────────────────
    if std_dev < 1.0:
        return "solid:" + '#%02x%02x%02x' % mean_color

    # ── MODO 2: Near-solid (ruido suave, evitar tiling visible) ──────
    if std_dev < 6.0:
        texture = Image.new("RGB", (target_w, target_h), mean_color)
        # Micro-ruido: generar en 16x16 y escalar — mucho más rápido que loop 256x256
        amp = int(std_dev * 1.5)
        if amp > 0:
            noise_small = Image.new("RGB", (16, 16))
            ns_px = noise_small.load()
            for nx in range(16):
                for ny in range(16):
                    r = max(0, min(255, mean_color[0] + int((random.random() - 0.5) * amp * 2)))
                    g = max(0, min(255, mean_color[1] + int((random.random() - 0.5) * amp * 2)))
                    b = max(0, min(255, mean_color[2] + int((random.random() - 0.5) * amp * 2)))
                    ns_px[nx, ny] = (r, g, b)
            noise_layer = noise_small.resize((target_w, target_h), Image.NEAREST)
            texture = Image.blend(texture, noise_layer, alpha=0.35)
        texture = texture.filter(ImageFilter.GaussianBlur(radius=0.4))
        buffered = io.BytesIO()
        texture.save(buffered, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode()

    # ── DETECCIÓN DE GRADIENTE DIRECCIONAL (V2 — sin loops pixel-a-pixel) ──
    # Antes: row_variance/col_variance iteraban cada pixel individualmente en WASM → lento.
    # Ahora: dividir la imagen en N franjas y usar ImageStat.Stat en cada franja (PIL C nativo).
    # Esto es 10-20x más rápido en WASM porque PIL opera sobre bloques contiguos en C.
    N_STRIPES = 8  # 8 franjas horizontales y 8 verticales — suficiente para detectar gradiente

    def stripe_variance_h(image, n):
        """Varianza de las medias de n franjas horizontales."""
        h = image.height
        stripe_h = max(1, h // n)
        means = []
        for i in range(n):
            y0 = i * stripe_h
            y1 = min(h, y0 + stripe_h)
            if y1 <= y0: continue
            strip = image.crop((0, y0, image.width, y1))
            st = ImageStat.Stat(strip)
            means.append(sum(st.mean) / 3.0)
        diffs = [abs(means[i+1] - means[i]) for i in range(len(means)-1)]
        return sum(diffs) / max(len(diffs), 1)

    def stripe_variance_v(image, n):
        """Varianza de las medias de n franjas verticales."""
        w = image.width
        stripe_w = max(1, w // n)
        means = []
        for i in range(n):
            x0 = i * stripe_w
            x1 = min(w, x0 + stripe_w)
            if x1 <= x0: continue
            strip = image.crop((x0, 0, x1, image.height))
            st = ImageStat.Stat(strip)
            means.append(sum(st.mean) / 3.0)
        diffs = [abs(means[i+1] - means[i]) for i in range(len(means)-1)]
        return sum(diffs) / max(len(diffs), 1)

    rv = stripe_variance_h(img, N_STRIPES)
    cv = stripe_variance_v(img, N_STRIPES)
    is_gradient = max(rv, cv) > 3.0 and max(rv, cv) > min(rv, cv) * 2.5

    if is_gradient:
        # ── MODO 3: Gradiente detectado — PIL nativo sin loops pixel-by-pixel ──
        s = min(16, width // 4, height // 4)
        def avg_corner(x0, y0):
            patch = img.crop((x0, y0, x0 + s, y0 + s))
            st = ImageStat.Stat(patch)
            return tuple(int(v) for v in st.mean)

        tl = avg_corner(0, 0)
        tr_c = avg_corner(width - s, 0)
        bl = avg_corner(0, height - s)
        br = avg_corner(width - s, height - s)

        # Construir gradiente 2D usando resize desde una imagen 2x2 → target_w x target_h
        # Mucho más rápido que iterar pixel-by-pixel en WASM
        grad_2x2 = Image.new("RGB", (2, 2))
        grad_2x2.putpixel((0, 0), tl)
        grad_2x2.putpixel((1, 0), tr_c)
        grad_2x2.putpixel((0, 1), bl)
        grad_2x2.putpixel((1, 1), br)
        texture = grad_2x2.resize((target_w, target_h), Image.BILINEAR)
        texture = texture.filter(ImageFilter.GaussianBlur(radius=0.6))
        buffered = io.BytesIO()
        texture.save(buffered, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode()

    # ── MODO 4: Textura real — tiling con blend de bordes (sin seams visibles) ──
    # Antes: flip aleatorio que creaba juntas visibles en WASM.
    # Ahora: tiling por variacion ciclica de esquinas + alpha-blend entre tiles
    # usando PIL crop/paste/blend nativo — sin loops pixel-a-pixel.
    patch_size = min(40, width // 3, height // 3)
    if patch_size < 4:
        patch_size = 4
    corners = []
    margin = 2
    candidates = [
        (margin, margin),
        (width - patch_size - margin, margin),
        (margin, height - patch_size - margin),
        (width - patch_size - margin, height - patch_size - margin),
    ]
    for (cx, cy) in candidates:
        if cx >= 0 and cy >= 0 and cx + patch_size <= width and cy + patch_size <= height:
            patch = img.crop((cx, cy, cx + patch_size, cy + patch_size))
            corners.append(patch)

    if not corners:
        cx = max(0, (width - patch_size) // 2)
        cy = max(0, (height - patch_size) // 2)
        corners.append(img.crop((cx, cy, min(cx + patch_size, width), min(cy + patch_size, height))))

    # Construir la textura tile-a-tile con alpha-blend en los bordes
    texture = Image.new("RGB", (target_w, target_h))
    n = len(corners)
    idx = 0

    for tx in range(0, target_w, patch_size):
        for ty in range(0, target_h, patch_size):
            tile_w = min(patch_size, target_w - tx)
            tile_h = min(patch_size, target_h - ty)

            # Tile base: rotar entre las 4 esquinas de forma determinista (sin random)
            base_tile = corners[idx % n].copy()
            # Tile alternativo: el siguiente en la lista para el blend
            alt_tile  = corners[(idx + 1) % n].copy()

            # Asegurar que ambos tiles tienen el tamaño correcto
            base_tile = base_tile.crop((0, 0, tile_w, tile_h)) if base_tile.size[0] >= tile_w and base_tile.size[1] >= tile_h else base_tile.resize((tile_w, tile_h), Image.BILINEAR)
            alt_tile  = alt_tile.crop((0, 0, tile_w, tile_h))  if alt_tile.size[0]  >= tile_w and alt_tile.size[1]  >= tile_h else alt_tile.resize((tile_w, tile_h), Image.BILINEAR)

            # Alpha blend 50% entre tile base y alternativo para suavizar diferencias
            blended = Image.blend(base_tile, alt_tile, alpha=0.35)
            texture.paste(blended, (tx, ty))
            idx += 1

    # Suavizar juntas con GaussianBlur leve (mejor que BoxBlur para bordes continuos)
    texture = texture.filter(ImageFilter.GaussianBlur(radius=0.8))

    buffered = io.BytesIO()
    texture.save(buffered, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode()

create_texture(js_image)
                    `, { js_image: base64Image });
                    return result;
                } catch (e) {
                    console.error("🐍 Python: Texture generation failed", e);
                    return null;
                }
            },

            /**
             * Applies styled appearance streams to checkbox and radio fields using PyMuPDF
             */
            applyStyledFields: async function (pdfBuffer, styledFields) {
                if (!this.isLoaded) await this.init();
                const uint8 = new Uint8Array(pdfBuffer);
                this.pyodide.globals.set('js_pdf_data', uint8);
                this.pyodide.globals.set('js_styled_fields_json', JSON.stringify(styledFields));

                const result = await this.pyodide.runPythonAsync(`
import fitz, io, json, math

def hex_to_rgb(h):
    if not h: return 1.0, 1.0, 1.0
    h = str(h).strip()
    if h.startswith("rgb"):
        import re as _re
        nums = _re.findall(r"[\d.]+", h)
        if len(nums) >= 4 and float(nums[3]) == 0: return 1.0, 1.0, 1.0  # rgba transparente → blanco
        if len(nums) >= 3: return float(nums[0])/255, float(nums[1])/255, float(nums[2])/255
        return 1.0, 1.0, 1.0
    h = h.lstrip("#")
    if len(h) == 3: h = "".join(c*2 for c in h)
    if len(h) < 6: return 1.0, 1.0, 1.0
    return int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255

def rounded_rect_path(w, h, r):
    r = min(r, w/2, h/2)
    return (f"{r:.2f} 0 m {w-r:.2f} 0 l {w:.2f} 0 {w:.2f} {r:.2f} v "
            f"{w:.2f} {h-r:.2f} l {w:.2f} {h:.2f} {w-r:.2f} {h:.2f} v "
            f"{r:.2f} {h:.2f} l 0 {h:.2f} 0 {h-r:.2f} v 0 {r:.2f} l 0 0 {r:.2f} 0 v h")

def checkmark_path(w, h):
    return (f"{w*0.18:.2f} {h*0.50:.2f} m "
            f"{w*0.40:.2f} {h*0.26:.2f} l "
            f"{w*0.82:.2f} {h*0.74:.2f} l")

def circle_path(cx, cy, r):
    # Approximate circle with 4 bezier curves
    k = 0.5523
    return (f"{cx:.2f} {cy+r:.2f} m "
            f"{cx+r*k:.2f} {cy+r:.2f} {cx+r:.2f} {cy+r*k:.2f} {cx+r:.2f} {cy:.2f} c "
            f"{cx+r:.2f} {cy-r*k:.2f} {cx+r*k:.2f} {cy-r:.2f} {cx:.2f} {cy-r:.2f} c "
            f"{cx-r*k:.2f} {cy-r:.2f} {cx-r:.2f} {cy-r*k:.2f} {cx-r:.2f} {cy:.2f} c "
            f"{cx-r:.2f} {cy+r*k:.2f} {cx-r*k:.2f} {cy+r:.2f} {cx:.2f} {cy+r:.2f} c h")

def build_checkbox_ap(w, h, r, bg, bd_col, bd_w, ck_col, is_checked):
    bg_r,bg_g,bg_b = hex_to_rgb(bg)
    bd_r,bd_g,bd_b = hex_to_rgb(bd_col)
    ck_r,ck_g,ck_b = hex_to_rgb(ck_col)
    lines = []
    lines.append(f"{bg_r:.3f} {bg_g:.3f} {bg_b:.3f} rg")
    lines.append(rounded_rect_path(w, h, r) + " f")
    if bd_w > 0:
        lines.append(f"{bd_w:.2f} w {bd_r:.3f} {bd_g:.3f} {bd_b:.3f} RG")
        lines.append(rounded_rect_path(w, h, r) + " S")
    if is_checked:
        lw = max(bd_w, w * 0.09)
        lines.append(f"{lw:.2f} w {ck_r:.3f} {ck_g:.3f} {ck_b:.3f} RG 1 J 1 j")
        lines.append(checkmark_path(w, h) + " S")
    return chr(10).join(lines).encode()

def build_radio_ap(w, h, bg, bd_col, bd_w, dot_col, is_selected):
    bg_r,bg_g,bg_b = hex_to_rgb(bg)
    bd_r,bd_g,bd_b = hex_to_rgb(bd_col)
    dt_r,dt_g,dt_b = hex_to_rgb(dot_col)
    cx, cy, r = w/2, h/2, min(w,h)/2
    lines = []
    lines.append(f"{bg_r:.3f} {bg_g:.3f} {bg_b:.3f} rg")
    lines.append(circle_path(cx, cy, r-bd_w/2) + " f")
    if bd_w > 0:
        lines.append(f"{bd_w:.2f} w {bd_r:.3f} {bd_g:.3f} {bd_b:.3f} RG")
        lines.append(circle_path(cx, cy, r-bd_w/2) + " S")
    if is_selected:
        dot_r = r * 0.38
        lines.append(f"{dt_r:.3f} {dt_g:.3f} {dt_b:.3f} rg")
        lines.append(circle_path(cx, cy, dot_r) + " f")
    return chr(10).join(lines).encode()

doc = fitz.open(stream=bytes(js_pdf_data), filetype="pdf")
fields_list = json.loads(js_styled_fields_json)

# Pre-process max1 groups: only keep the first checked one
max1_groups = {}
for f in fields_list:
    if f.get('type') == 'checkbox' and f.get('groupRule') == 'max1' and f.get('groupName') and f.get('checked'):
        gn = f.get('groupName')
        if gn not in max1_groups:
            max1_groups[gn] = f.get('name')  # first checked wins
        elif max1_groups[gn] != f.get('name'):
            f['checked'] = False  # uncheck the rest

for page in doc:
    for widget in page.widgets():
        fn = widget.field_name
        fv = widget.field_value  # For radio: contains the option name

        # Match by exact field name (checkbox or radio-as-checkbox by group name)
        matched = [f for f in fields_list if f.get('name') == fn]
        if not matched:
            # radio-as-checkbox: group name is 'cbg_' + groupName
            matched = [f for f in fields_list if f.get('isRadioAsCheckbox') and f.get('name') == fn and f.get('optionName') == fv]
        if not matched:
            # radio-as-checkbox: match by group name when widget fn == 'cbg_...'
            matched = [f for f in fields_list if f.get('isRadioAsCheckbox') and f.get('name') == fn]
            if len(matched) > 1:
                # pick the one whose optionName matches field_value
                specific = [f for f in matched if f.get('optionName') == fv]
                if specific: matched = specific
        if not matched:
            # Radio: pdf-lib uses group name as field_name
            matched = [f for f in fields_list if f.get('type') == 'radio' and (f.get('groupName') == fn or f.get('name') == fn)]
        if not matched:
            continue

        f = matched[0]
        rect = widget.rect
        W, H = rect.width, rect.height
        bbox_str = f"[0 0 {W:.2f} {H:.2f}]"
        ap_dict_str = f"<</Type /XObject /Subtype /Form /BBox {bbox_str}>>"

        if f.get('type') == 'checkbox':
            is_rac   = f.get('isRadioAsCheckbox', False)
            opt_name = f.get('optionName', fn) if is_rac else None
            is_checked = f.get('checked', False)
            ap_on  = build_checkbox_ap(W, H, float(f.get('borderRadius',4)), f.get('bg','#ffffff'),
                                       f.get('borderColor','#999'), float(f.get('borderWidth',1)),
                                       f.get('checkColor','#333'), True)
            ap_off = build_checkbox_ap(W, H, float(f.get('borderRadius',4)), f.get('bg','#ffffff'),
                                       f.get('borderColor','#999'), float(f.get('borderWidth',1)),
                                       f.get('checkColor','#333'), False)
            xon  = doc.get_new_xref(); doc.update_object(xon,  ap_dict_str); doc.update_stream(xon,  ap_on)
            xoff = doc.get_new_xref(); doc.update_object(xoff, ap_dict_str); doc.update_stream(xoff, ap_off)
            xref = widget.xref
            if is_rac and opt_name:
                # Radio-as-checkbox: use option name as the ON state key
                doc.xref_set_key(xref, "AP", f"<</N <</{opt_name} {xon} 0 R /Off {xoff} 0 R>>  >>")
                doc.xref_set_key(xref, "AS", f"/{opt_name}" if is_checked else "/Off")
            else:
                doc.xref_set_key(xref, "AP", f"<</N <</Yes {xon} 0 R /Off {xoff} 0 R>>  >>")
                doc.xref_set_key(xref, "AS", "/Yes" if is_checked else "/Off")

        elif f.get('type') == 'radio':
            opt_name = f.get('optionName', fn)
            is_sel   = f.get('selected', False)
            ap_on  = build_radio_ap(W, H, f.get('bg','#ffffff'), f.get('borderColor','#999'),
                                    float(f.get('borderWidth',1)), f.get('dotColor','#333'), True)
            ap_off = build_radio_ap(W, H, f.get('bg','#ffffff'), f.get('borderColor','#999'),
                                    float(f.get('borderWidth',1)), f.get('dotColor','#333'), False)
            xon  = doc.get_new_xref(); doc.update_object(xon,  ap_dict_str); doc.update_stream(xon,  ap_on)
            xoff = doc.get_new_xref(); doc.update_object(xoff, ap_dict_str); doc.update_stream(xoff, ap_off)
            xref = widget.xref
            doc.xref_set_key(xref, "AP", f"<</N <</{opt_name} {xon} 0 R /Off {xoff} 0 R>>  >>")
            doc.xref_set_key(xref, "AS", f"/{opt_name}" if is_sel else "/Off")

out_buf = io.BytesIO()
doc.save(out_buf, garbage=4, deflate=True)
out_buf.getvalue()
                `);
                const _u8_r = result.toJs(); return _u8_r.buffer.slice(_u8_r.byteOffset, _u8_r.byteOffset + _u8_r.byteLength);
            },

            /**
             * Removes background from a signature image using PIL
             */
            removeImageBackground: async function(dataUrl) {
                if (!this.isLoaded) await this.init();
                // Extract base64
                const base64 = dataUrl.split(',')[1];
                const mimeType = dataUrl.split(';')[0].split(':')[1];
                this.pyodide.globals.set('js_img_b64', base64);
                this.pyodide.globals.set('js_img_mime', mimeType);

                const result = await this.pyodide.runPythonAsync(`
import base64, io
from PIL import Image

img_bytes = base64.b64decode(js_img_b64)
img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
data = img.load()
w, h = img.size

# Sample background color from corners (average of 4 corners)
corners = [data[0,0], data[w-1,0], data[0,h-1], data[w-1,h-1]]
bg_r = sum(c[0] for c in corners) // 4
bg_g = sum(c[1] for c in corners) // 4
bg_b = sum(c[2] for c in corners) // 4

# Tolerance for background detection
tolerance = 40

for y in range(h):
    for x in range(w):
        r, g, b, a = data[x, y]
        # If pixel is close to background color -> make transparent
        if (abs(r - bg_r) < tolerance and
            abs(g - bg_g) < tolerance and
            abs(b - bg_b) < tolerance):
            data[x, y] = (r, g, b, 0)

out_buf = io.BytesIO()
img.save(out_buf, format='PNG')
b64_result = base64.b64encode(out_buf.getvalue()).decode()
b64_result
                `);
                return 'data:image/png;base64,' + result;
            },

            /**
             * Compresses a PDF using PyMuPDF (fitz)
             * @param {ArrayBuffer} pdfBuffer - The PDF data to compress
             * @returns {ArrayBuffer} - The compressed PDF data
             */
            compressPDF: async function (pdfBuffer, imageQuality = 75) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF+PIL): Compressing PDF (imageQuality=${imageQuality})...`);

                try {
                    const uint8 = new Uint8Array(pdfBuffer);

                    const result = await this.run(`
import fitz
import io
import PIL.Image as Image

def compress(data_bytes, img_quality):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")

    images_recompressed = 0
    images_skipped = 0
    
    processed_count = 0

    if img_quality > 0:
        max_dim = 2400 if img_quality >= 75 else 1600
        
        for xref in range(1, doc.xref_length()):
            try:
                if not doc.xref_is_image(xref):
                    continue
                img_info = doc.extract_image(xref)
                if not img_info:
                    continue
                ext       = img_info.get("ext", "")
                img_bytes = img_info.get("image", b"")
                width     = img_info.get("width", 0)
                height    = img_info.get("height", 0)

                processed_count += 1
                if processed_count % 20 == 0:
                    print(f"🔄 Procesando imágenes: {processed_count} evaluadas...")

                if width * height < 4096:
                    images_skipped += 1
                    continue

                bytes_per_px = len(img_bytes) / max(width * height, 1)
                
                # Skip highly compressed JPEGs unless downscaling is needed
                needs_downscale = max_dim and (width > max_dim or height > max_dim)
                if ext == "jpeg" and bytes_per_px < 0.3 and not needs_downscale:
                    images_skipped += 1
                    continue

                pil_img = Image.open(io.BytesIO(img_bytes))

                # Preserve transparency instead of flattening it onto white.
                if img_info.get("smask") or pil_img.mode in ("RGBA", "LA") or "transparency" in pil_img.info:
                    images_skipped += 1
                    continue
                
                # PNG optimization check
                save_as_png = False
                if ext == "png":
                    # If <= 256 colors, getcolors returns a list, otherwise None
                    colors = pil_img.getcolors(256)
                    if colors is not None:
                        save_as_png = True
                
                if not save_as_png and pil_img.mode != "RGB":
                    pil_img = pil_img.convert("RGB")

                # Downscaling
                if needs_downscale:
                    ratio = min(max_dim / width, max_dim / height)
                    new_w, new_h = int(width * ratio), int(height * ratio)
                    pil_img = pil_img.resize((new_w, new_h), Image.LANCZOS)

                out_img = io.BytesIO()
                if save_as_png:
                    pil_img.save(out_img, format="PNG", optimize=True, compress_level=9)
                else:
                    pil_img.save(out_img, format="JPEG", quality=img_quality, optimize=True, progressive=True)
                
                compressed_bytes = out_img.getvalue()

                if len(compressed_bytes) < len(img_bytes) * 0.95 or needs_downscale:
                    doc[0].replace_image(xref, stream=compressed_bytes)
                    images_recompressed += 1
                else:
                    images_skipped += 1

            except Exception as exc:
                images_skipped += 1
                print(f"⚠️ Imagen {xref}: {exc}")
                continue

        print(f"🖼️ Imágenes: {images_recompressed} recomprimidas, {images_skipped} omitidas")

    if img_quality == -1:
        gc_level = 4
        clean_param = True
    elif img_quality == 0:
        gc_level = 2
        clean_param = False
    else:
        gc_level = 4
        clean_param = True
        
    original_size = len(data_bytes)
    out_buffer = io.BytesIO()
    doc.save(out_buffer,
             garbage=gc_level,
             clean=clean_param,
             deflate=True,
             deflate_images=(img_quality > 0))
    
    compressed_size = len(out_buffer.getvalue())
    ratio = (1 - compressed_size / max(original_size, 1)) * 100
    print(f"📦 Compresión: {original_size//1024}KB → {compressed_size//1024}KB ({ratio:.1f}% reducción)")

    return out_buffer.getvalue()

compress(js_pdf_data, js_quality)
                    `, { js_pdf_data: uint8, js_quality: imageQuality });

                    // Pyodide returns Python bytes as JsProxy — must use toJs() to get Uint8Array
                    if (result && result.toJs) {
                        const u8 = result.toJs();
                        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                    }
                    if (result instanceof Uint8Array)
                        return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    throw new Error('COMPRESSION_OUTPUT_INVALID');
                } catch (e) {
                    console.error("🐍 Python: Compression failed", e);
                    throw e;
                }
            },

            /**
             * Analyzes a PDF page for text and images (AI/OCR like analysis)
             * @param {ArrayBuffer} pdfBuffer - The PDF
             * @param {number} pageNum - 0-indexed page number
             * @returns {Object} - JSON with blocks, fonts, and images
             */
            analyzePage: async function (pdfBuffer, pageNum) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Analyzing page ${pageNum}...`);

                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz
import json

def analyze(data_bytes, pno):
    # Pyodide pasa JS TypedArrays como JsProxy — convertir a bytes de Python primero
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    if pno >= len(doc): return "{}"
    
    page = doc[pno]
    # Get all text structure
    text_dict = page.get_text("dict")
    
    # Get form fields — incluir propiedades visuales y tipograficas reales
    # para que detectNativeFields pueda crear overlays fieles al PDF original
    widgets = []
    page_h = page.rect.height

    def rgb_to_hex(color):
        """Convierte (r,g,b) float 0-1 a '#rrggbb'. Acepta None."""
        if color is None:
            return None
        try:
            r, g, b = int(color[0]*255), int(color[1]*255), int(color[2]*255)
            return f"#{r:02x}{g:02x}{b:02x}"
        except Exception:
            return None

    for widget in page.widgets():
        # PyMuPDF coords: Y-down desde top. Misma convencion que los bloques de texto.
        rect = list(widget.rect)

        # Colores: fill_color = fondo del campo, text_color = color del texto
        fill_color  = rgb_to_hex(widget.fill_color)   if widget.fill_color  else None
        text_color  = rgb_to_hex(widget.text_color)   if widget.text_color  else "#000000"
        border_col  = rgb_to_hex(widget.border_color) if widget.border_color else "#3b82f6"

        # Tipografia del campo
        font_size   = widget.text_fontsize if widget.text_fontsize is not None else 0
        font_name   = widget.text_font or ""

        # Flags del campo: bit 1 = readonly, bit 2 = required, bit 13 = multiline
        f_flags = widget.field_flags or 0
        is_readonly  = bool(f_flags & 1)
        is_required  = bool(f_flags & 2)
        is_multiline = bool(f_flags & (1 << 12))

        widgets.append({
            "name":        widget.field_name,
            "type":        widget.field_type_string,
            "rect":        rect,
            "value":       widget.field_value,
            # ── Propiedades visuales (antes no se enviaban) ──
            "fillColor":   fill_color,
            "textColor":   text_color,
            "borderColor": border_col,
            "borderWidth": widget.border_width if hasattr(widget, "border_width") else 1,
            "fontSize":    font_size,
            "fontName":    font_name,
            # ── Flags de comportamiento ──
            "isReadonly":  is_readonly,
            "isRequired":  is_required,
            "isMultiline": is_multiline
        })
    
    # Simple summary
    analysis = {
        "width": page.rect.width,
        "height": page.rect.height,
        "text_blocks": text_dict["blocks"],
        "widgets": widgets
    }
    
    return json.dumps(analysis)

analyze(js_pdf_data, js_pno)
                    `, { js_pdf_data: uint8, js_pno: pageNum });

                    return JSON.parse(result);
                } catch (e) {
                    console.error("🐍 Python: Page analysis failed", e);
                    return null;
                }
            },

            /**
             * Gets text blocks in a specific area using PyMuPDF (super accurate)
             * @param {ArrayBuffer} pdfBuffer 
             * @param {number} pageNum 
             * @param {Object} rect {x, y, w, h} in PDF points
             */
            getSpecificBlock: async function (pdfBuffer, pageNum, rect) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Fetching block attributes (V2 enhanced)...");

                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz
import json

def get_block_at(data_bytes, pno, target_rect_list):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]

    # Construir mapa de font embebido: basefont/name → {embedded, subset_prefix}
    font_embed_map = {}
    for xref, ext, ftype, basefont, name, enc, ref in page.get_fonts(full=True):
        subset_prefix = basefont[:6] if len(basefont) > 7 and basefont[6] == '+' else ""
        clean_base = basefont[7:] if subset_prefix else basefont
        info = {
            "basefont": clean_base,
            "embedded": ext != "",
            "subset": bool(subset_prefix)
        }
        font_embed_map[basefont] = info
        if name:
            font_embed_map[name] = info
            if name.startswith('/'):
                font_embed_map[name[1:]] = info

    tr = target_rect_list
    fitz_rect = fitz.Rect(float(tr[0]), float(tr[1]), float(tr[2]), float(tr[3]))

    def extract_spans(rect):
        # rawdict incluye chars individuales para calcular kerning real
        text_dict = page.get_text("rawdict", clip=rect)
        blocks = []
        for b in text_dict.get("blocks", []):
            if b["type"] == 0:
                for line in b["lines"]:
                    # ── Kerning real por par de caracteres ──
                    all_chars = []
                    for span in line["spans"]:
                        for ch in span.get("chars", []):
                            all_chars.append(ch)
                    real_letter_spacing = 0.0
                    if len(all_chars) > 1:
                        spacings = []
                        for i in range(len(all_chars) - 1):
                            ch_w = all_chars[i]["bbox"][2] - all_chars[i]["bbox"][0]
                            gap = all_chars[i+1]["origin"][0] - (all_chars[i]["origin"][0] + ch_w)
                            spacings.append(gap)
                        if spacings:
                            real_letter_spacing = round(sum(spacings) / len(spacings), 3)

                    for span in line["spans"]:
                        c = span["color"]
                        r_val = (c >> 16) & 255
                        g_val = (c >> 8) & 255
                        b_val = c & 255
                        hex_color = f"#{r_val:02x}{g_val:02x}{b_val:02x}"
                        # rawdict no siempre incluye "text" — reconstruir desde "chars" si falta
                        span_text = span.get("text") or "".join(ch.get("c", "") for ch in span.get("chars", []))
                        span_font = span.get("font", "")
                        finfo = font_embed_map.get(span_font, {})
                        blocks.append({
                            "text": span_text,
                            "font": span_font,
                            "basefont": finfo.get("basefont", span_font),
                            "embedded": finfo.get("embedded", False),
                            "subset": finfo.get("subset", False),
                            "size": span.get("size", 12),
                            "color": hex_color,
                            "bbox": list(span["bbox"]),
                            "flags": span.get("flags", 0),
                            "ascender": span.get("ascender", 0.8),
                            "descender": span.get("descender", -0.2),
                            "width": span["bbox"][2] - span["bbox"][0],
                            "origin_x": span["bbox"][0],
                            "origin_y": span["bbox"][1],
                            "origin": list(span.get("origin", (span["bbox"][0], span["bbox"][3]))),
                            "letter_spacing": real_letter_spacing
                        })
        return blocks

    # Búsqueda primaria
    blocks = extract_spans(fitz_rect)

    # Fallback 1: Margen mayor
    if not blocks:
        fitz_rect_wide = fitz.Rect(float(tr[0])-15, float(tr[1])-15, float(tr[2])+15, float(tr[3])+15)
        blocks = extract_spans(fitz_rect_wide)

    # Fallback 2: Página completa — marcar como fallback
    if not blocks:
        all_blocks = extract_spans(page.rect)
        for b in all_blocks:
            b["_fallback"] = True
        blocks = all_blocks

    if not blocks:
        return json.dumps([])

    # Ordenar por proximidad al centro del rect objetivo
    # JS recibe el bloque más cercano al click primero — reduce falsos positivos
    cx = (float(tr[0]) + float(tr[2])) / 2.0
    cy = (float(tr[1]) + float(tr[3])) / 2.0
    def proximity_score(b):
        bx = (b["bbox"][0] + b["bbox"][2]) / 2.0
        by = (b["bbox"][1] + b["bbox"][3]) / 2.0
        return (bx - cx) ** 2 + (by - cy) ** 2
    blocks.sort(key=proximity_score)

    # Si el área es suficientemente alta, extraer palabras para reconstruir texto con espacios correctos
    try:
        words = page.get_text("words", clip=fitz_rect)
        if not words:
            words = page.get_text("words", clip=fitz.Rect(fitz_rect.x0-5, fitz_rect.y0-5, fitz_rect.x1+5, fitz_rect.y1+5))
        if words:
            # words = (x0,y0,x1,y1,word,block_no,line_no,word_no)
            words.sort(key=lambda w: (round(w[1]/5)*5, w[0]))  # sort by line then x
            lines_py = {}
            for w in words:
                line_key = round(w[1] / 5) * 5
                lines_py.setdefault(line_key, []).append(w[4])
            para_lines = [' '.join(words_in_line) for words_in_line in sorted(lines_py.items(), key=lambda x: x[0])]
            para_text = chr(10).join(para_lines)
            # Agregar a todos los bloques coincidentes
            if blocks:
                for b in blocks:
                    b['paragraph_text'] = para_text

        # Extraer line_origins para asegurar baselines exactas en párrafos multilínea
        p_dict = page.get_text("dict", clip=fitz_rect)
        line_origins = []
        for b in p_dict.get("blocks", []):
            if b["type"] == 0:
                for ln in b.get("lines", []):
                    if ln.get("spans"):
                        s0 = ln["spans"][0]
                        o = s0.get("origin", (ln["bbox"][0], ln["bbox"][3]))
                        line_origins.append([round(o[0], 3), round(o[1], 3)])
        if line_origins and blocks:
            blocks[0]['line_origins'] = line_origins
    except Exception as e:
        pass

    return json.dumps(blocks)

get_block_at(js_pdf_data, js_pno, js_rect)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h] });

                    return JSON.parse(result);
                } catch (e) {
                    console.error("🐍 Python: Block extraction failed", e);
                    return null;
                }
            },

            // ── NUEVAS FUNCIONES PYTHON ──────────────────────────────────────────

            /**
             * Extrae todas las imágenes embebidas en una página del PDF
             * @returns {Array} Array de { xref, ext, base64, width, height }
             */
            extractImages: async function (pdfBuffer, pageNum) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Extracting embedded images...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json, base64

def extract_images(data_bytes, pno):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    images = []
    seen_xrefs = set()
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        if xref in seen_xrefs: continue
        seen_xrefs.add(xref)
        try:
            base_image = doc.extract_image(xref)
            img_bytes = base_image["image"]
            ext = base_image["ext"]
            b64 = base64.b64encode(img_bytes).decode()
            images.append({
                "xref": xref,
                "ext": ext,
                "width": base_image.get("width", 0),
                "height": base_image.get("height", 0),
                "base64": f"data:image/{ext};base64,{b64}"
            })
        except Exception as ex:
            pass
    return json.dumps(images)

extract_images(js_pdf_data, js_pno)
                    `, { js_pdf_data: uint8, js_pno: pageNum });
                    return JSON.parse(result);
                } catch (e) {
                    console.error("🐍 Python: Image extraction failed", e);
                    return [];
                }
            },

            /**
             * Aplica redacción REAL (elimina texto del stream PDF)
             * @param {Array} rects  Array de {x0,y0,x1,y1} en puntos PDF (Y-down)
             * @param {string} fillColor  Color de relleno hex (default "#000000")
             * @returns {ArrayBuffer} PDF redactado
             */
            applyRedactions: async function (pdfBuffer, pageNum, rects, fillColor = "#000000") {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Applying real redactions...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const rectsJson = JSON.stringify(rects);
                    const result = await this.run(`
import fitz, json, io

def apply_redact(data_bytes, pno, rects_json, fill_color_hex):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    rects = json.loads(rects_json)

    # Convertir hex a float RGB (0–1)
    h = fill_color_hex.lstrip('#')
    fc = tuple(int(h[i:i+2], 16)/255.0 for i in (0, 2, 4))

    for r in rects:
        annot = page.add_redact_annot(
            fitz.Rect(r["x0"], r["y0"], r["x1"], r["y1"]) * page.transformation_matrix,
            fill=fc
        )
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS)

    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True, clean=True)
    return bytes(out.getvalue())

apply_redact(js_pdf_data, js_pno, js_rects, js_color)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_rects: rectsJson, js_color: fillColor });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    if (result instanceof Uint8Array) return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    throw new Error('El motor no devolvió un PDF censurado');
                } catch (e) {
                    console.error("🐍 Python: Redaction failed", e);
                    throw e;
                }
            },

            /**
             * Redacta únicamente rectángulos ya revisados; no acepta patrones ni valores sensibles.
             * @returns {Promise<{bytes:ArrayBuffer,manifest:{treated:Array,rejected:Array}}>} PDF saneado y manifiesto sin valores.
             */
            redactOccurrences: async function (pdfBuffer, { occurrences, action } = {}) {
                if (!['erase', 'censor'].includes(action) || !Array.isArray(occurrences) || !occurrences.length) throw new Error('INVALID_REDACTION_REQUEST');
                const normalized = occurrences.map(item => {
                    const rect = item?.rect || {};
                    const kind = item?.kind || 'vector';
                    if (!item?.id || !['vector', 'image'].includes(kind) || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('INVALID_REDACTION_OCCURRENCE');
                    return { id: String(item.id), kind, pageIndex: item.pageIndex, rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 } };
                });
                if (!this.isLoaded) await this.init();
                const result = await this.run(`
import fitz, io, json
from PIL import Image, ImageDraw

def simple_image_target(document, page, clip):
    candidates = []
    for image in page.get_images(full=True):
        xref, smask = image[0], image[1]
        placements = page.get_image_rects(xref, transform=True)
        for placement in placements:
            image_rect, matrix = placement
            if clip.intersects(image_rect):
                if smask or abs(matrix.b) > 0.000001 or abs(matrix.c) > 0.000001:
                    raise ValueError("IMAGE_TRANSFORM_UNSUPPORTED")
                candidates.append((xref, image_rect))
    if len(candidates) != 1:
        raise ValueError("IMAGE_COMPLEX_OR_UNAVAILABLE")
    xref, image_rect = candidates[0]
    if sum(len(document[pno].get_image_rects(xref)) for pno in range(document.page_count)) != 1:
        raise ValueError("IMAGE_RESOURCE_SHARED")
    pix = fitz.Pixmap(document, xref)
    if pix.alpha or pix.colorspace is None or pix.colorspace.n not in (1, 3) or pix.n != pix.colorspace.n:
        raise ValueError("IMAGE_FORMAT_UNSUPPORTED")
    return xref, image_rect, pix

def redact_simple_image(document, page, clip, action):
    xref, image_rect, pix = simple_image_target(document, page, clip)
    x0 = max(0, min(pix.width, math.floor((clip.x0 - image_rect.x0) * pix.width / image_rect.width)))
    y0 = max(0, min(pix.height, math.floor((clip.y0 - image_rect.y0) * pix.height / image_rect.height)))
    x1 = max(0, min(pix.width, math.ceil((clip.x1 - image_rect.x0) * pix.width / image_rect.width)))
    y1 = max(0, min(pix.height, math.ceil((clip.y1 - image_rect.y0) * pix.height / image_rect.height)))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("IMAGE_RECT_UNAVAILABLE")
    mode = "L" if pix.n == 1 else "RGB"
    image = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    ImageDraw.Draw(image).rectangle((x0, y0, x1 - 1, y1 - 1), fill=0 if action == "censor" else 255)
    encoded = io.BytesIO()
    image.save(encoded, format="PNG", compress_level=9)
    page.replace_image(xref, stream=encoded.getvalue())

def redact_reviewed_occurrences(data_bytes, occurrences_json, action):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    occurrences = json.loads(occurrences_json)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    touched_pages = set()
    image_resources = set()
    for occurrence in occurrences:
        pno = occurrence["pageIndex"]
        if pno < 0 or pno >= doc.page_count:
            raise ValueError("INVALID_REDACTION_PAGE")
        page = doc[pno]
        rect = occurrence["rect"]
        if not all(isinstance(rect.get(key), (int, float)) for key in ("x0", "y0", "x1", "y1")):
            raise ValueError("INVALID_REDACTION_RECT")
        page_h = page.rect.height
        fitz_rect = fitz.Rect(rect["x0"], page_h - rect["y1"], rect["x1"], page_h - rect["y0"])
        if not fitz_rect.is_valid or fitz_rect.is_empty:
            raise ValueError("INVALID_REDACTION_RECT")
        if occurrence.get("kind") == "image":
            target = simple_image_target(doc, page, fitz_rect)
            if target[0] in image_resources:
                raise ValueError("IMAGE_RESOURCE_MULTIPLE_OCCURRENCES")
            image_resources.add(target[0])
            redact_simple_image(doc, page, fitz_rect, action)
        page.add_redact_annot(fitz_rect, fill=(0, 0, 0) if action == "censor" else None)
        touched_pages.add(pno)
    for pno in touched_pages:
        doc[pno].apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
    out = io.BytesIO()
    doc.save(out, garbage=4, deflate=True, clean=True)
    return bytes(out.getvalue())

redact_reviewed_occurrences(js_pdf_data, js_occurrences, js_action)
                `, { js_pdf_data: new Uint8Array(pdfBuffer), js_occurrences: JSON.stringify(normalized), js_action: action });
                const bytes = result?.toJs ? result.toJs() : result;
                const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null;
                if (!buffer?.byteLength) throw new Error('REDACTION_OUTPUT_INVALID');
                return { bytes: buffer, manifest: { treated: normalized.map(item => ({ id: item.id, pageIndex: item.pageIndex })), rejected: [] } };
            },

            /**
             * Sustituye texto vectorial revisado dentro del PDF. No usa superposiciones:
             * elimina el texto fuente, inserta el aprobado y valida el PDF resultante.
             */
            preflightTranslatedOccurrences: async function (pdfBuffer, options) {
                return this.reconstructTranslatedOccurrences(pdfBuffer, { ...options, checkOnly: true });
            },

            _runTranslation: async function (operation, pdfBuffer, options = {}) {
                const started = performance.now();
                const diagnostics = operation === 'extract-notes' ? options.diagnostics : undefined;
                const measure = (stage, action, detail = {}) => diagnostics && window.app?.measureTranslationExtraction
                    ? window.app.measureTranslationExtraction(diagnostics, stage, action, detail) : action();
                const diagnostic = detail => window.app?.recordTranslationExtractionDiagnostic?.(diagnostics, detail);
                const checkedError = message => Object.assign(new Error(message), { translationNative: true });
                const nativeTimeoutMs = operation === 'reconstruct'
                    ? Math.min(900000, Math.max(180000, 90000 + (options.occurrences?.length || 0) * 1000))
                    : 30000;
                if (!this._translationNativeUnavailable && /^https?:$/.test(window.location?.protocol || '')) {
                    try {
                        const body = await measure('native_pdf_encode', () => {
                            const bytes = new Uint8Array(pdfBuffer), chunks = [];
                            for (let offset = 0; offset < bytes.length; offset += 8190) {
                                chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 8190))));
                            }
                            return JSON.stringify({ operation, pdfBase64: chunks.join(''), ...options });
                        }, { engine: 'native', byteLength: pdfBuffer.byteLength });
                        // La ruta versionada impide usar un kernel anterior que quedó cargado en el proxy.
                        const response = await measure('native_transport', () => fetch('/api/pdf/translation/v2', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body,
                            signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
                                ? AbortSignal.timeout(nativeTimeoutMs) : undefined
                        }), { engine: 'native' });
                        if (response.ok) {
                            const result = await measure('native_response_parse', async () => operation === 'reconstruct'
                                ? new Uint8Array(await response.arrayBuffer()) : await response.json(), { engine: 'native' });
                            if (operation !== 'reconstruct' && (!result?.ok || !Array.isArray(result.result))) throw checkedError('TRANSLATION_OUTPUT_INVALID');
                            console.info('[Translation] motor local (ms)', { operation, elapsed: Math.round(performance.now() - started) });
                            return operation === 'reconstruct' ? result : JSON.stringify(result.result);
                        }
                        diagnostic({ stage: 'native_response', engine: 'native', status: 'failed', httpStatus: response.status });
                        if ([404, 405, 503].includes(response.status)) this._translationNativeUnavailable = true;
                        else if (response.status !== 413) {
                            const error = await response.json().catch(() => ({}));
                            const failure = checkedError(error.error || 'TRANSLATION_NATIVE_FAILED');
                            if (/^native:[A-Za-z0-9_-]+:\d+:\d+$/.test(error.failedOccurrenceId || '')) {
                                failure.failedOccurrenceId = error.failedOccurrenceId;
                            }
                            if (Array.isArray(error.failedOccurrenceIds) && error.failedOccurrenceIds.length <= 20000
                                && error.failedOccurrenceIds.every(id => /^native:[A-Za-z0-9_-]+:\d+:\d+$/.test(id))) {
                                failure.failedOccurrenceIds = error.failedOccurrenceIds;
                            }
                            if (Number.isSafeInteger(error.failedPageIndex) && error.failedPageIndex >= 0) failure.failedPageIndex = error.failedPageIndex;
                            if (/^(?:plan|write|redaction_verify|write_verify|location_verify|reopen_verify)$/.test(error.failedStage || '')) failure.failedStage = error.failedStage;
                            throw failure;
                        }
                    } catch (error) {
                        diagnostic({ stage: 'native_error', engine: 'native', status: 'failed', errorType: error?.name || 'Error' });
                        if (error.translationNative) throw error;
                        if (operation === 'reconstruct' && ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)) {
                            throw checkedError(error.name === 'TypeError' ? 'TRANSLATION_NATIVE_CONNECTION_FAILED' : 'TRANSLATION_NATIVE_TIMEOUT');
                        }
                        if (!['TypeError', 'AbortError', 'TimeoutError'].includes(error.name)) throw error;
                    }
                }
                if (!this._translationPythonSource) {
                    this._translationPythonSource = await measure('wasm_script_load', async () => {
                        const response = await fetch('js/pdf_translation.py');
                        if (!response.ok) throw new Error('TRANSLATION_ENGINE_UNAVAILABLE');
                        return response.text();
                    }, { engine: 'wasm' });
                }
                const invocation = operation === 'extract-notes'
                    ? 'extract_translation_notes(js_pdf_data, js_pages' + (diagnostics ? ', js_translation_diagnostic' : '') + ')'
                    : operation === 'extract'
                    ? 'extract_translatable_text(js_pdf_data, js_pages)'
                    : 'reconstruct_translated_occurrences(js_pdf_data, js_occurrences, js_fonts, js_check_only)';
                if (diagnostics && !this.isLoaded) await measure('wasm_init', () => this.init(), { engine: 'wasm' });
                const onDiagnostic = value => {
                    try {
                        let detail = value?.toJs ? value.toJs() : value;
                        if (detail instanceof Map) detail = Object.fromEntries(detail);
                        diagnostic({ ...detail, engine: 'wasm' });
                    } catch (_) {}
                };
                return measure('wasm_extract', () => this.run(this._translationPythonSource + '\n' + invocation, {
                    js_pdf_data: new Uint8Array(pdfBuffer), js_pages: JSON.stringify(options.pageIndices ?? null),
                    js_occurrences: JSON.stringify(options.occurrences || []), js_fonts: JSON.stringify(options.fonts || {}),
                    js_check_only: operation === 'preflight', js_translation_operation: operation,
                    ...(diagnostics ? { js_translation_diagnostic: onDiagnostic } : {})
                }), { engine: 'wasm', byteLength: pdfBuffer.byteLength });
            },

            reconstructTranslatedOccurrences: async function (pdfBuffer, { occurrences, checkOnly = false } = {}) {
                if (!Array.isArray(occurrences) || !occurrences.length) throw new Error('INVALID_TRANSLATION_REQUEST');
                const allowedFonts = new Set(['helv', 'hebo', 'heit', 'hebi', 'tiro', 'tibo', 'tiit', 'tibi', 'cour', 'cobo', 'coit', 'cobi']);
                const normalized = occurrences.map(item => {
                    const rect = item?.rect || {};
                    const color = Array.isArray(item?.color) ? item.color.map(Number) : [];
                    if (!item?.id || typeof item?.sourceText !== 'string' || !item.sourceText.trim() || typeof item?.translatedText !== 'string' || !item.translatedText.trim()
                        || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0
                        || !(allowedFonts.has(item?.fontKey) || /^embedded:\d+$/.test(item?.fontKey) || this._translationFontBuffers?.has(item?.fontKey)) || !Number.isFinite(item?.fontSize) || item.fontSize <= 0 || color.length !== 3 || color.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) {
                        throw new Error('INVALID_TRANSLATION_OCCURRENCE');
                    }
                    return {
                        id: String(item.id), pageIndex: item.pageIndex,
                        rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 },
                        sourceText: item.sourceText, translatedText: item.translatedText,
                        fontKey: item.fontKey, fontSize: item.fontSize, color,
                        fitMode: ['shrink', 'adaptive'].includes(item.fitMode) ? item.fitMode : 'strict',
                        renderMode: item.renderMode === 'scan-overlay' ? 'scan-overlay' : 'replace',
                        reflow: item.reflow === true,
                        fontSubstituted: item.fontSubstituted === true, sourceFontName: String(item.sourceFontName || ''),
                        origin: Array.isArray(item.origin) && item.origin.length === 2 && item.origin.every(Number.isFinite) ? item.origin : null
                    };
                });
                const result = await this._runTranslation(checkOnly ? 'preflight' : 'reconstruct', pdfBuffer, {
                    occurrences: normalized,
                    fonts: Object.fromEntries(normalized.filter(item => this._translationFontBuffers?.has(item.fontKey)).map(item => [item.fontKey, this._translationFontBuffers.get(item.fontKey)]))
                });
                if (checkOnly) return JSON.parse(String(result));
                const bytes = result?.toJs ? result.toJs() : result;
                const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null;
                if (!buffer?.byteLength) throw new Error('TRANSLATION_OUTPUT_INVALID');
                return { bytes: buffer, manifest: { treated: normalized.map(item => ({ id: item.id, pageIndex: item.pageIndex })), rejected: [] } };
            },

            /** Obtiene únicamente spans vectoriales con geometría suficiente para una traducción revisable. */
            extractTranslatableText: async function (pdfBuffer, { pageIndices, forNotes = false, diagnostics } = {}) {
                if (!(pdfBuffer instanceof ArrayBuffer) || !pdfBuffer.byteLength) throw new Error('INVALID_TRANSLATION_SOURCE');
                const result = await this._runTranslation(forNotes ? 'extract-notes' : 'extract', pdfBuffer, {
                    pageIndices: pageIndices ?? null, ...(forNotes && diagnostics ? { diagnostics } : {}) });
                const raw = typeof result === 'string' ? result : result?.toString?.();
                if (!raw) throw new Error('TRANSLATION_SOURCE_EXTRACTION_INVALID');
                let spans;
                try { spans = JSON.parse(raw); }
                catch (_) { throw new Error('TRANSLATION_SOURCE_EXTRACTION_INVALID'); }
                if (!Array.isArray(spans)) throw new Error('TRANSLATION_SOURCE_EXTRACTION_INVALID');
                if (forNotes) {
                    window.app?.recordTranslationExtractionDiagnostic?.(diagnostics, { stage: 'extracted_regions', status: 'ok',
                        unitCount: spans.filter(span => !span.needsOcr).length, ocrRegionCount: spans.filter(span => span.needsOcr).length });
                    if (spans.some(span => span.needsOcr)) {
                        if (typeof window.app?.extractTranslationNoteImages !== 'function') throw new Error('TRANSLATION_OCR_UNAVAILABLE');
                        return window.app.extractTranslationNoteImages(pdfBuffer, spans, diagnostics);
                    }
                    return spans;
                }
                const fontChoices = new Map();
                for (const span of spans) {
                    for (const name of new Set([span.fontName, span.fontAlias].filter(Boolean))) {
                        if (!fontChoices.has(name)) fontChoices.set(name, await this.resolveTranslationFont(name));
                        const localKey = fontChoices.get(name);
                        if (localKey) { span.fontKey = localKey; break; }
                    }
                }
                return spans;
            },

            resolveTranslationFont: async function (name) {
                const normalize = value => String(value || '').replace(/^[A-Z]{6}\+/, '').replace(/[\s,_-]/g, '').replace(/(?:PS)?MT$/i, '').replace(/Regular$/i, '').toLowerCase();
                const wanted = normalize(name);
                const app = window.app || {};
                this._translationFontBuffers ||= new Map();
                const key = `local:${wanted}`;
                if (this._translationFontBuffers.has(key)) return key;
                const registry = app.fontRegistry?.fonts || {};
                let bytes;
                for (const [fontName, cached] of Object.entries(app._systemFontBytes || {})) {
                    if (normalize(fontName) === wanted) { bytes = cached; break; }
                }
                if (!bytes) for (const fontName of Object.keys(app._systemFontSources || {})) {
                    if (normalize(fontName) === wanted) {
                        bytes = await app.loadSystemFontBytes(fontName);
                        break;
                    }
                }
                if (!bytes) for (const [fontName, info] of Object.entries(registry)) {
                    const style = (Number(info.weight) >= 700 ? 'Bold' : '') + (info.style === 'italic' ? 'Italic' : '');
                    if (normalize(fontName) !== wanted || normalize(info.family + style) !== wanted) continue;
                    bytes = app.fontRegistry.loadedFonts?.[fontName];
                    if (!bytes && info.path && !/^(?:https?:)?\/\//i.test(info.path)) {
                        try {
                            const response = await fetch(info.path);
                            if (response.ok) bytes = await response.arrayBuffer();
                        } catch (_) {}
                    }
                    break;
                }
                if (!bytes) return '';
                const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                let binary = '';
                for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
                this._translationFontBuffers.set(key, btoa(binary));
                return key;
            },

            /**
             * Prevalida localmente que la coincidencia esté en texto vectorial del PDF,
             * no sobre una imagen/escaneo. Los valores nunca se guardan ni se devuelven.
             */
            verifyRedactionTargets: async function (pdfBuffer, { occurrences } = {}) {
                if (!Array.isArray(occurrences) || !occurrences.length) throw new Error('INVALID_REDACTION_SOURCE_VERIFICATION');
                const normalized = occurrences.map(item => {
                    const rect = item?.rect || {};
                    if (!item?.id || typeof item?.value !== 'string' || !item.value || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('INVALID_REDACTION_OCCURRENCE');
                    return { id: String(item.id), pageIndex: item.pageIndex, rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }, value: item.value };
                });
                if (!this.isLoaded) await this.init();
                const result = await this.run(`
import fitz, json

def _normalized_text(value):
    return "".join(str(value).split()).casefold()

def verify_redaction_targets(data_bytes, occurrences_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    document = fitz.open(stream=data_bytes, filetype="pdf")
    treated, rejected = [], []
    try:
        for occurrence in json.loads(occurrences_json):
            identifier, pno, rect = occurrence["id"], occurrence["pageIndex"], occurrence["rect"]
            if pno < 0 or pno >= document.page_count:
                rejected.append({"id": identifier, "reason": "PAGE_UNAVAILABLE"})
                continue
            page = document[pno]
            clip = fitz.Rect(rect["x0"], page.rect.height - rect["y1"], rect["x1"], page.rect.height - rect["y0"])
            if not clip.is_valid or clip.is_empty:
                rejected.append({"id": identifier, "reason": "RECT_UNAVAILABLE"})
                continue
            try:
                image_overlap = any(clip.intersects(image_rect) for image in page.get_images(full=True) for image_rect in page.get_image_rects(image[0]))
            except Exception:
                rejected.append({"id": identifier, "reason": "IMAGE_PROVENANCE_UNAVAILABLE"})
                continue
            if image_overlap:
                rejected.append({"id": identifier, "reason": "IMAGE_BACKED_TEXT"})
            elif _normalized_text(page.get_text("text", clip=clip)) != _normalized_text(occurrence["value"]):
                rejected.append({"id": identifier, "reason": "SOURCE_TEXT_MISMATCH"})
            else:
                treated.append({"id": identifier, "pageIndex": pno})
    finally:
        document.close()
    return json.dumps({"treated": treated, "rejected": rejected})

verify_redaction_targets(js_pdf_data, js_occurrences)
                `, { js_pdf_data: new Uint8Array(pdfBuffer), js_occurrences: JSON.stringify(normalized) });
                return JSON.parse(result);
            },

            /**
             * Autoriza solo una imagen simple no compartida y con OCR coincidente.
             * Los casos con máscara, rotación, clipping o recursos compartidos se rechazan.
             */
            verifyImageRedactionTargets: async function (pdfBuffer, { occurrences } = {}) {
                if (!Array.isArray(occurrences) || !occurrences.length) throw new Error('INVALID_REDACTION_SOURCE_VERIFICATION');
                const normalized = occurrences.map(item => {
                    const rect = item?.rect || {};
                    if (!item?.id || typeof item?.value !== 'string' || !item.value || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('INVALID_REDACTION_OCCURRENCE');
                    return { id: String(item.id), pageIndex: item.pageIndex, rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }, value: item.value };
                });
                if (!this.isLoaded) await this.init();
                const result = await this.run(`
import fitz, json

def _normalized_text(value):
    return "".join(str(value).split()).casefold()

def _simple_image_target(document, page, clip):
    candidates = []
    for image in page.get_images(full=True):
        xref, smask = image[0], image[1]
        try:
            placements = page.get_image_rects(xref, transform=True)
        except Exception:
            return None, "IMAGE_PROVENANCE_UNAVAILABLE"
        for placement in placements:
            image_rect, matrix = placement
            if clip.intersects(image_rect):
                if smask or abs(matrix.b) > 0.000001 or abs(matrix.c) > 0.000001:
                    return None, "IMAGE_TRANSFORM_UNSUPPORTED"
                candidates.append((xref, image_rect))
    if len(candidates) != 1:
        return None, "IMAGE_COMPLEX_OR_UNAVAILABLE"
    xref, image_rect = candidates[0]
    if sum(len(document[pno].get_image_rects(xref)) for pno in range(document.page_count)) != 1:
        return None, "IMAGE_RESOURCE_SHARED"
    try:
        pix = fitz.Pixmap(document, xref)
    except Exception:
        return None, "IMAGE_RESOURCE_UNAVAILABLE"
    if pix.alpha or pix.colorspace is None or pix.colorspace.n not in (1, 3) or pix.n != pix.colorspace.n:
        return None, "IMAGE_FORMAT_UNSUPPORTED"
    return (xref, image_rect), None

def verify_image_redaction_targets(data_bytes, occurrences_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    document = fitz.open(stream=data_bytes, filetype="pdf")
    treated, rejected = [], []
    try:
        for occurrence in json.loads(occurrences_json):
            identifier, pno, rect = occurrence["id"], occurrence["pageIndex"], occurrence["rect"]
            if pno < 0 or pno >= document.page_count:
                rejected.append({"id": identifier, "reason": "PAGE_UNAVAILABLE"})
                continue
            page = document[pno]
            clip = fitz.Rect(rect["x0"], page.rect.height - rect["y1"], rect["x1"], page.rect.height - rect["y0"])
            if not clip.is_valid or clip.is_empty:
                rejected.append({"id": identifier, "reason": "RECT_UNAVAILABLE"})
            elif _normalized_text(page.get_text("text", clip=clip)) != _normalized_text(occurrence["value"]):
                rejected.append({"id": identifier, "reason": "SOURCE_TEXT_MISMATCH"})
            else:
                _, reason = _simple_image_target(document, page, clip)
                if reason:
                    rejected.append({"id": identifier, "reason": reason})
                else:
                    treated.append({"id": identifier, "pageIndex": pno})
    finally:
        document.close()
    return json.dumps({"treated": treated, "rejected": rejected})

verify_image_redaction_targets(js_pdf_data, js_occurrences)
                `, { js_pdf_data: new Uint8Array(pdfBuffer), js_occurrences: JSON.stringify(normalized) });
                return JSON.parse(result);
            },

            verifyRedactionOccurrences: async function (pdfBuffer, { occurrences } = {}) {
                if (!Array.isArray(occurrences) || !occurrences.length) throw new Error('INVALID_REDACTION_VERIFICATION');
                const normalized = occurrences.map(item => {
                    const rect = item?.rect || {};
                    const kind = item?.kind || 'vector', action = item?.action || 'censor';
                    if (!item?.id || !['vector', 'image'].includes(kind) || !['erase', 'censor'].includes(action) || !Number.isSafeInteger(item.pageIndex) || ![rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('INVALID_REDACTION_OCCURRENCE');
                    return { id: String(item.id), kind, action, pageIndex: item.pageIndex, rect: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 } };
                });
                if (!this.isLoaded) await this.init();
                const result = await this.run(`
import fitz, json, math

def simple_image_target(document, page, clip):
    candidates = []
    for image in page.get_images(full=True):
        xref, smask = image[0], image[1]
        placements = page.get_image_rects(xref, transform=True)
        for placement in placements:
            image_rect, matrix = placement
            if clip.intersects(image_rect):
                if smask or abs(matrix.b) > 0.000001 or abs(matrix.c) > 0.000001:
                    return None
                candidates.append((xref, image_rect))
    if len(candidates) != 1:
        return None
    xref, image_rect = candidates[0]
    if sum(len(document[pno].get_image_rects(xref)) for pno in range(document.page_count)) != 1:
        return None
    pix = fitz.Pixmap(document, xref)
    if pix.alpha or pix.colorspace is None or pix.colorspace.n not in (1, 3) or pix.n != pix.colorspace.n:
        return None
    return image_rect, pix

def image_region_is_sanitized(document, page, clip, action):
    target = simple_image_target(document, page, clip)
    if target is None:
        return False
    image_rect, pix = target
    x0 = max(0, min(pix.width, math.floor((clip.x0 - image_rect.x0) * pix.width / image_rect.width)))
    y0 = max(0, min(pix.height, math.floor((clip.y0 - image_rect.y0) * pix.height / image_rect.height)))
    x1 = max(0, min(pix.width, math.ceil((clip.x1 - image_rect.x0) * pix.width / image_rect.width)))
    y1 = max(0, min(pix.height, math.ceil((clip.y1 - image_rect.y0) * pix.height / image_rect.height)))
    if x1 <= x0 or y1 <= y0:
        return False
    target_value = 0 if action == "censor" else 255
    samples = pix.samples
    for y in range(y0, y1):
        row = y * pix.width * pix.n
        for x in range(x0, x1):
            start = row + x * pix.n
            if any(value != target_value for value in samples[start:start + pix.n]):
                return False
    return True

def verify_redacted_occurrences(data_bytes, occurrences_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    document = fitz.open(stream=data_bytes, filetype="pdf")
    treated, rejected = [], []
    try:
        for occurrence in json.loads(occurrences_json):
            identifier, pno, rect = occurrence["id"], occurrence["pageIndex"], occurrence["rect"]
            if pno < 0 or pno >= document.page_count:
                rejected.append({"id": identifier, "reason": "PAGE_UNAVAILABLE"})
                continue
            page = document[pno]
            clip = fitz.Rect(rect["x0"], page.rect.height - rect["y1"], rect["x1"], page.rect.height - rect["y0"])
            if not clip.is_valid or clip.is_empty:
                rejected.append({"id": identifier, "reason": "RECT_UNAVAILABLE"})
            elif page.get_text("text", clip=clip).strip():
                rejected.append({"id": identifier, "reason": "TEXT_REMAINS"})
            elif occurrence.get("kind") == "image" and not image_region_is_sanitized(document, page, clip, occurrence.get("action", "censor")):
                rejected.append({"id": identifier, "reason": "IMAGE_PIXELS_REMAIN"})
            else:
                treated.append({"id": identifier, "pageIndex": pno})
    finally:
        document.close()
    return json.dumps({"treated": treated, "rejected": rejected})

verify_redacted_occurrences(js_pdf_data, js_occurrences)
                `, { js_pdf_data: new Uint8Array(pdfBuffer), js_occurrences: JSON.stringify(normalized) });
                return JSON.parse(result);
            },

            /**
             * Censura con efecto blur o pixelado directo al stream PDF usando PIL + PyMuPDF.
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum
             * @param {Object} rect  {x0, y0, x1, y1} en coords PDF (origin bottom-left)
             * @param {string} effectType  'blur' | 'pixelate'
             * @param {number} intensity   2–30
             * @returns {ArrayBuffer}
             */
            applyCensorEffect: async function (pdfBuffer, pageNum, rect, effectType, intensity) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF+PIL): Applying ${effectType} censor...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const rectJson = JSON.stringify(rect);
                    const result = await this.run(`
import fitz, json, io
from PIL import Image, ImageFilter

def apply_censor_effect(data_bytes, pno, rect_json, effect_type, intensity):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)

    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    r = json.loads(rect_json)

    pdf_rect = fitz.Rect(r["x0"], r["y0"], r["x1"], r["y1"]) * page.transformation_matrix

    # Renderizar la región a imagen (dpi alto para mejor calidad del efecto)
    dpi = 150
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)

    pix = page.get_pixmap(matrix=mat, clip=pdf_rect * page.rotation_matrix, colorspace=fitz.csRGB, alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

    # Aplicar efecto
    if effect_type == "blur":
        radius = max(2, int(intensity * 0.8))
        for _ in range(3):
            img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    else:  # pixelate
        px = max(4, int(intensity * 1.5))
        small_w = max(1, img.width // px)
        small_h = max(1, img.height // px)
        img = img.resize((small_w, small_h), Image.NEAREST)
        img = img.resize((pix.width, pix.height), Image.NEAREST)

    # Convertir imagen procesada a pixmap fitz
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    new_pix = fitz.Pixmap(buf.read())

    # Insertar imagen censurada sobre la región
    # Primero redactar (eliminar contenido original) con fill=None (transparente)
    page.add_redact_annot(pdf_rect, fill=None)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS)

    # Insertar la imagen procesada en la misma posición
    page.insert_image(pdf_rect, pixmap=new_pix, rotate=page.rotation, keep_proportion=False)

    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True, clean=True)
    return bytes(out.getvalue())

apply_censor_effect(js_pdf_data, js_pno, js_rect, js_effect, js_intensity)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_rect: rectJson, js_effect: effectType, js_intensity: intensity });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    if (result instanceof Uint8Array) return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    throw new Error('El motor no devolvió un PDF censurado');
                } catch (e) {
                    console.error("🐍 Python: CensorEffect failed", e);
                    throw e;
                }
            },

            /**
             * Borrado Quirúrgico (Surgical Erase): Elimina físicamente un área del PDF
             * dejándola transparente/vacía. Devuelve un nuevo ArrayBuffer.
             * @param {ArrayBuffer} pdfBuffer 
             * @param {number} pageNum 
             * @param {Object} rect {x, y, w, h} (en puntos PDF)
             * @returns {ArrayBuffer}
             */
            eraseTextRegion: async function (pdfBuffer, pageNum, rect) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Erasing text region surgically...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const rectJson = JSON.stringify(rect);
                    const result = await this.run(`
import fitz, json, io

def erase_region(data_bytes, pno, rect_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
        
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    r = json.loads(rect_json)

    # Coordenadas en sistema Y-down (igual que PDF.js / canvas)
    fitz_rect = fitz.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])

    # Usar el color de fondo detectado por JS (análisis PIL sobre canvas)
    bg_hex = r.get("bg", "#ffffff").lstrip("#")
    try:
        fc_r = int(bg_hex[0:2], 16) / 255
        fc_g = int(bg_hex[2:4], 16) / 255
        fc_b = int(bg_hex[4:6], 16) / 255
    except:
        fc_r, fc_g, fc_b = 1.0, 1.0, 1.0
    bg = (fc_r, fc_g, fc_b)

    # draw_rect pinta encima del texto sin modificar el content stream
    # (no usar add_redact_annot/apply_redactions → destruye texto adyacente)
    # Clamp y0 (arriba) y y1 (abajo): evitar tapar texto adyacente cuyo bbox[3] > fitz_rect.y0
    # o cuyo bbox[1] < fitz_rect.y1 (línea de abajo con ascenders que tocan el rect).
    # Solo spans con solapamiento vertical >30% se consideran texto objetivo.
    _erase_y0 = fitz_rect.y0
    _erase_y1 = fitz_rect.y1
    try:
        _enearby = page.get_text("rawdict", clip=fitz_rect + (-5, -2, 5, 2))
        _enspans = [sp for bl in _enearby.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
        _target_spans = []
        for _esp in _enspans:
            _sb = _esp['bbox']
            _y0_c = max(_sb[1], fitz_rect.y0)
            _y1_c = min(_sb[3], fitz_rect.y1)
            _ov = _y1_c - _y0_c
            if _ov <= 0:
                continue
            _sp_h = _sb[3] - _sb[1]
            _rect_h = fitz_rect.y1 - fitz_rect.y0
            _min_h = min(_sp_h, _rect_h) if _rect_h > 0 else _sp_h
            if _ov > _min_h * 0.3:
                _target_spans.append(_esp)
        if _target_spans:
            _span_y0 = min(_esp['bbox'][1] for _esp in _target_spans)
            _erase_y0 = max(_span_y0, fitz_rect.y0)
            _span_y1 = max(_esp['bbox'][3] for _esp in _target_spans)
            _erase_y1 = min(_span_y1, fitz_rect.y1)
            # Elevar _erase_y0 al y1 máximo de spans NO-objetivo que se cuelan bajo fitz_rect.y0
            # (p.ej. descenders de la línea de arriba). Así draw_rect no los pinta de blanco.
            _non_target_above = [_esp for _esp in _enspans
                                  if _esp not in _target_spans
                                  and _esp['bbox'][1] < fitz_rect.y0 - 0.5
                                  and _esp['bbox'][3] > fitz_rect.y0]
            if _non_target_above:
                _coll_y1_max = max(_esp['bbox'][3] for _esp in _non_target_above)
                _erase_y0 = max(_erase_y0, _coll_y1_max)
                print(f"🔴 [ERASE] collateral-above y1_max={_coll_y1_max:.2f} → _erase_y0 elevated to {_erase_y0:.2f}")
    except Exception:
        pass
    _draw_rect = fitz.Rect(fitz_rect.x0, _erase_y0, fitz_rect.x1, _erase_y1)
    page.draw_rect(_draw_rect, color=bg, fill=bg, width=0)
    print(f"🔴 [ERASE] draw_rect rect=({_draw_rect.x0:.2f},{_draw_rect.y0:.2f},{_draw_rect.x1:.2f},{_draw_rect.y1:.2f}) bg={bg}")
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True, clean=True)
    return bytes(out.getvalue())

erase_region(js_pdf_data, js_pno, js_rect)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_rect: rectJson });

                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Erase Region failed", e);
                    return pdfBuffer;
                }
            },

            /**
             * Eliminación quirúrgica de texto a nivel de operadores de content stream (estilo PdfCraft).
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum
             * @param {Array<Object>} spans
             * @returns {Promise<ArrayBuffer>}
             */
            removeTextSpans: async function (pdfBuffer, pageNum, spans) {
                if (!this.isLoaded) await this.init();
                console.log("🚀 PythonManager: Splicing text spans surgically from /Contents...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const spansJson = JSON.stringify(spans);
                    const result = await this.run(`
import fitz, io, json
import text_splice

def do_splice(data_bytes, pno, spans_json):
    if hasattr(data_bytes, 'to_py'): data_bytes = bytes(data_bytes.to_py())
    else: data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    spans = json.loads(spans_json)
    ok, info = text_splice.remove_spans(doc, page, spans)
    if not ok:
        raise Exception(f"text_splice failed: {info}")
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return bytes(out.getvalue())

do_splice(js_pdf_data, js_pno, js_spans)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_spans: spansJson });

                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 PythonManager: removeTextSpans failed", e);
                    throw e;
                }
            },

            /**
             * Borrado de Imagen Interactivo: Extrae una imagen del PDF en un punto dado (x,y),
             * la elimina físicamente del documento y la devuelve en Base64 para que el visor WEB
             * la conviuta en un objeto manipulable libremente.
             * @param {ArrayBuffer} pdfBuffer 
             * @param {number} pageNum 
             * @param {number} x (en puntos PDF)
             * @param {number} y (en puntos PDF)
             * @returns {Object} { buffer: ArrayBuffer (PDF nuevo sin la imagen), base64: str, bbox: {x,y,w,h} } o null si no hay imagen
             */
            /**
             * Elimina imágenes por xref en páginas seleccionadas.
             * @param {ArrayBuffer} pdfBuffer
             * @param {Array<number>} xrefs  Lista de xrefs a eliminar
             * @param {Array<number>|'all'} pages  Array de índices de página (0-based) o 'all'
             * @returns {ArrayBuffer} PDF modificado
             */
            /** Extrae anotaciones de vínculo con una vista previa de su área. */
            extractLinksWithPreview: async function (pdfBuffer, pages = 'all') {
                if (!this.isLoaded) await this.init();
                if (!this.isLoaded) throw new Error('Python engine is not available');
                const cleanup = window.PDFLinkCleanup;
                if (!cleanup) throw new Error('PDF link cleanup module is not available');
                const uint8 = new Uint8Array(pdfBuffer);
                const pagesJson = pages === 'all' ? 'all' : JSON.stringify(pages);
                const result = await this.run(`${cleanup.PYTHON_SOURCE}\nscan_pdf_links(js_pdf_data, js_pages, True)`, {
                    js_pdf_data: uint8,
                    js_pages: pagesJson
                });
                return JSON.parse(result);
            },

            /** Elimina anotaciones exactas; opcionalmente redacta también su contenido visual. */
            deleteLinks: async function (pdfBuffer, targets, removeVisual = false) {
                if (!this.isLoaded) await this.init();
                if (!this.isLoaded) throw new Error('Python engine is not available');
                const cleanup = window.PDFLinkCleanup;
                if (!cleanup) throw new Error('PDF link cleanup module is not available');
                const result = await this.run(`${cleanup.PYTHON_SOURCE}\nremove_pdf_links(js_pdf_data, js_targets, js_remove_visual)`, {
                    js_pdf_data: new Uint8Array(pdfBuffer),
                    js_targets: JSON.stringify(targets || []),
                    js_remove_visual: !!removeVisual
                });
                if (result && typeof result.toJs === 'function') {
                    const bytes = result.toJs();
                    if (bytes instanceof Uint8Array && bytes.byteLength > 0) {
                        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                    }
                }
                if (result instanceof Uint8Array && result.byteLength > 0) {
                    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                }
                if (result instanceof ArrayBuffer && result.byteLength > 0) return result;
                throw new Error('Python did not return a valid PDF buffer');
            },

            deleteImagesByXref: async function (pdfBuffer, xrefs, pages) {
                if (!this.isLoaded) await this.init();
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const xrefsJson = JSON.stringify(xrefs);
                    const pagesJson = JSON.stringify(pages);
                    const result = await this.run(`
import fitz, json, io

def delete_images_by_xref(data_bytes, xrefs_json, pages_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    xrefs = set(json.loads(xrefs_json))
    pages_arg = json.loads(pages_json)
    page_indices = range(len(doc)) if pages_arg == "all" else pages_arg

    for pno in page_indices:
        if pno >= len(doc): continue
        page = doc[pno]
        img_list = page.get_images(full=True)
        for img in img_list:
            xref = img[0]
            if xref not in xrefs: continue
            rects = page.get_image_rects(xref)
            for r in rects:
                page.add_redact_annot(r, fill=None)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

    out = io.BytesIO()
    doc.save(out, garbage=4, deflate=True, clean=True)
    return bytes(out.getvalue())

delete_images_by_xref(js_pdf_data, js_xrefs, js_pages)
                    `, { js_pdf_data: uint8, js_xrefs: xrefsJson, js_pages: pagesJson });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error('🐍 Python: deleteImagesByXref failed', e);
                    return pdfBuffer;
                }
            },

            extractAndEraseImageAtPoint: async function (pdfBuffer, pageNum, x, y) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Checking for image at (${x.toFixed(1)}, ${y.toFixed(1)})...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json, io, base64

def extract_erase_image(data_bytes, pno, pt_x, pt_y):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
        
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    
    # 1. Obtener lista completa de imágenes de la página
    image_list = page.get_images(full=True)
    if not image_list:
        return json.dumps({"found": False})

    target_img_bbox = None
    target_xref = None
    
    # Tolerancia al hacer clic
    click_pt = fitz.Point(pt_x, pt_y)
    
    for img in image_list:
        xref = img[0]
        # Obtener los rectángulos donde se dibuja esta imagen específica en esta página
        rects = page.get_image_rects(xref)
        for r in rects:
            if r.contains(click_pt):
                target_img_bbox = r
                target_xref = xref
                break
        if target_img_bbox:
            break
            
    if not target_img_bbox or not target_xref:
        return json.dumps({"found": False})
        
    # 2. Extraer la imagen seleccionada como Base64 (PNG preferido para transparencias o conversiones seguras)
    try:
        pix = fitz.Pixmap(doc, target_xref)
        if pix.n - pix.alpha > 3: # CMYK o más
            temp_pix = fitz.Pixmap(fitz.csRGB, pix)
            img_bytes = temp_pix.tobytes("png")
            temp_pix = None
        else:
            img_bytes = pix.tobytes("png")
            
        b64_str = "data:image/png;base64," + base64.b64encode(img_bytes).decode('utf-8')
        pix = None
    except Exception as e:
        return json.dumps({"found": False, "error": str(e)})

    # 3. Borrar físicamente el rectángulo que ocupaba la imagen mediante una redacción sin relleno
    # page.delete_image(xref) a veces afecta a otras páginas si la imagen es compartida,
    # así que redactar el área exacta en esta página concreta es la via más segura para edición "quirúrgica".
    # Usaremos una redacción que SÓLO elimine imágenes cruzando esa zona.
    page.add_redact_annot(target_img_bbox, fill=None)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE) # Obligamos a purgar imágenes bajo la redacción

    # Guardar PDF resultante (Optimizado para que los stream desechados desaparezcan)
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True, clean=True)
    
    # 4. Devolver payload unificado
    pdf_b64 = base64.b64encode(out.getvalue()).decode('utf-8')
    
    return json.dumps({
        "found": True,
        "pdf_base64": pdf_b64,
        "base64": b64_str,
        "bbox": {
            "x": target_img_bbox.x0,
            "y": target_img_bbox.y0,
            "w": target_img_bbox.width,
            "h": target_img_bbox.height
        }
    })

extract_erase_image(js_pdf_data, js_pno, js_x, js_y)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_x: x, js_y: y });

                    const parsed = JSON.parse(result);
                    if (!parsed.found) return null; // No image at coordinates

                    // Convert returned Base64 PDF back to ArrayBuffer
                    const binary_string = window.atob(parsed.pdf_base64);
                    const len = binary_string.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binary_string.charCodeAt(i);
                    }

                    return {
                        buffer: bytes.buffer,
                        base64: parsed.base64,
                        bbox: parsed.bbox
                    };

                } catch (e) {
                    console.error("🐍 Python: Image extracting/erasing failed", e);
                    return null;
                }
            },

            /**
             * Extracción y Borrado de Campos de Formulario (Surgical Form Edit):
             * Detecta todos los widgets de una página, los extrae como objetos JSON para el frontend,
             * y los ELIMINA del documento original (tanto la estructura como lo visual mediante redacción).
             * @param {ArrayBuffer} pdfBuffer 
             * @param {number} pageNum 
             * @returns {Object} { buffer: ArrayBuffer (PDF limpio), widgets: Array }
             */
            convertAndEraseFormFields: async function (pdfBuffer, pageNum) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Converting and Erasing Form Fields on page ${pageNum}...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json, io, base64

def convert_erase_fields(data_bytes, pno):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    if pno >= len(doc): return json.dumps({"widgets": []})
    
    page = doc[pno]
    widgets_data = []

    def rgb_to_hex(color):
        if color is None: return None
        try:
            r, g, b = int(color[0]*255), int(color[1]*255), int(color[2]*255)
            return f"#{r:02x}{g:02x}{b:02x}"
        except: return None

    # 1. Detectar y recopilar datos
    widgets_list = list(page.widgets())
    for widget in widgets_list:
        rect = list(widget.rect)
        w_type = str(widget.field_type_string).lower()
        
        # Propiedades para el frontend
        widgets_data.append({
            "name": widget.field_name,
            "type": widget.field_type_string,
            "rect": rect,
            "value": widget.field_value,
            "fillColor": rgb_to_hex(widget.fill_color) or "#ffffff",
            "textColor": rgb_to_hex(widget.text_color) or "#000000",
            "borderColor": rgb_to_hex(widget.border_color) or "#3b82f6",
            "borderWidth": widget.border_width if hasattr(widget, "border_width") else 1,
            "fontSize": widget.text_fontsize if widget.text_fontsize and widget.text_fontsize > 0 else 10,
            "fontName": widget.text_font or "",
            "isReadonly": bool(widget.field_flags & 1),
            "isRequired": bool(widget.field_flags & 2),
            "isMultiline": bool(widget.field_flags & (1 << 12))
        })
        
        # 2. A) Limpiar appearance streams y diccionarios visuales ANTES de borrar
        # Esto elimina fondos/bordes dibujados como parte del widget sin tocar el contenido externo
        try:
            doc.xref_set_key(widget.xref, "AP", "null")
            doc.xref_set_key(widget.xref, "MK", "null")
            widget.update()
        except: pass
        
        # B) Eliminar físicamente el widget (anotación)
        page.delete_widget(widget)
        
        # C) Redactar el rect EXACTO del widget (sin margen) para limpiar
        # residuos visuales del content stream (fondos, bordes dibujados en stream)
        # Sin margen → no afecta texto ni contenido adyacente
        erase_rect = fitz.Rect(rect[0], rect[1], rect[2], rect[3])
        page.add_redact_annot(erase_rect, fill=None)

    # 3. Aplicar redacciones (preservar imágenes de página)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
    
    # 4. Guardar PDF resultante (Optimización de Velocidad Crítica)
    # Cambiamos a garbage=1 (rápido) y eliminamos 'clean=True' para máxima velocidad en browser
    out = io.BytesIO()
    doc.save(out, 
             garbage=1, 
             deflate=True, 
             incremental=False, 
             encryption=fitz.PDF_ENCRYPT_KEEP)
    
    return json.dumps({
        "pdf_base64": base64.b64encode(out.getvalue()).decode('utf-8'),
        "widgets": widgets_data
    })

convert_erase_fields(js_pdf_data, js_pno)
                    `, { js_pdf_data: uint8, js_pno: pageNum });

                    const parsed = JSON.parse(result);

                    // Convertir Base64 de vuelta a ArrayBuffer
                    const binary_string = window.atob(parsed.pdf_base64);
                    const len = binary_string.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);

                    return {
                        buffer: bytes.buffer,
                        widgets: parsed.widgets
                    };

                } catch (e) {
                    console.error("🐍 Python: Form field conversion/erasure failed", e);
                    return null;
                }
            },

            /**
             * Detecta tablas en una página del PDF (o un área específica)
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum
             * @param {Array|null} clip [x0, y0, x1, y1] en puntos PDF
             * @param {string} strategy "lattice" o "stream"
             * @returns {Array} Array de tablas con celdas y contenido
             */
            detectTables: async function (pdfBuffer, pageNum, clip = null, strategy = "lattice") {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Detecting tables (strategy=${strategy}, clip=${!!clip})...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json

def detect_tables(data_bytes, pno, clip_list=None, strat="lattice"):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    page_h = page.rect.height

    # Para tablas pequeñas: aumentar resolución de renderizado para mejor detección de líneas
    # PyMuPDF usa las líneas vectoriales del PDF, no pixeles, pero el clip sí mejora con zoom
    clip_rect = fitz.Rect(*clip_list) if clip_list else None

    # Si el área de clip es pequeña (<100pt en cualquier dimensión), ampliar internamente
    if clip_rect:
        cw = clip_rect.width; ch = clip_rect.height
        # Expandir ligeramente el clip para no cortar bordes de tabla
        expand = 2.0
        clip_rect = fitz.Rect(clip_rect.x0 - expand, clip_rect.y0 - expand,
                               clip_rect.x1 + expand, clip_rect.y1 + expand)
        clip_rect = clip_rect & page.rect  # no salirse de la página

    # Mapear estrategia a parámetros
    strat_map = {
        "lattice": ("lines", "lines"),
        "stream":  ("text",  "text"),
    }
    h_strat, v_strat = strat_map.get(strat, ("lines", "lines"))

    def _bbox_list(b):
        # En 1.26 bbox puede ser Rect o tupla
        if hasattr(b, 'x0'):
            return [round(b.x0,2), round(b.y0,2), round(b.x1,2), round(b.y1,2)]
        return [round(b[0],2), round(b[1],2), round(b[2],2), round(b[3],2)]

    tables_out = []
    try:
        # Parámetros según estrategia
        extra_kw = {}
        if strat == "lattice":
            extra_kw = {"snap_tolerance": 3, "snap_x_tolerance": 3, "snap_y_tolerance": 3,
                        "join_tolerance": 3, "join_x_tolerance": 3, "join_y_tolerance": 3,
                        "min_words_vertical": 1, "min_words_horizontal": 1}
        elif strat == "stream":
            extra_kw = {"snap_tolerance": 5, "snap_x_tolerance": 5, "snap_y_tolerance": 5,
                        "join_tolerance": 5, "min_words_vertical": 1, "min_words_horizontal": 1}
        elif strat == "aggressive":
            # Modo agresivo: combina líneas y texto, tolerancias máximas
            h_strat, v_strat = "lines", "lines"
            extra_kw = {"snap_tolerance": 8, "snap_x_tolerance": 8, "snap_y_tolerance": 8,
                        "join_tolerance": 8, "join_x_tolerance": 8, "join_y_tolerance": 8,
                        "min_words_vertical": 1, "min_words_horizontal": 1}
        # Intentar con parámetros actuales; si falla por args desconocidos, caer a básico
        try:
            tabs = page.find_tables(clip=clip_rect, horizontal_strategy=h_strat, vertical_strategy=v_strat, **extra_kw)
        except TypeError:
            tabs = page.find_tables(clip=clip_rect, horizontal_strategy=h_strat, vertical_strategy=v_strat)
        for i, tab in enumerate(tabs):
            rows_data = []
            cell_bboxes = []
            try:
                extracted = tab.extract()
                for row in extracted:
                    rows_data.append([cell if cell is not None else "" for cell in row])
            except Exception:
                rows_data = []

            # Coordenadas de celdas
            try:
                for r_idx, row in enumerate(tab.rows):
                    row_cells = []
                    for c_idx, cell in enumerate(row.cells):
                        if cell is None:
                            row_cells.append(None)
                        else:
                            row_cells.append(_bbox_list(cell))
                    cell_bboxes.append(row_cells)
            except Exception:
                cell_bboxes = []

            # Estadísticas
            total_cells = sum(len(r) for r in rows_data)
            empty_cells = sum(1 for r in rows_data for c in r if not c.strip())
            fill_ratio  = round(1 - empty_cells / max(total_cells, 1), 3)

            tables_out.append({
                "index":     i,
                "bbox":      _bbox_list(tab.bbox),
                "rows":      len(rows_data),
                "cols":      len(rows_data[0]) if rows_data else 0,
                "data":      rows_data,
                "cellBboxes": cell_bboxes,
                "fillRatio":  fill_ratio,
                "pageH":     round(page_h, 2)
            })
    except Exception as ex:
        print(f"Error find_tables: {ex}")
        pass
    return json.dumps(tables_out, ensure_ascii=False)

detect_tables(js_pdf_data, js_pno, js_clip, js_strat)
                    `, {
                        js_pdf_data: uint8,
                        js_pno: pageNum,
                        js_clip: clip,
                        js_strat: strategy
                    });
                    return JSON.parse(result);
                } catch (e) {
                    console.error("🐍 Python: Table detection failed", e);
                    return [];
                }
            },

            /**
             * Lee y/o escribe metadatos del documento PDF
             * @param {Object|null} newMeta  Si null, solo lee. Si objeto, escribe y devuelve PDF modificado.
             * @returns {Object|ArrayBuffer}
             */
            getSetMetadata: async function (pdfBuffer, newMeta = null) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): " + (newMeta ? "Writing" : "Reading") + " metadata...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const metaJson = JSON.stringify(newMeta || null);
                    const result = await this.run(`
import fitz, json, io

def handle_metadata(data_bytes, new_meta_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    new_meta = json.loads(new_meta_json)

    if new_meta is None:
        # Solo leer
        m = doc.metadata
        return json.dumps({
            "title": m.get("title", ""),
            "author": m.get("author", ""),
            "subject": m.get("subject", ""),
            "keywords": m.get("keywords", ""),
            "creator": m.get("creator", ""),
            "producer": m.get("producer", ""),
            "creationDate": m.get("creationDate", ""),
            "modDate": m.get("modDate", "")
        })
    else:
        # Escribir metadatos
        current = doc.metadata
        current.update({k: v for k, v in new_meta.items() if v is not None})
        doc.set_metadata(current)
        out = io.BytesIO()
        doc.save(out, garbage=2, deflate=True)
        return bytes(out.getvalue())

handle_metadata(js_pdf_data, js_meta)
                    `, { js_pdf_data: uint8, js_meta: metaJson });

                    if (newMeta === null) {
                        return JSON.parse(result);
                    } else {
                        if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                        return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                    }
                } catch (e) {
                    console.error("🐍 Python: Metadata operation failed", e);
                    return newMeta === null ? {} : pdfBuffer;
                }
            },

            /**
             * Inspecciona exhaustivamente las propiedades del PDF (4 pestañas: descripción, seguridad, fuentes, avanzado)
             * al estilo PdfCraft.
             * @param {ArrayBuffer} pdfBuffer
             * @returns {Promise<Object>}
             */
            inspectDocumentProperties: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Inspecting full document properties...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json

def inspect_doc(data_bytes):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    m = doc.metadata or {}
    page_count = len(doc)
    page0 = doc[0] if page_count > 0 else None
    
    # Page size and paper format
    width_pt = round(page0.rect.width, 1) if page0 else 0
    height_pt = round(page0.rect.height, 1) if page0 else 0
    width_mm = round(width_pt * 25.4 / 72.0, 1)
    height_mm = round(height_pt * 25.4 / 72.0, 1)
    
    # Paper standard detection
    paper_name = ""
    if abs(width_pt - 595.3) < 4 and abs(height_pt - 841.9) < 4:
        paper_name = "A4"
    elif abs(width_pt - 612.0) < 4 and abs(height_pt - 792.0) < 4:
        paper_name = "Carta (Letter)"
    elif abs(width_pt - 612.0) < 4 and abs(height_pt - 1008.0) < 4:
        paper_name = "Oficio (Legal)"
    elif abs(width_pt - 841.9) < 4 and abs(height_pt - 1190.5) < 4:
        paper_name = "A3"
    elif abs(width_pt - 419.5) < 4 and abs(height_pt - 595.3) < 4:
        paper_name = "A5"
    
    # Permissions & security
    is_enc = bool(doc.is_encrypted)
    perm_val = doc.permissions
    can_print = bool(perm_val & 4)
    can_modify = bool(perm_val & 8)
    can_copy = bool(perm_val & 16)
    can_annotate = bool(perm_val & 32)
    can_form = bool(perm_val & 256)
    can_access = bool(perm_val & 512)
    can_assemble = bool(perm_val & 1024)
    can_print_hq = bool(perm_val & 2048)
    
    sec_info = {
        "is_encrypted": is_enc,
        "method": m.get("encryption", "") or ("Ninguno" if not is_enc else "Cifrado PDF estándar"),
        "permissions": {
            "printing": "Permitido (Alta calidad)" if (not is_enc or (can_print and can_print_hq)) else ("Permitido" if can_print else "No permitido"),
            "changing": "Permitido" if (not is_enc or can_modify) else "No permitido",
            "copying": "Permitido" if (not is_enc or can_copy) else "No permitido",
            "annotations": "Permitido" if (not is_enc or can_annotate) else "No permitido",
            "forms": "Permitido" if (not is_enc or can_form) else "No permitido",
            "accessibility": "Permitido" if (not is_enc or can_access) else "No permitido",
            "assembly": "Permitido" if (not is_enc or can_assemble) else "No permitido"
        }
    }
    
    # Fonts collection across document
    fonts_map = {}
    for pno in range(page_count):
        for f in doc.get_page_fonts(pno):
            basefont = f[3]
            if basefont and basefont not in fonts_map:
                is_subset = len(basefont) > 7 and basefont[6] == '+' and basefont[:6].isupper()
                clean_name = basefont[7:] if is_subset else basefont
                fonts_map[basefont] = {
                    "name": clean_name,
                    "type": f[2] or "Desconocido",
                    "encoding": f[5] or "Standard",
                    "subset": is_subset,
                    "embedded": bool(f[1] != "" or (f[0] and f[0] > 0))
                }
    
    # Advanced boxes
    boxes = {}
    if page0:
        boxes["mediabox"] = [round(v, 1) for v in page0.mediabox]
        boxes["cropbox"] = [round(v, 1) for v in page0.cropbox]
        boxes["bleedbox"] = [round(v, 1) for v in page0.bleedbox]
        boxes["trimbox"] = [round(v, 1) for v in page0.trimbox]
        boxes["artbox"] = [round(v, 1) for v in page0.artbox]
    
    layers_list = getattr(doc, "get_layers", lambda: [])() or []
    
    res = {
        "metadata": {
            "title": m.get("title", ""),
            "author": m.get("author", ""),
            "subject": m.get("subject", ""),
            "keywords": m.get("keywords", ""),
            "creator": m.get("creator", ""),
            "producer": m.get("producer", ""),
            "creationDate": m.get("creationDate", ""),
            "modDate": m.get("modDate", ""),
            "format": m.get("format", "PDF 1.7")
        },
        "page_count": page_count,
        "file_size": len(data_bytes),
        "page_size": {
            "width_pt": width_pt,
            "height_pt": height_pt,
            "width_mm": width_mm,
            "height_mm": height_mm,
            "paper_name": paper_name
        },
        "security": sec_info,
        "fonts": list(fonts_map.values()),
        "advanced": {
            "fast_web_view": bool(getattr(doc, "is_fast_webaccess", False)),
            "pdf_version": m.get("format", "PDF 1.7"),
            "is_form": bool(getattr(doc, "is_form_pdf", False)),
            "layers_count": len(layers_list),
            "page_boxes": boxes
        }
    }
    return json.dumps(res)

inspect_doc(js_pdf_data)
                    `, { js_pdf_data: uint8 });
                    return JSON.parse(result);
                } catch (e) {
                    console.error("🐍 Python: inspectDocumentProperties failed", e);
                    return null;
                }
            },

            /**
             * Extrae el texto completo de un PDF con PyMuPDF preservando orden de lectura real.
             * Mucho más preciso que el loop PDF.js de extractTextFromAllPages:
             * - Preserva orden de lectura (sort_flags)
             * - Maneja correctamente caracteres especiales, ligaduras y CMap
             * - Incluye saltos de página con número de página
             * @param {ArrayBuffer} pdfBuffer
             * @returns {string|null} Texto completo del documento, o null si falla
             */
            _extractNativeText: async function (pdfBuffer, pageIndices = null) {
                if (this._textNativeUnavailable || !/^https?:$/.test(window.location?.protocol || '')) return null;
                try {
                    const bytes = new Uint8Array(pdfBuffer), chunks = [];
                    if (bytes.length > 64 * 1024 * 1024) return null;
                    for (let i = 0; i < bytes.length; i += 49152) {
                        chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 49152))));
                    }
                    const response = await fetch('/api/pdf/text', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pdfBase64: chunks.join(''), pageIndices }),
                        signal: AbortSignal.timeout(45000)
                    });
                    if (!response.ok) {
                        if ([404, 405].includes(response.status)) this._textNativeUnavailable = true;
                        return null;
                    }
                    const result = await response.json();
                    if (!result?.ok || !Array.isArray(result.pages) || !result.pages.every(page =>
                        Number.isInteger(page.page) && page.page > 0 && Number.isInteger(page.total) &&
                        page.total >= page.page && typeof page.text === 'string')) return null;
                    if (!pageIndices && (!result.pages.length || result.pages.length !== result.pages[0].total ||
                        result.pages.some((page, i) => page.page !== i + 1 || page.total !== result.pages.length))) return null;
                    if (pageIndices && (result.pages.length !== pageIndices.length ||
                        result.pages.some((page, i) => page.page !== pageIndices[i] + 1))) return null;
                    return result.pages;
                } catch (_) {
                    return null;
                }
            },

            _formatDocumentText: function (pages) {
                const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
                return pages.map(page => `\n${separator}\nPÁGINA ${page.page} DE ${page.total}\n${separator}\n` +
                    (page.text.trim() ? page.text + '\n' : '[Esta página no contiene texto extraíble o está en formato imagen]\n')).join('').trim();
            },

            extractDocumentText: async function (pdfBuffer) {
                const nativePages = await this._extractNativeText(pdfBuffer);
                if (nativePages) return this._formatDocumentText(nativePages);
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Extracting full document text for AI context...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json

def extract_full_text(data_bytes):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")

    pages_text = []
    total_pages = len(doc)

    for pno, page in enumerate(doc):
        # TEXT_PRESERVE_LIGATURES: mantiene fi, fl como caracteres reales
        # sort=True: ordena bloques por posicion (orden de lectura natural)
        text = page.get_text(
            "text",
            flags=fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE,
            sort=True
        ).strip()

        # Incluir la pagina incluso si esta vacia (probable imagen escaneada)
        pages_text.append({
            "page": pno + 1,
            "total": total_pages,
            "text": text,
            "hasText": len(text) > 10
        })

    return json.dumps(pages_text, ensure_ascii=False)

extract_full_text(js_pdf_data)
                    `, { js_pdf_data: uint8 });

                    const pages = JSON.parse(result);
                    return this._formatDocumentText(pages);
                } catch (e) {
                    console.warn("🐍 Python: extractDocumentText failed", e);
                    return null; // null = usar fallback PDF.js
                }
            },

            /**
             * Extrae el texto de una sola página con PyMuPDF.
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum - 0-indexed
             * @returns {string|null}
             */
            extractPageText: async function (pdfBuffer, pageNum) {
                const nativePages = await this._extractNativeText(pdfBuffer, [pageNum]);
                if (nativePages) return nativePages[0]?.text || null;
                if (!this.isLoaded) await this.init();
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz

def extract_page_text(data_bytes, pno):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    if pno >= len(doc): return ""
    page = doc[pno]
    return page.get_text(
        "text",
        flags=fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE,
        sort=True
    ).strip()

extract_page_text(js_pdf_data, js_pno)
                    `, { js_pdf_data: uint8, js_pno: pageNum });
                    return result || null;
                } catch (e) {
                    console.warn("🐍 Python: extractPageText failed", e);
                    return null;
                }
            },

            /**
             * Extrae todas las líneas de texto del documento con métricas tipográficas REALES.
             * Reemplaza el loop PDF.js de detectIndexTitles: obtiene font flags (bold/italic),
             * tamaño real en puntos, y color directamente del stream PDF.
             * @param {ArrayBuffer} pdfBuffer
             * @returns {Array} [{text, fontSize, isBold, isItalic, pageNum (1-based), y, color}, ...]
             */
            extractDocumentLines: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Extracting document lines with real font metrics...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json

def extract_lines(data_bytes):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    all_lines = []

    for pno, page in enumerate(doc):
        page_h = page.rect.height
        # "dict" agrupa por bloques > lineas > spans — perfecto para detectar lineas reales
        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE)

        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:  # solo bloques de texto (type=0)
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue

                # Reconstruir el texto de la linea desde todos sus spans
                line_text = "".join(s.get("text", "") for s in spans).strip()
                if not line_text:
                    continue

                # Usar el span dominante (el de mayor ancho) para las metricas tipograficas
                dominant = max(spans, key=lambda s: s.get("bbox", [0,0,0,0])[2] - s.get("bbox", [0,0,0,0])[0])
                font_size = round(dominant.get("size", 12), 2)
                flags = dominant.get("flags", 0)
                is_bold   = bool(flags & 16)   # bit 4
                is_italic = bool(flags & 2)    # bit 1

                # Color del texto (entero RGB packed)
                c = dominant.get("color", 0)
                r_val = (c >> 16) & 255
                g_val = (c >> 8) & 255
                b_val = c & 255
                color_hex = f"#{r_val:02x}{g_val:02x}{b_val:02x}"

                # Bbox Y: coordenada superior de la linea en el sistema Y-down de PyMuPDF
                bbox = line.get("bbox", [0, 0, 0, 0])
                y_pos = round(bbox[1], 2)
                x_pos = round(bbox[0], 2)

                all_lines.append({
                    "text":     line_text,
                    "fontSize": font_size,
                    "isBold":   is_bold,
                    "isItalic": is_italic,
                    "color":    color_hex,
                    "pageNum":  pno + 1,
                    "y":        y_pos,
                    "x":        x_pos
                })

    return json.dumps(all_lines)

extract_lines(js_pdf_data)
                    `, { js_pdf_data: uint8 });
                    return JSON.parse(result);
                } catch (e) {
                    console.warn("🐍 Python: extractDocumentLines failed", e);
                    return null; // null = usar fallback PDF.js
                }
            },

            /**
             * Busca texto en todo el documento PDF usando PyMuPDF (search_for).
             * Mucho más preciso que PDF.js: maneja kerning, spans partidos, ligaduras,
             * texto con codificación especial y búsqueda case-insensitive nativa.
             * @param {ArrayBuffer} pdfBuffer
             * @param {string} term - Texto a buscar
             * @param {boolean} caseSensitive - Default false
             * @returns {Array} [{pageIdx, x0, y0, x1, y1, pageW, pageH}, ...]
             *   Coordenadas en puntos PDF (Y-down desde arriba), listas para escalar con currentScale.
             */
            searchInDocument: async function (pdfBuffer, term, caseSensitive = false) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Searching "${term}" (caseSensitive=${caseSensitive})...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    if (!this._searchSource) {
                        const response = await fetch('js/pdf_search.py?v=3.2.21');
                        if (!response.ok) throw new Error('SEARCH_SOURCE_UNAVAILABLE');
                        this._searchSource = await response.text();
                    }
                    const result = await this.run(this._searchSource + '\nsearch_doc(js_pdf_data, js_term, js_case)',
                        { js_pdf_data: uint8, js_term: term, js_case: caseSensitive });
                    return JSON.parse(result);
                } catch (e) {
                    console.warn("🐍 Python: Search failed, JS fallback will be used", e);
                    return null; // null = usar fallback JS
                }
            },

            /**
             * Detecta el color de fondo REAL de un área del PDF usando PyMuPDF.
             * Analiza los paths vectoriales (get_drawings) para encontrar rellenos
             * que cubren el área objetivo — eliminando la dependencia del canvas del browser.
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum - 0-indexed
             * @param {Object} rect - {x, y, w, h} en puntos PDF (Y-down, origen arriba-izquierda)
             * @returns {Object} { color: "#rrggbb", type: "solid"|"gradient"|"image"|"white"|"none", confidence: 0-1 }
             */
            getPageBackground: async function (pdfBuffer, pageNum, rect) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Detecting real PDF background color...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, json

def get_background(data_bytes, pno, rect_list):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)

    doc = fitz.open(stream=data_bytes, filetype="pdf")
    page = doc[pno]
    page_h = page.rect.height

    # Rect objetivo en coordenadas PDF (Y-down, como viene de JS)
    rx0, ry0, rx1, ry1 = float(rect_list[0]), float(rect_list[1]), float(rect_list[2]), float(rect_list[3])
    target = fitz.Rect(rx0, ry0, rx1, ry1)
    target_area = max((rx1 - rx0) * (ry1 - ry0), 0.001)

    # ── 1. Analizar paths vectoriales de dibujo ─────────────────────────────
    # get_drawings() devuelve todos los paths con fill/stroke en la página.
    # Buscamos el que más se solape con el área objetivo y tenga fill definido.
    best_color = None
    best_overlap_ratio = 0.0
    has_image_bg = False

    drawings = page.get_drawings()
    for draw in drawings:
        fill = draw.get("fill")
        if fill is None:
            continue

        dr = draw.get("rect")
        if dr is None:
            continue

        # Calcular solapamiento
        ix0 = max(rx0, dr.x0)
        iy0 = max(ry0, dr.y0)
        ix1 = min(rx1, dr.x1)
        iy1 = min(ry1, dr.y1)
        if ix1 <= ix0 or iy1 <= iy0:
            continue

        overlap = (ix1 - ix0) * (iy1 - iy0)
        # ¿Cubre al menos 50% del área objetivo?
        ratio = overlap / target_area
        if ratio > best_overlap_ratio:
            best_overlap_ratio = ratio
            # fill es (R,G,B) 0-1 en PyMuPDF
            if len(fill) >= 3:
                best_color = fill

    # ── 2. Verificar si hay imagen de fondo en el área ──────────────────────
    for img_info in page.get_images(full=True):
        # Obtener bbox de la imagen en la página
        xref = img_info[0]
        try:
            img_rects = page.get_image_rects(xref)
            for ir in img_rects:
                ix0 = max(rx0, ir.x0)
                iy0 = max(ry0, ir.y0)
                ix1 = min(rx1, ir.x1)
                iy1 = min(ry1, ir.y1)
                if ix1 > ix0 and iy1 > iy0:
                    overlap = (ix1 - ix0) * (iy1 - iy0)
                    if overlap / target_area > 0.3:
                        has_image_bg = True
                        break
        except Exception:
            pass
        if has_image_bg:
            break

    # ── 3. Construir respuesta ───────────────────────────────────────────────
    if has_image_bg:
        return json.dumps({"color": None, "type": "image", "confidence": 0.9})

    if best_color and best_overlap_ratio > 0.5:
        r = int(round(best_color[0] * 255))
        g = int(round(best_color[1] * 255))
        b = int(round(best_color[2] * 255))
        # Colores muy oscuros (negro/gris muy oscuro) son bordes o lineas, no fondos reales
        luminance = 0.299 * r + 0.587 * g + 0.114 * b
        if luminance < 40:
            return json.dumps({"color": "#ffffff", "type": "default", "confidence": 0.3})
        return json.dumps({"color": f"#{r:02x}{g:02x}{b:02x}", "type": "vector", "confidence": best_overlap_ratio})

    # ── 3. Fallback: Muestreo de píxeles (Pixmap) ──
    # Si no hay vectores claros, renderizamos el área pequeña y buscamos el color dominante
    try:
        sample_rect = target.irect + (-2, -2, 2, 2)
        pix = page.get_pixmap(clip=sample_rect, matrix=fitz.Matrix(2, 2))
        import collections
        color_counts = collections.Counter()
        for i in range(0, len(pix.samples), pix.n):
            rgb = tuple(pix.samples[i:i+3])
            if sum(rgb) > 60: # Incluir colores más oscuros (menos el casi negro)
                color_counts[rgb] += 1
        
        if color_counts:
            # Filtrar colores muy oscuros (bordes/texto) para quedarnos con el fondo real
            light_counts = {rgb: cnt for rgb, cnt in color_counts.items()
                            if (0.299*rgb[0] + 0.587*rgb[1] + 0.114*rgb[2]) >= 40}
            source = light_counts if light_counts else color_counts
            most_common = max(source, key=source.get)
            r, g, b = most_common
            return json.dumps({"color": f"#{r:02x}{g:02x}{b:02x}", "type": "raster", "confidence": 0.7})
    except Exception:
        pass

    return json.dumps({"color": "#ffffff", "type": "default", "confidence": 0.3})

get_background(js_pdf_data, js_pno, js_rect)
                    `, { js_pdf_data: uint8, js_pno: pageNum, js_rect: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h] });
                    return JSON.parse(result);
                } catch (e) {
                    console.warn("🐍 Python: Background detection failed", e);
                    return { color: null, type: "none", confidence: 0 };
                }
            },

            /**
             * Pre-procesa una imagen para mejorar la precisión del OCR con Tesseract
             * @param {string} base64Image  DataURL de la imagen
             * @returns {string} DataURL de la imagen procesada
             */
            preprocessForOCR: async function (base64Image) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PIL): Preprocessing image for OCR (V2 adaptive)...");
                try {
                    const result = await this.run(`
import base64, io
import PIL.Image as Image
import PIL.ImageFilter as ImageFilter
import PIL.ImageStat as ImageStat
import PIL.ImageEnhance as ImageEnhance
import PIL.ImageOps as ImageOps

def preprocess_ocr(b64_data):
    img_data = base64.b64decode(b64_data.split(',')[1] if ',' in b64_data else b64_data)
    img = Image.open(io.BytesIO(img_data)).convert("L")  # Escala de grises

    stat = ImageStat.Stat(img)
    mean_brightness = stat.mean[0]
    std_brightness  = stat.stddev[0]

    # ── 1. Detectar inversión (texto claro sobre fondo oscuro) ──────────────
    # Si la media de brillo es baja Y la desviación es moderada,
    # probablemente es texto blanco/claro sobre fondo negro/oscuro.
    # En ese caso, invertir la imagen antes de binarizar (Tesseract espera
    # texto oscuro sobre fondo claro).
    is_dark_bg = mean_brightness < 128
    if is_dark_bg:
        img = ImageOps.invert(img)
        stat = ImageStat.Stat(img)
        mean_brightness = stat.mean[0]
        std_brightness  = stat.stddev[0]
        print(f"🔄 Imagen invertida (fondo oscuro detectado): media={mean_brightness:.1f}")

    # ── 2. Mejorar contraste — solo si la imagen tiene bajo contraste ────────
    # Un contraste std_dev < 40 indica imagen lavada (bajo contraste).
    # Aplicar enhancement agresivo en ese caso, suave si ya tiene buen contraste.
    if std_brightness < 40:
        factor = 2.0   # Imagen muy lavada: boost fuerte
    elif std_brightness < 70:
        factor = 1.5   # Contraste normal: boost moderado
    else:
        factor = 1.1   # Ya tiene buen contraste: boost mínimo para no quemar
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(factor)

    # ── 3. Sharpening para bordes de letras más nítidos ──────────────────────
    img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=140, threshold=2))

    # ── 4. Binarización adaptativa mejorada ──────────────────────────────────
    # El threshold original era siempre mean * 0.88, que fallaba en imágenes
    # con distribuciones bimodales (mucho fondo blanco + texto negro).
    # Ahora usamos un método más robusto: calcular el umbral como el promedio
    # del percentil 25 y 75 de la distribución de brillo (pseudo-Otsu con PIL).
    # Esto es más estable que usar solo la media.

    stat2 = ImageStat.Stat(img)
    mean2 = stat2.mean[0]

    # Construir histograma de 256 bins con PIL
    hist = img.histogram()  # Lista de 256 valores
    total_px = sum(hist)

    # Buscar el umbral por método de Otsu simplificado (máxima varianza entre clases)
    best_thresh = int(mean2 * 0.88)  # fallback al valor original
    if total_px > 0:
        # Calcular varianza entre clases para cada posible threshold
        best_var = -1.0
        w0_sum, w1_sum = 0, total_px
        m0_sum = 0.0
        total_mean = sum(i * hist[i] for i in range(256)) / total_px
        for t in range(1, 255):
            w0_sum += hist[t - 1]
            w1_sum -= hist[t - 1]
            m0_sum += (t - 1) * hist[t - 1]
            if w0_sum == 0 or w1_sum == 0:
                continue
            m0 = m0_sum / w0_sum
            m1 = (total_mean * total_px - m0_sum) / w1_sum
            var = (w0_sum / total_px) * (w1_sum / total_px) * (m0 - m1) ** 2
            if var > best_var:
                best_var = var
                best_thresh = t

    img_bin = img.point(lambda x: 255 if x > best_thresh else 0, 'L')

    # ── 5. Eliminar ruido de sal/pimienta (MedianFilter 3x3) ─────────────────
    img_bin = img_bin.filter(ImageFilter.MedianFilter(size=3))

    print(f"✅ OCR preprocess: invert={is_dark_bg}, contrast_factor={factor:.1f}, otsu_thresh={best_thresh}, std={std_brightness:.1f}")

    buffered = io.BytesIO()
    img_bin.save(buffered, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode()

preprocess_ocr(js_image)
                    `, { js_image: base64Image });
                    return result;
                } catch (e) {
                    console.warn("🐍 Python: OCR preprocessing failed, using original", e);
                    return base64Image;
                }
            },

            /**
             * Encripta un PDF usando PyMuPDF (AES-256).
             * A diferencia de jsPDF, esto preserva vectores, texto seleccionable y formularios.
             * @param {ArrayBuffer} pdfBuffer - PDF sin encriptar
             * @param {string} userPassword - Contraseña de usuario (para abrir)
             * @param {string} ownerPassword - Contraseña de propietario (para editar)
             * @param {Array} permissions - ['print','modify','copy','annotate']
             * @returns {ArrayBuffer} PDF encriptado
             */
            encryptPDF: async function (pdfBuffer, userPassword, ownerPassword, permissions = []) {
                if (!this.isLoaded) await this.init();
                console.log('🐍 Python (PyMuPDF): Encrypting PDF with AES-256...');
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const permsJson = JSON.stringify(permissions);
                    const result = await this.run(`
import fitz, json, io

def encrypt_pdf(data_bytes, user_pw, owner_pw, perms_json):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    perms = json.loads(perms_json)

    # Mapear permisos de JS a flags PyMuPDF
    perm_flags = 0
    # fitz.PDF_PERM_PRINT          = permitir impresión
    # fitz.PDF_PERM_MODIFY         = permitir modificación de contenido
    # fitz.PDF_PERM_COPY           = permitir copiar texto/imágenes
    # fitz.PDF_PERM_ANNOTATE       = permitir agregar anotaciones
    # fitz.PDF_PERM_FORM           = permitir llenar formularios
    # fitz.PDF_PERM_ACCESSIBILITY  = permitir accesibilidad
    # fitz.PDF_PERM_ASSEMBLE       = permitir ensamblaje de páginas
    # fitz.PDF_PERM_PRINT_HQ       = permitir impresión alta calidad
    if 'print' in perms:
        perm_flags |= fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ
    if 'modify' in perms:
        perm_flags |= fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ASSEMBLE
    if 'copy' in perms:
        perm_flags |= fitz.PDF_PERM_COPY | fitz.PDF_PERM_ACCESSIBILITY
    if 'annotate' in perms:
        perm_flags |= fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_FORM

    out = io.BytesIO()
    doc.save(out,
        encryption=fitz.PDF_ENCRYPT_AES_256,
        user_pw=user_pw,
        owner_pw=owner_pw,
        permissions=perm_flags,
        garbage=4,
        deflate=True,
        clean=True
    )
    print(f"🔒 PDF encriptado: AES-256, permisos={perms}, tamaño={len(out.getvalue())//1024}KB")
    return bytes(out.getvalue())

encrypt_pdf(js_pdf_data, js_user_pw, js_owner_pw, js_perms)
                    `, { js_pdf_data: uint8, js_user_pw: userPassword, js_owner_pw: ownerPassword, js_perms: permsJson });

                    if (result && result.toJs) {
                        const u8 = result.toJs();
                        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                    }
                    if (result instanceof Uint8Array) {
                        return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    }
                    throw new Error('Resultado inesperado de encryptPDF');
                } catch (e) {
                    console.error('🐍 Python: Encryption failed', e);
                    throw e; // Propagar para que el caller use fallback
                }
            },

            /**
             * Desencripta un PDF protegido con contraseña usando PyMuPDF.
             * Devuelve un ArrayBuffer con el PDF sin cifrado.
             * @param {ArrayBuffer} pdfBuffer
             * @param {string} password - Contraseña de usuario o propietario
             * @returns {ArrayBuffer} PDF desencriptado
             */
            decryptPDF: async function (pdfBuffer, password) {
                if (!this.isLoaded) await this.init();
                const uint8 = new Uint8Array(pdfBuffer);
                const result = await this.run(`
import fitz, io

def decrypt_pdf(data_bytes, pw):
    if hasattr(data_bytes, 'to_py'):
        data_bytes = bytes(data_bytes.to_py())
    else:
        data_bytes = bytes(data_bytes)
    doc = fitz.open(stream=data_bytes, filetype="pdf")
    if doc.is_encrypted:
        ok = doc.authenticate(pw)
        if not ok:
            raise ValueError("Contraseña incorrecta para desencriptar")
    out = io.BytesIO()
    doc.save(out, encryption=fitz.PDF_ENCRYPT_NONE, garbage=3, deflate=True, clean=True)
    return bytes(out.getvalue())

decrypt_pdf(js_pdf_data, js_password)
                `, { js_pdf_data: uint8, js_password: password });

                if (result && result.toJs) {
                    const u8 = result.toJs();
                    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                }
                if (result instanceof Uint8Array) {
                    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                }
                throw new Error('Resultado inesperado de decryptPDF');
            },

            /**
             * Combina múltiples PDFs en uno solo usando PyMuPDF.
             * Preserva enlaces internos, marcadores y estructura.
             * @param {Array<ArrayBuffer>} buffers - Lista de buffers de PDF
             * @returns {ArrayBuffer} PDF combinado
             */
            mergePDFs: async function (buffers, docNames = []) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Merging ${buffers.length} PDFs with nested bookmarks...`);
                try {
                    const uint8List = buffers.map(b => new Uint8Array(b));
                    const namesJson = JSON.stringify(docNames || []);
                    const result = await this.run(`
import fitz, io, json

def merge_list(pdf_buffers, names_json):
    names = json.loads(names_json) if names_json else []
    out = fitz.open()
    combined_toc = []
    
    for idx, data in enumerate(pdf_buffers):
        if hasattr(data, 'to_py'):
            data = bytes(data.to_py())
        else:
            data = bytes(data)
        
        try:
            src = fitz.open(stream=data, filetype="pdf")
            p_offset = len(out)
            out.insert_pdf(src)
            
            # Root bookmark for document (PdfCraft style)
            doc_name = names[idx] if idx < len(names) and names[idx] else f"Documento {idx + 1}"
            root_pno = p_offset + 1
            combined_toc.append([1, doc_name, root_pno])
            
            # Subordinate existing TOC under root bookmark
            try:
                sub_toc = src.get_toc()
                for item in sub_toc:
                    combined_toc.append([item[0] + 1, item[1], item[2] + p_offset])
            except Exception as te:
                print(f"⚠️ Error reading sub-TOC: {te}")
                
            src.close()
        except Exception as e:
            print(f"⚠️ Error al insertar PDF: {e}")
            
    if combined_toc:
        try:
            out.set_toc(combined_toc)
        except Exception as toce:
            print(f"⚠️ Error setting combined TOC: {toce}")

    # Optimizar y comprimir el resultado
    output = io.BytesIO()
    out.save(output, garbage=4, deflate=True)
    out.close()
    return bytes(output.getvalue())

merge_list(js_pdf_list, js_names)
                    `, { js_pdf_list: uint8List, js_names: namesJson });

                    if (result && result.toJs) {
                        const u8 = result.toJs();
                        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                    }
                    if (result instanceof Uint8Array) {
                        return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    }
                    throw new Error('Resultado inesperado de mergePDFs');
                } catch (e) {
                    console.error('🐍 Python: Merge failed', e);
                    throw e;
                }
            },

            /**
             * Repara y optimiza la estructura de un PDF.
             */
            repairAndOptimize: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Repairing & Optimizing structure...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, io
def repair(data):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    out = io.BytesIO()
    # garbage=4: compacta al máximo, deflate=True: comprime streams, clean=True: repara estructura
    doc.save(out, garbage=4, deflate=True, clean=True)
    return bytes(out.getvalue())
repair(js_data)
                    `, { js_data: uint8 });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Repair failed", e);
                    throw e;
                }
            },

            /**
             * Aplana formularios y anotaciones de forma permanente.
             */
            flattenPDF: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Flattening forms & annotations...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, io
def flatten(data):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    # PyMuPDF 1.24+: use bake() to flatten widgets and annotations
    if hasattr(doc, 'bake'):
        doc.bake()
    else:
        for page in doc:
            for w in list(page.widgets()): w.update()
            page.clean_contents()
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    return bytes(out.getvalue())
flatten(js_data)
                    `, { js_data: uint8 });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Flatten failed", e);
                    throw e;
                }
            },

            /**
             * Convierte el documento a Escala de Grises real.
             */
            convertToGrayscale: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Converting to grayscale...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, io
def to_gray(data):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    src = fitz.open(stream=data, filetype="pdf")
    out_doc = fitz.open()
    for i in range(len(src)):
        page = src[i]
        pix = page.get_pixmap(colorspace=fitz.csGRAY, alpha=False)
        img_bytes = pix.tobytes("png")
        new_page = out_doc.new_page(width=pix.width, height=pix.height)
        new_page.insert_image(fitz.Rect(0, 0, pix.width, pix.height), stream=img_bytes)
    buf = io.BytesIO()
    out_doc.save(buf, garbage=4, deflate=True)
    src.close()
    out_doc.close()
    return bytes(buf.getvalue())
to_gray(js_data)
                    `, { js_data: uint8 });
                    if (result && result.toJs) {
                        const u8 = result.toJs();
                        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
                    }
                    if (result instanceof Uint8Array)
                        return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                    return pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Grayscale failed", e);
                    throw e;
                }
            },

            /**
             * Exporta una página en alta resolución (300 DPI).
             */
            exportHighResImage: async function (pdfBuffer, pageNum) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Exporting 300 DPI image...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, base64
def export_img(data, pno):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc[pno]
    pix = page.get_pixmap(dpi=300)
    return "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode()
export_img(js_data, js_pno)
                    `, { js_data: uint8, js_pno: pageNum });
                    return result;
                } catch (e) {
                    console.error("🐍 Python: High-res export failed", e);
                    throw e;
                }
            },

            /**
             * Detecta y redacta automáticamente patrones (emails, teléfonos, etc).
             */
            autoRedactPattern: async function (pdfBuffer, patternType) {
                if (!this.isLoaded) await this.init();
                console.log(`🐍 Python (PyMuPDF): Auto-redacting ${patternType}...`);
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const result = await this.run(`
import fitz, io, re
def auto_redact(data, p_type):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    
    # Patrones comunes seguros
    patterns = {
        "email": r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        "phone": r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",
    }
    pat_str = patterns.get(p_type, patterns["email"])
    rx = re.compile(pat_str)
    
    total_found = 0
    for page in doc:
        # Extraer texto de la página y buscar coincidencias con regex
        text = page.get_text("text")
        matches = set()
        for m in rx.finditer(text):
            matches.add(m.group(0))
        
        # También buscar en bloques/spans individuales
        raw = page.get_text("rawdict")
        for bl in raw.get("blocks", []):
            for ln in bl.get("lines", []):
                for sp in ln.get("spans", []):
                    st = sp.get("text", "")
                    for m in rx.finditer(st):
                        matches.add(m.group(0))
                        
        found_in_page = 0
        for match_str in matches:
            match_clean = match_str.strip()
            if not match_clean:
                continue
            text_instances = page.search_for(match_clean)
            for inst in text_instances:
                page.add_redact_annot(inst, fill=(0, 0, 0))
                total_found += 1
                found_in_page += 1
                
        if found_in_page > 0:
            page.apply_redactions()
            
    print(f"🐍 AI-Redact: Encontradas y eliminadas {total_found} instancias de {p_type}")
    
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    return bytes(out.getvalue())
auto_redact(js_data, js_type)
                    `, { js_data: uint8, js_type: patternType });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Auto-redact failed", e);
                    throw e;
                }
            },

            /**
             * Crea un PDF buscable insertando una capa invisible de texto (para OCR).
             */
            createSearchablePDF: async function (pdfBuffer, ocrData) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Creating Searchable PDF...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const ocrJson = JSON.stringify(ocrData);
                    const result = await this.run(`
import fitz, io, json
def make_searchable(data, ocr_json):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    ocr_results = json.loads(ocr_json)
    
    # Asume que ocr_results es una lista de {text, bbox, page}
    # bbox format: [x0, y0, x1, y1]
    for item in ocr_results:
        pno = item.get("page", 0)
        if pno < len(doc):
            page = doc[pno]
            # Insertar texto invisible (rendermode 3)
            # Esto hace que el PDF se pueda buscar y copiar pero mantiene la imagen visual
            # Nota: Esto requiere PyMuPDF >= 1.22.0 insert_text
            page.insert_text(
                fitz.Point(item["bbox"][0], item["bbox"][1]),
                item["text"],
                fontsize=item.get("fontsize", 10),
                render_mode=3
            )
            
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    return bytes(out.getvalue())
make_searchable(js_data, js_ocr)
                    `, { js_data: uint8, js_ocr: ocrJson });
                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Searchable PDF failed", e);
                    throw e;
                }
            },

            /**
             * Edición Quirúrgica: Elimina contenido de un área y añade nuevo texto/imagen directamente al stream.
             * Similar a lo que hace Adobe Acrobat para editar texto "real".
             */
            applyPermanentEdit: async function (pdfBuffer, pageNum, editData) {
                if (!this.isLoaded) await this.init();
                console.log("🐍 Python (PyMuPDF): Applying real-stream edit...");
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const editJson = JSON.stringify(editData);
                    const result = await this.run(`
import fitz, io, json, base64

def apply_real_edit(data, pno, edit_json):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc[pno]
    edit = json.loads(edit_json)
    
    rect = fitz.Rect(edit["x"], edit["y"], edit["x"] + edit["w"], edit["y"] + edit["h"])
    
    # 1. REDACTAR (Borrar contenido original físicamente)
    # Rellenar con el color de fondo exacto detectado
    bg = edit.get("bgColor", "#FFFFFF")
    rgb_bg = tuple(int(bg.lstrip('#')[i:i+2], 16)/255.0 for i in (0, 2, 4))
    
    # Redacción con un ligero margen (0.5pt) para asegurar limpieza total de antialiasing
    clean_rect = rect + (-0.2, 0, 0.2, 0)
    page.add_redact_annot(clean_rect, fill=rgb_bg)
    page.apply_redactions()
    
    # 2. FONDO DE TEXTURA (Opcional)
    if edit.get("bgImage") and edit["bgImage"].startswith("data:"):
        img_data = base64.b64decode(edit["bgImage"].split(',')[1])
        page.insert_image(rect, stream=img_data)
    
    # 3. INSERTAR NUEVO TEXTO
    if edit.get("text"):
        color = edit.get("color", "#000000")
        rgb_color = tuple(int(color.lstrip('#')[i:i+2], 16)/255.0 for i in (0, 2, 4))
        
        # --- Mapeo ampliado PDF name → base14 + variantes bold/italic ---
        fname = (edit.get("font") or "helv").lower()
        is_bold   = bool(edit.get("isBold"))
        is_italic = bool(edit.get("isItalic"))

        # Familia base14: helv(Helvetica), tiro(Times), cour(Courier)
        # Variantes: hebo=Helv-Bold, heit=Helv-BoldOblique, heob=Helv-Oblique
        #            tibo=Times-Bold, tibi=Times-BoldItalic, tiit=Times-Italic
        #            cobo=Cour-Bold, cobi=Cour-BoldItalic, coit=Cour-Oblique
        font_families = {
            'helv': {'n':'helv','b':'hebo','i':'helv','bi':'heit'},
            'tiro': {'n':'tiro','b':'tibo','i':'tiit','bi':'tibi'},
            'cour': {'n':'cour','b':'cobo','i':'coit','bi':'cobi'},
        }
        keywords_map = [
            (['helvetica','arial','arialmt','myriad','calibri','verdana','tahoma',
              'gothic','grotesk','sans serif','sansserif','futura','gill','frutiger',
              'optima','univers','segoe','trebuchet','franklin'], 'helv'),
            (['times','tiro','georgia','garamond','palatino','cambria','constantia',
              'book antiqua','bookman','caslon','roman','serif'], 'tiro'),
            (['courier','cour','consolas','monaco','lucida console','monospace',
              'typewriter','ocr'], 'cour'),
        ]
        base_family = 'helv'
        for keywords, family in keywords_map:
            if any(k in fname for k in keywords):
                base_family = family
                break

        variant_key = 'bi' if (is_bold and is_italic) else ('b' if is_bold else ('i' if is_italic else 'n'))
        font_final = font_families[base_family][variant_key]

        # --- Intento de reusar fuente embebida del PDF ---
        # Solo funciona si la fuente NO es subset y el buffer tiene bytes reales (>1024)
        embedded_font_name = None
        try:
            raw_font_name = edit.get("font") or ""
            import re
            _m_emb = re.match(r'^emb_(\d+)$', raw_font_name)
            if _m_emb:
                _xref = int(_m_emb.group(1))
                try:
                    _fdr = doc.extract_font(_xref)
                    _bufr = _fdr[3] if _fdr else None
                    if _bufr and len(_bufr) > 1024:
                        _emb_fn = f"emb_{_xref}"
                        page.insert_font(fontname=_emb_fn, fontbuffer=_bufr)
                        embedded_font_name = _emb_fn
                except Exception: pass

            if not embedded_font_name:
                def _clean_font_name_py(f):
                    if not f: return ""
                    if len(f) > 7 and f[6] == '+':
                        f = f[7:]
                    f = f.lower()
                    f = re.sub(r'[\s,_-]*(bold|italic|oblique|mt|ps|regular|roman|semibold|condensed|narrow|negrita|black|heavy|demibold|demiboldoblique)\b', '', f)
                    f = re.sub(r'[^a-z0-9]', '', f)
                    return f

                clean_target = _clean_font_name_py(raw_font_name)
                if clean_target:
                    for xref, ext, ftype, basefont, name, enc, ref in page.get_fonts(full=True):
                        _clean_bf = _clean_font_name_py(basefont)
                        if (_clean_bf == clean_target or clean_target in _clean_bf or _clean_bf in clean_target) and ext:
                            font_data = doc.extract_font(xref)
                            buf = font_data[3] if font_data else None
                            if buf and len(buf) > 1024:
                                try:
                                    _emb_fn = f"emb_{xref}"
                                    page.insert_font(fontname=_emb_fn, fontbuffer=buf)
                                    embedded_font_name = _emb_fn
                                except Exception:
                                    pass
                                break
        except Exception:
            pass

        use_font = embedded_font_name if embedded_font_name else font_final

        # Insertar usando el origen exacto si está disponible, o el rect
        origin = edit.get("origin")
        if origin and len(origin) == 2:
            insert_pt = fitz.Point(origin[0], origin[1])
        else:
            insert_pt = fitz.Point(edit["x"], edit["y"] + edit["h"] * 0.8) # Aproximacion
        
        try:
            page.insert_text(insert_pt, edit["text"], fontsize=edit.get("size", 10), fontname=use_font, color=rgb_color)
        except Exception:
            page.insert_text(insert_pt, edit["text"], fontsize=edit.get("size", 10), fontname='helv', color=rgb_color)
            
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    return bytes(out.getvalue())

apply_real_edit(js_data, js_pno, js_edit)
                    `, { js_data: uint8, js_pno: pageNum, js_edit: editJson });

                    if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                    return result instanceof Uint8Array ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) : pdfBuffer;
                } catch (e) {
                    console.error("🐍 Python: Real edit failed", e);
                    throw e;
                }
            },

            // ── Reflow Text Edit (Fase 1 + Fase 2) ───────────────────────
            /**
             * Edita texto PDF nativo con reflow real.
             * Fase 1: insert_textbox → word-wrap automático dentro del bbox original.
             * Fase 2: si el texto no cabe, expande el bbox hacia abajo.
             * @param {ArrayBuffer} pdfBuffer
             * @param {number} pageNum  0-based
             * @param {Object} editData { x, y, w, h, text, size, color, bgColor, font, origin, expandIfNeeded }
             * @returns {{ buffer: ArrayBuffer, overflow: bool, expandedH: number, originalH: number }}
             */
            applyReflowEdit: async function (pdfBuffer, pageNum, editData) {
                if (!this.isLoaded) await this.init();
                console.log('🐍 Python (PyMuPDF): Applying reflow edit...');
                try {
                    const uint8 = new Uint8Array(pdfBuffer);
                    const editJson = JSON.stringify(editData);
                    const result = await this.run(`
import fitz, io, json, base64, os

def apply_reflow_edit(data, pno, edit_json):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype='pdf')
    page = doc[pno]
    edit = json.loads(edit_json)

    x, y, w, h = edit['x'], edit['y'], edit['w'], edit['h']
    # Si el usuario editó un sub-span (ej. "MÉDICA" de "EXPERIENCIA MÉDICA"),
    # eraseFullX/W definen el span completo del PDF para el add_redact_annot.
    _erase_x0 = float(edit.get('eraseFullX', x))
    _erase_x1 = _erase_x0 + float(edit.get('eraseFullW', w))
    # eraseFullY: Y original del span cuando el usuario arrastró. x/y son la posición nueva (insert).
    _erase_y0 = float(edit.get('eraseFullY', y))
    new_text = edit.get('text', '')
    font_size = float(edit.get('size', 10))
    expand = edit.get('expandIfNeeded', True)
    line_height_ratio = float(edit.get('lineHeight', 1.2))
    letter_spacing = float(edit.get('letterSpacing', 0.0))
    is_underline = bool(edit.get('isUnderline', False))

    def hex_to_rgb(hex_str, fallback='#ffffff'):
        s = (hex_str or fallback).strip()
        if s == 'transparent' or not s.startswith('#'):
            s = fallback
        h = s.lstrip('#')
        try:
            return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))
        except Exception:
            return (1.0, 1.0, 1.0)

    _erase_bg_hex = edit.get('eraseBgColor') or (edit.get('bgColor') if edit.get('bgColor') != 'transparent' else None) or '#ffffff'
    rgb_text = hex_to_rgb(edit.get('color', '#000000'), '#000000')
    rgb_bg   = hex_to_rgb(_erase_bg_hex, '#ffffff')

    # Helper: detectar subrayado original cercano en la página para igualar posición y grosor
    _ul_cache = {}
    def find_original_underline(page, ref_x, ref_y, search_radius_y=8, search_radius_x=100):
        cache_key = round(ref_y, 1)
        if cache_key in _ul_cache:
            return _ul_cache[cache_key]
        best_y = None
        best_width = None
        best_dist = float('inf')
        try:
            drawings = page.get_drawings()
        except Exception as de:
            print(f"⚠️ [UNDERLINE-DETECT] page.get_drawings failed: {de}")
            _ul_cache[cache_key] = (None, None)
            return None, None
        for path in drawings:
            p_rect = path.get("rect")
            if not p_rect:
                continue
            py0, py1 = p_rect.y0, p_rect.y1
            p_height = py1 - py0
            p_width = p_rect.x1 - p_rect.x0
            is_horiz = False
            line_y = None
            line_thick = None
            for item in path.get("items", []):
                if item[0] == "l":
                    p1, p2 = item[1], item[2]
                    if abs(p1.y - p2.y) < 0.5 and abs(p2.x - p1.x) > 5:
                        is_horiz = True
                        line_y = (p1.y + p2.y) / 2.0
                        line_thick = path.get("width") or 1.0
                        break
            if not is_horiz and 0 < p_height <= 2.5 and p_width > 5:
                is_horiz = True
                line_y = (py0 + py1) / 2.0
                line_thick = p_height
            if not is_horiz or line_y is None:
                continue
            dy = abs(line_y - ref_y)
            if dy > search_radius_y:
                continue
            px0, px1 = p_rect.x0, p_rect.x1
            dx = 0
            if ref_x < px0: dx = px0 - ref_x
            elif ref_x > px1: dx = ref_x - px1
            if dx > search_radius_x:
                continue
            if dy < best_dist:
                best_dist = dy
                best_y = line_y
                best_width = line_thick
        if best_y is not None:
            print(f"🎯 [UNDERLINE-DETECT] Found original: y={best_y:.2f} thick={best_width:.3f} dist={best_dist:.2f}")
        _ul_cache[cache_key] = (best_y, best_width)
        return best_y, best_width

    def get_underline_params(page, ref_x, ref_y, fs):
        found_y, found_thick = find_original_underline(page, ref_x, ref_y)
        if found_y is not None and found_thick is not None:
            return found_y, found_thick
        _ul_offset = max(1.0, fs * 0.1)
        _ul_y = ref_y + _ul_offset
        _thick = max(0.5, fs * 0.05)
        return _ul_y, _thick

    fname = (edit.get('font') or 'helv').lower()
    is_bold   = bool(edit.get('isBold'))
    is_italic = bool(edit.get('isItalic'))

    font_families = {
        'helv': {'n':'helv','b':'hebo','i':'heit','bi':'hebi'},
        'tiro': {'n':'tiro','b':'tibo','i':'tiit','bi':'tibi'},
        'cour': {'n':'cour','b':'cobo','i':'coit','bi':'cobi'},
    }
    keywords_map = [
        (['helvetica','arial','arialmt','myriad','calibri','verdana','tahoma',
          'gothic','grotesk','sans serif','sansserif','futura','gill','frutiger',
          'optima','univers','segoe','trebuchet','franklin'], 'helv'),
        (['times','tiro','georgia','garamond','palatino','cambria','constantia',
          'book antiqua','bookman','caslon','roman','serif'], 'tiro'),
        (['courier','cour','consolas','monaco','lucida console','monospace',
          'typewriter','ocr'], 'cour'),
    ]
    base_family = 'helv'
    for keywords, family in keywords_map:
        if any(k in fname for k in keywords):
            base_family = family
            break

    variant_key = 'bi' if (is_bold and is_italic) else ('b' if is_bold else ('i' if is_italic else 'n'))
    font_final = font_families[base_family][variant_key]

    # Intento de reusar fuente embebida (incluyendo subsets: buscar por nombre base)
    embedded_font_name = None
    _js_font_obj = None
    _js_font_inserted = False
    _deferred_js_font_buf = None
    _deferred_js_font_file = None
    _deferred_emb_buf = None  # buffer de fuente embebida del PDF para rescue/deferred
    _emb_xref = None  # xref de la fuente embebida → nombre único emb_{xref}
    _precheck_usable = False   # True si _precheck_font fue registrada y NO es Type0 (glifos completos)
    _fallback_full_fn = None   # fuente con glifos completos para segmentos fallback (Capa 2+3)
    _pchk_fn = None  # nombre único para _precheck_font en esta edición

    # Helper: buscar fuente embebida en el PDF por nombre y retornar (xref, buf) o (None, None)
    def _find_pdf_embedded_font(target_name):
        if not target_name:
            return (None, None, None)
        import re
        # Prioridad 1: Si es emb_XX, extraer por xref directamente
        _m_emb = re.match(r'^emb_(\d+)$', target_name)
        if _m_emb:
            _xref = int(_m_emb.group(1))
            try:
                _fd = doc.extract_font(_xref)
                _buf = _fd[3] if _fd else None
                if _buf and len(_buf) > 1024:
                    return (_xref, _buf, None)
            except Exception:
                pass

        # Prioridad 2: Buscar coincidencia exacta por nombre de recurso
        for _xref, _ext, _ftype, _basefont, _name, _enc, _ref in page.get_fonts(full=True):
            if _ftype == 'Type0':
                continue
            if _name and _name.lower() == target_name.lower() and _ext:
                _fd = doc.extract_font(_xref)
                _buf = _fd[3] if _fd else None
                if _buf and len(_buf) > 1024:
                    return (_xref, _buf, _name)

        # Prioridad 3: Buscar usando el normalizador robusto y ranqueando por estilo (Bold/Italic)
        def _clean_font_name_py(f):
            if not f: return ""
            if len(f) > 7 and f[6] == '+':
                f = f[7:]
            f = f.lower()
            f = re.sub(r'[\s,_-]*(bold|italic|oblique|mt|ps|regular|roman|semibold|condensed|narrow|negrita|black|heavy|demibold|demiboldoblique)\b', '', f)
            f = re.sub(r'[^a-z0-9]', '', f)
            return f

        clean_target = _clean_font_name_py(target_name)
        if not clean_target:
            return (None, None, None)

        try:
            req_bold = _is_bold
            req_italic = _is_italic
        except NameError:
            req_bold = False
            req_italic = False

        candidates = []
        _page_font_names = {}
        for _xref, _ext, _ftype, _basefont, _name, _enc, _ref in page.get_fonts(full=True):
            _page_font_names[_xref] = _name
            if _ftype == 'Type0':
                continue
            _clean_bf = _clean_font_name_py(_basefont)
            if (_clean_bf == clean_target or clean_target in _clean_bf or _clean_bf in clean_target) and _ext:
                _font_lower = _basefont.lower()
                cand_bold = any(k in _font_lower for k in ('bold', 'negrita', 'black', 'heavy', 'semibold', 'demibold'))
                cand_italic = any(k in _font_lower for k in ('italic', 'oblique', 'inclined'))
                
                score = 0
                if cand_bold == req_bold:
                    score += 10
                if cand_italic == req_italic:
                    score += 5
                
                score -= abs(len(_clean_bf) - len(clean_target))
                candidates.append((score, _xref))

        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            print(f"📊 [FONT-RESCUE-RANKING] target='{target_name}' req_bold={req_bold} req_italic={req_italic} candidates={candidates}")
            for _, _xref in candidates:
                try:
                    _fd = doc.extract_font(_xref)
                    _buf = _fd[3] if _fd else None
                    if _buf and len(_buf) > 1024:
                        return (_xref, _buf, _page_font_names.get(_xref))
                except Exception:
                    pass
        return (None, None, None)

    try:
        js_font_b64 = edit.get('fontBuffer')
        js_font_name = edit.get('fontBufferName') or 'js_sys_font'
        _is_bold = edit.get('isBold', False)
        _is_italic = edit.get('isItalic', False)
        # Capa 3: fuente TTF pura enviada desde JS como fallback para glifos fuera del subset CID
        _fb_fallback_b64 = edit.get('fontBufferFallback')
        _fb_fallback_name = edit.get('fontBufferFallbackName') or 'verdana_fb'
        _precheck_font_buf = None  # buffer de _precheck_font para re-registro post-redact
        _deferred_fb_buf = None  # buffer TTF puro para segmentos fallback

        # Prioridad 1: bytes de fuente del sistema pasados desde JS
        if js_font_b64:
            import base64 as _b64mod, tempfile as _tmp, os as _os, hashlib as _hashlib
            js_font_buf = _b64mod.b64decode(js_font_b64)
            _is_otf = js_font_buf[0:4] == b'OTTO'
            _font_sha = _hashlib.sha256(js_font_buf).hexdigest()[:16]
            print(f"🟣 [FONT-DIAG] requested={js_font_name} buf={len(js_font_buf)}B sha256={_font_sha} magic={'OTF' if _is_otf else 'TTF'} bold={_is_bold} italic={_is_italic}")

            # Pre-check Type0: intentar insertar temporalmente para detectar antes de reservar
            _is_type0 = False
            if len(js_font_buf) > 1024:
                _ext = '.otf' if _is_otf else '.ttf'
                _tf = _tmp.NamedTemporaryFile(suffix=_ext, delete=False)
                _tf.write(js_font_buf)
                _tf.flush()
                _tf.close()
                try:
                    _js_font_obj = fitz.Font(fontfile=_tf.name)
                    print(f"✅ [FONT-DIAG] fitz.Font(file) name={getattr(_js_font_obj, 'name', None)} flags={getattr(_js_font_obj, 'flags', None)} asc={_js_font_obj.ascender:.3f} desc={_js_font_obj.descender:.3f}")
                except Exception as _jfe_fitz:
                    print(f"⚠️ [FONT-PY] fitz.Font(file) failed: {_jfe_fitz}")
                    _js_font_obj = None
                # Insertar temporalmente para verificar tipo
                try:
                    _pchk_fn = f'_pc_{abs(hash(js_font_b64[:64])) % 100000}'
                    page.insert_font(fontname=_pchk_fn, fontbuffer=js_font_buf)
                    _precheck_font_buf = js_font_buf  # guardar para re-registro post-redact
                    _pchk = [f for f in page.get_fonts(full=True) if f[4] == _pchk_fn]
                    if _pchk and _pchk[0][2] == 'Type0':
                        _is_type0 = True
                        # Capa 2: aunque es Type0 para insert_text principal, _pchk_fn
                        # tiene glifos completos del sistema → usable como fallback de segmentos
                        _precheck_usable = True
                        _fallback_full_fn = _pchk_fn
                        print(f"⚠️ [FONT-PY] pre-check: js_font es Type0 — NO reservar como js_sys_font, pero sí como _fallback_full_fn={_pchk_fn}")
                    else:
                        print(f"✅ [FONT-PY] pre-check: tipo={_pchk[0][2] if _pchk else 'unknown'} → reservar js_sys_font")
                except Exception as _pce:
                    print(f"⚠️ [FONT-PY] pre-check insert failed: {_pce} — asumiendo no-Type0")

                if not _is_type0:
                    _deferred_js_font_buf = js_font_buf
                    _deferred_js_font_file = _tf.name
                    embedded_font_name = 'js_sys_font'
                    print(f"✅ [FONT-PY] deferred insert_font pending (after apply_redactions)")
                else:
                    # Type0: intentar rescue con fuente embebida del PDF (Prioridad 1B)
                    # Conservar _tf.name para retry con fontfile= si los caracteres no están en emb_reuse
                    _deferred_js_font_file = _tf.name
                    _raw_fn = edit.get('font') or ''
                    _xref1b, _buf1b, _pname1b = _find_pdf_embedded_font(_raw_fn)
                    if _buf1b:
                        _deferred_emb_buf = _buf1b
                        _emb_xref = _xref1b
                        if _pname1b:
                            embedded_font_name = _pname1b  # usar nombre interno de página (ej. F1)
                            print(f"✅ [FONT-PY] Type0 rescue: usando {_pname1b} (nombre interno) para '{_raw_fn}'")
                        else:
                            embedded_font_name = f'emb_{_xref1b}'
                            print(f"✅ [FONT-PY] Type0 rescue: usando fuente embebida del PDF para '{_raw_fn}'")
                    else:
                        print(f"⚠️ [FONT-PY] Type0 y sin rescue PDF — caerá a fallback builtin")

        # Prioridad 2: fuente embebida en el PDF (si no hubo js_font válido)
        if not embedded_font_name:
            raw_font_name = edit.get('font') or ''
            _xref2, _buf2, _pname2 = _find_pdf_embedded_font(raw_font_name)
            if _buf2:
                _deferred_emb_buf = _buf2
                _emb_xref = _xref2
                if _pname2:
                    embedded_font_name = _pname2
                    print(f"✅ [FONT-PY] Prioridad 2: usando {_pname2} (nombre interno) para '{raw_font_name}'")
                else:
                    embedded_font_name = f'emb_{_xref2}'
                    print(f"✅ [FONT-PY] Prioridad 2: fuente embebida del PDF para '{raw_font_name}'")

        # Capa 3: registrar fuente TTF pura enviada como fallback desde JS
        if _fb_fallback_b64:
            try:
                import base64 as _b64fb, tempfile as _tmpfb, os as _osfb
                _fb_buf = _b64fb.b64decode(_fb_fallback_b64)
                if len(_fb_buf) > 1024:
                    _tffb = _tmpfb.NamedTemporaryFile(suffix='.ttf', delete=False)
                    _tffb.write(_fb_buf)
                    _tffb.flush()
                    _tffb.close()
                    page.insert_font(fontname='_fb_full', fontbuffer=_fb_buf)
                    _pchk_fb = [f for f in page.get_fonts(full=True) if f[4] == '_fb_full']
                    _fb_type = _pchk_fb[0][2] if _pchk_fb else 'unknown'
                    if _fb_type != 'Type0':
                        _deferred_fb_buf = _fb_buf
                        if not _fallback_full_fn:
                            _fallback_full_fn = '_fb_full'
                        print(f"✅ [FONT-PY] Capa3 fontBufferFallback OK: type={_fb_type} → _fallback_full_fn='{_fallback_full_fn}'")
                    else:
                        print(f"⚠️ [FONT-PY] Capa3 fontBufferFallback también es Type0 — descartado")
                    try: _osfb.unlink(_tffb.name)
                    except: pass
            except Exception as _fbe:
                print(f"⚠️ [FONT-PY] Capa3 fontBufferFallback error: {_fbe}")

        # Fallback builtin si todo falla
        if not embedded_font_name:
            if _is_bold and _is_italic:
                _builtin = 'hebi'
            elif _is_bold:
                _builtin = 'hebo'
            elif _is_italic:
                _builtin = 'heit'
            else:
                _builtin = 'helv'
            if _js_font_obj is None:
                try:
                    _js_font_obj = fitz.Font(fontname=_builtin)
                    print(f"✅ [FONT-PY] built-in fallback: {_builtin} asc={_js_font_obj.ascender:.3f}")
                except Exception as _bfe:
                    _js_font_obj = None

    except Exception:
        pass

    use_font = embedded_font_name if embedded_font_name else font_final
    print(f"🟣 [FONT-DIAG] selected use_font={use_font} embedded={embedded_font_name} fallback_builtin={font_final} object_name={getattr(_js_font_obj, 'name', None) if _js_font_obj else None} object_flags={getattr(_js_font_obj, 'flags', None) if _js_font_obj else None}")

    # Fase 1: Borrar area original
    is_surgical = bool(edit.get('isSurgical', False))
    _skip_erase = bool(edit.get('skipErase', False))
    _use_splice = bool(edit.get('useSplice', True))
    _target_spans = edit.get('targetSpans') or ([edit.get('targetSpan')] if edit.get('targetSpan') else None)

    if is_surgical and _use_splice and _target_spans and not _skip_erase:
        try:
            import text_splice
            _s_ok, _s_info = text_splice.remove_spans(doc, page, _target_spans)
            if _s_ok:
                _skip_erase = True
                print(f"🚀 [SPLICE-OK] Operadores Tj/TJ eliminados quirurgicamente: {_s_info}")
        except Exception as _splice_err:
            print(f"⚠️ [SPLICE-FALLBACK] text_splice fallo ({_splice_err}), cayendo a legacy redact/erase")

    orig_rect = fitz.Rect(_erase_x0, _erase_y0, _erase_x1, _erase_y0 + h)
    try:
        _asc_debug = fitz.Font(use_font).ascender
    except:
        _asc_debug = 0.8
    _bl_debug = y + font_size * _asc_debug
    print(f"🐍 [REFLOW DEBUG] x={x:.2f} y={y:.2f} w={w:.2f} h={h:.2f} fs={font_size:.2f} font={use_font} ascender={_asc_debug:.3f} → baseline_y={_bl_debug:.2f} (rect.y1={y+h:.2f})")
    print(f"🐍 [REFLOW BG] bgColor={edit.get('bgColor')} rgb_bg={rgb_bg} bgImage={'YES' if edit.get('bgImage') else 'NO'}")
    # Buscar texto existente: clip amplio (línea completa) para capturar spans CIDFont adyacentes
    try:
        _blocks = page.get_text("rawdict", clip=fitz.Rect(_erase_x0-5, _erase_y0-5, _erase_x1+5, _erase_y0+h+5))
        _spans = [sp for bl in _blocks.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
        for _sp in _spans[:3]:
            print(f"🐍 [REFLOW EXISTING TEXT] text='{_sp.get('text','')}' bbox={[round(v,2) for v in _sp.get('bbox',[])]} size={_sp.get('size',0):.2f} origin={[round(v,2) for v in _sp.get('origin',[])]}")
    except Exception as _e:
        print(f"🐍 [REFLOW EXISTING TEXT] error: {_e}")
    if is_surgical and not _skip_erase:
        # fill=None: no genera rect de relleno en el content stream.
        # Usar el y0 real del span a borrar (el más cercano a orig_rect.y0 desde abajo),
        # para evitar que add_redact_annot borre texto adyacente cuyo bbox[3] > orig_rect.y0.
        # Redactar por span individual para no borrar texto adyacente cuyo
        # bbox[3] apenas supera orig_rect.y0 (ej. línea de arriba con ascenders).
        # Detectar si hay spans colaterales (texto por arriba que toca el rect)
        # cuyo text está vacío (CIDFont sin ToUnicode) — no se pueden re-insertar
        _spans_above = [sp for sp in _spans if ((sp['bbox'][1] + sp['bbox'][3]) / 2.0 < orig_rect.y0) and sp['bbox'][3] > orig_rect.y0] if _spans else []
        _has_unreadable_collateral = any(not sp.get('text','').strip() for sp in _spans_above)
        # Fix 1 (extendido): clamp también para colaterales legibles, no solo CIDFont sin texto,
        # para que apply_redactions() nunca alcance NINGÚN span colateral (Bug 2).
        _max_collateral_y1_any = max((sp['bbox'][3] for sp in _spans_above), default=orig_rect.y0)
        _safe_redact_y0_any = max(orig_rect.y0, _max_collateral_y1_any) if _spans_above else orig_rect.y0

        def is_target_span(sp):
            sb = sp['bbox']
            y0_comm = max(sb[1], orig_rect.y0)
            y1_comm = min(sb[3], orig_rect.y1)
            overlap = y1_comm - y0_comm
            if overlap <= 0:
                return False
            sp_h = sb[3] - sb[1]
            rect_h = orig_rect.y1 - orig_rect.y0
            min_h = min(sp_h, rect_h) if rect_h > 0 else sp_h
            return overlap > min_h * 0.3

        _target_spans = [sp for sp in _spans if is_target_span(sp)] if _spans else []

        if _has_unreadable_collateral and _target_spans:
            # Caso CIDFont con span colateral arriba: apply_redactions destruiría el span arriba.
            # El span colateral puede tener y1 > orig_rect.y0 (descenders que bajan al rect).
            # Calcular el y1 máximo de TODOS los spans colaterales arriba → usarlo como suelo del
            # redact para que add_redact_annot no los intersecte y apply_redactions los preserve.
            _max_collateral_y1 = max(sp['bbox'][3] for sp in _spans_above) if _spans_above else orig_rect.y0
            _safe_redact_y0 = max(orig_rect.y0, _max_collateral_y1)
            print(f"🐍 [SURGICAL] CIDFont colateral: max_coll_y1={_max_collateral_y1:.2f} → safe_redact_y0={_safe_redact_y0:.2f}")
            for _tsp in _target_spans:
                _sb = _tsp['bbox']
                _is_cidfont = not _tsp.get('text', '').strip()
                _sr_y0 = max(_sb[1], _safe_redact_y0)
                _sr_y1 = min(_sb[3], orig_rect.y1)
                if _is_cidfont:
                    # Redactar desde _safe_redact_y0 (por debajo del span colateral) hacia abajo.
                    # El tramo superior (orig_rect.y0 → _safe_redact_y0) queda cubierto visualmente
                    # por el draw_rect sin tocar el stream del span de arriba.
                    _sr = fitz.Rect(_sb[0], _safe_redact_y0, _sb[2] + 0.5, _sr_y1)
                    if _sr.is_valid and _sr.get_area() > 0:
                        page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)
                        page.add_redact_annot(_sr, fill=None)
                else:
                    _sr = fitz.Rect(max(_sb[0], orig_rect.x0), _sr_y0, min(_sb[2], orig_rect.x1) + 0.5, _sr_y1)
                    if _sr.is_valid and _sr.get_area() > 0:
                        page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)
            redact_rect = fitz.Rect(orig_rect.x0, _safe_redact_y0, orig_rect.x1 + 0.5, orig_rect.y1)
            print(f"🐍 [SURGICAL] CIDFont colateral detectado → redact y0={_safe_redact_y0:.2f} (orig={orig_rect.y0:.2f})")
        elif _target_spans:
            # Separar spans completamente dentro de X (redact seguro del stream)
            # de spans que se extienden fuera del rect X (draw_rect solo en la porción intersectada)
            _spans_inside_x = [sp for sp in _target_spans if sp['bbox'][0] >= orig_rect.x0 - 1 and sp['bbox'][2] <= orig_rect.x1 + 1]
            _spans_overflow_x = [sp for sp in _target_spans if sp not in _spans_inside_x]
            for _tsp in _spans_inside_x:
                _sb = _tsp['bbox']
                _sr_y0 = max(_sb[1], _safe_redact_y0_any)
                _sr_y1 = min(_sb[3], orig_rect.y1)
                _sr = fitz.Rect(_sb[0], _sr_y0, _sb[2] + 0.5, _sr_y1)
                if _sr.is_valid and _sr.get_area() > 0:
                    page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)
                    page.add_redact_annot(_sr, fill=None)
            _cidfont_left_covers = []  # spans CIDFont con glifos a la izquierda del rect de edición
            for _tsp in _spans_overflow_x:
                _sb = _tsp['bbox']
                _is_cidfont = not _tsp.get('text', '').strip()
                _sr_y0 = max(_sb[1], _safe_redact_y0_any)
                _sr_y1 = min(_sb[3], orig_rect.y1)
                if _is_cidfont:
                    # CIDFont overflow: distinguir si el span desborda por izquierda, derecha, o ambos.
                    _overflows_left  = _sb[0] < orig_rect.x0 - 1   # hay glifos a la IZQUIERDA del rect
                    _overflows_right = _sb[2] > orig_rect.x1 + 1   # hay glifos a la DERECHA del rect
                    if _overflows_left and not _overflows_right:
                        _cidfont_left_covers.append(_sb)
                        _sr = fitz.Rect(orig_rect.x0 - 0.5, _sr_y0, _sb[2] + 0.5, _sr_y1)
                    elif _overflows_left and _overflows_right:
                        _sr = fitz.Rect(orig_rect.x0 - 0.5, _sr_y0, orig_rect.x1 + 0.5, _sr_y1)
                    else:
                        _sr = fitz.Rect(_sb[0], _sr_y0, _sb[2] + 0.5, _sr_y1)
                    if _sr.is_valid and _sr.get_area() > 0:
                        page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)
                        page.add_redact_annot(_sr, fill=None)
                else:
                    # Span legible desbordante: solo cubrir visualmente la intersección
                    _sr = fitz.Rect(max(_sb[0], orig_rect.x0), _sr_y0, min(_sb[2], orig_rect.x1) + 0.5, _sr_y1)
                    if _sr.is_valid and _sr.get_area() > 0:
                        page.draw_rect(_sr, color=rgb_bg, fill=rgb_bg, width=0)
            if _spans_inside_x:
                _sb0 = _spans_inside_x[0]['bbox']
                _inside_y0 = max(_sb0[1], _safe_redact_y0_any)
                redact_rect = fitz.Rect(orig_rect.x0, _inside_y0, orig_rect.x1 + 0.5, orig_rect.y1)
            else:
                redact_rect = fitz.Rect(orig_rect.x0, _safe_redact_y0_any, orig_rect.x1 + 0.5, orig_rect.y1)
        else:
            redact_rect = fitz.Rect(orig_rect.x0, _safe_redact_y0_any, orig_rect.x1 + 0.5, orig_rect.y1)
            if redact_rect.is_valid and redact_rect.get_area() > 0:
                page.draw_rect(redact_rect, color=rgb_bg, fill=rgb_bg, width=0)
                page.add_redact_annot(redact_rect, fill=None)
        # Capturar spans colaterales ANTES de apply_redactions (los que NO deben borrarse)
        # = spans cuyo y1 toca el rect pero cuyo y0 < orig_rect.y0 - 1
        _collateral = []
        try:
            _wide_clip = orig_rect + (-5, -60, 5, 5)  # buscar texto arriba del rect
            _wide_data = page.get_text("rawdict", clip=_wide_clip)
            _wide_spans = [sp for bl in _wide_data.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
            for _wsp in _wide_spans:
                _wy0, _wy1 = _wsp['bbox'][1], _wsp['bbox'][3]
                if _wy0 < orig_rect.y0 - 1 and _wy1 > orig_rect.y0:
                    # Este span está por encima del rect pero toca el área → candidato colateral
                    _collateral.append({
                        'text': _wsp.get('text',''),
                        'bbox': _wsp['bbox'],
                        'origin': _wsp.get('origin', [_wsp['bbox'][0], _wsp['bbox'][3]]),
                        'size': _wsp.get('size', font_size),
                        'fontname': _wsp.get('font', ''),
                        'color': _wsp.get('color', 0),
                    })
        except Exception as _ce:
            pass
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
        # ── DEBUG: estado inmediatamente tras apply_redactions ──────────────────
        print(f"🔴 [REDACT-DONE] redact_rect=({redact_rect.x0:.2f},{redact_rect.y0:.2f},{redact_rect.x1:.2f},{redact_rect.y1:.2f})")
        print(f"🔴 [REDACT-DONE] orig_rect=({orig_rect.x0:.2f},{orig_rect.y0:.2f},{orig_rect.x1:.2f},{orig_rect.y1:.2f})")
        print(f"🔴 [REDACT-DONE] insert_target=({x:.2f},{y:.2f},{x+w:.2f},{y+h:.2f}) [x/y son posición final del texto]")
        print(f"🔴 [REDACT-DONE] erase_origin=({_erase_x0:.2f},{_erase_y0:.2f},{_erase_x1:.2f},{_erase_y0+h:.2f}) [donde estaba el PDF original]")
        # Calcular spans residuales para (a) cubrir glifos CIDFont partidos y (b) debug posterior.
        try:
            _chk = page.get_text("rawdict", clip=orig_rect + (-2, -2, 2, 2))
            _rem = [sp for bl in _chk.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
            print(f"🔴 [REDACT-DONE] spans_after_redact={len(_rem)}: {[{'t':s.get('text','')[:15],'bbox':[round(v,2) for v in s.get('bbox',[])]} for s in _rem]}")
        except Exception as _rde:
            _rem = []
            print(f"🔴 [REDACT-DONE] error getting spans: {_rde}")
        try:
            _paths_at_orig = [p for p in page.get_drawings() if p['rect'].intersects(orig_rect + (-2,-2,2,2))]
            print(f"🔴 [REDACT-DONE] rects_at_orig={len(_paths_at_orig)}: {[{'r':[round(v,2) for v in [p['rect'].x0,p['rect'].y0,p['rect'].x1,p['rect'].y1]],'fill':p.get('fill')} for p in _paths_at_orig[:3]]}")
        except Exception:
            pass
        # CIDFONT-COVER: cubrir residuos vacíos que quedaron estrictamente dentro de orig_rect tras apply_redactions.
        # CRÍTICO: NUNCA cubrir spans que pertenecen a la línea superior (descenders como 'p', 'g', 'y', 'q')
        # ni expandir el rect de cobertura fuera de los límites de orig_rect.
        print(f"🟦 [CIDFONT-COVER] orig_rect=({orig_rect.x0:.2f},{orig_rect.y0:.2f},{orig_rect.x1:.2f},{orig_rect.y1:.2f}) residuals={len([r for r in _rem if not r.get('text','').strip()])}")
        for _rs in _rem:
            _rs_text = _rs.get('text', '').strip()
            _rb = _rs.get('bbox', [])
            if len(_rb) != 4:
                continue
            # Ignorar si el span tiene texto legible
            if _rs_text:
                print(f"🟦 [CIDFONT-COVER] SKIP — span tiene texto legible: '{_rs_text[:15]}'")
                continue
            # Si el span inicia claramente por encima de orig_rect (ej. línea superior con descenders 'p','q','g','y'),
            # pertenece a la línea de arriba y NO debe tocarse bajo ninguna circunstancia.
            if _rb[1] < orig_rect.y0 - 0.5:
                print(f"🟦 [CIDFONT-COVER] SKIP — span pertenece a línea superior (colateral/descender) bbox=[{_rb[0]:.2f},{_rb[1]:.2f},{_rb[2]:.2f},{_rb[3]:.2f}]")
                continue
            # Si el span termina claramente por debajo de orig_rect, pertenece a la línea de abajo
            if _rb[3] > orig_rect.y1 + 0.5:
                print(f"🟦 [CIDFONT-COVER] SKIP — span pertenece a línea inferior bbox=[{_rb[0]:.2f},{_rb[1]:.2f},{_rb[2]:.2f},{_rb[3]:.2f}]")
                continue
            _r_intersect = fitz.Rect(_rb).intersect(orig_rect)
            if _r_intersect.is_empty or _r_intersect.get_area() <= 0:
                print(f"🟦 [CIDFONT-COVER] SKIP — no intersecta orig_rect")
                continue
            # Cobertura acotada estrictamente a la intersección dentro de orig_rect
            _cover = fitz.Rect(max(_rb[0], orig_rect.x0), max(_rb[1], orig_rect.y0), min(_rb[2] + 0.5, orig_rect.x1 + 0.5), min(_rb[3], orig_rect.y1))
            if _cover.is_valid and _cover.get_area() > 0:
                page.draw_rect(_cover, color=rgb_bg, fill=rgb_bg, width=0)
                print(f"🟦 [CIDFONT-COVER] COVERED STRICT bbox=[{_cover.x0:.2f},{_cover.y0:.2f},{_cover.x1:.2f},{_cover.y1:.2f}]")
        # Re-insertar spans colaterales que fueron eliminados por apply_redactions
        if _collateral:
            try:
                _post_wide = page.get_text("rawdict", clip=orig_rect + (-5, -60, 5, 5))
                _post_spans = [sp for bl in _post_wide.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
                _post_texts = set(sp.get('text','') for sp in _post_spans)
                for _csp in _collateral:
                    if _csp['text'] and _csp['text'] not in _post_texts:
                        _cr = _csp['color']
                        _ccolor = ((_cr >> 16) & 0xFF)/255, ((_cr >> 8) & 0xFF)/255, (_cr & 0xFF)/255
                        _cfs = _csp['size']
                        _corg = _csp['origin']
                        _craw = str(_csp.get('fontname', ''))
                        _craw_low = _craw.lower()
                        _c_is_bold = any(k in _craw_low for k in ('bold', 'negrita', 'black', 'heavy', 'semibold', 'demibold'))
                        _c_is_italic = any(k in _craw_low for k in ('italic', 'oblique', 'inclined'))
                        # Resolver la fuente original del colateral (mismo matching que el rescue de fuente nueva)
                        _c_fn = None
                        try:
                            _c_xref, _c_buf, _c_pname = _find_pdf_embedded_font(_craw)
                            if _c_buf:
                                _c_fn = _c_pname or f'coll_emb_{_c_xref}'
                                try:
                                    page.insert_font(fontname=_c_fn, fontbuffer=_c_buf)
                                except Exception:
                                    pass
                        except Exception as _cfe:
                            print(f"⚠️ [COLLATERAL-RESTORE] resolución de fuente falló para '{_craw}': {_cfe}")
                        if not _c_fn:
                            # Fallback: builtin bold/italic inferido del nombre original (antes fijo a 'helv')
                            if _c_is_bold and _c_is_italic:
                                _c_fn = 'heob'
                            elif _c_is_bold:
                                _c_fn = 'hebo'
                            elif _c_is_italic:
                                _c_fn = 'heit'
                            else:
                                _c_fn = 'helv'
                        try:
                            page.insert_text(
                                fitz.Point(_corg[0], _corg[1]),
                                _csp['text'],
                                fontsize=_cfs,
                                fontname=_c_fn,
                                color=_ccolor,
                            )
                            print(f"🔄 [COLLATERAL-RESTORE] Restored '{_csp['text'][:30]}' at y={_corg[1]:.1f} font={_c_fn}")
                        except Exception as _cre:
                            print(f"⚠️ [COLLATERAL-RESTORE] Failed with font={_c_fn}: {_cre} — reintentando con 'helv'")
                            try:
                                page.insert_text(
                                    fitz.Point(_corg[0], _corg[1]),
                                    _csp['text'],
                                    fontsize=_cfs,
                                    fontname='helv',
                                    color=_ccolor,
                                )
                            except Exception as _cre2:
                                print(f"⚠️ [COLLATERAL-RESTORE] Fallback 'helv' también falló '{_csp['text'][:20]}': {_cre2}")
            except Exception as _pwe:
                pass
    elif not _skip_erase:
        page.add_redact_annot(orig_rect + (-0.2, 0, 0.2, 0), fill=rgb_bg)
        page.apply_redactions()
        if edit.get('bgImage') and str(edit['bgImage']).startswith('data:'):
            img_data = base64.b64decode(edit['bgImage'].split(',')[1])
            page.insert_image(orig_rect, stream=img_data)
        print(f"🐍 [REFLOW MODE] surgical=False → redact fill={rgb_bg}")

    # chr(10) evita conflicto con template literal JS
    NL = chr(10)
    is_single_line = NL not in new_text.strip()

    # CID subset fonts no pueden codificar nuevo texto → solo usar embedded para línea única
    insert_font = use_font if is_single_line else font_final

    _passed_ascent_ratio = edit.get('ascentRatio') or None
    _is_custom_font = lambda fn: fn == 'js_sys_font' or (fn is not None and fn.startswith('emb_'))

    def safe_insert(page, rect, text, fs, fn, color, align=0, segments=None):
        def _line_width(value):
            try:
                if _js_font_obj:
                    width = _js_font_obj.text_length(value, fontsize=fs)
                else:
                    width = fitz.Font(fn).text_length(value, fontsize=fs)
            except Exception:
                width = fs * 0.6 * len(value)
            if len(value) > 1 and abs(letter_spacing) >= 0.01:
                width += (len(value) - 1) * (letter_spacing / 100.0) * fs
            return max(0, width)

        def _aligned_x(value, measured=None):
            width = measured if measured is not None and measured >= 0 else _line_width(value)
            if align == 2 and width <= rect.width:
                return rect.x1 - width
            if align == 1 and width <= rect.width:
                return rect.x0 + (rect.width - width) / 2
            return rect.x0

        if is_single_line:
            try:
                if _is_custom_font(fn) and (_passed_ascent_ratio or _js_font_obj):
                    raise Exception('use precomputed ascent')
                _font_obj = fitz.Font(fn)
                _asc = _font_obj.ascender
                _text_w = _font_obj.text_length(text, fontsize=fs)
            except Exception:
                # Para emb_reuse: priorizar _passed_ascent_ratio (del PDF real vía PyMuPDF)
                # sobre _js_font_obj.ascender (fuente JS con ascender distinto, e.g. 1.101 vs 0.968).
                if _passed_ascent_ratio and _is_custom_font(fn):
                    _asc = _passed_ascent_ratio
                    _text_w = _js_font_obj.text_length(text, fontsize=fs) if _js_font_obj else -1
                    print(f"✅ [FONT-METRICS] {fn}: ascentRatio={_asc:.3f} text_w={_text_w:.2f}")
                elif _js_font_obj:
                    try:
                        _asc = _js_font_obj.ascender
                        _text_w = _js_font_obj.text_length(text, fontsize=fs)
                        print(f"✅ [FONT-METRICS] Using js_font_obj ascender={_asc:.3f} text_w={_text_w:.2f}")
                    except Exception:
                        _asc = _passed_ascent_ratio if _passed_ascent_ratio else 0.8
                        _text_w = -1
                else:
                    _asc = _passed_ascent_ratio if _passed_ascent_ratio else 0.8
                    _text_w = -1
            except Exception:
                _asc = _passed_ascent_ratio if _passed_ascent_ratio else 0.8
                _text_w = -1
            _exact_origin = edit.get('origin')
            _dragged_y = bool(edit.get('draggedY', False))
            _dragged_x = bool(edit.get('draggedX', False))
            if _exact_origin and len(_exact_origin) == 2 and not _dragged_y and page.rotation in (0, 360):
                baseline_y = float(_exact_origin[1])
            else:
                baseline_y = rect.y0 + fs * _asc

            if _exact_origin and len(_exact_origin) == 2 and not _dragged_x and edit.get('alignment', 'left') == 'left' and page.rotation in (0, 360):
                baseline_x = float(_exact_origin[0])
            else:
                baseline_x = _aligned_x(text, _text_w)

            baseline = fitz.Point(baseline_x, baseline_y)
            print(f"🔵 [INSERT-SL] fn={fn} asc={_asc:.3f} baseline=({baseline.x:.2f},{baseline.y:.2f}) exactOrigin={_exact_origin} text_w={_text_w:.2f} rect_w={rect.width:.2f} text='{text}'")
            # Built-in de fallback según bold/italic
            _fallback_fn = 'hebo' if _is_bold else 'helv'
            # Deferred insert_font: apply_redactions() destruye el font registrado,
            # por eso se registra aquí, justo antes de insert_text
            if fn == 'js_sys_font' and _deferred_js_font_buf:
                try:
                    page.insert_font(fontname='js_sys_font', fontbuffer=_deferred_js_font_buf)
                    _registered = [f for f in page.get_fonts(full=True) if f[4] == 'js_sys_font']
                    if _registered and _registered[0][2] == 'Type0':
                        # Rescue: intentar fuente embebida del PDF
                        print(f"⚠️ [FONT-PY] deferred: js_sys_font es Type0 — intentando rescue PDF")
                        _raw_fn_rescue = edit.get('font') or ''
                        _rescued = False
                        
                        def _clean_font_name_py(f):
                            if not f: return ""
                            if len(f) > 7 and f[6] == '+':
                                f = f[7:]
                            f = f.lower()
                            import re
                            f = re.sub(r'[\s,_-]*(bold|italic|oblique|mt|ps|regular|roman|semibold|condensed|narrow|negrita|black|heavy|demibold|demiboldoblique)\b', '', f)
                            f = re.sub(r'[^a-z0-9]', '', f)
                            return f

                        import re
                        _m_emb = re.match(r'^emb_(\d+)$', _raw_fn_rescue)
                        if _m_emb:
                            _xref = int(_m_emb.group(1))
                            try:
                                _fdr = doc.extract_font(_xref)
                                _bufr = _fdr[3] if _fdr else None
                                if _bufr and len(_bufr) > 1024:
                                    _rescue_fn = f'emb_{_xref}'
                                    page.insert_font(fontname=_rescue_fn, fontbuffer=_bufr)
                                    fn = _rescue_fn
                                    _rescued = True
                                    print(f"SUCCESS: [FONT-PY] rescue OK (direct xref): {_rescue_fn} desde PDF")
                            except Exception: pass

                        if not _rescued:
                            _clean_rescue = _clean_font_name_py(_raw_fn_rescue)
                            for _xr, _extr, _ftr, _bfr, _nr, _encr, _refr in page.get_fonts(full=True):
                                if _ftr == 'Type0': continue
                                _clean_bfr = _clean_font_name_py(_bfr)
                                if (_clean_bfr == _clean_rescue or _clean_rescue in _clean_bfr or _clean_bfr in _clean_rescue) and _extr:
                                    _fdr = doc.extract_font(_xr)
                                    _bufr = _fdr[3] if _fdr else None
                                    if _bufr and len(_bufr) > 1024:
                                        try:
                                            _rescue_fn = f'emb_{_xr}'
                                            page.insert_font(fontname=_rescue_fn, fontbuffer=_bufr)
                                            fn = _rescue_fn
                                            _rescued = True
                                            print(f"SUCCESS: [FONT-PY] rescue OK: {_rescue_fn} desde PDF para '{_raw_fn_rescue}'")
                                        except Exception: pass
                                        break
                        if not _rescued:
                            fn = _fallback_fn
                            print(f"WARNING: [FONT-PY] rescue fallido — usando {_fallback_fn}")
                    else:
                        print(f"✅ [FONT-PY] deferred js_sys_font OK type={_registered[0][2] if _registered else 'unknown'}")
                except Exception as _dfe_buf:
                    print(f"⚠️ [FONT-PY] deferred insert_font(js_sys_font) failed: {_dfe_buf} — usando fallback")
                    fn = _fallback_fn
                finally:
                    if _deferred_js_font_file:
                        import os as _cleanup_os
                        try: _cleanup_os.unlink(_deferred_js_font_file)
                        except: pass
            elif fn is not None and fn.startswith('emb_') and _deferred_emb_buf:
                try:
                    page.insert_font(fontname=fn, fontbuffer=_deferred_emb_buf)
                    _registered = [f for f in page.get_fonts(full=True) if f[4] == fn]
                    print(f"✅ [FONT-PY] deferred {fn} OK type={_registered[0][2] if _registered else 'unknown'}")
                except Exception as _dfe_emb:
                    print(f"⚠️ [FONT-PY] deferred {fn} failed: {_dfe_emb} — usando {_fallback_fn}")
                    fn = _fallback_fn
            # Fix 1: Re-registrar _pchk_fn si fue destruido por apply_redactions
            if _pchk_fn and _precheck_font_buf:
                try:
                    _already = [f for f in page.get_fonts(full=True) if f[4] == _pchk_fn]
                    if not _already:
                        page.insert_font(fontname=_pchk_fn, fontbuffer=_precheck_font_buf)
                        print(f"✅ [FONT-PY] re-registered _pchk_fn={_pchk_fn} after redact")
                except Exception as _rpf:
                    print(f"⚠️ [FONT-PY] re-register _pchk_fn failed: {_rpf}")
            
            
            # --- NUEVO: SOPORTE PARA SEGMENTOS ESTILIZADOS (SINGLE LINE) ---
            if segments and isinstance(segments, list) and len(segments) > 1:
                try:
                    _asc_tw = _passed_ascent_ratio if _passed_ascent_ratio else (_js_font_obj.ascender if _js_font_obj else 0.8)
                    _btw = fitz.Point(baseline.x, rect.y0 + fs * _asc_tw)
                    _cx = baseline.x

                    # Bug1/OpciónB: bytes de fuente exacta por segmento enviados desde JS
                    # (fontRegistry/fontResolutionPipeline) — evita el mapeo Base-14 cuando hay bytes reales.
                    _seg_font_buffers_b64 = edit.get('segmentFontBuffers') or {}
                    _seg_font_cache = {}

                    def _get_seg_font_obj(font_key):
                        if font_key in _seg_font_cache:
                            return _seg_font_cache[font_key]
                        _obj = None
                        _buf_b64 = _seg_font_buffers_b64.get(font_key)
                        if _buf_b64:
                            try:
                                _raw = base64.b64decode(_buf_b64)
                                if len(_raw) > 1024:
                                    _obj = fitz.Font(fontbuffer=_raw)
                            except Exception as _sfe:
                                print(f"⚠️ [SEG-FONT] fallo cargando fuente exacta de segmento '{font_key}': {_sfe}")
                        _seg_font_cache[font_key] = _obj
                        return _obj
                    
                    for seg in segments:
                        seg_text = seg.get('text', '')
                        if not seg_text: continue
                        seg_rgb = hex_to_rgb(seg.get('color')) if seg.get('color') else color
                        
                        is_seg_bold = seg.get('isBold', False)
                        is_seg_italic = seg.get('isItalic', False)
                        is_seg_ul = seg.get('isUnderline', False)
                        
                        # Función auxiliar para comparar nombres de fuentes limpios
                        def clean_f_name(n):
                            import re
                            s = str(n).lower()
                            s = re.sub(r'[\s,_-]*(bold|italic|oblique|mt|ps|regular|roman|semibold|condensed|narrow|negrita|black|heavy|demibold)\b', '', s)
                            s = re.sub(r'[^a-z0-9]', '', s)
                            return s
                            
                        seg_fn = seg.get('font') if seg.get('font') else fn
                        is_same_family = clean_f_name(seg_fn) == clean_f_name(fn)
                        
                        seg_font_obj = _js_font_obj if is_same_family else None
                        
                        # Si es un tipo de fuente diferente a la principal del objeto,
                        # resolvemos la fuente del segmento usando el mapeo de familias estándar
                        # ya que no tenemos los bytes TrueType cargados para esta fuente secundaria.
                        if not is_same_family:
                            _exact_seg_font = _get_seg_font_obj(seg_fn)
                            if _exact_seg_font:
                                seg_font_obj = _exact_seg_font
                                print(f"✅ [SEG-FONT] fuente exacta embebida para segmento '{seg_fn}'")
                            else:
                                seg_fname = str(seg_fn).lower()
                                seg_base_family = 'helv'
                                for keywords, family in keywords_map:
                                    if any(k in seg_fname for k in keywords):
                                        seg_base_family = family
                                        break

                                # Sin bytes reales: mapeamos según bold/italic a Base-14
                                styles = font_families.get(seg_base_family, font_families['helv'])
                                if is_seg_bold and is_seg_italic:
                                    seg_fn = styles.get('bi', 'heob')
                                elif is_seg_bold:
                                    seg_fn = styles.get('b', 'hebo')
                                elif is_seg_italic:
                                    seg_fn = styles.get('i', 'heit')
                                else:
                                    seg_fn = styles.get('n', 'helv')
                                seg_font_obj = None
                        else:
                            # Si coincide con la familia base, solo cambiamos a fuente estándar si el estilo difiere
                            if is_seg_bold == _is_bold and is_seg_italic == _is_italic:
                                seg_fn = fn  # Mantener nombre exacto original
                            else:
                                if is_seg_bold and is_seg_italic:
                                    seg_fn = 'heob'
                                elif is_seg_bold:
                                    seg_fn = 'hebo'
                                elif is_seg_italic:
                                    seg_fn = 'heit'
                                else:
                                    seg_fn = 'helv'
                                seg_font_obj = None
                        
                        seg_w = 0
                        if seg_font_obj:
                            try:
                                _tw = fitz.TextWriter(page.rect)
                                _tw.append(fitz.Point(_cx, _btw.y), seg_text, font=seg_font_obj, fontsize=fs)
                                _tw.write_text(page, color=seg_rgb)
                                seg_w = seg_font_obj.text_length(seg_text, fontsize=fs)
                            except Exception as _twe_err:
                                print(f"⚠️ [INSERT-SEGMENTS] TextWriter falló: {_twe_err} — usando insert_text")
                                seg_font_obj = None  # Forzar fallback a insert_text
                                
                        if not seg_font_obj:
                            _actual_used_fn = seg_fn
                            try:
                                page.insert_text(fitz.Point(_cx, _btw.y), seg_text, fontname=seg_fn, fontsize=fs, color=seg_rgb)
                            except Exception as _ite:
                                print(f"⚠️ [INSERT-SEGMENTS] page.insert_text falló para {seg_fn}: {_ite} — usando 'helv'")
                                try:
                                    page.insert_text(fitz.Point(_cx, _btw.y), seg_text, fontname='helv', fontsize=fs, color=seg_rgb)
                                    _actual_used_fn = 'helv'
                                except Exception as _ite2:
                                    print(f"⚠️ [INSERT-SEGMENTS] page.insert_text fallback 'helv' también falló: {_ite2}")
                            try:
                                seg_w = fitz.Font(_actual_used_fn).text_length(seg_text, fontsize=fs)
                            except:
                                seg_w = fs * 0.6 * len(seg_text)
                                
                        if is_seg_ul:
                            _ul_y, _thick = get_underline_params(page, _cx, _btw.y, fs)
                            page.draw_line(fitz.Point(_cx, _ul_y), fitz.Point(_cx + seg_w, _ul_y), color=seg_rgb, width=_thick)
                            
                        _cx += seg_w
                            
                    print(f"✅ [INSERT-SEGMENTS] {len(segments)} segmentos aplicados con colores y estilos")
                    return 0
                except Exception as _se:
                    print(f"⚠️ [INSERT-SEGMENTS] falló: {_se} — fallback a texto normal")

            # ── TextWriter path ─────────────────────────────────────────────
            # Usa fitz.Font objeto (fuente sistema completa) en lugar de insert_text
            # por nombre. Evita el problema de subsets CID/Type0 que sólo contienen
            # los glifos del PDF original (missing: G, É, Ñ, Í, etc.)
            if _js_font_obj:
                try:
                    _asc_tw = _passed_ascent_ratio if _passed_ascent_ratio else _js_font_obj.ascender
                    _btw = fitz.Point(baseline.x, rect.y0 + fs * _asc_tw)
                    _tw = fitz.TextWriter(page.rect)
                    if abs(letter_spacing) >= 0.01:
                        _ls_pt_tw = (letter_spacing / 100.0) * fs
                        _cx_tw = baseline.x
                        for _ch_tw in text:
                            _tw.append(fitz.Point(_cx_tw, _btw.y), _ch_tw, font=_js_font_obj, fontsize=fs)
                            _cx_tw += _js_font_obj.text_length(_ch_tw, fontsize=fs) + _ls_pt_tw
                    else:
                        _tw.append(_btw, text, font=_js_font_obj, fontsize=fs)
                        _cx_tw = _btw.x + _js_font_obj.text_length(text, fontsize=fs)
                    _tw.write_text(page, color=color)
                    if is_underline:
                        _ul_y_tw, _thick_tw = get_underline_params(page, baseline.x, _btw.y, fs)
                        page.draw_line(fitz.Point(baseline.x, _ul_y_tw), fitz.Point(_cx_tw, _ul_y_tw), color=color, width=_thick_tw)
                    print(f"✅ [INSERT-TW] asc={_asc_tw:.3f} text='{text[:30]}'")
                    return 0
                except Exception as _twe:
                    print(f"⚠️ [INSERT-TW] falló: {_twe} — fallback fontname")

            # --- NUEVO: ESPACIADO DE LETRAS (SINGLE LINE) ---
            if abs(letter_spacing) >= 0.01:
                ls_pt = (letter_spacing / 100.0) * fs
                current_x = baseline.x
                _SPECIAL = set('ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇäëïöüÄËÏÖÜ')
                # Si fn es emb_ Type0, su subset CID no tiene glyphs nuevos
                _ls_fn_is_type0 = False
                if fn is not None and fn.startswith('emb_'):
                    try:
                        _ls_reg = [f for f in page.get_fonts(full=True) if f[4] == fn]
                        _ls_fn_is_type0 = bool(_ls_reg) and _ls_reg[0][2] == 'Type0'
                    except Exception:
                        pass
                    if _ls_fn_is_type0:
                        _ls_real_fn = _pchk_fn if _pchk_fn else _fallback_fn
                        print(f"\u26a0\ufe0f [LS] fn={fn} es Type0 \u2014 usando {_ls_real_fn} para todo el texto")
                for ch in text:
                    ch_pt = fitz.Point(current_x, rect.y0 + fs * _asc)
                    _actual_fn = fn
                    if _ls_fn_is_type0:
                        _actual_fn = _fallback_fn  # hebo: Type1 builtin, tiene todos los glifos
                    elif fn is not None and fn.startswith('emb_'):
                        if not (ord(ch) < 128 and ch not in _SPECIAL):
                            _actual_fn = _fallback_fn
                    
                    try:
                        page.insert_text(ch_pt, ch, fontsize=fs, fontname=_actual_fn, color=color)
                    except Exception:
                        try:
                            page.insert_text(ch_pt, ch, fontsize=fs, fontname='helv', color=color)
                            _actual_fn = 'helv'
                        except Exception:
                            pass
                    
                    try:
                        if _ls_fn_is_type0 and _js_font_obj:
                            # Insertar con _ls_real_fn pero medir con _js_font_obj (TTF del sistema)
                            char_w = _js_font_obj.text_length(ch, fontsize=fs)
                        elif _actual_fn == fn and _is_custom_font(fn) and _js_font_obj:
                            char_w = _js_font_obj.text_length(ch, fontsize=fs)
                        else:
                            char_w = fitz.Font(_actual_fn).text_length(ch, fontsize=fs)
                    except Exception:
                        char_w = fs * 0.6
                    current_x += char_w + ls_pt
                
                if is_underline:
                    _ul_y, _thick = get_underline_params(page, baseline.x, rect.y0 + fs * _asc, fs)
                    _line_w = current_x - ls_pt - baseline.x
                    page.draw_line(fitz.Point(baseline.x, _ul_y), fitz.Point(baseline.x + _line_w, _ul_y), color=color, width=_thick)
                return 0

            # --- ORIGINAL (modificado con underline) ---
            try:
                _use_segments = fn is not None and fn.startswith('emb_')
                
                if _use_segments:
                    print(f"🔵 [INSERT-SL] {fn} -> Segment strategy direct")
                    _fn_is_type0 = False
                    try:
                        _fn_reg = [f for f in page.get_fonts(full=True) if f[4] == fn]
                        _fn_is_type0 = bool(_fn_reg) and _fn_reg[0][2] == 'Type0'
                    except Exception:
                        pass
                    if _fn_is_type0:
                        _seg_real_fn = _pchk_fn if _pchk_fn else _fallback_fn
                        print(f"⚠️ [SEGMENT] fn={fn} es Type0 — usando {_seg_real_fn} para texto completo")
                        _segments = [(text, _seg_real_fn)]
                    elif _fallback_full_fn and _fallback_full_fn == _pchk_fn:
                        _pchk_is_type0 = False
                        try:
                            _pchk_reg = [f for f in page.get_fonts(full=True) if f[4] == _pchk_fn]
                            _pchk_is_type0 = bool(_pchk_reg) and _pchk_reg[0][2] == 'Type0'
                        except Exception:
                            pass
                        if _pchk_is_type0:
                            print(f"⚠️ [SEGMENT] _pchk_fn={_pchk_fn} es Type0 — usando {_fallback_fn} para texto completo")
                            _segments = [(text, _fallback_fn)]
                        else:
                            _segments = [(text, _pchk_fn)]
                    else:
                        _SPECIAL = set('ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇäëïöüÄËÏÖÜ')
                        def _char_in_subset(ch):
                            return ord(ch) < 128 and ch not in _SPECIAL
                        _segments = []
                        _cur_text = ''
                        _cur_fn = None
                        for _ch in text:
                            _seg_fn = fn if _char_in_subset(_ch) else _fallback_fn
                            if _seg_fn == _cur_fn:
                                _cur_text += _ch
                            else:
                                if _cur_text: _segments.append((_cur_text, _cur_fn))
                                _cur_text = _ch
                                _cur_fn = _seg_fn
                        if _cur_text: _segments.append((_cur_text, _cur_fn))
                    
                    _measure_font = _js_font_obj
                    _x = baseline.x
                    _y = baseline.y
                    for _seg_text, _seg_fn in _segments:
                        _seg_pt = fitz.Point(_x, _y)
                        try:
                            page.insert_text(_seg_pt, _seg_text, fontsize=fs, fontname=_seg_fn, color=color)
                        except Exception as _se:
                            print(f"⚠️ [SEGMENT] fn={_seg_fn} text='{_seg_text}' failed: {_se} — fallback {_fallback_fn}")
                            try:
                                page.insert_text(_seg_pt, _seg_text, fontsize=fs, fontname=_fallback_fn, color=color)
                            except Exception as _se2:
                                print(f"🔴 [SEGMENT] fallback {_fallback_fn} also failed: {_se2}")
                        try:
                            if _measure_font:
                                _x += _measure_font.text_length(_seg_text, fontsize=fs)
                            else:
                                _x += fitz.Font(_seg_fn).text_length(_seg_text, fontsize=fs)
                        except Exception:
                            _x += fs * 0.6 * len(_seg_text)
                    
                    if is_underline:
                        _ul_y, _thick = get_underline_params(page, baseline.x, baseline.y, fs)
                        page.draw_line(fitz.Point(baseline.x, _ul_y), fitz.Point(_x, _ul_y), color=color, width=_thick)
                    return 0
                else:
                    # Inserción directa (fuentes estándar como helv, hebo, etc.)
                    leftover = page.insert_text(baseline, text, fontsize=fs, fontname=fn, color=color)
                    print(f"🔵 [INSERT-SL] leftover={leftover} fn={fn}")
                    if is_underline:
                        try:
                            _line_w = fitz.Font(fn).text_length(text, fontsize=fs)
                        except Exception:
                            _line_w = fs * 0.6 * len(text)
                        _ul_y, _thick = get_underline_params(page, baseline.x, baseline.y, fs)
                        page.draw_line(fitz.Point(baseline.x, _ul_y), fitz.Point(baseline.x + _line_w, _ul_y), color=color, width=_thick)
                    return 0
            except Exception as e1:
                print(f"🔴 [INSERT-SL] fn={fn} failed: {e1}, trying {_fallback_fn}")
                try:
                    leftover2 = page.insert_text(baseline, text, fontsize=fs, fontname=_fallback_fn, color=color)
                    print(f"🔵 [INSERT-SL] {_fallback_fn} fallback leftover={leftover2}")
                    return 0
                except Exception as e2:
                    print(f"🔴 [INSERT-SL] {_fallback_fn} also failed: {e2}")
                    return -1
        else:
            # Multiline: insert_text línea a línea para control exacto de posición
            try:
                _asc = (fitz.Font(fn).ascender if not _is_custom_font(fn) else None) or _passed_ascent_ratio or 0.8
            except Exception:
                _asc = _passed_ascent_ratio if _passed_ascent_ratio else 0.8
            line_height = fs * line_height_ratio
            lines = text.split(NL)
            print(f"🔵 [INSERT-LINES] total_lines={len(lines)} asc={_asc:.3f} lh={line_height:.2f} rect=({rect.y0:.2f},{rect.y1:.2f})")
            # ── TextWriter multiline ──────────────────────────────────────────
            _line_origins = edit.get('lineOrigins')
            _exact_origin = edit.get('origin')
            _dragged_y = bool(edit.get('draggedY', False))
            _dragged_x = bool(edit.get('draggedX', False))
            if _js_font_obj:
                try:
                    _asc_tw_ml = _passed_ascent_ratio if _passed_ascent_ratio else _js_font_obj.ascender
                    _lh_tw = fs * line_height_ratio
                    _tw_ml = fitz.TextWriter(page.rect)
                    for _i_tw, _ln_tw in enumerate(lines):
                        if _line_origins and _i_tw < len(_line_origins) and not _dragged_y and page.rotation in (0, 360):
                            _by_tw = float(_line_origins[_i_tw][1])
                        elif _exact_origin and not _dragged_y and page.rotation in (0, 360):
                            _by_tw = float(_exact_origin[1]) + _i_tw * _lh_tw
                        else:
                            _by_tw = rect.y0 + fs * _asc_tw_ml + _i_tw * _lh_tw

                        if _line_origins and _i_tw < len(_line_origins) and not _dragged_x and edit.get('alignment', 'left') == 'left' and page.rotation in (0, 360):
                            _line_x_tw = float(_line_origins[_i_tw][0])
                        else:
                            _line_x_tw = _aligned_x(_ln_tw)

                        if abs(letter_spacing) >= 0.01:
                            _ls_pt_ml = (letter_spacing / 100.0) * fs
                            _cx_ml = _line_x_tw
                            for _ch_ml in _ln_tw:
                                _tw_ml.append(fitz.Point(_cx_ml, _by_tw), _ch_ml, font=_js_font_obj, fontsize=fs)
                                _cx_ml += _js_font_obj.text_length(_ch_ml, fontsize=fs) + _ls_pt_ml
                        else:
                            _tw_ml.append(fitz.Point(_line_x_tw, _by_tw), _ln_tw, font=_js_font_obj, fontsize=fs)
                    _tw_ml.write_text(page, color=color)
                    print(f"✅ [INSERT-TW-ML] TextWriter multiline OK lines={len(lines)}")
                    return 0
                except Exception as _twe_ml:
                    print(f"⚠️ [INSERT-TW-ML] falló: {_twe_ml} — fallback fontname")
            ok = 0
            _fallback_fn_ml = 'hebo' if _is_bold else 'helv'
            for i, ln in enumerate(lines):
                if _line_origins and i < len(_line_origins) and not _dragged_y and page.rotation in (0, 360):
                    baseline_y = float(_line_origins[i][1])
                elif _exact_origin and not _dragged_y and page.rotation in (0, 360):
                    baseline_y = float(_exact_origin[1]) + i * line_height
                else:
                    baseline_y = rect.y0 + fs * _asc + i * line_height

                if _line_origins and i < len(_line_origins) and not _dragged_x and edit.get('alignment', 'left') == 'left' and page.rotation in (0, 360):
                    _line_x = float(_line_origins[i][0])
                else:
                    _line_x = _aligned_x(ln)

                pt = fitz.Point(_line_x, baseline_y)
                
                # --- ESPACIADO DE LETRAS (MULTILINE) ---
                if abs(letter_spacing) >= 0.01:
                    ls_pt = (letter_spacing / 100.0) * fs
                    current_x = _line_x
                    line_ok = True
                    _SPECIAL = set('ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇäëïöüÄËÏÖÜ')
                    for ch in ln:
                        ch_pt = fitz.Point(current_x, baseline_y)
                        _actual_fn = fn
                        if fn is not None and fn.startswith('emb_'):
                            if not (ord(ch) < 128 and ch not in _SPECIAL):
                                _actual_fn = _fallback_fn_ml
                        
                        try:
                            page.insert_text(ch_pt, ch, fontsize=fs, fontname=_actual_fn, color=color)
                        except Exception:
                            try:
                                page.insert_text(ch_pt, ch, fontsize=fs, fontname='helv', color=color)
                                _actual_fn = 'helv'
                            except Exception:
                                line_ok = False
                        
                        try:
                            if _actual_fn == fn and _is_custom_font(fn) and _js_font_obj:
                                char_w = _js_font_obj.text_length(ch, fontsize=fs)
                            else:
                                char_w = fitz.Font(_actual_fn).text_length(ch, fontsize=fs)
                        except Exception:
                            char_w = fs * 0.6
                        current_x += char_w + ls_pt
                    
                    if line_ok:
                        ok += 1
                    
                    if is_underline:
                        _ul_y, _thick = get_underline_params(page, _line_x, baseline_y, fs)
                        _line_w = current_x - ls_pt - _line_x
                        page.draw_line(fitz.Point(_line_x, _ul_y), fitz.Point(_line_x + _line_w, _ul_y), color=color, width=_thick)
                
                else:
                    _use_segments_ml = fn is not None and fn.startswith('emb_')
                    if _use_segments_ml:
                        print(f"🔵 [INSERT-LINE {i}] {fn} -> Segment strategy direct (multiline)")
                        if _fallback_full_fn and _fallback_full_fn == _pchk_fn:
                            _pchk_is_type0_ml = False
                            try:
                                _pchk_reg_ml = [f for f in page.get_fonts(full=True) if f[4] == _pchk_fn]
                                _pchk_is_type0_ml = bool(_pchk_reg_ml) and _pchk_reg_ml[0][2] == 'Type0'
                            except Exception:
                                pass
                            _segments = [(ln, _fallback_fn if _pchk_is_type0_ml else _pchk_fn)]
                        else:
                            _SPECIAL = set('ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙâêîôûÂÊÎÔÛãõÃÕçÇäëïöüÄËÏÖÜ')
                            def _char_in_subset(ch):
                                return ord(ch) < 128 and ch not in _SPECIAL
                            _segments = []
                            _cur_text = ''
                            _cur_fn = None
                            for _ch in ln:
                                _seg_fn = fn if _char_in_subset(_ch) else _fallback_fn_ml
                                if _seg_fn == _cur_fn:
                                    _cur_text += _ch
                                else:
                                    if _cur_text: _segments.append((_cur_text, _cur_fn))
                                    _cur_text = _ch
                                    _cur_fn = _seg_fn
                            if _cur_text: _segments.append((_cur_text, _cur_fn))
                        
                        _measure_font = _js_font_obj
                        _x = _line_x
                        for _seg_text, _seg_fn in _segments:
                            _seg_pt = fitz.Point(_x, baseline_y)
                            try:
                                page.insert_text(_seg_pt, _seg_text, fontsize=fs, fontname=_seg_fn, color=color)
                            except Exception as _se:
                                print(f"⚠️ [ML-SEGMENT] fn={_seg_fn} text='{_seg_text}' failed: {_se}")
                            try:
                                if _measure_font:
                                    _x += _measure_font.text_length(_seg_text, fontsize=fs)
                                else:
                                    _x += fitz.Font(_seg_fn).text_length(_seg_text, fontsize=fs)
                            except Exception:
                                _x += fs * 0.6 * len(_seg_text)
                        
                        if is_underline:
                            _ul_y, _thick = get_underline_params(page, _line_x, baseline_y, fs)
                            page.draw_line(fitz.Point(_line_x, _ul_y), fitz.Point(_x, _ul_y), color=color, width=_thick)
                        ok += 1
                    else:
                        # Inserción directa (fuentes estándar)
                        try:
                            page.insert_text(pt, ln, fontsize=fs, fontname=fn, color=color)
                            ok += 1
                            print(f"🔵 [INSERT-LINE {i}] ok baseline_y={baseline_y:.2f} text='{ln[:30]}'")
                            if is_underline:
                                try:
                                    _line_w = fitz.Font(fn).text_length(ln, fontsize=fs)
                                except Exception:
                                    _line_w = fs * 0.6 * len(ln)
                                _ul_y, _thick = get_underline_params(page, _line_x, baseline_y, fs)
                                page.draw_line(fitz.Point(_line_x, _ul_y), fitz.Point(_line_x + _line_w, _ul_y), color=color, width=_thick)
                        except Exception as e:
                            try:
                                page.insert_text(pt, ln, fontsize=fs, fontname='helv', color=color)
                                ok += 1
                                print(f"🔵 [INSERT-LINE {i}] fallback helv baseline_y={baseline_y:.2f}")
                                if is_underline:
                                    try:
                                        _line_w = fitz.Font('helv').text_length(ln, fontsize=fs)
                                    except Exception:
                                        _line_w = fs * 0.6 * len(ln)
                                    _ul_y, _thick = get_underline_params(page, _line_x, baseline_y, fs)
                                    page.draw_line(fitz.Point(_line_x, _ul_y), fitz.Point(_line_x + _line_w, _ul_y), color=color, width=_thick)
                            except Exception as e2:
                                print(f"🔴 [INSERT-LINE {i}] FAILED: {e2}")
            return 0 if ok == len(lines) else -(len(lines) - ok)

    # Para surgical: basar insert_rect en x/y/w/h del sub-span (no orig_rect, que puede ser el span completo)
    if is_surgical:
        insert_rect = fitz.Rect(x, y, x + w, y + h)
    else:
        insert_rect = orig_rect if is_single_line else fitz.Rect(x, y, x + w, y + h + font_size * 1.2)

    # Fix 3: Expansión horizontal quirúrgica — si el texto nuevo es más ancho que el sub-span, ampliar
    if is_surgical and is_single_line:
        try:
            _new_text_w = -1
            if _js_font_obj:
                _new_text_w = _js_font_obj.text_length(new_text, fontsize=font_size)
            else:
                _new_text_w = fitz.Font(insert_font).text_length(new_text, fontsize=font_size)
            _orig_w = w
            if _new_text_w > _orig_w + 0.5:
                _extra = _new_text_w - _orig_w + 2
                _expanded_x1 = x + w + _extra
                print(f"🔵 [SURGICAL-EXPAND-H] text_w={_new_text_w:.2f} > rect_w={_orig_w:.2f} → expand x1 {x+w:.2f}→{_expanded_x1:.2f}")
                insert_rect = fitz.Rect(x, y, _expanded_x1, y + h)
        except Exception as _hex:
            print(f"⚠️ [SURGICAL-EXPAND-H] error: {_hex}")

    print(f"🟠 [INSERT-PRE] insert_rect=({insert_rect.x0:.2f},{insert_rect.y0:.2f},{insert_rect.x1:.2f},{insert_rect.y1:.2f}) text='{new_text[:30]}' font={insert_font}")
    print(f"🟠 [INSERT-PRE] orig_rect=({orig_rect.x0:.2f},{orig_rect.y0:.2f},{orig_rect.x1:.2f},{orig_rect.y1:.2f}) erase_origin=({_erase_x0:.2f},{_erase_y0:.2f})")
    _alignment_name = str(edit.get('alignment') or 'left').lower()
    _alignment = 2 if _alignment_name == 'right' else (1 if _alignment_name == 'center' else 0)
    rc = safe_insert(page, insert_rect, new_text, font_size, insert_font, rgb_text, align=_alignment, segments=edit.get('segments'))
    print(f"🟠 [INSERT] rc={rc} font={insert_font} single={is_single_line}")
    # Verificar texto insertado — ampliar clip para cubrir insert_rect
    check_clip = fitz.Rect(x-3, y-5, x+w+3, y+h+font_size*2)
    check = page.get_text("rawdict", clip=check_clip)
    spans_check = [sp for bl in check.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
    print(f"🟠 [INSERT] spans_after={len(spans_check)} → {[{'t':s.get('text','')[:25],'bbox':[round(v,2) for v in s.get('bbox',[])]} for s in spans_check[:5]]}")
    try:
        _dict_check = page.get_text("dict", clip=check_clip)
        _dict_spans = [sp for bl in _dict_check.get('blocks',[]) for ln in bl.get('lines',[]) for sp in ln.get('spans',[])]
        print(f"🟣 [FONT-DIAG] spans_after={[(s.get('text','')[:25], s.get('font'), s.get('flags'), round(s.get('size',0),2), [round(v,2) for v in s.get('bbox',[])]) for s in _dict_spans[:8]]}")
    except Exception as _sde:
        print(f"🟣 [FONT-DIAG] spans_after error={_sde}")
    # Paths que tapan el área
    paths2 = page.get_drawings()
    paths_over = [p for p in paths2 if p['rect'].intersects(orig_rect)]
    print(f"🟠 [INSERT] paths_over={len(paths_over)} → {[{'rect':[round(v,2) for v in [p['rect'].x0,p['rect'].y0,p['rect'].x1,p['rect'].y1]],'fill':p.get('fill')} for p in paths_over[:3]]}")
    # DEBUG: fonts en página tras insert
    try:
        _flist = page.get_fonts(full=True)
        print(f"🟣 [FONTS-AFTER] {[(f[3],f[4],f[2]) for f in _flist]}")
    except Exception as _fe: print(f"🟣 [FONTS-AFTER] error: {_fe}")

    # Para quirúrgico: insert_text siempre escribe en el punto dado — no hay overflow real
    overflow = False if is_surgical else (rc < 0)
    expanded_h = h

    # Fase 2: Expandir si hay overflow (solo para no-quirúrgico)
    if overflow and expand and not is_surgical:
        page_h = page.rect.height
        trial_h = h
        for _ in range(25):
            trial_h = min(trial_h * 1.20, page_h - y)
            exp_rect = fitz.Rect(x, y, x + w, y + trial_h)
            page.draw_rect(exp_rect, color=rgb_bg, fill=rgb_bg, width=0)
            rc2 = safe_insert(page, exp_rect, new_text, font_size, use_font, rgb_text, align=_alignment, segments=edit.get('segments'))
            if rc2 >= 0 or trial_h >= page_h - y:
                expanded_h = trial_h
                overflow = (rc2 < 0)
                break

    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    return json.dumps({
        'pdf': base64.b64encode(out.getvalue()).decode(),
        'overflow': overflow,
        'expanded_h': expanded_h,
        'original_h': h
    })

apply_reflow_edit(js_data, js_pno, js_edit)
                    `, { js_data: uint8, js_pno: pageNum, js_edit: editJson });

                    const parsed = JSON.parse(result);
                    const pdfBytes = Uint8Array.from(atob(parsed.pdf), c => c.charCodeAt(0));
                    return {
                        buffer: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
                        overflow: parsed.overflow,
                        expandedH: parsed.expanded_h,
                        originalH: parsed.original_h
                    };
                } catch (e) {
                    console.error('🐍 Python: Reflow edit failed', e);
                    throw e;
                }
            },

            // ── Embedded file attachments ─────────────────────────────────
            getAttachments: async function (pdfBuffer) {
                if (!this.isLoaded) await this.init();
                const uint8 = new Uint8Array(pdfBuffer);
                const result = await this.run(`
import fitz, json, base64 as b64

def get_attachments(data):
    if hasattr(data, 'to_py'): data = bytes(data.to_py())
    else: data = bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    out = []
    for name in doc.embfile_names():
        try:
            info = doc.embfile_info(name)
            out.append({
                "name": name,
                "filename": info.get("filename", name),
                "size": info.get("size", 0),
                "mime": info.get("mime", "application/octet-stream") or "application/octet-stream"
            })
        except Exception:
            pass
    doc.close()
    return json.dumps(out)

get_attachments(js_attach_pdf)
`, { js_attach_pdf: uint8 });
                return JSON.parse(result);
            },

            addAttachment: async function (pdfBuffer, fileName, fileBuffer, mime) {
                if (!this.isLoaded) await this.init();
                const pdfU8 = new Uint8Array(pdfBuffer);
                const fileU8 = new Uint8Array(fileBuffer);
                const result = await this.run(`
import fitz, io

def add_attachment(pdf_data, file_data, fname, fmime):
    if hasattr(pdf_data, 'to_py'): pdf_data = bytes(pdf_data.to_py())
    else: pdf_data = bytes(pdf_data)
    if hasattr(file_data, 'to_py'): file_data = bytes(file_data.to_py())
    else: file_data = bytes(file_data)
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    # Remove existing with same name to avoid duplicates
    existing = doc.embfile_names()
    if fname in existing:
        doc.embfile_del(fname)
    doc.embfile_add(fname, file_data, filename=fname, ufilename=fname)
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return bytes(out.getvalue())

add_attachment(js_attach_pdf, js_attach_file, js_attach_name, js_attach_mime)
`, { js_attach_pdf: pdfU8, js_attach_file: fileU8, js_attach_name: fileName, js_attach_mime: mime });
                if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                if (result instanceof Uint8Array) return result.buffer;
                return pdfBuffer;
            },

            getAttachmentData: async function (pdfBuffer, name) {
                if (!this.isLoaded) await this.init();
                const uint8 = new Uint8Array(pdfBuffer);
                const result = await this.run(`
import fitz, base64 as b64

def get_attach_data(pdf_data, fname):
    if hasattr(pdf_data, 'to_py'): pdf_data = bytes(pdf_data.to_py())
    else: pdf_data = bytes(pdf_data)
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    data = doc.embfile_get(fname)
    doc.close()
    return b64.b64encode(data).decode()

get_attach_data(js_attach_pdf, js_attach_name)
`, { js_attach_pdf: uint8, js_attach_name: name });
                return result;
            },

            removeAttachment: async function (pdfBuffer, name) {
                if (!this.isLoaded) await this.init();
                const uint8 = new Uint8Array(pdfBuffer);
                const result = await this.run(`
import fitz, io

def remove_attachment(pdf_data, fname):
    if hasattr(pdf_data, 'to_py'): pdf_data = bytes(pdf_data.to_py())
    else: pdf_data = bytes(pdf_data)
    doc = fitz.open(stream=pdf_data, filetype="pdf")
    if fname in doc.embfile_names():
        doc.embfile_del(fname)
    out = io.BytesIO()
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return bytes(out.getvalue())

remove_attachment(js_attach_pdf, js_attach_name)
`, { js_attach_pdf: uint8, js_attach_name: name });
                if (result && result.toJs) { const _u8 = result.toJs(); return _u8.buffer.slice(_u8.byteOffset, _u8.byteOffset + _u8.byteLength); }
                if (result instanceof Uint8Array) return result.buffer;
                return pdfBuffer;
            }
        };
