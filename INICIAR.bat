@echo off
cd /d "%~dp0"
rem El servidor reutiliza la instancia activa y limpia hosts de Alioth huerfanos.
start "" "%~dp0_python\pythonw.exe" "%~dp0alioth.py" gui %*
