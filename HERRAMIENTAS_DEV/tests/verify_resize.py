from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
bin=root/'native_host/bin'
refs=root/'HERRAMIENTAS_DEV/reference-assemblies/build/.NETFramework/v4.6.2'
args=[str(root/'HERRAMIENTAS_DEV/compiler/tasks/net472/csc.exe'),'/nologo','/noconfig','/nostdlib+','/target:exe','/platform:x64','/main:ResizeVerification','/out:'+str(bin/'AliothResizeVerification.exe')]
args += ['/r:'+str(refs/(n+'.dll')) for n in ['mscorlib','System','System.Core','System.Net.Http','System.Web.Extensions','System.Windows.Forms','System.Drawing']]
args += ['/r:'+str(bin/n) for n in ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll']]
args += [str(root/'native_host/AliothPDFHost.cs'),str(root/'HERRAMIENTAS_DEV/tests/ResizeVerification.cs')]
subprocess.run(args,check=True)
subprocess.run([str(bin/'AliothResizeVerification.exe')],check=True,timeout=30)
