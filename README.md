# Alioth PDF Editor

Editor de PDF para Windows de ALIOTH TDAH LABS. Interfaz local en JavaScript,
servidor en Python y ventana nativa basada en Microsoft Edge WebView2.

Versión del código: **3.2.35**. Licencia del proyecto: **AGPL-3.0-or-later**.

## Estado de publicación

Este repositorio contiene el código fuente propio del proyecto. La preparación
de una compilación pública completa y la firma de código están en curso.
Todavía no se ofrecen descargas públicas verificadas ni ejecutables firmados.

La edición **Personal permanece privada**. Sólo la edición **Distribución**
se publicará como portable, una vez resueltos los requisitos de publicación.
Consulta `PUBLICACION.md` para las reglas de exclusión de secretos.

Los binarios de terceros, los archivos de fuentes y los runtimes no se incluyen
en esta primera publicación de código. Su obtención, versiones y licencias
deben terminar de documentarse antes de automatizar una versión pública.
Consulta `DEPENDENCIAS.md` y `DEPENDENCIES_SNAPSHOT.json`.

## Funciones

- Abrir, combinar, insertar y reorganizar páginas PDF.
- Editar texto, anotaciones y campos de formulario.
- Guardado nativo y conservación de la ruta de los archivos abiertos.
- OCR y conversión de documentos mediante componentes adicionales.
- Herramientas opcionales de IA y traducción con las claves del usuario.

Algunas conversiones dependen de Office u otros programas disponibles en el
equipo. Los proveedores de IA son servicios externos con sus propias condiciones.

## Arquitectura

| Ruta | Contenido |
| --- | --- |
| `BASE.html`, `js/`, `css/` | Interfaz y operaciones del editor |
| `_proxy.py` y módulos `_*.py` | Servidor local, archivos y servicios nativos |
| `native_host/` | Código del host WebView2 y su compilación |
| `build_executables.py` | Empaquetado con PyInstaller |
| `HERRAMIENTAS_DEV/tests/` | Pruebas automatizadas |

## Desarrollo

El entorno de referencia usa Windows x64, Python 3.14 y Node.js 25. Necesita
WebView2 Runtime y el compilador de .NET Framework para el host nativo.

Después de proporcionar los recursos descritos en `DEPENDENCIAS.md`, se puede
iniciar el servidor de desarrollo con:

```powershell
python -m pip install -r HERRAMIENTAS_DEV/requirements.txt
python _proxy.py --launch-browser
```

El empaquetador actual espera el intérprete en `_python/python.exe` y el SDK
WebView2 en `HERRAMIENTAS_DEV/webview2-sdk-1.0.4258.31.nupkg`. Estas rutas
corresponden al entorno original; el bootstrap reproducible está pendiente.

## Configuración y privacidad

No publiques `config.ini`, `preferences.json`, perfiles del navegador, registros,
documentos de usuarios, claves API ni certificados con clave privada.
Cada usuario configura sus claves desde Preferencias. La edición básica se
realiza localmente; al activar una función externa, se envían al proveedor
elegido los datos necesarios para esa operación.

## Cambios de Windows al iniciar

La versión 3.2.35 intenta, una vez por usuario, instalar la raíz local incluida
en el almacén del usuario actual y registrar Alioth para abrir PDF. No fuerza
el visor predeterminado. Guarda el resultado en
`%LOCALAPPDATA%/AliothPDFEditor/startup-integration.json`.

El monitor puede terminar hosts de Alioth sin ventana que se hayan quedado
huérfanos. Comprueba identidad, propietario y un margen de arranque de dos minutos.

La revisión del aviso previo y del procedimiento de desinstalación de estos
cambios es un pendiente para la distribución pública y la solicitud a SignPath.
Instalar una raíz local no proporciona una firma pública reconocida.

## Validación

La revisión local 3.2.35 pasó 356 pruebas JavaScript y 127 pruebas Python.
Las pruebas requieren las dependencias locales; no constituyen un workflow de
CI listo en un clon nuevo. Una prueba histórica adicional de conversión a Word
agotó la espera de COM en el entorno original.

## Licencia y contribuciones

El código propio se ofrece bajo AGPL-3.0-or-later. Consulta `LICENSE` y `COPYING`.
Las dependencias conservan sus licencias. No se incluye una licencia de
redistribución de fuentes comerciales por el hecho de utilizar Windows.

Antes de contribuir, evita incluir datos personales o secretos. Describe el
problema, la solución y las comprobaciones realizadas.

Contacto del proyecto: aliothgm@gmail.com.
