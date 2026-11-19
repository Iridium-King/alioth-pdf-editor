@echo off
setlocal
if exist "%~dp0alioth.py" goto source
set "ALIOTH_MCP_EXE=%~dp0Alioth_PDF_MCP.exe"
if not exist "%ALIOTH_MCP_EXE%" (
    echo No se encontro Alioth_PDF_MCP.exe en esta carpeta. 1>&2
    exit /b 1
)
powershell.exe -NoProfile -Command "@{mcpServers=@{'alioth-pdf'=@{command=$env:ALIOTH_MCP_EXE;args=@()}}} | ConvertTo-Json -Depth 6"
exit /b %errorlevel%

:source
set "ALIOTH_PYTHON=%~dp0_python\python.exe"
if not exist "%ALIOTH_PYTHON%" set "ALIOTH_PYTHON=python"
"%ALIOTH_PYTHON%" "%~dp0alioth.py" mcp config
exit /b %errorlevel%
