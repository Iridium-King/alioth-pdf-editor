# Política de publicación

- **Público:** código fuente propio sin secretos y, cuando se hayan resuelto los
  requisitos de distribución, únicamente `Alioth_PDF_Editor_Distribucion.exe`
  como archivo de una GitHub Release.
- **Privado:** edición Personal, su ejecutable, configuración personal, claves
  API, perfiles, documentos de usuarios, respaldos y cualquier clave privada de firma.
- No subir carpetas completas de ejecutables, ZIP de la edición Personal ni
  registros de compilación con secretos a Releases, Actions o Git LFS.
- Un certificado público `.cer` no contiene su clave privada. Los archivos
  `.pfx`, `.p12`, `.key`, claves PEM y otros almacenes de claves no se publican.
- Revisar el índice de Git antes de cada subida y el contenido del portable
  Distribución antes de adjuntarlo. `.gitignore` por sí solo no retira archivos
  ya agregados ni detecta secretos dentro de otros archivos.
- Si una credencial se publica por accidente, revocarla; borrar el archivo o
  hacer otro commit no invalida la credencial expuesta ni elimina su historial.

La instantánea inicial de este repositorio contiene sólo fuentes. No hay una
release pública ni firma concedida todavía.
