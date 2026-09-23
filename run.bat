@echo off
setlocal
cd /d "%~dp0"

REM Nova AI Chatbot - Windows launcher.
REM Uses the virtual environment's own Python, so no activation needed.

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo [ERROR] Virtual environment not found.
    echo.
    echo Please run these commands first:
    echo     py -m venv .venv
    echo     .venv\Scripts\python.exe -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example.
    echo        Open .env and set your AI_API_KEY and AI_MODEL, then run this file again.
    pause
    exit /b 1
)

set APP_PORT=8000
for /f "tokens=2 delims==" %%a in ('findstr /b "APP_PORT=" .env 2^>nul') do set "APP_PORT=%%a"

echo.
echo Starting Nova AI Chatbot...
echo Open http://127.0.0.1:%APP_PORT% in your browser.
echo Press Ctrl+C to stop the server.
echo.

".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --port %APP_PORT%

pause