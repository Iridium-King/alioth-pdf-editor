# Construcción de Distribución 3.2.36

Windows x64 con .NET Framework 4.8 (compilación) y Python 3 (solo bootstrap).
WebView2 Runtime se necesita para ejecutar la app y las pruebas visuales.

```powershell
python HERRAMIENTAS_DEV/bootstrap_build.py
```

Para trabajar sin red, descarga previamente `alioth-build-inputs-3.2.36.zip`
y pasa `--inputs C:\ruta\alioth-build-inputs-3.2.36.zip`. El archivo se valida
contra `build-inputs.lock.json` antes de extraerlo: inventario exacto, tamaños,
SHA-256 de cada archivo y SHA-256 del archivo completo. No se ejecutan scripts
de instalación de dependencias. Todos los paquetes Python son wheels fijados
con hashes, instalados sin índice ni resolución de versiones nuevas.

Se restaura Python 3.14.5 x64, pip 26.1.2, Roslyn 4.14.0, referencias .NET 4.6.2,
WebView2 SDK 1.0.4258.31 y los recursos locales identificados por hash.
`requirements.lock` fija también las dependencias transitivas del entorno.
Los recursos de ejecución se conservan byte por byte para evitar actualizaciones
accidentales de los motores PDF/OCR. Las procedencias y avisos npm están en
`libs/third_party`; los de fuentes en `fonts/licenses`.

La salida pública es exclusivamente
`RELEASE/Distribucion/Alioth_PDF_Editor_Distribucion.exe`. La comprobación final
del archivo empaquetado rechaza configuración, preferencias, Personal, fuentes
Microsoft empaquetadas y contenedores de claves privadas. La raíz pública `.cer`
sí se incluye; no contiene una clave privada.

Se fija `SOURCE_DATE_EPOCH=1793836800`, `PYTHONHASHSEED=0` y se compila el host
con `/deterministic+` y `/pathmap`. Compara los SHA-256 **antes de firmar**:
Authenticode agrega información de firma y no forma parte de la comparación
de reproducibilidad. Los resultados de las dos construcciones limpias se
documentan en `REVISION_3.2.36.md`.

## Firma local del mantenedor

El CI no crea certificados ni recibe claves privadas. La firma se hace en el
equipo del mantenedor, usando su almacén privado de certificados de Windows.

```powershell
# Solo una vez; requiere PowerShell 7. No se ejecuta desde bootstrap ni CI.
./HERRAMIENTAS_DEV/create_local_signing_certificate.ps1
# La confianza de la raíz pública se gestiona con la integración de la app.
$env:ALIOTH_SIGN_LOCAL='1'
./.build-python/python.exe build_executables.py --edition both --release-dir ../salida-privada
./sign_release.ps1 -Edition both -ReleasePath ../salida-privada
```

`both` requiere deliberadamente un `config.ini` local para Personal. Nunca
subas esa edición, su configuración o los perfiles al repositorio ni a Actions.
La opción predeterminada siempre es Distribución. La clave propia se persiste
como no exportable; su pérdida exige emitir otro certificado. La vigencia usada
es 9999-12-31 23:59:59 UTC, máximo representable por el certificado X.509.
Una firma propia no proporciona confianza pública ni garantiza aceptación por
las políticas corporativas. El aviso y la retirada de la integración se explican
en About → Legal → Windows y firma local.

## Pruebas

```powershell
./.build-python/python.exe -m unittest discover -s HERRAMIENTAS_DEV/tests -p 'test_*.py'
node --test HERRAMIENTAS_DEV/tests/*.test.cjs HERRAMIENTAS_DEV/tests/regression.test.js
```

No se incluyen fuentes de Microsoft. Se leen las instaladas en Windows y,
cuando falten, se usan Liberation 2.1.5 (OFL) y Liberation Sans Narrow 1.07.6
(GPL con excepción de fuentes). Una alternativa no garantiza idénticos dibujos
a una fuente comercial ausente. En el equipo de referencia se comprueba que los
cuatro archivos de Arial Narrow de la barra son idénticos a los anteriores.
