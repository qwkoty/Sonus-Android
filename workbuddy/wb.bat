@echo off
setlocal
set "JS=%~dp0wb-token.js"
if not exist "%JS%" goto :nojs

set "EXE="
for %%p in (
  "%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe"
  "%LOCALAPPDATA%\Programs\workbuddy\WorkBuddy.exe"
  "%LOCALAPPDATA%\Programs\CodeBuddy\CodeBuddy.exe"
  "%ProgramFiles%\WorkBuddy\WorkBuddy.exe"
  "%ProgramFiles%\CodeBuddy\CodeBuddy.exe"
) do if exist %%p if not defined EXE set "EXE=%%~p"

if not defined EXE goto :ask
goto :run

:ask
echo.
echo 没有自动找到 WorkBuddy 客户端。
echo 请先打开 WorkBuddy，在任务管理器里找到它，右键"打开文件所在位置"，
echo 把目录里的 WorkBuddy.exe 完整路径复制下来。
set /p EXE=粘贴路径后回车: 
if not exist "%EXE%" goto :bad

:run
echo.
echo 使用客户端: %EXE%
set ELECTRON_RUN_AS_NODE=1
"%EXE%" "%JS%"
echo.
pause
exit /b 0

:nojs
echo 缺少 wb-token.js，请与 wb.bat 放在同一目录。
pause
exit /b 1

:bad
echo 路径无效: %EXE%
pause
exit /b 1
