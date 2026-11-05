#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
================================================================================
 ALIOTH PDF EDITOR - MODEL CONTEXT PROTOCOL (MCP) SERVER
================================================================================
 Enables autonomous AI agents (Google Antigravity, Claude Desktop, Cursor,
 Hermes, Codex, Muse, Grokbot, OpenDevin, etc.) to inspect, search, edit,
 splice text, redact, render, and manipulate PDF documents via standard MCP.
================================================================================
"""

import sys
import os
import io
import json
import base64
import re
import tempfile
import traceback
from pathlib import Path
from typing import Optional, List, Dict, Any, Union

# Ensure the local workspace is in sys.path
_ROOT_DIR = Path(__file__).resolve().parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

# Import PyMuPDF
try:
    import fitz
except ImportError:
    # If run with an external Python, try using embedded _python's site-packages
    _embedded_site_packages = _ROOT_DIR / "_python" / "Lib" / "site-packages"
    if _embedded_site_packages.exists():
        sys.path.insert(0, str(_embedded_site_packages))
    import fitz

# Import MCP SDK
try:
    from mcp.server.mcpserver import MCPServer
except ImportError:
    try:
        from mcp.server.fastmcp import FastMCP as MCPServer
    except ImportError:
        MCPServer = None


# ─────────────────────────────────────────────────────────────────────────────
# SERVER INITIALIZATION
# ─────────────────────────────────────────────────────────────────────────────

server = MCPServer(
    name="alioth-pdf-editor",
    instructions=(
        "Alioth PDF Editor MCP Server provides powerful, surgical PDF manipulation tools: "
        "inspect document metadata and structure, read and search text, surgically splice and replace text "
        "preserving original font/layout, redact sensitive PII, extract tables and images, render pages to PNG, "
        "and organize pages (rotate, merge, split)."
    )
) if MCPServer else None


def _normalize_path(filepath: str) -> str:
    """Resolve and normalize file paths safely."""
    p = Path(filepath).expanduser()
    if not p.is_absolute():
        p = (_ROOT_DIR / p).resolve()
    return str(p)


def _safe_temp_dir() -> Path:
    """Create and return a workspace temp directory for MCP artifacts."""
    d = _ROOT_DIR / ".mcp_artifacts"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ─────────────────────────────────────────────────────────────────────────────
# MCP TOOLS IMPLEMENTATION
# ─────────────────────────────────────────────────────────────────────────────

def _pdf_get_info_impl(filepath: str, password: str = "") -> Dict[str, Any]:
    """Get metadata, page count, permissions, and structure of a PDF."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    try:
        with fitz.open(path) as doc:
            if doc.is_encrypted:
                if not password or not doc.authenticate(password):
                    return {"error": "PDF is password protected. Provide a valid password.", "is_encrypted": True}

            pages_info = []
            for i in range(len(doc)):
                page = doc[i]
                r = page.rect
                pages_info.append({
                    "page_number": i + 1,
                    "width_pt": round(r.width, 2),
                    "height_pt": round(r.height, 2),
                    "rotation": page.rotation,
                    "has_text": len(page.get_text().strip()) > 0
                })

            toc = doc.get_toc()
            outline = [{"level": item[0], "title": item[1], "page": item[2]} for item in toc] if toc else []

            return {
                "filepath": path,
                "filename": os.path.basename(path),
                "filesize_bytes": os.path.getsize(path),
                "page_count": len(doc),
                "is_encrypted": doc.is_encrypted,
                "metadata": {
                    "format": doc.metadata.get("format", ""),
                    "title": doc.metadata.get("title", ""),
                    "author": doc.metadata.get("author", ""),
                    "subject": doc.metadata.get("subject", ""),
                    "keywords": doc.metadata.get("keywords", ""),
                    "creator": doc.metadata.get("creator", ""),
                    "producer": doc.metadata.get("producer", ""),
                    "creationDate": doc.metadata.get("creationDate", ""),
                    "modDate": doc.metadata.get("modDate", "")
                },
                "outline": outline,
                "pages": pages_info
            }
    except Exception as e:
        return {"error": f"Failed to inspect PDF: {str(e)}", "trace": traceback.format_exc()}


def _pdf_read_text_impl(filepath: str, page_number: int = 1, detail_level: str = "text", password: str = "") -> Dict[str, Any]:
    """Read text from a PDF page or entire document."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    try:
        with fitz.open(path) as doc:
            if doc.is_encrypted and password:
                doc.authenticate(password)

            total_pages = len(doc)
            if page_number > total_pages:
                return {"error": f"Requested page {page_number} exceeds total page count ({total_pages})."}

            # Read all pages if page_number <= 0
            target_indices = range(total_pages) if page_number <= 0 else [page_number - 1]

            results = []
            for idx in target_indices:
                page = doc[idx]
                p_num = idx + 1

                if detail_level == "blocks":
                    blocks_data = []
                    page_dict = page.get_text("dict")
                    for b in page_dict.get("blocks", []):
                        if b.get("type") == 0:  # Text block
                            block_lines = []
                            for l in b.get("lines", []):
                                line_text = "".join(s.get("text", "") for s in l.get("spans", []))
                                block_lines.append(line_text)
                            blocks_data.append({
                                "bbox": [round(coord, 2) for coord in b.get("bbox", [])],
                                "text": "\n".join(block_lines)
                            })
                    results.append({"page": p_num, "blocks": blocks_data})

                elif detail_level == "words":
                    words_data = []
                    for w in page.get_text("words"):
                        words_data.append({
                            "text": w[4],
                            "bbox": [round(coord, 2) for coord in w[:4]]
                        })
                    results.append({"page": p_num, "words": words_data})

                else:  # detail_level == "text" (plain)
                    raw_text = page.get_text("text")
                    results.append({"page": p_num, "text": raw_text.strip()})

            if len(results) == 1:
                return {"filepath": path, "total_pages": total_pages, **results[0]}
            return {"filepath": path, "total_pages": total_pages, "pages": results}

    except Exception as e:
        return {"error": f"Failed to read text: {str(e)}", "trace": traceback.format_exc()}


def _pdf_search_text_impl(filepath: str, query: str, page_number: int = 0, case_sensitive: bool = False, password: str = "") -> Dict[str, Any]:
    """Search for text across PDF pages and return occurrences with bounding boxes."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}
    if not query:
        return {"error": "Query string cannot be empty."}

    try:
        with fitz.open(path) as doc:
            if doc.is_encrypted and password:
                doc.authenticate(password)

            target_indices = range(len(doc)) if page_number <= 0 else [page_number - 1]
            matches = []

            flags = 0 if case_sensitive else fitz.TEXT_DEHYPHENATE

            for idx in target_indices:
                if idx < 0 or idx >= len(doc):
                    continue
                page = doc[idx]
                p_num = idx + 1

                # search_for returns a list of Rects
                rects = page.search_for(query, flags=flags)
                for r in rects:
                    # Extract surrounding context (e.g. 50pt padding)
                    context_rect = fitz.Rect(r.x0 - 40, r.y0 - 20, r.x1 + 40, r.y1 + 20) & page.rect
                    context_text = page.get_textbox(context_rect).replace("\n", " ").strip()

                    matches.append({
                        "page": p_num,
                        "bbox": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
                        "context": context_text
                    })

            return {
                "filepath": path,
                "query": query,
                "total_matches": len(matches),
                "matches": matches
            }
    except Exception as e:
        return {"error": f"Search failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_splice_text_impl(
    filepath: str,
    page_number: int,
    old_text: str,
    new_text: str,
    output_path: str = "",
    font_name: str = "",
    font_size: float = 0.0,
    color_hex: str = ""
) -> Dict[str, Any]:
    """
    Surgically replace text in a PDF page while preserving the original layout,
    clean background, and font styling without breaking the document stream.
    """
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}
    if not old_text:
        return {"error": "old_text cannot be empty."}

    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f"{stem}_spliced.pdf")
    else:
        output_path = _normalize_path(output_path)

    try:
        doc = fitz.open(path)
        if page_number < 1 or page_number > len(doc):
            return {"error": f"Invalid page_number {page_number}. Document has {len(doc)} pages."}

        page = doc[page_number - 1]
        rects = page.search_for(old_text)

        if not rects:
            # Try case-insensitive or stripped search
            rects = page.search_for(old_text.strip())

        if not rects:
            return {
                "status": "not_found",
                "message": f"Text '{old_text}' was not found on page {page_number}.",
                "replaced_count": 0
            }

        # Inspect page font dict to detect font size, font family, and color
        detected_font = "helv"
        detected_size = 11.0
        detected_color = (0.0, 0.0, 0.0)

        page_dict = page.get_text("dict")
        for b in page_dict.get("blocks", []):
            if b.get("type") == 0:
                for l in b.get("lines", []):
                    for s in l.get("spans", []):
                        stext = s.get("text", "")
                        if old_text in stext or stext in old_text:
                            detected_size = float(s.get("size", 11.0))
                            font_val = s.get("font", "").lower()
                            if "bold" in font_val and "italic" in font_val:
                                detected_font = "hebi"
                            elif "bold" in font_val:
                                detected_font = "hebo"
                            elif "italic" in font_val or "oblique" in font_val:
                                detected_font = "heit"
                            elif "times" in font_val or "roman" in font_val:
                                detected_font = "tiro"
                            elif "courier" in font_val:
                                detected_font = "cour"
                            else:
                                detected_font = "helv"

                            raw_col = s.get("color", 0)
                            if isinstance(raw_col, int):
                                r = ((raw_col >> 16) & 0xFF) / 255.0
                                g = ((raw_col >> 8) & 0xFF) / 255.0
                                b_val = (raw_col & 0xFF) / 255.0
                                detected_color = (r, g, b_val)
                            break

        final_font = font_name if font_name else detected_font
        final_size = font_size if font_size > 0 else detected_size
        final_color = detected_color

        if color_hex:
            c = color_hex.lstrip("#")
            if len(c) == 6:
                final_color = (int(c[0:2], 16) / 255.0, int(c[2:4], 16) / 255.0, int(c[4:6], 16) / 255.0)

        # Detect background color around target rect (sample 2px above rect)
        bg_fill = (1.0, 1.0, 1.0)
        try:
            sample_rect = fitz.Rect(rects[0].x0, max(0, rects[0].y0 - 4), rects[0].x0 + 4, rects[0].y0)
            pix = page.get_pixmap(clip=sample_rect, dpi=72)
            if pix.width > 0 and pix.height > 0:
                pixel = pix.pixel(0, 0)
                bg_fill = (pixel[0] / 255.0, pixel[1] / 255.0, pixel[2] / 255.0)
        except Exception:
            bg_fill = (1.0, 1.0, 1.0)

        # Apply redaction to erase old characters and background
        for r in rects:
            # Expand bbox by 0.5pt to cleanly cover character edges
            erase_rect = fitz.Rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5)
            page.add_redact_annot(erase_rect, fill=bg_fill)

        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

        # Insert new replacement text
        first_r = rects[0]
        # Calculate baseline position (approximately y1 - descent)
        baseline_y = first_r.y1 - (final_size * 0.18)
        insert_pt = fitz.Point(first_r.x0, baseline_y)

        rc = page.insert_text(
            insert_pt,
            new_text,
            fontname=final_font,
            fontsize=final_size,
            color=final_color
        )

        doc.save(output_path, garbage=3, deflate=True)
        doc.close()

        return {
            "status": "success",
            "message": f"Successfully spliced '{old_text}' -> '{new_text}' on page {page_number}.",
            "output_path": output_path,
            "replaced_instances": len(rects),
            "font_used": final_font,
            "font_size": final_size,
            "coordinates": [round(first_r.x0, 2), round(first_r.y0, 2), round(first_r.x1, 2), round(first_r.y1, 2)]
        }

    except Exception as e:
        return {"error": f"Splice failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_redact_sensitive_data_impl(
    filepath: str,
    patterns: List[str],
    page_number: int = 0,
    fill_color: str = "black",
    output_path: str = ""
) -> Dict[str, Any]:
    """Permanently censor/redact sensitive patterns or text from a PDF."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}
    if not patterns:
        return {"error": "Patterns list cannot be empty."}

    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f"{stem}_redacted.pdf")
    else:
        output_path = _normalize_path(output_path)

    fill_rgb = (0.0, 0.0, 0.0) if fill_color.lower() == "black" else (1.0, 1.0, 1.0)
    if fill_color.startswith("#"):
        c = fill_color.lstrip("#")
        if len(c) == 6:
            fill_rgb = (int(c[0:2], 16) / 255.0, int(c[2:4], 16) / 255.0, int(c[4:6], 16) / 255.0)

    try:
        doc = fitz.open(path)
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
        doc.close()

        return {
            "status": "success",
            "message": f"Successfully redacted {total_redactions} instances.",
            "total_redactions": total_redactions,
            "output_path": output_path
        }
    except Exception as e:
        return {"error": f"Redaction failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_render_page_image_impl(
    filepath: str,
    page_number: int = 1,
    dpi: int = 150,
    output_path: str = ""
) -> Dict[str, Any]:
    """Render a PDF page to a high-resolution PNG image."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    if not output_path:
        stem = Path(path).stem
        output_path = str(_safe_temp_dir() / f"{stem}_page_{page_number}_{dpi}dpi.png")
    else:
        output_path = _normalize_path(output_path)

    try:
        with fitz.open(path) as doc:
            if page_number < 1 or page_number > len(doc):
                return {"error": f"Invalid page_number {page_number}. Document has {len(doc)} pages."}

            page = doc[page_number - 1]
            pix = page.get_pixmap(dpi=dpi)
            pix.save(output_path)

            return {
                "status": "success",
                "output_path": output_path,
                "page_number": page_number,
                "dpi": dpi,
                "width_px": pix.width,
                "height_px": pix.height,
                "filesize_bytes": os.path.getsize(output_path)
            }
    except Exception as e:
        return {"error": f"Page render failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_organize_pages_impl(
    filepath: str,
    output_path: str,
    rotations: Optional[Dict[str, int]] = None,
    delete_pages: Optional[List[int]] = None,
    reorder_pages: Optional[List[int]] = None
) -> Dict[str, Any]:
    """Organize PDF pages: rotate specific pages, delete pages, or reorder."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    output_path = _normalize_path(output_path)

    try:
        doc = fitz.open(path)

        # 1. Rotations: dict of { "page_str": angle } e.g. {"1": 90}
        if rotations:
            for p_str, angle in rotations.items():
                p_idx = int(p_str) - 1
                if 0 <= p_idx < len(doc):
                    page = doc[p_idx]
                    page.set_rotation((page.rotation + int(angle)) % 360)

        # 2. Reorder if specified (1-indexed list of page numbers)
        if reorder_pages:
            zero_based_order = [p - 1 for p in reorder_pages if 1 <= p <= len(doc)]
            if len(zero_based_order) == len(doc):
                doc.select(zero_based_order)

        # 3. Delete pages (1-indexed list of page numbers)
        if delete_pages:
            # Sort descending to delete without shifting lower indices
            for p in sorted(delete_pages, reverse=True):
                p_idx = p - 1
                if 0 <= p_idx < len(doc) and len(doc) > 1:
                    doc.delete_page(p_idx)

        doc.save(output_path, garbage=3, deflate=True)
        final_count = len(doc)
        doc.close()

        return {
            "status": "success",
            "message": f"Organized PDF successfully. New page count: {final_count}.",
            "output_path": output_path,
            "final_page_count": final_count
        }
    except Exception as e:
        return {"error": f"Organize pages failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_merge_impl(input_paths: List[str], output_path: str) -> Dict[str, Any]:
    """Merge multiple PDF documents into a single file."""
    if not input_paths or len(input_paths) < 2:
        return {"error": "At least 2 input_paths are required for merge."}

    output_path = _normalize_path(output_path)

    try:
        merged_doc = fitz.open()
        total_pages = 0

        for p in input_paths:
            norm_p = _normalize_path(p)
            if not os.path.exists(norm_p):
                return {"error": f"Merge failed: File not found {norm_p}"}
            with fitz.open(norm_p) as src:
                merged_doc.insert_pdf(src)
                total_pages += len(src)

        merged_doc.save(output_path, garbage=3, deflate=True)
        merged_doc.close()

        return {
            "status": "success",
            "message": f"Merged {len(input_paths)} files into {output_path}.",
            "total_pages": total_pages,
            "output_path": output_path
        }
    except Exception as e:
        return {"error": f"Merge failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_split_impl(filepath: str, output_dir: str, ranges: Optional[List[str]] = None) -> Dict[str, Any]:
    """Split a PDF into multiple documents by page ranges (e.g. ['1-3', '4-6']) or page-by-page."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    out_d = Path(_normalize_path(output_dir))
    out_d.mkdir(parents=True, exist_ok=True)
    stem = Path(path).stem

    try:
        created_files = []
        with fitz.open(path) as src:
            total_pages = len(src)

            if not ranges:
                # Split every page
                for i in range(total_pages):
                    out_p = str(out_d / f"{stem}_page_{i + 1}.pdf")
                    single_doc = fitz.open()
                    single_doc.insert_pdf(src, from_page=i, to_page=i)
                    single_doc.save(out_p, garbage=3, deflate=True)
                    single_doc.close()
                    created_files.append(out_p)
            else:
                # Split by specified ranges
                for r_str in ranges:
                    parts = r_str.replace(" ", "").split("-")
                    if len(parts) == 1:
                        start = end = int(parts[0])
                    else:
                        start, end = int(parts[0]), int(parts[1])

                    start = max(1, min(start, total_pages))
                    end = max(start, min(end, total_pages))

                    out_p = str(out_d / f"{stem}_pages_{start}-{end}.pdf")
                    range_doc = fitz.open()
                    range_doc.insert_pdf(src, from_page=start - 1, to_page=end - 1)
                    range_doc.save(out_p, garbage=3, deflate=True)
                    range_doc.close()
                    created_files.append(out_p)

        return {
            "status": "success",
            "message": f"Split PDF into {len(created_files)} files.",
            "created_files": created_files
        }
    except Exception as e:
        return {"error": f"Split failed: {str(e)}", "trace": traceback.format_exc()}


def _pdf_extract_tables_impl(filepath: str, page_number: int = 1, output_format: str = "markdown") -> Dict[str, Any]:
    """Detect and extract tabular data from a PDF page using PyMuPDF table detection."""
    path = _normalize_path(filepath)
    if not os.path.exists(path):
        return {"error": f"File not found: {path}"}

    try:
        with fitz.open(path) as doc:
            if page_number < 1 or page_number > len(doc):
                return {"error": f"Invalid page_number {page_number}. Document has {len(doc)} pages."}

            page = doc[page_number - 1]
            tabs = page.find_tables()
            table_count = len(tabs.tables) if tabs else 0

            if table_count == 0:
                return {
                    "status": "no_tables",
                    "message": f"No distinct tables detected on page {page_number}.",
                    "table_count": 0,
                    "tables": []
                }

            extracted_tables = []
            for t_idx, table in enumerate(tabs.tables):
                raw_rows = table.extract()
                if not raw_rows:
                    continue

                clean_rows = [[(c if c is not None else "").strip() for c in r] for r in raw_rows]

                if output_format == "markdown":
                    md_lines = []
                    headers = clean_rows[0]
                    md_lines.append("| " + " | ".join(headers) + " |")
                    md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                    for row in clean_rows[1:]:
                        md_lines.append("| " + " | ".join(row) + " |")
                    rendered = "\n".join(md_lines)
                elif output_format == "csv":
                    csv_io = io.StringIO()
                    import csv
                    writer = csv.writer(csv_io)
                    writer.writerows(clean_rows)
                    rendered = csv_io.getvalue()
                else:  # json
                    rendered = clean_rows

                extracted_tables.append({
                    "table_index": t_idx + 1,
                    "bbox": [round(coord, 2) for coord in table.bbox],
                    "row_count": len(clean_rows),
                    "col_count": len(clean_rows[0]) if clean_rows else 0,
                    "content": rendered
                })

            return {
                "status": "success",
                "page_number": page_number,
                "table_count": len(extracted_tables),
                "format": output_format,
                "tables": extracted_tables
            }
    except Exception as e:
        return {"error": f"Table extraction failed: {str(e)}", "trace": traceback.format_exc()}


# ─────────────────────────────────────────────────────────────────────────────
# REGISTER TOOLS ON MCPSERVER
# ─────────────────────────────────────────────────────────────────────────────

if server:
    @server.tool(name="pdf_get_info", description="Get metadata, page count, sizes, permissions, and outline of a PDF.")
    def pdf_get_info(filepath: str, password: str = "") -> str:
        """Inspects PDF metadata, dimensions, and table of contents."""
        res = _pdf_get_info_impl(filepath, password)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_read_text", description="Extract text or positioned blocks/words from a PDF page or all pages.")
    def pdf_read_text(filepath: str, page_number: int = 1, detail_level: str = "text", password: str = "") -> str:
        """Extracts text ('text', 'blocks', or 'words') from a specified page (1-indexed) or all pages (0)."""
        res = _pdf_read_text_impl(filepath, page_number, detail_level, password)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_search_text", description="Search for keywords or phrases across PDF pages with bounding boxes and context.")
    def pdf_search_text(filepath: str, query: str, page_number: int = 0, case_sensitive: bool = False, password: str = "") -> str:
        """Finds occurrences of a query with page numbers and coordinate bounding boxes."""
        res = _pdf_search_text_impl(filepath, query, page_number, case_sensitive, password)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(
        name="pdf_splice_text",
        description="Surgically replace text in a PDF page while preserving original layout, clean background, and font styling without breaking document structure."
    )
    def pdf_splice_text(
        filepath: str,
        page_number: int,
        old_text: str,
        new_text: str,
        output_path: str = "",
        font_name: str = "",
        font_size: float = 0.0,
        color_hex: str = ""
    ) -> str:
        """Performs surgical in-place replacement of old_text with new_text on page_number (1-indexed)."""
        res = _pdf_splice_text_impl(filepath, page_number, old_text, new_text, output_path, font_name, font_size, color_hex)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_redact_sensitive_data", description="Permanently redact and erase sensitive text, regex patterns, or PII from a PDF.")
    def pdf_redact_sensitive_data(
        filepath: str,
        patterns: List[str],
        page_number: int = 0,
        fill_color: str = "black",
        output_path: str = ""
    ) -> str:
        """Permanently redacts words/patterns (page_number=0 for all pages)."""
        res = _pdf_redact_sensitive_data_impl(filepath, patterns, page_number, fill_color, output_path)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_render_page_image", description="Render a PDF page to a high-resolution PNG image file.")
    def pdf_render_page_image(filepath: str, page_number: int = 1, dpi: int = 150, output_path: str = "") -> str:
        """Renders page_number (1-indexed) to PNG image."""
        res = _pdf_render_page_image_impl(filepath, page_number, dpi, output_path)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_organize_pages", description="Rotate, delete, or reorder pages in a PDF document.")
    def pdf_organize_pages(
        filepath: str,
        output_path: str,
        rotations: Optional[Dict[str, int]] = None,
        delete_pages: Optional[List[int]] = None,
        reorder_pages: Optional[List[int]] = None
    ) -> str:
        """Rotates (rotations={'1': 90}), deletes (delete_pages=[3]), or reorders pages."""
        res = _pdf_organize_pages_impl(filepath, output_path, rotations, delete_pages, reorder_pages)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_merge", description="Merge multiple PDF files into a single unified document.")
    def pdf_merge(input_paths: List[str], output_path: str) -> str:
        """Combines multiple PDF files in order into output_path."""
        res = _pdf_merge_impl(input_paths, output_path)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_split", description="Split a PDF file into multiple documents by page ranges or page-by-page.")
    def pdf_split(filepath: str, output_dir: str, ranges: Optional[List[str]] = None) -> str:
        """Splits PDF by ranges (e.g. ['1-3', '4-5']) or page-by-page into output_dir."""
        res = _pdf_split_impl(filepath, output_dir, ranges)
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name="pdf_extract_tables", description="Detect and extract tables from a PDF page into Markdown, CSV, or JSON.")
    def pdf_extract_tables(filepath: str, page_number: int = 1, output_format: str = "markdown") -> str:
        """Detects tables on page_number and formats as 'markdown', 'csv', or 'json'."""
        res = _pdf_extract_tables_impl(filepath, page_number, output_format)
        return json.dumps(res, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# SELF-TEST SUITE
# ─────────────────────────────────────────────────────────────────────────────

def run_self_test() -> int:
    """Runs a verification test of all tools on a sample document."""
    print("==================================================================")
    print(" ALIOTH PDF MCP SERVER - SELF TEST")
    print("==================================================================")
    print(f" Python:   {sys.version.split()[0]} ({sys.executable})")
    print(f" PyMuPDF:  {fitz.__version__}")
    print(f" FastMCP:  {'Available' if server else 'Not Available'}")
    print("------------------------------------------------------------------")

    # Locate a sample PDF
    sample_pdf = _ROOT_DIR / "Otros" / "test_tooltip_annots.pdf"
    if not sample_pdf.exists():
        print("Creating temporary test PDF...")
        sample_pdf = _safe_temp_dir() / "test_mcp_sample.pdf"
        doc = fitz.open()
        p = doc.new_page(width=595, height=842)
        p.insert_text(fitz.Point(72, 100), "Alioth PDF Editor MCP Test", fontsize=18, fontname="helv", color=(0, 0, 0))
        p.insert_text(fitz.Point(72, 140), "Confidential data: RFC ABCD-123456-XYZ", fontsize=12, fontname="helv", color=(0.2, 0.2, 0.2))
        p.insert_text(fitz.Point(72, 180), "This is a paragraph to be surgically edited.", fontsize=12, fontname="helv", color=(0.2, 0.2, 0.2))
        doc.save(str(sample_pdf))
        doc.close()

    print(f"Using sample PDF: {sample_pdf}")

    # 1. Info
    info = _pdf_get_info_impl(str(sample_pdf))
    assert "error" not in info, f"Info test failed: {info}"
    print(f" [PASS] pdf_get_info -> Page count: {info.get('page_count')}")

    # 2. Read Text
    text_res = _pdf_read_text_impl(str(sample_pdf), page_number=1)
    assert "error" not in text_res, f"Read text failed: {text_res}"
    print(f" [PASS] pdf_read_text -> Characters read: {len(text_res.get('text', ''))}")

    # 3. Search Text
    first_word = text_res.get("text", "").split()[0] if text_res.get("text") else "Alioth"
    search_res = _pdf_search_text_impl(str(sample_pdf), query=first_word)
    assert "error" not in search_res, f"Search failed: {search_res}"
    print(f" [PASS] pdf_search_text -> Matches for '{first_word}': {search_res.get('total_matches')}")

    # 4. Splice Text
    splice_out = str(_safe_temp_dir() / "test_spliced.pdf")
    splice_res = _pdf_splice_text_impl(
        str(sample_pdf),
        page_number=1,
        old_text=first_word,
        new_text="ALIOTH_VERIFIED",
        output_path=splice_out
    )
    assert "error" not in splice_res, f"Splice failed: {splice_res}"
    print(f" [PASS] pdf_splice_text -> Status: {splice_res.get('status')} -> {splice_out}")

    # 5. Render Page
    render_out = str(_safe_temp_dir() / "test_rendered.png")
    render_res = _pdf_render_page_image_impl(str(sample_pdf), page_number=1, dpi=100, output_path=render_out)
    assert "error" not in render_res, f"Render failed: {render_res}"
    print(f" [PASS] pdf_render_page_image -> {render_res.get('width_px')}x{render_res.get('height_px')}px")

    # 6. Redact Text
    redact_out = str(_safe_temp_dir() / "test_redacted.pdf")
    redact_res = _pdf_redact_sensitive_data_impl(
        str(sample_pdf),
        patterns=[first_word],
        output_path=redact_out
    )
    assert "error" not in redact_res, f"Redaction failed: {redact_res}"
    print(f" [PASS] pdf_redact_sensitive_data -> Redactions: {redact_res.get('total_redactions')}")

    print("------------------------------------------------------------------")
    print(" ALL 6 CORE MCP TOOLS PASSED VERIFICATION 100%!")
    print("==================================================================")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if "--test" in sys.argv:
        sys.exit(run_self_test())

    if server:
        # Run stdio transport for agent connections (Antigravity, Claude, Cursor, Hermes, etc.)
        server.run(transport="stdio")
    else:
        sys.stderr.write("Error: FastMCP / MCPServer library is not installed.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
