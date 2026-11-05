# Guía de Conexión MCP (Model Context Protocol) para Alioth PDF Editor

El servidor MCP de **Alioth PDF Editor** permite que agentes inteligentes (**Google Antigravity**, **Claude Desktop**, **Cursor**, **Hermes**, **Codex**, **Muse**, **Grokbot**, etc.) inspeccionen, busquen, editen texto quirúrgicamente, censuren datos confidenciales y organicen documentos PDF de forma 100% automatizada.

---

## 🛠️ Herramientas MCP Disponibles

| Herramienta | Descripción | Parámetros Clave |
| :--- | :--- | :--- |
| `pdf_get_info` | Obtiene metadatos, conteo de páginas, dimensiones, cifrado e índice (TOC). | `filepath` |
| `pdf_read_text` | Extrae texto plano, bloques posicionados o palabras con bboxes. | `filepath`, `page_number` (1-indexed, o 0 para todas), `detail_level` ("text", "blocks", "words") |
| `pdf_search_text` | Busca frases o palabras clave y devuelve coordenadas exactas y contexto circundante. | `filepath`, `query`, `page_number`, `case_sensitive` |
| `pdf_splice_text` | **Edición quirúrgica:** Reemplaza texto in situ preservando tipografía, alineación y fondo original sin alterar el PDF. | `filepath`, `page_number`, `old_text`, `new_text`, `output_path`, `font_name`, `font_size` |
| `pdf_redact_sensitive_data` | Censura y remueve físicamente datos sensibles (RFC, tarjetas, teléfonos) con cuadro negro o blanco. | `filepath`, `patterns` (lista de textos/patrones), `page_number`, `fill_color`, `output_path` |
| `pdf_render_page_image` | Renderiza una página a imagen PNG de alta resolución (ideal para agentes con visión multimodal). | `filepath`, `page_number`, `dpi` (default 150), `output_path` |
| `pdf_organize_pages` | Rota páginas (90°, 180°, 270°), elimina páginas o reordena la secuencia de hojas. | `filepath`, `output_path`, `rotations`, `delete_pages`, `reorder_pages` |
| `pdf_merge` | Une múltiples archivos PDF en un solo documento continuo. | `input_paths`, `output_path` |
| `pdf_split` | Divide un PDF en varios archivos por rangos (ej. `["1-3", "4-6"]`) o página por página. | `filepath`, `output_dir`, `ranges` |
| `pdf_extract_tables` | Detecta tablas en la página y las extrae a formato Markdown, CSV o JSON. | `filepath`, `page_number`, `output_format` |

---

## ⚙️ Configuración para Agentes

### 1. Claude Desktop (`claude_desktop_config.json`)
Ruta en Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "alioth-pdf": {
      "command": "C:\\PDF TOOL\\_python\\python.exe",
      "args": [
        "C:\\PDF TOOL\\mcp_server.py"
      ]
    }
  }
}
```

---

### 2. Cursor (`Settings -> Features -> MCP`)
Añadir nuevo servidor MCP de tipo **command / stdio**:
* **Name:** `alioth-pdf`
* **Type:** `command`
* **Command:** `C:\PDF TOOL\_python\python.exe C:\PDF TOOL\mcp_server.py`

---

### 3. Google Antigravity / Gemini CLI
En el archivo de configuración de extensiones o plugins MCP:

```json
{
  "alioth_pdf_mcp": {
    "command": "C:\\PDF TOOL\\_python\\python.exe",
    "args": ["C:\\PDF TOOL\\mcp_server.py"]
  }
}
```

---

### 4. Codex / Hermes / Grokbot / Otros agentes CLI
Ejecutar mediante el script puente:
```bash
"C:\PDF TOOL\run_mcp_server.bat"
```
o directamente con el intérprete portable:
```bash
"C:\PDF TOOL\_python\python.exe" "C:\PDF TOOL\mcp_server.py"
```

---

## 🧪 Verificación Rápida
Para comprobar que todas las herramientas y dependencias funcionen al 100%:
```bash
"C:\PDF TOOL\run_mcp_server.bat" --test
```
Debe mostrar `ALL 6 CORE MCP TOOLS PASSED VERIFICATION 100%!`.
