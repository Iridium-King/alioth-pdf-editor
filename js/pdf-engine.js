/* Local editor adapter for the PDF engine shared with CLI and MCP.
 * extractText receives the current document bytes; fileTool operates on disk.
 */
(function (scope) {
    'use strict';
    const fileTools = Object.freeze([
        'pdf_get_info', 'pdf_read_text', 'pdf_search_text', 'pdf_splice_text',
        'pdf_redact_sensitive_data', 'pdf_render_page_image', 'pdf_organize_pages',
        'pdf_merge', 'pdf_split', 'pdf_extract_tables'
    ]);

    async function request(endpoint, payload, options = {}) {
        const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: options.signal || AbortSignal.timeout(options.timeout || 45000)
        });
        let result;
        try { result = await response.json(); } catch (_) { result = null; }
        if (!response.ok || !result?.ok) {
            const code = typeof result?.error === 'string' ? result.error : 'PDF_ENGINE_REQUEST_FAILED';
            const error = new Error(code);
            error.status = response.status;
            error.code = result?.code || code;
            throw error;
        }
        return result;
    }

    scope.AliothPDFEngine = Object.freeze({
        fileTools,
        extractText(pdfBase64, pageIndices = null, options = {}) {
            return request('/api/pdf/text', { pdfBase64, pageIndices }, options);
        },
        async fileTool(operation, args, options = {}) {
            if (!fileTools.includes(operation)) throw new Error('INVALID_PDF_TOOL_OPERATION');
            const response = await request('/api/pdf-tools', { operation, arguments: args }, options);
            return response.result;
        }
    });
})(window);
