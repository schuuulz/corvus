@echo off
rem Corvus: shows the current branch in the prompt, in its graph colour.
rem cmd's PROMPT is fixed text, so this rebuilds it at startup and, through
rem the doskey macro, after every git command typed in this terminal.
doskey git=git $* $T call "%~f0"

set "CORVUS_BRANCH="
for /f "delims=" %%b in ('git branch --show-current 2^>nul') do set "CORVUS_BRANCH=%%b"
if not defined CORVUS_BRANCH (
    prompt $P$G
    goto :eof
)

rem Branch names may contain cmd operators and quotes, which run as commands
rem if the name is expanded with percent signs. Delayed expansion reads it
rem without re-parsing it, and the label below spells each operator as its
rem prompt code, so the name is inert by the time it leaves setlocal.
setlocal EnableDelayedExpansion

rem Trunk green, unless the app has coloured this branch.
set "CORVUS_RGB=16;185;129"
for /f "usebackq tokens=1,2" %%a in ("%CORVUS_PROMPT_FILE%") do if "%%a"=="!CORVUS_BRANCH!" set "CORVUS_RGB=%%b"

set "CORVUS_LABEL=!CORVUS_BRANCH:$=$$!"
set "CORVUS_LABEL=!CORVUS_LABEL:&=$A!"
set "CORVUS_LABEL=!CORVUS_LABEL:|=$B!"
set "CORVUS_LABEL=!CORVUS_LABEL:<=$L!"
set "CORVUS_LABEL=!CORVUS_LABEL:>=$G!"
endlocal & prompt $P $E[38;2;%CORVUS_RGB%m(%CORVUS_LABEL%)$E[0m$G
