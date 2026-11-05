# Insumos fijados para la construcción

`HERRAMIENTAS_DEV/build-inputs.lock.json` contiene la lista exacta de archivos,
sus tamaños y SHA-256. Se conservan los motores locales existentes para evitar
cambios funcionales por actualizar bibliotecas durante esta revisión.

| Componente | Versión / fijación |
| --- | --- |
| Python x64 embebido | 3.14.5, python.org |
| pip | 26.1.2, wheel fijado por SHA-256 |
| Paquetes Python | 47 wheels, incluidas dependencias de construcción, fijados en requirements.lock |
| Compilador C# Roslyn | Microsoft.Net.Compilers.Toolset 4.14.0, NuGet |
| Referencias .NET | Microsoft.NETFramework.ReferenceAssemblies.net462 1.0.3, NuGet |
| SDK WebView2 | Microsoft.Web.WebView2 1.0.4258.31 |
| Motores JS, Pyodide y Poppler | Archivos existentes fijados individualmente por SHA-256 |
| Liberation | 2.1.5 (OFL), Sans Narrow 1.07.6 (GPL con excepción de fuentes) |
| Montserrat | Archivos WOFF2 existentes fijados por hash; licencia OFL incluida |
| Fuentes Microsoft | Excluidas del portable, insumos y repositorio; lectura del Windows del usuario |
| Caché de fuentes del usuario | Excluida de la construcción |

El archivo de insumos permite reconstruir sin buscar versiones nuevas en CDNs.
`libs/third_party/npm-origins.json` registra los paquetes consultados, sus licencias
y qué archivos coinciden byte por byte. Las entradas sin coincidencia no afirman
identificar la versión de un bundle local: el hash del inventario es su identidad
de construcción. Los originales se mantienen, sin sustituir bibliotecas durante
esta revisión. Conserva los avisos incluidos con los componentes.

El bootstrap nunca crea certificados, instala la integración de Windows ni abre
la aplicación. La firma local se realiza después de verificar el resultado.
Consulta HERRAMIENTAS_DEV/REPRODUCIBLE_BUILD.md para uso y pruebas.
