# Creates a "Sketch" shortcut on the desktop that opens the app.
# Run: powershell -ExecutionPolicy Bypass -File scripts/make-shortcut.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $root 'scripts\sketch.ico'

# Draw the icon: a benzene ring on a rounded accent square, saved as a PNG-in-ICO.
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$bg = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56; $w = $size - 1
$bg.AddArc(0, 0, $r, $r, 180, 90); $bg.AddArc($w - $r, 0, $r, $r, 270, 90)
$bg.AddArc($w - $r, $w - $r, $r, $r, 0, 90); $bg.AddArc(0, $w - $r, $r, $r, 90, 90); $bg.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 79, 70, 229))), $bg)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 14
$pen.LineJoin = 'Round'
$c = $size / 2; $R = 78
$pts = 0..5 | ForEach-Object { $a = [Math]::PI / 180 * (60 * $_ - 90); New-Object System.Drawing.PointF ($c + $R * [Math]::Cos($a)), ($c + $R * [Math]::Sin($a)) }
$g.DrawPolygon($pen, [System.Drawing.PointF[]]$pts)
$g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 10), $c - 42, $c - 42, 84, 84)
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)       # ICO header, 1 image
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0) # 256x256, no palette
$bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png); $bw.Flush()
[System.IO.File]::WriteAllBytes($icon, $out.ToArray())

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Sketch.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $root 'scripts\launch.vbs') + '"'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$icon,0"
$lnk.Description = 'Sketch: draw molecules and reaction mechanisms'
$lnk.Save()
Write-Output "Shortcut created: $(Join-Path $desktop 'Sketch.lnk')"
