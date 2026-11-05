import subprocess
import tempfile
from pathlib import Path

PDF_TEXT_LIMIT = 64 * 1024 * 1024


def _poppler_pages(executable, filename, first, last):
    result = subprocess.run(
        [str(executable), '-enc', 'UTF-8', '-eol', 'unix', '-remove-hyphens', 'none',
         '-f', str(first + 1), '-l', str(last + 1), str(filename), '-'],
        capture_output=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode or len(result.stdout) > PDF_TEXT_LIMIT:
        raise ValueError('PDF_TEXT_EXTRACTION_FAILED')
    pages = result.stdout.decode('utf-8').split('\f')
    if pages and not pages[-1].strip():
        pages.pop()
    if len(pages) != last - first + 1:
        raise ValueError('PDF_TEXT_PAGE_MISMATCH')
    return [text.strip() for text in pages]


def extract_pdf_text(pdf, page_indices=None, resource_dir=None):
    import fitz

    if not pdf or len(pdf) > PDF_TEXT_LIMIT:
        raise ValueError('INVALID_PDF_TEXT_SOURCE')
    executable = Path(resource_dir or Path(__file__).parent) / 'libs/poppler/Library/bin/pdftotext.exe'
    with fitz.open(stream=pdf, filetype='pdf') as document:
        if document.needs_pass:
            raise ValueError('PDF_TEXT_PASSWORD_REQUIRED')
        indices = list(range(len(document))) if page_indices is None else page_indices
        if (not isinstance(indices, list) or len(indices) > 2000 or
                any(type(i) is not int or not 0 <= i < len(document) for i in indices)):
            raise ValueError('INVALID_PDF_TEXT_PAGES')
        result = []
        with tempfile.TemporaryDirectory(prefix='alioth_text_') as directory:
            filename = Path(directory) / 'source.pdf'
            available = executable.is_file()
            if available:
                filename.write_bytes(pdf)
            position = 0
            while position < len(indices):
                index = indices[position]
                page = document[index]
                # Plain pdftotext ignores CropBox; keep the established crop-aware engine.
                cropped = page.cropbox != page.mediabox
                end = position
                if available and not cropped:
                    while (end + 1 < len(indices) and indices[end + 1] == indices[end] + 1 and
                           document[indices[end + 1]].cropbox == document[indices[end + 1]].mediabox):
                        end += 1
                texts = None
                if available and not cropped:
                    try:
                        texts = _poppler_pages(executable, filename, index, indices[end])
                    except (OSError, subprocess.SubprocessError, ValueError, UnicodeError):
                        available = False
                for offset, pno in enumerate(indices[position:end + 1]):
                    text = texts[offset] if texts is not None else ''
                    engine = 'poppler' if texts is not None else 'pymupdf'
                    if texts is None or not text:
                        fallback = document[pno].get_text(
                            'text', flags=fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE,
                            sort=True,
                        ).strip()
                        if texts is None or fallback:
                            text, engine = fallback, 'pymupdf'
                    result.append({'page': pno + 1, 'total': len(document), 'text': text,
                                   'hasText': bool(text), 'engine': engine})
                position = end + 1
        return result
