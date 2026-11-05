"""
Motor de borrado y splice quirurgico de texto para Alioth PDF Editor.
Inspirado en la arquitectura de operadores de PdfCraft (crates/edit/src/text.rs).

Opera directamente sobre los streams /Contents de la pagina:
1. Localiza los operadores Tj/TJ correspondientes a los glifos del span por posicion (Tm x CTM).
2. Los reemplaza in-place por un ajuste numerico TJ [-1000 * advance / (size * scale)] TJ.
3. El texto viejo desaparece instantaneamente del PDF sin alterar fondos, vectores,
   tablas ni lineas contiguas con ascenders/descenders.
4. Incluye verificacion post-splice y fallback seguro a 'legacy'.
"""
import re
import fitz

WS = b" \t\r\n\f\x00"
DELIM = b"()<>[]{}/%"
_ESC = {
    ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12,
    ord("("): 40, ord(")"): 41, ord("\\"): 92
}


class SpliceFallbackError(Exception):
    """Excepcion lanzada cuando el PDF requiere caer a 'legacy' de forma segura."""
    pass


# ────────────────────────────────────────────────────────────────
# 1. TOKENIZADOR DE CONTENT STREAMS
# ────────────────────────────────────────────────────────────────
def _lex(data, i):
    n = len(data)
    while i < n:
        c = data[i]
        if c in WS:
            i += 1
        elif c == 0x25:  # % comentario
            while i < n and data[i] not in b"\r\n":
                i += 1
        else:
            break
    if i >= n:
        return None, i
    s = i
    c = data[i]
    if c == 0x28:  # (string literal)
        depth, i, out = 1, i + 1, bytearray()
        while i < n and depth:
            ch = data[i]
            if ch == 0x5C:  # barra invertida \
                i += 1
                if i >= n:
                    break
                e = data[i]
                if e in _ESC:
                    out.append(_ESC[e]); i += 1
                elif 0x30 <= e <= 0x37:
                    v = k = 0
                    while k < 3 and i < n and 0x30 <= data[i] <= 0x37:
                        v = v * 8 + data[i] - 48; i += 1; k += 1
                    out.append(v & 255)
                elif e == 13:
                    i += 1
                    if i < n and data[i] == 10:
                        i += 1
                elif e == 10:
                    i += 1
                else:
                    out.append(e); i += 1
            elif ch == 0x28:
                depth += 1; out.append(ch); i += 1
            elif ch == 0x29:
                depth -= 1
                if depth:
                    out.append(ch)
                i += 1
            else:
                out.append(ch); i += 1
        return ("str", bytes(out), s, i), i

    if c == 0x3C:  # <hex string o <<
        if i + 1 < n and data[i + 1] == 0x3C:
            return ("<<", None, s, i + 2), i + 2
        try:
            j = data.index(b">", i)
        except ValueError:
            raise SpliceFallbackError("Hex string sin terminar en content stream")
        hx = re.sub(rb"\s", b"", data[i + 1:j])
        if len(hx) % 2:
            hx += b"0"
        try:
            return ("str", bytes.fromhex(hx.decode("ascii")), s, j + 1), j + 1
        except Exception:
            raise SpliceFallbackError("Hex string con caracteres invalidos")

    if c == 0x3E and i + 1 < n and data[i + 1] == 0x3E:
        return (">>", None, s, i + 2), i + 2
    if c in b"[]{}":
        return (chr(c), None, s, i + 1), i + 1
    if c == 0x2F:  # /Name
        i += 1
        while i < n and data[i] not in WS and data[i] not in DELIM:
            i += 1
        return ("name", data[s + 1:i].decode("latin1"), s, i), i

    while i < n and data[i] not in WS and data[i] not in DELIM:
        i += 1
    if i == s:
        return ("junk", None, s, i + 1), i + 1
    t = data[s:i]
    try:
        return ("num", float(t), s, i), i
    except ValueError:
        pass
    if t in (b"true", b"false", b"null"):
        return ("kw", t.decode("ascii"), s, i), i
    return ("op", t.decode("latin1"), s, i), i


def parse_ops(data):
    ops, operands, cont, op_start, i, n = [], [], [], None, 0, len(data)
    ei_re = re.compile(rb"\sEI(?=\s|$)")
    while True:
        tok, i = _lex(data, i)
        if tok is None:
            break
        k, v, s, e = tok
        if op_start is None:
            op_start = s
        tgt = cont[-1] if cont else operands
        if k == "[":
            cont.append([]); continue
        if k == "]":
            arr = cont.pop() if cont else []
            (cont[-1] if cont else operands).append(("arr", arr)); continue
        if k == "<<":
            depth = 1
            while depth:
                t2, i = _lex(data, i)
                if t2 is None:
                    break
                depth += 1 if t2[0] == "<<" else (-1 if t2[0] == ">>" else 0)
            tgt.append(("dict", data[s:i])); continue
        if k == "op" and not cont:
            if v == "BI":  # Inline image
                m = data.find(b"ID", i)
                mm = ei_re.search(data, m + 2) if m >= 0 else None
                end = mm.end() if mm else n
                ops.append({"op": "BI", "args": [], "start": op_start, "end": end})
                i, operands, op_start = end, [], None
                continue
            ops.append({"op": v, "args": operands, "start": op_start, "end": e})
            operands, op_start = [], None
            continue
        tgt.append((k, v))
    return ops


# ────────────────────────────────────────────────────────────────
# 2. METRICAS DE FUENTES (ANCHO DE GLIFOS)
# ────────────────────────────────────────────────────────────────
_B14 = {
    "helvetica": "helv", "helvetica-bold": "hebo", "helvetica-oblique": "heit",
    "helvetica-boldoblique": "hebi", "times-roman": "tiro", "times-bold": "tibo",
    "times-italic": "tiit", "times-bolditalic": "tibi", "courier": "cour",
    "courier-bold": "cobo", "courier-oblique": "coit", "courier-boldoblique": "cobi",
    "symbol": "symb", "zapfdingbats": "zadb"
}


def _ints_and_arrays(txt):
    toks = re.findall(r"\[|\]|-?\d+(?:\.\d+)?|-?\.\d+", txt)
    stack, cur = [], []
    for t in toks:
        if t == "[":
            stack.append(cur); cur = []
        elif t == "]":
            done = cur; cur = stack.pop() if stack else []
            cur.append(done)
        else:
            cur.append(float(t))
    return cur[0] if len(cur) == 1 and isinstance(cur[0], list) else cur


def _resolve(doc, xref, key):
    typ, val = doc.xref_get_key(xref, key)
    if typ == "xref":
        rx = int(val.split()[0])
        return "obj", doc.xref_object(rx, compressed=True), rx
    return typ, val, None


class FontInfo:
    def __init__(self, doc, xref):
        self.xref = xref
        self.two_byte = False
        self.widths = {}
        self.dw = 1000.0
        self.type3 = False
        self.vertical = False
        self.b14 = None
        sub = doc.xref_get_key(xref, "Subtype")[1]
        if sub == "/Type3":
            self.type3 = True
            return
        if sub == "/Type0":
            enc = doc.xref_get_key(xref, "Encoding")[1]
            self.two_byte = True
            self.vertical = enc.endswith("-V")
            typ, val, _ = _resolve(doc, xref, "DescendantFonts")
            m = re.search(r"(\d+)\s+0\s+R", val)
            if not m:
                return
            dx = int(m.group(1))
            dwt = doc.xref_get_key(dx, "DW")
            if dwt[0] == "int":
                self.dw = float(dwt[1])
            typ, val, _ = _resolve(doc, dx, "W")
            if typ in ("array", "obj"):
                arr = _ints_and_arrays(val)
                j = 0
                while j < len(arr):
                    c1 = int(arr[j])
                    if j + 1 < len(arr) and isinstance(arr[j + 1], list):
                        for k, w in enumerate(arr[j + 1]):
                            self.widths[c1 + k] = float(w)
                        j += 2
                    elif j + 2 < len(arr):
                        for c in range(c1, int(arr[j + 1]) + 1):
                            self.widths[c] = float(arr[j + 2])
                        j += 3
                    else:
                        break
            return

        # Fuentes simples (TrueType, Type1)
        fc = doc.xref_get_key(xref, "FirstChar")
        first = int(fc[1]) if fc[0] == "int" else 0
        typ, val, _ = _resolve(doc, xref, "Widths")
        if typ in ("array", "obj"):
            for k, w in enumerate(_ints_and_arrays(val)):
                if not isinstance(w, list):
                    self.widths[first + k] = float(w)
        if not self.widths:
            base = doc.xref_get_key(xref, "BaseFont")[1].lstrip("/").split("+")[-1].lower()
            self.b14 = fitz.Font(_B14.get(base, "helv"))
            self.dw = 0.0

    def codes(self, s):
        if self.two_byte:
            return [s[i:i + 2] for i in range(0, len(s) - 1, 2)]
        return [s[i:i + 1] for i in range(len(s))]

    def width(self, code):
        c = int.from_bytes(code, "big")
        if c in self.widths:
            return self.widths[c] / 1000.0
        if self.b14 is not None:
            try:
                return self.b14.glyph_advance(ord(bytes([c]).decode("cp1252")))
            except Exception:
                return 0.5
        return self.dw / 1000.0


def _mul(a, b):
    return (
        a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
    )


# ────────────────────────────────────────────────────────────────
# 3. INTERPRETE DE ESTADO GRAFICO
# ────────────────────────────────────────────────────────────────
def interpret(doc, page, ops):
    fonts = {}
    for f in page.get_fonts(full=True):
        xref, _ext, _typ, _base, name, _enc, ref = f
        if ref == 0 and name not in fonts:
            fonts[name] = xref
    finfo = {}
    to_page = page.transformation_matrix
    I = (1, 0, 0, 1, 0, 0)
    gs = {
        "ctm": I, "Tc": 0.0, "Tw": 0.0, "Th": 1.0, "TL": 0.0, "Ts": 0.0,
        "font": None, "size": 0.0, "Tr": 0
    }
    stack = []
    tm = tlm = I
    glyphs = []

    def num(a):
        return a[1] if a[0] == "num" else 0.0

    def show(op_idx, elems):
        nonlocal tm
        name = gs["font"]
        if name not in finfo:
            if name not in fonts:
                raise SpliceFallbackError(f"Fuente /{name} no encontrada en recursos de pagina")
            finfo[name] = FontInfo(doc, fonts[name])
        fi = finfo[name]
        size, th = gs["size"], gs["Th"]
        for ei, el in enumerate(elems):
            if el[0] == "num":
                tx = -el[1] / 1000.0 * size * th
                tm = _mul((1, 0, 0, 1, tx, 0), tm)
                continue
            if el[0] != "str":
                continue
            for gi, code in enumerate(fi.codes(el[1])):
                w0 = fi.width(code)
                sp = gs["Tw"] if (not fi.two_byte and code == b" ") else 0.0
                tx = (w0 * size + gs["Tc"] + sp) * th
                trm = _mul(_mul((size * th, 0, 0, size, 0, gs["Ts"]), tm), gs["ctm"])
                end = _mul(_mul((1, 0, 0, 1, tx, 0), tm), gs["ctm"])
                p0 = fitz.Point(trm[4], trm[5]) * to_page
                p1 = fitz.Point(end[4], end[5]) * to_page
                glyphs.append({
                    "op": op_idx, "elem": ei, "gi": gi, "code": code, "tx": tx,
                    "x0": p0.x, "x1": p1.x, "y": p0.y, "size": size, "th": th,
                    "font": name, "fi": fi,
                    "horiz": abs(trm[1]) < 1e-6 and abs(trm[2]) < 1e-6 and trm[0] > 0
                })
                tm = _mul((1, 0, 0, 1, tx, 0), tm)

    for idx, o in enumerate(ops):
        op, a = o["op"], o["args"]
        if op == "q":
            stack.append(dict(gs))
        elif op == "Q":
            if stack:
                gs = stack.pop()
        elif op == "cm" and len(a) == 6:
            gs["ctm"] = _mul(tuple(num(x) for x in a), gs["ctm"])
        elif op == "BT":
            tm = tlm = I
        elif op == "Tf" and len(a) == 2:
            gs["font"], gs["size"] = a[0][1], num(a[1])
        elif op == "Tc" and a:
            gs["Tc"] = num(a[0])
        elif op == "Tw" and a:
            gs["Tw"] = num(a[0])
        elif op == "Tz" and a:
            gs["Th"] = num(a[0]) / 100.0
        elif op == "TL" and a:
            gs["TL"] = num(a[0])
        elif op == "Ts" and a:
            gs["Ts"] = num(a[0])
        elif op == "Tr" and a:
            gs["Tr"] = int(num(a[0]))
        elif op == "Tm" and len(a) == 6:
            tm = tlm = tuple(num(x) for x in a)
        elif op in ("Td", "TD") and len(a) == 2:
            if op == "TD":
                gs["TL"] = -num(a[1])
            tm = tlm = _mul((1, 0, 0, 1, num(a[0]), num(a[1])), tlm)
        elif op == "T*":
            tm = tlm = _mul((1, 0, 0, 1, 0, -gs["TL"]), tlm)
        elif op == "Tj" and a:
            show(idx, [a[0]])
        elif op == "TJ" and a and a[0][0] == "arr":
            show(idx, a[0][1])
        elif op == "'" and a:
            tm = tlm = _mul((1, 0, 0, 1, 0, -gs["TL"]), tlm)
            show(idx, [a[0]])
        elif op == '"' and len(a) == 3:
            gs["Tw"], gs["Tc"] = num(a[0]), num(a[1])
            tm = tlm = _mul((1, 0, 0, 1, 0, -gs["TL"]), tlm)
            show(idx, [a[2]])
    return glyphs


# ────────────────────────────────────────────────────────────────
# 4. REESCRITURA QUIRURGICA (SPLICE)
# ────────────────────────────────────────────────────────────────
def _fmt(v):
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def _rewrite_op(o, glyphs_of_op, removed):
    a = o["args"]
    if o["op"] == "TJ":
        elems = a[0][1]
    elif o["op"] == '"':
        elems = [a[2]]
    else:
        elems = [a[0]]
    by_elem = {}
    for g in glyphs_of_op:
        by_elem.setdefault(g["elem"], []).append(g)
    out = []

    def push_num(n):
        if out and out[-1][0] == "n":
            out[-1] = ("n", out[-1][1] + n)
        else:
            out.append(("n", n))

    def push_str(b):
        if out and out[-1][0] == "s":
            out[-1] = ("s", out[-1][1] + b)
        else:
            out.append(("s", b))

    for ei, el in enumerate(elems):
        if el[0] == "num":
            push_num(el[1]); continue
        if el[0] != "str":
            continue
        for g in by_elem.get(ei, []):
            if id(g) in removed:
                push_num(-1000.0 * g["tx"] / (g["size"] * g["th"]))
            else:
                push_str(g["code"])
    parts = []
    for k, v in out:
        if k == "s":
            parts.append("<" + v.hex() + ">")
        elif abs(v) > 1e-6:
            parts.append(_fmt(v))
    body = "[" + " ".join(parts) + "] TJ"
    if o["op"] == "'":
        body = "T* " + body
    elif o["op"] == '"':
        body = f"{_fmt(a[0][1])} Tw {_fmt(a[1][1])} Tc T* " + body
    return body.encode("latin1")


# ────────────────────────────────────────────────────────────────
# 5. REMOVER SPANS CON POST-VERIFICACION
# ────────────────────────────────────────────────────────────────
def remove_spans(doc, page, spans):
    """
    Elimina quirurgicamente una lista de spans del /Contents de la pagina.
    Lanza SpliceFallbackError si no es aplicable o si la verificacion falla.
    """
    if not spans:
        return True, {"removed_count": 0}

    # Comprobar rotacion de pagina
    if page.rotation not in (0, 360):
        raise SpliceFallbackError(f"Pagina con rotacion ({page.rotation} grados) no apta para splice directo")

    # Extraer snapshot de texto antes de modificar para verificacion
    pre_dict = page.get_text("dict")
    pre_spans = [
        s for b in pre_dict["blocks"] if b["type"] == 0
        for l in b["lines"] for s in l["spans"] if s["text"].strip()
    ]

    # Limpiar y unificar streams de la pagina
    page.clean_contents(sanitize=False)
    xrefs = page.get_contents()
    if not xrefs:
        raise SpliceFallbackError("Pagina sin stream de contenido /Contents")
    data = page.read_contents()
    ops = parse_ops(data)
    glyphs = interpret(doc, page, ops)

    all_hits = []
    for span in spans:
        x0, y0, x1, y1 = span["bbox"]
        sz = span.get("size", 10)
        has_orig = "origin" in span and len(span["origin"]) >= 2
        oy = span["origin"][1] if has_orig else (y0 + sz * 0.8)
        tol_y = max(1.2, sz * 0.2) if has_orig else max(2.5, sz * 0.4)
        hits = [
            g for g in glyphs
            if g["horiz"] and abs(g["y"] - oy) <= tol_y
            and (x0 - 1.5) <= ((g["x0"] + g["x1"]) / 2.0) <= (x1 + 1.5)
        ]
        if not hits:
            raise SpliceFallbackError(f"No se localizaron glifos para el span '{span.get('text', '')}'")
        if any(g["fi"].type3 or g["fi"].vertical for g in hits):
            raise SpliceFallbackError("Fuente Type3 o escritura vertical detectada")
        all_hits.extend(hits)

    if not all_hits:
        raise SpliceFallbackError("No se encontraron glifos a eliminar")

    removed = {id(g) for g in all_hits}
    by_op = {}
    for g in glyphs:
        by_op.setdefault(g["op"], []).append(g)

    touched = sorted({g["op"] for g in all_hits}, reverse=True)
    buf = bytearray(data)
    for oi in touched:
        o = ops[oi]
        new_op_bytes = _rewrite_op(o, by_op[oi], removed)
        buf[o["start"]:o["end"]] = new_op_bytes

    doc.update_stream(xrefs[0], bytes(buf))
    if len(xrefs) > 1:
        page.set_contents(xrefs[0])

    # ────────────────────────────────────────────────────────────
    # 6. POST-VERIFICACION RIGUROSA
    # ────────────────────────────────────────────────────────────
    post_dict = page.get_text("dict")
    post_spans = [
        s for b in post_dict["blocks"] if b["type"] == 0
        for l in b["lines"] for s in l["spans"] if s["text"].strip()
    ]

    # Verificar que el texto de cada span objetivo ya no aparece en su rectangulo
    for span in spans:
        target_t = span.get("text", "").strip()
        if not target_t:
            continue
        clip_r = fitz.Rect(span["bbox"]) + (-1, -1, 1, 1)
        remaining_t = page.get_text("text", clip=clip_r).strip()
        if target_t in remaining_t:
            raise SpliceFallbackError(f"Verificacion fallo: el texto '{target_t}' sigue presente tras splice")

    # Verificar que no hubo destruccion colateral masiva
    expected_reduction = len(spans)
    if len(post_spans) < len(pre_spans) - expected_reduction - 5:
        raise SpliceFallbackError(f"Verificacion fallo: exceso de spans desaparecidos ({len(pre_spans)} -> {len(post_spans)})")

    return True, {
        "glyphs_removed": len(all_hits),
        "ops_touched": len(touched),
        "spans_count": len(spans)
    }
