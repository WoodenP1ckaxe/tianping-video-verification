$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
node scripts/maintenance.js backup
node scripts/maintenance.js prune

