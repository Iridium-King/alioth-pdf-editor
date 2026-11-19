@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PYTHON_EXE=%SCRIPT_DIR%_python\python.exe"

if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=python"
)

if exist "%SCRIPT_DIR%alioth.py" goto source
if exist "%SCRIPT_DIR%Alioth_PDF_MCP.exe" goto portable
goto legacy

:source
if "%~1"=="--check" goto legacy
if "%~1"=="--test" goto legacy
"%PYTHON_EXE%" -u "%SCRIPT_DIR%alioth.py" mcp serve %*
exit /b %errorlevel%

:legacy
"%PYTHON_EXE%" -u "%SCRIPT_DIR%mcp_server.py" %*
exit /b %errorlevel%

:portable
"%SCRIPT_DIR%Alioth_PDF_MCP.exe" %*
exit /b %errorlevel%
