import Cocoa
import WebKit
import Foundation
import CoreServices

class AliothAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var webView: WKWebView!
    var backendProcess: Process?
    var activePort: Int?
    var pendingFiles: [String] = []
    var initialLoaded = false
    var activeDownloads: [ObjectIdentifier: WKDownload] = [:]
    var sharingPicker: NSSharingServicePicker?
    var shareDirectories: [URL] = []
    var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        setupMenuBar()
        setupWindow()

        // Capture any PDF path passed on CLI
        for arg in CommandLine.arguments.dropFirst() {
            if !arg.hasPrefix("-") && arg.lowercased().hasSuffix(".pdf") {
                pendingFiles.append(arg)
            }
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startBackend()
    }

    func setupMenuBar() {
        let mainMenu = NSMenu()

        // App Menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "Acerca de Alioth PDF Editor", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Ocultar Alioth PDF Editor", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Ocultar otros", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Mostrar todo", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Salir de Alioth PDF Editor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // File Menu
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "Archivo")
        fileMenuItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "Abrir...", action: #selector(openDocument(_:)), keyEquivalent: "o")
        fileMenu.addItem(withTitle: "Guardar", action: #selector(saveDocument(_:)), keyEquivalent: "s")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "Imprimir...", action: #selector(printPage(_:)), keyEquivalent: "p")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        // Edit Menu (enables Cmd+C/V/X/A/Z in WKWebView)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edición")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // View Menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "Visualización")
        viewMenuItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Recargar", action: #selector(reloadPage(_:)), keyEquivalent: "r")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Tamaño real", action: #selector(resetZoom(_:)), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "Acercar interfaz", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Alejar interfaz", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        viewMenu.addItem(NSMenuItem.separator())
        let fullScreen = viewMenu.addItem(withTitle: "Pantalla completa", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]

        // Window Menu
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Ventana")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    func setupWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width = min(1440, screenFrame.width * 0.92)
        let height = min(920, screenFrame.height * 0.92)
        let rect = NSRect(
            x: screenFrame.midX - width / 2,
            y: screenFrame.midY - height / 2,
            width: width,
            height: height
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Alioth PDF Editor"
        window.minSize = NSSize(width: 900, height: 600)
        window.delegate = self
        window.setFrameAutosaveName("AliothMainWindow")
        window.isReleasedWhenClosed = false

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "alioth")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false

        let splashHTML = """
        <!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#121318;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px}
        .spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,.15);border-top-color:#60a5fa;border-radius:50%;animation:spin .8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        </style></head><body><div class="spinner"></div><div>Iniciando Alioth PDF Editor...</div></body></html>
        """
        webView.loadHTMLString(splashHTML, baseURL: nil)
        window.contentView?.addSubview(webView)
    }

    func startBackend() {
        guard let execURL = Bundle.main.executableURL else { return }
        let backendURL = execURL.deletingLastPathComponent().appendingPathComponent("AliothPDF")

        let process = Process()
        process.executableURL = backendURL
        process.arguments = ["--no-browser"]
        process.environment = ProcessInfo.processInfo.environment.merging(["PYTHONUNBUFFERED": "1"]) { _, new in new }

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        let handle = pipe.fileHandleForReading
        var buffer = ""
        handle.readabilityHandler = { [weak self] fh in
            let data = fh.availableData
            guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8) else { return }
            buffer += chunk
            buffer = String(buffer.suffix(8192))
            if let range = buffer.range(of: #"ACTIVO en puerto (\d+) \|"#, options: .regularExpression) {
                let match = String(buffer[range])
                if let port = Int(match.split(separator: " ")[3]) {
                    DispatchQueue.main.async {
                        self?.onBackendReady(port: port)
                    }
                }
            }
        }

        process.terminationHandler = { [weak self] proc in
            handle.readabilityHandler = nil
            DispatchQueue.main.async {
                if self?.quitting == false {
                    let alert = NSAlert()
                    alert.messageText = "No se pudo iniciar el motor de Alioth PDF Editor"
                    alert.informativeText = "El servidor local se cerró con código \(proc.terminationStatus)."
                    alert.alertStyle = .critical
                    alert.runModal()
                    NSApp.terminate(nil)
                }
            }
        }

        do {
            try process.run()
            self.backendProcess = process
        } catch {
            let alert = NSAlert()
            alert.messageText = "Error al iniciar Alioth PDF Editor"
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func onBackendReady(port: Int) {
        guard activePort == nil else { return }
        activePort = port
        if let url = URL(string: "http://127.0.0.1:\(port)/BASE.html") {
            webView.load(URLRequest(url: url))
        }
    }

    func forwardExternalFile(_ path: String) {
        guard URL(fileURLWithPath: path).pathExtension.lowercased() == "pdf" else { return }
        guard let port = activePort, initialLoaded else {
            pendingFiles.append(path)
            return
        }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#/")
        let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/open-external-file?path=\(encoded)") else { return }
        var request = URLRequest(url: url)
        request.setValue("http://127.0.0.1:\(port)", forHTTPHeaderField: "Origin")
        URLSession.shared.dataTask(with: request).resume()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Finder / Dock events
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.isFileURL {
            forwardExternalFile(url.path)
        }
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        forwardExternalFile(filename)
        return true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if let proc = backendProcess, proc.isRunning {
            proc.terminate()
            let deadline = Date().addingTimeInterval(2.0)
            while proc.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if proc.isRunning {
                kill(proc.processIdentifier, SIGKILL)
            }
        }
        for directory in shareDirectories { try? FileManager.default.removeItem(at: directory) }
    }

    // MARK: - Menu Actions
    @objc func openDocument(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.allowedFileTypes = ["pdf"]
        panel.allowsMultipleSelection = true
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK { panel.urls.forEach { self?.forwardExternalFile($0.path) } }
        }
    }
    @objc func saveDocument(_ sender: Any?) {
        webView.evaluateJavaScript("window.app?.saveFromHeader?.('save')", completionHandler: nil)
    }
    @objc func reloadPage(_ sender: Any?) { webView.reload() }
    @objc func resetZoom(_ sender: Any?) { webView.pageZoom = 1.0 }
    @objc func zoomIn(_ sender: Any?) { webView.pageZoom = min(webView.pageZoom + 0.1, 2.5) }
    @objc func zoomOut(_ sender: Any?) { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
    @objc func printPage(_ sender: Any?) {
        let op = webView.printOperation(with: NSPrintInfo.shared)
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    // MARK: - WKUIDelegate (file pickers, JS alerts/confirms/prompts, popups)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Alioth PDF Editor"
        alert.informativeText = message
        alert.addButton(withTitle: "Aceptar")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Alioth PDF Editor"
        alert.informativeText = message
        alert.addButton(withTitle: "Aceptar")
        alert.addButton(withTitle: "Cancelar")
        alert.beginSheetModal(for: window) { resp in completionHandler(resp == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Alioth PDF Editor"
        alert.informativeText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "Aceptar")
        alert.addButton(withTitle: "Cancelar")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if let host = url.host, host != "127.0.0.1" && host != "localhost" {
                NSWorkspace.shared.open(url)
            } else {
                webView.load(navigationAction.request)
            }
        }
        return nil
    }

    // MARK: - WKNavigationDelegate & Downloads
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let port = activePort, webView.url?.host == "127.0.0.1", webView.url?.port == port else { return }
        initialLoaded = true
        let files = pendingFiles
        pendingFiles.removeAll()
        var seen = Set<String>()
        for path in files where seen.insert(path).inserted { forwardExternalFile(path) }
    }

    func integrationStatus() -> [String: Any] {
        let current = LSCopyDefaultRoleHandlerForContentType("com.adobe.pdf" as CFString, .all)?.takeRetainedValue() as String?
        return ["supported": true, "platform": "darwin", "defaultIsAlioth": current == Bundle.main.bundleIdentifier]
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1",
              origin.port == activePort, let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "Origen no autorizado")
            return
        }
        switch action {
        case "integrationStatus":
            replyHandler(integrationStatus(), nil)
        case "associatePDF":
            let alert = NSAlert()
            alert.messageText = "¿Usar Alioth para abrir los archivos PDF?"
            alert.informativeText = "Puedes cambiar esta selección desde Finder → Obtener información → Abrir con."
            alert.addButton(withTitle: "Usar Alioth")
            alert.addButton(withTitle: "Cancelar")
            alert.beginSheetModal(for: window) { response in
                guard response == .alertFirstButtonReturn else { replyHandler(["ok": false, "cancelled": true], nil); return }
                let registered = LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
                let result = registered == noErr ? LSSetDefaultRoleHandlerForContentType(
                    "com.adobe.pdf" as CFString, .all, (Bundle.main.bundleIdentifier ?? "com.alioth.pdfeditor") as CFString) : registered
                let changed = result == noErr && self.integrationStatus()["defaultIsAlioth"] as? Bool == true
                replyHandler(["ok": changed, "message": "Alioth es el visor PDF predeterminado.",
                              "error": "Confirma el cambio en Finder → Obtener información → Abrir con → Cambiar todo."], nil)
            }
        case "sharePDF":
            guard let token = body["token"] as? String, UUID(uuidString: token) != nil,
                  let filename = body["filename"] as? String, filename.lowercased().hasSuffix(".pdf"),
                  let port = activePort, let url = URL(string: "http://127.0.0.1:\(port)/transfer-payload?token=\(token)") else {
                replyHandler(nil, "Documento no válido")
                return
            }
            var request = URLRequest(url: url)
            request.setValue("http://127.0.0.1:\(port)", forHTTPHeaderField: "Origin")
            URLSession.shared.downloadTask(with: request) { [weak self] temporary, response, error in
                do {
                    guard error == nil, let temporary = temporary, (response as? HTTPURLResponse)?.statusCode == 200 else {
                        throw NSError(domain: "AliothShare", code: 1, userInfo: [NSLocalizedDescriptionKey: "No se pudo preparar el PDF"])
                    }
                    let handle = try FileHandle(forReadingFrom: temporary)
                    defer { try? handle.close() }
                    guard try handle.read(upToCount: 5) == Data("%PDF-".utf8) else {
                        throw NSError(domain: "AliothShare", code: 2, userInfo: [NSLocalizedDescriptionKey: "El archivo no es un PDF"])
                    }
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("alioth-share-\(UUID().uuidString)")
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                    let destination = directory.appendingPathComponent(URL(fileURLWithPath: filename).lastPathComponent)
                    try FileManager.default.moveItem(at: temporary, to: destination)
                    DispatchQueue.main.async {
                        guard let self = self else { try? FileManager.default.removeItem(at: directory); replyHandler(nil, "Aplicación cerrada"); return }
                        self.shareDirectories.append(directory)
                        self.sharingPicker = NSSharingServicePicker(items: [destination])
                        self.sharingPicker?.show(relativeTo: NSRect(x: self.webView.bounds.midX, y: self.webView.bounds.maxY - 60, width: 1, height: 1), of: self.webView, preferredEdge: .minY)
                        replyHandler(["ok": true], nil)
                    }
                } catch {
                    DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) }
                }
            }.resume()
        default:
            replyHandler(nil, "Acción no disponible")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }
        if let url = navigationAction.request.url,
           (url.scheme == "http" || url.scheme == "https"),
           let host = url.host, host != "127.0.0.1" && host != "localhost",
           navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel, preferences)
            return
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.download)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
        activeDownloads[ObjectIdentifier(download)] = download
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
        activeDownloads[ObjectIdentifier(download)] = download
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { resp in
            completionHandler(resp == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        activeDownloads.removeValue(forKey: ObjectIdentifier(download))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        activeDownloads.removeValue(forKey: ObjectIdentifier(download))
    }
}

let app = NSApplication.shared
let delegate = AliothAppDelegate()
app.delegate = delegate
app.run()
