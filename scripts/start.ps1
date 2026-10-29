param(
  [switch]$Build,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

if ($Build) {
  docker compose build
}

if ($Foreground) {
  docker compose up
} else {
  docker compose up -d
  docker compose ps
  Write-Host "系统地址：http://127.0.0.1:$($env:TIANPING_PORT ?? '8080')"
}

