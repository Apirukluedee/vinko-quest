# Ping Supabase VINKO project ทุกวัน เพื่อกัน free plan auto-pause
# รัน: powershell -ExecutionPolicy Bypass -File ping-supabase.ps1
# Log อยู่ที่: %APPDATA%\vinko-ping\ping.log (เก็บ 30 วันล่าสุด)

$supabaseUrl = "https://snhfobhkrkuntohybnrh.supabase.co"
$anonKey     = "sb_publishable_QbQ2cvGe5cfFcV61FhEtjQ_KbVsYKZ_"
$logDir      = "$env:APPDATA\vinko-ping"
$logFile     = "$logDir\ping.log"
$maxDays     = 30

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    $headers = @{
        "apikey"        = $anonKey
        "Authorization" = "Bearer $anonKey"
    }
    # HEAD request เบาที่สุด — แค่นับแถวโดยไม่ดึงข้อมูล
    $res = Invoke-WebRequest -Uri "$supabaseUrl/rest/v1/orders?select=id&limit=1" `
        -Method HEAD -Headers $headers -TimeoutSec 15 -UseBasicParsing

    "$ts  OK  $($res.StatusCode)  supabase ping" | Add-Content $logFile
    Write-Host "OK $($res.StatusCode)"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    # 401/406 = DB ตอบแล้ว (แค่ RLS ไม่ผ่าน) = DB active อยู่ ถือว่า ping สำเร็จ
    if ($status -in @(401, 406)) {
        "$ts  OK  $status  supabase active (RLS blocked, DB is up)" | Add-Content $logFile
        Write-Host "OK $status (DB active)"
    } else {
        "$ts  ERR  $status  $($_.Exception.Message)" | Add-Content $logFile
        Write-Host "ERR $status : $($_.Exception.Message)"
        exit 1
    }
}

# ตัด log เก่ากว่า 30 วัน
$cutoff = (Get-Date).AddDays(-$maxDays).ToString("yyyy-MM-dd")
(Get-Content $logFile) | Where-Object { $_ -ge $cutoff -or $_ -notmatch "^\d{4}-\d{2}-\d{2}" } |
    Set-Content $logFile
