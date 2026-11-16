@echo off
rem Claude Code as the autopilot agent. See agent-claude.ps1.
rem   node scripts/autopilot.mjs --once --agent-cmd "scripts\agent-claude.cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-claude.ps1"
exit /b %ERRORLEVEL%
