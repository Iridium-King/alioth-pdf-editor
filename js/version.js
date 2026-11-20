const ALIOTH_VERSION = '3.2.49';
window.ALIOTH_VERSION = ALIOTH_VERSION;

const ALIOTH_CHANGELOG = [
    {
        version: '3.2.49',
        date: '2026-11-20',
        items: [
            { type: 'new', text: '<strong>Edición de imágenes:</strong> Selecciona una imagen incrustada con un clic o arrastra para seleccionar un área de un escaneo. Puedes moverla, redimensionarla o borrarla, con Deshacer y Rehacer.' },
            { type: 'new', text: '<strong>Preferencias → Apariencia:</strong> Acceso a Temas y colores y escala independiente para la cabecera, la barra lateral y la cinta. Los cambios se aplican en vivo y se guardan automáticamente.' },
            { type: 'fix', text: '<strong>Ajustar al ancho:</strong> Conserva la página activa y la posición dentro de ella al cambiar el zoom.' },
            { type: 'improve', text: '<strong>Selectores de color:</strong> Muestras cuadradas con esquinas redondeadas en la cinta y los modales.' }
        ]
    },
    {
        version: '3.2.48',
        date: '2026-11-19',
        items: [
            { type: 'fix', text: '<strong>Arranque en Windows:</strong> Alioth reintenta las lecturas locales que se atascan. Si la interfaz sigue sin responder, intenta abrir la vista sin aceleración gráfica durante esa sesión.' }
        ]
    },
    {
        version: '3.2.44',
        date: '2026-11-19',
        items: [
            { type: 'fix', text: '<strong>Protección PDF:</strong> Guardar como conserva la contraseña y las restricciones en los siguientes guardados de la sesión. Se aplica la mitigación de Mozilla para PDF.js y la CLI conserva el cifrado y los permisos en las operaciones compatibles.' },
            { type: 'fix', text: '<strong>OCR:</strong> Reconoce español e inglés con los recursos incluidos y permite reintentar tras un fallo.' },
            { type: 'improve', text: '<strong>Automatización:</strong> Reemplaza las coincidencias verificadas y ofrece limpiar los datos ocultos al censurar.' }
        ]
    },
    {
        version: '3.2.42',
        date: '2026-11-19',
        items: [
            { type: 'improve', text: '<strong>Quitar fondo:</strong> Conserva la resolución original y la transparencia al guardar, incluso con compresión. La cinta de Imagen incorpora un control de nitidez.' }
        ]
    },
    {
        version: '3.2.40',
        date: '2026-11-18',
        items: [
            { type: 'new', text: '<strong>Zoom del documento:</strong> Control flotante con porcentaje editable y opción para ajustar la página completa.' }
        ]
    },
    {
        version: '3.2.39',
        date: '2026-11-18',
        items: [
            { type: 'new', text: '<strong>CLI y MCP:</strong> El ejecutable del editor también ejecuta comandos PDF y sirve MCP por stdio. El paquete incluye el servidor MCP independiente.' },
            { type: 'fix', text: '<strong>Guardar como:</strong> La copia se abre con el nombre y la ubicación elegidos. Los guardados siguientes usan ese destino.' },
            { type: 'fix', text: '<strong>Selección de páginas:</strong> Girar y voltear se aplican a todas las páginas seleccionadas en las miniaturas.' }
        ]
    },
    {
        version: '3.2.37',
        date: '2026-11-09',
        items: [
            { type: 'improve', text: '<strong>Motor avanzado:</strong> Las herramientas de imágenes, tablas y censura cargan el motor cuando lo necesitan y permiten reintentar si falla.' },
            { type: 'fix', text: '<strong>Imágenes incrustadas:</strong> La edición usa la página correcta del PDF después de insertar o reordenar páginas.' }
        ]
    },
    {
        version: '3.2.36',
        date: '2026-11-05',
        items: [
            { type: 'improve', text: '<strong>Fuentes:</strong> Usa las fuentes instaladas de Windows para la vista y la exportación, con alternativas libres cuando falten.' },
            { type: 'improve', text: '<strong>Distribución:</strong> Construcción reproducible con dependencias fijadas y exclusión de la configuración personal.' }
        ]
    },
    {
        version: '3.2.35',
        date: '2026-11-04',
        items: [
            { type: 'fix', text: '<strong>Procesos huérfanos:</strong> Limpieza de procesos propios de Alioth que perdieron su ventana, tras verificar su identidad y propietario.' }
        ]
    },
    {
        version: '3.2.34',
        date: '2026-11-04',
        items: [
            { type: 'fix', text: '<strong>Arrastrar y soltar:</strong> Guarda los cambios en el archivo de origen y conserva su ruta al insertar otros PDF.' },
            { type: 'fix', text: '<strong>Vista ocupada:</strong> Espera la respuesta de WebView2 y conserva los cambios en memoria cuando la vista se recupera.' }
        ]
    },
    {
        version: '3.2.33',
        date: '2026-10-22',
        items: [
            { type: 'fix', text: '<strong>Reapertura del portable:</strong> El servidor local se mantiene activo durante la reapertura y mientras haya una ventana del editor en uso.' }
        ]
    },
    {
        version: '3.2.25',
        date: '2026-10-21',
        items: [
            { type: 'improve', text: '<strong>Inicio:</strong> El editor arranca con una pestaña vacía y conserva las preferencias y el modo lectura.' }
        ]
    },
    {
        version: '3.2.23',
        date: '2026-10-21',
        items: [
            { type: 'fix', text: '<strong>Guardado seguro:</strong> Espera las ediciones de texto pendientes y protege el archivo ante escrituras simultáneas y cambios externos.' },
            { type: 'improve', text: '<strong>Uso de recursos:</strong> Carga diferida de los PDF y límites de memoria para miniaturas e historial.' },
            { type: 'fix', text: '<strong>Traducción:</strong> El PDF exportado conserva el texto original junto a la traducción cuando se guarda como notas.' }
        ]
    },
    {
        version: '3.2.22',
        date: '2026-10-21',
        items: [
            { type: 'new', text: '<strong>Ventana nativa de Windows:</strong> WebView2 integra las pestañas en la barra de título y ofrece controles para recuperar la vista si falla.' },
            { type: 'fix', text: '<strong>Migración a WebView2:</strong> La transferencia conserva los datos y preferencias locales.' }
        ]
    },
    {
        version: '3.2.19',
        date: '2026-10-19',
        items: [
            { type: 'new', text: '<strong>Temas:</strong> Ajustes independientes para los modos claro y oscuro, temas personalizados y favoritos reordenables.' }
        ]
    },
    {
        version: '3.2.6',
        date: '2026-10-18',
        items: [
            { type: 'new', text: '<strong>Preferencias:</strong> Añade ayuda integrada y atajos personalizables conectados con la paleta de comandos.' },
            { type: 'improve', text: '<strong>Búsqueda en el PDF:</strong> Control flotante al que se accede con Ctrl+F.' }
        ]
    },
    {
        version: '3.2.0',
        date: '2026-10-18',
        items: [
            { type: 'new', text: '<strong>Edición de texto:</strong> Reemplaza texto nativo directamente en el contenido del PDF.' },
            { type: 'new', text: '<strong>Paleta de comandos:</strong> Busca herramientas y acciones con Ctrl+K.' },
            { type: 'new', text: '<strong>Capas y propiedades:</strong> Control de visibilidad de capas PDF y un inspector de seguridad, fuentes y propiedades avanzadas.' },
            { type: 'new', text: '<strong>Vista de libro:</strong> Muestra dos páginas lado a lado con la opción de dejar la portada sola.' },
            { type: 'improve', text: '<strong>Combinar PDF:</strong> Conserva los marcadores de cada documento en su propia sección.' }
        ]
    },
    {
        version: '3.1.1',
        date: '2026-09-30',
        items: [
            { type: 'new', text: '<strong>Captura inteligente:</strong> Busca imágenes similares, traduce o pide una explicación de un área del documento.' }
        ]
    },
    {
        version: '3.1.0',
        date: '2026-09-28',
        items: [
            { type: 'new', text: '<strong>Inicio de la serie pública:</strong> Alioth PDF Editor adopta la numeración 3.x para sus versiones de producción.' },
            { type: 'fix', text: '<strong>Portable de Windows:</strong> Verifica el certificado incluido y registra la ruta del ejecutable para abrir archivos PDF.' }
        ]
    }
];

window.ALIOTH_CHANGELOG = ALIOTH_CHANGELOG;
