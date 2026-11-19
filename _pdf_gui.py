"""Validate file-based requests from the local editor before using the shared engine.

The editor's in-memory document is separate: this adapter only works on explicit
files, while /api/pdf/text continues to extract the bytes supplied by the editor.
"""

import os
from pathlib import Path


PDF_TOOL_REQUEST_LIMIT = 64 * 1024
FILE_TOOLS = frozenset({
    'pdf_get_info', 'pdf_read_text', 'pdf_search_text', 'pdf_splice_text',
    'pdf_redact_sensitive_data', 'pdf_render_page_image', 'pdf_organize_pages',
    'pdf_merge', 'pdf_split', 'pdf_extract_tables',
})


def execute_file_tool(payload, is_safe_path):
    """Return the same result dictionary as CLI/MCP, without loading either UI or SDK."""
    if not isinstance(payload, dict) or set(payload) != {'operation', 'arguments'}:
        raise ValueError('INVALID_PDF_TOOL_REQUEST')
    operation, arguments = payload['operation'], payload['arguments']
    if not isinstance(operation, str) or operation not in FILE_TOOLS:
        raise ValueError('INVALID_PDF_TOOL_OPERATION')
    if not isinstance(arguments, dict):
        raise ValueError('INVALID_PDF_TOOL_ARGUMENTS')

    def path(value, suffix=None):
        if (not isinstance(value, str) or not value or len(value) > 32767
                or '\0' in value or not os.path.isabs(value)
                or suffix is not None and Path(value).suffix.lower() != suffix
                or not is_safe_path(value)):
            raise ValueError('INVALID_PDF_TOOL_PATH')

    if 'filepath' in arguments:
        path(arguments['filepath'], '.pdf')
    if 'input_paths' in arguments:
        paths = arguments['input_paths']
        if not isinstance(paths, list) or not 2 <= len(paths) <= 1000:
            raise ValueError('INVALID_PDF_TOOL_PATHS')
        for value in paths:
            path(value, '.pdf')
    if arguments.get('output_path'):
        path(arguments['output_path'], '.png' if operation == 'pdf_render_page_image' else '.pdf')
    if 'output_dir' in arguments:
        path(arguments['output_dir'])

    from _pdf_engine import execute, TOOL_HANDLERS
    if operation not in TOOL_HANDLERS:
        raise ValueError('INVALID_PDF_TOOL_OPERATION')
    result = dict(execute(operation, dict(arguments)))
    # Tracebacks belong in local diagnostics, never in an HTTP response.
    result.pop('trace', None)
    return result
