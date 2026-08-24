# ============================================================
# อัปโหลดไฟล์ต้นฉบับขึ้น Supabase Storage bucket "masters"
#
# ใช้กับนิทานทุกเล่ม เปลี่ยนแค่ -Code กับ -File
#
#   .\upload-master.ps1 -Code STORY-02 -File "C:\...\story02-ebook-v3-PRINT.pdf"
#
# key จะถูกถามตอนรัน ไม่เก็บลงไฟล์ ไม่ขึ้น git
# หา key ได้ที่ Vercel -> vinko-quest -> Settings -> Environment Variables
#                        -> SUPABASE_SERVICE_ROLE_KEY
# ============================================================

param(
  [Parameter(Mandatory=$true)][string]$Code,
  [Parameter(Mandatory=$true)][string]$File
)

$supabaseUrl = "https://snhfobhkrkuntohybnrh.supabase.co"
$bucket      = "masters"

# ---- ตรวจไฟล์ก่อน ----
if (-not (Test-Path $File)) { Write-Host "ไม่พบไฟล์: $File" -ForegroundColor Red; exit 1 }

$objectName = ($Code.ToUpper() -replace '[^A-Z0-9_-]','') + ".pdf"
$bytes      = [System.IO.File]::ReadAllBytes($File)
$mb         = [math]::Round($bytes.Length / 1MB, 2)

# นับหน้าไว้ยืนยันว่าไฟล์ไม่พัง
$enc   = [System.Text.Encoding]::GetEncoding(28591)
$pages = ([regex]::Matches($enc.GetString($bytes), '/Type\s*/Page[^s]')).Count

Write-Host ""
Write-Host "  ไฟล์      : $File"
Write-Host "  จะอัปเป็น : $bucket/$objectName"
Write-Host "  ขนาด      : $mb MB / $pages หน้า"
Write-Host ""

# ---- ขอ key (ไม่แสดงบนจอ) ----
$secure = Read-Host "วาง SUPABASE_SERVICE_ROLE_KEY แล้วกด Enter" -AsSecureString
$bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$key    = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($key)) { Write-Host "ไม่ได้ใส่ key" -ForegroundColor Red; exit 1 }
if ($key -like "sb_publishable_*" -or $key -like "*anon*") {
  Write-Host "นี่คือ publishable key ต้องใช้ secret key (sb_secret_... หรือ eyJ...)" -ForegroundColor Red; exit 1
}

$headers = @{
  apikey          = $key
  Authorization   = "Bearer $key"
  "Content-Type"  = "application/pdf"
  "x-upsert"      = "true"   # อัปทับได้ถ้าต้องแก้ไฟล์ภายหลัง
}

# ---- อัปโหลด ----
Write-Host ""
Write-Host "กำลังอัปโหลด..." -ForegroundColor Cyan
try {
  $res = Invoke-WebRequest `
    -Uri "$supabaseUrl/storage/v1/object/$bucket/$objectName" `
    -Method POST -Headers $headers -Body $bytes `
    -TimeoutSec 180 -UseBasicParsing
  Write-Host "อัปโหลดสำเร็จ ($($res.StatusCode))" -ForegroundColor Green
} catch {
  $sc = $_.Exception.Response.StatusCode.value__
  Write-Host "อัปโหลดไม่สำเร็จ ($sc) $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# ---- ตรวจซ้ำว่าไฟล์อยู่จริงและขนาดตรง ----
try {
  $info = Invoke-RestMethod `
    -Uri "$supabaseUrl/storage/v1/object/info/$bucket/$objectName" `
    -Headers @{ apikey = $key; Authorization = "Bearer $key" } -TimeoutSec 30
  Write-Host "ยืนยันบน server : $($info.name) $([math]::Round($info.size/1MB,2)) MB" -ForegroundColor Green
} catch {
  Write-Host "อัปขึ้นแล้วแต่ตรวจซ้ำไม่ผ่าน ลองเช็คใน Dashboard อีกที" -ForegroundColor Yellow
}

$key = $null
Write-Host ""
