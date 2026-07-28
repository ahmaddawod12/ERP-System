param(
  [Parameter(Position = 0)]
  [ValidateSet("doctor", "start", "status", "stop", "reset", "archive", "help")]
  [string]$Command = "help",

  [switch]$Yes
)

$scriptArguments = @(
  (Join-Path $PSScriptRoot "local-platform.mjs"),
  $Command
)
if ($Yes) {
  $scriptArguments += "--yes"
}

& node @scriptArguments
exit $LASTEXITCODE
