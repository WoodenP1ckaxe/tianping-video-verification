param(
  [string]$Version = "",
  [string]$AssetCache = "",
  [switch]$WindowsOnly,
  [switch]$LinuxOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $package.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "版本号必须是 x.y.z：$Version"
}
if ($WindowsOnly -and $LinuxOnly) {
  throw "不能同时指定 -WindowsOnly 和 -LinuxOnly"
}

if (-not $AssetCache) {
  $AssetCache = Join-Path $root "verification\release-assets"
}
$AssetCache = [System.IO.Path]::GetFullPath($AssetCache)
$buildRoot = Join-Path $root "verification\release-build"
$releaseRoot = Join-Path $root ("release\v" + $Version)
$rootPrefix = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'

function Reset-ManagedDirectory([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理工作区外的目录：$full"
  }
  if (Test-Path -LiteralPath $full) {
    Remove-Item -LiteralPath $full -Recurse -Force
  }
  New-Item -ItemType Directory -Path $full -Force | Out-Null
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "源目录不存在：$Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Expand-GzipFile([string]$Source, [string]$Destination) {
  $targetDirectory = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
  $input = [System.IO.File]::OpenRead($Source)
  $gzip = [System.IO.Compression.GZipStream]::new(
    $input,
    [System.IO.Compression.CompressionMode]::Decompress
  )
  $output = [System.IO.File]::Create($Destination)
  try {
    $gzip.CopyTo($output)
  } finally {
    $output.Dispose()
    $gzip.Dispose()
    $input.Dispose()
  }
}

function Copy-App([string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($file in @("server.js", "package.json", "package-lock.json", "README.md", "LICENSE")) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $Destination -Force
  }
  foreach ($directory in @("src", "public")) {
    Copy-Item -LiteralPath (Join-Path $root $directory) -Destination $Destination -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $root "node_modules") -Destination $Destination -Recurse -Force
  $binDirectory = Join-Path $Destination "node_modules\.bin"
  if (Test-Path -LiteralPath $binDirectory) {
    Remove-Item -LiteralPath $binDirectory -Recurse -Force
  }
}

function Copy-DocsAndLicenses(
  [string]$PayloadRoot,
  [string]$NodeLicense,
  [string]$FfmpegLicense,
  [string]$UsageFileName = "使用说明.html"
) {
  $docs = Join-Path $PayloadRoot "docs"
  $licenses = Join-Path $PayloadRoot "licenses"
  New-Item -ItemType Directory -Path $docs, $licenses -Force | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $root "docs") -Filter "*.md" -File |
    Copy-Item -Destination $docs -Force
  $usageSource = Join-Path $root "packaging\assets\使用说明.html"
  $usageText = Get-Content -LiteralPath $usageSource -Raw
  $usageText = $usageText.Replace("V__TIANPING_VERSION__", "V$Version")
  [System.IO.File]::WriteAllText(
    (Join-Path $docs $UsageFileName),
    $usageText,
    [System.Text.UTF8Encoding]::new($false)
  )
  Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination (Join-Path $licenses "PROJECT-LICENSE.txt") -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\common\THIRD_PARTY_NOTICES.md") -Destination $licenses -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\common\SOURCE_OFFER.txt") -Destination $licenses -Force
  if ($NodeLicense -and (Test-Path -LiteralPath $NodeLicense)) {
    Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $licenses "NODEJS-LICENSE.txt") -Force
  }
  if ($FfmpegLicense -and (Test-Path -LiteralPath $FfmpegLicense)) {
    Copy-Item -LiteralPath $FfmpegLicense -Destination (Join-Path $licenses "FFMPEG-LICENSE.txt") -Force
  }
  Copy-Item -LiteralPath (Join-Path $AssetCache "OFL.txt") -Destination (Join-Path $licenses "NOTO-FONT-OFL.txt") -Force

  $packageLicenses = @(
    @{ Source = "node_modules\tesseract.js\LICENSE.md"; Name = "TESSERACT-JS-LICENSE.txt" },
    @{ Source = "node_modules\tesseract.js-core\LICENSE"; Name = "TESSERACT-JS-CORE-LICENSE.txt" },
    @{ Source = "node_modules\jsqr\LICENSE"; Name = "JSQR-LICENSE.txt" },
    @{ Source = "node_modules\jpeg-js\LICENSE"; Name = "JPEG-JS-LICENSE.txt" },
    @{ Source = "node_modules\@hyzyla\pdfium\LICENSE.md"; Name = "HYZYLA-PDFIUM-LICENSE.txt" },
    @{ Source = "node_modules\pngjs\LICENSE"; Name = "PNGJS-LICENSE.txt" }
  )
  foreach ($entry in $packageLicenses) {
    $source = Join-Path $root $entry.Source
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $licenses $entry.Name) -Force
    }
  }

  $packageLicenseDir = Join-Path $licenses "packages"
  New-Item -ItemType Directory -Path $packageLicenseDir -Force | Out-Null
  $moduleRoot = Join-Path $root "node_modules"
  $moduleDirectories = @()
  foreach ($top in Get-ChildItem -LiteralPath $moduleRoot -Directory | Where-Object Name -ne ".bin") {
    if ($top.Name.StartsWith("@")) {
      $moduleDirectories += Get-ChildItem -LiteralPath $top.FullName -Directory
    } else {
      $moduleDirectories += $top
    }
  }
  foreach ($module in $moduleDirectories) {
    $licenseFile = Get-ChildItem -LiteralPath $module.FullName -File |
      Where-Object Name -match "^(LICENSE|LICENCE|COPYING)" |
      Select-Object -First 1
    if (-not $licenseFile) { continue }
    $label = if ($module.Parent.Name.StartsWith("@")) {
      "$($module.Parent.Name.Substring(1))-$($module.Name)"
    } else {
      $module.Name
    }
    Copy-Item -LiteralPath $licenseFile.FullName `
      -Destination (Join-Path $packageLicenseDir "$label-$($licenseFile.Name)") -Force
  }
}

function Build-Windows([string]$NodeLicense, [string]$FfmpegLicense, [string]$BrandingRoot) {
  Write-Host "`n[Windows] 准备应用载荷..." -ForegroundColor Cyan
  $windowsRoot = Join-Path $buildRoot "windows"
  $payload = Join-Path $windowsRoot "payload"
  Reset-ManagedDirectory $windowsRoot
  $app = Join-Path $payload "app"
  $runtime = Join-Path $payload "runtime"
  $control = Join-Path $payload "control"
  New-Item -ItemType Directory -Path $runtime, $control -Force | Out-Null
  Copy-App $app

  $nodeExe = $env:TIANPING_NODE_EXE
  if (-not $nodeExe) { $nodeExe = Join-Path "C:\Program Files\nodejs" "node.exe" }
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw "未找到 Windows node.exe；请设置 TIANPING_NODE_EXE"
  }
  $nodeVersion = & $nodeExe --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
    throw "Windows 安装包要求 Node.js 24，当前为 $nodeVersion"
  }
  Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtime "node.exe") -Force

  Expand-GzipFile (Join-Path $AssetCache "ffmpeg-win32-x64.gz") (Join-Path $runtime "ffmpeg.exe")
  Expand-GzipFile (Join-Path $AssetCache "ffprobe-win32-x64.gz") (Join-Path $runtime "ffprobe.exe")
  if ((Get-Item -LiteralPath (Join-Path $runtime "ffmpeg.exe")).Length -lt 20MB `
    -or (Get-Item -LiteralPath (Join-Path $runtime "ffprobe.exe")).Length -lt 20MB) {
    throw "固定 FFmpeg 资产解压结果无效"
  }
  New-Item -ItemType Directory -Path (Join-Path $runtime "fonts") -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $AssetCache "NotoSansCJKsc-VF.ttf") -Destination (Join-Path $runtime "fonts\NotoSansCJKsc-VF.ttf") -Force

  $controlExe = Join-Path $control "TianpingControl.exe"
  & (Join-Path $root "scripts\build-windows-control.ps1") `
    -Version $Version `
    -OutputPath $controlExe `
    -IconPath (Join-Path $BrandingRoot "app.ico")
  Copy-DocsAndLicenses $payload $NodeLicense $FfmpegLicense

  $iscc = $env:TIANPING_ISCC
  if (-not $iscc) {
    $candidate = Join-Path $root "verification\InnoSetup6\ISCC.exe"
    if (Test-Path -LiteralPath $candidate) { $iscc = $candidate }
  }
  if (-not $iscc) {
    $command = Get-Command iscc -ErrorAction SilentlyContinue
    if ($command) { $iscc = $command.Source }
  }
  if (-not $iscc -or -not (Test-Path -LiteralPath $iscc)) {
    throw "未找到 Inno Setup ISCC.exe；请安装 Inno Setup 6 或设置 TIANPING_ISCC"
  }

  $generatedIss = Join-Path $windowsRoot "installer.generated.iss"
  $issText = Get-Content -LiteralPath (Join-Path $root "packaging\windows\installer.iss") -Raw
  [System.IO.File]::WriteAllText($generatedIss, $issText, [System.Text.UTF8Encoding]::new($true))
  $isccArgs = @(
    "/Qp",
    "/DMyAppVersion=$Version",
    "/DPayloadRoot=$payload",
    "/DAssetsRoot=$BrandingRoot",
    "/DOutputRoot=$releaseRoot",
    "/DChineseLanguageFile=$(Join-Path $AssetCache 'ChineseSimplified.isl')",
    "/DLicenseFile=$(Join-Path $root 'LICENSE')",
    $generatedIss
  )
  & $iscc @isccArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup 编译失败"
  }
  $installer = Join-Path $releaseRoot "TianpingVideoVerification-$Version-Windows-x64-Setup.exe"
  if (-not (Test-Path -LiteralPath $installer)) {
    throw "Windows 安装包未生成：$installer"
  }
  Write-Host "[Windows] $installer" -ForegroundColor Green
}

function Build-Linux([string]$NodeLicense, [string]$FfmpegLicense, [string]$BrandingRoot) {
  Write-Host "`n[Linux] 提取离线运行时..." -ForegroundColor Cyan
  $linuxRoot = Join-Path $buildRoot "linux"
  Reset-ManagedDirectory $linuxRoot
  $extractNode = Join-Path $linuxRoot "extract-node"
  $stage = Join-Path $linuxRoot "TianpingVideoVerification-$Version-linux-x64"
  New-Item -ItemType Directory -Path $extractNode, $stage -Force | Out-Null

  & tar -xJf (Join-Path $AssetCache "node-v24.12.0-linux-x64.tar.xz") -C $extractNode `
    "node-v24.12.0-linux-x64/bin/node" "node-v24.12.0-linux-x64/LICENSE"
  if ($LASTEXITCODE -ne 0) { throw "Node.js Linux 压缩包解压失败" }
  $app = Join-Path $stage "app"
  $runtime = Join-Path $stage "runtime"
  $runtimeBin = Join-Path $runtime "bin"
  $control = Join-Path $stage "control"
  New-Item -ItemType Directory -Path $runtimeBin, (Join-Path $runtime "fonts"), $control -Force | Out-Null
  Copy-App $app
  $nodeExtract = Get-ChildItem -LiteralPath $extractNode -Directory | Select-Object -First 1
  if (-not $NodeLicense) {
    $NodeLicense = Join-Path $nodeExtract.FullName "LICENSE"
  }
  if (-not $FfmpegLicense) {
    $FfmpegLicense = Join-Path $AssetCache "FFMPEG-GPLv3.txt"
  }
  Copy-Item -LiteralPath (Join-Path $nodeExtract.FullName "bin\node") -Destination (Join-Path $runtime "node") -Force
  Expand-GzipFile (Join-Path $AssetCache "ffmpeg-linux-x64.gz") (Join-Path $runtimeBin "ffmpeg")
  Expand-GzipFile (Join-Path $AssetCache "ffprobe-linux-x64.gz") (Join-Path $runtimeBin "ffprobe")
  Copy-Item -LiteralPath (Join-Path $AssetCache "NotoSansCJKsc-VF.ttf") -Destination (Join-Path $runtime "fonts\NotoSansCJKsc-VF.ttf") -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\linux\service.sh") -Destination (Join-Path $control "service.sh") -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\linux\uninstall.sh") -Destination (Join-Path $control "uninstall.sh") -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\linux\install.sh") -Destination (Join-Path $stage "install.sh") -Force
  Copy-Item -LiteralPath (Join-Path $root "packaging\linux\README.txt") -Destination (Join-Path $stage "README.txt") -Force
  Copy-Item -LiteralPath (Join-Path $BrandingRoot "app-icon-preview.png") -Destination (Join-Path $stage "icon.png") -Force
  [System.IO.File]::WriteAllText((Join-Path $stage "VERSION"), "$Version`n", [System.Text.UTF8Encoding]::new($false))
  Copy-DocsAndLicenses $stage $NodeLicense $FfmpegLicense "QUICK_START.html"

  $archive = Join-Path $releaseRoot "TianpingVideoVerification-$Version-Linux-x64.tar.gz"
  & tar -czf $archive -C $linuxRoot (Split-Path -Leaf $stage)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archive)) {
    throw "Linux 安装包生成失败"
  }
  Write-Host "[Linux] $archive" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath (Join-Path $AssetCache "NotoSansCJKsc-VF.ttf"))) {
  & (Join-Path $root "scripts\fetch-release-assets.mjs")
  if ($LASTEXITCODE -ne 0) { throw "发布资源准备失败" }
}

Reset-ManagedDirectory $buildRoot
Reset-ManagedDirectory $releaseRoot
$brandingRoot = Join-Path $buildRoot "branding"
& (Join-Path $root "scripts\build-app-icon.ps1") -OutputDirectory $brandingRoot

$nodeLicense = ""
$ffmpegLicense = ""
if (-not $LinuxOnly) {
  $licenseNodeExe = $env:TIANPING_NODE_EXE
  if (-not $licenseNodeExe) { $licenseNodeExe = Join-Path "C:\Program Files\nodejs" "node.exe" }
  if ($licenseNodeExe) {
    $nodeLicense = Join-Path (Split-Path -Parent $licenseNodeExe) "LICENSE"
  }
  $ffmpegLicense = Join-Path $AssetCache "FFMPEG-GPLv3.txt"
  Build-Windows $nodeLicense $ffmpegLicense $brandingRoot
}

if (-not $WindowsOnly) {
  Build-Linux $nodeLicense $ffmpegLicense $brandingRoot
}

$readmeSource = Join-Path $root "docs\QUICK_START.md"
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $releaseRoot "QUICK_START.md") -Force
$htmlText = (Get-Content -LiteralPath (Join-Path $root "packaging\assets\使用说明.html") -Raw).Replace("V__TIANPING_VERSION__", "V$Version")
[System.IO.File]::WriteAllText(
  (Join-Path $releaseRoot "QUICK_START.html"),
  $htmlText,
  [System.Text.UTF8Encoding]::new($false)
)

$releaseNotes = @"
# 天平校验视频分析系统 V$Version

## 交付文件

- Windows 10/11 x64 图形化离线安装包
- Linux x86_64 离线安装包
- 中文快速使用说明
- SHA-256 完整性校验文件

Windows 和 Linux 安装包均内置 Node.js 24、FFmpeg/FFprobe、中文字体和纯离线
PDFium 预览组件。安装及运行不需要联网，不依赖客户预先安装 Docker、Node.js 或
FFmpeg。

## 首次使用

安装完成后打开控制面板，使用管理员账号 U000 和界面显示的一次性口令登录。
检验人员账号为 U001/U002，复核确认人员账号为 U003。首次登录后必须修改口令。

## 完整性

使用 SHA256SUMS.txt 核对安装包。安装包当前未进行商业代码签名；正式交付前建议
由组织使用受信任代码签名证书签名。
"@
[System.IO.File]::WriteAllText((Join-Path $releaseRoot "RELEASE_NOTES.md"), $releaseNotes, [System.Text.UTF8Encoding]::new($false))

$hashLines = foreach ($file in Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object Name -ne "SHA256SUMS.txt" | Sort-Object Name) {
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($file.Name)"
}
[System.IO.File]::WriteAllText(
  (Join-Path $releaseRoot "SHA256SUMS.txt"),
  (($hashLines -join "`n") + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "`n发布文件已生成：$releaseRoot" -ForegroundColor Green
Get-ChildItem -LiteralPath $releaseRoot -File | Select-Object Name, Length
