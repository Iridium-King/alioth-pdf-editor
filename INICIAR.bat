@echo off
cd /d "%~dp0"
rem Abre los cambios del proyecto en una ventana de prueba independiente.
start "" "%~dp0_python\pythonw.exe" "%~dp0alioth.py" gui --project-preview %*
