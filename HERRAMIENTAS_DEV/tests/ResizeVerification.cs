using System;
using System.Drawing;
using System.Reflection;
using System.Windows.Forms;
internal static class ResizeVerification {
    [STAThread] public static void Main() {
        try { Verify(); } catch (Exception error) { Console.Error.WriteLine(error); System.Environment.ExitCode = 1; }
    }
    private static void Verify() {
        Program.Assets = System.IO.Directory.GetCurrentDirectory();
        using (var form = new HostWindow("http://127.0.0.1/BASE.html", false)) {
            form.Bounds = new Rectangle(-100, -100, 800, 600);
            var handle = form.Handle;
            if (form.Padding.Left != 6 || form.Controls[0].Bounds.Left != 6 || form.Controls[0].Bounds.Right != form.ClientSize.Width - 6)
                throw new Exception("WebView2 must leave a native border on all sides");
            int w = form.ClientSize.Width, h = form.ClientSize.Height;
            int[,] cases = {{1,1,13},{w/2,1,12},{w-1,1,14},{1,h/2,10},{w-1,h/2,11},{1,h-1,16},{w/2,h-1,15},{w-1,h-1,17}};
            var wndProc = typeof(HostWindow).GetMethod("WndProc", BindingFlags.Instance | BindingFlags.NonPublic);
            for (int i=0; i<8; i++) {
                int x=cases[i,0], y=cases[i,1], expected=cases[i,2];
                if (HostWindow.ResizeHitTest(x,y,w,h,6)!=expected) throw new Exception("Hit mapping");
                var screen = form.PointToScreen(new System.Drawing.Point(x,y));
                var message = Message.Create(handle, 0x84, IntPtr.Zero, new IntPtr((screen.Y << 16) | (screen.X & 0xffff)));
                object[] parameters = {message}; wndProc.Invoke(form, parameters);
                if (((Message)parameters[0]).Result.ToInt32()!=expected) throw new Exception("Native edge " + expected);
            }
            if (HostWindow.ResizeHitTest(w/2,h/2,w,h,6)!=0 || HostWindow.ResizeHitTest(-1,0,w,h,6)!=0) throw new Exception("Interior/outside");
            form.WindowState = FormWindowState.Maximized;
            // Hidden forms defer the size notification until shown; exercise that notification without displaying UI.
            typeof(HostWindow).GetMethod("OnResize", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(form, new object[] {EventArgs.Empty});
            if (form.Padding != Padding.Empty) throw new Exception("Maximized border");
            if (form.Visible) throw new Exception("Verification window must remain hidden");
            Console.WriteLine("PASS: eight native resize hit tests, negative monitor coordinates, WebView border and maximized layout");
        }
    }
}
