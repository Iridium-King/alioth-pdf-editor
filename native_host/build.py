"""Compile the development WebView2 host; does not generate portable releases."""
from pathlib import Path
import os
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK_VERSION = '1.0.4258.31'
SDK = ROOT / 'HERRAMIENTAS_DEV' / f'webview2-sdk-{SDK_VERSION}.nupkg'
BIN = Path(__file__).resolve().parent / 'bin'


def build(qa=False):
    BIN.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SDK) as package:
        for source in ('lib/net462/Microsoft.Web.WebView2.Core.dll',
                       'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
                       'runtimes/win-x64/native/WebView2Loader.dll', 'LICENSE.txt'):
            (BIN / Path(source).name).write_bytes(package.read(source))
    compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    arguments = [str(compiler), '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
                 '/out:' + str(BIN / ('AliothPDFHost.Test.exe' if qa else 'AliothPDFHost.exe')), '/win32icon:' + str(ROOT / 'ICONO 1.ico'),
                 '/r:System.Net.Http.dll', '/r:System.Web.Extensions.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
                 '/r:' + str(BIN / 'Microsoft.Web.WebView2.Core.dll'),
                 '/r:' + str(BIN / 'Microsoft.Web.WebView2.WinForms.dll'),
                 str(Path(__file__).with_name('AliothPDFHost.cs'))]
    if qa:
        arguments.extend(['/define:QA', str(ROOT / 'HERRAMIENTAS_DEV/tests/WebViewHostVerification.cs')])
    subprocess.run(arguments, check=True, cwd=ROOT)
    print(f'Development host: {BIN / ("AliothPDFHost.Test.exe" if qa else "AliothPDFHost.exe")}')
    print(f'Native components: {sum(file.stat().st_size for file in BIN.iterdir() if file.name != "AliothPDFHost.Test.exe")} bytes')


if __name__ == '__main__':
    import sys
    build('--qa' in sys.argv)
