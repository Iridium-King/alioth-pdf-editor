import base64
import io
import math

import pymupdf as fitz
from PIL import Image, ImageChops, ImageDraw


mupdf = fitz.mupdf
UNIT_RECT = fitz.Rect(0, 0, 1, 1)
IMAGE_TO_PDF = fitz.Matrix(1, 0, 0, -1, 0, 1)
KEEP_IMAGE = object()


def _png(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def _read_bitmap(image):
    pix = fitz.Pixmap(image.fz_get_unscaled_pixmap_from_image())
    if pix.colorspace and pix.colorspace.n != 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    bitmap = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")
    mask = image.mask()
    if mask.m_internal:
        mask_pix = fitz.Pixmap(mask.fz_get_unscaled_pixmap_from_image())
        alpha = Image.frombytes("L", (mask_pix.width, mask_pix.height), mask_pix.samples)
        alpha = alpha.resize(bitmap.size, Image.Resampling.BILINEAR)
        bitmap.putalpha(ImageChops.multiply(bitmap.getchannel("A"), alpha))
    return bitmap


def _without_area(bitmap, pixel_to_view, area):
    # Map the selection into the original image, preserving pixels at their native resolution.
    view_to_pixel = ~pixel_to_view
    corners = [point * view_to_pixel for point in (area.tl, area.tr, area.br, area.bl)]
    keep = Image.new("L", bitmap.size, 255)
    if pixel_to_view.b == pixel_to_view.c == 0 or pixel_to_view.a == pixel_to_view.d == 0:
        x0, x1 = (round(fn(p.x for p in corners)) for fn in (min, max))
        y0, y1 = (round(fn(p.y for p in corners)) for fn in (min, max))
        keep.paste(0, (x0, y0, x1, y1))
    else:
        ImageDraw.Draw(keep).polygon([(p.x - 0.5, p.y - 0.5) for p in corners], fill=0)
    alpha = ImageChops.multiply(bitmap.getchannel("A"), keep)
    rgb = Image.composite(bitmap.convert("RGB"), Image.new("RGB", bitmap.size), keep)
    return (fitz.Pixmap(fitz.csRGB, *bitmap.size, rgb.tobytes(), False),
            fitz.Pixmap(fitz.csGRAY, *bitmap.size, alpha.tobytes(), False))


class _ImageFilter(mupdf.PdfSanitizeFilterOptions2):
    def __init__(self, visit, removed):
        super().__init__()
        self.use_virtual_image_filter()
        if removed:
            self.use_virtual_culler()
        self.visit = visit
        self.removed = removed
        self.index = 0

    def culler(self, ctx, bounds, kind):
        if kind != mupdf.FZ_CULL_IMAGE or self.index not in self.removed:
            return 0
        # Skip whole images before the image callback. A cull needs no replacement image.
        self.removed.remove(self.index)
        self.index += 1
        return 1

    def image_filter(self, ctx, ctm, name, image, scissor):
        index = self.index
        self.index += 1
        replacement = self.visit(index, ctm, name, image, scissor)
        # Inline images and replacement XObjects are released by the filter.
        if replacement is KEEP_IMAGE:
            return mupdf.ll_fz_keep_image(image) if name == "<inline>" else image
        return mupdf.ll_fz_keep_image(replacement.m_internal)


def _filter_page(page, visit, *, removed=None, inspect_only=False):
    filter_ = _ImageFilter(visit, removed)
    options = fitz._make_PdfFilterOptions(
        sanitize=1, instance_forms=1, no_update=int(inspect_only), sopts=filter_
    )
    pdf_page = page._pdf_page()
    mupdf.pdf_filter_page_contents(pdf_page.doc(), pdf_page, options)


def lift_pdf_image(data, index, selection, password=""):
    """Cut an image or a rectangle of image pixels into an editable PNG."""
    viewport = fitz.Matrix(*selection["transform"])
    page_bounds = fitz.Rect(0, 0, selection["width"], selection["height"])
    box = fitz.Rect(selection["rect"]) & page_bounds if "rect" in selection else None
    point = fitz.Point(selection["point"]) if box is None else None
    candidates = {}

    with fitz.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass and not doc.authenticate(password):
            raise ValueError("PDF_IMAGE_PASSWORD")
        page = doc[index]

        def inspect_image(ordinal, ctm, name, raw_image, scissor):
            from_image = IMAGE_TO_PDF * fitz.Matrix(mupdf.FzMatrix(ctm)) * viewport
            bounds = (UNIT_RECT * from_image) & page_bounds & (fitz.Rect(mupdf.FzRect(scissor)) * viewport)
            area = bounds & box if box is not None else bounds
            if not area.is_empty and from_image.a * from_image.d != from_image.b * from_image.c:
                if point is None or (point in area and point * ~from_image in UNIT_RECT):
                    image = mupdf.FzImage(mupdf.ll_fz_keep_image(raw_image))
                    if not image.imagemask():
                        if point is not None:
                            candidates.clear()  # Hit the uppermost image at the pointer.
                        candidates[ordinal] = (name, image, from_image, bounds, area)
            return KEEP_IMAGE

        _filter_page(page, inspect_image, inspect_only=True)
        if not candidates:
            return None

        patch_bounds = fitz.Rect()
        pixels_per_point = 0
        for name, image, matrix, bounds, area in candidates.values():
            patch_bounds |= area
            pixels_per_point = max(pixels_per_point, image.w() / math.hypot(matrix.a, matrix.b),
                                   image.h() / math.hypot(matrix.c, matrix.d))
            if name == "<inline>" and bounds != area:
                raise ValueError("PDF_INLINE_IMAGE_REGION")

        pixels_per_point = min(pixels_per_point, 4096 / max(patch_bounds.width, patch_bounds.height))
        size = (max(1, round(patch_bounds.width * pixels_per_point)),
                max(1, round(patch_bounds.height * pixels_per_point)))
        patch = Image.new("RGBA", size)
        replacements = {}
        removed = set()

        for ordinal, (_, image, matrix, bounds, area) in candidates.items():
            bitmap = _read_bitmap(image)
            pixel_to_view = fitz.Matrix(1 / bitmap.width, 1 / bitmap.height) * matrix
            out_width = max(1, round(area.width / patch_bounds.width * size[0]))
            out_height = max(1, round(area.height / patch_bounds.height * size[1]))
            to_pixels = fitz.Matrix(area.width / out_width, 0, 0, area.height / out_height, area.x0, area.y0) * ~pixel_to_view
            a, b, c, d, e, f = to_pixels
            fragment = bitmap.transform((out_width, out_height), Image.Transform.AFFINE, (a, c, e, b, d, f),
                                        resample=Image.Resampling.BICUBIC)
            left = min(size[0] - out_width, round((area.x0 - patch_bounds.x0) / patch_bounds.width * size[0]))
            top = min(size[1] - out_height, round((area.y0 - patch_bounds.y0) / patch_bounds.height * size[1]))
            patch.alpha_composite(fragment, (left, top))

            if bounds == area:
                removed.add(ordinal)
            else:
                remaining, alpha = _without_area(bitmap, pixel_to_view, area)
                mask = mupdf.fz_new_image_from_pixmap(alpha.this, mupdf.FzImage())
                replacements[ordinal] = mupdf.fz_new_image_from_pixmap(remaining.this, mask)

        if not patch.getbbox():
            return None

        def replace_image(ordinal, ctm, name, image, scissor):
            return replacements.pop(ordinal, KEEP_IMAGE)

        _filter_page(page, replace_image, removed=removed)
        if replacements or removed:
            raise ValueError("PDF_IMAGE_OCCURRENCE_CHANGED")
        return (doc.tobytes(garbage=2, deflate=True), base64.b64encode(_png(patch)).decode("ascii"),
                tuple(patch_bounds))
