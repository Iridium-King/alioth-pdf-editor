# Recursos externos pendientes de preparar para una compilación pública

Este primer repositorio publica las fuentes propias. No incluye los siguientes
recursos del entorno local. La aplicación no se reconstruye de forma completa
desde un clon hasta que se provean y documenten estos recursos.

| Recurso | Uso / estado |
| --- | --- |
| `_python/` | Intérprete y paquetes Python del entorno original. Dependencias directas en `HERRAMIENTAS_DEV/requirements.txt`; faltan lock completo y bootstrap. |
| `libs/*.js` | PDF.js y worker, pdf-lib, Dexie, jsPDF, Interact, Lucide, FileSaver, herramientas Office, OCR y códigos. Versiones/orígenes y licencias deben fijarse antes del CI. |
| `libs/python_engine/` | Pyodide y paquetes WASM. No incluidos en este repositorio inicial. |
| `libs/poppler/` | Herramientas y bibliotecas nativas. Mantener su licencia y las obligaciones de código fuente aplicables a la versión distribuida. |
| `fonts/fontkit.umd.min.js` | Bundle de fontkit; falta recuperar su fuente/versionado y el aviso de licencia correspondiente. |
| `fonts/*.woff2`, `fonts_cache/` | Fuentes no incluidas mientras se completa la revisión de procedencia y licencias. |
| `fonts/standard_fonts/` | Archivos Arial, Calibri, Segoe UI y otras fuentes de Windows. Su redistribución requiere derechos que no se presumen aquí. |
| SDK WebView2 1.0.4258.31 | Obtener del paquete oficial `Microsoft.Web.WebView2` en NuGet y conservar su licencia. |
| `native_host/bin/` | Artefactos generados, no fuentes. Se generan con `native_host/build.py`. |

`DEPENDENCIES_SNAPSHOT.json` identifica mediante SHA-256 los bundles JavaScript
presentes en el entorno original. Los hashes sirven como inventario de origen;
no sustituyen la licencia ni una URL de descarga verificada.

Antes de la primera release pública:

1. Fijar versiones y descargas oficiales, con hashes, de cada dependencia.
2. Resolver las fuentes sin retirar funciones ni alterar la apariencia por accidente.
3. Completar avisos y licencias de terceros y el código fuente correspondiente.
4. Construir en un agente Windows hospedado y ejecutar las pruebas.
5. Revisar los cambios de Windows de primer uso y su desinstalación.
6. Solicitar SignPath y configurar su política de firma si el proyecto es aceptado.

Referencias:

- [Condiciones de SignPath Foundation](https://signpath.org/terms)
- [Verificación del origen de compilación](https://docs.signpath.io/origin-verification/)
- [Integración de SignPath con GitHub](https://docs.signpath.io/trusted-build-systems/github)
- [Fuentes de Windows y redistribución](https://learn.microsoft.com/en-us/typography/fonts/font-faq)
