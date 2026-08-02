@echo off
REM Re-send every .ibt in the telemetry folder, forcing a fresh parse.
REM Run this after the analysis modules change: a session parsed before a module
REM existed carries no results for it, and the screens report it missing until
REM the file goes through again.
cd /d "%~dp0"
python -m pip install -r requirements.txt
python reingest.py %*
pause
