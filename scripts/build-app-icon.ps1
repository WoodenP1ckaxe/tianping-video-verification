param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function New-RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $arc = [System.Drawing.RectangleF]::new($rect.X, $rect.Y, $diameter, $diameter)
  $path.AddArc($arc, 180, 90)
  $arc.X = $rect.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $rect.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $rect.X
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-AppIcon([int]$size) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $margin = [Math]::Max(1.0, $size * 0.025)
  $rect = [System.Drawing.RectangleF]::new($margin, $margin, $size - 2 * $margin, $size - 2 * $margin)
  $path = New-RoundedPath $rect ([Math]::Max(2.0, $size * 0.2))
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(25, 96, 169),
    [System.Drawing.Color]::FromArgb(18, 145, 122),
    35.0
  )
  $graphics.FillPath($brush, $path)

  $penWidth = [Math]::Max(1.2, $size * 0.038)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $penWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $cx = $size / 2.0
  $top = $size * 0.25
  $beam = $size * 0.255
  $bottom = $size * 0.72
  $graphics.DrawLine($pen, $cx, $top, $cx, $bottom)
  $graphics.DrawLine($pen, $cx - $beam, $size * 0.37, $cx + $beam, $size * 0.37)
  $graphics.DrawLine($pen, $cx, $size * 0.27, $cx - $beam, $size * 0.37)
  $graphics.DrawLine($pen, $cx, $size * 0.27, $cx + $beam, $size * 0.37)
  $graphics.DrawLine($pen, $cx - $size * 0.18, $bottom, $cx + $size * 0.18, $bottom)

  $panWidth = [Math]::Max(2.0, $size * 0.23)
  $panY = $size * 0.57
  $arcPenWidth = [Math]::Max(1.0, $size * 0.03)
  $panPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, $arcPenWidth)
  $panPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $panPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  foreach ($offset in @(-$beam, $beam)) {
    $graphics.DrawLine($pen, $cx + $offset, $size * 0.37, $cx + $offset, $size * 0.48)
    $graphics.DrawArc($panPen, [float]($cx + $offset - $panWidth / 2), [float]$panY, [float]$panWidth, [float]($size * 0.13), 0, 180)
  }

  $graphics.Dispose()
  $brush.Dispose()
  $path.Dispose()
  $pen.Dispose()
  $panPen.Dispose()
  return $bitmap
}

$iconPngs = [System.Collections.Generic.List[byte[]]]::new()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $bitmap = Draw-AppIcon $size
  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $iconPngs.Add($bytes)
  if ($size -eq 256) {
    $bitmap.Save((Join-Path $OutputDirectory "app-icon-preview.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $stream.Dispose()
  $bitmap.Dispose()
}

$iconPath = Join-Path $OutputDirectory "app.ico"
$file = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$iconPngs.Count)
$offset = 6 + 16 * $iconPngs.Count
$sizes = @(16, 24, 32, 48, 64, 128, 256)
for ($index = 0; $index -lt $iconPngs.Count; $index++) {
  $size = $sizes[$index]
  $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$iconPngs[$index].Length)
  $writer.Write([UInt32]$offset)
  $offset += $iconPngs[$index].Length
}
foreach ($bytes in $iconPngs) { $writer.Write($bytes) }
$writer.Dispose()
$file.Dispose()

function New-WizardImage([string]$path, [int]$width, [int]$height, [bool]$compact) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(19, 48, 82),
    [System.Drawing.Color]::FromArgb(18, 128, 116),
    60.0
  )
  $graphics.FillRectangle($gradient, $rect)

  $logoSize = if ($compact) { 42 } else { 94 }
  $logo = Draw-AppIcon $logoSize
  $logoPath = if ($compact) { [System.Drawing.Point]::new(7, 6) } else { [System.Drawing.Point]::new(35, 35) }
  $graphics.DrawImage($logo, $logoPath)
  $logo.Dispose()

  if (-not $compact) {
    $fontTitle = [System.Drawing.Font]::new("Microsoft YaHei UI", 15, [System.Drawing.FontStyle]::Bold)
    $fontBody = [System.Drawing.Font]::new("Microsoft YaHei UI", 9)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(205, 224, 240))
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString("天平校验", $fontTitle, $white, [System.Drawing.RectangleF]::new(0, 142, $width, 36), $format)
    $graphics.DrawString("视频分析系统", $fontTitle, $white, [System.Drawing.RectangleF]::new(0, 178, $width, 36), $format)
    $graphics.DrawString("完全离线安装", $fontBody, $muted, [System.Drawing.RectangleF]::new(0, 236, $width, 26), $format)
    $graphics.DrawString("数据保存在本机", $fontBody, $muted, [System.Drawing.RectangleF]::new(0, 260, $width, 26), $format)
    $fontTitle.Dispose()
    $fontBody.Dispose()
    $white.Dispose()
    $muted.Dispose()
    $format.Dispose()
  }
  $gradient.Dispose()
  $graphics.Dispose()
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bitmap.Dispose()
}

New-WizardImage (Join-Path $OutputDirectory "wizard-large.bmp") 164 314 $false
New-WizardImage (Join-Path $OutputDirectory "wizard-small.bmp") 55 55 $true
Write-Host "安装图标与向导图片：$OutputDirectory"
