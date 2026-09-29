@echo off
title BEDO - checks
rem Runs the type check and the unit/integration tests, and saves the output to checks-log.txt.
cd /d "%~dp0"
echo Running typecheck and unit tests... (this can take a minute)
(
  echo === typecheck ===
  call npm run typecheck
  echo.
  echo === unit + integration tests ===
  call npm run test:unit
) > checks-log.txt 2>&1
echo.
echo Done. Results are in checks-log.txt
type checks-log.txt | findstr /R /C:"Test Files" /C:"Tests " /C:"error TS" /C:"FAIL"
echo.
pause
