const ALIOTH_VERSION = '3.2.35';
        window.ALIOTH_VERSION = ALIOTH_VERSION;
        const ALIOTH_CHANGELOG = [
            {
                version: '3.2.35',
                date: '2026-11-04',
                items: [
                    { type: 'improve', text: '<strong>Primera apertura:</strong> Validación e instalación del certificado y registro PDF una sola vez por usuario. Un cambio de ubicación actualiza el registro; los permisos denegados no se reintentan en cada arranque.' },
                    { type: 'fix', text: '<strong>Procesos huérfanos:</strong> Limpieza automática de hosts de Alioth sin ventana, verificando PID, ruta, fecha de creación y propietario. Las ventanas abiertas o minimizadas se conservan.' }
                ]
            },
            {
                version: '3.2.34',
                date: '2026-11-04',
                items: [
                    { type: 'fix', text: '<strong>Vista ocupada:</strong> Espera la respuesta de WebView2 y conserva los cambios en memoria cuando la vista se recupera, sin recargarla automáticamente.' },
                    { type: 'fix', text: '<strong>Arrastrar y soltar:</strong> Obtiene la ruta nativa del archivo para Guardar y Guardar como, conservando el origen del documento al insertar otros archivos.' },
                    { type: 'improve', text: '<strong>Guardar como:</strong> Icono y detalle verde para distinguirlo de Guardar.' },
                    { type: 'improve', text: '<strong>Arranque:</strong> Bytes de fuentes bajo demanda, sin instalar certificados ni registrar asociaciones automáticamente y sin terminar procesos al abrir desde el lanzador.' }
                ]
            },
            {
                version: '3.2.33',
                date: '2026-10-22',
                items: [
                    { type: 'fix', text: '<strong>Reapertura del portable:</strong> El servidor activo mantiene las nuevas ventanas y sus archivos temporales. Se evita el cierre del servidor durante una reapertura o mientras una ventana siga activa.' }
                ]
            },
            {
                version: '3.2.32',
                date: '2026-10-21',
                items: [
                    { type: 'improve', text: '<strong>Paneles de la sidebar:</strong> Cinco accesos horizontales bajo la navegación de páginas, con indicador del panel activo y el icono de clip para Adjuntos. Se ocultan al contraer la sidebar.' },
                    { type: 'fix', text: '<strong>Contador de páginas:</strong> La cápsula se ajusta a su contenido en lugar de estirarse. Cuando la sidebar es estrecha, muestra solo el total de páginas sin cortar el número.' }
                ]
            },
            {
                version: '3.2.31',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Abrir archivo:</strong> El selector de Windows aparece alineado al borde derecho de la app, dentro del área visible del monitor, conservando su diseño y tamaño.' },
                    { type: 'improve', text: '<strong>Pestaña lateral:</strong> Ancho reducido y curvatura equivalente a la pestaña del ribbon.' }
                ]
            },
            {
                version: '3.2.30',
                date: '2026-10-21',
                items: [
                    { type: 'improve', text: '<strong>Botón IA:</strong> Sin borde exterior y con un trazo más fino en la cara y el guiño.' }
                ]
            },
            {
                version: '3.2.29',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Zoom y Lectura:</strong> Se elimina el fondo, borde y padding exterior del zoom. Lectura se ajusta al ancho visible de las dos columnas, conservando sus transparencias y controles.' },
                    { type: 'fix', text: '<strong>Ribbon compacto:</strong> Tipografía estrecha exclusiva de la interfaz, precargada desde los archivos locales para conservar el ancho compacto sin depender de la sincronización de fuentes del sistema.' },
                    { type: 'improve', text: '<strong>Botón IA:</strong> Adopta el color del header de cada tema, con la cara blanca y el guiño ocasional.' }
                ]
            },
            {
                version: '3.2.28',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Ribbon al iniciar:</strong> La disposición compacta y la traducción de sus etiquetas se aplican antes de cargar los módulos del editor para evitar el reajuste tardío del ancho.' },
                    { type: 'improve', text: '<strong>Botón IA:</strong> Posición vertical fija, ancho reducido un 15 % y altura un 10 %. Adopta los colores del tema, conserva la cara y el guiño ocasional y elimina el fondo animado.' },
                    { type: 'fix', text: '<strong>Dimensiones de controles:</strong> Lectura comparte los bordes horizontales del widget de zoom y Cerrar tiene la misma altura que los botones de archivo, también en modo lectura.' }
                ]
            },
            {
                version: '3.2.27',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Ribbon estable:</strong> Sus controles usan una fuente local independiente para evitar cambios de ancho al sincronizar las fuentes del sistema después del inicio.' },
                    { type: 'fix', text: '<strong>Separación de Cerrar:</strong> El espacio entre Guardar como y Cerrar también es de 14 px.' }
                ]
            },
            {
                version: '3.2.26',
                date: '2026-10-21',
                items: [
                    { type: 'improve', text: '<strong>Separación de botones:</strong> Se duplica de 7 a 14 px el espacio entre Recientes, Abrir, Guardar y Guardar como, conservando sus tamaños en modo normal y lectura.' }
                ]
            },
            {
                version: '3.2.25',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Inicio sin documentos:</strong> La aplicación siempre comienza con una pestaña vacía, aunque se haya cerrado con archivos abiertos. Conserva las preferencias y el modo lectura. La apertura explícita de archivos y la transferencia de pestañas siguen funcionando.' }
                ]
            },
            {
                version: '3.2.24',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Restauración de sesión:</strong> Al abrir la aplicación solo se recuperan las pestañas de la sesión guardada. Un historial en caché o un panel oculto antiguo ya no provoca la apertura de otro archivo cuando la sesión está vacía o no existe.' }
                ]
            },
            {
                version: '3.2.23',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Guardado seguro:</strong> Espera las ediciones de texto pendientes, protege frente a escrituras simultáneas y renueva las autorizaciones vencidas sin ignorar cambios externos.' },
                    { type: 'fix', text: '<strong>Sesión y conexiones:</strong> Restaura las pestañas guardadas, conserva los datos ante errores de escritura y corrige la reconexión entre ventanas.' },
                    { type: 'improve', text: '<strong>Uso de recursos:</strong> Carga diferida de los PDF restaurados, almacenamiento binario sin conversiones repetidas, límites de miniaturas e historial, liberación de lienzos fuera de pantalla y limpieza de temporales y transferencias. Las animaciones decorativas del botón IA se activan al interactuar para reducir el consumo en reposo.' },
                    { type: 'fix', text: '<strong>Notas de traducción:</strong> El PDF exportado conserva el texto original junto a la traducción.' }
                ]
            },
            {
                version: '3.2.22',
                date: '2026-10-21',
                items: [
                    { type: 'new', text: '<strong>Ventana WebView2:</strong> Pestañas integradas en la barra de título, con controles de minimizar, maximizar, restaurar y cerrar alineados y con iconos SVG uniformes.' },
                    { type: 'fix', text: '<strong>Recuperación del Contenedor:</strong> Los fallos de la vista muestran controles nativos para reintentar o cerrar. Si el guardado no responde al cerrar, se puede esperar o cancelar; recargar o forzar el cierre requiere una decisión explícita. El arranque tampoco cambia silenciosamente a los datos de la interfaz anterior.' },
                    { type: 'improve', text: '<strong>Navegación de Pestañas:</strong> Flechas a ambos lados de la barra para desplazar las pestañas de documentos horizontalmente sin cambiar el documento activo.' },
                    { type: 'improve', text: '<strong>Cabecera Compacta:</strong> Separación de 7 px entre Recientes, Abrir, Guardar, Guardar como y Cerrar. Los contenedores de archivo se reducen en 2 px tanto en modo normal como en lectura, conservando sus iconos.' },
                    { type: 'fix', text: '<strong>Controles Flotantes:</strong> Las flechas de navegación permanecen centradas junto al botón de IA y respetan el ribbon, los toggles y los widgets de lectura y zoom. El widget de toggles conserva su transparencia y se oscurece al pasar el cursor.' },
                    { type: 'fix', text: '<strong>Conservación de Datos Locales:</strong> La transferencia a WebView2 conserva los datos y preferencias, respalda los registros vacíos que no pueden copiarse directamente y no se repite después de completarse.' }
                ]
            },
            {
                version: '3.2.21',
                date: '2026-10-21',
                items: [
                    { type: 'improve', text: '<strong>Tema Original:</strong> La apariencia de Nordic Better se integra como tema predeterminado.' },
                    { type: 'improve', text: '<strong>Paneles y Herramientas:</strong> Pestañas de panel más delgadas junto al borde izquierdo, ocultas al contraer la barra lateral. Los toggles de vista se agrupan bajo el ribbon y los controles de tema y configuración quedan junto a Buscar funciones.' },
                    { type: 'improve', text: '<strong>Modo Lectura:</strong> Barra de título y cabecera compactas, mini ribbon con desplazamiento automático y widget de toggles oculto. El botón Lectura adopta el ancho del zoom y mantiene su transparencia.' },
                    { type: 'fix', text: '<strong>Preferencias y Búsqueda:</strong> El modo lectura y la disposición elegida se conservan al reabrir. La búsqueda admite palabras sin acentos y mantiene la distinción de la ñ.' }
                ]
            },
            {
                version: '3.2.20',
                date: '2026-10-21',
                items: [
                    { type: 'fix', text: '<strong>Acerca de en la Pestaña Activa:</strong> Su acceso se muestra cuando la pestaña activa está vacía y se oculta al visualizar un documento, aunque existan otras pestañas abiertas.' }
                ]
            },
            {
                version: '3.2.19',
                date: '2026-10-19',
                items: [
                    { type: 'feature', text: '<strong>Aislamiento Total de Ajustes Finos (Modo Claro vs Oscuro):</strong> Desacoplamiento completo de los 5 toggles del Ajuste Fino (iconos en blanco, bordes en grupos, barra lateral como cabecera, efecto cristal e invertir colores) y la paleta de colores. Cada modo guarda y aplica sus preferencias de forma independiente sin filtraciones.' },
                    { type: 'feature', text: '<strong>Actualizar y Guardar Temas Segregado:</strong> El botón «Actualizar tema» persiste exclusivamente los valores del modo activo (claro u oscuro). Soporte para guardar temas personalizados con perfiles independientes y reordenamiento de favoritos mediante arrastrar y soltar.' },
                    { type: 'improve', text: '<strong>Botón Redondo de Cierre en Preferencias:</strong> Se sustituyó el botón rectangular de la barra lateral por un botón circular «✕» estándar en la esquina superior derecha con microinteracción hover.' },
                    { type: 'improve', text: '<strong>Nuevos Temas de Alta Fidelidad:</strong> Incorporación de los temas Obsidian OLED, Nordic Slate y Emerald Forest en sustitución de Carbón, Carmesí y Ámbar.' }
                ]
            },
            {
                version: '3.2.18',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Reorganización de Controles en Modal de Impresión:</strong> Se reubicó el botón de cierre en la esquina superior derecha del modal (con clase estándar <code>.modal-close-btn-round</code> e ícono outline SVG), eliminándolo del encabezado de la columna izquierda. Los controles de zoom de vista previa se trasladaron junto al rótulo de «Vista previa» en la cabecera de la sección derecha, garantizando una disposición intuitiva, simétrica y despejada.' }
                ]
            },
            {
                version: '3.2.17',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Mayor Altura y Legibilidad en Desplegable de Estilo de Modales de Propiedades:</strong> Se incrementó la altura (32px), espacio interno y tamaño de tipografía (12px) de la lista desplegable de estilo de borde y forma en los modales de propiedades de campo (<code>#prop-border-style</code> y <code>#modalShapeStrokeDash</code>), eliminando el recorte vertical del texto y permitiendo visualizar las opciones seleccionadas (como "Sin Borde", "Punteado", etc.) con total claridad.' }
                ]
            },
            {
                version: '3.2.16',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Eliminación de Botón de Cierre Duplicado en Galería de Temas:</strong> Se corrigió la duplicación de botones de cierre en la esquina superior derecha del modal de temas (<code>#theme-modal</code>), integrando un único botón estilizado con clase estándar <code>.modal-close-btn-round</code> e ícono outline SVG.' }
                ]
            },
            {
                version: '3.2.15',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Transparencia Real en Cápsula de Búsqueda (Idéntica a Zoom):</strong> Se eliminó el desenfoque de fondo que opacaba el texto subyacente y se configuró un fondo ultra-translúcido puro (<code>rgba(30, 30, 45, 0.20)</code>) que permite leer con total claridad el documento debajo, manteniendo la lupa en blanco puro nítido. Se actualizó además el parámetro de control de caché en la carga de <code>app.css</code>.' }
                ]
            },
            {
                version: '3.2.14',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Mayor Transparencia en Fondo de Cápsula de Búsqueda:</strong> Se incrementó la translucidez del fondo de la cápsula (<code>rgba(30, 30, 45, 0.25)</code>) para igualar exactamente la ligereza visual de la cápsula de zoom, dejando ver las líneas y texto del documento detrás mientras la lupa blanca (<code>#ffffff</code> con sombreado de realce) permanece nítida y clara.' }
                ]
            },
            {
                version: '3.2.13',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Lupa de Búsqueda Clara y Nítida:</strong> Se garantizó un contraste óptimo y máxima legibilidad en el ícono de la lupa (color blanco puro <code>#ffffff</code>, trazo reforzado de 2.3px y sombreado sutil <code>drop-shadow</code>) sobre el fondo translúcido, eliminando el desvanecimiento excesivo sobre páginas en blanco.' },
                    { type: 'improve', text: '<strong>Color en Íconos de Modo Oscuro y Modo Claro:</strong> Se colorearon los íconos de alternancia de tema: sol radiante en ámbar dorado cálido (<code>#f59e0b</code> con núcleo translúcido) y luna creciente en índigo celeste brillante (<code>#818cf8</code>) con efectos de resplandor luminiscente al pasar el cursor.' }
                ]
            },
            {
                version: '3.2.12',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Paridad de Transparencia con Cápsula de Zoom:</strong> Se unificó la transparencia y comportamiento visual del widget flotante de búsqueda con la cápsula de zoom y modo lectura (opacidad en reposo del 25% con transición suave al 100% en hover y foco <code>:focus-within</code>, y fondo idéntico de vidrio translúcido con desenfoque <code>backdrop-filter</code>).' }
                ]
            },
            {
                version: '3.2.11',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Transparencia Glassmorphism en Búsqueda Flotante:</strong> Se aplicó translucidez al widget de búsqueda extendido (<code>rgba(15, 23, 42, 0.72)</code> con desenfoque de fondo <code>backdrop-filter</code>) para permitir apreciar el texto del documento debajo sin obstrucción visual.' },
                    { type: 'improve', text: '<strong>Cierre Automático al Hacer Clic Fuera:</strong> Ahora el widget de búsqueda extendido se repliega automáticamente a su cápsula discreta al hacer clic o tocar en cualquier punto fuera de él, incluso si contiene texto ingresado.' }
                ]
            },
            {
                version: '3.2.10',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Ajuste de Dimensiones en Widget de Búsqueda Flotante:</strong> Se amplió el ancho desplegado del widget (a 355px) y se aseguró la propiedad incompresible (<code>flex-shrink: 0</code>) para todos los botones de acción (anterior, siguiente, borrar, cerrar) y el badge de coincidencias. Se eliminó cualquier recorte o corte lateral derecho, garantizando márgenes y visualización íntegra de todos los controles.' }
                ]
            },
            {
                version: '3.2.9',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Buscador de Funciones en Encabezado:</strong> Se renombró el botón de la paleta de comandos de «Ctrl+K» a «Buscar funciones» (con tooltip de atajo) para facilitar su descubrimiento y uso intuitivo.' },
                    { type: 'improve', text: '<strong>Estilo Visual del Widget de Búsqueda Extendido:</strong> Se rediseñó el panel de búsqueda desplegado para que adopte la apariencia estética de los modales de la aplicación (glassmorphism esmerilado profundo, bordes y foco sutiles, badge contador de coincidencias y controles estilizados).' },
                    { type: 'improve', text: '<strong>Reemplazo Universal de Iconos 3D y Emojis por Iconos Outline:</strong> Se sustituyeron todos los emojis del sistema con aspecto 3D por iconos vectoriales outline monocromáticos (trazo limpio de 2px) en toda la interfaz: ventana Acerca de (categorías del changelog, filtros y controles), panel TTS (filtros de voz, clave API y scopes), efectos y reflejos de imágenes, propiedades de figuras y dibujo, galería de temas, atajos y administración de claves API.' }
                ]
            },
            {
                version: '3.2.8',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Regresión de Layout y Tamaños Originales:</strong> Se restauraron los toggles de vista y herramientas a su ubicación original en la barra de pestañas superior derecha con sus dimensiones estándar (22px). Se reintegraron los botones Deshacer, Rehacer e Imprimir al encabezado superior principal con sus tamaños originales.' },
                    { type: 'improve', text: '<strong>Widget de Búsqueda 25% Más Discreto:</strong> Se redujo en un 25% el tamaño de la cápsula y barra flotante de búsqueda (27px de alto, 270px expandida), manteniendo su transparencia al reposo, oscurecimiento al hover y escritura en texto negro.' }
                ]
            },
            {
                version: '3.2.7',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Toggles de Vista un 10% Más Compactos:</strong> Se redujo el tamaño de todos los botones de alternancia en la barra superior a 20px (con iconos ajustados a 12.5px) para mayor ligereza visual y óptima distribución espacial.' },
                    { type: 'improve', text: '<strong>Widget de Búsqueda Flotante Transparente:</strong> La cápsula de búsqueda colapsada ahora es translúcida/transparente por defecto para no tapar el texto del documento debajo, oscureciéndose de forma suave al pasar el mouse por encima.' },
                    { type: 'fix', text: '<strong>Alineación del Botón de Modo Lectura:</strong> Se sincronizó la posición lateral derecha (<code>right: 6px</code>) del widget flotante de Lectura con la cápsula de zoom y el desplazamiento automático para una alineación vertical perfecta en el margen.' },
                    { type: 'fix', text: '<strong>Color de Texto en Input de Búsqueda:</strong> El texto ingresado al buscar ahora se renderiza nítidamente en color negro sobre fondo blanco estructurado.' }
                ]
            },
            {
                version: '3.2.6',
                date: '2026-10-18',
                items: [
                    { type: 'new', text: '<strong>Pestaña de Ayuda en Configuración General:</strong> Se añadió la pestaña «Ayuda» dentro de Preferencias con guías interactivas, tutoriales paso a paso de edición, atajos de productividad, seguridad, IA y buscador de temas en vivo.' },
                    { type: 'new', text: '<strong>Gestor de Atajos Personalizables y Sincronización Ctrl+K:</strong> Módulo de configuración de teclas con atajos clásicos populares estilo Excel y Adobe Acrobat (<code>Ctrl+B</code> para negrita, <code>Ctrl+I</code> cursiva, <code>Ctrl+U</code> subrayado, <code>Ctrl+S</code>, <code>Ctrl+P</code>, <code>Ctrl+F</code>, <code>Ctrl+Z</code>, <code>Ctrl+Y</code>, etc.), reasignación interactiva con guardado persistente y sincronización automática con la Paleta de Comandos.' },
                    { type: 'new', text: '<strong>Widget Flotante de Búsqueda Inferior:</strong> Se transformó la búsqueda superior en un widget cápsula centrado en el borde inferior de la ventana, compacto por defecto, con animación fluida de expansión al hacer clic o al presionar <code>Ctrl+F</code>.' },
                    { type: 'improve', text: '<strong>Reorganización de Barra Superior y Pestañas:</strong> Los toggles de vista (desde vista única hasta desplazamiento automático) se reubicaron en el encabezado principal, mientras que los botones Deshacer, Rehacer e Imprimir se trasladaron a la barra de pestañas, justificados a la derecha.' },
                    { type: 'improve', text: '<strong>Ajuste de Cápsula de Zoom e Ícono de Vista Continua:</strong> Se desplazó la cápsula de zoom 12px a la derecha hacia el borde de la ventana y se recalculó la geometría del ícono de Vista Continua para centrar sus 3 particiones con medidas perfectamente iguales (6px cada una).' }
                ]
            },
            {
                version: '3.2.5',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Pestañas de Documentos y Toggles de Vista:</strong> Se eliminó el posicionamiento absoluto con límite rígido en <code>.doc-tabs-wrapper</code>, migrando el contenedor a un layout flexible moderno (<code>flex: 1 1 0%</code> y <code>min-width: 0</code>). Las pestañas ahora respetan estrictamente el límite de la barra de toggles sin sobreponerse jamás a los botones de vista, cuadrícula ni temas, incorporando además desplazamiento horizontal suave con la rueda del ratón y auto-scroll de la pestaña activa.' }
                ]
            },
            {
                version: '3.2.4',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Modal Acerca de (About):</strong> Se ajustó la separación del bloque «Powered by» y el botón de cerrar (✕), eliminando por completo cualquier sobreposición sobre el logotipo y el texto.' },
                    { type: 'improve', text: '<strong>Pestañas del Ribbon:</strong> Se elevaron las cápsulas de pestañas principales (INICIO, IMAGEN, DIBUJAR, etc.) para crear una separación limpia con respecto a la fila de pestañas de documentos y evitar saturación visual.' }
                ]
            },
            {
                version: '3.2.3',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Icono de Guardar Ampliado:</strong> El SVG del botón de guardar en la cabecera se incrementó de 10px a 14px para que se ajuste correctamente a su contenedor de 20px, consistente con el botón de imprimir.' },
                    { type: 'new', text: '<strong>Vista Horizontal en Modo Lectura:</strong> El botón de layout horizontal en la cápsula de herramientas del modo lectura ahora muestra estado activo (resaltado con color accent) y se sincroniza bidireccional al entrar/salir del modo lectura y al alternar el layout.' },
                    { type: 'fix', text: '<strong>Widgets Flotantes en h-layout + Modo Lectura:</strong> Posicionamiento correcto de los widgets de zoom, lectura y auto-scroll cuando ambos modos están activos simultáneamente.' }
                ]
            },
            {
                version: '3.2.2',
                date: '2026-10-18',
                items: [
                    { type: 'fix', text: '<strong>Paleta de Comandos (Ctrl+K):</strong> Se eliminó la sobreposición del botón de cerrar con la insignia de escape (Esc).' },
                    { type: 'improve', text: '<strong>Documentos Más Usados:</strong> Se restauró el ícono representativo de flama tanto en el encabezado de sección como en el título de las tarjetas.' },
                    { type: 'improve', text: '<strong>Pestañas del Ribbon:</strong> Se redujo la curvatura de las cápsulas de pestañas (INICIO, IMAGEN, DIBUJAR, etc.) haciéndolas más cuadradas y estilizadas.' }
                ]
            },
            {
                version: '3.2.1',
                date: '2026-10-18',
                items: [
                    { type: 'improve', text: '<strong>Pestañas de Documentos Compactas:</strong> Contenedor de pestañas optimizado a 21px de altura, manteniendo la posición original con alineación limpia y acceso rápido a todas las herramientas de visualización.' },
                    { type: 'improve', text: '<strong>Dimensionado Unificado de Botones:</strong> Los botones de cabecera (Recientes, Abrir, Guardar, Guardar Como, Cerrar, Imprimir, Deshacer y Rehacer) adoptan un tamaño compacto y consistente idéntico al del modo lectura (20px de alto).' },
                    { type: 'improve', text: '<strong>Ajuste Fino de Cabecera y Espaciados:</strong> Reducción de padding superior y márgenes verticales de la cabecera para maximizar el área de trabajo y visualización de documentos.' },
                    { type: 'fix', text: '<strong>Documentos Más Usados:</strong> Salvaguarda de valores nulos al renderizar el historial frecuente para evitar excepciones en la pantalla de bienvenida.' }
                ]
            },
            {
                version: '3.2.0',
                date: '2026-10-18',
                items: [
                    { type: 'new', text: '<strong>Motor de Edición Quirúrgica de Texto (Splice Engine):</strong> Reemplazo no destructivo de texto directamente en los flujos de contenido PDF (operadores <code>BT/ET</code>, <code>Tm</code>, <code>TJ</code>), preservando al 100% las líneas vecinas, letras descendentes y el fondo original con error de línea base 0.00 pt.' },
                    { type: 'new', text: '<strong>Paleta de Comandos Global (Ctrl+K):</strong> Buscador interactivo de herramientas y acciones con navegación por teclado, atajos y filtrado difuso rápido.' },
                    { type: 'new', text: '<strong>Panel de Capas PDF (OCG):</strong> Visualización y control de visibilidad de capas de contenido opcional integradas directamente en el visor y miniaturas.' },
                    { type: 'new', text: '<strong>Inspector de Propiedades (4 Pestañas):</strong> Panel ampliado con pestañas de Descripción, Seguridad y Permisos criptográficos, Auditoría de Fuentes (incrustadas/subconjuntos) y Avanzado (Page Boxes y Fast Web View).' },
                    { type: 'new', text: '<strong>Unión de PDFs con Marcadores Jerárquicos:</strong> Al combinar documentos se genera una jerarquía de marcadores de nivel 1 con el nombre del documento preservando sus esquemas originales.' },
                    { type: 'improve', text: '<strong>Indicador de Cambios en Pestañas:</strong> Distintivo visual sutil en las pestañas para documentos modificados no guardados.' },
                    { type: 'improve', text: '<strong>Explorador de Windows y Reabrir Pestañas:</strong> Nueva acción en el menú contextual de pestañas para ubicar el archivo en el Explorador y atajo para reabrir la última pestaña cerrada.' },
                    { type: 'new', text: '<strong>Vista Doble Página (Modo Libro):</strong> Visualización de páginas pares lado a lado en modo continuo y libro, con opción de portada individual y ajuste automático de zoom al pliego completo.' },
                    { type: 'fix', text: '<strong>Edición de Texto — Erradicación de sobreposición y texto duplicado:</strong> Se reparó el circuito de borrado garantizando que <code>text_splice</code> opere con prioridad y, en caso de fallar o no aplicar (fuentes CID, párrafos o rotaciones), se active automáticamente la red de seguridad de <code>eraseTextRegion</code> y el <code>draw_rect</code> quirúrgico con el color de fondo exacto, impidiendo al 100% que el texto original permanezca visible debajo de la nueva edición.' }
                ]
            },
            {
                version: '3.1.2',
                date: '2026-09-30',
                items: [
                    { type: 'improve', text: '<strong>Modo Lectura:</strong> El botón Captura de la cápsula abre directamente la selección de área y sus acciones de búsqueda, traducción y explicación de imagen.' },
                    { type: 'improve', text: '<strong>Portables:</strong> Ejecutables Personal y Distribución actualizados con las mejoras recientes de Captura.' }
                ]
            },
            {
                version: '3.1.1',
                date: '2026-09-30',
                items: [
                    { type: 'new', text: '<strong>Captura inteligente:</strong> Búsqueda de imágenes similares con proveedor seleccionable, traducción al idioma elegido y explicación de la imagen con preguntas de seguimiento, edición y reenvío de mensajes.' },
                    { type: 'improve', text: '<strong>Visión con IA:</strong> Selección automática de modelos activos compatibles con imágenes y memoria temporal de modelos retirados para mejorar la recuperación ante fallos.' },
                    { type: 'improve', text: '<strong>Panel de captura:</strong> Textos fijos traducidos según el idioma de la aplicación, diseño visual unificado y cierre con Escape.' }
                ]
            },
            {
                version: '3.1.0',
                date: '2026-09-28',
                items: [
                    { type: 'improve', text: '<strong>Versionado:</strong> Nueva numeración pública 3.1.0. Se conserva el historial anterior agrupado por sus series originales.' },
                    { type: 'fix', text: '<strong>Ejecutables portables:</strong> Verificación del certificado incluido en el ejecutable y registro de la ruta del portable para abrir archivos PDF desde Windows.' }
                ]
            },
            {
                version: '13.31',
                date: '2026-09-28',
                items: [
                    { type: 'improve', text: '<strong>Iconos de Cinta de Opciones:</strong> Restaurado el icono de Página en Blanco con círculo verde y signo + en pestaña Inicio. Actualizados los iconos de conversión Office a PDF y PDF a Word, Excel y PowerPoint con diseño unificado y distintivos de color según especificaciones. Mejorados los iconos de Bloquear Impresión y Bloquear Copia en la pestaña Otros con impresora moderna y hojas de copia acompañadas de distintivo de candado de seguridad.' }
                ]
            },
            {
                version: '13.30',
                date: '2026-09-27',
                items: [
                    { type: 'improve', text: '<strong>About - Changelog Híbrido:</strong> Rediseñado el panel del Changelog con buscador en tiempo real, filtros por categoría (novedades, mejoras, correcciones), paginación progresiva y agrupación resumida por series (v12, v11, v10) en acordeones interactivos, reduciendo drásticamente la sobrecarga visual y el tamaño del DOM.' },
                    { type: 'fix', text: '<strong>Cinta de Opciones - Eliminación de Bordes Claros en Ribbon Oscuro:</strong> Corregido el problema donde en tema claro con cinta en colores oscuros aparecían bordes claros/blancos alrededor de grupos y botones (<code>.tool-group-vertical</code>, <code>.style-btn</code>, botones de texto, selects y controles de tamaño). Ahora los botones se mantienen limpios sin bordes espurios y el tema de la cinta se adapta automáticamente a su luminosidad.' }
                ]
            },
            {
                version: '13.29',
                date: '2026-09-26',
                items: [
                    { type: 'improve', text: '<strong>Pestaña IA - Espaciado de Botones:</strong> Añadido un padding lateral de 3px a los botones de la cinta de herramientas de IA (<code>#toolbar-ai .tool-btn</code>) para mejorar la legibilidad y holgura de las etiquetas de texto.' }
                ]
            },
            {
                version: '13.28',
                date: '2026-09-26',
                items: [
                    { type: 'improve', text: '<strong>Pestaña Dibujar - Selector de Color:</strong> Reducido el tamaño del círculo selector de color (<code>#drawColor</code>) en 3px (de 20px a 17px) para equilibrar su proporción sobre el slider de grosor.' }
                ]
            },
            {
                version: '13.27',
                date: '2026-09-26',
                items: [
                    { type: 'improve', text: '<strong>Pestaña Dibujar - Grosor de Slider:</strong> Ajustado el grosor del slider de Grosor (<code>#drawWidth</code>) para igualar la altura y grosor del slider de Opacidad de Relleno (<code>#shapeFillOpacity</code>).' },
                    { type: 'new', text: '<strong>Advertencia de Traducción:</strong> Añadido aviso informativo en el modal de traducción indicando que la velocidad de procesamiento depende de la conexión del usuario y su proveedor de inteligencia artificial.' }
                ]
            },
            {
                version: '13.26',
                date: '2026-09-25',
                items: [
                    { type: 'new', text: '<strong>Título Dinámico de Ventana en Barra de Tareas:</strong> La barra de tareas de Windows y el título de la ventana ahora muestran primero el nombre del documento abierto y activo seguido de un guion y el nombre de la aplicación (<code>[Nombre del Documento] - ALIOTH PDF EDITOR</code>), actualizándose dinámicamente al abrir archivos, alternar entre pestañas o renombrar documentos.' }
                ]
            },
            {
                version: '13.25',
                date: '2026-09-21',
                items: [
                    { type: 'fix', text: '<strong>Cruce y Separación Universal de Pestañas y Páginas Inter-Ventanas:</strong> Corregida la sincronización asíncrona de BroadcastChannel preservando el identificador del documento durante transferencias entre ventanas; resuelto el bloqueo de eventos de soltado en los paneles del visor; habilitada la separación instantánea de pestañas a nueva ventana por arrastre al lienzo en modo individual; solucionada la eliminación local de páginas y cierre de pestañas de origen al transferir la totalidad de páginas tanto dentro de la misma ventana como entre ventanas independientes.' },
                    { type: 'fix', text: '<strong>Visualización en Modo Continuo al Mover Páginas:</strong> Corregida la desincronización y superposición de páginas al mover diapositivas o páginas entre documentos o ventanas. El visor continuo ahora reconstruye los contenedores de página (wrappers) dinámicamente y adapta sus dimensiones exactas a la orientación (vertical u horizontal) de cada página, eliminando fondos blancos residuales.' },
                    { type: 'new', text: '<strong>About organizado:</strong> El panel Acerca de ahora incluye pestañas independientes para consultar las funciones, el changelog y la información legal.' },
                    { type: 'improve', text: '<strong>Traducción de PDFs:</strong> Los párrafos con varios fragmentos se componen como bloques con reflow, conservando mejor el espaciado y la estructura.' },
                    { type: 'improve', text: '<strong>Texto sobre imágenes:</strong> La reconstrucción puede reutilizar la geometría OCR y evita duplicar fragmentos superpuestos en portadas, organigramas y diagramas.' }
                ]
            },
            {
                version: '13.24',
                date: '2026-09-11',
                items: [
                    { type: 'fix', text: '<strong>Vista previa de campos autoajustables:</strong> Al desactivar la edición estructural, los campos nativos muestran inmediatamente el tamaño automático aplicado, también al escribir y en listas desplegables.' }
                ]
            },
            {
                version: '13.23',
                date: '2026-09-11',
                items: [
                    { type: 'fix', text: '<strong>Campos compatibles con visores externos:</strong> Cada widget de formulario queda enlazado con la página exportada que realmente lo contiene, manteniendo la escritura activa en navegadores y lectores PDF compatibles.' }
                ]
            },
            {
                version: '13.22',
                date: '2026-09-11',
                items: [
                    { type: 'fix', text: '<strong>Campos PDF editables:</strong> El guardado normaliza las apariencias y recursos de fuente de todos los campos nativos, incluso en páginas no visitadas, sin duplicar widgets ni depender de <code>NeedAppearances</code>.' },
                    { type: 'fix', text: '<strong>Texto autoajustable:</strong> El autoajuste permanece activo en campos de texto, campos en dos columnas y listas desplegables después de guardar.' },
                    { type: 'fix', text: '<strong>Guardado sin anotaciones:</strong> Las páginas PDF sin campos ni anotaciones vuelven a guardarse correctamente.' }
                ]
            },
            {
                version: '13.21',
                date: '2026-09-09',
                items: [
                    { type: 'new', text: '<strong>Información legal internacional:</strong> Añadidos condiciones de uso, privacidad, aviso de IA, licencia AGPL y avisos de terceros en el panel Acerca de y la distribución.' },
                    { type: 'new', text: '<strong>Control de datos de IA:</strong> Las funciones externas requieren el aviso de IA aceptado y continúan usando únicamente las API Keys propias del usuario.' }
                ]
            },
            {
                version: '13.20',
                date: '2026-09-08',
                items: [
                    { type: 'improve', text: '<strong>Inicio más ligero:</strong> El motor Python y las integraciones de Excel se inicializan únicamente cuando una función las necesita.' },
                    { type: 'improve', text: '<strong>Identidad del ejecutable:</strong> El launcher incorpora empresa, producto y versión consistentes para la distribución de Windows.' }
                ]
            },
            {
                version: '13.19',
                date: '2026-08-24',
                items: [
                    { type: 'new', text: '<strong>Integración Office IA:</strong> Nuevo flujo unificado para reconstruir PDF a Excel, Word o PowerPoint con IA. Conserva texto, tablas, celdas y formas editables cuando la estructura del documento lo permite.' }
                ]
            },
            {
                version: '13.18',
                date: '2026-08-23',
                items: [
                    { type: 'change', text: '<strong>Sensibilidad de Guías Inteligentes reducida:</strong> Reducida la sensibilidad de las guías inteligentes y el magnetismo en un 25% (umbral de snapping ajustado de 3px a 2.25px) para mayor comodidad al arrastrar y alinear objetos.' }
                ]
            },
            {
                version: '13.17',
                date: '2026-08-23',
                items: [
                    { type: 'change', text: '<strong>Cápsula de Modo Lectura mejorada:</strong> Se reemplazó la etiqueta "L" por el texto localizado "Lectura" (con soporte multilenguaje) y un icono de ojo monocromático SVG dentro de la cápsula flotante, optimizando los estilos para un ajuste visual perfecto.' }
                ]
            },
            {
                version: '13.16',
                date: '2026-08-23',
                items: [
                    { type: 'change', text: '<strong>Cápsula de Modo Lectura:</strong> Reubicado el botón de modo lectura desde la cabecera a una cápsula flotante posicionada 5px por encima del widget de zoom. La cápsula cuenta con las mismas propiedades visuales (bordes, fondos, opacidad, transiciones y sombreados) que la del zoom, y se ha ajustado la posición del widget de autodesplazamiento vertical para evitar solapamientos.' }
                ]
            },
            {
                version: '13.15',
                date: '2026-08-23',
                items: [
                    { type: 'fix', text: '<strong>Apertura en Nueva Pestaña vs Ventana Independiente:</strong> Solucionado el problema donde los archivos PDF siempre se abrían en ventanas nuevas. Conectado el selector de comportamiento de apertura (<code>#pref-open-mode</code>) con <code>localStorage</code> y <code>config.ini</code>, implementado canal de señalización SSE (<code>/api/tab-events</code>) y reenvío automático desde el lanzador de Windows (<code>_server.vbs</code>) para que los archivos abiertos externamente se integren al instante como nuevas pestañas en la ventana activa.' }
                ]
            },
            {
                version: '13.14',
                date: '2026-08-22',
                items: [
                    { type: 'improve', text: '<strong>Botones Reactivos de Vinculación de API Keys:</strong> Sincronización completa de los 8 proveedores de IA (Gemini, Groq, Mistral, Azure, HuggingFace, OpenRouter, NVIDIA NIM y Fish Audio) en Preferencias. Los botones cambian automáticamente a "Vinculado" con estilo azul translúcido y borde azul brillante cuando hay una clave válida configurada o guardada, adaptándose en tiempo real al escribir, vincular o eliminar claves.' }
                ]
            },
            {
                version: '13.13',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Cruce Universal Inter-Ventanas Completo (Página a Página, Página a Pestaña, Pestaña a Pestaña, Pestaña a Página):</strong> Implementación integral de la matriz 4x4 de arrastre y soltado entre ventanas independientes: (1) <em>Página a Página:</em> inserción precisa en barra lateral o lienzo principal entre ventanas; (2) <em>Página a Pestaña:</em> extracción a nueva pestaña o adición directa a pestaña receptora existente; (3) <em>Pestaña a Pestaña:</em> reordenamiento y migración de pestañas entre ventanas con indicadores visuales; (4) <em>Pestaña a Página:</em> fusión instantánea de todas las páginas de un documento arrastrado dentro del documento activo en otra ventana.' },
                    { type: 'fix', text: '<strong>Motor de Transferencia Multicapa y Reconstrucción de Fuentes PDF:</strong> Implementados los métodos <code>_saveTransferPayload</code>, <code>_fetchTransferPayload</code> y <code>_clonePagesAndSources</code> con serialización Base64 de ArrayBuffers, canal de sincronización <code>BroadcastChannel</code> para confirmaciones instantáneas y fallback en memoria/proxy local para transferencia segura y sin pérdidas de memoria.' }
                ]
            },
            {
                version: '13.12',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Internacionalización Completa de Menús Contextuales y Opciones (9 Idiomas):</strong> Traducción exhaustiva y dinámica en los 9 idiomas soportados (Español, Inglés, Italiano, Francés, Alemán, Japonés, Coreano, Chino Mandarín y Chino Tradicional) para todos los menús contextuales de la aplicación: lienzo/objetos (edición en grupo, propiedades, cortar/copiar/pegar, alineaciones, ordenación, transformaciones), miniaturas laterales (rotar, duplicar, eliminar, marcadores, índice, transferencias), pestañas de documentos, atajos personalizables, selección de texto enriquecido y colores de resaltado, campos de formulario e índice de contenido.' },
                    { type: 'fix', text: '<strong>Preservación de Iconos Vectoriales y Corrección de Diccionario:</strong> Resuelto el problema de iconos SVG que desaparecían en los menús contextuales laterales al cambiar de idioma mediante marcado atómico en spans internos e inmunidad en <code>setLanguage()</code>. Corregidas cadenas residuales en el diccionario en español y completada la cobertura léxica de cintas de herramientas (Dibujo, Vistas, Formularios).' }
                ]
            },
            {
                version: '13.11',
                date: '2026-08-22',
                items: [
                    { type: 'fix', text: '<strong>Motor Universal de Transferencia Cross-Window (/transfer-payload):</strong> Resuelto el bloqueo de OLE drag & drop de Windows implementando un canal de intercambio asíncrono respaldado por el servidor proxy local. Las páginas y pestañas arrastradas entre ventanas independientes ahora se transfieren e insertan de forma instantánea y confiable con todos sus buffers binarios de PDF.' },
                    { type: 'new', text: '<strong>Extracción Cross-Window a Nueva Pestaña:</strong> Arrastrar páginas desde la barra lateral de cualquier ventana hacia la barra de pestañas o botón <code>+</code> de otra ventana crea una nueva pestaña inmediatamente en la ventana destino y sincroniza la extracción en la ventana de origen.' }
                ]
            },
            {
                version: '13.10',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Extracción de Páginas a Nueva Pestaña por Arrastre:</strong> Ahora al arrastrar una o varias páginas desde la barra lateral hacia el área de pestañas (o el botón <code>+</code>), esas páginas se extraen/mueven automáticamente a una nueva pestaña independiente con su nombre correspondiente, tanto dentro de la misma ventana como entre ventanas distintas.' }
                ]
            },
            {
                version: '13.09',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Arrastre de Pestañas entre Ventanas Independientes (Cross-Window Tab Drag & Drop):</strong> Ahora es posible arrastrar una pestaña de documento desde una ventana a otra ventana abierta de la app; el documento se transfiere e integra directamente en la barra de pestañas receptora y se cierra en la ventana de origen sin abrir una tercera ventana no deseada.' },
                    { type: 'new', text: '<strong>Arrastre de Páginas entre Ventanas (Cross-Window Page Drag & Drop):</strong> Soporte completo para arrastrar una o varias páginas desde la barra lateral de miniaturas de una ventana al panel lateral o visor de otra ventana independiente, transfiriendo de forma transparente los objetos de página y sus buffers binarios de PDF.' },
                    { type: 'fix', text: '<strong>Sincronización Inter-Ventanas (BroadcastChannel):</strong> Canal de comunicación nativo de alta velocidad entre ventanas abiertas para la transferencia segura de documentos y páginas sin pérdida de memoria ni duplicidad de procesos.' }
                ]
            },
            {
                version: '13.08',
                date: '2026-08-22',
                items: [
                    { type: 'fix', text: '<strong>Badge de Icono Multi-Resolución (Solución al Cubo de Colores):</strong> Regenerado <code>ICONO 2.ico</code> con todas las capas estándar de Windows (16x16, 20x20, 24x24, 32x32, 40x40, 48x48, 64x64, 128x128, 256x256), permitiendo que Windows Explorer mantenga la miniatura/previsualización del PDF y muestre el icono nítido de Alioth en la esquina en lugar del cubo de colores genérico.' },
                    { type: 'fix', text: '<strong>Apertura de PDF con Doble Clic (Solución al TypeError):</strong> Corregido el método de carga en el inicio por URL (reemplazado <code>loadPDFFile</code> por <code>smartOpenFile</code>/<code>openFile</code> defensivo con encoding seguro de rutas), cargando de inmediato el documento al hacer doble clic en Windows.' },
                    { type: 'new', text: '<strong>Endpoint /open-file & Refresco de Shell:</strong> Endpoint GET en el proxy para transferir PDFs locales al visor, registro completo de metadatos de ProgID en el Registro y notificación nativa mediante <code>SHChangeNotify</code>.' }
                ]
            },
            {
                version: '13.07',
                date: '2026-08-22',
                items: [
                    { type: 'fix', text: '<strong>Preservación Exacta de Zoom en Cambios de Vista:</strong> Garantizado que la escala y tamaño del documento se conserven sin reseteos automáticos al alternar entre Vista Única / Paralela / Arriba-Abajo (Split View), Modo Continuo / Página Única, Disposición Horizontal / Vertical (h-layout) y Modo Lectura.' }
                ]
            },
            {
                version: '13.06',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Asociación de Icono Oficial de Documento (.ico):</strong> Configurado <code>ICONOS/ICONO 2.ico</code> como el icono predeterminado registrado en el Registro de Windows (<code>HKCU\\Software\\Classes\\Alioth.PDF\\DefaultIcon</code>) para todos los archivos PDF asociados.' },
                    { type: 'new', text: '<strong>Motor de Internacionalización (9 Idiomas):</strong> Implementado soporte completo para Español (<code>es</code>), Inglés (<code>en</code>), Italiano (<code>it</code>), Francés (<code>fr</code>), Alemán (<code>de</code>), Japonés (<code>ja</code>), Coreano (<code>ko</code>), Mandarín (<code>zh</code>) y Cantonés/Tradicional (<code>zh-TW</code>).' },
                    { type: 'new', text: '<strong>Selector de Idioma en Preferencias:</strong> Nuevo control en Preferencias Generales con cambio reactivo instantáneo en la interfaz sin necesidad de recargar y persistencia en <code>localStorage</code>.' }
                ]
            },
            {
                version: '13.05',
                date: '2026-08-22',
                items: [
                    { type: 'improve', text: '<strong>Arquitectura Modular ES Modules:</strong> Implementada arquitectura basada en estándares ES Modules con exportaciones formales y fachada de compatibilidad global unificada (<code>window.app</code>), permitiendo soporte dual para desarrollo portable y Vite.' },
                    { type: 'improve', text: '<strong>Iconografía Vectorial Monocromática:</strong> Modernizados todos los iconos en modales, botones y paneles por vectores SVG limpios con trazo dinámico adaptable a temas claro/oscuro.' },
                    { type: 'new', text: '<strong>Botón Reactivo de API Keys:</strong> Indicador interactivo "✓ Vinculado" / "Vincular" con detección en tiempo real al escribir o modificar credenciales en Preferencias.' },
                    { type: 'improve', text: '<strong>Unificación de Acentos de Color:</strong> Vinculación completa de todos los modales, barras y controles a la variable dinámica <code>var(--accent)</code>.' }
                ]
            },
            {
                version: '13.04',
                date: '2026-08-22',
                items: [
                    { type: 'improve', text: '<strong>Splash Screen Instantánea (0 ms):</strong> Optimizado el logo de Alioth TDAH Studios (reducción del 96.5% de peso, 3.8 MB &rarr; 131 KB), precarga en memoria y animación inmediata al arrancar.' },
                    { type: 'fix', text: '<strong>Data Extraction AI (Multi-Proveedor):</strong> Desbloqueada la extracción para operar de forma autónoma con Gemini Vision, Groq, OpenRouter o Azure, permitiendo procesar y estructurar formularios con cualquier clave configurada.' },
                    { type: 'new', text: '<strong>Asistente IA en Consola de Formularios:</strong> Generación automática de scripts JavaScript a partir de peticiones en español (ej. "sumar subtotal e IVA", "calcular edad"), integrando helpers nativos y ejecución en un clic.' },
                    { type: 'new', text: '<strong>Asociación de PDF como Predeterminado (Sin Admin):</strong> Nuevo botón en Preferencias Generales y registro a nivel de usuario en <code>HKCU</code> para asociar archivos PDF con Alioth sin requerir permisos de administrador.' },
                    { type: 'improve', text: '<strong>Depuración de Ribbon:</strong> Eliminado el botón duplicado de edición de texto real de la pestaña OTROS para mantener una interfaz limpia y organizada.' }
                ]
            },
            {
                version: '13.03',
                date: '2026-08-22',
                items: [
                    { type: 'new', text: '<strong>Integración BigFish (Fish Audio) TTS:</strong> Incorporado soporte para lectura por voz hiperrealista usando Fish Audio con catálogo de voces comunitarias y privadas (clonadas), selector de ámbito (🌐 Comunitarias / 👤 Propias) y proxy seguro para reproducción fluida.' },
                    { type: 'fix', text: '<strong>Auto-Redacción por Regex (PyMuPDF):</strong> Corregidos los errores de compilación y llamada nativa (<code>JM_search_stext_page</code>) en <code>autoRedactPattern</code> para emails y números telefónicos.' },
                    { type: 'fix', text: '<strong>OCR y Generación de PDF Buscable (Searchable):</strong> Corregido error <code>this.renderPageToCanvas is not a function</code> en <code>makeSearchablePDF</code> implementando renderizado offscreen canvas dedicado.' },
                    { type: 'fix', text: '<strong>Detección de Fuentes de Sistema:</strong> Silenciado y gestionado correctamente el aviso de <code>SecurityError: Page needs to be visible</code> en el arranque, manteniendo la sincronización automática en el primer gesto del usuario.' },
                    { type: 'improve', text: '<strong>Cascada SSL Corporativa Resistente:</strong> Aplicada estrategia de verificación SSL en cascada inspirada en TTS-Studio (verificación estándar &rarr; certifi &rarr; bypass proxy corporativo MITM) para garantizar conectividad en redes protegidas.' }
                ]
            },
            {
                version: '13.02',
                date: '2026-08-21',
                items: [
                    { type: 'new', text: '<strong>Nuevos Proveedores de IA:</strong> Añadido soporte completo para <em>HuggingFace Inference API</em>, <em>OpenRouter</em> y <em>NVIDIA NIM</em> en la pestaña de API Keys, con fallback automático inteligente integrado.' },
                    { type: 'fix', text: '<strong>Edición de Texto Quirúrgica (Protección Colateral):</strong> Corregido fallo en <code>[CIDFONT-COVER]</code> que borraba caracteres adyacentes de la línea superior con descenders (como la letra "p" en fuentes CIDFont sin ToUnicode).' },
                    { type: 'fix', text: '<strong>Arranque Único y Rápido (INICIAR.bat):</strong> Solucionado el problema de apertura duplicada de ventanas de navegador al iniciar la aplicación. Optimizado el script de arranque para carga inmediata.' },
                    { type: 'improve', text: '<strong>Seguridad SSL/TLS Corporativa:</strong> Integrada carga dinámica de certificados del almacén del sistema Windows (Root CAs), garantizando compatibilidad con proxies corporativos (Zscaler, Fortinet) y directiva <code>verify_ssl</code> en <code>config.ini</code>.' },
                    { type: 'improve', text: '<strong>Protección de Endpoints y CORS:</strong> Restringido el acceso CORS a orígenes locales y añadida validación de contención de rutas seguras para operaciones con archivos Excel y OneDrive.' }
                ]
            },
            {
                version: '13.01',
                date: '2026-08-14',
                items: [
                    { type: 'improve', text: '<strong>Arquitectura On-Demand (Lazy Loading):</strong> Carga bajo demanda de módulos pesados (Tesseract OCR, Pyodide Python WASM, Mammoth Word, SheetJS Excel y generadores de códigos de barras/QR). Reduce drásticamente el tiempo de arranque y el consumo de RAM base.' },
                    { type: 'improve', text: '<strong>Virtualización de Canvas en Scroll Continuo:</strong> Implementado renderizado inteligente con <code>IntersectionObserver</code> para PDFs de muchas páginas. Solo se pintan los lienzos visibles en el viewport, evitando saturación de GPU y congelamiento del navegador.' },
                    { type: 'improve', text: '<strong>Optimización de Memoria en Apertura de PDFs:</strong> Eliminada la duplicación innecesaria de <code>ArrayBuffer</code> al abrir archivos grandes y reutilización eficiente de instancias de PDF.js.' },
                    { type: 'fix', text: '<strong>Limpieza de Inclusiones Redundantes:</strong> Eliminadas etiquetas <code>&lt;script&gt;</code> duplicadas en el HTML base para garantizar una inicialización limpia y predecible.' }
                ]
            },
            {
                version: '13.00',
                date: '2026-05-29',
                items: [
                    { type: 'new', text: '<strong>Gestión de Firmas:</strong> Nueva sección en la pestaña IMAGEN para guardar, renombrar, eliminar e insertar firmas personalizadas. Las firmas se almacenan localmente en IndexedDB y se insertan directamente sobre el PDF desde el dropdown del ribbon.' },
                    { type: 'new', text: '<strong>Cifrado Local Seguro:</strong> Implementación de cifrado nativo en IndexedDB (AES-GCM de 256 bits y derivación de clave PBKDF2) configurable mediante interfaz gráfica en el nuevo modal de Seguridad.' },
                    { type: 'new', text: '<strong>Protección XSS Global:</strong> Helper <code>escapeHTML</code> inyectado globalmente en todas las inserciones del DOM a partir de datos del PDF para mitigar ataques XSS.' },
                    { type: 'new', text: '<strong>Restablecimiento y Limpieza:</strong> Opción para limpiar la caché IndexedDB y restablecer la aplicación a su estado inicial desde la interfaz de usuario y pantalla de bloqueo.' },
                    { type: 'new', text: '<strong>Modal de Preferencias Unificado:</strong> Nuevo botón de engrane ⚙ (outline) en la barra de toggles. Abre un modal con pestañas laterales: Seguridad, Claves API, General y Datos.' },
                    { type: 'new', text: '<strong>Frase Semilla de Recuperación:</strong> Al activar cifrado se genera una frase semilla de 12 palabras (diccionario español). Permite desbloquear la app si se olvida la contraseña maestra. Soporte para copiar al portapapeles y enviar por correo electrónico.' },
                    { type: 'new', text: '<strong>Gestión de API Keys:</strong> Pestaña dedicada para vincular y eliminar claves de API de Gemini y Groq con visibilidad toggle y guardado individual por proveedor.' },
                    { type: 'new', text: '<strong>Preferencias Generales:</strong> Autoguardado configurable (intervalo 1-30 min), zoom predeterminado, modo de página por defecto y proveedor IA preferido.' },
                    { type: 'new', text: '<strong>Pestaña de Datos:</strong> Estadísticas en tiempo real de documentos en caché, favoritos y almacenamiento utilizado. Botón de restablecimiento total con confirmación.' },
                    { type: 'improve', text: '<strong>Cambio de contraseña O(1):</strong> Al cambiar contraseña solo se re-cifra la frase semilla (pocos bytes) en vez de migrar toda la base de datos, mejorando enormemente el rendimiento.' },
                    { type: 'improve', text: '<strong>Desbloqueo dual:</strong> Pantalla de bloqueo con opción de desbloqueo por contraseña o por frase semilla de 12 palabras, con pista de contraseña visible tras intento fallido.' }
                ]
            },
            {
                version: '12.99',
                date: '2026-05-28',
                items: [
                    { type: 'fix', text: '<strong>Menú contextual:</strong> Corregido bloqueo de menú contextual global cuando hay pestañas vacías (sin páginas de documento cargadas) para evitar la aparición del menú de edición.' },
                ]
            },
            {
                version: '12.98',
                date: '2026-05-28',
                items: [
                    { type: 'fix', text: '<strong>Menú contextual:</strong> Bloqueado el click derecho y el menú contextual en toda la ventana principal cuando no hay ningún documento cargado.' },
                ]
            },
            {
                version: '12.97',
                date: '2026-05-28',
                items: [
                    { type: 'fix', text: '<strong>Widgets Zoom y Autoscroll:</strong> Alineación vertical exacta estableciendo ancho idéntico de <code>68px</code> en ambos widgets. Reducción de separación vertical a <code>6px</code> (autoscroll a <code>bottom:192px</code> y zoom a <code>bottom:18px</code>). El botón flotante de IA y sus botones de navegación ahora tienen un límite dinámico superior para no sobrepasar ni encimarse con el ribbon/header del visor.' },
                ]
            },
            {
                version: '12.96',
                date: '2026-05-28',
                items: [
                    { type: 'fix', text: '<strong>Widgets Zoom y Autoscroll — solapamiento:</strong> Reducido padding superior e inferior en ambos widgets (zoom: 6px→4px, autoscroll: 10px→4px). Widget de desplazamiento automático ahora tiene el mismo ancho que el de zoom y se posiciona justo encima sin encimarse (<code>bottom:228px</code>). Ambos alineados a <code>right:12px</code>.' },
                ]
            },
            {
                version: '12.95',
                date: '2026-05-28',
                items: [
                    { type: 'fix', text: '<strong>Layout Horizontal → Vertical — Centrado de página:</strong> Al salir del modo lectura o cambiar de layout horizontal a vertical, la página activa ahora se centra correctamente en el visor vertical en lugar de restaurar un offset de scroll calculado con el layout anterior.' },
                    { type: 'fix', text: '<strong>Inicialización — office_conversion.js:</strong> <code>waitForApp</code> ahora espera a que <code>app.openFile</code> esté definida antes de ejecutar el parche, evitando el error <em>Cannot read properties of undefined (reading \'bind\')</em> en cargas asíncronas.' },
                    { type: 'fix', text: '<strong>app.ui.js — SyntaxError:</strong> Eliminada declaración duplicada de <code>fitBtnExit</code> al salir del modo lectura.' },
                    { type: 'change', text: '<strong>Debug logs eliminados:</strong> Removidos todos los <code>console.log</code> de diagnóstico de ZoomWidget, scroll tracking, layout stack, RAF/TIMEOUT y renderOverlays.' },
                ]
            },
            {
                version: '12.94',
                date: '2026-05-27',
                items: [
                    { type: 'fix', text: '<strong>Layout Horizontal — Centrado de página activa:</strong> Al navegar con teclado, scroll o clic en miniatura, la página seleccionada ahora se centra correctamente en el visor. Se implementó sistema de <code>_scrollRestoreToken</code> para invalidar restauraciones de scroll obsoletas disparadas por los procesos asíncronos de zoom (RAF1, RAF2, TIMEOUT).' },
                    { type: 'fix', text: '<strong>Layout Horizontal — Miniaturas:</strong> Al hacer clic en una miniatura de la downbar, la vista principal ahora navega y centra correctamente la página seleccionada, sin ser sobreescrita por el proceso de re-renderizado previo.' },
                    { type: 'fix', text: '<strong>Layout Horizontal — Mejoras de Usabilidad:</strong> Corrección en la iluminación de toggles (autoscroll y layout horizontal) mediante la clase <code>active-view</code>. Rediseño y reposicionamiento dinámico de los botones de colapso de la downbar y toggles de paneles en modo horizontal (orientación horizontal, border-radius corregido y arrows ▲/▼). Corrección en restauración de scroll/zoom en el scroll-stack horizontal para evitar saltos al hacer zoom-out.' },
                ]
            },
            {
                version: '12.93',
                date: '2026-05-26',
                items: [
                    { type: 'new', text: '<strong>Modo Vista Horizontal (Layout Horizontal):</strong> Nuevo botón toggle en la barra de herramientas para activar un layout horizontal. Miniaturas se mueven a la parte inferior en barra horizontal con scroll. Widgets (zoom, autoscroll) se reubican a la esquina inferior izquierda. Navegación horizontal con flechas ← → y rueda del mouse. Split-view deshabilitado en modo horizontal. Preferencia guardada en <code>localStorage</code>.' },
                ]
            },
            {
                version: '12.92',
                date: '2026-05-25',
                items: [
                    { type: 'fix', text: '<strong>Tema — ribbon no restauraba color al inicio:</strong> <code>init()</code> aplicaba <code>dark-mode</code> en el body pero no llamaba <code>applyThemePreset</code>. Ahora se restaura el preset de color guardado (<code>alioth_last_preset</code>) junto con el tema claro/oscuro.' },
                ]
            },
            {
                version: '12.91',
                date: '2026-05-25',
                items: [
                    { type: 'fix',     text: '<strong>Panel IA — botón flotante:</strong> Reescritura de <code>ai_float_btn.js</code>. El script se cargaba dos veces (vía <code>main.js</code> y <code>&lt;script src&gt;</code> en BASE.html), causando que <code>isDragging</code> nunca se activara. Se eliminó el <code>&lt;script src&gt;</code> duplicado y se simplificó la lógica click vs. drag.' },
                    { type: 'fix',     text: '<strong>Modal inserción — íconos Office:</strong> Archivos <code>.docx/.doc</code>, <code>.xlsx/.xls</code> y <code>.pptx/.ppt</code> ahora muestran badge de color (W azul, X verde, P naranja) en lugar del ícono de carpeta genérico.' },
                    { type: 'improve', text: '<strong>Conversión Word → PDF:</strong> StyleMap de mammoth.js extendido con 6 niveles de headings, listas anidadas hasta 3 niveles, blockquotes, captions y page-breaks. CSS mejorado con fuente Calibri, colores corporativos Word y tablas con filas alternadas.' },
                    { type: 'improve', text: '<strong>Conversión PPTX → PDF:</strong> Extrae texto real de cada diapositiva del ZIP via Python, detecta tamaños de fuente del XML y mapea a jerarquía h1/h2/h3/p en lugar de mostrar aviso genérico.' },
                ]
            },
            {
                version: '12.90',
                date: '2026-05-22',
                items: [
                    { type: 'fix', text: '<strong>Índice IA — Step1 parse:</strong> Extraer JSON con <code>indexOf(&#39;{&#39;)</code>/<code>lastIndexOf(&#39;}&#39;)</code> en vez de regex mal escapado. Agrega log del raw response para debug.' },
                    { type: 'fix', text: '<strong>Índice IA — Step2 parse:</strong> Mismo fix para extracción del array JSON; tolerante a texto extra antes/después del array.' },
                    { type: 'fix', text: '<strong>Índice — persistencia real:</strong> <code>_persistIndexEntries()</code> llamado en add, edit, delete, import, clear, cambio de nivel/página. <code>switchTab</code> guarda el doc anterior y carga el nuevo.' },
                    { type: 'fix', text: '<strong>Índice — menú contextual:</strong> Fondo translúcido con <code>backdrop-filter:blur(14px)</code> igual que los demás menús contextuales.' }
                ]
            },
            {
                version: '12.89',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>Índice — heurística mejorada:</strong> Detección de páginas tipo formulario/ID (CURP, INE, etc.) → entrada única semántica. Agrupación de nombre en CVs. Umbral adaptativo por tipo de página. Penalización de etiquetas sueltas y bullets.' },
                    { type: 'new', text: '<strong>Índice IA — análisis en 2 pasos:</strong> Primero identifica el tipo de documento (CURP, CV, Contrato, etc.) y si es registro único. Luego genera índice semántico apropiado al tipo. Para CURP → "CURP p.1"; para CV → nombre como nivel 1, secciones como nivel 2.' },
                    { type: 'new', text: '<strong>Índice IA — fusión con manual:</strong> El índice IA reemplaza entradas automáticas pero conserva entradas manuales del usuario.' },
                    { type: 'new', text: '<strong>Índice — persistencia en caché:</strong> <code>indexEntries</code> se guarda en IndexedDB (saveSession/saveSessionLight) y se restaura al reabrir la sesión.' }
                ]
            },
            {
                version: '12.88',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>TTS Widget — rediseño flat:</strong> Todo en una sola barra horizontal (660px). Altura reducida a ~30px.' },
                    { type: 'new', text: '<strong>TTS Widget — filtros de voz:</strong> Botones ☁ (online), ♂ (masculino), ♀ (femenino) para filtrar el selector de voces. Se muestran con bandera 🇺🇸🇲🇽🇪🇸 y tipo ☁/💻.' },
                    { type: 'fix', text: '<strong>TTS Widget — voz predeterminada:</strong> Prioriza <em>Alonso Online/Natural</em> (es-US), luego Raúl, Sabina, Google español.' }
                ]
            },
            {
                version: '12.87',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>TTS Widget — ancho:</strong> Incrementado de 340px a 510px (+50%).' },
                    { type: 'fix', text: '<strong>TTS Widget — altura:</strong> Compactado padding y gap del body; botones de transporte reducidos de 26px a 22px.' },
                    { type: 'fix', text: '<strong>TTS Widget — nombres scope:</strong> Pills "Sel.", "Pág.", "Doc." → "Selección", "Página", "Documento". Título cabecera → "Leer".' },
                    { type: 'fix', text: '<strong>TTS Widget — dropdown voces:</strong> Fondo del <code>select</code> y <code>option</code> cambiado a color sólido <code>#1a1a2e</code> para que las opciones sean visibles sin hover.' },
                    { type: 'fix', text: '<strong>TTS Widget — voz predeterminada:</strong> <code>_ttsLoadVoices</code> selecciona automáticamente la mejor voz disponible (Microsoft Raul Online > Microsoft Sabina Online > Google español > etc.).' }
                ]
            },
            {
                version: '12.86',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — esquinas superiores:</strong> Restaurado <code>border-radius: 10px</code> (las 4 esquinas) en <code>.ribbon-container</code>.' }
                ]
            },
            {
                version: '12.85',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>SyntaxError changelog v12.83:</strong> Entrada huérfana sin <code>{ version:</code> causaba <code>Unexpected token \':\'</code> rompiendo <code>ALIOTH_VERSION</code> en toda la app.' },
                    { type: 'fix', text: '<strong>Ribbon — esquinas redondeadas:</strong> Restaurado <code>border-radius: 0 0 10px 10px</code> en <code>.ribbon-container</code>.' }
                ]
            },
            {
                version: '12.84',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>TTS Widget — posicionamiento:</strong> Cápsula ahora se ancla debajo del mini-ribbon en modo lectura (top:59px) y debajo del ribbon normal (top:126px). Se reposiciona automáticamente al cambiar de modo.' },
                    { type: 'fix', text: '<strong>TTS Widget — diseño:</strong> Más ancha y menos alta (340px, horizontal). Transparencia reducida a 0.35 en reposo. Transport + scope en misma fila. Velocidad + voz en misma fila. Select de voz visible siempre con <code>appearance:auto</code>.' },
                    { type: 'fix', text: '<strong>TTS Widget — icono mini-ribbon:</strong> Reemplazado emoji 🔊 por SVG monocromático consistente con el resto de botones del ribbon.' },
                    { type: 'new', text: '<strong>TTS Widget — API Key AI:</strong> Botón 🔑 en cabecera abre panel de proveedor (Sistema / OpenAI / ElevenLabs). Claves guardadas en <code>localStorage</code>. OpenAI TTS soporta selector de voz (Alloy, Echo, Fable, Nova, Shimmer). ElevenLabs usa voz multilingual.' }
                ]
            },
            {
                version: '12.83',
                date: '2026-05-21',
                items: [
                    { type: 'fix', text: '<strong>Modo Lectura — Botón Tema (mini-ribbon):</strong> El icono ☀️/🟣 del botón de tema en el mini-ribbon de lectura no se actualizaba al llamar <code>toggleTheme()</code>. Fix: <code>id="btn-reading-theme"</code> añadido al botón y sincronizado en <code>toggleTheme()</code> e init.' },
                    { type: 'new', text: '<strong>Lectura por Voz (TTS):</strong> Widget flotante semitransparente con play/pausa/detener, selector de alcance (Selección / Página / Documento), velocidad ajustable (0.5×–2×) y selector de voz del sistema. Usa Web Speech API nativa (sin API key, funciona offline). Activable desde pestaña OTROS y desde el mini-ribbon de lectura. Soporta contraer y cerrar.' }
                ]
            },
            {
                version: '12.82',
                date: '2026-05-20',
                items: [
                    { type: 'new', text: '<strong>Splash Screen:</strong> Pantalla de bienvenida animada al iniciar la aplicación. Muestra el logo con animación de aparición progresiva (fade-in + spring scale), anillo giratorio con degradado azul y puntos de carga pulsantes. Dura mínimo 1500ms y desaparece automáticamente con fade-out al terminar la inicialización.' }
                ]
            },
            {
                version: '12.81',
                date: '2026-05-20',
                items: [
                    { type: 'fix', text: '<strong>Modo Lectura — Panel de Marcadores:</strong> El panel flotaba desde el borde superior de la pantalla sin respetar el header/ribbon minimizado. Corregido con <code>top: 49px</code> (26px header + 23px ribbon).' },
                    { type: 'new', text: '<strong>Modo Lectura — Botón Panel de Índice:</strong> Añadido botón en el mini-ribbon de lectura para abrir/cerrar el Panel de Índice. El panel ahora se posiciona correctamente como overlay fijo debajo del ribbon.' },
                    { type: 'fix', text: '<strong>Edicion Reflow Secuencial - Preservacion de Identidad y Metrica de Fuente:</strong> Resuelve el error de perdida de fuente y caida de baseline de ~2.2pt en ediciones repetidas. (1) Anade soporte de CamelCase y PascalCase splitting a <code>cleanPythonFont</code> para evitar solicitudes 404 del proxy Google Fonts. (2) Introduce normalizador robusto <code>_clean_font_name_py</code> en Python (eliminando subset-prefixes, puntuacion, espacios y sufijos de estilo) para emparejamiento infalible de fuentes. (3) Anade extraccion directa por xref y mapeo por recurso en <code>font_embed_map</code> para preservar la identidad de la fuente embebida original.' },
                    { type: 'fix', text: '<strong>Edicion Reflow Secuencial - Restauracion de Regresion de Seleccion:</strong> Restaura la linea faltante <code>dPrev</code> en la estrategia de busqueda por bounding box (Estrategia 3) del extractor de bloques.' }
                ]
            },
            {
                version: '12.69',
                date: '2026-05-18',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — borrado de texto adyacente:</strong> (1) charRatio usaba conteo de caracteres para estimar posición de palabra parcial en un span — reemplazado por <code>domRect</code> del browser selection para posición pixel-exacta. (2) <code>add_redact_annot</code> y <code>draw_rect</code> clampean <code>y0</code> al span real del texto a borrar, evitando pisar texto adyacente cuyo bbox apenas toca el rect de borrado.' },
                    { type: 'fix', text: '<strong>Edición Real — fuente incorrecta en 2ª y 3ª edición (raíz completa):</strong> <code>_precheck_font</code> también era nombre fijo y PyMuPDF no sobreescribe aliases ya registrados en el stream del PDF. Fix: nombre único <code>_pc_{hash}</code> por buffer de fuente, igual que <code>emb_{xref}</code> para la fuente embebida.' },
                    { type: 'fix', text: '<strong>Edición Real — fuente incorrecta en 2ª y 3ª edición:</strong> el nombre de fuente <code>emb_reuse</code> era fijo y se reutilizaba entre ediciones en el mismo documento, causando que PyMuPDF no sobreescribiera el alias y usara la fuente de la primera edición. Fix: nombre único <code>emb_{xref}</code> por fuente embebida.' },
                ],
            },
            {
                version: '12.66',
                date: '2026-05-17',
                items: [
                    { type: 'improvement', text: '<strong>Edición Real — Google Fonts ahora tiene prioridad sobre sustitutos locales:</strong> el pipeline de resolución de fuentes intenta Google Fonts (Nivel 2) antes de aceptar un sustituto por métricas (Arial-Bold). Esto permite insertar con la fuente original completa (ej. Montserrat Bold) incluyendo acentos y caracteres especiales, replicando el enfoque de Adobe Acrobat/Nitro Pro.' },
                    { type: 'improvement', text: '<strong>Caché persistente de Google Fonts en localStorage:</strong> las fuentes descargadas de Google Fonts se guardan en <code>localStorage</code> (clave <code>alioth_gf_*</code>) y se recuperan en sesiones futuras sin re-descarga.' },
                    { type: 'fix', text: '<strong>Edición Real — fallback con <code>insert_textbox</code> cuando <code>emb_reuse</code> es Type0:</strong> cuando no hay red y el subset CID retorna <code>leftover=1</code>, se intenta <code>insert_textbox</code> con <code>emb_reuse</code> (mismo path de encoding CID que sí funciona) antes de caer a <code>hebo</code>.' },
                ]
            },
            {
                version: '12.65',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>SyntaxError — <code>_precheck_font_buf</code> mal indentado:</strong> Las variables <code>_precheck_font_buf</code> y <code>_deferred_fb_buf</code> quedaron fuera del bloque <code>try</code> con indentación incorrecta, rompiendo el parse de Python. Movidas al nivel correcto dentro del <code>try</code>.' },
                ]
            },
            {
                version: '12.64',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — probe de glifos fallaba tras apply_redactions:</strong> <code>apply_redactions</code> destruye los fonts registrados en el page stream. El probe de Capa 1 siempre reportaba todos los chars como faltantes porque <code>emb_reuse</code> y <code>_precheck_font</code> no estaban registrados. Fix: re-registrar ambas fuentes inmediatamente después de cada <code>apply_redactions</code> dentro del bloque híbrido. Se agrega <code>_precheck_font_buf</code> como variable de scope superior para persistir el buffer entre redacciones.' },
                ]
            },
            {
                version: '12.63',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — glifos faltantes en subset CID (estrategia híbrida 3-capas):</strong> La heurística de diacríticos (<code>_needs_fallback</code>) fue reemplazada por un probe real del subset: se inserta cada char único en posición descartable (<code>y+9999</code>) para detectar exactamente qué glifos faltan, con una sola redacción de limpieza. (Capa 1)' },
                    { type: 'fix', text: '<strong>Edición Real — reusar <code>_precheck_font</code> como fallback de glifos:</strong> Cuando <code>arialbd.ttf</code> resulta Type0 para inserción principal, <code>_precheck_font</code> (ya registrada, glifos completos del sistema) se conserva como <code>_fallback_full_fn</code> para los segmentos fallback en lugar de descartarse. (Capa 2)' },
                    { type: 'fix', text: '<strong>Edición Real — fuente TTF pura como segundo fallback:</strong> JS envía <code>Verdana-Bold</code> (TTF puro, no CFF-in-TTF) como <code>fontBufferFallback</code>. Python lo registra como <code>_fb_full</code> y lo usa si Capa 2 no está disponible. Prioridad: <code>_precheck_font</code> › <code>_fb_full</code> › <code>hebo</code>. Aplica a cualquier fuente CID/Type0 subset. (Capa 3)' },
                ]
            },
            {
                version: '12.54',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — fuente incorrecta al guardar (emb_reuse charset incompleto):</strong> cuando <code>emb_reuse</code> (CID subset Montserrat) retorna <code>leftover>0</code>, el retry intentaba <code>insert_textbox(font=obj)</code> que PyMuPDF 1.26 no soporta. Fix: registrar la fuente JS via <code>insert_font(fontfile=_tf.name)</code> — si no produce Type0, usar ese nombre en <code>insert_text</code>; si sigue siendo Type0 o falla, caer a <code>hebo</code>. Rect de limpieza ampliado a <code>x1+width+2</code>.' },
                    { type: 'fix', text: '<strong>Edición Real — baseline Y desplazada (emb_reuse):</strong> priorizar <code>_passed_ascent_ratio</code> (0.968 PyMuPDF) sobre <code>_js_font_obj.ascender</code> (1.101 Arial) en <code>safe_insert</code>.' },
                ]
            },
            {
                version: '12.51',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Smooth scroll — overflow:hidden se restauraba demasiado pronto:</strong> el doble-rAF restauraba <code>overflow</code> antes de que el reajuste de <code>scrollHeight</code> terminara. Fix: triple-rAF para dar tiempo al browser a estabilizar el scroll tras el cambio de contenido.' },
                ]
            },
            {
                version: '12.50',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Smooth scroll al activar Edición Real:</strong> <code>scrollTo({ top, behavior: &apos;instant&apos; })</code> cancela animaciones en curso; la asignación directa de <code>scrollTop</code> era ignorada por Chrome con <code>overflow:hidden</code> activo.' },
                    { type: 'fix', text: '<strong>Fuente genérica al guardar — arialbd.ttf es Type0/CID:</strong> <code>arialbd.ttf</code> del sistema se registra como <code>Type0</code> (CID font); <code>insert_text</code> produce glifos ilegibles. Fix: verificar tipo tras <code>insert_font</code>; si es <code>Type0</code>, descartar y usar built-in <code>hebo</code> (Helvetica Bold).' },
                ]
            },
            {
                version: '12.49',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — fuente genérica al guardar (deferred insert_font):</strong> <code>apply_redactions()</code> destruye el font registrado con <code>insert_font</code> antes de <code>insert_text</code>. Fix: <code>insert_font</code> diferido hasta dentro de <code>safe_insert</code>, justo antes de <code>page.insert_text</code>, cuando el content stream ya está listo.' },
                    { type: 'fix', text: '<strong>Smooth scroll al activar Edición Real en vista continua:</strong> el browser animaba <code>mainView.scrollTop</code> desde <code>renderContinuousContent</code>; <code>overflow:hidden</code> no canceló la animación en curso. Fix: <code>scrollBehavior = &apos;auto&apos;</code> + <code>scrollTop = scrollTop</code> antes de <code>overflow:hidden</code> cancela instantáneamente la animación.' },
                ]
            },
            {
                version: '12.48',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Parpadeo al activar Edición Real:</strong> <code>overflow:hidden</code> ahora se aplica ANTES de <code>_rescueCanvasFromContinuous</code>, congelando visualmente el viewport antes de que <code>stack.remove()</code> elimine el scroll-stack.' },
                    { type: 'fix', text: '<strong>Parpadeo al cambiar página en vista continua:</strong> <code>renderContinuousContent</code> reutiliza los <code>page-wrapper</code> existentes en lugar de vaciar <code>stack.innerHTML=&apos;&apos;</code>, evitando el flash en blanco entre renders.' },
                    { type: 'fix', text: '<strong>Fuente genérica al guardar (buf=8192B):</strong> <code>btoa</code> en chunks de 8192 bytes (no múltiplo de 3) generaba padding <code>=</code> intermedio que corrompía el base64; Python solo decodificaba los primeros 8192 bytes. Fix: chunk=8190.' },
                    { type: 'fix', text: '<strong>Null bytes en Python — commit falla:</strong> literal <code>b&apos;\\x00\\x01\\x00\\x00&apos;</code> en código Python generaba null bytes al compilar en Pyodide. Reemplazado por <code>bytes([0,1,0,0])</code>.' },
                    { type: 'fix', text: '<strong>Justificación de texto no visible en Edición Real:</strong> <code>setTextAlign</code> aplica <code>text-align</code> y <code>justifyContent</code> directamente al span activo sin re-render, preservando el cursor y el foco del contenteditable.' },
                    { type: 'fix', text: '<strong>About — versión mostraba 12.32 y SyntaxError en changelog v12.47.</strong>' },
                ]
            },
            {
                version: '12.47',
                date: '2026-05-17',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — cancelar salta a página 1:</strong> el handler de deselección consumía <code>_wasInContinuous</code> antes de que <code>_cancelRealTextInlineEdit</code> lo leyera. Fix: capturar <code>_wasContAtEntry</code> al inicio de la función; el handler de deselección no llama <code>_restoreContinuousIfNeeded</code> si <code>_realEditMode</code> está activo.' },
                    { type: 'fix', text: '<strong>Edición Real — scroll leve al activar:</strong> <code>overflow:hidden</code> en el mainView congela el scroll durante <code>renderPanelContent</code>; restauración de scroll via <code>requestAnimationFrame</code> después del erase <code>loadPage</code>; spy global de scroll en <code>_exitContinuousIfNeeded</code> para diagnóstico.' },
                    { type: 'fix', text: '<strong>Edición Real — fuente genérica al guardar:</strong> cuando <code>arialbd.ttf</code> falla en FreeType (outlines CFF, sin tabla loca), se usa <code>hebo</code> (Helvetica Bold built-in de PyMuPDF) como fallback en <code>safe_insert</code>. Descartado intento de <code>fitz.Font(fontfile)</code> que también falla con este TTF.' },
                    { type: 'fix', text: '<strong>onscroll tracking en modo continuo:</strong> activación retrasada hasta doble rAF + setTimeout(0) para evitar que scroll programático sea interpretado como navegación de página cuando los wrappers aún tienen height=0.' },
                    { type: 'fix', text: '<strong>Edición Real — scroll al cancelar regresa páginas atrás:</strong> <code>_restoreContinuousIfNeeded</code> llamaba <code>renderPanelContent</code> sin suprimir <code>scrollIntoView</code>. Fix: flag <code>_suppressScrollIntoView</code> antes de restaurar vista continua. Flag también se consume en rama modo single.' },
                ]
            },
            {
                version: '12.45',
                date: '2026-05-16',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — Undo restauraba hueco blanco:</strong> <code>_historyBuffers</code> guardaba el buffer post-erase (con <code>draw_rect</code> blanco). Al deshacer, el área quedaba borrada sin texto. Fix: ahora se guarda <code>_srcBuffer</code> (pre-erase) para restaurar el PDF original limpio.' },
                    { type: 'fix', text: '<strong>Edición Real — Scroll al activar/confirmar edición:</strong> <code>loadPage</code> en modo continuo ejecutaba <code>scrollIntoView</code> durante reloads de edición real desplazando la vista. Fix: flag <code>_suppressScrollIntoView</code> suprime el scroll en erase, commit y cancel.' },
                ]
            },
            {
                version: '12.44',
                date: '2026-05-15',
                items: [
                    { type: 'fix', text: '<strong>Copiar/Mover páginas — orden invertido:</strong> Las páginas llegaban al destino en orden inverso al documental. Causa: <code>targets</code> ordenado descendente + <code>unshift</code> + <code>reverse()</code> producía el orden de selección del usuario. Fix: <code>targets</code> ahora ordenado ascendente, recolección con <code>map</code> (push directo), splice de <code>move_to</code>/<code>delete</code>/<code>duplicate</code> en reversa para evitar desplazamiento de índices.' },
                ]
            },
            {
                version: '12.43',
                date: '2026-05-14',
                items: [
                    { type: 'fix', text: '<strong>Menú contextual del sidebar cortado en borde inferior:</strong> El posicionamiento usaba una altura fija de 250px. Corregido a leer la altura real del menú con <code>getBoundingClientRect()</code> después de aplicar <code>display:flex</code>, y clampear al viewport en los 4 bordes con 4px de margen.' },
                ]
            },
            {
                version: '12.42',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Ribbon gap — causa encontrada:</strong> Debug reveló <code>ribbonContainer borderTop: 0.617px solid rgba(255,255,255,0.85)</code> en glass-effect como origen del gap visual. Eliminado <code>border-top</code> del selector <code>body.glass-effect .ribbon-container</code>.' },
                ]
            },
            {
                version: '12.41',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Ribbon gap — debug:</strong> Agregado script de diagnóstico (<code>Shift+D</code> o <code>window._ribbonGapDebug()</code>) para identificar el elemento exacto causando el gap entre <code>tabs-container</code> y <code>ribbon-container</code>.' },
                ]
            },
            {
                version: '12.40',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — gap persistente con ribbon expandido:</strong> <code>border-radius: 0 0 10px 10px</code> seguía generando gap visual entre <code>tabs-container</code> y el ribbon expandido. Corregido a <code>border-radius: 0</code> para el estado expandido.' },
                ]
            },
            {
                version: '12.39',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — gap de 1px entre tabs y ribbon:</strong> <code>.ribbon-container</code> tenía <code>border-radius:10px</code> (esquinas superiores redondeadas) causando un gap subpíxel visual entre el <code>tabs-container</code> y el ribbon. Corregido a <code>border-radius: 0 0 10px 10px</code>. También corregido el <code>::before</code> del glass-effect.' },
                ]
            },
            {
                version: '12.38',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Text layer — selección y resaltado cortos:</strong> Los spans del text-layer tenían <code>width</code> forzado al ancho PDF pero sin <code>scaleX</code>, causando que el browser renderizara glifos más angostos que el PDF. Ahora se mide el ancho natural del browser y se aplica <code>transform: scaleX(pdfWidth/naturalWidth)</code> para que los glifos coincidan exactamente con el PDF.' },
                    { type: 'fix', text: '<strong>highlightSelection — TypeError saveToIndexedDB:</strong> Llamaba a <code>this.saveToIndexedDB()</code> que no existe. Corregido a <code>this.saveSession()</code>.' },
                ]
            },
            {
                version: '12.37',
                date: '2026-05-11',
                items: [
                    { type: 'change', text: '<strong>Toggle sidebar — iconos:</strong> Sidebar expandida muestra <code>‹</code> (flecha izquierda). Sidebar colapsada muestra <code>›</code> (flecha derecha, antes eran dos <code>>></code>).' },
                ]
            },
            {
                version: '12.36',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Paneles sidebar — navegación directa entre paneles:</strong> Al estar en Panel de Campos de Formulario, hacer clic en Índice, Marcadores o Adjuntos abría el nuevo panel sin cerrar el de Campos (ambos visibles). Fix: cada toggle cierra explícitamente <code>fields-panel-sidebar</code> antes de abrir el panel destino.' },
                ]
            },
            {
                version: '12.35',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Editar párrafo — erase se posiciona en columna adyacente (x=284 en vez de x=33):</strong> Para <code>isParagraph=true</code>, el refinamiento de X desde Python (<code>bestPy.bbox[0]</code>) se aplicaba sin validación. PyMuPDF devuelve el primer span que encuentra en el <code>pyRect</code>, que puede pertenecer a una columna adyacente del PDF. Fix: solo aplicar <code>bestPy.bbox[0]</code> si la diferencia con el x detectado por JS es menor a 20pt.' },
                    { type: 'fix', text: '<strong>Interact.js — "Cannot read properties of undefined (reading \'left\')":</strong> <code>self._cachedParentRect</code> se asigna en <code>resize:start</code>, pero <code>resize:move</code> puede dispararse antes si Interact.js se re-inicializa en medio de un drag (e.g. al re-render del overlay). Fix: usar <code>_cachedParentRect || event.target.parentNode.getBoundingClientRect()</code> como fallback.' },
                ]
            },
            {
                version: '12.34',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Borrar página desde ribbon tras usar grid — documento se cerraba:</strong> <code>gridDeleteSelectedPage</code> no limpiaba <code>multiSelection</code> al terminar. Al volver a vista normal y pulsar borrar página, <code>deletePage</code> tomaba los índices stale del grid (que ya no correspondían a páginas reales), resultando en <code>targets.length &gt;= doc.pages.length</code> y disparando <code>closeTab</code>. Fix: limpiar <code>multiSelection</code> en <code>gridDeleteSelectedPage</code> y filtrar índices inválidos en <code>deletePage</code>.' },
                ]
            },
            {
                version: '12.33',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>SyntaxError changelog v12.27:</strong> Item de changelog huérfano (fuera de bloque <code>{ version: ... }</code>) entre v12.28 y v12.26 causaba <code>Unexpected token &apos;}&apos;</code> en línea 48532, impidiendo que <code>ALIOTH_VERSION</code> y todo el bloque de versión se declararan.' },
                    { type: 'fix', text: '<strong>Drag multilínea — overlay y erase cubre solo la mitad izquierda:</strong> La lógica de col-capture (expandir al ancho real de las líneas cuando el drag captura solo una columna parcial) existía únicamente en el path de línea simple. El path multilínea (<code>lines > 1</code>) creaba <code>closestItem</code> con el ancho de los items dentro del drag, sin expandir. Fix: aplicar la misma lógica de col-capture en el path multilínea antes de crear <code>closestItem</code>.' },
                ]
            },
            {
                version: '12.31',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Surgical single-line — rect blanco de redact tapa texto nuevo:</strong> <code>add_redact_annot(fill=rgb_bg)</code> inyectaba un rect blanco en el content stream antes del texto nuevo → lo tapaba visualmente. Fix: usar <code>fill=None</code> para que <code>apply_redactions</code> solo borre el texto del stream sin generar rect de relleno. Debug <code>paths_before_insert</code> confirma ausencia de paths blancos.' },
                    { type: 'fix', text: '<strong>Surgical single-line — insert_text rc=-1 por leftover ignorado:</strong> <code>insert_text</code> con <code>fitz.Point</code> retorna chars no insertados si el texto sobrepasa el ancho de línea implícito con la fuente built-in. El código retornaba <code>-1</code> aunque el texto sí se escribiera. Fix: en surgical ignorar <code>leftover</code> (retornar siempre 0 si no hay excepción). Debug <code>[INSERT-SL]</code> loguea <code>text_w</code>, <code>rect_w</code>, <code>leftover</code> y <code>asc</code> de la fuente.' },
                ]
            },
            {
                version: '12.30',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Surgical commit — draw_rect blanco del erase tapa el texto nuevo:</strong> <code>applyReflowEdit</code> recibía el buffer POST-erase (con <code>draw_rect</code> blanco en el stream). Tras <code>apply_redactions</code> + <code>insert_text</code>, el path blanco quedaba en el stream después del texto nuevo → lo tapaba (último en stream gana). Fix: en surgical usar <code>_preEraseBuffer</code> (buffer limpio sin <code>draw_rect</code>) para el commit. <code>applyReflowEdit</code> hace su propio <code>add_redact_annot</code> para borrar el texto original.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — spans en borde x1 no eliminados por redact:</strong> <code>add_redact_annot</code> con rect exacto no captura spans cuyo <code>bbox.x0 == rect.x1</code> (borde exclusivo en PyMuPDF). <code>spans_remaining=4</code> mostraba spans en <code>x=409.89</code> (= <code>x+w</code> exacto). Fix: expandir <code>x1 +0.5pt</code> en <code>redact_rect</code>.' },
                ]
            },
            {
                version: '12.29',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Párrafo surgical — texto original persiste en stream (span doble + baseline incorrecta):</strong> <code>erase_region</code> usaba <code>draw_rect</code> que pinta encima pero NO borra el text stream. En <code>applyReflowEdit</code> con <code>isSurgical=True</code> se saltaba el <code>add_redact_annot</code>, dejando el texto original en el PDF. El texto nuevo se insertaba sobre el viejo → coexistían ambos → span enorme y baseline distinta. Fix: en surgical usar <code>add_redact_annot(orig_rect)</code> sin expansión (±0.2) para borrar físicamente el texto del stream sin destruir columnas adyacentes. Debug <code>[REFLOW MODE] spans_remaining_after_redact</code> confirma el borrado.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — overlay recortado a la mitad (objHeight=fontSize):</strong> Al crear el <code>textObj</code>, para <code>isParagraph=true</code> surgical se asignaba <code>objHeight = data.fontSize</code> (ej. 11px) aunque el bloque tuviera N líneas. El contenedor quedaba de 11px → el span desbordaba → textarea visualmente cortado. Fix: para <code>isParagraph</code>, siempre mantener <code>objHeight = data.height</code> (altura real del bloque PDF).' },
                    { type: 'fix', text: '<strong>Párrafo surgical — rect del redact no cubre el área del erase previo:</strong> El commit enviaba <code>h = textObj.height</code> (altura del overlay, posiblemente menor que el área realmente borrada por <code>eraseTextRegion</code>). Fix: en <code>_applyRealTextInlineCommit</code>, para surgical+párrafo recalcular <code>_commitH = max(data.height, textObj.height, calcH_por_líneas)</code> igual que el <code>eraseH</code> del paso de borrado, garantizando que <code>add_redact_annot</code> cubra toda el área.' },
                ]
            },
            {
                version: '12.28',
                date: '2026-05-11',
                items: [
                    { type: 'fix', text: '<strong>Párrafo surgical — span enorme y texto desalineado en PDF:</strong> <code>applyReflowEdit</code> hacía un segundo <code>draw_rect</code> blanco después de que <code>erase_region</code> ya había pintado el área, creando un rectángulo blanco visible. Fix: eliminar el <code>draw_rect</code> redundante en <code>isSurgical=True</code>.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — erase_region destructivo borraba texto adyacente:</strong> <code>erase_region</code> usaba <code>add_redact_annot + apply_redactions</code> que destruye texto del stream PDF incluyendo columnas adyacentes. Revertido a <code>draw_rect</code> (no destructivo), igual que en v12.04.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — textarea recortado a la mitad:</strong> <code>renderOverlays</code> ponía <code>el.style.overflow=hidden</code> para <code>_pendingRealData</code>, bloqueando el expand del POST-FOCUS. Fix: para <code>isParagraph</code>, no poner <code>overflow:hidden</code> en el <code>el</code>. En PENDING, poner <code>el.style.height=auto; overflow=visible</code> directamente.' },
                ]
            },
            {
                version: '12.26',
                date: '2026-05-10',
                items: [
                    { type: 'fix', text: '<strong>Párrafo surgical — draw_rect blanco insuficiente:</strong> El rect de borrado usaba <code>h</code> original (ej. 65.72pt) aunque el contenido nuevo requiriera más líneas. Fix: calcula <code>_content_h = asc*fs + (n-1)*lh + desc + 1</code> y usa <code>max(h_orig, _content_h)</code>, garantizando que el área blanca cubra todas las líneas antes de insertar.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — height sync en PRE-COMMIT:</strong> El blur/commit ocurría antes del setTimeout(10ms) POST-FOCUS enviando <code>h</code> original a Python. Fix: en blur se lee <code>max(el.offsetHeight, span.offsetHeight)/scale</code> y se actualiza <code>o.height</code> si el DOM es mayor.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — textarea cortado visualmente:</strong> POST-FOCUS expande <code>el.style.height</code> y <code>overflow=visible</code> cuando <code>span.H &gt; el.H + 1px</code>.' },
                ]
            },
            {
                version: '12.25',
                date: '2026-05-10',
                items: [
                    { type: 'fix', text: '<strong>Párrafo surgical — apply_redactions corrompe content stream:</strong> Llamar <code>apply_redactions()</code> en applyReflowEdit cuando el buffer ya fue limpiado por <code>eraseTextRegion</code> deja el content stream en estado inválido → <code>insert_text</code> posterior produce <code>t=None</code>. Fix: en surgical usar <code>draw_rect(white)</code> en vez de <code>add_redact_annot+apply_redactions</code>.' },
                    { type: 'fix', text: '<strong>Párrafo surgical — insert_textbox reemplazado por insert_text línea a línea:</strong> <code>insert_textbox</code> con métricas de font causaba rc muy negativo y no insertaba texto visible. Nuevo: <code>insert_text</code> por cada línea con <code>baseline_y = rect.y0 + fs*ascender + i*lineHeight</code>, control exacto de posición. Debugs <code>[INSERT-LINE N]</code> confirman cada línea insertada.' },
                ]
            },
            {
                version: '12.22',
                date: '2026-05-10',
                items: [
                    { type: 'fix', text: '<strong>Python getSpecificBlock — SyntaxError newline literal:</strong> <code>para_text = chr(10).join(para_lines)</code> reemplaza <code>\'\\n\'.join(...)</code>; el template literal JS convertía <code>\\n</code> en salto de línea real antes de pasarlo a Pyodide, produciendo <code>unterminated string literal</code>.' },
                    { type: 'fix', text: '<strong>Párrafo drag-select — líneas en orden invertido:</strong> Sort de <code>selectedItems</code> corregido en ambas rutas de drag (principal y expansión): <code>yDiff > 0 ? 1 : -1</code> produce orden top-to-bottom en coordenadas PDF (y mayor = más arriba). El signo anterior (<code>-1 : 1</code>) invertía el orden.' },
                    { type: 'fix', text: '<strong>Párrafo drag-select — captura parcial de columna:</strong> Detección automática: si existen items de texto en las mismas filas Y fuera del área de drag (<code>_fMaxX > pdfX_max + 15</code>), reconstruye el texto completo desde todos los items de esas líneas y expande <code>finalX/finalW</code> al ancho real del párrafo, eliminando line-breaks mid-frase y solapamiento con texto adyacente.' },
                ]
            },
            {
                version: '12.27',
                date: '2026-05-10',
                items: [
                    { type: 'fix', text: '<strong>Párrafo surgical — eraseTextRegion borra altura insuficiente:</strong> Para <code>isParagraph=true</code>, <code>eraseH</code> se calculaba como <code>data.height</code> (altura original PDF). Fix: calcular <code>_calcH = asc*fs + (nLines-1)*lh + desc + 2</code> y usar <code>max(data.height, _calcH)</code>.' },
                ]
            },
            {
                version: '12.21',
                date: '2026-05-10',
                items: [
                    { type: 'fix', text: '<strong>SyntaxError console.log ERASE-JS:</strong> Template literal mal cerrado — backtick de cierre faltaba y comillas escapadas incorrectamente.' },
                    { type: 'fix', text: '<strong>Real Edit párrafo — overflow y nowrap:</strong> <code>nowrap</code> solo aplica a líneas simples. Párrafos conservan <code>pre-wrap</code> y su altura visual completa (Height Fix no clampea <code>isParagraph</code>). <code>overflow:hidden</code> en contenedor.' },
                    { type: 'fix', text: '<strong>Real Edit párrafo — espacios entre spans:</strong> Reemplazado <code>join(\' \')</code> ciego por detección geométrica de gaps: solo inserta espacio cuando la distancia entre fin de span y inicio del siguiente supera 25% del font size.' },
                ]
            },
            {
                version: '12.19',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — debug reflow Python:</strong> Log de coordenadas exactas (<code>x, y, w, h, fs, ascender, baseline_y</code>) enviadas a PyMuPDF para diagnosticar posición Y incorrecta del texto insertado en el PDF final.' },
                ]
            },
            {
                version: '12.18',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — padding superior/inferior eliminado (root cause):</strong> El overlay usaba <code>capPx+descentPx=11.52px</code> como height, pero el span necesita <code>fontSize=12px</code>. En modo surgical (fondo transparente) el height ahora es exactamente <code>fontSize</code>, haciendo que el contenedor y el span tengan el mismo tamaño y eliminando el desborde visible.' },
                ]
            },
            {
                version: '12.17',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — debugs de padding:</strong> Logs detallados en <code>renderOverlays</code> para diagnosticar padding superior/inferior persistente: estado de <code>_pendingRealData</code>, <code>alignItems</code>, <code>marginTop</code>, y medidas reales del DOM post-focus.' },
                ]
            },
            {
                version: '12.16',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — scroll al borrar texto (erase):</strong> El <code>loadPage</code> post-erase ahora preserva y restaura el scroll con <code>requestAnimationFrame</code>, igual que el commit, evitando el salto de página al activar el modo edición.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — fondo transparente:</strong> El overlay ya no aplica <code>backgroundColor</code> cuando <code>bgAlpha === 0</code> o <code>bgColor === transparent</code>, eliminando el rectángulo blanco visible sobre el PDF.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — padding superior eliminado:</strong> El <code>marginTop</code> del shift quirúrgico de baseline ya no se aplica en modo real edit (<code>_pendingRealData</code>), donde <code>o.y</code> ya apunta a la posición correcta.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — padding inferior eliminado:</strong> El span de edición usa <code>height:auto; overflow:visible</code> en modo real edit, evitando que ocupe el 100% del contenedor y genere espacio vacío debajo del texto.' },
                ]
            },
            {
                version: '12.15',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — scroll post-commit (modo continuo):</strong> La restauración de <code>scrollTop/scrollLeft</code> tras <code>loadPage</code> ahora usa <code>requestAnimationFrame</code>, ejecutándose después del <code>scrollIntoView</code> interno de <code>loadPage</code> en modo continuo.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — commit involuntario al re-render:</strong> El blur handler del span comprueba <code>relatedTarget</code>: si el foco va a otro <code>.text-content</code> o elemento del overlay-layer (causado por <code>renderOverlays</code>), el blur se ignora y no dispara el commit.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — baseline incorrecta en insert_text:</strong> En lugar de <code>rect.y1</code> (borde inferior con descent), la baseline ahora se calcula como <code>rect.y0 + fs * fitz.Font(fn).ascender</code>, posicionando el texto en la línea base real de la fuente.' },
                ]
            },
            {
                version: '12.14',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — SyntaxError Python inline:</strong> <code>chr(10)</code> reemplaza la cadena literal de newline dentro del template literal JS, que el parser JS convertía en salto de línea real antes de pasarlo a Python.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — scroll al activar (v3):</strong> Guardado/restaurado de <code>scrollTop/scrollLeft</code> del panel alrededor de todo el bloque <code>editText() + sel.addRange()</code>.' },
                    { type: 'fix', text: '<strong>Zoom con real edit — canvas no retrocede:</strong> El <code>style.transform</code> se limpia solo si no hay real edit activo. Con real edit, el CSS transform queda aplicado dando feedback visual real del zoom sin recargar el DOM.' },
                ]
            },
            {
                version: '12.13',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — padding eliminado (v2):</strong> <code>insert_text(baseline)</code> para línea única en lugar de <code>insert_textbox</code>. PyMuPDF coloca texto en baseline exacta (<code>y1</code> del bbox), sin margen interno de ascent.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — scroll al activar (v2):</strong> El setTimeout que activa edición ahora guarda/restaura el <code>scrollTop/scrollLeft</code> del panel alrededor de <code>editText()</code> y <code>sel.addRange()</code>.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — zoom visual desbloqueado:</strong> El guard de zoom con real edit activo ahora también limpia el CSS transform temporal del canvas-container antes de retornar, evitando que el zoom quede "congelado" visualmente.' },
                ]
            },
            {
                version: '12.10',
                date: '2026-05-09',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — hueco de borrado reducido:</strong> El rect pasado a PyMuPDF <code>eraseTextRegion</code> ahora usa cap-height (<code>fontSize*0.73 + descent + 1.5pt</code>) en lugar del height completo del bbox, eliminando el espacio blanco visible arriba/abajo del texto borrado.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — zoom no confirma edición:</strong> Guard antes de <code>loadPage</code> en zoom: si hay un real edit activo (<code>_pendingRealData && isEditing</code>), omite el reload del DOM que provocaba blur → commit involuntario.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — scroll al activar:</strong> <code>span.focus({ preventScroll: true })</code> evita el scroll de página al entrar en modo edición.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — altura overlay ajustada:</strong> <code>objHeight</code> usa cap-height en modo surgical para que el borde del overlay coincida con el texto visible.' },
                ]
            },
            {
                version: '12.06',
                date: '2026-05-08',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — click captura ítem exacto:</strong> Click simple ya no pasa texto del span (que podía ser una línea completa). Ahora usa detección geométrica pura, encontrando el ítem PDF más cercano al punto de click.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — multilínea detecta escala:</strong> La condición <code>isMultiLine</code> ahora convierte la altura del drag a pt PDF (<code>h / scale</code>) antes de comparar, eliminando el falso negativo cuando el zoom era bajo.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — párrafo usa texto completo del bloque PDF:</strong> En modo párrafo + real edit, el texto del overlay se toma de <code>bestPy.text</code> (bloque completo de PyMuPDF) en lugar del selection del browser.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — line-height calculado desde PDF:</strong> Se calcula la distancia real entre baselines de las líneas seleccionadas y se pasa como <code>lineHeight</code> al overlay.' },
                ]
            },
            {
                version: '12.04',
                date: '2026-05-08',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — selección multilínea captura bloque completo:</strong> Cuando el drag produce texto multilínea (con \\n o h>20px), el path geométrico ahora siempre se ejecuta aunque w=0 (drag vertical). Si el ancho del drag es menor a 10px, se expande al ancho completo del viewport PDF para capturar todos los ítems del párrafo.' },
                ]
            },
            {
                version: '12.03',
                date: '2026-05-08',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — seleccion respeta lo seleccionado:</strong> El drag captura texto del browser antes de limpiar la seleccion y lo pasa como areaSelection.text. La expansion automatica al bloque completo solo ocurre cuando no hay texto explicito del usuario.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — vista continua se restaura al cerrar:</strong> cancelSmartPatch, _cancelRealTextInlineEdit y _applyRealTextInlineCommit llaman _restoreContinuousIfNeeded() para reactivar vista continua si fue pausada.' },
                ]
            },
            {
                version: '12.02',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — deteccion precisa via span del text-layer:</strong> En lugar de usar getSelection() del browser (que agrupa spans enteros), smartPatchMouseUp ahora usa e.target.closest(".text-layer span") para obtener el span exacto bajo el cursor. Cada span tiene data-item-index y data-item-str con los datos exactos del item PDF. En drag, se usan coordenadas geometricas del arrastre sin texto del browser.' },
                ]
            },
            {
                version: '12.01',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — seleccion desbordada por span gigante del text-layer:</strong> En drag real ya no se pasa el texto seleccionado por el browser (puede ser todo el span). captureTextAreaForPatch usa busqueda geometrica con las coordenadas exactas del drag. En click sin drag, si el rect es mayor a 40px o tiene mas de 2 lineas, tambien se descarta el texto del browser y se usa deteccion geometrica.' },
                ]
            },
            {
                version: '12.00',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — seleccion exacta de palabra/linea (fix definitivo):</strong> En lugar de usar el bbox del DOM (que abarca spans completos), ahora se busca el item PDF cuyo texto contiene la palabra seleccionada y se usa su bbox nativo de PDF.js. Para palabras parciales dentro de un span se calcula offset proporcional. Para multi-linea se estima la altura total con leading.' },
                ]
            },
            {
                version: '11.99',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — deteccion exacta de seleccion:</strong> Click en palabra detecta solo esa palabra. Seleccion de una linea detecta solo esa linea. Seleccion multi-linea detecta solo las lineas seleccionadas. Se elimino tolerancia de expansion que agregaba lineas vecinas, se redujo MAX_DISTANCE del fallback de click, y se usa getBoundingClientRect para coordenadas de seleccion sin drag.' },
                ]
            },
            {
                version: '11.98',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — seleccion exacta (fix definitivo):</strong> Cuando hay texto seleccionado por el usuario, se omite completamente la busqueda geometrica de items PDF. El closestItem se construye directo desde las coordenadas de getClientRects, garantizando que solo aparece la palabra o lineas seleccionadas.' },
                ]
            },
            {
                version: '11.95',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — texto extra al seleccionar:</strong> Al seleccionar una palabra, linea o fragmento, el editor muestra exactamente el texto seleccionado. Se elimino la expansion automatica de bloque cuando hay seleccion real del usuario.' },
                ]
            },
            {
                version: '11.94',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>About — SyntaxError en changelog v11.93:</strong> Comillas simples dentro del texto rompian el bloque JS completo, impidiendo que ALIOTH_VERSION y el changelog se cargaran.' },
                    { type: 'fix', text: '<strong>Llave duplicada en v11.92:</strong> Doble llave causaba SyntaxError en el changelog.' },
                    { type: 'fix', text: '<strong>Version dinamica:</strong> renderAbout ahora es global y se llama al abrir el modal.' },
                ]
            },
            {
                version: '11.92',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — fuente heob inválida PyMuPDF 1.26:</strong> <code>heob</code> reemplazado por <code>helv</code>. Agregado <code>safe_itb()</code> con try/except en <code>apply_reflow_edit</code> y try/except en <code>apply_real_edit</code>.' },
                    { type: 'fix', text: '<strong>Editar Texto Real párrafo — bbox Python sobreescribía dimensiones:</strong> Para <code>isParagraph=true</code>, el bbox Python (1 span) ya no sobreescribe <code>y</code>/<code>width</code>/<code>height</code> del bloque. Solo refina <code>x</code>.' },
                    { type: 'fix', text: '<strong>Editar Texto Real párrafo — orden de líneas invertido:</strong> El sort de <code>blockItems</code> tenía el comparador al revés. Corregido a mayor Y PDF primero (top-to-bottom visual).' },
                    { type: 'fix', text: '<strong>Editar Texto Real párrafo — width insuficiente:</strong> <code>bMaxX</code> ahora usa <code>Math.max(items, viewport.width - bMinX)</code> para cubrir el ancho real del párrafo hasta el margen derecho espejado.' },
                    { type: 'fix', text: '<strong>Editar Texto Real párrafo — fuente embebida subset no se reutilizaba:</strong> El bloqueo <code>is_subset</code> eliminado. Ahora compara por nombre base limpio (sin prefijo <code>XXXXXX+</code>) para reutilizar la fuente embebida original.' },
                ]
            },
            {
                version: '11.89',
                date: '2026-05-07',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — detección de bloque mejorada:</strong> Tolerancia de agrupación de líneas cambiada de 3px fijos a <code>baseH * 0.6</code> proporcional al tamaño de fuente. Elimina texto invertido o incompleto en bloques multilínea.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — doble clic no cierra textarea:</strong> El handler <code>dblclick</code> en el span ahora ignora el evento cuando <code>o._pendingRealData || o.isEditing</code> están activos.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — Esc cancela correctamente:</strong> Se agrega bandera <code>_realEditCancelled</code> para que el blur subsecuente a Esc no aplique el commit ni llame <code>saveState</code>.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — saveState diferido:</strong> Se elimina el <code>saveState()</code> prematuro al abrir el editor. Solo se guarda al confirmar (<code>_applyRealTextInlineCommit</code>), permitiendo deshacer correctamente con Ctrl+Z.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — leyenda eliminada:</strong> Quitada la barra flotante "Selecciona las palabras a cambiar…" que obstruía el área de edición.' },
                ]
            },
            {
                version: '11.87',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — overlay mostraba vacío:</strong> Cuando Python borraba quirúrgicamente el texto (<code>isSurgical=true</code>), el overlay se creaba con <code>text: \'\'</code>. En modo real edit el texto original ahora siempre se muestra para que el usuario pueda seleccionar palabras. Fix: <code>text: (isSurgical && !_realEditMode) ? \'\' : data.text</code>.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — selección colapsa al inicio:</strong> Ya no se pre-selecciona todo el texto. El cursor queda libre al inicio del párrafo para que el usuario seleccione manualmente las palabras a cambiar.' },
                    { type: 'fix', text: '<strong>Editar Texto Real — dimensiones preservadas al editar:</strong> El handler <code>input</code> ya no colapsa el overlay del párrafo al recalcular <code>auto</code> width/height en modo real edit.' },
                ]
            },
            {
                version: '11.86',
                date: '2026-05-06',
                items: [
                    { type: 'new', text: '<strong>Editar Texto Real — edición directa in-place:</strong> Eliminado el popup flotante. El texto detectado se vuelve <code>contenteditable</code> directamente sobre el PDF. Selecciona la palabra o palabras a cambiar y escribe. <code>Ctrl+Enter</code> o clic fuera aplica el reflow permanente; <code>Esc</code> cancela. Borde violeta indica modo activo.' },
                ]
            },
            {
                version: '11.85',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>SyntaxError CHANGELOG v11.83:</strong> Entrada faltaba <code>{ version:</code> — causaba <code>Unexpected token \':\' </code> y rompía <code>ALIOTH_VERSION</code> en toda la app.' },
                    { type: 'new', text: '<strong>Editar Texto Real — textarea inline con reflow:</strong> Al seleccionar palabras o líneas, aparece un <code>textarea</code> flotante posicionado sobre la selección (sin modal). Edición en tiempo real con reflow automático. Confirmar con Enter/Ctrl+Enter o hacer blur; cancelar con Escape.' },
                ]
            },
            {
                version: '11.84',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Editar Texto Real — texto correcto en párrafos:</strong> Python ya no sobreescribe <code>smartPatchData.text</code> cuando se seleccionó un párrafo (<code>isParagraph=true</code>). El texto del párrafo completo se preserva.' },
                    { type: 'fix', text: '<strong>Párrafo no se renderizaba vertical:</strong> <code>isParagraph</code> ahora se guarda en <code>smartPatchData</code> y se propaga al <code>textObj</code>, activando <code>white-space: pre-wrap</code> y <code>line-height: 1.2</code> correctamente.' },
                    { type: 'fix', text: '<strong>Selección multi-span (párrafo):</strong> Bbox calculado con unión de <code>getClientRects()</code>. Texto reconstruido agrupando items PDF por línea con <code>\\n</code>.' },
                ]
            },
            {
                version: '11.83',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Miniatura dot — guard defensivo en renderThumbnail:</strong> Cambiado <code>p._thumbCache &&</code> por <code>p._thumbCache instanceof ImageBitmap &&</code> en ambas ramas del render. Evita el crash <code>drawImage</code> cuando <code>_thumbCache</code> es <code>{}</code> (serialización JSON), sea cual sea el origen de la corrupción (sesión guardada, copia entre docs, etc.).' },
                ]
            },
            {
                version: '11.82',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Miniatura en dot al copiar página entre documentos:</strong> <code>JSON.stringify</code> serializa <code>_thumbCache</code> (ImageBitmap) como <code>{}</code> — truthy pero inválido. El render hacía <code>drawImage({},0,0)</code> y no dibujaba nada. Fix: resetear <code>_thumbCache = null</code> y <code>_thumbCacheObjects = undefined</code> en la copia antes de insertarla.' },
                ]
            },
            {
                version: '11.81',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Bouncing real eliminado:</strong> El bloque "Premium Component Styles" tenía <code>transform: translateY(-1px)</code> y <code>transition: all 0.2s cubic-bezier</code> en <code>.tool-btn:hover</code> con <code>!important</code>, causando el salto visible. Reemplazado por <code>background rgba(255,255,255,0.2)</code> + <code>border-color</code>, sin transform.' },
                ]
            },
            {
                version: '11.80',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Hover botones ribbon — sin bouncing:</strong> Eliminado <code>filter: brightness</code> del hover en <code>tool-btn</code>, <code>style-btn</code>, <code>page-op-btn</code> y <code>sp-btn</code>. Todos usan ahora el mismo efecto: <code>background rgba(255,255,255,0.2)</code> + <code>border-color</code> suave, sin salto visual.' },
                ]
            },
            {
                version: '11.79',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Vista Grid — Borrar múltiples páginas:</strong> <code>gridDeleteSelectedPage</code> ahora elimina todas las páginas seleccionadas (no solo la primera). Usa <code>querySelectorAll</code> en lugar de <code>querySelector</code>.' },
                    { type: 'fix', text: '<strong>Vista Grid — Miniaturas no actualizan tras Flip/Rotar:</strong> <code>gridFlipPage</code> y <code>gridRotatePage</code> ahora invalidan <code>_thumbCache</code> de la página antes de llamar <code>renderSidebar()</code>.' },
                    { type: 'fix', text: '<strong>Hover botones Grupo Páginas:</strong> <code>page-op-btn</code> ahora usa el mismo estilo de hover que <code>tool-btn</code> (fondo transparente por defecto, <code>rgba(255,255,255,0.2)</code> en hover).' },
                ]
            },
            {
                version: '11.78',
                date: '2026-05-06',
                items: [
                    { type: 'fix', text: '<strong>Imágenes no se insertaban en merge automático:</strong> Al combinar archivos con Python (<code>mergePDFs</code>), las imágenes (JPG/PNG) se enviaban como buffer crudo sin convertir a PDF. Ahora se convierten a PDF de una página via <code>PDFLib</code> antes del merge.' },
                ]
            },
            {
                version: '11.77',
                date: '2026-05-05',
                items: [
                    { type: 'ui', text: '<strong>Modo Oscuro — Documento:</strong> Fondo p&aacute;ginas y miniaturas <code>brightness 0.72 → 0.62</code>.' },
                ]
            },
            {
                version: '11.76',
                date: '2026-05-05',
                items: [
                    { type: 'ui', text: '<strong>Modo Oscuro — Documento:</strong> Fondo de p&aacute;ginas y miniaturas m&aacute;s oscuro (<code>brightness 0.82 → 0.72</code>), aprox. un tono adicional.' },
                ]
            },
            {
                version: '11.75',
                date: '2026-05-05',
                items: [
                    { type: 'ui', text: '<strong>Modo Oscuro — Documento:</strong> En dark-mode, el canvas de las p&aacute;ginas y las miniaturas del sidebar se aten&uacute;an (<code>brightness(0.82)</code>) para mostrar un gris claro en lugar del blanco puro. El fondo del page-wrapper se ajusta a <code>#3a3a3a</code>.' },
                ]
            },
            {
                version: '11.74',
                date: '2026-05-05',
                items: [
                    { type: 'new', text: '<strong>Panel Campos — Selección canvas:</strong> Clic en campo del panel selecciona visualmente en canvas (clase selected, toolbar sincronizado). Ctrl+clic para multiselecci&oacute;n.' },
                    { type: 'new', text: '<strong>Panel Campos — Men&uacute; contextual:</strong> Click derecho muestra men&uacute; propio: Renombrar, Propiedades, Duplicar, Mover antes/despu&eacute;s en Tab, Eliminar.' },
                    { type: 'new', text: '<strong>Panel Campos — Renombrar inline:</strong> Doble clic en nombre del campo activa input editable. Enter/blur confirma, Escape cancela.' },
                ]
            },
            {
                version: '11.73',
                date: '2026-05-05',
                items: [
                    { type: 'fix', text: '<strong>Panel Campos:</strong> Corregida detección de campos — ahora usa <code>getDoc().pages[].objects</code>. Corregido tab desalineado — <code>toggleSbFields</code> sincronizado con resize, mouseup y toggleSidebar.' },
                ]
            },
            {
                version: '11.72',
                date: '2026-05-05',
                items: [
                    { type: 'new', text: '<strong>Panel de Campos de Formulario:</strong> Nuevo panel lateral (tab en sidebar, debajo del toggle de ocultar barra) que lista todos los campos del documento con tipo, nombre y página. Permite navegar al campo al hacer clic, búsqueda, filtro por tipo, selección múltiple (Ctrl+clic), eliminar y duplicar campos seleccionados.' },
                ]
            },
            {
                version: '11.71',
                date: '2026-05-05',
                items: [
                    { type: 'ui', text: '<strong>Campos Generales:</strong> min-width del grupo reducido a fit-content para eliminar espacio extra entre etiquetas y toggles.' },
                ]
            },
            {
                version: '11.70',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Campos Generales — gap label/toggle:</strong> Reducido de 8px a 4px.' },
                ]
            },
            {
                version: '11.69',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Ribbon INPUTS — espaciado lateral:</strong> Reducidos márgenes entre grupos (3px→1px) y gap entre botones (2px→1px). min-width de tool-btn 33px→30px.' },
                ]
            },
            {
                version: '11.68',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Campos Generales — toggle height:</strong> Cada fila de toggle tiene height:17px fijo y overflow:hidden para evitar desbordamiento. Scale reducido a 0.75.' },
                ]
            },
            {
                version: '11.67',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Campos Generales — spacing:</strong> Eliminado el espacio vertical entre toggles (gap 0px, padding 0px).' },
                ]
            },
            {
                version: '11.66',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Campos Generales — spacing:</strong> Reducido el espacio vertical entre los toggles (gap 5px→2px, padding 2px→1px).' },
                ]
            },
            {
                version: '11.65',
                date: '2026-05-04',
                items: [
                    { type: 'ui', text: '<strong>Toggles — Campos Generales:</strong> Los toggles «Editar Campos», «Activar Campos» y «Resaltar Campos» en la pestaña Inputs ahora se muestran en una sola columna (label a la izquierda, toggle a la derecha, alineados). Tamaño reducido. El grupo se renombra de «EDICIÓN» a «CAMPOS GENERALES».' },
                ]
            },
            {
                version: '11.64',
                date: '2026-05-04',
                items: [
                    { type: 'new', text: '<strong>Toggle "Resaltar Campos":</strong> Nuevo toggle en la pestaña Inputs (grupo EDICIÓN) para mostrar/ocultar el resaltado visual de todos los campos de formulario — tanto campos PDF nativos (<code>annotation-layer</code>) como campos creados por la app (<code>form-field-object</code>). Activo por defecto.' },
                    { type: 'fix', text: '<strong>Modo Lectura — resaltado de campos:</strong> Al entrar al Modo Lectura el resaltado se desactiva automáticamente. Al salir, se restaura al estado previo.' },
                    { type: 'fix', text: '<strong>renderBackgroundPage — página en blanco:</strong> Ya no crashea con <code>Cannot read properties of undefined (reading \'doc\')</code> cuando existe una página con <code>sourceId: null</code>. Renderiza canvas blanco con dimensiones correctas y el wrapper obtiene altura real, eliminando el bug de scroll que saltaba la página.' },
                    { type: 'fix', text: '<strong>_renderContinuousActivePage — página en blanco:</strong> Mismo guard: renderiza canvas blanco en modo continuo sin intentar acceder a fuente PDF inexistente.' },
                    { type: 'fix', text: '<strong>gridRotatePage / gridFlipPage — modo continuo:</strong> Ahora llaman <code>renderPanelContent</code> en lugar de <code>loadPage</code> cuando <code>viewMode === \'continuous\'</code>, evitando desincronización del stack. También invalidan <code>_thumbCache</code>.' },
                    { type: 'fix', text: '<strong>gridDeleteSelectedPage — modo continuo:</strong> Mismo fix: usa <code>renderPanelContent</code> en modo continuo.' },
                ]
            },
            {
                version: '11.63',
                date: '2026-05-04',
                items: [
                    { type: 'fix', text: '<strong>Página en blanco — duplicación al rotar:</strong> Al insertar una página en blanco desde la vista Grid y luego rotarla, ya no se sustituía por una copia de la página anterior. Causa: <code>gridInsertPage</code> copiaba <code>sourceId</code>/<code>pageIndex</code> de la primera página real, lo que hacía que <code>loadPage</code> cargara ese PDF. Ahora la página en blanco tiene <code>sourceId: null</code>.' },
                    { type: 'fix', text: '<strong>loadPage — soporte _blank:</strong> Cuando una página tiene <code>_blank: true</code> o <code>sourceId: null</code>, <code>loadPage</code> ahora renderiza un canvas blanco con las dimensiones correctas (con soporte de rotación y flip) en lugar de intentar acceder a una fuente PDF inexistente.' },
                    { type: 'fix', text: '<strong>renderThumbnail — soporte _blank:</strong> El thumbnail de páginas en blanco ahora se renderiza correctamente como rectángulo blanco proporcional, sin intentar cargar PDF.' },
                ]
            },
            {
                version: '11.61',
                date: '2026-05-03',
                items: [
                    { type: 'fix', text: '<strong>Abrir en Pestañas Separadas:</strong> Al soltar múltiples archivos y presionar este botón, cada archivo ahora se abre en su propia pestaña independiente. Antes caía en el Pro-Merge automático y los unía en uno solo.' },
                    { type: 'fix', text: '<strong>Vista Grid — About oculto:</strong> El botón "About" ya no se cuela visualmente en la vista de cuadrícula de miniaturas.' },
                    { type: 'new', text: '<strong>Vista Grid — Toolbar de acciones:</strong> Nueva barra flotante en la parte superior con botones: Borrar página, Insertar página en blanco, Girar izquierda, Girar derecha, Flip horizontal y Flip vertical.' },
                    { type: 'new', text: '<strong>INPUTS — Tamaño Objetos:</strong> Nuevo grupo con botones +/− para Ancho y Alto (incrementos de 0.5pt). Aplica al objeto o grupo multiseleccionado.' },
                    { type: 'fix', text: '<strong>Detección de formularios:</strong> Heurística mejorada con categoría large_rects, función best_label_for() unificada, detección de ___ como campo texto, tolerancias ampliadas y threshold de merge reducido 0.35→0.20.' },
                    { type: 'fix', text: '<strong>Prompt visión IA:</strong> Instrucciones más precisas para bbox de checkbox/radio, contexto de texto PDF ampliado (bloques 80→150, chars 2000→4000). Hints del Marcador de Campos ahora enriquecen labels vía PyMuPDF.' },
                ]
            },
            {
                version: '11.60',
                date: '2026-05-03',
                items: [
                    { type: 'new', text: '<strong>INPUTS — Tamaño de Objetos:</strong> Nuevo grupo "TAMAÑO OBJETOS" en la pestaña INPUTS con botones +/− independientes para Ancho y Alto (incrementos de 0.5pt). Aplica al objeto seleccionado o a todo el grupo multiselección.' },
                    { type: 'new', text: '<strong>resizeSelectedObjects():</strong> Nueva función que escala width/height de todos los objetos en la selección actual con <code>saveStateDebounced</code> y sincronización del elemento DOM del campo.' },
                    { type: 'fix', text: '<strong>Heurística — large_rects:</strong> La detección ahora incluye una tercera categoría <code>large_rects</code> (30–500pt ancho, 5–50pt alto) para capturar campos de texto de tamaño real que antes se ignoraban por superar el umbral de path_rects (30pt).' },
                    { type: 'fix', text: '<strong>Heurística — best_label_for():</strong> Nueva función auxiliar unificada para buscar el label más cercano a cualquier campo (por distancia horizontal + proximidad vertical), usada por checkbox, radio, underscore y rects sin label previo.' },
                    { type: 'fix', text: '<strong>Heurística — detección de ___:</strong> Se detectan palabras compuestas solo por guiones bajos (≥3) como campos de texto y se les asigna el label adyacente via <code>best_label_for()</code>.' },
                    { type: 'fix', text: '<strong>Heurística — tolerancias ampliadas:</strong> Umbral de línea horizontal subido a 5pt (era 4pt), margen de búsqueda label-colon ampliado a 8pt (era 5pt), tolerancia Y de checkboxes a 12pt (era 10pt). Clasificación radio/checkbox mejorada: ahora verifica <code>abs(w-h)&lt;5</code> en lugar de solo tamaño.' },
                    { type: 'fix', text: '<strong>Merge overlap threshold:</strong> Reducido de 0.35 a 0.20 para que campos pequeños (checkboxes, radios) encuentren su match heurístico con mayor facilidad.' },
                    { type: 'fix', text: '<strong>_ttfHintsToFields — enriquecimiento de labels:</strong> Cuando hay hints del Marcador de Campos, ahora se ejecuta PyMuPDF para buscar el texto adyacente más cercano y asignar el label correcto a cada hint. Antes todos quedaban como "campo".' },
                    { type: 'fix', text: '<strong>Prompt visión IA mejorado:</strong> Instrucciones más precisas sobre bbox de checkboxes/radio (tamaño normalizado ~0.03), distinción entre campo de texto ancho vs campo pequeño, y contexto de texto PDF ampliado a 1200 chars en prompt + 4000 chars extraídos (era 600/2000). Bloques extraídos subidos de 80 a 150.' },
                ]
            },
            {
                version: '11.59',
                date: '2026-05-03',
                items: [
                    { type: 'fix', text: '<strong>Formularios Automáticos – Formato Libre:</strong> Los dedups 3 y 4 eliminaban campos radio/checkbox válidos que comparten el mismo label o están en la misma fila Y (ej: Estado Civil, Escolaridad). Ahora los dedups de proximidad Y y label exacto se omiten para tipos radio y checkbox.' },
                ]
            },
            {
                version: '11.58',
                date: '2026-05-03',
                items: [
                    { type: 'fix', text: '<strong>ReferenceError isInteract:</strong> La asignación de <code>contentWrapper.style.pointerEvents</code> usaba <code>isInteract</code> antes de su declaración (temporal dead zone). Movida al lugar correcto, después de <code>const isInteract = this.isFieldInteractMode</code>.' },
                ]
            },
            {
                version: '11.57',
                date: '2026-05-03',
                items: [
                    { type: 'fix', text: '<strong>Campos interactivos:</strong> Corregido bug crítico donde inputs y selects no recibían eventos en modo interacción. Causa: <code>pointer-events: none !important</code> en <code>inputStyle</code> y <code>contentWrapper</code> hardcodeado bloqueaban el modo interactivo.' },
                    { type: 'feature', text: '<strong>Marcadores IA:</strong> Añadidos comentarios de instrucción para IA al inicio del CSS, bloques JS (PythonManager y App) y al final del archivo para garantizar incremento de versión en cada entrega.' },
                ]
            },
            {
                version: '11.56',
                date: '2026-05-03',
                items: [
                    { type: 'feature', text: '<strong>Sello de campo:</strong> Botón "Sello" en sección SELECCIÓN — selecciona un Checkbox o Radio, activa el sello y haz clic en el PDF para pegarlo con las mismas propiedades. Para Radio, pide nombre de grupo antes de iniciar. Crear un campo nuevo cancela el modo sello.' },
                    { type: 'feature', text: '<strong>Activar Campos:</strong> Toggle en sección EDICIÓN — cuando está ON, deshabilita drag en todos los campos de formulario y habilita interacción (marcar checkbox, seleccionar radio, escribir en texto). Persiste entre herramientas.' },
                ]
            },
            {
                version: "11.54",
                items: [
                    { type: "fix", text: "<strong>Marcador de Campos — Tipo, tamaño y posición incorrectos:</strong> <code>_ttfHintsToFields</code> antes intentaba hacer overlap con la heurística, causando que se usaran bboxes gigantes de la detección automática en lugar del rect exacto dibujado. Ahora cuando hay hints del marcador, cada hint se convierte directamente en un campo con su bbox exacta. El tipo se infiere del tamaño del hint: ≤18×18pt→checkbox, ≤18×24pt→radio, resto→text." },
                ]
            },
            {
                version: "11.53",
                items: [
                    { type: "fix", text: "<strong>Botón About — Sobreponía la hoja:</strong> Movido del body (position:fixed) al pie del sidebar como elemento inline. Ya no interfiere con el canvas independientemente del z-index." },
                ]
            },
            {
                version: "11.52",
                items: [
                    { type: "fix", text: "<strong>Hoja en blanco — No renderizaba hasta cambiar de tab:</strong> <code>insertBlankPage</code> llamaba <code>toggleLoader(true)</code> antes de <code>insertPDF</code>, haciendo que <code>isBulk=true</code> dentro de <code>insertPDF</code> y saltando el <code>loadPage</code>/<code>renderSidebar</code>. Se eliminó el loader manual — <code>insertPDF</code> lo gestiona completo." },
                ]
            },
            {
                version: "11.51",
                items: [
                    { type: "fix", text: "<strong>Hoja en blanco — No se renderizaba:</strong> <code>insertBlankPage</code> llamaba <code>loadPage</code> después de <code>insertPDF</code>, que ya lo hace internamente, causando un índice incorrecto y estado inconsistente. Se eliminó la llamada redundante." },
                    { type: "fix", text: "<strong>Botón About — Sobreponía la hoja:</strong> El z-index era <code>99990</code>, mayor que el canvas. Reducido a <code>50</code> para que quede detrás del contenido del documento." },
                ]
            },
            {
                version: "11.50",
                items: [
                    { type: "fix", text: "<strong>Checkbox/Radio — Fondo negro en PDF generado:</strong> El bug no era visual sino en el PDF final. <code>_styledFields.bg</code> recibía <code>'rgba(0,0,0,0)'</code> que Python parseaba como negro <code>(0,0,0)</code>. Ahora cuando <code>noBg=true</code> o el color es transparente, se pasa <code>'#ffffff'</code> explícito al motor PyMuPDF." },
                    { type: "fix", text: "<strong>Python hex_to_rgb:</strong> Cuando el alpha de un <code>rgba()</code> es 0, ahora retorna blanco <code>(1,1,1)</code> en lugar de negro. Fallback de color vacío también cambiado a blanco." },
                    { type: "fix", text: "<strong>Checkbox/Radio — Colores por defecto:</strong> Border y check ahora usan <code>#000000</code> como fallback en lugar de <code>#999999</code>/<code>#333333</code>." },
                ]
            },
            {
                version: "11.49",
                items: [
                    { type: "fix", text: "<strong>Checkbox/Radio — Fondo siempre oscuro:</strong> El <code>contentWrapper</code> aplicaba <code>objBgColor</code> a checkbox y radio, sobreponiendo el fondo del editor. Ahora el wrapper de checkbox/radio es siempre <code>transparent</code>; el cuadrado/círculo interno usa <code>o.backgroundColor</code> con fallback explícito a <code>#ffffff</code>, ignorando <code>rgba(0,0,0,0)</code>." },
                    { type: "fix", text: "<strong>Checkbox/Radio — Borde duplicado:</strong> El borde del contentWrapper ya no se aplica a checkbox/radio; el borde va únicamente al cuadrado interno." },
                ]
            },
            {
                version: "11.48",
                items: [
                    { type: "fix", text: "<strong>Checkbox — Fondo negro:</strong> El overlay usaba <code>o.backgroundColor</code> directamente, ignorando <code>noBg</code>/opacidad 0. Ahora usa <code>objBgColor</code> (ya resuelto). El thumbnail también respeta <code>noBg</code>." },
                    { type: "fix", text: "<strong>Checkbox — Color del check:</strong> Ahora usa <code>o.checkColor</code> con fallback a <code>#000000</code>." },
                    { type: "new", text: "<strong>Alinear objetos (menú contextual):</strong> Con 2+ objetos seleccionados aparecen 'Alinear Horizontal (mismo Y)' y 'Alinear Vertical (mismo X)'. Se alinea al primer objeto seleccionado." },
                ]
            },
            {
                version: "11.47",
                items: [
                    { type: "fix", text: "<strong>Generar Campos — Freeform: drag offsets no se aplicaban:</strong> La key usada en generate era <code>rowIdx_colIdx</code> en lugar de <code>fi_0</code>, por lo que los ajustes de posición hechos en el preview nunca se trasladaban al PDF." },
                    { type: "fix", text: "<strong>Generar Campos — Freeform: cellBboxes incorrectos:</strong> Se buscaba <code>cellBboxes[rowIdx][colIdx]</code> en lugar de <code>cellBboxes[fi][0]</code>, causando que los campos se colocaran en posiciones erróneas o usaran coordenadas por defecto." },
                    { type: "fix", text: "<strong>Checkbox / Radio — Tamaño alargado:</strong> El tamaño ahora se calcula como <code>min(cw, ch)</code> (cuadrado exacto de la celda) tanto en preview como al generar. Antes se aplicaban padding e insets que distorsionaban la forma y podían resultar en dimensiones negativas." },
                ]
            },
            {
                version: "11.46",
                items: [
                    { type: "fix", text: "<strong>SyntaxError 'sel' — Chrome pre-parser:</strong> Template literal en <code>_ttfSendChat</code> contenía <code>[</code> literal dentro de backticks en script >1MB, confundiendo el pre-parser lazy de V8. Reemplazado por concatenación de strings." },
                ]
            },
            {
                version: "11.45",
                items: [
                    { type: "fix", text: "<strong>SyntaxError changelog:</strong> Bloque v11.43 del ALIOTH_CHANGELOG tenía <code>version:</code> faltante — causaba <code>Unexpected token ':'</code> y rompía <code>ALIOTH_VERSION</code> en toda la app." },
                    { type: "new", text: "<strong>Analizar Marcas — Modo incremental:</strong> Si ya hay campos detectados, el botón cambia a 'Añadir Marcas' y solo procesa las marcas nuevas añadiéndolas al resultado existente (sin re-analizar todo ni llamar a la IA). Las marcas usadas se limpian automáticamente. Si no hay campos previos, hace el análisis completo habitual." },
                    { type: "fix", text: "<strong>Analizar Marcas — Sin llamada a Gemini:</strong> En modo incremental usa solo la heurística PyMuPDF + bbox directo del hint, evitando el rate-limit 429 de Gemini al agregar campos faltantes." },
                ]
            },
            {
                version: "11.44",
                items: [
                    { type: "new", text: "<strong>Marcador de Campos — Modo Rectángulo:</strong> El botón 'Marcador de Campos' ahora dibuja rectángulos (drag) en lugar de trazos libres. Preview en tiempo real mientras arrastras. Un solo click genera un punto visible (rect pequeño). El grosor de línea es configurable con el selector que aparece junto al botón al activarlo." },
                    { type: "fix", text: "<strong>Marcador de Campos — Clasificación inteligente:</strong> Los hints enviados a la IA ahora clasifican automáticamente: rect ≤20×20pt → checkbox, ≤20×25pt → radio, resto → text. Se refina además cruzando con <code>path_rects</code> del PDF subyacente para mayor precisión." },
                ]
            },
            {
                version: "11.43",
                items: [
                    { type: "fix", text: "<strong>Heurística — Paths compuestos:</strong> Inspecciona <code>d['items']</code> de cada drawing para extraer segmentos lineales y loops rectangulares." },
                    { type: "fix", text: "<strong>Heurística — Diagnóstico mejorado:</strong> El log imprime tipo y rect de cada drawing." }
                ]
            },
            {
                version: "11.42",
                items: [
                    { type: "fix", text: "<strong>Ajustar campos — bbox preservados:</strong> El prompt ahora instruye explícitamente a NO cambiar bbox ni orden. Los campos ajustados mantienen su posición original." },
                    { type: "fix", text: "<strong>Heurística — Checkboxes con label:</strong> Umbral subido a 20pt. Nueva detección de patrón 'texto → rect vectorial' en misma banda Y para asignar label correcto al checkbox." },
                    { type: "fix", text: "<strong>Lasso — Re-init tras render:</strong> El lasso se re-conecta al SVG después de cada <code>_ttfRenderOverlaySVG</code>. Los <code>&lt;g&gt;</code> ya no bloquean el evento mousedown en modo lasso." }
                ]
            },
            {
                version: "11.41",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Duplicación:</strong> Raíz del problema: <code>_ttfRenderOverlaySVG</code> iteraba N filas × N campos = N² celdas en modo freeform. Ahora en <code>_isFreeForm</code> cada fila renderiza solo su campo correspondiente (<code>fields[rowIdx]</code>). Mismo fix en <code>_ttfGenerateFields</code>." },
                    { type: "fix", text: "<strong>Formato Libre — Filtro tamaño:</strong> Umbral ancho subido de 40% a 90% de página. Las líneas largas tipo 'Unidad:____' ya no se descartan incorrectamente." }
                ]
            },
            {
                version: "11.40",
                items: [
                    { type: "fix", text: "<strong>Heurística — Rects grandes descartados:</strong> Umbral de checkbox reducido a 16pt; rects grandes del PDF (celdas, marcos) ya no se detectan como campos." },
                    { type: "fix", text: "<strong>Post-procesamiento — Filtro por tamaño:</strong> Campos con ancho >40% de página o alto >25% se descartan automáticamente antes del dedup." },
                    { type: "new", text: "<strong>Formato Libre — Lasso de selección:</strong> Botón Seleccionar activa modo lasso con cursor crosshair. Arrastra para dibujar un rectángulo y selecciona todos los campos dentro del área. Shift+drag para añadir a selección existente." }
                ]
            },
            {
                version: "11.39",
                items: [
                    { type: "fix", text: "<strong>Heurística — TypeError:</strong> <code>JSON.dumps</code> (Python) en código JS eliminado. La heurística ahora ejecuta correctamente." },
                    { type: "fix", text: "<strong>Botón Seleccionar:</strong> Ahora actúa como toggle real: en modo inactivo los clicks no seleccionan campos; al activarse, cursor <code>pointer</code>, borde azul en el preview, y click/shift+click seleccionan. Al desactivar, limpia selección." }
                ]
            },
            {
                version: "11.38",
                items: [
                    { type: "new", text: "<strong>Formato Libre — Detección heurística PyMuPDF:</strong> Nueva función <code>_ttfHeuristicDetect</code> analiza el PDF vectorialmente: líneas horizontales → campo text del ancho exacto de la línea; texto 'Label:' + línea a derecha → campo text con label correcto; rects pequeños vectoriales → checkbox; texto '[]','○' → checkbox/radio." },
                    { type: "new", text: "<strong>Formato Libre — Fusión IA + heurística:</strong> Ambos métodos corren en paralelo. <code>_ttfMergeFields</code> combina bbox exactos de heurística con labels/tipos semánticos de IA. Fallback escalonado: fusión → solo heurística → solo PyMuPDF nativo." },
                    { type: "new", text: "<strong>Formato Libre — Botón Seleccionar:</strong> Botón en barra superior del preview para activar modo selección visual (cursor + highlight azul). Mismo comportamiento que pestaña Inputs: click, shift+click multi, drag=mover." }
                ]
            },
            {
                version: "11.37",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Página completa deshabilitada:</strong> El botón queda inactivo en modo Formato Libre; solo se puede usar Seleccionar área para mayor precisión." },
                    { type: "fix", text: "<strong>Formato Libre — Post-procesamiento agresivo:</strong> Filtros adicionales: (1) campos fuera del área visible del clip, (2) duplicados por proximidad Y &lt;10pt con mismo label (filas repetidas de tabla), además del dedup por solapamiento y label exacto." },
                    { type: "new", text: "<strong>Formato Libre — Ajuste por lenguaje natural:</strong> Panel <em>Ajustar campos</em> con input de texto. El usuario describe correcciones en lenguaje natural y Groq modifica el JSON de campos sin re-analizar la imagen." }
                ]
            },
            {
                version: "11.36",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Parser JSON robusto:</strong> Nuevo fallback de parsing extrae objetos uno por uno con regex cuando el JSON completo falla. Resuelve errores de llama-4 que mezcla texto con JSON." },
                    { type: "fix", text: "<strong>Formato Libre — Groq vision JSON-only:</strong> Agregado <code>system message</code> a llamadas Groq vision para forzar respuesta JSON puro sin markdown ni explicaciones." }
                ]
            },
            {
                version: "11.35",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Prompt mejorado:</strong> Instrucciones mas estrictas para evitar duplicacion: cada campo una sola vez, no reportar filas repetidas de tablas, bbox cubre solo el espacio interactivo. Incluye ejemplo de JSON esperado y contexto de clip vs pagina completa." }
                ]
            },
            {
                version: "11.34",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Fallback vision:</strong> Cuando Gemini falla por rate limit (429), ahora intenta <code>meta-llama/llama-4-scout</code> y <code>llama-4-maverick</code> vía Groq (multimodal) antes de rendirse." }
                ]
            },
            {
                version: "11.33",
                items: [
                    { type: "fix", text: "<strong>Formato Libre — Imagen borrosa:</strong> El render del preview (página completa y área) ahora usa PDF vectorial con pdf.js a escala 2× en lugar de escalar <code>the-canvas</code> (ya rasterizado a <code>currentScale</code>). Mismo pipeline que el modo Tablas." },
                    { type: "fix", text: "<strong>Preview — Desbordamiento:</strong> <code>#ttf-preview-wrapper</code> con <code>max-width:100%</code> para contener la imagen dentro del panel." },
                    { type: "fix", text: "<strong>Auto-zoom — Cálculo px:</strong> Eliminado multiplicador <code>×2.0</code> redundante en <code>_tPxW/_tPxH</code>; <code>_imgW/_nW</code> ya captura la relación display/nativo." }
                ]
            },
            {
                version: "11.32",
                items: [
                    { type: "fix", text: "<strong>Formularios Automáticos — Coordenadas overlay:</strong> Eliminado <code>pdfScale</code> de <code>toPx/toDim</code> en <code>_ttfRenderOverlaySVG</code>. Las bbox de PyMuPDF están en pts PDF; la imagen ya está a 2×. El origen del clip también se multiplica por VSCALE para consistencia." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Drag offset:</strong> Conversión inversa corregida a <code>/ (VSCALE * scaleX/Y)</code> en lugar de <code>/ (pdfScale * scaleX/Y)</code>." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Imagen borrosa Formato Libre:</strong> Agregado <code>image-rendering: high-quality</code> al preview <code>&lt;img&gt;</code> para evitar interpolación borrosa al escalar la imagen 2×." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Auto-zoom:</strong> Cálculo de <code>_tPxW/_tPxH</code> corregido para usar factor VSCALE fijo en lugar de <code>currentScale</code>." },
                    { type: "fix", text: "<strong>Vision — Rate limit 429:</strong> Eliminados reintentos con backoff en <code>_callVisionWithFallback</code>. En 429, pasa al siguiente modelo inmediatamente en lugar de reintentar 3 veces (reduce 6 requests fallidos a 1 por modelo)." },
                    { type: "fix", text: "<strong>Consola — Spam TTF fields:</strong> Eliminado <code>console.log</code> que se ejecutaba por cada campo generado." }
                ]
            },
            {
                version: "11.31",
                items: [
                    { type: "fix", text: "<strong>Vision — Modelo deprecado:</strong> <code>gemini-1.5-flash-latest</code> eliminado (404). El fallback ahora usa <code>gemini-2.0-flash-lite</code>." },
                    { type: "fix", text: "<strong>Modo Tabla — Calidad imagen preview:</strong> <code>_ttfSelectArea</code> y <code>_ttfDetectFullPage</code> ahora renderizan el PDF con pdf.js a escala 2.0 en canvas offscreen, igual que Formato Libre." },
                    { type: "fix", text: "<strong>Modo Libre — Calidad imagen Vision:</strong> Render offscreen nativo 2× desde el PDF vectorial — sin distorsión del canvas de pantalla." }
                ]
            },
            {
                version: "11.30",
                items: [
                    { type: "fix", text: "<strong>Formularios Automáticos — Debounce Re-analizar:</strong> Botón ttf-btn-reanalyze bloqueado 2s entre clics consecutivos." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Debounce pestañas:</strong> Cambio entre Tablas y Formato Libre bloqueado 2s para evitar resets accidentales." }
                ]
            },
            {
                version: "11.29",
                items: [
                    { type: "feat", text: "<strong>Formularios Automáticos — Fallback PyMuPDF:</strong> Si la IA no está disponible (red bloqueada, rate limit, etc.), se detectan automáticamente los campos nativos del PDF usando PyMuPDF sin necesidad de conexión." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Sin IA:</strong> El error ya no bloquea el flujo; si PyMuPDF encuentra campos, se entregan con aviso de modo degradado." }
                ]
            },
            {
                version: '12.80',
                date: '2026-05-20',
                items: [
                    { type: 'fix', text: '<strong>Surgical — borrado vertical preciso (arriba y abajo):</strong> <code>eraseTextRegion</code> ahora clampea tanto <code>_erase_y0</code> (máximo entre el y0 del span objetivo y <code>fitz_rect.y0</code>) como <code>_erase_y1</code> (mínimo entre el y1 del span objetivo y <code>fitz_rect.y1</code>). Solo spans con solapamiento vertical &gt;30% se consideran texto objetivo. Esto evita que <code>draw_rect</code> tape descenders de la línea superior o ascenders de la línea inferior.' },
                    { type: 'fix', text: '<strong>Surgical — redact rects verticalmente acotados en apply_reflow_edit:</strong> En el modo quirúrgico, los <code>add_redact_annot</code> para <code>_spans_inside_x</code> y <code>_spans_overflow_x</code> usan <code>_sr_y0 = max(span.y0, orig_rect.y0)</code> y <code>_sr_y1 = min(span.y1, orig_rect.y1)</code> en todos los sub-caminos (CIDFont colateral, desbordante, normal), garantizando que <code>apply_redactions()</code> nunca invada el espacio vertical de líneas adyacentes.' },
                    { type: 'fix', text: '<strong>Surgical — causa raíz: span colateral CIDFont con y1 &gt; orig_rect.y0 borraba la línea de arriba:</strong> Cuando la línea superior tiene descenders que bajan hasta el interior del rect de edición, ni <code>draw_rect</code> ni <code>add_redact_annot</code> deben empezar en <code>orig_rect.y0</code> puro. Fix: en <code>eraseTextRegion</code> se computa <code>_max_collateral_y1</code> (el y1 más bajo de spans no-objetivo que cruzan <code>fitz_rect.y0</code>) y se eleva <code>_erase_y0</code> a ese valor. En <code>apply_reflow_edit</code> el mismo cálculo genera <code>_safe_redact_y0 = max(orig_rect.y0, _max_collateral_y1)</code> que se usa como límite inferior del <code>add_redact_annot</code>, evitando que <code>apply_redactions()</code> borre el stream del span de arriba.' }
                ]
            },
            {
                version: "11.28",
                items: [
                    { type: "fix", text: "<strong>Formularios Automáticos — Debounce:</strong> Guard de concurrencia en detección freeform — evita disparar múltiples peticiones AI por clics rápidos." },
                    { type: "fix", text: "<strong>Vision — Gemini 429:</strong> Retry automático con backoff (1.5s, 3s) al recibir rate limit de Gemini." },
                    { type: "fix", text: "<strong>Vision — Groq red bloqueada:</strong> Timeout de 8s en llamadas Groq; si la red los bloquea (ERR_CONNECTION_ABORTED), falla rápido y cae a Gemini sin reintentar." },
                    { type: "fix", text: "<strong>Proxy Python — ERR_CONNECTION_ABORTED:</strong> Manejo robusto de ConnectionResetError, BrokenPipeError y URLError — el proxy retorna JSON de error limpio en lugar de abortar la conexión con el browser." }
                ]
            },
            {
                version: "11.27",
                items: [
                    { type: "feat", text: "<strong>Proxy local Python:</strong> Interceptor de fetch activo en localhost — todas las llamadas a Gemini y Groq se redirigen automáticamente al servidor proxy sin exponer claves en el navegador." },
                    { type: "fix", text: "<strong>Formularios Automáticos — Formato Libre:</strong> El prompt ahora instruye al modelo a emitir cada campo una sola vez. Se añadió dedup por label post-proceso." },
                    { type: "fix", text: "<strong>Formularios Automáticos — JSON truncado:</strong> Trailing comma eliminada antes de cerrar el array reparado. max_tokens aumentado a 4000 en llamadas vision." },
                    { type: "fix", text: "<strong>Groq:</strong> Modelos deprecados eliminados de la lista de fallback. Keys embebidas expiradas removidas; solo se usa la key del usuario." },
                    { type: "fix", text: "<strong>Gemini:</strong> Modelo actualizado de gemini-2.0-flash-exp a gemini-2.0-flash en todas las llamadas." }
                ]
            },
            {
                version: "11.26",
                items: [
                    { type: "fix", text: "<strong>Formularios Autom00e1ticos 2014 JSON truncado:</strong> Reparaci00f3n de bbox_norm incompletos, comillas tipogr00e1ficas y trailing commas antes del JSON.parse. El array se cierra autom00e1ticamente si la IA corta la respuesta." },
                    { type: "fix", text: "<strong>DIBUJAR 2014 Agrupar:</strong> Bot00f3n reemplazado por el mismo icono y l00f3gica del bot00f3n de INPUTS." },
                    { type: "fix", text: "<strong>Shortcut picker INPUTS:</strong> 201cAgrupar / Desagrupar201d disponible en el cat00e1logo del tab INPUTS." },
                    { type: "fix", text: "<strong>Men00fa contextual shortcuts:</strong> Eliminada opci00f3n redundante 201cAgregar Atajo201d en todas las pesta00f1as; quedan solo 201cCambiar Atajo201d y 201cEliminar201d." },
                    { type: "fix", text: "<strong>Contextmenu shortcuts:</strong> Clic derecho habilitado en botones de IMAGEN, DIBUJAR, FORMX y MAGIC." },
                    { type: "fix", text: "<strong>Formularios Autom00e1ticos 2014 Preview:</strong> La previsualización permanece oculta al abrir el modal hasta seleccionar 00e1rea o p00e1gina." }
                ]
            },
            {
                version: '11.25',
                items: [
                    { type: 'fix', text: '<strong>Modal Tablas Detectadas:</strong> Tamaño ampliado a min(95vw,1100px) y 88vh.' },
                    { type: 'feat', text: '<strong>INPUTS:</strong> Botón Agrupar/Desagrupar añadido a la izquierda del grupo SHORTCUT.' },
                    { type: 'feat', text: '<strong>INICIO:</strong> Tercer acceso directo (slot 3) en grupo SHORTCUT.' },
                    { type: 'feat', text: '<strong>SHORTCUT universal:</strong> Grupo de 1 acceso directo añadido a pestañas IMAGEN, DIBUJAR y MAGIC. Clic derecho para configurar.' },
                    { type: 'fix', text: '<strong>Renombrado:</strong> "Tabla a Formulario IA" → "Formularios Automáticos" en botón, modal y atajos rápidos.' },
                    { type: 'fix', text: '<strong>Renombrado:</strong> "Selección Caja" → "Seleccionar Objetos" en botón y modal de atajos rápidos.' }
                ]
            },
            {
                version: '11.24',
                items: [
                    { type: 'fix', text: '<strong>Formularios Automáticos — JSON:</strong> Sanitización de comillas tipográficas, trailing commas y saltos de línea. Recuperación de JSON truncado por límite de tokens.' },
                    { type: 'fix', text: '<strong>Formularios Automáticos — Groq:</strong> max_tokens aumentado a 4000. Prompt limita a 30 campos máximo.' },
                    { type: 'feat', text: '<strong>INPUTS:</strong> Botón Agrupar/Desagrupar (primera entrega, movido en 11.25).' },
                    { type: 'fix', text: '<strong>Modal Formularios Automáticos:</strong> Previsualización oculta hasta que se analice una página o área.' }
                ]
            },
            {
                version: '11.22',
                items: [
                    { type: 'fix', text: '<strong>Modal arrastrar archivos — transparencia:</strong> Forzado via inline style para garantizar <code>rgba(26,32,53,0.28)</code> con <code>backdrop-filter:blur(20px)</code>.' }
                ]
            },
            {
                version: '11.21',
                items: [
                    { type: 'fix', text: '<strong>Modal arrastrar archivos — transparencia:</strong> Añadida regla CSS específica <code>#drop-modal-content.glass-box</code> con <code>!important</code>.' }
                ]
            },
            {
                version: '11.20',
                items: [
                    { type: 'fix', text: '<strong>Modal arrastrar archivos — miniaturas:</strong> Fondo del contenedor de miniaturas cambiado a <code>rgba(0,0,0,0.85)</code>.' }
                ]
            },
            {
                version: '11.19',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — border-radius:</strong> Reducido de 14px a 10px en las 4 esquinas del <code>.ribbon-container</code>.' }
                ]
            },
            {
                version: '11.18',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — esquinas superiores:</strong> <code>border-radius</code> aplicado a las 4 esquinas (14px).' }
                ]
            },
            {
                version: '11.17',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — wrapper color:</strong> Fondo del <code>#ribbon-capsule-wrapper</code> cambiado a <code>var(--primary)</code> para coincidir con el header.' }
                ]
            },
            {
                version: '11.16',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — esquinas visibles:</strong> Wrapper cambiado a <code>var(--bg-main)</code> para contrastar con el ribbon y hacer visibles las esquinas redondeadas.' }
                ]
            },
            {
                version: '11.15',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — forma cápsula:</strong> Revertido padding del wrapper; <code>border-radius: 0 0 14px 14px</code> solo en esquinas inferiores.' }
                ]
            },
            {
                version: '11.14',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — forma cápsula:</strong> Restaurado <code>border-radius:20px</code> en <code>.ribbon-container</code> y <code>border-bottom:none</code> para eliminar línea blanca inferior.' }
                ]
            },
            {
                version: '11.13',
                items: [
                    { type: 'fix', text: '<strong>About — Posición:</strong> Botón subido 4px (<code>bottom:4px</code>).' }
                ]
            },
            {
                version: '11.12',
                items: [
                    { type: 'fix', text: '<strong>Propiedades de campo — Botón ✕:</strong> Color cambiado a <code>rgba(200,210,255,0.7)</code> para ser visible sobre fondo glass oscuro.' },
                    { type: 'fix', text: '<strong>Propiedades de campo — Escape:</strong> El modal ahora se cierra con Escape al agregarlo a <code>closeAllModals()</code>, que ya es llamado por el handler global de teclado.' }
                ]
            },
            {
                version: '11.11',
                items: [
                    { type: 'fix', text: '<strong>About — Posición:</strong> Botón About bajado 10px adicionales (<code>bottom:0px</code>).' },
                    { type: 'fix', text: '<strong>Tabla→Formulario IA — Menú contextual:</strong> Aplicada transparencia glass (<code>rgba(26,32,53,0.63)</code>, <code>backdrop-filter:blur(12px)</code>, borde <code>rgba(255,255,255,0.18)</code>) igual que los demás menús contextuales.' },
                    { type: 'fix', text: '<strong>Tabla→Formulario IA — Modal Propiedades:</strong> Aplicada transparencia glass al modal. Select de tipo de campo con mayor altura (<code>36px</code>, padding aumentado) para que el valor seleccionado sea visible.' }
                ]
            },
            {
                version: '11.10',
                items: [
                    { type: 'fix', text: '<strong>Ribbon — Línea blanca eliminada:</strong> Quitado <code>border-bottom</code> del ribbon en modo glass (claro y oscuro). El <code>background</code> del wrapper cambiado de <code>var(--primary)</code> a <code>var(--bg-ribbon)</code> para evitar filtración de 1px.' },
                    { type: 'fix', text: '<strong>Toggle Ribbon — Posición corregida:</strong> El toggle queda pegado al borde inferior del ribbon en todos los estados: expandido (<code>top:127px</code>), colapsado (<code>top:87px</code>) y hover-expand (<code>top:127px</code>).' },
                    { type: 'fix', text: '<strong>Toggle Ribbon — Animación hover-expand:</strong> Restaurado el selector CSS faltante <code>body.ribbon-is-hovering #ribbonTab</code> que impedía que el toggle se moviera al expandir por hover.' }
                ]
            },
            {
                version: '11.09',
                items: [
                    { type: 'fix', text: '<strong>Herramientas — Botón Selección permanente:</strong> Ya no se desactiva al hacer click; permanece activo mientras no se elija otra herramienta.' },
                    { type: 'fix', text: '<strong>About — Reubicado al borde inferior centrado:</strong> El botón About se movió a la parte inferior de la app, centrado horizontalmente.' },
                    { type: 'fix', text: '<strong>About — Changelog visible:</strong> Corregido error de sintaxis (llave faltante en v11.02) que impedía renderizar el changelog.' }
                ]
            },
            {
                version: '11.08',
                items: [
                    { type: 'fix', text: '<strong>Formularios Automáticos — Iconos alineados:</strong> Botones Re-detectar, Re-analizar y Generar Campos usan flex+align-items:center para alinear SVG e icono con el texto.' },
                    { type: 'fix', text: '<strong>Formularios Automáticos — Reset canvas:</strong> Al pulsar Re-detectar o Re-analizar se limpia el SVG overlay, los offsets de drag y la selección antes de re-renderizar.' },
                    { type: 'fix', text: '<strong>Formularios Automáticos — Iconos SVG:</strong> Header del modal y botones de Área de detección usan iconos SVG en lugar de emojis para coherencia visual.' },
                    { type: 'new', text: '<strong>Formularios Automáticos — Selección y eliminación:</strong> Click=seleccionar, Shift/Ctrl+Click=multi-selección. Barra de selección con contador y botón eliminar. Drag funciona en selección múltiple simultáneamente.' },
                    { type: 'new', text: '<strong>Formularios Automáticos — Menú contextual:</strong> Click derecho sobre campo(s) muestra menú con Propiedades, Seleccionar todos, y Eliminar. El diálogo de Propiedades permite editar etiqueta, tipo e incluir/excluir.' }
                ]
            },
            {
                version: '11.02',
                items: [
                    { type: 'fix', text: '<strong>Formularios Automáticos — Valores por defecto:</strong> El modal ahora abre con los valores correctos: Última fila excluir ✓, Etiquetas ✗, Borde 0px, Radio 0px, Opacidad 0%, Sep.V 0, Sep.H 2, Ancho 100%, Alto 78%.' },
                    { type: 'fix', text: '<strong>Formularios Automáticos — Preview bordes:</strong> Cuando borde=0 o "Ver bordes" desactivado, los campos se muestran con línea punteada delgada en la previsualización. Cambios de ancho, alto, opacidad y color se ven en tiempo real.' },
                    { type: 'fix', text: '<strong>Formularios Automáticos — AutoSize:</strong> Los campos generados ahora usan <code>fontSize=0</code> (PDF nativo auto-fit) en lugar de un tamaño fijo calculado.' }
                ]
            },
            {
                version: '11.01',
                items: [
                    { type: 'fix', text: '<strong>Formularios Automáticos — Sep. vertical default:</strong> Corregido de 5 a 0 pt.' },
                    { type: 'new', text: '<strong>Formularios Automáticos — Tamaño de campo:</strong> Nuevos controles "Ancho campo" y "Alto campo" (%) para reducir el campo dentro de la celda manteniéndolo centrado.' }
                ]
            },
            {
                version: '11.00',
                items: [
                    { type: 'fix', text: '<strong>AutoSize — fontSize calculado:</strong> Eliminado <code>fontSize=0 + NeedAppearances</code> (ignorado por Chrome/Edge/Firefox/PDF-XChange). Ahora se calcula <code>Math.min(14, Math.max(6, objH * 0.65))</code> — tamaño óptimo para la altura de celda, compatible con todos los visores.' },
                    { type: 'fix', text: '<strong>Resaltadores — sin BlendMode:</strong> Eliminado <code>BlendMode.Multiply</code> (causa canvas negro en visores que no lo implementan). Se usa solo <code>opacity:0.4</code> que funciona uniformemente en todos los visores.' }
                ]
            },
            {
                version: '10.99',
                items: [
                    { type: 'fix', text: '<strong>AutoSize — NeedAppearances:</strong> Después del re-apply de DA <code>0 Tf</code>, se setea <code>NeedAppearances=true</code> en el AcroForm dict para forzar que los visores recalculen el tamaño desde el DA en lugar de usar AP streams fijos. También se elimina AP del acroField raíz.' },
                    { type: 'fix', text: '<strong>Resaltadores — BlendMode Multiply:</strong> Reemplazada anotación Highlight (CA ignorado en Chrome/Edge/Firefox) por <code>drawRectangle</code> con <code>opacity:0.4</code> y <code>blendMode:Multiply</code> — transparencia uniforme en todos los visores.' }
                ]
            },
            {
                version: '10.98',
                items: [
                    { type: 'fix', text: '<strong>AutoSize persistente:</strong> El DA con <code>0 Tf</code> (auto-fit nativo PDF) ahora sobrevive al <code>updateFieldAppearances()</code> final.' },
                    { type: 'fix', text: '<strong>Resaltadores:</strong> Primera iteración — anotación Highlight nativa.' }
                ]
            },
            {
                version: '10.97',
                items: [
                    { type: 'fix', text: '<strong>Drag multiselección (ReferenceError):</strong> Corregido error <code>o is not defined</code> al arrastrar campos de formulario en selección múltiple — cambiado a <code>obj.id</code>.' },
                    { type: 'fix', text: '<strong>AutoSize overlay zoom (Bug 5):</strong> El <code>fontSize</code> del canvas overlay ahora se calcula dinámicamente según texto real y área del campo cuando <code>autoSize:true</code>.' },
                    { type: 'fix', text: '<strong>Fondo opaco TTF (Bug 3):</strong> Campos con <code>noBg:true</code> ya no generan fondo blanco opaco; el widget AcroField usa transparencia nativa.' },
                    { type: 'fix', text: '<strong>Estilo TTF ignorado (Bug 4):</strong> Los campos de "Formularios Automáticos" ahora respetan fondo, opacidad, borde y radio del usuario.' },
                    { type: 'fix', text: '<strong>AutoSize PDF-XChange (Bug 1):</strong> No se llama <code>updateAppearances()</code> cuando <code>autoSize:true</code>; se elimina AP stream y se escribe DA con <code>0 Tf</code> nativo.' },
                    { type: 'fix', text: '<strong>Bordes widget PDF-XChange (Bug 2):</strong> Para campos con <code>borderRadius=0</code>, el borde se establece en el widget AcroField directamente.' }
                ]
            },
            {
                version: '10.95',
                items: [
                    { type: 'fix', text: '<strong>Toggle Efecto Cristal:</strong> El efecto del ribbon (blur, gradiente, brillo metálico) ahora se desactiva correctamente al apagar el toggle en el modal de temas.' }
                ]
            },
            {
                version: '10.94',
                items: [
                    { type: 'fix', text: '<strong>Shortcuts Inputs — menú contextual:</strong> El bloqueador de clic derecho del ribbon (fase de captura) ahora excluye los botones de shortcut de la pestaña Inputs, igual que los de INICIO.' }
                ]
            },
            {
                version: '10.93',
                items: [
                    { type: 'fix', text: '<strong>Shortcuts Inputs — menú contextual:</strong> Reescrito para seguir el mismo patrón que INICIO. Usa targets <code>form1</code>/<code>form2</code> en lugar de flags frágiles, eliminando la dependencia de <code>_shortcutFormMode</code>.' }
                ]
            },
            {
                version: '10.92',
                items: [
                    { type: 'fix', text: '<strong>Menú contextual Shortcuts Inputs:</strong> Corregido — el picker de atajos ahora abre correctamente desde los botones de la pestaña Inputs. Se preserva el modo form a través de <code>openShortcutPicker</code>.' }
                ]
            },
            {
                version: '10.91',
                items: [
                    { type: 'new', text: '<strong>Efecto cristal/metálico en ribbon:</strong> El toolbar ahora tiene reflejo superior, gradiente metálico, backdrop-blur y sombras internas para un aspecto de vidrio esmerilado real. Adaptado para modo claro y oscuro.' }
                ]
            },
            {
                version: '10.90',
                items: [
                    { type: 'fix', text: '<strong>Versión única:</strong> La versión se gestiona exclusivamente desde <code>ALIOTH_VERSION</code>. El About y botones se actualizan automáticamente.' },
                    { type: 'change', text: '<strong>Label de versión del header eliminado:</strong> Se removió el indicador de versión flotante del encabezado.' }
                ]
            },
            {
                version: '10.89',
                items: [
                    { type: 'new', text: '<strong>Logo oficial en About:</strong> El popup About ahora muestra el logo real de ALIOTH PDF.' },
                    { type: 'new', text: '<strong>Sistema de versión automático:</strong> La versión se gestiona como constante JS y el changelog se actualiza con cada entrega.' },
                    { type: 'fix', text: '<strong>Bordes en PDF:</strong> Los bordes de campos de formulario ahora se renderizan correctamente sobre cada campo en el PDF exportado.' },
                    { type: 'fix', text: '<strong>AutoSize en PDF:</strong> El auto-ajuste de texto en campos de formulario ahora persiste correctamente al exportar.' }
                ]
            },
            {
                version: '12.80',
                date: '2026-05-20',
                items: [
                    { type: 'fix', text: '<strong>Surgical — borrado vertical preciso (arriba y abajo):</strong> <code>eraseTextRegion</code> ahora clampea tanto <code>_erase_y0</code> (máximo entre el y0 del span objetivo y <code>fitz_rect.y0</code>) como <code>_erase_y1</code> (mínimo entre el y1 del span objetivo y <code>fitz_rect.y1</code>). Solo spans con solapamiento vertical >30% se consideran texto objetivo. Esto evita que <code>draw_rect</code> tape descenders de la línea superior o ascenders de la línea inferior.' },
                    { type: 'fix', text: '<strong>Surgical — redact rects verticalmente acotados en apply_reflow_edit:</strong> En el modo quirúrgico, los <code>add_redact_annot</code> para <code>_spans_inside_x</code> y <code>_spans_overflow_x</code> usan <code>_sr_y0 = max(span.y0, orig_rect.y0)</code> y <code>_sr_y1 = min(span.y1, orig_rect.y1)</code> en todos los sub-caminos (CIDFont colateral, desbordante, normal), garantizando que <code>apply_redactions()</code> nunca invada el espacio vertical de líneas adyacentes.' }
                ]
            },
            {
                version: '12.79',
                items: [
                    { type: 'fix', text: '<strong>Debug overlay position:</strong> Agrega <code>🔴 [OVERLAY-POS]</code> en consola al activar el textarea de edición real, reportando <code>el.style.left/top</code>, <code>getBoundingClientRect</code> del overlay y del canvas, y el parentElement. Permite diagnosticar el desplazamiento horizontal del textarea.' }
                ]
            },
            {
                version: '12.78',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — cobertura de glifo CIDFont residual usa bbox exacto del stream:</strong> Los intentos anteriores usaban estimaciones por margen (<code>font_size * 1.2</code>, <code>font_size * 2</code>) que cubrían texto visible adyacente. Fix: <code>get_text(rawdict)</code> se ejecuta con el mismo clip (<code>orig_rect + (-2,-2,2,2)</code>) inmediatamente después de <code>apply_redactions</code>. El <code>draw_rect</code> usa <code>residual.bbox[0]</code> exacto; si no hay span residual tocando <code>orig_rect.x0</code>, el draw_rect se omite completamente.' }
                ]
            },
            {
                version: '12.77',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — draw_rect de cobertura tapaba glifos visibles ("co" de "Médico"):</strong> El margen fijo <code>font_size * 1.2</code> era demasiado amplio y cubría glifos que debían quedar visibles. Fix: se calcula el bbox exacto del span residual CIDFont con <code>get_text</code> inmediatamente después de <code>apply_redactions</code>, y el <code>draw_rect</code> usa <code>residual.bbox[0]</code> como x0 en lugar del margen estimado.' }
                ]
            },
            {
                version: '12.76',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — draw_rect de cobertura borraba texto adyacente visible:</strong> El <code>draw_rect</code> blanco post-redact que cubre el glifo residual CIDFont en el borde izquierdo usaba <code>_sb[0]</code> como x0, tapando todo el texto izquierdo (ej. "Médico" completo). Fix: el rect ahora empieza en <code>orig_rect.x0 - font_size * 1.2</code>, cubriendo solo el ancho máximo de un glifo residual.' }
                ]
            },
            {
                version: '12.75',
                items: [
                    { type: 'fix', text: '<strong>Edición Real — glifo CIDFont cortado en borde izquierdo:</strong> Al editar un sub-span dentro de un span CIDFont más amplio (ej. "Laboral" dentro de "Médico Laboral"), el glifo final del lado izquierdo (ej. "o" de "Médico") quedaba visualmente cortado porque su bbox tocaba <code>orig_rect.x0</code>. Fix: después de <code>apply_redactions</code>, se aplica <code>draw_rect</code> blanco sobre <code>[span.x0 .. orig_rect.x0 + 1]</code> para cubrir completamente el residuo visual del glifo partido.' }
                ]
            },
            {
                version: '12.74',
                items: [
                    { type: 'fix', text: '<strong>Vista continua automática al abrir documento:</strong> <code>switchTab</code> fuerza <code>viewMode = \'continuous\'</code> siempre que se abre o cambia de documento.' },
                    { type: 'fix', text: '<strong>Edición Real — borrado de texto adyacente (spans CIDFont con colateral arriba):</strong> En el caso <code>_has_unreadable_collateral</code>, se eliminó el <code>add_redact_annot</code> que destruía el span superior cuyo <code>bbox[3]</code> tocaba el rect de edición. Ahora solo se usa <code>draw_rect</code> para cubrir visualmente.' },
                    { type: 'fix', text: '<strong>Edición Real — borrado de texto adyacente (spans que cruzan el límite X):</strong> En el caso <code>elif _target_spans</code>, los spans cuyo bbox se extiende fuera del rect X del área editada usan <code>draw_rect</code> en lugar de <code>add_redact_annot</code>, evitando que <code>apply_redactions</code> elimine el texto fuera del área editada.' }
                ]
            },
            {
                version: '10.88',
                items: [
                    { type: 'new', text: '<strong>Tablas a Formulario con IA:</strong> Detecta tablas en tu PDF y las convierte automáticamente en campos de formulario editables.' },
                    { type: 'new', text: '<strong>Shortcuts en pestaña Inputs:</strong> Accesos rápidos independientes en la pestaña Inputs.' },
                    { type: 'new', text: '<strong>Propiedades en grupo:</strong> Click derecho sobre selección múltiple aplica propiedades a todos los objetos del mismo tipo.' },
                    { type: 'change', text: '<strong>Efecto cristal:</strong> Ahora solo se aplica al ribbon de herramientas.' }
                ]
            }
        ];
        window.ALIOTH_CHANGELOG = ALIOTH_CHANGELOG;
