# Revisión 3.2.36 — 2026-11-05

- Las fuentes comerciales de Windows dejan de empaquetarse. El servidor resuelve
  sus URLs originales desde las fuentes instaladas y utiliza los mismos bytes para
  CSS, métricas y exportación. Liberation ofrece alternativas sin instalar fuentes.
- WebView2 comprobó 54 entradas de fuentes, cuatro variantes idénticas de Arial
  Narrow para la barra, y exportación con fuentes instaladas y alternativas libres.
  El PDF exportado conserva acentos, ñ y €. Una fuente ausente puede tener un
  aspecto distinto al usar una alternativa; no se promete equivalencia visual universal.
- About / Legal / Windows y firma local contiene el aviso de primera apertura,
  las limitaciones de la firma propia y la retirada de certificado y registro.
- ICONOS/OTROS se retiró del proyecto, del código público y de los nuevos portables.
  No existían referencias de ejecución. Copia de seguridad privada fuera de los insumos.
- Bootstrap exclusivo de Distribución, 47 wheels fijados por versión y SHA-256,
  Python 3.14.5, pip 26.1.2, Roslyn 4.14.0, .NET refs 4.6.2, WebView2 SDK 1.0.4258.31.
- Dos construcciones sin firma en directorios limpios independientes produjeron
  exactamente el mismo SHA-256: `fccfe3a44b32989be745cc2e180e2a7aa41818c3464732d70a076c2e9e319412`.
  Host sin firma: `4cfa5e6a5793a1e2f133a6f240d5f2d9ffef5a1360c6f0a3aec17e5623005824`.
  La comparación excluye Authenticode, aplicado después de construir.
- Certificado propio dedicado, RSA 4096 / SHA-256, vigencia máxima hasta
  9999-12-31 23:59:59 UTC. Claves persistidas como no exportables en el almacén
  privado del usuario mantenedor. El CI y los insumos no contienen claves privadas.
  Windows verificó ambos portables y sus hosts internos como Valid en el equipo
  que confía en la raíz local. Eso no proporciona confianza pública ni garantiza
  aceptación por otras políticas de seguridad.
- Firma del editor: `D97FA8CB99A65AF4A49A1C9C8B8217A6E0D4DA5B`.
  Raíz pública: `E0EDA3EEED9D02009630A88795A73E3E3E5C73B7`.
- Distribución firmada: 114138944 bytes, SHA-256
  `eb5181d81a4d44280560ba091bf899b1f8c6b3011f1fc338e2af6c254d873923`.
- 356 pruebas JavaScript y 133 Python pasaron. La prueba nativa confirmó apertura
  por drop, ruta original tras insertar otro PDF, Guardar sobre el original,
  Guardar como con su carpeta de origen y botón verde, pausa de 17 segundos sin
  recarga ni pérdida de cambios, y ausencia de diálogos de recuperación indebidos.
- Inspección del ejecutable: 44 activos coinciden con las fuentes revisadas y los
  módulos backend con el código compilado. Distribución excluye config.ini,
  preferencias, claves privadas, fuentes Microsoft, caché de fuentes del usuario,
  host QA y OTROS. Comparación con las credenciales configuradas: cero coincidencias.

La prueba histórica de conversión a Word que agotó su espera de COM en la revisión
anterior no se modificó ni se incluye como validación resuelta en esta revisión.
