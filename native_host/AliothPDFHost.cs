using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    internal const string Origin = "http://alioth.localhost";
    internal static Uri Backend;
    internal static string Assets, Profile, Session;
    internal static string LogonSession;
    internal static bool SoftwareRendering;
    internal static CoreWebView2Environment Environment;
    internal static HostContext Context;
    private static readonly object LogLock = new object();
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
    internal static readonly HttpClient Client = new HttpClient(new HttpClientHandler {
        UseProxy = false, AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
    }) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };

    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 4) return 64;
            Uri requested = new Uri(args[0]);
            if (requested.Scheme != "http" || !requested.IsLoopback) return 64;
            Backend = new Uri(requested.GetLeftPart(UriPartial.Authority));
            Profile = Path.GetFullPath(args[1]);
            Assets = Path.GetFullPath(args[2]);
            Session = args[3];
            LogonSession = GetLogonSession();
            SoftwareRendering = System.Environment.GetEnvironmentVariable("ALIOTH_WEBVIEW_SOFTWARE") == "1";
            ServicePointManager.DefaultConnectionLimit = 32;
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Context = new HostContext();
            Context.Open(requested.PathAndQuery, true);
            Application.Run(Context);
            return 0;
        }
        catch (WebView2RuntimeNotFoundException error) { LogError("runtime-missing", error); return 78; }
        catch (Exception error) { LogError("host-failed", error); return 70; }
    }

    internal static bool IsApp(Uri uri)
    {
        return uri.GetLeftPart(UriPartial.Authority) == Origin ||
            uri.GetLeftPart(UriPartial.Authority) == Backend.GetLeftPart(UriPartial.Authority);
    }

    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenStatistics {
        public Luid TokenId, AuthenticationId;
        public long ExpirationTime;
        public int TokenType, ImpersonationLevel;
        public uint DynamicCharged, DynamicAvailable, GroupCount, PrivilegeCount;
        public Luid ModifiedId;
    }
    [StructLayout(LayoutKind.Sequential)] private struct LsaString {
        public ushort Length, MaximumLength;
        public IntPtr Buffer;
    }
    [StructLayout(LayoutKind.Sequential)] private struct LogonData {
        public uint Size;
        public Luid LogonId;
        public LsaString UserName, LogonDomain, AuthenticationPackage;
        public uint LogonType, SessionId;
        public IntPtr Sid;
        public long LogonTime;
    }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int type, out TokenStatistics data, int size, out int needed);
    [DllImport("secur32.dll")] private static extern uint LsaGetLogonSessionData(ref Luid id, out IntPtr data);
    [DllImport("secur32.dll")] private static extern uint LsaFreeReturnBuffer(IntPtr buffer);

    private static string GetLogonSession()
    {
        IntPtr data = IntPtr.Zero;
        try
        {
            using (var identity = WindowsIdentity.GetCurrent())
            {
                TokenStatistics statistics;
                int needed;
                if (!GetTokenInformation(identity.Token, 10, out statistics, Marshal.SizeOf(typeof(TokenStatistics)), out needed)) return null;
                var id = statistics.AuthenticationId;
                if (LsaGetLogonSessionData(ref id, out data) != 0 || data == IntPtr.Zero) return null;
                var logon = (LogonData)Marshal.PtrToStructure(data, typeof(LogonData));
                return id.High.ToString("X8") + id.Low.ToString("X8") + "-" + logon.LogonTime.ToString("X16");
            }
        }
        catch (Exception error) { LogError("logon-session-unavailable", error); return null; }
        finally { if (data != IntPtr.Zero) LsaFreeReturnBuffer(data); }
    }

    internal static void OpenExternal(string uri)
    {
        Uri address;
        if (Uri.TryCreate(uri, UriKind.Absolute, out address) &&
            (address.Scheme == "https" || address.Scheme == "http" || address.Scheme == "mailto"))
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    }

    internal static async Task Ready()
    {
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using (var timeout = new System.Threading.CancellationTokenSource(3000))
                using (var request = new HttpRequestMessage(HttpMethod.Post, new Uri(Backend, "/api/native-host/ready")))
                {
                    request.Headers.TryAddWithoutValidation("Origin", Backend.GetLeftPart(UriPartial.Authority));
                    request.Content = new StringContent(Json.Serialize(new { token = Session, softwareRendering = SoftwareRendering }), Encoding.UTF8, "application/json");
                    using (var response = await Client.SendAsync(request, timeout.Token))
                    {
                        if (response.IsSuccessStatusCode)
                        {
                            var result = Json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync());
                            if (result.ContainsKey("ok") && result["ok"] is bool && (bool)result["ok"]) return;
                        }
                        Log("ready-rejected", "attempt=" + attempt + ";status=" + (int)response.StatusCode);
                    }
                }
            }
            catch (Exception error) { LogError("ready-failed", error); }
            if (attempt < 3) await Task.Delay(250);
        }
    }

    internal static async Task<CoreWebView2Environment> CreateEnvironment()
    {
        string arguments = SoftwareRendering ? "--disable-gpu" : "";
#if QA
        arguments += " --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows";
#endif
        var options = arguments.Length == 0 ? null : new CoreWebView2EnvironmentOptions(arguments.Trim());
        var environment = await CoreWebView2Environment.CreateAsync(null, Profile, options);
        environment.BrowserProcessExited += delegate(object sender, CoreWebView2BrowserProcessExitedEventArgs e) {
            Log("browser-exited", e.BrowserProcessExitKind.ToString());
            if (e.BrowserProcessExitKind == CoreWebView2BrowserProcessExitKind.Failed && Context != null)
                Context.BrowserFailed(environment);
        };
        return environment;
    }

    internal static void LogError(string name, Exception error)
    {
        Log(name, error.GetType().Name + ";code=" + error.HResult.ToString("X8"));
    }

    internal static void Log(string name, string detail)
    {
        try
        {
            if (String.IsNullOrEmpty(Profile)) return;
            lock (LogLock)
            {
                Directory.CreateDirectory(Profile);
                string path = Path.Combine(Profile, "native-host.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024)
                {
                    string previous = path + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(path, previous);
                }
                File.AppendAllText(path, Json.Serialize(new { timestamp = DateTime.UtcNow.ToString("o"), name, detail }) + System.Environment.NewLine);
            }
        }
        catch { }
    }
}

internal sealed class HostContext : ApplicationContext
{
    private readonly List<HostWindow> windows = new List<HostWindow>();
    private CoreWebView2Environment failedEnvironment;
    internal bool HasSingleWindow { get { return windows.Count == 1; } }
    internal HostWindow Open(string target, bool primary)
    {
        var window = new HostWindow(target, primary);
        windows.Add(window);
        window.FormClosed += delegate { windows.Remove(window); if (windows.Count == 0) ExitThread(); };
#if QA
        if (window.StartupVerification || window.LayoutVerification || window.PdfVerification) { window.ShowInTaskbar = false; window.Opacity = 0; }
#endif
        window.Show();
        return window;
    }

    internal void BrowserFailed(CoreWebView2Environment environment)
    {
        if (failedEnvironment == environment) return;
        failedEnvironment = environment;
        HostWindow selected = null;
        foreach (var window in windows.ToArray())
            if (window.MarkBrowserFailed(environment) && selected == null) selected = window;
        if (selected != null) selected.QueueRecovery("browser", true);
    }
}

internal sealed partial class HostWindow : Form
{
    private WebView2 view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(29, 30, 37) };
    private readonly string target;
    private readonly bool primary;
    private bool allowClose, preparingClose, readyNotified;
    private string closeId;
    private readonly System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer { Interval = 15000 };
    private readonly System.Windows.Forms.Timer startupTimer = new System.Windows.Forms.Timer { Interval = 25000 };
    private TaskCompletionSource<bool> startupDeadline;
    private string startupStage;
    private bool startupComplete, startupRetried;
    private CoreWebView2Environment environment;
    private Panel recoveryBar;
    private Button recoveryRetry;
    private string recoveryCategory, recoveryTarget, lastPromptCategory;
    private bool recoveryQueued, recoveryDialogOpen, retrying, recreateNeeded, rendererUnavailable;
    private int rendererProbeVersion;
    private bool rendererProbePending;
    private readonly TaskCompletionSource<bool> initialized = new TaskCompletionSource<bool>();
    internal Task<bool> Initialized { get { return initialized.Task; } }

    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }

    internal HostWindow(string path, bool initial)
    {
        target = path;
        primary = initial;
        Text = "ALIOTH PDF EDITOR";
        BackColor = Color.FromArgb(29, 30, 37);
        FormBorderStyle = FormBorderStyle.None;
        MinimumSize = new Size(480, 320);
        Size = new Size(1200, 800);
        StartPosition = FormStartPosition.CenterScreen;
        if (initial) WindowState = FormWindowState.Maximized;
        string icon = Path.Combine(Program.Assets, "ICONO 1.ico");
        if (File.Exists(icon)) Icon = new Icon(icon);
        Controls.Add(view);
#if QA
        // Automated verification also runs when started with SW_HIDE.
        Load += async delegate {
#else
        Shown += async delegate {
#endif
            if (primary) BeginStartup();
            bool success = await Initialize();
            initialized.TrySetResult(success);
            if (!success)
            {
                QueueRecovery("initialize", true);
                await NotifyLauncher();
            }
        };
        FormClosing += PrepareClose;
        closeTimer.Tick += CloseTimedOut;
        startupTimer.Tick += StartupTimedOut;
        FormClosed += delegate { closeTimer.Dispose(); startupTimer.Dispose(); view.Dispose(); };
    }

    protected override CreateParams CreateParams
    {
        get { var p = base.CreateParams; p.Style |= 0x000F0000; return p; }
    }

    // Leave a native client border outside WebView2: the child HWND otherwise
    // consumes edge hit tests and mouse events before the form can resize.
    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        var border = new Padding(WindowState == FormWindowState.Normal ? 6 : 0);
        if (Padding != border) Padding = border;
    }

    internal static int ResizeHitTest(int x, int y, int width, int height, int border)
    {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        bool left = x < border, right = x >= width - border;
        bool top = y < border, bottom = y >= height - border;
        return top ? (left ? 13 : right ? 14 : 12) :
               bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 0;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x84 && WindowState == FormWindowState.Normal)
        {
            long position = message.LParam.ToInt64();
            var point = PointToClient(new System.Drawing.Point((short)(position & 0xffff), (short)((position >> 16) & 0xffff)));
            int hit = ResizeHitTest(point.X, point.Y, ClientSize.Width, ClientSize.Height, 6);
            if (hit != 0) { message.Result = new IntPtr(hit); return; }
        }
        if (message.Msg == 0x83 && message.WParam != IntPtr.Zero) { message.Result = IntPtr.Zero; return; }
        base.WndProc(ref message);
        if (message.Msg == 0x24)
        {
            var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (GetMonitorInfo(MonitorFromWindow(Handle, 2), ref info))
            {
                var limits = (MinMaxInfo)Marshal.PtrToStructure(message.LParam, typeof(MinMaxInfo));
                limits.MaxPosition.X = info.Work.Left - info.Monitor.Left;
                limits.MaxPosition.Y = info.Work.Top - info.Monitor.Top;
                limits.MaxSize.X = info.Work.Right - info.Work.Left;
                limits.MaxSize.Y = info.Work.Bottom - info.Work.Top;
                Marshal.StructureToPtr(limits, message.LParam, false);
            }
        }
    }

    private void BeginStartup()
    {
        startupDeadline = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        startupStage = "environment";
        startupTimer.Stop();
        startupTimer.Start();
        Program.Log("startup-begin", startupStage);
        view.Enabled = false;
        ShowRecoveryActions(false);
    }

    private async void StartupTimedOut(object sender, EventArgs e)
    {
        startupTimer.Stop();
        if (allowClose || IsDisposed || startupStage == null) return;
        Program.Log("startup-timeout", startupStage);
        startupDeadline.TrySetResult(false);
        ShowRecoveryBar("startup-timeout", true);
        if (!startupRetried && !readyNotified && !retrying && !preparingClose && !recoveryDialogOpen)
        {
            startupRetried = true;
            Program.Log("startup-retry", startupStage);
            await RetryRecovery(trySoftware: true);
        }
    }

    private async Task NotifyLauncher()
    {
        if (!primary || readyNotified) return;
        readyNotified = true;
        await Program.Ready();
    }

    private async Task<bool> Initialize(bool recreateEnvironment = false, bool recovery = false)
    {
        var initializingView = view;
        var deadline = startupDeadline;
        Func<bool> pending = () => !IsDisposed && view == initializingView &&
            (deadline == null || !deadline.Task.IsCompleted);
        try
        {
            var nextEnvironment = Program.Environment;
            if (recreateEnvironment || Program.Environment == null)
                nextEnvironment = await Program.CreateEnvironment();
            if (!pending()) return true;
            environment = Program.Environment = nextEnvironment;
            if (startupStage != null) startupStage = "controller";
            await initializingView.EnsureCoreWebView2Async(environment);
            if (!pending()) return true;
            var core = initializingView.CoreWebView2;
            if (startupStage != null) startupStage = "native-bridge";
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "if(location.origin==='" + Program.Origin + "') window.__aliothLogonSession=" + Program.Json.Serialize(Program.LogonSession) + ";" + NativeScript);
            if (!pending()) return true;
#if QA
            if (LayoutVerification)
            {
                RequireIsolatedLayoutProfile();
                await core.AddScriptToExecuteOnDocumentCreatedAsync("if(location.origin==='" + Program.Origin + "') localStorage.setItem('alioth_native_storage_ready','1');");
                if (System.Environment.GetCommandLineArgs()[6].StartsWith("stability-chrome")) {
                    await core.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.LocalFonts, Program.Origin, CoreWebView2PermissionState.Allow);
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(ChromeTimelineScript);
                }
            }
#endif
            if (!pending()) return true;
            if (primary || recovery)
            {
                AttachCoreEvents();
                if (recovery && (recoveryTarget != null || !primary))
                {
                    core.Navigate(recoveryTarget ?? (Program.Origin + (target.StartsWith("/") ? target : "/BASE.html")));
                    return true;
                }
#if QA
                if (LegacyVerification) core.Navigate(new Uri(Program.Backend, target).ToString());
                else
#endif
                core.Navigate(Program.Origin + "/browser-migration.html?mode=import&target=" + Uri.EscapeDataString(target));
            }
            return true;
        }
        catch (Exception error)
        {
            if (!pending()) return true;
            Program.LogError("initialize-failed", error);
            rendererUnavailable = true;
            return false;
        }
    }

    private void AttachCoreEvents()
    {
            var core = view.CoreWebView2;
            core.AddWebResourceRequestedFilter(Program.Origin + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += ProxyResource;
            core.WebMessageReceived += MessageReceived;
            core.DocumentTitleChanged += delegate { Text = core.DocumentTitle; };
            core.WindowCloseRequested += delegate { Close(); };
            core.NewWindowRequested += NewWindow;
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) {
                if (IsDisposed || allowClose || !Object.ReferenceEquals(view.CoreWebView2, core)) return;
                Program.Log("process-failed", e.ProcessFailedKind + ";reason=" + e.Reason + ";code=" + e.ExitCode);
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
                    Program.Context.BrowserFailed(environment);
                else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                    CheckRendererResponse(core);
                else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                         e.ProcessFailedKind == CoreWebView2ProcessFailedKind.FrameRenderProcessExited)
                {
                    rendererProbeVersion++;
                    rendererProbePending = false;
                    rendererUnavailable = rendererUnavailable || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited;
                    QueueRecovery("renderer", false);
                }
            };
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri uri;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) { e.Cancel = true; return; }
                if (Program.IsApp(uri))
                {
                    if (primary && !startupComplete && uri.AbsolutePath == "/BASE.html" && startupStage == null)
                    {
                        // A visible migration can take longer than the editor bootstrap.
                        view.Enabled = false;
                        startupTimer.Start();
                        ShowRecoveryActions(false);
                    }
                    if (primary && !startupComplete)
                        startupStage = uri.AbsolutePath == "/BASE.html" ? "editor" : "navigation";
                    recoveryTarget = Program.Origin + uri.PathAndQuery;
#if QA
                    if (LegacyVerification) return;
#endif
                    if (!e.Uri.StartsWith(Program.Origin + "/", StringComparison.OrdinalIgnoreCase))
                    { e.Cancel = true; core.Navigate(Program.Origin + uri.PathAndQuery); }
                }
                else if (uri.Scheme != "blob" && uri.Scheme != "about" && uri.Scheme != "data")
                { e.Cancel = true; Program.OpenExternal(e.Uri); }
            };
            core.NavigationCompleted +=
#if QA
            async
#endif
            delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                if (IsDisposed || allowClose || !Object.ReferenceEquals(view.CoreWebView2, core)) return;
                if (!e.IsSuccess || e.HttpStatusCode >= 400)
                {
                    if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled && !allowClose && !IsDisposed)
                    {
                        Program.Log("navigation-failed", e.WebErrorStatus + ";status=" + e.HttpStatusCode);
                        QueueRecovery("navigation", false);
                    }
                    return;
                }
                rendererUnavailable = false;
                rendererProbeVersion++;
                rendererProbePending = false;
                recreateNeeded = false;
                lastPromptCategory = null;
                if ((!primary || startupComplete) && recoveryBar != null) recoveryBar.Visible = false;
#if QA
                if (e.IsSuccess) await VerifyInterface();
#endif
            };
    }

    private async void ProxyResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        using (var deferred = e.GetDeferral())
        {
            try
            {
                var uri = new Uri(e.Request.Uri);
                if (uri.AbsolutePath == "/api/tab-events")
                {
                    e.Response = Program.Environment.CreateWebResourceResponse(null, 307, "Temporary Redirect",
                        "Location: " + new Uri(Program.Backend, uri.PathAndQuery) + "\r\nCache-Control: no-store\r\n");
                    return;
                }
                using (var request = new HttpRequestMessage(new HttpMethod(e.Request.Method), new Uri(Program.Backend, uri.PathAndQuery)))
                {
                    if (e.Request.Content != null) request.Content = new StreamContent(e.Request.Content);
                    foreach (var header in e.Request.Headers)
                    {
                        if (String.Equals(header.Key, "Host", StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(header.Key, "Origin", StringComparison.OrdinalIgnoreCase) ||
                            String.Equals(header.Key, "Referer", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value) && request.Content != null)
                            request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
                    }
                    request.Headers.TryAddWithoutValidation("Origin", Program.Backend.GetLeftPart(UriPartial.Authority));
                    request.Headers.TryAddWithoutValidation("Referer", Program.Backend + "/BASE.html");
                    bool startupAsset = primary && !startupComplete && request.Method == HttpMethod.Get &&
                        request.Content == null && IsStartupAsset(uri.AbsolutePath);
                    using (var response = await (startupAsset ? FetchStartupAsset(request) :
                        Program.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead)))
                    {
                        var headers = new StringBuilder();
                        foreach (var header in response.Headers)
                            if (!String.Equals(header.Key, "Transfer-Encoding", StringComparison.OrdinalIgnoreCase))
                                headers.Append(header.Key + ": " + String.Join(", ", header.Value) + "\r\n");
                        foreach (var header in response.Content.Headers)
                            headers.Append(header.Key + ": " + String.Join(", ", header.Value) + "\r\n");
                        var content = await response.Content.ReadAsByteArrayAsync();
                        e.Response = Program.Environment.CreateWebResourceResponse(new MemoryStream(content),
                            (int)response.StatusCode, response.ReasonPhrase, headers.ToString());
                    }
                }
            }
            catch (Exception error)
            {
                Program.LogError("resource-failed", error);
                try
                {
                    e.Response = Program.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes("Local server unavailable")),
                        503, "Service Unavailable", "Content-Type: text/plain; charset=utf-8\r\n");
                }
                catch (Exception responseError) { Program.LogError("resource-response-failed", responseError); }
            }
        }
    }

    private static bool IsStartupAsset(string path)
    {
        return path == "/BASE.html" || path == "/browser-migration.html" ||
            path.StartsWith("/js/", StringComparison.Ordinal) || path.StartsWith("/css/", StringComparison.Ordinal) ||
            path.StartsWith("/libs/", StringComparison.Ordinal) || path.StartsWith("/fonts/", StringComparison.Ordinal) ||
            path.StartsWith("/ICONOS/", StringComparison.Ordinal);
    }

    private static async Task<HttpResponseMessage> FetchStartupAsset(HttpRequestMessage request)
    {
        try
        {
            using (var deadline = new System.Threading.CancellationTokenSource(4000))
            {
                var response = await Program.Client.SendAsync(request, HttpCompletionOption.ResponseContentRead, deadline.Token);
                int status = (int)response.StatusCode;
                if (status != 502 && status != 503 && status != 504) return response;
                response.Dispose();
                Program.Log("startup-resource-retry", "status=" + status);
            }
        }
        catch (Exception error) when (error is HttpRequestException || error is OperationCanceledException)
        {
            Program.LogError("startup-resource-retry", error);
        }

        // Retry a stalled read-only request before the page parser runs out of time.
        using (var retry = new HttpRequestMessage(HttpMethod.Get, request.RequestUri))
        using (var deadline = new System.Threading.CancellationTokenSource(8000))
        {
            foreach (var header in request.Headers) retry.Headers.TryAddWithoutValidation(header.Key, header.Value);
            return await Program.Client.SendAsync(retry, HttpCompletionOption.ResponseContentRead, deadline.Token);
        }
    }

    private async void NewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        Uri uri;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) { e.Handled = true; return; }
        if (!Program.IsApp(uri) && uri.Scheme != "blob" && uri.Scheme != "about")
        { e.Handled = true; Program.OpenExternal(e.Uri); return; }
        using (var deferred = e.GetDeferral())
        {
            HostWindow child = null;
            try
            {
                child = Program.Context.Open(uri.PathAndQuery, false);
                if (await child.Initialized && !child.IsDisposed && child.view.CoreWebView2 != null)
                {
                    e.NewWindow = child.view.CoreWebView2;
                    child.AttachCoreEvents();
                }
            }
            catch (Exception error)
            {
                Program.LogError("new-window-failed", error);
                if (child != null && !child.IsDisposed) child.QueueRecovery("initialize", true);
            }
            e.Handled = true;
        }
    }


    private async void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        Uri source;
        if (!Object.ReferenceEquals(sender, view.CoreWebView2) || !Uri.TryCreate(e.Source, UriKind.Absolute, out source) ||
            source.GetLeftPart(UriPartial.Authority) != Program.Origin) return;
        try
        {
            var data = Program.Json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            object channel;
            if (data.TryGetValue("channel", out channel) && Object.Equals(channel, "alioth-startup"))
            {
                if (primary && !startupComplete && e.Source == view.CoreWebView2.Source)
                    await HandleStartupMessage(source.AbsolutePath, Convert.ToString(data["state"]));
                return;
            }
            if (data.ContainsKey("channel") && Convert.ToString(data["channel"]) == "alioth-file-paths")
            {
                // Only DOM File objects explicitly supplied by this local page can reveal a path.
                var paths = new List<string>();
                foreach (var item in e.AdditionalObjects)
                {
                    var file = item as CoreWebView2File;
                    paths.Add(file == null ? null : file.Path);
                }
                view.CoreWebView2.PostWebMessageAsJson(Program.Json.Serialize(new {
                    channel = "alioth-file-paths", id = Convert.ToString(data["id"]), paths
                }));
                return;
            }
            if (!data.ContainsKey("channel") || (string)data["channel"] != "alioth-window") return;
            string action = Convert.ToString(data["action"]);
            if (action == "init-frameless") await view.CoreWebView2.ExecuteScriptAsync(NativeScript);
            if (action == "close-ready")
            {
                if (!preparingClose || Convert.ToString(data["id"]) != closeId) return;
                closeTimer.Stop();
                preparingClose = false;
                closeId = null;
                if (data.ContainsKey("ok") && (bool)data["ok"]) { allowClose = true; Close(); }
                return;
            }
            if (action == "minimize") WindowState = FormWindowState.Minimized;
            else if (action == "toggle-maximize") WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            else if (action == "close") Close();
            else if (action == "drag" || action == "resize")
            {
                if ((GetAsyncKeyState(1) & 0x8000) != 0)
                {
                    int hit = action == "drag" ? 2 : Convert.ToInt32(data["edge"]);
                    if (hit == 2 || hit >= 10 && hit <= 17)
                    {
                        Point location = new Point { X = Cursor.Position.X, Y = Cursor.Position.Y };
                        ReleaseCapture();
                        PostMessage(Handle, 0xA1, new IntPtr(hit), new IntPtr((location.Y << 16) | (location.X & 0xffff)));
                    }
                }
            }
            else if (action == "restore-placement" && data.ContainsKey("body"))
            {
                var placement = (Dictionary<string, object>)data["body"];
                var raw = (System.Collections.IList)placement["rect"];
                if (raw.Count == 4)
                {
                    int x = Convert.ToInt32(raw[0]), y = Convert.ToInt32(raw[1]);
                    int width = Convert.ToInt32(raw[2]) - x, height = Convert.ToInt32(raw[3]) - y;
                    var rect = new Rectangle(x, y, width, height);
                    bool visible = false;
                    foreach (var screen in Screen.AllScreens)
                    { var overlap = Rectangle.Intersect(screen.WorkingArea, rect); if (overlap.Width >= 100 && overlap.Height >= 60) visible = true; }
                    if (visible && width >= MinimumSize.Width && height >= MinimumSize.Height && width < 20000 && height < 20000)
                    { WindowState = FormWindowState.Normal; Bounds = rect; }
                    if (placement.ContainsKey("maximized") && placement["maximized"] is bool && (bool)placement["maximized"])
                        WindowState = FormWindowState.Maximized;
                }
            }
            var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            view.CoreWebView2.PostWebMessageAsJson(Program.Json.Serialize(new {
                channel = "alioth-window", id = data["id"], ok = true,
                is_maximized = WindowState == FormWindowState.Maximized,
                placement = new { maximized = WindowState == FormWindowState.Maximized, rect = new[] { bounds.Left, bounds.Top, bounds.Right, bounds.Bottom } }
            }));
        }
        catch (Exception error) { Program.LogError("window-message-failed", error); }
    }

    private async Task HandleStartupMessage(string path, string state)
    {
        if (path == "/BASE.html" && state == "editor-failed")
        {
            startupTimer.Stop();
            Program.Log("startup-failed", "editor");
            ShowRecoveryBar("startup-timeout", true);
            return;
        }
        bool editorReady = path == "/BASE.html" && state == "editor-ready";
        if (!editorReady && !(path == "/browser-migration.html" && state == "migration-visible")) return;
        startupComplete = editorReady;
        startupStage = null;
        startupTimer.Stop();
        view.Enabled = true;
        if (recoveryCategory == "startup-timeout") recreateNeeded = false;
        recoveryCategory = null;
        if (recoveryBar != null) recoveryBar.Visible = false;
        Program.Log("startup-progress", state);
        await NotifyLauncher();
    }

    internal bool MarkBrowserFailed(CoreWebView2Environment failed)
    {
        if (environment != failed || allowClose || IsDisposed) return false;
        rendererUnavailable = true;
        rendererProbeVersion++;
        rendererProbePending = false;
        recreateNeeded = true;
        ShowRecoveryBar("browser", true);
        return true;
    }

    private async void CheckRendererResponse(CoreWebView2 core)
    {
        if (rendererProbePending || rendererUnavailable || allowClose || IsDisposed) return;
        rendererProbePending = true;
        int version = ++rendererProbeVersion;
        try
        {
            // PDF/font work can temporarily occupy the renderer. A response proves it
            // recovered without reloading the page or discarding in-memory edits.
            var response = core.ExecuteScriptAsync("'alioth-responsive'");
            if (await Task.WhenAny(response, Task.Delay(15000)) != response &&
                version == rendererProbeVersion && !IsDisposed && !allowClose &&
                Object.ReferenceEquals(view.CoreWebView2, core))
                ShowRecoveryBar("unresponsive", false);
            await response;
            if (version == rendererProbeVersion && !IsDisposed && !allowClose &&
                !rendererUnavailable && Object.ReferenceEquals(view.CoreWebView2, core))
            {
                if (recoveryCategory == "unresponsive" && recoveryBar != null) recoveryBar.Visible = false;
                if (lastPromptCategory == "unresponsive") lastPromptCategory = null;
                Program.Log("renderer-responsive", "recovered-without-reload");
            }
        }
        catch (Exception error) { Program.LogError("renderer-probe-failed", error); }
        finally { if (version == rendererProbeVersion) rendererProbePending = false; }
    }

    private void ShowRecoveryBar(string category, bool recreate)
    {
        if (allowClose || IsDisposed) return;
        recoveryCategory = category;
        recreateNeeded = recreateNeeded || recreate;
        ShowRecoveryActions(true);
    }

    private void ShowRecoveryActions(bool canRetry)
    {
        if (recoveryBar == null)
        {
            recoveryBar = new Panel {
                Width = 184, Height = 36, BackColor = BackColor,
                Anchor = AnchorStyles.Bottom | AnchorStyles.Right,
                Location = new System.Drawing.Point(ClientSize.Width - 198, ClientSize.Height - 50)
            };
            recoveryRetry = new Button { Dock = DockStyle.Right, Width = 94, Text = "Reintentar" };
            var close = new Button { Dock = DockStyle.Right, Width = 84, Text = "Cancelar" };
            recoveryRetry.Click += delegate { OfferRecovery(); };
            close.Click += delegate { Close(); };
            recoveryBar.Controls.Add(recoveryRetry);
            recoveryBar.Controls.Add(close);
            Controls.Add(recoveryBar);
        }
        recoveryRetry.Visible = canRetry;
        recoveryBar.Visible = true;
        recoveryBar.BringToFront();
    }

    internal void QueueRecovery(string category, bool recreate)
    {
        if (allowClose || IsDisposed) return;
        if (!startupComplete) startupTimer.Stop();
        ShowRecoveryBar(category, recreate);
        if (preparingClose || recoveryQueued || recoveryDialogOpen || retrying || lastPromptCategory == category) return;
        recoveryQueued = true;
        try
        {
            BeginInvoke(new Action(delegate {
                recoveryQueued = false;
                if (!allowClose && !IsDisposed && !preparingClose) OfferRecovery();
            }));
        }
        catch (InvalidOperationException error) { recoveryQueued = false; Program.LogError("recovery-queue-failed", error); }
    }

    private DialogResult RecoveryPrompt(string category, string message, MessageBoxButtons buttons)
    {
#if QA
        return VerifyRecoveryPrompt(category, message, buttons);
#else
        return MessageBox.Show(this, message, "ALIOTH PDF EDITOR", buttons, MessageBoxIcon.Warning,
            buttons == MessageBoxButtons.RetryCancel ? MessageBoxDefaultButton.Button2 : MessageBoxDefaultButton.Button1);
#endif
    }

    private async void OfferRecovery()
    {
        if (preparingClose || recoveryDialogOpen || retrying || allowClose || IsDisposed) return;
        recoveryDialogOpen = true;
        string category = recoveryCategory ?? "renderer";
        lastPromptCategory = category;
        DialogResult decision;
        try
        {
            decision = RecoveryPrompt(category,
                "La vista de Alioth no pudo continuar. Puedes cancelar y esperar o reintentar.\n\nReintentar volverá a cargar la vista y puede perder los cambios que todavía no se hayan guardado. Los datos guardados se conservan.",
                MessageBoxButtons.RetryCancel);
        }
        catch (Exception error) { Program.LogError("recovery-prompt-failed", error); return; }
        finally { recoveryDialogOpen = false; }
        if (decision != DialogResult.Retry || allowClose || IsDisposed) return;
        await RetryRecovery();
    }

    private async Task RetryRecovery(bool trySoftware = false)
    {
        if (preparingClose || retrying || allowClose || IsDisposed) return;
        retrying = true;
        bool failed = false;
        try
        {
            lastPromptCategory = null;
            bool starting = primary && !startupComplete;
            if (starting) BeginStartup();
            if (starting || recreateNeeded || view.CoreWebView2 == null)
            {
                var previous = view;
                view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(29, 30, 37) };
                view.Enabled = !starting;
                Controls.Add(view);
                if (trySoftware && !Program.SoftwareRendering && Program.Context.HasSingleWindow)
                    await SwitchToSoftwareRendering(previous);
                else previous.Dispose();
                if (IsDisposed || allowClose) return;
                var initialization = Initialize(recreateNeeded || Program.Environment == null, true);
                var completion = starting ? await Task.WhenAny(initialization, startupDeadline.Task) : initialization;
                if (completion == initialization) failed = !await initialization;
                if (recoveryBar != null) recoveryBar.BringToFront();
            }
            else view.CoreWebView2.Reload();
        }
        catch (Exception error) { Program.LogError("recovery-failed", error); failed = true; }
        finally { retrying = false; }
        if (failed) QueueRecovery("initialize", true);
    }

    private async Task SwitchToSoftwareRendering(WebView2 previous)
    {
        // A shared profile cannot change browser options until its last controller exits.
        var previousEnvironment = environment ?? Program.Environment;
        var processExited = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<CoreWebView2BrowserProcessExitedEventArgs> onExited = (sender, args) => processExited.TrySetResult(true);
        if (previousEnvironment != null) previousEnvironment.BrowserProcessExited += onExited;
        try
        {
            previous.Dispose();
            if (previousEnvironment == null ||
                await Task.WhenAny(processExited.Task, Task.Delay(3500)) == processExited.Task)
            {
                Program.SoftwareRendering = true;
                Program.Log("startup-software-rendering", "enabled");
            }
            else Program.Log("startup-software-rendering", "profile-still-in-use");
        }
        finally
        {
            if (previousEnvironment != null) previousEnvironment.BrowserProcessExited -= onExited;
        }
    }

    private void PrepareClose(object sender, FormClosingEventArgs e)
    {
        if (allowClose || view.CoreWebView2 == null) return;
        e.Cancel = true;
        if (preparingClose) return;
        preparingClose = true;
        closeId = Guid.NewGuid().ToString("N");
        closeTimer.Start();
        try
        {
            if (rendererUnavailable) { BeginInvoke(new Action(delegate { CloseTimedOut(null, EventArgs.Empty); })); return; }
            view.CoreWebView2.PostWebMessageAsJson(Program.Json.Serialize(new { channel = "alioth-close", id = closeId }));
        }
        catch (Exception error)
        {
            Program.LogError("close-request-failed", error);
            BeginInvoke(new Action(delegate { CloseTimedOut(null, EventArgs.Empty); }));
        }
    }

    private void CloseTimedOut(object sender, EventArgs e)
    {
        if (allowClose || IsDisposed) return;
        closeTimer.Stop();
        if (!preparingClose) return;
        Program.Log("close-timeout", "waiting-for-save");
        DialogResult decision;
        try
        {
            decision = RecoveryPrompt("close-timeout",
                "La vista todavía no confirmó el guardado.\n\nSí: seguir esperando.\nNo: cerrar de todos modos; podrían perderse los cambios sin guardar.\nCancelar: volver a la aplicación sin cerrarla.",
                MessageBoxButtons.YesNoCancel);
        }
        catch (Exception error)
        {
            Program.LogError("close-prompt-failed", error);
            preparingClose = false;
            closeId = null;
            return;
        }
        if (!preparingClose || allowClose || IsDisposed) return;
        if (decision == DialogResult.Yes) closeTimer.Start();
        else
        {
            preparingClose = false;
            closeId = null;
            if (decision == DialogResult.No) { allowClose = true; Close(); }
        }
    }

    private const string NativeScript = @"
if (window.top === window && location.origin === 'http://alioth.localhost' && !window.__aliothNativeHost) {
    window.__aliothNativeHost = true;
    const pathRequests = new Map();
    let pathSequence = 0;
    window.__aliothResolveNativePaths = files => {
        const list = Array.from(files || []);
        if (!list.length || typeof chrome.webview.postMessageWithAdditionalObjects !== 'function') return;
        const id = 'files_' + (++pathSequence);
        let complete;
        const result = new Promise(resolve => { complete = resolve; });
        const timer = setTimeout(() => { pathRequests.delete(id); complete([]); }, 5000);
        pathRequests.set(id, paths => { clearTimeout(timer); complete(paths); });
        list.forEach((file, index) => {
            file._aliothOriginPromise = result.then(paths => {
                const path = paths[index] || null;
                if (path) file._aliothSourcePath = path;
                return path;
            });
        });
        try { chrome.webview.postMessageWithAdditionalObjects({channel:'alioth-file-paths',id}, list); }
        catch (_) { pathRequests.delete(id); clearTimeout(timer); complete([]); }
    };
    // Capture before app handlers start hashing or opening the dropped files.
    window.addEventListener('drop', event => window.__aliothResolveNativePaths(event.dataTransfer?.files), true);
    window.addEventListener('change', event => {
        if (event.target?.type === 'file') window.__aliothResolveNativePaths(event.target.files);
    }, true);
    chrome.webview.addEventListener('message', async event => {
        const message = event.data;
        if (message.channel === 'alioth-file-paths') {
            const complete = pathRequests.get(message.id);
            if (complete) { pathRequests.delete(message.id); complete(message.paths || []); }
            return;
        }
        if (message.channel !== 'alioth-close') return;
        let ok = true;
        try {
            if (window.app) {
                await app.flushDocumentEdits?.(app.activeDocId);
                if (app.db) ok = await app.saveSession();
                if (ok !== false) await app.releaseClosedTabs?.();
            }
            window.dispatchEvent(new Event('alioth:before-close'));
            await window.aliothPreferences?.flush();
            if (ok === false) throw new Error('SESSION_SAVE_FAILED');
        } catch (_) { ok = false; window.app?.showToast('No se pudo guardar la sesión. Reintenta cerrar.'); }
        chrome.webview.postMessage({channel:'alioth-window',action:'close-ready',id:message.id,ok});
    });
}";
}

