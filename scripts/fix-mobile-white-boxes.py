# -*- coding: utf-8 -*-
"""ลบ 'กล่องขาว' ที่โผล่บนตัวอ่าน PDF ของมือถือ

ต้นเหตุ: Chrome แปลง text-shadow แบบเบลอเป็น "สี่เหลี่ยมขาวโปร่ง 70% +
SMask ไล่ระดับ" ตัวอ่านที่ทำ SMask ไม่ได้ (iOS / ในแอป LINE) จะข้าม
หน้ากากทิ้งแล้ววาดสี่เหลี่ยมขาวทึบทับภาพประกอบ

วิธีแก้: หาคำสั่งเติมสีที่ (1) สีขาว และ (2) กำลังมี SMask ทำงานอยู่
แล้วเปลี่ยนตัวดำเนินการ f -> n (จบเส้นทางโดยไม่ระบายสี) แทนที่ในที่เดิม
ความยาวเท่าเดิม ไม่ต้องคำนวณตำแหน่งใหม่ทั้งสตรีม

เงาขาวอีก 4 ชั้นที่วางเยื้องกันเป็นการวาด "ข้อความ" ไม่ใช่การเติมสี
จึงไม่ถูกแตะ ขอบขาวรอบตัวอักษรยังอยู่ครบ เสียแค่แสงนุ่มที่มือถือไม่เคย
เห็นอยู่แล้ว ส่วนการ์ดขาวทึบที่ตั้งใจออกแบบไม่มี SMask จึงรอดทุกใบ

ข้อควรระวังที่เคยพลาด: ต้องข้ามสตริงใน content stream ให้ถูก ไม่งั้น
"(Q)Tj" จะถูกอ่านเป็นคำสั่ง Q แล้วสแตก q/Q เพี้ยนทั้งหน้า
"""
import sys
import re
import fitz

PAINT = {b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*"}
WS = b" \t\r\n\f\x00"
DELIM = b"()<>[]{}/%"
ONE = b"1", b"1.0", b"1.00", b"1.000"


def tokens(buf):
    """ไล่โทเคนของ content stream ทีละตัว คืน (เริ่ม, จบ, โทเคน)

    สตริง ( ) และ < > ถูกข้ามทั้งก้อน ไม่คืนออกมา เพราะเนื้อในเป็นข้อมูล
    ไม่ใช่คำสั่ง ตัวอักษรอย่าง Q f b ที่บังเอิญอยู่ในสตริงจึงไม่หลุดมา
    """
    i, n = 0, len(buf)
    while i < n:
        c = buf[i:i + 1]
        if c in WS:
            i += 1
        elif c == b"%":
            while i < n and buf[i:i + 1] not in b"\r\n":
                i += 1
        elif c == b"(":                      # สตริงตัวอักษร วงเล็บซ้อนกันได้
            depth, i = 1, i + 1
            while i < n and depth:
                ch = buf[i:i + 1]
                if ch == b"\\":
                    i += 2
                    continue
                if ch == b"(":
                    depth += 1
                elif ch == b")":
                    depth -= 1
                i += 1
        elif c == b"<":
            if buf[i:i + 2] == b"<<":
                yield i, i + 2, b"<<"
                i += 2
            else:                            # สตริงฐานสิบหก
                i = buf.find(b">", i)
                i = n if i < 0 else i + 1
        elif c == b">":
            if buf[i:i + 2] == b">>":
                yield i, i + 2, b">>"
            i += 2 if buf[i:i + 2] == b">>" else 1
        elif c in b"[]{}":
            yield i, i + 1, c
            i += 1
        elif c == b"/":
            j = i + 1
            while j < n and buf[j:j + 1] not in WS and buf[j:j + 1] not in DELIM:
                j += 1
            yield i, j, buf[i:j]
            i = j
        else:
            j = i
            while j < n and buf[j:j + 1] not in WS and buf[j:j + 1] not in DELIM:
                j += 1
            if j == i:
                j = i + 1
            yield i, j, buf[i:j]
            i = j


def smask_groups(doc, page):
    """แยก ExtGState เป็นพวกที่ 'ตั้ง' SMask กับพวกที่ 'ล้าง' SMask

    ตามสเปก คำสั่ง gs เปลี่ยนเฉพาะคีย์ที่มีในดิกต์นั้น ExtGState ที่ไม่มี
    คีย์ /SMask เลย (เช่นตั้งแค่ /ca) ต้องปล่อยค่าเดิมไว้ ห้ามล้าง
    """
    on, off = set(), set()
    typ, val = doc.xref_get_key(page.xref, "Resources/ExtGState")
    if typ != "dict":
        return on, off
    for name, ref in re.findall(r"/([A-Za-z0-9#]+)\s+(\d+)\s+0\s+R", val):
        obj = doc.xref_object(int(ref)).replace("\n", " ")
        if "/SMask" not in obj:
            continue
        (off if re.search(r"/SMask\s*/None", obj) else on).add("/" + name)
    return on, off


def fix_page(doc, page):
    page.clean_contents(sanitize=False)          # รวมเป็นสตรีมเดียวก่อนแก้
    streams = page.get_contents()
    if not streams:
        return 0
    xref = streams[0]
    buf = bytes(doc.xref_stream(xref))
    mask_on, mask_off = smask_groups(doc, page)
    if not mask_on:
        return 0

    data = bytearray(buf)
    white = smask = False
    stack, operands, removed = [], [], 0
    stats = fix_page.stats

    for start, end, tok in tokens(buf):
        if tok == b"q":
            stack.append((white, smask))
            operands = []
        elif tok == b"Q":
            if stack:
                white, smask = stack.pop()
            operands = []
        elif tok == b"gs":
            name = operands[-1].decode("latin-1") if operands else ""
            if name in mask_on:
                smask = True
            elif name in mask_off:
                smask = False
            operands = []
        elif tok == b"rg":
            white = len(operands) >= 3 and all(o in ONE for o in operands[-3:])
            operands = []
        elif tok == b"g":
            white = bool(operands) and operands[-1] in ONE
            operands = []
        elif tok in (b"sc", b"scn"):
            white = bool(operands) and all(o in ONE for o in operands)
            operands = []
        elif tok in (b"k", b"cs"):
            white = False
            operands = []
        elif tok in PAINT:
            if smask:
                # เติมสีใต้ SMask = เอฟเฟกต์เบลอเสมอ (เงากล่อง / แสงรอบตัวอักษร)
                # ไม่ว่าสีอะไร ตัวอ่านที่ทำ SMask ไม่ได้จะวาดเป็นสี่เหลี่ยมทึบหมด
                data[start:end] = b"n" + b" " * (end - start - 1)
                removed += 1
                stats["white" if white else "dark"] += 1
            operands = []
        elif tok in (b"n", b"S", b"s", b"W", b"W*", b"BT", b"ET", b"Do", b"sh"):
            operands = []
        else:
            operands.append(tok)
            del operands[:-8]

    if removed:
        doc.update_stream(xref, bytes(data))
    return removed


def main():
    src, dst = sys.argv[1], sys.argv[2]
    fix_page.stats = {"white": 0, "dark": 0}
    doc = fitz.open(src)
    total = 0
    for pno in range(doc.page_count):
        n = fix_page(doc, doc[pno])
        if n:
            total += n
            print("  หน้า %2d : ลบ %d กล่อง" % (pno + 1, n))
    doc.save(dst, garbage=4, deflate=True, clean=True)
    doc.close()
    st = fix_page.stats
    print("รวมลบ %d กล่อง  (แสงขาวรอบตัวอักษร %d · เงากล่องสีเข้ม %d)"
          % (total, st["white"], st["dark"]))


main()
