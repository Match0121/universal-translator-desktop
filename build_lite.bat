@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  Universal Translator (Lite, no OCR) - Build
echo ============================================
echo.
echo Building lite exe (excludes onnxruntime/opencv/rapidocr)...
pyinstaller --noconfirm --clean --onefile --windowed --name "UniversalTranslator-lite" ^
  --add-data "web;web" ^
  --exclude-module onnxruntime ^
  --exclude-module rapidocr_onnxruntime ^
  --exclude-module cv2 ^
  --exclude-module shapely ^
  --exclude-module pyclipper ^
  --exclude-module coloredlogs ^
  --exclude-module humanfriendly ^
  --exclude-module tqdm ^
  --exclude-module flatbuffers ^
  --exclude-module PyYAML ^
  --exclude-module pyreadline3 ^
  --exclude-module six ^
  --exclude-module protobuf ^
  desktop.py
if errorlevel 1 goto :err

echo.
echo Done! Output: dist\UniversalTranslator-lite.exe
echo.
pause
exit /b 0

:err
echo.
echo Build failed. Check the messages above.
pause
exit /b 1