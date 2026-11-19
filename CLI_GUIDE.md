# Alioth PDF: editor, CLI y MCP

El punto de entrada común del código fuente es `alioth.py`. Decide el modo
antes de cargar la interfaz: operaciones por comandos, servicio MCP o editor.
La CLI y MCP llaman las mismas operaciones de `_pdf_engine.py`; el editor
también reutiliza el motor para extraer texto de sus datos PDF.

Desde la versión 3.2.39, los ejecutables Personal y Distribución ofrecen los
mismos comandos PDF y MCP que la entrada de fuentes.

## Ejecutar desde código fuente

En PowerShell, desde la carpeta del proyecto:

```powershell
# Editor gráfico. También se puede pasar la ruta de un PDF.
& .\_python\python.exe .\alioth.py
& .\_python\python.exe .\alioth.py gui 'C:\Documentos\entrada.pdf'

# Ayuda y versión; no cargan la interfaz ni el SDK de MCP.
& .\_python\python.exe .\alioth.py --help
& .\_python\python.exe .\alioth.py --version

# Operaciones de archivos.
& .\_python\python.exe .\alioth.py info 'entrada.pdf' --json
& .\_python\python.exe .\alioth.py text 'entrada.pdf' --page 0
& .\_python\python.exe .\alioth.py search 'entrada.pdf' 'factura' --json
& .\_python\python.exe .\alioth.py replace 'entrada.pdf' 'Anterior' 'Nuevo' --page 1 -o 'editado.pdf' --json
& .\_python\python.exe .\alioth.py redact 'entrada.pdf' 'Dato privado' -o 'censurado.pdf' --json
& .\_python\python.exe .\alioth.py render 'entrada.pdf' --page 1 --dpi 150 -o 'pagina.png' --json
& .\_python\python.exe .\alioth.py organize 'entrada.pdf' --rotate 1:90 --order 2,1 -o 'ordenado.pdf' --json
& .\_python\python.exe .\alioth.py merge 'a.pdf' 'b.pdf' -o 'unido.pdf' --json
& .\_python\python.exe .\alioth.py split 'entrada.pdf' --ranges 1-3 4-6 -o '.\partes' --json
& .\_python\python.exe .\alioth.py tables 'entrada.pdf' --format csv
```

`pdf` es un prefijo opcional: `alioth.py pdf info entrada.pdf --json` equivale
a `alioth.py info entrada.pdf --json`. Usa `COMANDO --help` para ver sus opciones.
Las páginas empiezan en 1. En `text`, `search` y `redact`, 0 selecciona todas.
`--password` permite abrir entradas cifradas; no aparece en los resultados.

Las rutas relativas se resuelven desde el directorio de trabajo de quien llama
la CLI o MCP. Las operaciones de escritura rechazan usar un PDF de entrada como
destino. `replace`, `redact`, `organize` y `merge` requieren `-o`; `split`
requiere su directorio de salida. `render` puede omitir `-o` y devolverá la ruta
generada en `.mcp_artifacts` junto a la aplicación.

## Resultados para harnesses y scripts

Con `--json`, stdout contiene un objeto JSON por operación exitosa. Los errores
van exclusivamente a stderr como `{"error": "...", "code": "..."}`. Los códigos
de salida son 0 para éxito, 1 para errores de operación y 2 para argumentos
inválidos; una interrupción manual devuelve 130. `--json` puede ir antes del
comando o después de sus argumentos. Sin esa opción, `text` imprime texto y
`tables` imprime el formato solicitado; el resto muestra JSON con sangría.

Para sustituir la CLI por MCP no hace falta duplicar operaciones: ambos usan
el mismo motor. La CLI termina tras cada operación; `mcp serve` permanece
atendiendo mensajes del protocolo hasta que el cliente cierre stdin.

## MCP desde el mismo punto de entrada

```powershell
& .\_python\python.exe .\alioth.py mcp config
& .\_python\python.exe .\alioth.py mcp check --timeout 15
& .\_python\python.exe .\alioth.py mcp serve
```

`mcp config` imprime JSON con las rutas absolutas para configurar el harness.
`mcp check` comprueba una conexión real contra ese mismo punto de entrada.
`mcp serve` reserva stdout para el protocolo. No agregues `check` a la
configuración del harness: es un diagnóstico de terminal que termina al concluir.

Se mantienen `mcp_server.py` y `run_mcp_server.bat` como entradas de compatibilidad.
Consulta [MCP_GUIDE.md](MCP_GUIDE.md) para el transporte y sus restricciones.

## Ejecutar el portable en Windows

Extrae el ZIP completo y usa PowerShell desde la carpeta extraída. En los
ejemplos, la tubería conecta la salida del ejecutable gráfico a PowerShell.

```powershell
& .\Alioth_PDF_Editor_Distribucion.exe --version | Out-Host
& .\Alioth_PDF_Editor_Distribucion.exe info entrada.pdf --json | Out-Host
& .\Alioth_PDF_Editor_Distribucion.exe mcp config | Out-Host
& .\Alioth_PDF_Editor_Distribucion.exe mcp check --timeout 30 | Out-Host
```

El doble clic mantiene el editor. En Windows, los modos de automatización
recuperan la entrada y salida heredadas del harness o de la terminal. Para el
harness, configura la ruta absoluta al editor con los argumentos `mcp`, `serve`.

Las operaciones CLI/MCP de archivos no modifican automáticamente las pestañas
abiertas ni sus cambios sin guardar. La extracción GUI sigue trabajando sobre
los bytes actuales del documento y conserva el comportamiento de CropBox y
el respaldo de Poppler/PyMuPDF.
