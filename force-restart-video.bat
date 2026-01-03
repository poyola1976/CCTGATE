@echo off
echo --- FORCE RESTART VIDEO RELAY ---
echo Finding processes on port 8000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do (
    echo Killing blocking PID: %%a
    taskkill /F /PID %%a
)

echo.
echo All blocking processes killed.
echo Starting NodeMediaServer...
echo.

cd backend\video-relay
npm start
pause
