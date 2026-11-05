(() => {
    const locales = ['es', 'en', 'it', 'fr', 'de', 'ja', 'ko', 'zh', 'zh-TW'];
    const common = {
        contact: 'aliothgm@gmail.com',
        project: 'ALIOTH TDAH LABS - OPEN SOURCE PROJECT',
        version: '13.26'
    };
    const actions = {
        es: { local: 'Continuar solo con edición local', ai: 'Aceptar aviso y activar IA', details: 'Ver información legal completa' },
        en: { local: 'Continue with local editing only', ai: 'Accept notice and enable AI', details: 'View full legal information' },
        it: { local: 'Continua solo con modifica locale', ai: 'Accetta l’avviso e attiva l’IA', details: 'Vedi tutte le informazioni legali' },
        fr: { local: 'Continuer avec l’édition locale', ai: 'Accepter l’avis et activer l’IA', details: 'Voir toutes les informations légales' },
        de: { local: 'Nur lokal bearbeiten', ai: 'Hinweis akzeptieren und KI aktivieren', details: 'Vollständige rechtliche Hinweise' },
        ja: { local: 'ローカル編集のみで続ける', ai: '通知に同意して AI を有効化', details: '法的情報をすべて表示' },
        ko: { local: '로컬 편집만 계속', ai: '안내에 동의하고 AI 사용', details: '전체 법률 정보 보기' },
        zh: { local: '仅继续本地编辑', ai: '接受提示并启用 AI', details: '查看完整法律信息' },
        'zh-TW': { local: '僅繼續本機編輯', ai: '接受提示並啟用 AI', details: '查看完整法律資訊' }
    };
    const copy = {
        es: {
            terms: { title: 'Condiciones de uso', body: 'ALIOTH PDF EDITOR se ofrece gratuitamente y sin garantía. El uso, la revisión de los resultados, la conservación de copias de seguridad y el cumplimiento de la ley aplicable son responsabilidad de la persona usuaria. En la medida permitida por la ley, el proyecto, sus colaboradores y sus integrantes no responden por pérdidas, interrupciones, errores o daños derivados del uso. Estas condiciones no excluyen derechos irrenunciables.' },
            privacy: { title: 'Privacidad y datos', body: 'La edición local se realiza en tu equipo. La aplicación guarda preferencias, historial y credenciales en almacenamiento local del usuario; no existe una cuenta ni un servidor propio de Alioth para recibir documentos. Si activas una función externa, el texto, imágenes o archivos necesarios se envían al proveedor que selecciones mediante tu propia API key. Revisa sus políticas, retención, ubicación y transferencias internacionales. No envíes información sensible sin autorización.' },
            ai: { title: 'Aviso de inteligencia artificial', body: 'Algunas funciones usan inteligencia artificial de terceros (Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio u otros proveedores configurados). Las respuestas pueden ser incompletas, incorrectas o no adecuadas para decisiones profesionales. Necesitas tus propias API keys; tú controlas sus permisos, límites, costos y contratos. Verifica siempre los resultados y conserva el documento original.' },
            licenses: { title: 'Licencia y componentes', body: 'El código de Alioth se publicará bajo AGPL-3.0-or-later. La distribución debe conservar los avisos de terceros y el código fuente correspondiente. Incluye PyMuPDF/MuPDF (AGPL o licencia comercial de Artifex), PDF.js, Pyodide y otras dependencias con sus propias condiciones. Consulta los avisos incluidos en la distribución.' }
        },
        en: {
            terms: { title: 'Terms of use', body: 'ALIOTH PDF EDITOR is provided free of charge and without warranty. The user is responsible for use, result review, backups and compliance with applicable law. To the extent permitted by law, the project, contributors and members are not liable for loss, interruption, errors or damage arising from use. These terms do not exclude non-waivable rights.' },
            privacy: { title: 'Privacy and data', body: 'Local editing happens on your device. The app stores preferences, history and credentials in the user’s local storage; Alioth has no account or own server receiving documents. When you enable an external feature, the necessary text, images or files are sent to your selected provider using your own API key. Review that provider’s policies, retention, location and international transfers. Do not send sensitive information without authorization.' },
            ai: { title: 'Artificial intelligence notice', body: 'Some features use third-party artificial intelligence (Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio or other configured providers). Results may be incomplete, incorrect or unsuitable for professional decisions. You need your own API keys; you control their permissions, limits, costs and contracts. Always verify results and keep the original document.' },
            licenses: { title: 'License and components', body: 'Alioth code will be published under AGPL-3.0-or-later. Distribution must preserve third-party notices and corresponding source code. It includes PyMuPDF/MuPDF (AGPL or Artifex commercial license), PDF.js, Pyodide and other dependencies with their own terms. See the notices included with the distribution.' }
        },
        it: {
            terms: { title: 'Condizioni d’uso', body: 'ALIOTH PDF EDITOR è fornito gratuitamente e senza garanzia. L’utente è responsabile dell’uso, della verifica dei risultati, dei backup e del rispetto della legge applicabile. Nei limiti consentiti dalla legge, il progetto, i collaboratori e i membri non rispondono di perdite, interruzioni, errori o danni derivanti dall’uso. Restano salvi i diritti inderogabili.' },
            privacy: { title: 'Privacy e dati', body: 'La modifica locale avviene sul tuo dispositivo. L’app salva preferenze, cronologia e credenziali nell’archiviazione locale dell’utente; Alioth non dispone di account né di un proprio server che riceva documenti. Quando attivi una funzione esterna, il testo, le immagini o i file necessari sono inviati al fornitore scelto usando la tua API key. Controlla le sue politiche, conservazione, ubicazione e trasferimenti internazionali. Non inviare dati sensibili senza autorizzazione.' },
            ai: { title: 'Avviso sull’intelligenza artificiale', body: 'Alcune funzioni usano intelligenza artificiale di terze parti (Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio o altri fornitori configurati). I risultati possono essere incompleti, errati o inadatti a decisioni professionali. Servono le tue API key; controlli permessi, limiti, costi e contratti. Verifica sempre i risultati e conserva il documento originale.' },
            licenses: { title: 'Licenza e componenti', body: 'Il codice Alioth sarà pubblicato con AGPL-3.0-or-later. La distribuzione deve conservare gli avvisi di terze parti e il codice sorgente corrispondente. Include PyMuPDF/MuPDF (AGPL o licenza commerciale Artifex), PDF.js, Pyodide e altre dipendenze con condizioni proprie. Consulta gli avvisi inclusi nella distribuzione.' }
        },
        fr: {
            terms: { title: 'Conditions d’utilisation', body: 'ALIOTH PDF EDITOR est fourni gratuitement et sans garantie. L’utilisateur est responsable de l’usage, de la vérification des résultats, des sauvegardes et du respect de la loi applicable. Dans la mesure permise par la loi, le projet, ses contributeurs et ses membres ne sont pas responsables des pertes, interruptions, erreurs ou dommages liés à l’utilisation. Les droits impératifs restent applicables.' },
            privacy: { title: 'Vie privée et données', body: 'La modification locale s’effectue sur votre appareil. L’application conserve les préférences, l’historique et les identifiants dans le stockage local de l’utilisateur ; Alioth n’a ni compte ni serveur propre recevant les documents. Si vous activez une fonction externe, le texte, les images ou fichiers nécessaires sont envoyés au fournisseur choisi avec votre propre clé API. Consultez ses règles, sa conservation, sa localisation et ses transferts internationaux. N’envoyez pas de données sensibles sans autorisation.' },
            ai: { title: 'Avis sur l’intelligence artificielle', body: 'Certaines fonctions utilisent l’intelligence artificielle de tiers (Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio ou d’autres fournisseurs configurés). Les résultats peuvent être incomplets, inexacts ou inadaptés aux décisions professionnelles. Vous devez utiliser vos propres clés API et contrôlez leurs droits, limites, coûts et contrats. Vérifiez toujours les résultats et gardez le document original.' },
            licenses: { title: 'Licence et composants', body: 'Le code Alioth sera publié sous AGPL-3.0-or-later. La distribution doit conserver les avis tiers et le code source correspondant. Elle inclut PyMuPDF/MuPDF (AGPL ou licence commerciale Artifex), PDF.js, Pyodide et d’autres dépendances soumises à leurs propres conditions. Consultez les avis fournis avec la distribution.' }
        },
        de: {
            terms: { title: 'Nutzungsbedingungen', body: 'ALIOTH PDF EDITOR wird kostenlos und ohne Garantie bereitgestellt. Die nutzende Person ist für Verwendung, Prüfung der Ergebnisse, Sicherungskopien und die Einhaltung geltenden Rechts verantwortlich. Soweit gesetzlich zulässig, haften Projekt, Mitwirkende und Mitglieder nicht für Verluste, Unterbrechungen, Fehler oder Schäden aus der Nutzung. Unabdingbare Rechte bleiben unberührt.' },
            privacy: { title: 'Datenschutz und Daten', body: 'Die lokale Bearbeitung erfolgt auf Ihrem Gerät. Die Anwendung speichert Einstellungen, Verlauf und Zugangsdaten im lokalen Speicher des Nutzers; Alioth betreibt weder Konto noch eigenen Server, der Dokumente empfängt. Bei aktivierter externer Funktion werden erforderliche Texte, Bilder oder Dateien mit Ihrem eigenen API-Schlüssel an den gewählten Anbieter gesendet. Prüfen Sie dessen Richtlinien, Aufbewahrung, Standort und internationale Übermittlungen. Senden Sie sensible Daten nur mit Berechtigung.' },
            ai: { title: 'Hinweis zu künstlicher Intelligenz', body: 'Einige Funktionen nutzen KI-Dienste Dritter (Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio oder konfigurierte weitere Anbieter). Ergebnisse können unvollständig, falsch oder für berufliche Entscheidungen ungeeignet sein. Sie benötigen eigene API-Schlüssel und kontrollieren deren Rechte, Limits, Kosten und Verträge. Prüfen Sie Ergebnisse und bewahren Sie das Originaldokument auf.' },
            licenses: { title: 'Lizenz und Komponenten', body: 'Der Alioth-Code wird unter AGPL-3.0-or-later veröffentlicht. Die Distribution muss Hinweise Dritter und den zugehörigen Quellcode erhalten. Enthalten sind PyMuPDF/MuPDF (AGPL oder kommerzielle Artifex-Lizenz), PDF.js, Pyodide und weitere Abhängigkeiten mit eigenen Bedingungen. Beachten Sie die mitgelieferten Hinweise.' }
        },
        ja: {
            terms: { title: '利用条件', body: 'ALIOTH PDF EDITOR は無料かつ無保証で提供されます。利用、結果の確認、バックアップ、適用法令の遵守は利用者の責任です。法令で許される範囲で、プロジェクト、貢献者および関係者は、利用による損失、中断、誤りまたは損害について責任を負いません。強行法規上の権利は制限されません。' },
            privacy: { title: 'プライバシーとデータ', body: 'ローカル編集は端末上で行われます。設定、履歴、認証情報は利用者のローカルストレージに保存され、Alioth が文書を受け取るアカウントや独自サーバーはありません。外部機能を有効にすると、必要な文章、画像またはファイルが利用者自身の API キーで選択した提供者へ送信されます。提供者の方針、保存期間、所在地、国際移転を確認してください。許可なく機密情報を送信しないでください。' },
            ai: { title: '人工知能に関する通知', body: '一部の機能は第三者の AI（Gemini、Groq、Azure、Mistral、Hugging Face、OpenRouter、NVIDIA NIM、Fish Audio など）を使用します。結果は不完全または誤っている場合があり、専門的な判断には適しません。利用者自身の API キーが必要で、権限、上限、費用、契約は利用者が管理します。必ず結果を確認し、原本を保管してください。' },
            licenses: { title: 'ライセンスと構成要素', body: 'Alioth のコードは AGPL-3.0-or-later で公開されます。配布時は第三者の告知と対応するソースコードを保持してください。PyMuPDF/MuPDF（AGPL または Artifex 商用ライセンス）、PDF.js、Pyodide など、それぞれの条件がある依存関係を含みます。配布物の告知を確認してください。' }
        },
        ko: {
            terms: { title: '이용 약관', body: 'ALIOTH PDF EDITOR는 무료로, 보증 없이 제공됩니다. 사용, 결과 확인, 백업 및 관련 법률 준수는 사용자의 책임입니다. 법이 허용하는 범위에서 프로젝트와 기여자 및 관계자는 사용으로 인한 손실, 중단, 오류 또는 손해에 책임을 지지 않습니다. 강행법규상 권리는 제한되지 않습니다.' },
            privacy: { title: '개인정보 및 데이터', body: '로컬 편집은 사용자의 기기에서 수행됩니다. 앱은 설정, 기록 및 자격 증명을 사용자의 로컬 저장소에 보관하며 Alioth가 문서를 받는 계정이나 자체 서버는 없습니다. 외부 기능을 사용하면 필요한 텍스트, 이미지 또는 파일이 사용자의 API 키로 선택한 제공자에게 전송됩니다. 제공자의 정책, 보관, 위치 및 국제 이전을 확인하십시오. 권한 없이 민감한 정보를 보내지 마십시오.' },
            ai: { title: '인공지능 안내', body: '일부 기능은 제3자 AI(Gemini, Groq, Azure, Mistral, Hugging Face, OpenRouter, NVIDIA NIM, Fish Audio 등)를 사용합니다. 결과는 불완전하거나 틀릴 수 있으며 전문적 판단에 적합하지 않을 수 있습니다. 사용자의 API 키가 필요하고 권한, 한도, 비용 및 계약은 사용자가 관리합니다. 결과를 확인하고 원본 문서를 보관하십시오.' },
            licenses: { title: '라이선스 및 구성 요소', body: 'Alioth 코드는 AGPL-3.0-or-later로 공개됩니다. 배포 시 제3자 고지와 해당 소스 코드를 유지해야 합니다. PyMuPDF/MuPDF(AGPL 또는 Artifex 상용 라이선스), PDF.js, Pyodide 및 자체 조건이 있는 기타 의존성을 포함합니다. 배포물의 고지를 확인하십시오.' }
        },
        zh: {
            terms: { title: '使用条款', body: 'ALIOTH PDF EDITOR 免费提供且不作任何保证。使用、核查结果、备份以及遵守适用法律由用户负责。在法律允许的范围内，项目、贡献者和成员不对使用造成的损失、中断、错误或损害负责。不得排除适用法律规定的不可放弃权利。' },
            privacy: { title: '隐私与数据', body: '本地编辑在你的设备上完成。应用将设置、历史记录和凭据保存在用户本地存储中；Alioth 没有接收文档的账户或自有服务器。启用外部功能时，必要的文本、图像或文件会使用你自己的 API 密钥发送给你选择的提供商。请查看其政策、保留期限、地点和国际传输。未经授权不要发送敏感信息。' },
            ai: { title: '人工智能提示', body: '部分功能使用第三方人工智能（Gemini、Groq、Azure、Mistral、Hugging Face、OpenRouter、NVIDIA NIM、Fish Audio 或其他已配置提供商）。结果可能不完整或错误，不适合直接用于专业决定。你需要自己的 API 密钥，并负责权限、限制、费用和合同。请始终核查结果并保留原始文档。' },
            licenses: { title: '许可证与组件', body: 'Alioth 代码将按 AGPL-3.0-or-later 发布。分发时必须保留第三方声明和相应源代码。程序包含 PyMuPDF/MuPDF（AGPL 或 Artifex 商业许可证）、PDF.js、Pyodide 及其他拥有各自条款的依赖项。请查看分发包中的声明。' }
        },
        'zh-TW': {
            terms: { title: '使用條款', body: 'ALIOTH PDF EDITOR 免費提供且不作任何保證。使用、核查結果、備份以及遵守適用法律由使用者負責。在法律允許的範圍內，專案、貢獻者與成員不對使用造成的損失、中斷、錯誤或損害負責。不得排除適用法律規定的不可放棄權利。' },
            privacy: { title: '隱私與資料', body: '本機編輯在你的裝置上完成。應用程式將設定、歷史記錄與憑證保存在使用者的本機儲存中；Alioth 沒有接收文件的帳戶或自有伺服器。啟用外部功能時，必要的文字、影像或檔案會使用你自己的 API 金鑰傳送給你選擇的提供者。請查看其政策、保留期限、所在地與國際傳輸。未經授權不要傳送敏感資訊。' },
            ai: { title: '人工智慧提示', body: '部分功能使用第三方人工智慧（Gemini、Groq、Azure、Mistral、Hugging Face、OpenRouter、NVIDIA NIM、Fish Audio 或其他已設定提供者）。結果可能不完整或錯誤，不適合直接用於專業決策。你需要自己的 API 金鑰，並負責權限、限制、費用與合約。請始終核查結果並保留原始文件。' },
            licenses: { title: '授權與元件', body: 'Alioth 程式碼將依 AGPL-3.0-or-later 發布。散佈時必須保留第三方聲明與相應原始碼。程式包含 PyMuPDF/MuPDF（AGPL 或 Artifex 商業授權）、PDF.js、Pyodide 及其他具有各自條款的相依套件。請查看散佈包中的聲明。' }
        }
    };
    const windowsNotice = {
        title: 'Windows y firma local',
        body: 'Este portable intenta registrar Alioth como opción para abrir PDF e instalar su certificado público de firma local en Raíces de confianza del usuario actual. Se comprueba una sola vez por certificado y ubicación; un rechazo de la política también se recuerda. No se cambia el visor predeterminado ni se piden permisos de administrador. La firma es propia: no equivale a una firma de una autoridad pública ni garantiza que SmartScreen o el antivirus no muestren alertas. El monitor puede cerrar exclusivamente hosts de Alioth huérfanos y sin ventana, tras verificar su identidad y propietario.\n\nPara retirar la integración: cierra Alioth y elige antes otro visor PDF predeterminado si lo necesitas. En certmgr.msc, Raíces de confianza del usuario actual, elimina exclusivamente «Alioth PDF Editor Local Root 2026» tras comprobar su huella con Alioth-PDF-Local-Root.cer. En regedit, dentro de HKEY_CURRENT_USER, elimina Software\\Classes\\Alioth.PDF y Software\\AliothPDFEditor\\Capabilities; elimina solo el valor AliothPDFEditor en Software\\RegisteredApplications y solo el valor Alioth.PDF en Software\\Classes\\.pdf\\OpenWithProgids. Elimina también la entrada de esta copia en Software\\Classes\\Applications\\Alioth_PDF_Editor_Distribucion.exe (o Personal.exe), comprobando que su comando apunta al portable retirado. No borres las claves compartidas .pdf o RegisteredApplications. Puedes borrar el portable y sus preferencias en %LOCALAPPDATA%/AliothPDFEditor cuando ya no necesites sus datos. Si lo vuelves a abrir, intentará registrar de nuevo únicamente si falta el estado de primera apertura.\n\nFuentes: se utilizan los archivos instalados en Windows; no se redistribuyen fuentes de Microsoft. Si una fuente no está instalada se utiliza una alternativa libre Liberation; su aspecto puede variar. Las fuentes y estilos usados para medir y exportar texto son los mismos que recibe la vista.'
    };
    for (const locale of locales) copy[locale].windows = locale === 'es' ? windowsNotice : {
        title: 'Windows and local signing',
        body: 'On first launch, this portable attempts to add its local code-signing root to the current user trust store and register Alioth as a PDF opening option. Policy denials are remembered; changing the certificate or location triggers a new check. It does not change the default viewer or request administrator rights. Self-signing does not establish public CA trust or guarantee the absence of security alerts. Only verified orphaned Alioth hosts without windows may be terminated.\n\nTo remove integration, close Alioth and select another default PDF viewer first if needed. In certmgr.msc, remove only the current-user Trusted Root named Alioth PDF Editor Local Root 2026 after comparing its fingerprint with Alioth-PDF-Local-Root.cer. In regedit under HKEY_CURRENT_USER, remove Software\\Classes\\Alioth.PDF and Software\\AliothPDFEditor\\Capabilities; remove only the AliothPDFEditor value in Software\\RegisteredApplications and only the Alioth.PDF value in Software\\Classes\\.pdf\\OpenWithProgids. Remove the Applications entry for this portable only after checking its open command points to the copy being removed. Keep the shared registry keys. You can delete the portable and %LOCALAPPDATA%/AliothPDFEditor when its preferences are no longer needed. Deleting first-launch state allows setup to be attempted again.\n\nMicrosoft fonts are read from Windows rather than redistributed. Missing fonts use free Liberation fallbacks, whose appearance can differ. The same font bytes are used for display, measurement and PDF export.'
    };
    const noticeKey = 'alioth_legal_notice_v1';
    function getCopy(locale) { return copy[locale] || copy.es; }
    function getNoticeState(storage) {
        try { return storage?.getItem(noticeKey) || null; } catch (_) { return null; }
    }
    function setNoticeState(storage, state) {
        if (state !== 'local' && state !== 'ai') throw new Error('Invalid legal notice state');
        storage?.setItem(noticeKey, state);
    }
    function isAiEnabled(storage) { return getNoticeState(storage) === 'ai'; }
    function getActions(locale) { return actions[locale] || actions.es; }
    window.aliothLegal = { common, copy, actions, locales, noticeKey, getCopy, getActions, getNoticeState, setNoticeState, isAiEnabled };
})();
