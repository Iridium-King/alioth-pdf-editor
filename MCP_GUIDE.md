# Guía de Conexión MCP (Model Context Protocol) para Alioth PDF Editor

El servidor MCP de **Alioth PDF Editor** permite inspeccionar, buscar, editar,
censurar y organizar archivos PDF desde un harness compatible con MCP por
**stdio**. Es un proceso separado del editor gráfico: trabaja con archivos en
disco y no controla la ventana ni los cambios todavía sin guardar del editor.

La entrada de fuentes es `alioth.py mcp serve`. A partir de la versión 3.2.39,
los ejecutables del editor también ofrecen `mcp serve`. La CLI y MCP reutilizan
las mismas operaciones del motor PDF. Consulta [CLI_GUIDE.md](CLI_GUIDE.md).

---

## 🛠️ Herramientas MCP Disponibles

| Herramienta | Descripción | Parámetros Clave |
| :--- | :--- | :--- |
| `pdf_get_info` | Obtiene metadatos, conteo de páginas, dimensiones, cifrado e índice (TOC). | `filepath` |
| `pdf_read_text` | Extrae texto plano, bloques posicionados o palabras con bboxes. | `filepath`, `page_number` (1-indexed, o 0 para todas), `detail_level` ("text", "blocks", "words") |
| `pdf_search_text` | Busca frases o palabras clave y devuelve coordenadas exactas y contexto circundante. | `filepath`, `query`, `page_number`, `case_sensitive` |
| `pdf_splice_text` | **Edición quirúrgica:** Reemplaza texto in situ preservando tipografía, alineación y fondo original sin alterar el PDF. | `filepath`, `page_number`, `old_text`, `new_text`, `output_path`, `font_name`, `font_size` |
| `pdf_redact_sensitive_data` | Elimina texto literal de página. Con `sanitize: true` también limpia metadatos, adjuntos, scripts y texto oculto. | `filepath`, `patterns`, `page_number`, `fill_color`, `output_path`, `sanitize` |
| `pdf_render_page_image` | Renderiza una página a imagen PNG de alta resolución (ideal para agentes con visión multimodal). | `filepath`, `page_number`, `dpi` (default 150), `output_path` |
| `pdf_organize_pages` | Rota páginas (90°, 180°, 270°), elimina páginas o reordena la secuencia de hojas. | `filepath`, `output_path`, `rotations`, `delete_pages`, `reorder_pages` |
| `pdf_merge` | Une múltiples archivos PDF en un solo documento continuo. | `input_paths`, `output_path` |
| `pdf_split` | Divide un PDF en varios archivos por rangos (ej. `["1-3", "4-6"]`) o página por página. | `filepath`, `output_dir`, `ranges` |
| `pdf_extract_tables` | Detecta tablas en la página y las extrae a formato Markdown, CSV o JSON. | `filepath`, `page_number`, `output_format` |

---

## ⚙️ Configuración para Agentes

### Entrada unificada desde las fuentes

Desde PowerShell, en la carpeta del proyecto:

```powershell
& .\_python\python.exe .\alioth.py mcp config
& .\_python\python.exe .\alioth.py mcp check --timeout 15
```

El primer comando imprime la configuración con rutas reales. En un harness
que usa `mcpServers`, corresponde a:

```json
{
  "mcpServers": {
    "alioth-pdf": {
      "command": "C:\\PDF TOOL\\_python\\python.exe",
      "args": ["C:\\PDF TOOL\\alioth.py", "mcp", "serve"]
    }
  }
}
```

Sustituye `C:\PDF TOOL` por la carpeta de fuentes. Si usas el portable del
editor, pon la ruta absoluta del ejecutable en `command` y usa
`["mcp", "serve"]` en `args`.

`mcp_server.py`, `--check`, `--test` y `run_mcp_server.bat` siguen disponibles
como entradas de compatibilidad para el servidor.

### Portable con servidor autónomo

Los paquetes actualizados de Personal y Distribución incluyen
`Alioth_PDF_MCP.exe` junto al editor. Extrae el ZIP completo. No requiere Python
instalado ni mantener esta carpeta de desarrollo en el equipo.

Configura el harness con la ruta absoluta al ejecutable MCP y sin argumentos:

```json
{
  "mcpServers": {
    "alioth-pdf": {
      "command": "C:\\CARPETA_EXTRAIDA\\Alioth_PDF_MCP.exe",
      "args": []
    }
  }
}
```

`MOSTRAR_CONFIG_MCP.cmd` muestra ese JSON con la ruta de la carpeta actual.
Para verificarlo desde PowerShell:

```powershell
.\run_mcp_server.bat --check
# O directamente:
.\Alioth_PDF_MCP.exe --check
```

El primer arranque del ejecutable puede tardar mientras se extraen sus
dependencias temporales. Para reconstruirlo desde las fuentes y dependencias
del proyecto: `_python\python.exe HERRAMIENTAS_DEV\build_mcp_portable.py`.

### Conexión local por stdio

El harness inicia el servidor como subproceso. No hay que abrir el editor ni
ejecutar el servidor manualmente antes. No se utiliza un puerto ni una URL MCP.

En los siguientes ejemplos, sustituye `C:\PDF TOOL` por la carpeta real del
proyecto, que debe contener `mcp_server.py` y `_python\python.exe`.

Para harnesses que usan un objeto JSON `mcpServers`:

```json
{
  "mcpServers": {
    "alioth-pdf": {
      "command": "C:\\PDF TOOL\\_python\\python.exe",
      "args": [
        "-u",
        "C:\\PDF TOOL\\mcp_server.py"
      ]
    }
  }
}
```

El contenedor de configuración y su ubicación dependen del harness. Si tiene un
formulario, selecciona `stdio` y coloca el ejecutable en **command** y cada
argumento por separado en **args**. No unas ambas rutas en el campo del ejecutable;
así también funcionan las carpetas con espacios. Usa rutas absolutas para los PDF.

El harness debe permitir lanzar procesos locales. Si corre en otra computadora,
contenedor o WSL, necesita un intérprete y archivos accesibles desde ese entorno.
Si solo admite servidores mediante URL, esta implementación requiere añadir
Streamable HTTP o un puente; no existe un endpoint HTTP configurado actualmente.

## Verificación de la conexión real

Desde PowerShell, en la carpeta del proyecto:

```powershell
.\run_mcp_server.bat --check
```

También puedes usar el intérprete directamente:

```powershell
& '.\_python\python.exe' '.\mcp_server.py' --check --timeout 15
```

La comprobación inicia un servidor nuevo desde otro directorio de trabajo,
intercambia `initialize` y `notifications/initialized`, comprueba las 10
herramientas mediante `tools/list`, llama `pdf_get_info` y `pdf_read_text` sobre
un PDF temporal con una ruta Unicode, y verifica el cierre al terminar stdin.
El documento temporal se elimina al finalizar. Debe terminar con código 0 y:

```text
MCP STDIO CONNECTION VERIFIED
```

`--check` es un diagnóstico de terminal: **no lo añadas a los argumentos del
harness**, porque imprime un informe y termina en lugar de servir MCP.

La prueba anterior `--test` sigue disponible para seis operaciones PDF internas;
no verifica el transporte MCP ni todas las herramientas.

### Si no responde a initialize

En Windows, asyncio crea una conexión interna de loopback para su bucle de
eventos, incluso si MCP utiliza exclusivamente stdin/stdout. Un sandbox que
bloquee esa conexión puede detener el arranque antes de procesar `initialize`.
Este caso se reprodujo con una traza en `socket._fallback_socketpair` al crear
`ProactorEventLoop`; fuera del sandbox, la conexión y las llamadas MCP pasaron.

Ejecuta `--check` desde una terminal normal y comprueba los permisos de procesos
locales/red interna del harness. Si la terminal pasa y el harness falla, compara
esas restricciones y las rutas configuradas. El diagnóstico tiene un límite de
tiempo y devuelve código 1 si falla. Los errores del servidor aparecen en stderr;
stdout se reserva para mensajes MCP durante el servicio normal.
