param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$IconPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "packaging\windows\TianpingControl.cs"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $csc)) {
  throw "未找到 Windows .NET Framework 4 编译器 csc.exe"
}

$buildDir = Join-Path $root "verification\control-build"
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$assemblyPath = Join-Path $buildDir "AssemblyInfo.cs"
$allParts = @($Version.Split(".") + @("0", "0", "0", "0"))
$parts = $allParts[0..3]
$assemblyVersion = $parts -join "."
$assemblyInfo = @"
using System.Reflection;
[assembly: AssemblyTitle("天平校验视频分析系统")]
[assembly: AssemblyDescription("天平校验视频分析系统本机控制面板")]
[assembly: AssemblyCompany("WoodenP1ckaxe")]
[assembly: AssemblyProduct("天平校验视频分析系统")]
[assembly: AssemblyCopyright("Copyright (c) 2026")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
"@
[System.IO.File]::WriteAllText($assemblyPath, $assemblyInfo, [System.Text.UTF8Encoding]::new($false))

$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$arguments = @(
  "/nologo",
  "/target:winexe",
  "/platform:anycpu",
  "/optimize+",
  "/codepage:65001",
  "/out:$OutputPath",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Net.Http.dll"
)
if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
  $arguments += "/win32icon:$IconPath"
}
$arguments += @($source, $assemblyPath)

& $csc @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
  throw "Windows 控制面板编译失败"
}
Write-Host "控制面板：$OutputPath"
