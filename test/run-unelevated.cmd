@echo off
rem Launch through Explorer (`explorer.exe test\run-unelevated.cmd`) to run the smoke test
rem at medium integrity from an elevated shell. Output goes to test\unelevated.log.
cd /d "%~dp0.."
whoami /groups | findstr /c:"Mandatory Level" > test\unelevated.log
node test\smoke.mjs >> test\unelevated.log 2>&1
echo exit %errorlevel% >> test\unelevated.log
