# Alioth PDF Editor

Editor portable de PDF para Windows, de ALIOTH TDAH LABS. Versión 3.2.36.
Código propio: GNU AGPL-3.0-or-later. Consulta LICENSE y COPYING.

## Construcción pública

```powershell
python HERRAMIENTAS_DEV/bootstrap_build.py
```

El bootstrap verifica un archivo de insumos por SHA-256, restaura Python y
dependencias fijadas, y genera únicamente Distribución. Se puede usar sin red
con `--inputs C:\ruta\alioth-build-inputs-3.2.36.zip`.
Consulta [la documentación de construcción](HERRAMIENTAS_DEV/REPRODUCIBLE_BUILD.md)
y [el inventario de dependencias](DEPENDENCIAS.md).

La edición Personal, config.ini, preferencias, perfiles, API keys y claves
privadas permanecen fuera de la publicación. Los ejecutables se distribuyen
mediante Releases; no se guardan en el historial del código. Actions publica
exclusivamente el portable de Distribución como artefacto, sin claves de firma.

## Funciones

- Abrir, insertar, combinar, organizar y editar documentos PDF.
- Editar texto, imágenes, anotaciones y formularios; imprimir y exportar.
- OCR, conversión de Office y herramientas opcionales de IA con claves propias.
- Guardado nativo y conservación de la ruta del primer archivo abierto.

Algunas conversiones requieren Office u otro software compatible en el equipo.
Los servicios de IA reciben los datos necesarios solo al utilizar esas funciones.
Nunca publiques documentos ni credenciales personales al contribuir.

## Windows y firma

El portable comprueba una vez por usuario, certificado y ubicación la instalación
de su raíz de firma local y el registro como opción para abrir PDF. No fuerza
el visor predeterminado. Los rechazos de políticas se recuerdan. El aviso y las
instrucciones para retirar esta integración están dentro de
**About → Legal → Windows y firma local**.

La firma actual es propia; no confiere confianza pública de una autoridad
certificadora ni garantiza ausencia de alertas corporativas o de SmartScreen.
Las claves de firma permanecen en el almacén privado del mantenedor.

Las fuentes Microsoft se leen de Windows y no se redistribuyen. Si faltan se
utilizan fuentes libres Liberation, que pueden presentar diferencias visuales.
El monitor solo puede cerrar hosts propios huérfanos y sin ventana tras comprobar
su identidad y propietario.

Contacto: aliothgm@gmail.com.
