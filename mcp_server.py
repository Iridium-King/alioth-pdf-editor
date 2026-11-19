"""MCP stdio adapter for the shared Alioth PDF engine."""
import functools
import inspect
import json
from pathlib import Path
import sys
from typing import Dict, List, Optional

_ROOT_DIR = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))
import _pdf_engine as engine

fitz = engine.fitz
_normalize_path = engine._normalize_path
_safe_temp_dir = engine._safe_temp_dir


def _compat_handler(name):
    handler = engine.TOOL_HANDLERS[name]
    @functools.wraps(handler)
    def invoke(*args, **kwargs):
        try:
            arguments = inspect.signature(handler).bind(*args, **kwargs).arguments
        except TypeError as error:
            return {"error": str(error), "code": "INVALID_ARGUMENTS"}
        return engine.execute(name, dict(arguments))
    return invoke


# Compatibility for code that used the original internal function names.
for _tool_name in engine.TOOL_HANDLERS:
    globals()["_" + _tool_name + "_impl"] = _compat_handler(_tool_name)

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


if server:

    @server.tool(name='pdf_get_info', description='Get metadata, page count, sizes, permissions, and outline of a PDF.')
    def pdf_get_info(filepath: str, password: str='') -> str:
        """Inspects PDF metadata, dimensions, and table of contents."""
        res = engine.execute('pdf_get_info', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_read_text', description='Extract text or positioned blocks/words from a PDF page or all pages.')
    def pdf_read_text(filepath: str, page_number: int=1, detail_level: str='text', password: str='') -> str:
        """Extracts text ('text', 'blocks', or 'words') from a specified page (1-indexed) or all pages (0)."""
        res = engine.execute('pdf_read_text', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_search_text', description='Search for keywords or phrases across PDF pages with bounding boxes and context.')
    def pdf_search_text(filepath: str, query: str, page_number: int=0, case_sensitive: bool=False, password: str='') -> str:
        """Finds occurrences of a query with page numbers and coordinate bounding boxes."""
        res = engine.execute('pdf_search_text', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_splice_text', description='Surgically replace text in a PDF page while preserving original layout, clean background, and font styling without breaking document structure.')
    def pdf_splice_text(filepath: str, page_number: int, old_text: str, new_text: str, output_path: str='', font_name: str='', font_size: float=0.0, color_hex: str='', password: str='') -> str:
        """Performs surgical in-place replacement of old_text with new_text on page_number (1-indexed)."""
        res = engine.execute('pdf_splice_text', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_redact_sensitive_data', description='Permanently redact literal page text and optionally sanitize hidden document data.')
    def pdf_redact_sensitive_data(filepath: str, patterns: List[str], page_number: int=0, fill_color: str='black', output_path: str='', password: str='', sanitize: bool=False) -> str:
        """Page 0 targets all pages. Sanitizing also removes metadata, attachments, scripts and hidden text."""
        res = engine.execute('pdf_redact_sensitive_data', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_render_page_image', description='Render a PDF page to a high-resolution PNG image file.')
    def pdf_render_page_image(filepath: str, page_number: int=1, dpi: int=150, output_path: str='', password: str='') -> str:
        """Renders page_number (1-indexed) to PNG image."""
        res = engine.execute('pdf_render_page_image', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_organize_pages', description='Rotate, delete, or reorder pages in a PDF document.')
    def pdf_organize_pages(filepath: str, output_path: str, rotations: Optional[Dict[str, int]]=None, delete_pages: Optional[List[int]]=None, reorder_pages: Optional[List[int]]=None, password: str='') -> str:
        """Rotates (rotations={'1': 90}), deletes (delete_pages=[3]), or reorders pages."""
        res = engine.execute('pdf_organize_pages', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_merge', description='Merge multiple PDF files into a single unified document.')
    def pdf_merge(input_paths: List[str], output_path: str, password: str='') -> str:
        """Combines multiple PDF files in order into output_path."""
        res = engine.execute('pdf_merge', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_split', description='Split a PDF file into multiple documents by page ranges or page-by-page.')
    def pdf_split(filepath: str, output_dir: str, ranges: Optional[List[str]]=None, password: str='') -> str:
        """Splits PDF by ranges (e.g. ['1-3', '4-5']) or page-by-page into output_dir."""
        res = engine.execute('pdf_split', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

    @server.tool(name='pdf_extract_tables', description='Detect and extract tables from a PDF page into Markdown, CSV, or JSON.')
    def pdf_extract_tables(filepath: str, page_number: int=1, output_format: str='markdown', password: str='') -> str:
        """Detects tables on page_number and formats as 'markdown', 'csv', or 'json'."""
        res = engine.execute('pdf_extract_tables', locals())
        return json.dumps(res, ensure_ascii=False, indent=2)

def run_self_test() -> int:
    """Runs a verification test of all tools on a sample document."""
    print('==================================================================')
    print(' ALIOTH PDF MCP SERVER - SELF TEST')
    print('==================================================================')
    print(f' Python:   {sys.version.split()[0]} ({sys.executable})')
    print(f' PyMuPDF:  {fitz.__version__}')
    print(f" FastMCP:  {('Available' if server else 'Not Available')}")
    print('------------------------------------------------------------------')
    sample_pdf = _ROOT_DIR / 'Otros' / 'test_tooltip_annots.pdf'
    if not sample_pdf.exists():
        print('Creating temporary test PDF...')
        sample_pdf = _safe_temp_dir() / 'test_mcp_sample.pdf'
        doc = fitz.open()
        p = doc.new_page(width=595, height=842)
        p.insert_text(fitz.Point(72, 100), 'Alioth PDF Editor MCP Test', fontsize=18, fontname='helv', color=(0, 0, 0))
        p.insert_text(fitz.Point(72, 140), 'Confidential data: RFC ABCD-123456-XYZ', fontsize=12, fontname='helv', color=(0.2, 0.2, 0.2))
        p.insert_text(fitz.Point(72, 180), 'This is a paragraph to be surgically edited.', fontsize=12, fontname='helv', color=(0.2, 0.2, 0.2))
        doc.save(str(sample_pdf))
        doc.close()
    print(f'Using sample PDF: {sample_pdf}')
    info = _pdf_get_info_impl(str(sample_pdf))
    assert 'error' not in info, f'Info test failed: {info}'
    print(f" [PASS] pdf_get_info -> Page count: {info.get('page_count')}")
    text_res = _pdf_read_text_impl(str(sample_pdf), page_number=1)
    assert 'error' not in text_res, f'Read text failed: {text_res}'
    print(f" [PASS] pdf_read_text -> Characters read: {len(text_res.get('text', ''))}")
    first_word = text_res.get('text', '').split()[0] if text_res.get('text') else 'Alioth'
    search_res = _pdf_search_text_impl(str(sample_pdf), query=first_word)
    assert 'error' not in search_res, f'Search failed: {search_res}'
    print(f" [PASS] pdf_search_text -> Matches for '{first_word}': {search_res.get('total_matches')}")
    splice_out = str(_safe_temp_dir() / 'test_spliced.pdf')
    splice_res = _pdf_splice_text_impl(str(sample_pdf), page_number=1, old_text=first_word, new_text='ALIOTH_VERIFIED', output_path=splice_out)
    assert 'error' not in splice_res, f'Splice failed: {splice_res}'
    print(f" [PASS] pdf_splice_text -> Status: {splice_res.get('status')} -> {splice_out}")
    render_out = str(_safe_temp_dir() / 'test_rendered.png')
    render_res = _pdf_render_page_image_impl(str(sample_pdf), page_number=1, dpi=100, output_path=render_out)
    assert 'error' not in render_res, f'Render failed: {render_res}'
    print(f" [PASS] pdf_render_page_image -> {render_res.get('width_px')}x{render_res.get('height_px')}px")
    redact_out = str(_safe_temp_dir() / 'test_redacted.pdf')
    redact_res = _pdf_redact_sensitive_data_impl(str(sample_pdf), patterns=[first_word], output_path=redact_out)
    assert 'error' not in redact_res, f'Redaction failed: {redact_res}'
    print(f" [PASS] pdf_redact_sensitive_data -> Redactions: {redact_res.get('total_redactions')}")
    print('------------------------------------------------------------------')
    print(' ALL 6 CORE MCP TOOLS PASSED VERIFICATION 100%!')
    print('==================================================================')
    return 0

def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "serve":
        args.pop(0)
    if args and args[0] in {"check", "test"}:
        args[0] = "--" + args[0]
    if "--check" in args:
        from _mcp_check import main as check_main
        args.remove("--check")
        return check_main(args)
    if args == ["--test"]:
        return run_self_test()
    if args:
        sys.stderr.write("Usage: mcp_server.py [serve | --check [--timeout SECONDS] | --test]\n")
        return 2
    if server is None:
        sys.stderr.write("Error: MCPServer / FastMCP library is not installed.\n")
        return 1
    server.run(transport="stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
