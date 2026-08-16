# -*- coding: utf-8 -*-
"""ตรวจไฟล์ที่ใส่ลายน้ำแล้วด้วย PyMuPDF  —  python tests/watermark-verify.py

   รันหลัง node tests/watermark-check.js
   ตรวจสิ่งที่ JS ตรวจเองไม่ได้: ตัวอักษรไทยออกมาครบจริงไหม
   ทับเนื้อหาเดิมไหม และช่องกรอกฟอร์มยังอยู่ครบไหม
"""
import fitz, os, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
WM   = os.path.join(HERE, "..", ".tmp", "watermarked.pdf")
SRC_CANDIDATES = [
    r"C:/Users/ACER/Downloads/Vinko-wow-lab/optimized/VINKO-WOW-LAB-10-Missions-Fillable.pdf",
    r"C:/Users/ACER/Downloads/Vinko-wow-lab/VINKO-WOW-LAB-10-Missions-Fillable.pdf",
]
ORDER_REF = "VK-2609-0042"
EXPECT = "ลิขสิทธิ์ VINKO · ผู้ซื้อ: อภิรักษ์ ลือดี · api***@gmail.com · " + ORDER_REF

pass_n = fail_n = 0
def ok(m):
    global pass_n; pass_n += 1; print("  ผ่าน    " + m)
def bad(m):
    global fail_n; fail_n += 1; print("  ไม่ผ่าน  " + m)

if not os.path.exists(WM):
    print("ไม่พบ", WM, "— รัน node tests/watermark-check.js ก่อน")
    sys.exit(1)

doc = fitz.open(WM)
src_path = next((p for p in SRC_CANDIDATES if os.path.exists(p)), None)
src = fitz.open(src_path) if src_path else None

print("1. ข้อความลายน้ำภาษาไทย")

# ดึงเฉพาะข้อความในแถบล่างของหน้า
def footer_text(page, h=26):
    r = page.rect
    clip = fitz.Rect(0, r.height - h, r.width, r.height)
    return page.get_text("text", clip=clip).strip()

found_pages = 0
sample = ""
for p in doc:
    t = footer_text(p)
    if ORDER_REF in t:
        found_pages += 1
        if not sample:
            sample = " ".join(t.split())

if found_pages == doc.page_count:
    ok("มีลายน้ำครบทุกหน้า (%d หน้า)" % doc.page_count)
else:
    bad("มีลายน้ำแค่ %d จาก %d หน้า" % (found_pages, doc.page_count))

print("        อ่านได้จริง: " + sample)

# เทียบกับข้อความที่ควรจะเป็น ทีละอักขระ
norm = lambda s: unicodedata.normalize("NFC", " ".join(s.split()))
if norm(sample) == norm(EXPECT):
    ok("ตรงกับข้อความที่ตั้งใจไว้ทุกตัวอักษร")
else:
    bad("ข้อความไม่ตรง")
    print("        ควรเป็น: " + EXPECT)

# ตัวที่หายบ่อยที่สุดคือสระบนล่างและวรรณยุกต์
marks = [c for c in EXPECT if unicodedata.combining(c)]
missing = [c for c in set(marks) if c not in sample]
if not missing:
    ok("สระและวรรณยุกต์ครบ %d ตำแหน่ง (ไม่มีตัวไหนหายไป)" % len(marks))
else:
    bad("สระ/วรรณยุกต์หาย: " + " ".join("U+%04X" % ord(c) for c in missing))

if "?" not in sample and "\ufffd" not in sample:
    ok("ไม่มี ? หรือ � แทนอักขระที่แสดงไม่ได้")
else:
    bad("พบอักขระเสียในลายน้ำ")

print("\n2. ไม่ทับเนื้อหาเดิม")
if src:
    overlap = []
    for i in range(min(doc.page_count, src.page_count)):
        r = src[i].rect
        band = fitz.Rect(0, r.height - 26, r.width, r.height)
        # เนื้อหาเดิมที่อยู่ในแถบล่างก่อนใส่ลายน้ำ
        before = src[i].get_text("text", clip=band).strip()
        if before:
            overlap.append((i + 1, " ".join(before.split())[:50]))
    if not overlap:
        ok("แถบล่าง 26pt ของทุกหน้าว่างอยู่แล้ว ลายน้ำจึงไม่ทับอะไร")
    else:
        bad("มีเนื้อหาเดิมอยู่ในแถบล่าง %d หน้า เช่น หน้า %d: %s"
            % (len(overlap), overlap[0][0], overlap[0][1]))

    # ข้อความส่วนอื่นต้องเหมือนเดิมเป๊ะ
    diff = []
    for i in range(min(doc.page_count, src.page_count)):
        a = src[i].get_text("text")
        b = doc[i].get_text("text").replace(EXPECT, "")
        if norm(a) != norm(b):
            diff.append(i + 1)
    if not diff:
        ok("ข้อความเนื้อหาเดิมเหมือนกันทุกหน้า")
    else:
        bad("ข้อความต่างที่หน้า %s" % diff[:8])
else:
    print("        (ไม่พบไฟล์ต้นฉบับ ข้ามการเทียบ)")

print("\n3. โครงสร้างไฟล์")
if src:
    if doc.page_count == src.page_count:
        ok("จำนวนหน้าเท่าเดิม (%d)" % doc.page_count)
    else:
        bad("จำนวนหน้าเปลี่ยน %d -> %d" % (src.page_count, doc.page_count))

    w_src = sum(1 for p in src for _ in p.widgets())
    w_wm  = sum(1 for p in doc for _ in p.widgets())
    if w_wm == w_src:
        ok("ช่องกรอกฟอร์มครบ %d ช่อง" % w_wm)
    else:
        bad("ช่องกรอกฟอร์ม %d -> %d" % (w_src, w_wm))

meta = doc.metadata or {}
if ORDER_REF in (meta.get("subject") or "") or ORDER_REF in (meta.get("keywords") or ""):
    ok("order_ref ฝังใน metadata แล้ว (subject/keywords)")
else:
    bad("ไม่พบ order_ref ใน metadata")

if not doc.is_encrypted:
    ok("ไม่ได้ใส่รหัสผ่าน เปิดบนมือถือและสั่งพิมพ์ได้ปกติ")
else:
    bad("ไฟล์ถูกเข้ารหัส ลูกค้าอาจเปิดหรือพิมพ์ไม่ได้")

print("\n4. ภาพตัวอย่างแถบลายน้ำ")
page = doc[1]
r = page.rect
clip = fitz.Rect(0, r.height - 34, r.width, r.height)
pix = page.get_pixmap(dpi=260, clip=clip)
out_png = os.path.join(HERE, "..", ".tmp", "watermark-zoom.png")
pix.save(out_png)
print("        " + os.path.abspath(out_png))

full = doc[1].get_pixmap(dpi=90)
full_png = os.path.join(HERE, "..", ".tmp", "watermark-page.png")
full.save(full_png)
print("        " + os.path.abspath(full_png))

print("\n" + "=" * 56)
print("ผ่าน %d / ไม่ผ่าน %d" % (pass_n, fail_n))
print("=" * 56)
doc.close()
if src: src.close()
sys.exit(1 if fail_n else 0)
