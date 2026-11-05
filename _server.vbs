' ============================================================
' ALIOTH PDF EDITOR - Launcher completo
' ============================================================
Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

Function UrlEncode(value)
    Dim encoded
    encoded = value
    encoded = Replace(encoded, "%", "%25")
    encoded = Replace(encoded, " ", "%20")
    encoded = Replace(encoded, "#", "%23")
    encoded = Replace(encoded, "&", "%26")
    encoded = Replace(encoded, "=", "%3D")
    encoded = Replace(encoded, "+", "%2B")
    encoded = Replace(encoded, "?", "%3F")
    encoded = Replace(encoded, ":", "%3A")
    encoded = Replace(encoded, "\", "%5C")
    UrlEncode = encoded
End Function

' 0. Capturar argumento de archivo (viene de Windows Explorer doble-clic)
Dim pdfArg
pdfArg = ""
If WScript.Arguments.Count > 0 Then
    pdfArg = WScript.Arguments(0)
End If

' 1. Determinar Python
Dim pythonExe
embeddedPython = scriptDir & "\_python\pythonw.exe"
If objFSO.FileExists(embeddedPython) Then
    pythonExe = """" & embeddedPython & """"
Else
    embeddedPython = scriptDir & "\_python\python.exe"
    If objFSO.FileExists(embeddedPython) Then
        pythonExe = """" & embeddedPython & """"
    Else
        pythonExe = "python"
    End If
End If

' 2. Detectar BASE*.html
Dim selectedFile
selectedFile = ""
Set folder = objFSO.GetFolder(scriptDir)
Dim htmlFiles()
Dim htmlCount
htmlCount = 0
For Each f In folder.Files
    If LCase(Left(f.Name, 4)) = "base" And LCase(Right(f.Name, 5)) = ".html" Then
        ReDim Preserve htmlFiles(htmlCount)
        htmlFiles(htmlCount) = f.Name
        htmlCount = htmlCount + 1
    End If
Next

If htmlCount = 0 Then
    MsgBox "No se encontraron archivos BASE*.html.", vbCritical, "Alioth"
    WScript.Quit
ElseIf htmlCount = 1 Then
    selectedFile = htmlFiles(0)
Else
    Dim menu
    menu = "Selecciona la version a abrir:" & vbCrLf & vbCrLf
    For i = 0 To htmlCount - 1
        menu = menu & (i+1) & ". " & htmlFiles(i) & vbCrLf
    Next
    Dim choice
    choice = InputBox(menu, "Alioth PDF Editor", "1")
    If choice = "" Then WScript.Quit
    idx = CInt(choice) - 1
    If idx < 0 Or idx >= htmlCount Then
        MsgBox "Seleccion no valida.", vbCritical, "Alioth"
        WScript.Quit
    End If
    selectedFile = htmlFiles(idx)
End If

' 3. Verificar si el proxy ya está corriendo en puerto 8765
Dim proxyPort, portFile, portText
proxyPort = 8765
portFile = scriptDir & "\alioth.port"
If objFSO.FileExists(portFile) Then
    On Error Resume Next
    portText = Trim(objFSO.OpenTextFile(portFile, 1).ReadAll)
    If IsNumeric(portText) Then proxyPort = CInt(portText)
    Err.Clear
    On Error GoTo 0
End If

Dim proxyAlreadyRunning
proxyAlreadyRunning = False
Dim httpCheck
Set httpCheck = CreateObject("MSXML2.XMLHTTP")
On Error Resume Next
httpCheck.Open "GET", "http://localhost:" & proxyPort & "/", False
httpCheck.Send
If Err.Number = 0 And httpCheck.Status > 0 Then
    proxyAlreadyRunning = True
End If
Err.Clear
On Error GoTo 0

' 3.1 Si el proxy ya está corriendo y se recibió un archivo, intentar abrir como pestaña en ventana activa
If proxyAlreadyRunning And pdfArg <> "" Then
    Dim encArg, openUrl, openHttp, openResp
    encArg = UrlEncode(pdfArg)

    openUrl = "http://localhost:" & proxyPort & "/api/open-external-file?path=" & encArg
    Set openHttp = CreateObject("MSXML2.XMLHTTP")
    On Error Resume Next
    openHttp.Open "GET", openUrl, False
    openHttp.Send
    If Err.Number = 0 And openHttp.Status = 200 Then
        openResp = openHttp.responseText
        If InStr(openResp, """handled"":true") > 0 Or InStr(openResp, """handled"": true") > 0 Then
            ' Salir solo cuando la ventana existente se pudo activar.
            Dim activated
            activated = False
            On Error Resume Next
            activated = objShell.AppActivate("ALIOTH PDF EDITOR")
            Err.Clear
            On Error GoTo 0
            If activated Then WScript.Quit
        End If
    End If
    Err.Clear
    On Error GoTo 0
End If

' 4. Arranque en frío: el proxy lanza Edge cuando ya está listo.
If Not proxyAlreadyRunning Then
    proxyScript = scriptDir & "\_proxy.py"
    Dim launchCommand
    launchCommand = pythonExe & " """ & proxyScript & """ --launch-browser"
    If pdfArg <> "" Then launchCommand = launchCommand & " """ & pdfArg & """"
    objShell.Run launchCommand, 0, False
    WScript.Quit
End If

' 6. Construir URL
appUrl = "http://localhost:" & proxyPort & "/" & selectedFile

' Agregar parámetro openfile si se recibió un PDF como argumento
If pdfArg <> "" Then
    Dim encodedPath
    encodedPath = UrlEncode(pdfArg)
    appUrl = appUrl & "?openfile=" & encodedPath
End If

' 7. Abrir navegador
Dim edge64, edge86, chrome64, chrome86, browserPath
edge64   = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
edge86   = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chrome64 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome86 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

If objFSO.FileExists(edge64) Then
    browserPath = edge64
ElseIf objFSO.FileExists(edge86) Then
    browserPath = edge86
ElseIf objFSO.FileExists(chrome64) Then
    browserPath = chrome64
ElseIf objFSO.FileExists(chrome86) Then
    browserPath = chrome86
Else
    browserPath = ""
End If

If browserPath <> "" Then
    objShell.Run """" & browserPath & """ --app=" & appUrl & " --start-maximized", 1, False
Else
    objShell.Run "explorer " & appUrl, 1, False
End If
