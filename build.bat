@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Universal Translator (Desktop) - Build
echo ============================================
echo.
echo [1/2] Installing dependencies...
pip install pywebview pyinstaller
if errorlevel 1 goto :err

echo.
echo [2/2] Building exe (via UniversalTranslator.spec, includes OCR data)...
pyinstaller --noconfirm --clean UniversalTranslator.spec
if errorlevel 1 goto :err

echo.
echo Done! Output: dist\UniversalTranslator.exe
echo.
pause
exit /b 0

:err
echo.
echo Build failed. Check the messages above.
pause
exit /b 1