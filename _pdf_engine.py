"""Shared PDF operations for the GUI, CLI and MCP adapters.

This module does not import the MCP SDK, start a server or change cwd.
"""
from __future__ import annotations

import inspect
import io
import math
import os
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional, Union, get_args, get_origin, get_type_hints

_ROOT_DIR = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
_RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
try:
    import fitz
except ImportError:
    embedded = _ROOT_DIR / "_python/Lib/site-packages"
    if embedded.is_dir():
        sys.path.insert(0, str(embedded))
    import fitz

# Library notices must not contaminate CLI JSON or MCP stdout.
if hasattr(fitz, 'no_recommend_layout'):
    fitz.no_recommend_layout()
if sys.stderr is not None and hasattr(fitz, 'set_messages'):
    fitz.set_messages(stream=sys.stderr)

from _pdf_text import PDF_TEXT_LIMIT


def read_text_bytes(pdf, page_indices=None, resource_dir=None):
    """Keep the GUI's Poppler and crop-aware text extraction contract."""
    from _pdf_text import extract_pdf_text
    return extract_pdf_text(pdf, page_indices, resource_dir or _RESOURCE_DIR)


class PDFOperationError(ValueError):
    def __init__(self, message, code="INVALID_ARGUMENTS"):
        super().__init__(message)
        self.code = code


def _operation_error(error):
    return {"error": str(error), "code": getattr(error, "code", "PDF_ERROR")}


def _normalize_path(filepath):
    """Relative paths belong to the caller's working directory."""
    return str(Path(filepath).expanduser().resolve())


def _safe_temp_dir():
    directory = _ROOT_DIR / ".mcp_artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _open_pdf(path, password=""):
    doc = fitz.open(path)
    try:
        if not doc.is_pdf:
            raise PDFOperationError("Input is not a PDF document.", "INVALID_PDF")
        if doc.needs_pass and (not password or not doc.authenticate(password)):
            raise PDFOperationError("PDF is password protected. Provide a valid password.", "PASSWORD_REQUIRED")
        return doc
    except Exception:
        doc.close()
        raise


def _pdf_get_info_impl(filepath: str, password: str='') -> Dict[str, Any]:
    """Get metadata, page count, permissions, and structure of a PDF."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    try:
        with _open_pdf(path, password) as doc:
            pages_info = []
            for i in range(len(doc)):
                page = doc[i]
                r = page.rect
                pages_info.append({'page_number': i + 1, 'width_pt': round(r.width, 2), 'height_pt': round(r.height, 2), 'rotation': page.rotation, 'has_text': len(page.get_text().strip()) > 0})
            toc = doc.get_toc()
            outline = [{'level': item[0], 'title': item[1], 'page': item[2]} for item in toc] if toc else []
            return {'filepath': path, 'filename': os.path.basename(path), 'filesize_bytes': os.path.getsize(path), 'page_count': len(doc), 'is_encrypted': bool(doc.needs_pass), 'metadata': {'format': doc.metadata.get('format', ''), 'title': doc.metadata.get('title', ''), 'author': doc.metadata.get('author', ''), 'subject': doc.metadata.get('subject', ''), 'keywords': doc.metadata.get('keywords', ''), 'creator': doc.metadata.get('creator', ''), 'producer': doc.metadata.get('producer', ''), 'creationDate': doc.metadata.get('creationDate', ''), 'modDate': doc.metadata.get('modDate', '')}, 'outline': outline, 'pages': pages_info}
    except Exception as e:
        return _operation_error(e)


def _pdf_read_text_impl(filepath: str, page_number: int=1, detail_level: str='text', password: str='') -> Dict[str, Any]:
    """Read text from a PDF page or entire document."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    try:
        with _open_pdf(path, password) as doc:
            total_pages = len(doc)
            if page_number > total_pages:
                return {'error': f'Requested page {page_number} exceeds total page count ({total_pages}).'}
            target_indices = range(total_pages) if page_number <= 0 else [page_number - 1]
            if detail_level == 'text':
                pdf = doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE)
                extracted = read_text_bytes(pdf, list(target_indices))
                results = [{'page': page['page'], 'text': page['text']} for page in extracted]
                if len(results) == 1:
                    return {'filepath': path, 'total_pages': total_pages, **results[0]}
                return {'filepath': path, 'total_pages': total_pages, 'pages': results}
            results = []
            for idx in target_indices:
                page = doc[idx]
                p_num = idx + 1
                if detail_level == 'blocks':
                    blocks_data = []
                    page_dict = page.get_text('dict')
                    for b in page_dict.get('blocks', []):
                        if b.get('type') == 0:
                            block_lines = []
                            for l in b.get('lines', []):
                                line_text = ''.join((s.get('text', '') for s in l.get('spans', [])))
                                block_lines.append(line_text)
                            blocks_data.append({'bbox': [round(coord, 2) for coord in b.get('bbox', [])], 'text': '\n'.join(block_lines)})
                    results.append({'page': p_num, 'blocks': blocks_data})
                elif detail_level == 'words':
                    words_data = []
                    for w in page.get_text('words'):
                        words_data.append({'text': w[4], 'bbox': [round(coord, 2) for coord in w[:4]]})
                    results.append({'page': p_num, 'words': words_data})
                else:
                    raw_text = page.get_text('text')
                    results.append({'page': p_num, 'text': raw_text.strip()})
            if len(results) == 1:
                return {'filepath': path, 'total_pages': total_pages, **results[0]}
            return {'filepath': path, 'total_pages': total_pages, 'pages': results}
    except Exception as e:
        return _operation_error(e)


def _pdf_search_text_impl(filepath: str, query: str, page_number: int=0, case_sensitive: bool=False, password: str='') -> Dict[str, Any]:
    """Search for text across PDF pages and return occurrences with bounding boxes."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    if not query:
        return {'error': 'Query string cannot be empty.'}
    try:
        with _open_pdf(path, password) as doc:
            target_indices = range(len(doc)) if page_number <= 0 else [page_number - 1]
            matches = []
            flags = 0 if case_sensitive else fitz.TEXT_DEHYPHENATE
            for idx in target_indices:
                if idx < 0 or idx >= len(doc):
                    continue
                page = doc[idx]
                p_num = idx + 1
                rects = page.search_for(query, flags=flags)
                for r in rects:
                    if case_sensitive and query not in page.get_textbox(r):
                        continue
                    context_rect = fitz.Rect(r.x0 - 40, r.y0 - 20, r.x1 + 40, r.y1 + 20) & page.rect
                    context_text = page.get_textbox(context_rect).replace('\n', ' ').strip()
                    matches.append({'page': p_num, 'bbox': [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)], 'context': context_text})
            return {'filepath': path, 'query': query, 'total_matches': len(matches), 'matches': matches}
    except Exception as e:
        return _operation_error(e)


def _pdf_splice_text_impl(filepath: str, page_number: int, old_text: str, new_text: str, output_path: str='', font_name: str='', font_size: float=0.0, color_hex: str='', password: str='') -> Dict[str, Any]:
    """
    Surgically replace text in a PDF page while preserving the original layout,
    clean background, and font styling without breaking the document stream.
    """
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    if not old_text:
        return {'error': 'old_text cannot be empty.'}
    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f'{stem}_spliced.pdf')
    else:
        output_path = _normalize_path(output_path)
    try:
        with _open_pdf(path, password) as doc:
            if page_number < 1 or page_number > len(doc):
                return {'error': f'Invalid page_number {page_number}. Document has {len(doc)} pages.'}
            page = doc[page_number - 1]
            rects = page.search_for(old_text)
            if not rects:
                rects = page.search_for(old_text.strip())
            if not rects:
                return {'status': 'not_found', 'message': f"Text '{old_text}' was not found on page {page_number}.", 'replaced_count': 0}
            detected_font = 'helv'
            detected_size = 11.0
            detected_color = (0.0, 0.0, 0.0)
            page_dict = page.get_text('dict')
            for b in page_dict.get('blocks', []):
                if b.get('type') == 0:
                    for l in b.get('lines', []):
                        for s in l.get('spans', []):
                            stext = s.get('text', '')
                            if old_text in stext or stext in old_text:
                                detected_size = float(s.get('size', 11.0))
                                font_val = s.get('font', '').lower()
                                if 'bold' in font_val and 'italic' in font_val:
                                    detected_font = 'hebi'
                                elif 'bold' in font_val:
                                    detected_font = 'hebo'
                                elif 'italic' in font_val or 'oblique' in font_val:
                                    detected_font = 'heit'
                                elif 'times' in font_val or 'roman' in font_val:
                                    detected_font = 'tiro'
                                elif 'courier' in font_val:
                                    detected_font = 'cour'
                                else:
                                    detected_font = 'helv'
                                raw_col = s.get('color', 0)
                                if isinstance(raw_col, int):
                                    r = (raw_col >> 16 & 255) / 255.0
                                    g = (raw_col >> 8 & 255) / 255.0
                                    b_val = (raw_col & 255) / 255.0
                                    detected_color = (r, g, b_val)
                                break
            final_font = font_name if font_name else detected_font
            final_size = font_size if font_size > 0 else detected_size
            final_color = detected_color
            if color_hex:
                c = color_hex.lstrip('#')
                if len(c) == 6:
                    final_color = (int(c[0:2], 16) / 255.0, int(c[2:4], 16) / 255.0, int(c[4:6], 16) / 255.0)
            bg_fill = (1.0, 1.0, 1.0)
            try:
                sample_rect = fitz.Rect(rects[0].x0, max(0, rects[0].y0 - 4), rects[0].x0 + 4, rects[0].y0)
                pix = page.get_pixmap(clip=sample_rect, dpi=72)
                if pix.width > 0 and pix.height > 0:
                    pixel = pix.pixel(0, 0)
                    bg_fill = (pixel[0] / 255.0, pixel[1] / 255.0, pixel[2] / 255.0)
            except Exception:
                bg_fill = (1.0, 1.0, 1.0)
            for r in rects:
                erase_rect = fitz.Rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5)
                page.add_redact_annot(erase_rect, fill=bg_fill)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
            first_r = rects[0]
            baseline_y = first_r.y1 - final_size * 0.18
            insert_pt = fitz.Point(first_r.x0, baseline_y)
            rc = page.insert_text(insert_pt, new_text, fontname=final_font, fontsize=final_size, color=final_color)
            doc.save(output_path, garbage=3, deflate=True)
            return {'status': 'success', 'message': f"Successfully spliced '{old_text}' -> '{new_text}' on page {page_number}.", 'output_path': output_path, 'replaced_instances': len(rects), 'font_used': final_font, 'font_size': final_size, 'coordinates': [round(first_r.x0, 2), round(first_r.y0, 2), round(first_r.x1, 2), round(first_r.y1, 2)]}
    except Exception as e:
        return _operation_error(e)


def _pdf_redact_sensitive_data_impl(filepath: str, patterns: List[str], page_number: int=0, fill_color: str='black', output_path: str='', password: str='') -> Dict[str, Any]:
    """Permanently censor/redact sensitive patterns or text from a PDF."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    if not patterns:
        return {'error': 'Patterns list cannot be empty.'}
    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f'{stem}_redacted.pdf')
    else:
        output_path = _normalize_path(output_path)
    fill_rgb = (0.0, 0.0, 0.0) if fill_color.lower() == 'black' else (1.0, 1.0, 1.0)
    if fill_color.startswith('#'):
        c = fill_color.lstrip('#')
        if len(c) == 6:
            fill_rgb = (int(c[0:2], 16) / 255.0, int(c[2:4], 16) / 255.0, int(c[4:6], 16) / 255.0)
    try:
        with _open_pdf(path, password) as doc:
            target_indices = range(len(doc)) if page_number <= 0 else [page_number - 1]
            total_redactions = 0
            for idx in target_indices:
                if idx < 0 or idx >= len(doc):
                    continue
                page = doc[idx]
                page_redacted = 0
                for pattern in patterns:
                    rects = page.search_for(pattern)
                    for r in rects:
                        page.add_redact_annot(r, fill=fill_rgb)
                        page_redacted += 1
                if page_redacted > 0:
                    page.apply_redactions()
                    total_redactions += page_redacted
            doc.save(output_path, garbage=3, deflate=True)
            return {'status': 'success', 'message': f'Successfully redacted {total_redactions} instances.', 'total_redactions': total_redactions, 'output_path': output_path}
    except Exception as e:
        return _operation_error(e)


def _pdf_render_page_image_impl(filepath: str, page_number: int=1, dpi: int=150, output_path: str='', password: str='') -> Dict[str, Any]:
    """Render a PDF page to a high-resolution PNG image."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f'{stem}_page_{page_number}_{dpi}dpi.png')
    else:
        output_path = _normalize_path(output_path)
    try:
        with _open_pdf(path, password) as doc:
            if page_number < 1 or page_number > len(doc):
                return {'error': f'Invalid page_number {page_number}. Document has {len(doc)} pages.'}
            page = doc[page_number - 1]
            pix = page.get_pixmap(dpi=dpi)
            pix.save(output_path)
            return {'status': 'success', 'output_path': output_path, 'page_number': page_number, 'dpi': dpi, 'width_px': pix.width, 'height_px': pix.height, 'filesize_bytes': os.path.getsize(output_path)}
    except Exception as e:
        return _operation_error(e)


def _pdf_organize_pages_impl(filepath: str, output_path: str, rotations: Optional[Dict[str, int]]=None, delete_pages: Optional[List[int]]=None, reorder_pages: Optional[List[int]]=None, password: str='') -> Dict[str, Any]:
    """Organize PDF pages: rotate specific pages, delete pages, or reorder."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    output_path = _normalize_path(output_path)
    try:
        with _open_pdf(path, password) as doc:
            if rotations:
                for p_str, angle in rotations.items():
                    p_idx = int(p_str) - 1
                    if 0 <= p_idx < len(doc):
                        page = doc[p_idx]
                        page.set_rotation((page.rotation + int(angle)) % 360)
            if reorder_pages:
                zero_based_order = [p - 1 for p in reorder_pages if 1 <= p <= len(doc)]
                if len(zero_based_order) == len(doc):
                    doc.select(zero_based_order)
            if delete_pages:
                for p in sorted(delete_pages, reverse=True):
                    p_idx = p - 1
                    if 0 <= p_idx < len(doc) and len(doc) > 1:
                        doc.delete_page(p_idx)
            doc.save(output_path, garbage=3, deflate=True)
            final_count = len(doc)
            return {'status': 'success', 'message': f'Organized PDF successfully. New page count: {final_count}.', 'output_path': output_path, 'final_page_count': final_count}
    except Exception as e:
        return _operation_error(e)


def _pdf_merge_impl(input_paths: List[str], output_path: str, password: str='') -> Dict[str, Any]:
    """Merge multiple PDF documents into a single file."""
    if not input_paths or len(input_paths) < 2:
        return {'error': 'At least 2 input_paths are required for merge.'}
    output_path = _normalize_path(output_path)
    try:
        with fitz.open() as merged_doc:
            total_pages = 0
            for p in input_paths:
                norm_p = _normalize_path(p)
                if not os.path.exists(norm_p):
                    return {'error': f'Merge failed: File not found {norm_p}'}
                with _open_pdf(norm_p, password) as src:
                    merged_doc.insert_pdf(src)
                    total_pages += len(src)
            merged_doc.save(output_path, garbage=3, deflate=True)
            return {'status': 'success', 'message': f'Merged {len(input_paths)} files into {output_path}.', 'total_pages': total_pages, 'output_path': output_path}
    except Exception as e:
        return _operation_error(e)


def _pdf_split_impl(filepath: str, output_dir: str, ranges: Optional[List[str]]=None, password: str='') -> Dict[str, Any]:
    """Split a PDF into multiple documents by page ranges (e.g. ['1-3', '4-6']) or page-by-page."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    out_d = Path(_normalize_path(output_dir))
    out_d.mkdir(parents=True, exist_ok=True)
    stem = Path(path).stem
    try:
        created_files = []
        with _open_pdf(path, password) as src:
            total_pages = len(src)
            if not ranges:
                for i in range(total_pages):
                    out_p = str(out_d / f'{stem}_page_{i + 1}.pdf')
                    with fitz.open() as single_doc:
                        single_doc.insert_pdf(src, from_page=i, to_page=i)
                        single_doc.save(out_p, garbage=3, deflate=True)
                    created_files.append(out_p)
            else:
                for r_str in ranges:
                    parts = r_str.replace(' ', '').split('-')
                    if len(parts) == 1:
                        start = end = int(parts[0])
                    else:
                        start, end = (int(parts[0]), int(parts[1]))
                    start = max(1, min(start, total_pages))
                    end = max(start, min(end, total_pages))
                    out_p = str(out_d / f'{stem}_pages_{start}-{end}.pdf')
                    with fitz.open() as range_doc:
                        range_doc.insert_pdf(src, from_page=start - 1, to_page=end - 1)
                        range_doc.save(out_p, garbage=3, deflate=True)
                    created_files.append(out_p)
        return {'status': 'success', 'message': f'Split PDF into {len(created_files)} files.', 'created_files': created_files}
    except Exception as e:
        return _operation_error(e)


def _pdf_extract_tables_impl(filepath: str, page_number: int=1, output_format: str='markdown', password: str='') -> Dict[str, Any]:
    """Detect and extract tabular data from a PDF page using PyMuPDF table detection."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {'error': f'File not found: {path}'}
    try:
        with _open_pdf(path, password) as doc:
            if page_number < 1 or page_number > len(doc):
                return {'error': f'Invalid page_number {page_number}. Document has {len(doc)} pages.'}
            page = doc[page_number - 1]
            tabs = page.find_tables()
            table_count = len(tabs.tables) if tabs else 0
            if table_count == 0:
                return {'status': 'no_tables', 'message': f'No distinct tables detected on page {page_number}.', 'table_count': 0, 'tables': []}
            extracted_tables = []
            for t_idx, table in enumerate(tabs.tables):
                raw_rows = table.extract()
                if not raw_rows:
                    continue
                clean_rows = [[(c if c is not None else '').strip() for c in r] for r in raw_rows]
                if output_format == 'markdown':
                    md_lines = []
                    headers = clean_rows[0]
                    md_lines.append('| ' + ' | '.join(headers) + ' |')
                    md_lines.append('| ' + ' | '.join(['---'] * len(headers)) + ' |')
                    for row in clean_rows[1:]:
                        md_lines.append('| ' + ' | '.join(row) + ' |')
                    rendered = '\n'.join(md_lines)
                elif output_format == 'csv':
                    csv_io = io.StringIO()
                    import csv
                    writer = csv.writer(csv_io)
                    writer.writerows(clean_rows)
                    rendered = csv_io.getvalue()
                else:
                    rendered = clean_rows
                extracted_tables.append({'table_index': t_idx + 1, 'bbox': [round(coord, 2) for coord in table.bbox], 'row_count': len(clean_rows), 'col_count': len(clean_rows[0]) if clean_rows else 0, 'content': rendered})
            return {'status': 'success', 'page_number': page_number, 'table_count': len(extracted_tables), 'format': output_format, 'tables': extracted_tables}
    except Exception as e:
        return _operation_error(e)


TOOL_HANDLERS = {
    'pdf_get_info': _pdf_get_info_impl,
    'pdf_read_text': _pdf_read_text_impl,
    'pdf_search_text': _pdf_search_text_impl,
    'pdf_splice_text': _pdf_splice_text_impl,
    'pdf_redact_sensitive_data': _pdf_redact_sensitive_data_impl,
    'pdf_render_page_image': _pdf_render_page_image_impl,
    'pdf_organize_pages': _pdf_organize_pages_impl,
    'pdf_merge': _pdf_merge_impl,
    'pdf_split': _pdf_split_impl,
    'pdf_extract_tables': _pdf_extract_tables_impl,
}


def _matches_type(value, annotation):
    if annotation is Any:
        return True
    origin = get_origin(annotation)
    options = get_args(annotation)
    if origin is Union:
        return any(_matches_type(value, option) for option in options)
    if annotation is type(None):
        return value is None
    if annotation is float:
        return type(value) in (int, float) and math.isfinite(value)
    if origin is list:
        return isinstance(value, list) and all(_matches_type(item, options[0]) for item in value)
    if origin is dict:
        return isinstance(value, dict) and all(
            _matches_type(key, options[0]) and _matches_type(item, options[1])
            for key, item in value.items()
        )
    return type(value) is annotation


def _require(condition, message, code='INVALID_ARGUMENTS'):
    if not condition:
        raise PDFOperationError(message, code)


def _same_path(first, second):
    if os.path.normcase(_normalize_path(first)) == os.path.normcase(_normalize_path(second)):
        return True
    try:
        return os.path.samefile(first, second)
    except OSError:
        return False


def _split_ranges(ranges, page_count):
    if not ranges:
        return [(page, page) for page in range(1, page_count + 1)]
    parsed = []
    for expression in ranges:
        match = re.fullmatch(r'(\d+)(?:-(\d+))?', re.sub(r'\s+', '', expression))
        _require(match is not None, 'ranges must contain page numbers or ranges such as 1-3.')
        first = int(match[1])
        last = int(match[2] or match[1])
        _require(1 <= first <= last <= page_count, f'Invalid page range for a {page_count}-page document.')
        parsed.append((first, last))
    _require(len(set(parsed)) == len(parsed), 'ranges must not contain duplicate ranges.')
    return parsed


def _validate_fields(name, arguments):
    for key in ('filepath', 'output_dir'):
        if key in arguments:
            _require(bool(arguments[key].strip()), f'{key} must not be empty.')
    if name in ('pdf_merge', 'pdf_organize_pages'):
        _require(bool(arguments['output_path'].strip()), 'output_path must not be empty.')
    if 'query' in arguments:
        _require(bool(arguments['query'].strip()), 'query must not be empty.')
    if 'old_text' in arguments:
        _require(bool(arguments['old_text'].strip()), 'old_text must not be empty.')
    if 'patterns' in arguments:
        _require(bool(arguments['patterns']) and all(pattern.strip() for pattern in arguments['patterns']),
                 'patterns must contain nonempty literal strings.')
    if name == 'pdf_merge':
        _require(len(arguments['input_paths']) >= 2 and all(path.strip() for path in arguments['input_paths']),
                 'At least two nonempty input_paths are required.')
    if 'detail_level' in arguments:
        _require(arguments['detail_level'] in ('text', 'blocks', 'words'),
                 'detail_level must be text, blocks or words.')
    if 'output_format' in arguments:
        _require(arguments['output_format'] in ('markdown', 'csv', 'json'),
                 'output_format must be markdown, csv or json.')
    if 'dpi' in arguments:
        _require(arguments['dpi'] > 0, 'dpi must be a positive integer.')
    if 'font_size' in arguments:
        _require(arguments['font_size'] >= 0, 'font_size must not be negative.')
    if arguments.get('color_hex'):
        _require(re.fullmatch(r'#?[0-9a-fA-F]{6}', arguments['color_hex']) is not None,
                 'color_hex must contain six hexadecimal digits.')
    if 'fill_color' in arguments:
        color = arguments['fill_color']
        _require(color.lower() in ('black', 'white') or re.fullmatch(r'#[0-9a-fA-F]{6}', color) is not None,
                 'fill_color must be black, white or #RRGGBB.')


def _validate_pages(name, arguments, page_count):
    if 'page_number' in arguments:
        all_pages = name in ('pdf_read_text', 'pdf_search_text', 'pdf_redact_sensitive_data')
        minimum = 0 if all_pages else 1
        _require(minimum <= arguments['page_number'] <= page_count,
                 f'page_number must be between {minimum} and {page_count}.')
    if name == 'pdf_organize_pages':
        rotations = arguments.get('rotations') or {}
        for page, angle in rotations.items():
            _require(page.isdecimal() and 1 <= int(page) <= page_count,
                     f'Rotation pages must be between 1 and {page_count}.')
            _require(angle % 90 == 0, 'Rotation angles must be multiples of 90 degrees.')
        order = arguments.get('reorder_pages')
        if order is not None:
            _require(sorted(order) == list(range(1, page_count + 1)),
                     'reorder_pages must be a permutation of every page, without duplicates.')
        deleted = arguments.get('delete_pages') or []
        _require(len(set(deleted)) == len(deleted) and all(1 <= page <= page_count for page in deleted),
                 f'delete_pages must contain unique page numbers between 1 and {page_count}.')
        _require(len(deleted) < page_count, 'Cannot delete every page of a PDF.')


def _validate_sources_and_outputs(name, arguments):
    inputs = arguments.get('input_paths') if name == 'pdf_merge' else [arguments['filepath']]
    paths = [_normalize_path(path) for path in inputs]
    page_count = 0
    for path in paths:
        _require(Path(path).is_file(), f'File not found: {path}', 'FILE_NOT_FOUND')
        with _open_pdf(path, arguments.get('password', '')) as document:
            if not page_count:
                page_count = len(document)
            if name != 'pdf_merge':
                _validate_pages(name, arguments, page_count)
    if name == 'pdf_merge':
        arguments['input_paths'] = paths
    else:
        arguments['filepath'] = paths[0]
    outputs = []
    if 'output_path' in arguments:
        if arguments['output_path']:
            output = _normalize_path(arguments['output_path'])
            arguments['output_path'] = output
        else:
            stem = Path(paths[0]).stem
            suffixes = {
                'pdf_splice_text': f'{stem}_spliced.pdf',
                'pdf_redact_sensitive_data': f'{stem}_redacted.pdf',
                'pdf_render_page_image': f"{stem}_page_{arguments.get('page_number')}_{arguments.get('dpi')}dpi.png",
            }
            output = str(_ROOT_DIR / '.mcp_artifacts' / suffixes[name])
        outputs.append(output)
    if name == 'pdf_split':
        arguments['output_dir'] = _normalize_path(arguments['output_dir'])
        ranges = _split_ranges(arguments.get('ranges'), page_count)
        for first, last in ranges:
            stem = Path(paths[0]).stem
            suffix = f'pages_{first}-{last}' if arguments.get('ranges') else f'page_{first}'
            outputs.append(str(Path(arguments['output_dir']) / f'{stem}_{suffix}.pdf'))
    for output in outputs:
        _require(not any(_same_path(source, output) for source in paths),
                 'Output must not overwrite an input PDF. Choose a different path.', 'OUTPUT_CONFLICT')


def execute(name: str, arguments: dict | None = None) -> dict:
    """Execute one shared operation, returning JSON-safe data or an error/code pair."""
    if not isinstance(name, str) or name not in TOOL_HANDLERS:
        return {'error': 'Unknown PDF operation.', 'code': 'UNKNOWN_TOOL'}
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        return {'error': 'arguments must be an object.', 'code': 'INVALID_ARGUMENTS'}
    handler = TOOL_HANDLERS[name]
    try:
        try:
            bound = inspect.signature(handler).bind(**arguments)
        except TypeError as error:
            raise PDFOperationError(str(error)) from None
        bound.apply_defaults()
        hints = get_type_hints(handler)
        for key, value in bound.arguments.items():
            _require(_matches_type(value, hints[key]), f'Invalid type for argument {key}.')
        values = dict(bound.arguments)
        _validate_fields(name, values)
        _validate_sources_and_outputs(name, values)
        result = handler(**values)
        if 'error' in result:
            result.setdefault('code', 'PDF_ERROR')
        return result
    except Exception as error:
        return _operation_error(error)


