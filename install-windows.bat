@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_FILE=%APP_DIR%index.html"
set "ICON_FILE=%APP_DIR%app-icon.ico"
set "SHORTCUT=%USERPROFILE%\Desktop\Sheet Metal Bend Calculator.url"

> "%SHORTCUT%" echo [InternetShortcut]
>> "%SHORTCUT%" echo URL=file:///%APP_FILE:\=/%
>> "%SHORTCUT%" echo IconFile=%ICON_FILE%
>> "%SHORTCUT%" echo IconIndex=0

echo Desktop shortcut created:
echo %SHORTCUT%
echo.
pause
