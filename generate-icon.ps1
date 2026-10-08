$ErrorActionPreference = "Stop"
[void][Reflection.Assembly]::LoadWithPartialName("System.Drawing")

function Get-RoundedRect($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-Icon($size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $scale = $size / 1024.0

    # Background gradient
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $bgRect,
        [System.Drawing.Color]::FromArgb(26, 26, 46),
        [System.Drawing.Color]::FromArgb(49, 46, 129),
        45.0
    )

    $bgPath = Get-RoundedRect 0 0 $size $size ([int](224 * $scale))
    $g.FillPath($bgBrush, $bgPath)

    # Outer glow ring
    $ringPen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(90, 129, 140, 248),
        [single](8 * $scale)
    )
    $ringRect = [System.Drawing.Rectangle]::FromLTRB(
        [int](96 * $scale),
        [int](96 * $scale),
        [int]((1024 - 96) * $scale),
        [int]((1024 - 96) * $scale)
    )
    $ringPath = Get-RoundedRect $ringRect.Left $ringRect.Top $ringRect.Width $ringRect.Height ([int](176 * $scale))
    $g.DrawPath($ringPen, $ringPath)

    # Monitor frame
    $frameRect = [System.Drawing.Rectangle]::FromLTRB(
        [int](172 * $scale),
        [int](220 * $scale),
        [int]((172 + 680) * $scale),
        [int]((220 + 480) * $scale)
    )
    $screenRect = [System.Drawing.Rectangle]::FromLTRB(
        $frameRect.Left + [int](16 * $scale),
        $frameRect.Top + [int](16 * $scale),
        $frameRect.Right - [int](16 * $scale),
        $frameRect.Bottom - [int](16 * $scale)
    )
    $screenBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $screenRect,
        [System.Drawing.Color]::FromArgb(15, 23, 42),
        [System.Drawing.Color]::FromArgb(30, 27, 75),
        90.0
    )
    $framePath = Get-RoundedRect $frameRect.Left $frameRect.Top $frameRect.Width $frameRect.Height ([int](48 * $scale))
    $g.FillPath($screenBrush, $framePath)

    $framePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 102, 241), [single](16 * $scale))
    $g.DrawPath($framePen, $framePath)

    # Waveform
    $wavePen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(192, 132, 252),
        [single](28 * $scale)
    )
    $wavePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $wavePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $wavePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $points = @(
        [System.Drawing.PointF]::new(252 * $scale, 460 * $scale),
        [System.Drawing.PointF]::new(340 * $scale, 460 * $scale),
        [System.Drawing.PointF]::new(380 * $scale, 360 * $scale),
        [System.Drawing.PointF]::new(440 * $scale, 560 * $scale),
        [System.Drawing.PointF]::new(500 * $scale, 420 * $scale),
        [System.Drawing.PointF]::new(560 * $scale, 500 * $scale),
        [System.Drawing.PointF]::new(620 * $scale, 340 * $scale),
        [System.Drawing.PointF]::new(680 * $scale, 460 * $scale),
        [System.Drawing.PointF]::new(772 * $scale, 460 * $scale)
    )
    $g.DrawCurve($wavePen, $points, 0.3)

    # Stand
    $standPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sx1 = 392 * $scale
    $sx2 = 440 * $scale
    $sx3 = 460 * $scale
    $sx4 = 564 * $scale
    $sx5 = 584 * $scale
    $sx6 = 632 * $scale
    $sy1 = 700 * $scale
    $sy2 = 740 * $scale
    $sy3 = 764 * $scale
    $standPath.AddPolygon(@(
        [System.Drawing.PointF]::new($sx1, $sy1),
        [System.Drawing.PointF]::new($sx2, $sy1),
        [System.Drawing.PointF]::new($sx3, $sy2),
        [System.Drawing.PointF]::new($sx4, $sy2),
        [System.Drawing.PointF]::new($sx5, $sy1),
        [System.Drawing.PointF]::new($sx6, $sy1),
        [System.Drawing.PointF]::new($sx6, $sy3),
        [System.Drawing.PointF]::new($sx1, $sy3)
    ))
    $standBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(79, 70, 229))
    $g.FillPath($standBrush, $standPath)

    # Tracking dot
    $dotX = 756 * $scale
    $dotY = 300 * $scale
    $dotR = 28 * $scale
    $glowR = 44 * $scale
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 244, 114, 182))
    $g.FillEllipse($glowBrush, $dotX - $glowR, $dotY - $glowR, $glowR * 2, $glowR * 2)
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(244, 114, 182))
    $g.FillEllipse($dotBrush, $dotX - $dotR, $dotY - $dotR, $dotR * 2, $dotR * 2)

    # Corner highlight
    $hlPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(153, 165, 252), [single](10 * $scale))
    $hlPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $hlPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($hlPen, $frameRect.Left + [int](24 * $scale), $frameRect.Top + [int](24 * $scale), [int](48 * $scale), [int](48 * $scale), 180, 90)

    $g.Dispose()
    return $bmp
}

function Save-Icon($sizes) {
    $outDir = "D:\lifecode\screen-tracker\assets"
    if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    # Save large PNG
    $png = Draw-Icon 1024
    $png.Save("$outDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $png.Dispose()
    Write-Host "Saved PNG: $outDir\icon.png"

    # Save ICO with multiple sizes
    $icoPath = "$outDir\icon.ico"
    $bitmaps = @()
    $sizeList = $sizes

    foreach ($s in $sizeList) {
        $bitmaps += Draw-Icon $s
    }

    [System.IO.MemoryStream]$ms = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($ms)

    # ICO header
    $writer.Write([Int16]0) # Reserved
    $writer.Write([Int16]1) # Type: icon
    $writer.Write([Int16]$bitmaps.Count) # Count

    $offset = 6 + 16 * $bitmaps.Count
    $imageData = @()

    foreach ($bmp in $bitmaps) {
        $mem = New-Object System.IO.MemoryStream
        $bmp.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
        $data = $mem.ToArray()
        $mem.Dispose()

        $w = $bmp.Width
        $h = $bmp.Height
        if ($w -ge 256) { $w = 0 }
        if ($h -ge 256) { $h = 0 }

        $writer.Write([byte]$w)
        $writer.Write([byte]$h)
        $writer.Write([byte]0) # Colors
        $writer.Write([byte]0) # Reserved
        $writer.Write([Int16]1) # Color planes
        $writer.Write([Int16]32) # Bits per pixel
        $writer.Write([int]$data.Length)
        $writer.Write([int]$offset)

        $imageData += ,$data
        $offset += $data.Length
    }

    foreach ($data in $imageData) {
        $writer.Write($data)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
    $writer.Dispose()
    $ms.Dispose()

    foreach ($bmp in $bitmaps) { $bmp.Dispose() }
    Write-Host "Saved ICO: $icoPath"
}

Save-Icon @(16, 32, 48, 64, 128, 256)
