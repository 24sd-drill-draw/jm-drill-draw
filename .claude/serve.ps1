param([int]$Port = 8765, [string]$Root = (Split-Path -Parent $PSScriptRoot))

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "serving $Root on http://127.0.0.1:$Port"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".txt"  = "text/plain; charset=utf-8"
  ".mp4"  = "video/mp4"
  ".webm" = "video/webm"
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 2000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2000
    $buf = New-Object byte[] 8192
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { $client.Close(); continue }
    $req = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    $line = ($req -split "`r`n")[0]
    $path = ($line -split ' ')[1]
    if (-not $path) { $path = "/" }
    $path = ($path -split '\?')[0]
    $path = [System.Uri]::UnescapeDataString($path)
    if ($path -eq "/") { $path = "/animate.html" }

    $full = Join-Path $Root ($path.TrimStart('/') -replace '/', '\')
    $full = [System.IO.Path]::GetFullPath($full)

    if ($full.StartsWith([System.IO.Path]::GetFullPath($Root)) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = "application/octet-stream" }
      $head = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 $path")
      $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    }
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch { }
  finally { $client.Close() }
}
