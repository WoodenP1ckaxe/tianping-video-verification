param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [string]$ExpectedVersion = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$Installer = (Resolve-Path -LiteralPath $Installer).Path
if (-not $ExpectedVersion) {
  $ExpectedVersion = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
}

$smokeRoot = Join-Path $root "verification\smoke\windows"
if (Test-Path -LiteralPath $smokeRoot) {
  $resolved = [System.IO.Path]::GetFullPath($smokeRoot)
  $rootPrefix = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理工作区外目录：$resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
$installDir = Join-Path $smokeRoot "installed"
$dataDir = Join-Path $smokeRoot "data"
$logDir = Join-Path $smokeRoot "logs"
New-Item -ItemType Directory -Path $smokeRoot, $dataDir, $logDir -Force | Out-Null

Write-Host "静默安装 Windows 包..."
$installArgs = @(
  "/VERYSILENT",
  "/SUPPRESSMSGBOXES",
  "/NORESTART",
  "/SP-",
  "/TASKS=",
  "/DIR=$installDir",
  "/LOG=$(Join-Path $logDir 'install.log')"
)
$install = Start-Process -FilePath $Installer -ArgumentList $installArgs -Wait -PassThru -WindowStyle Hidden
if ($install.ExitCode -ne 0) {
  throw "Windows 安装失败，退出码 $($install.ExitCode)"
}

$control = Join-Path $installDir "control\TianpingControl.exe"
$settingsPath = Join-Path $dataDir "settings.ini"
if (-not (Test-Path -LiteralPath $control)) {
  throw "安装后缺少控制面板：$control"
}

try {
  $env:TIANPING_DATA_DIR = $dataDir
  $start = Start-Process -FilePath $control -ArgumentList "--autostart" -PassThru -WindowStyle Hidden
  $start.WaitForExit()
  if ($start.ExitCode -ne 0) { throw "控制面板启动命令退出码 $($start.ExitCode)" }
  if (-not (Test-Path -LiteralPath $settingsPath)) {
    throw "服务启动后未生成 settings.ini"
  }
  $portMatch = Select-String -LiteralPath $settingsPath -Pattern '^PORT=(\d+)$'
  if (-not $portMatch) { throw "未读取到服务端口" }
  $port = [int]$portMatch.Matches[0].Groups[1].Value
  $url = "http://127.0.0.1:$port"

  $healthy = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $body = Invoke-RestMethod -Uri "$url/healthz" -TimeoutSec 3
      if ($body.status -eq "ok" -and $body.version -eq $ExpectedVersion) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    $log = Join-Path $dataDir "logs\control.log"
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 60 }
    throw "Windows 安装包健康检查失败"
  }

  $page = Invoke-WebRequest -Uri "$url/" -TimeoutSec 10
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch "天平校验视频分析系统") {
    throw "Windows 安装包首页加载失败"
  }
  Write-Host "Windows 安装、启动、健康检查和首页验证通过：$url" -ForegroundColor Green

  $stop = Start-Process -FilePath $control -ArgumentList "--stop" -Wait -PassThru -WindowStyle Hidden
  if ($stop.ExitCode -ne 0) { throw "控制面板停止命令失败" }
} finally {
  Remove-Item Env:TIANPING_DATA_DIR -ErrorAction SilentlyContinue
  $stopScript = Join-Path $installDir "control\TianpingControl.exe"
  if (Test-Path -LiteralPath $stopScript) {
    $env:TIANPING_DATA_DIR = $dataDir
    Start-Process -FilePath $stopScript -ArgumentList "--stop" -Wait -WindowStyle Hidden | Out-Null
    Remove-Item Env:TIANPING_DATA_DIR -ErrorAction SilentlyContinue
  }
}

$passwordPath = Join-Path $dataDir "initial-password.txt"
if (-not (Test-Path -LiteralPath $passwordPath)) {
  throw "首次启动未生成初始口令文件"
}

$uninstaller = Join-Path $installDir "unins000.exe"
if (-not (Test-Path -LiteralPath $uninstaller)) {
  throw "未找到 Windows 卸载程序"
}
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList @(
  "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"
) -Wait -PassThru -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) {
  throw "Windows 卸载测试失败，退出码 $($uninstall.ExitCode)"
}
if (Test-Path -LiteralPath (Join-Path $installDir "control\TianpingControl.exe")) {
  throw "卸载后程序文件仍存在"
}
if (-not (Test-Path -LiteralPath $passwordPath)) {
  throw "卸载错误删除了数据目录"
}
Write-Host "Windows 卸载与数据保留验证通过" -ForegroundColor Green
