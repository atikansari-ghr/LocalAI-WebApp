# Synthetic benchmark images; requires Windows GDI+/Arial. No personal data.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$directory = Join-Path (Split-Path $PSScriptRoot -Parent) 'tests/fixtures/documents'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$samples = @(
    @{ Name = 'english.png'; Text = 'LOCAL AI TEST 1234'; Rtl = $false },
    @{ Name = 'arabic.png'; Text = 'مرحبا بالعالم'; Rtl = $true }
)
foreach ($sample in $samples) {
    $bitmap = [System.Drawing.Bitmap]::new(900, 140)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $font = [System.Drawing.Font]::new('Arial', 44, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    try {
        if ($font.Name -ne 'Arial') { throw 'Arial is required for these fixtures' }
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        if ($sample.Rtl) { $format.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft }
        $rectangle = [System.Drawing.RectangleF]::new(20, 35, 860, 90)
        $graphics.DrawString($sample.Text, $font, [System.Drawing.Brushes]::Black, $rectangle, $format)
        $bitmap.Save((Join-Path $directory $sample.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $format.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
}
