# Claude Code as the autopilot agent.
#
# The loop hands every round a prompt file; this script feeds it to `claude -p`
# as one argument, so nothing is re-quoted on the way. Exit code is forwarded:
# the driver treats a non-zero exit as a failed round and stops.
#
#   node scripts/autopilot.mjs --once --agent-cmd "scripts\agent-claude.cmd"
#
# Needs the Claude Code CLI on PATH (`claude --version`) and a signed-in
# account. `--dangerously-skip-permissions` lets it edit files without a prompt;
# that is the same power the driver gives the dsh headless profile.

$ErrorActionPreference = 'Stop'

$promptFile = $env:AUTOPILOT_PROMPT_FILE
if (-not $promptFile) { $promptFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.improve\round-prompt.txt' }
if (-not (Test-Path -LiteralPath $promptFile)) {
  Write-Error "agent-claude: prompt file not found: $promptFile"
  exit 2
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Error 'agent-claude: the claude CLI is not on PATH'
  exit 127
}

$prompt = Get-Content -Raw -LiteralPath $promptFile
& claude -p $prompt --dangerously-skip-permissions
exit $LASTEXITCODE
