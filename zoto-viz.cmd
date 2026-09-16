@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
if exist "%ROOT%.venv\Scripts\python.exe" (
  "%ROOT%.venv\Scripts\python.exe" "%ROOT%zoto-viz" %*
) else (
  python "%ROOT%zoto-viz" %*
)
exit /b %ERRORLEVEL%
