# คู่มือตั้งค่าอีเมล (Resend) — ฉบับละเอียด

ทำครั้งแรกเมื่อ 2026-08-25 · เขียนไว้เพราะทำปีละครั้ง จำไม่ได้แน่นอน

ระบบส่งอีเมลผ่าน **Resend** โค้ดอยู่ที่ `api/_lib/email.js`
ผู้ส่งคือ `VINKO <hello@mail.vinko.quest>` — **ตั้งตายตัวในโค้ดบรรทัดที่ 16 ไม่ได้อ่านจาก env**
ถ้าจะเปลี่ยนที่อยู่ผู้ส่ง ต้องแก้ไฟล์นั้นแล้ว deploy ใหม่

---

## สารบัญ

1. [ทำไมต้องเป็น `mail.vinko.quest` ห้ามใช้ `vinko.quest`](#1-กฎเหล็ก)
2. [ผังโซน DNS ปัจจุบัน — อะไรเป็นของใคร](#2-ผังโซน-dns)
3. [ขั้นตอนตั้งค่าครั้งแรก ทีละคลิก](#3-ขั้นตอนทีละคลิก)
4. [กับดักที่เจอจริงตอนทำครั้งแรก](#4-กับดัก)
5. [คำสั่งตรวจสอบ](#5-คำสั่งตรวจสอบ)
6. [ทดสอบส่งจริง](#6-ทดสอบส่งจริง)
7. [เวลาพัง ดูตรงไหน](#7-เวลาพัง-ดูตรงไหน)

---

## 1. กฎเหล็ก

**ห้ามเพิ่มโดเมนใน Resend เป็น `vinko.quest` เด็ดขาด ต้องเป็น `mail.vinko.quest` เท่านั้น**

เพราะโดเมนหลักถือ **Cloudflare Email Routing** อยู่ ซึ่งเป็นตัวที่ทำให้เมลที่ส่งมาหา
`hello@vinko.quest` เด้งเข้ากล่องจดหมายจริงของเจ้าของ ระบบนี้กิน 3 MX + 1 DKIM + 1 SPF
ที่ระดับโดเมนหลัก

ถ้าใส่โดเมนหลักลงไป Resend จะขอ SPF ที่ระดับเดียวกัน → ทับของ Cloudflare →
**เมลขาเข้าหายเงียบ ไม่มี error ไม่มีอะไรเตือน** กว่าจะรู้ตัวคือตอนลูกค้าบอกว่าส่งเมลมาแล้วไม่ตอบ

ใช้ซับโดเมน records ทุกอันจะไปลงใต้ชั้น `.mail` ไม่แตะของเดิมแม้แต่บรรทัดเดียว

---

## 2. ผังโซน DNS

สภาพโซนหลังตั้งค่าเสร็จ (11 records) — จำไว้ว่าอะไรห้ามแตะ

### กลุ่มเว็บไซต์ — แตะแล้วเว็บล่มทันที

| Name | Type | Content |
|---|---|---|
| `vinko.quest` | CNAME | `dc2da1b5f71e3d85.vercel-dns-017.com` |
| `www.vinko.quest` | CNAME | `vinko-wow-lab.netlify.app` |

> `www` ยังชี้ Netlify ของเก่าอยู่ ยังไม่ได้ย้ายมา Vercel — เป็นงานค้างคนละเรื่อง

### กลุ่มเมลขาเข้า — Cloudflare ล็อกไว้ มีรูปกุญแจ 🔒 แตะไม่ได้อยู่แล้ว

| Name | Type | Content | Priority |
|---|---|---|---|
| `vinko.quest` | MX | `route3.mx.cloudflare.net` | 20 |
| `vinko.quest` | MX | `route2.mx.cloudflare.net` | 60 |
| `vinko.quest` | MX | `route1.mx.cloudflare.net` | 66 |
| `cf2024-1._domainkey.vinko.quest` | TXT | `v=DKIM1; h=sha256; k=rsa; p=MIIBIj...` | — |
| `vinko.quest` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — |

> SPF บรรทัดสุดท้ายไม่มีกุญแจ **แก้ได้ = ลบได้ = พังได้** ระวังเป็นพิเศษ

### กลุ่มเมลขาออก — ของ Resend ที่เราเพิ่มเอง

| Name | Type | Content | Priority |
|---|---|---|---|
| `resend._domainkey.mail` | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCB...wIDAQAB` | — |
| `send.mail` | MX | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
| `send.mail` | TXT | `v=spf1 include:amazonses.com ~all` | — |
| `_dmarc.mail` | TXT | `v=DMARC1; p=none;` | — |

---

## 3. ขั้นตอนทีละคลิก

### ขั้น A · เพิ่มโดเมนใน Resend

1. เข้า resend.com (login ด้วย GitHub)
2. หน้าแรกจะชวนกด **"Add API Key"** — **ข้ามไปก่อน** key จากขั้นนั้นส่งได้เฉพาะเข้าเมลตัวเอง
   จนกว่าจะยืนยันโดเมน และการยืนยันโดเมนคือขั้นที่ใช้เวลานานสุด ทำก่อน
3. เมนูซ้าย → **Domains** → **Add Domain**
4. ช่อง Name พิมพ์ `mail.vinko.quest`
5. Region เลือก **Tokyo (ap-northeast-1)** ใกล้ไทยสุด
   > region มีผลกับค่า MX ที่ได้ ถ้าเลือกอย่างอื่นค่าจะไม่ใช่ `ap-northeast-1`

### ขั้น B · เลือก Manual setup

Resend จะให้เลือก **Auto configure** หรือ **Manual setup**

**เลือก `Manual setup` เสมอ**

`Auto configure` พาไป OAuth เข้า Cloudflare แล้วขอสิทธิ์ **เขียน DNS ทั้งโซน** ไม่ใช่เฉพาะ
records ของตัวเอง — โซนนี้ถือทั้ง Email Routing และ record ที่ชี้เว็บไป Vercel
เรื่องที่เรากลัวที่สุดคือมีอะไรไปทับ apex การให้สิทธิ์เขียนทั้งโซนกับบริการภายนอก
เพื่อประหยัดการ copy-paste 4 บรรทัด ไม่คุ้มกัน

> ปุ่ม **Go to Cloudflare** ที่อยู่ล่างสุดของหน้า ต่างจาก Auto configure — อันนั้นแค่เปิดแท็บให้เฉยๆ กดได้

### ขั้น C · จดค่าจากหน้า Resend

หน้า *Fill in your DNS Records* จะมี 3 กลุ่ม

- **Domain Verification → DKIM** : 1 แถว = record 1
- **Enable Sending → SPF** : 2 แถว = record 2 (MX) และ record 3 (TXT)
- **DMARC (Optional)** : 1 แถว = record 4

**Enable Receiving สวิตช์ล่างสุด ปล่อยปิดไว้** เราส่งออกอย่างเดียว
เมลขาเข้าใช้ `hello@vinko.quest` ผ่าน Cloudflare เหมือนเดิม
ถ้าเปิด Resend จะขอ MX ที่ `mail.vinko.quest` เพิ่มโดยไม่จำเป็น

**วิธีเอาค่า:** เอาเมาส์ไปชี้ที่ช่อง Name หรือ Content ของแถวนั้น ปุ่ม copy จะโผล่ขึ้นมา กดปุ่มนั้น
**ห้ามพิมพ์ตามที่เห็นบนจอ** เพราะหน้าจอตัดค่ายาวๆ ให้เหลือหัวกับท้าย เช่นโชว์ว่า
`resend._[…]ey.mail` และ `p=MIGfMA[…]wIDAQAB` — ของจริงยาวกว่านั้นมาก

### ขั้น D · ใส่ใน Cloudflare

ไปที่ **dash.cloudflare.com → vinko.quest → DNS → Records**

ใช้ปุ่ม **`+ Add record`** มุมขวาบน ทำทีละอัน 4 รอบ
**อย่ากด Edit ที่บรรทัดเดิม** โดยเฉพาะบรรทัด `vinko.quest → vercel-dns` (เว็บจะล่ม)
ถ้าเผลอกดไปแล้ว กด **Cancel**

#### record 1 — DKIM
```
Type    : TXT
Name    : resend._domainkey.mail
Content : <กด copy จาก Resend — ขึ้นต้น p=MIGfMA ยาวประมาณ 216 ตัวอักษร>
TTL     : Auto
```

#### record 2 — MX
```
Type        : MX
Name        : send.mail
Mail server : feedback-smtp.ap-northeast-1.amazonses.com
Priority    : 10
TTL         : Auto
```

#### record 3 — SPF
```
Type    : TXT
Name    : send.mail
Content : v=spf1 include:amazonses.com ~all
TTL     : Auto
```

#### record 4 — DMARC ⚠️ ต้องแก้ชื่อ
```
Type    : TXT
Name    : _dmarc.mail       ← Resend เขียนมาว่า "_dmarc" เฉยๆ ต้องเติม .mail เอง
Content : v=DMARC1; p=none;
TTL     : Auto
```

ครบแล้วแถบบนจะขึ้น **"You have used 11 of 200 available DNS records"**

> Cloudflare อาจขึ้นแถบ **Recommendations → "Add a DMARC record"** ที่หัวหน้า
> **ไม่ต้องกด** มันแนะนำให้ใส่ DMARC ที่โดเมนหลัก ซึ่งเราตั้งใจไม่แตะ

### ขั้น E · verify

รันคำสั่งใน[หัวข้อ 5](#5-คำสั่งตรวจสอบ)ก่อน ให้ครบทั้ง 4 แล้วค่อยกลับไป **แท็บ Resend**
เลื่อนลงล่างสุดของหน้า *Fill in your DNS Records* จะเห็นปุ่ม `Go to Cloudflare` (ดำ)
กับ **`✓ I've already added the records`** (ขาว) อยู่คู่กัน — กดปุ่มขาว

> ปุ่มนี้อยู่ฝั่ง Resend ไม่ใช่ Cloudflare หาไม่เจอเพราะสลับแท็บผิดบ่อย

### ขั้น F · สร้าง API key

**API keys → Create API Key**

- Permission เลือก **Sending access** อย่างเดียว ไม่ต้องให้ Full access
- Domain เลือก `mail.vinko.quest`
- key ขึ้นต้นด้วย `re_` และ **โชว์ครั้งเดียว** ปิดหน้าไปแล้วดูย้อนหลังไม่ได้ ต้องสร้างใหม่

### ขั้น G · ใส่ที่ Vercel

**vercel.com → โปรเจกต์ → Settings → Environment Variables → Add New**

```
Key          : RESEND_API_KEY
Value        : <วาง key>
Environments : ติ๊กครบทั้ง 3 (Production, Preview, Development)
Sensitive    : ติ๊ก
```

**แล้วต้อง Redeploy** — Deployments → deployment ล่าสุด → เมนู `⋯` → Redeploy
env ใหม่ไม่มีผลกับ deployment เดิม โค้ดจะยังฟ้อง `ENV_MISSING` ต่อไปจนกว่าจะ deploy รอบใหม่

---

## 4. กับดัก

รวมจากที่เจอจริงตอนทำครั้งแรก

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| ชื่อกลายเป็น `send.mail.vinko.quest.vinko.quest` | พิมพ์ชื่อเต็มในช่อง Name | ใส่แค่ส่วนหน้า Cloudflare เติมโซนให้เอง |
| DMARC ไปโผล่ที่โดเมนหลัก | Resend เขียนชื่อมาว่า `_dmarc` เฉยๆ | เติม `.mail` เป็น `_dmarc.mail` |
| DKIM verify ไม่ผ่าน | พิมพ์ตามที่เห็นบนจอ ค่าถูกตัด | ใช้ปุ่ม copy เท่านั้น |
| หาปุ่ม verify ไม่เจอ | อยู่ผิดแท็บ | ปุ่มอยู่ฝั่ง Resend ล่างสุดของหน้า DNS Records |
| verify ไม่ผ่านทั้งที่ใส่ครบ | Proxy เป็นเมฆส้ม | TXT/MX ไม่มีให้ proxy อยู่แล้ว ถ้าเห็นเมฆส้มแปลว่าใส่ผิด type |
| เมลขาเข้าหายหมด | เอาโดเมนหลักไปใส่ Resend | ดู[หัวข้อ 1](#1-กฎเหล็ก) — ต้องเอา SPF ของ Cloudflare กลับมา |
| `ENV_MISSING: RESEND_API_KEY` | ใส่ env แล้วแต่ยังไม่ redeploy | Redeploy |
| `The mail.vinko.quest domain is not verified` | DNS ยังไม่ผ่าน หรือลืมกด verify ที่ Resend | เช็ก[หัวข้อ 5](#5-คำสั่งตรวจสอบ) |
| key ใช้ไม่ได้ ทั้งที่เพิ่งสร้าง | เลือก permission ผิด หรือผูกกับโดเมนอื่น | สร้างใหม่ Sending access + `mail.vinko.quest` |

---

## 5. คำสั่งตรวจสอบ

### เช็กว่า 4 records ของ Resend ขึ้นครบ

```bash
nslookup -type=TXT resend._domainkey.mail.vinko.quest 8.8.8.8
```

```bash
nslookup -type=MX send.mail.vinko.quest 8.8.8.8
```

```bash
nslookup -type=TXT send.mail.vinko.quest 8.8.8.8
```

```bash
nslookup -type=TXT _dmarc.mail.vinko.quest 8.8.8.8
```

ต้องได้ตามลำดับ: ค่า `p=MIGfMA...wIDAQAB` เต็มๆ · `preference = 10, feedback-smtp.ap-northeast-1.amazonses.com` ·
`v=spf1 include:amazonses.com ~all` · `v=DMARC1; p=none;`

### เช็กว่าของเดิมไม่ถูกแตะ — สำคัญกว่าข้อบน

```bash
nslookup -type=MX vinko.quest 8.8.8.8
```
ต้องเห็น `route1` `route2` `route3` `.mx.cloudflare.net` ครบ 3 เส้น

```bash
nslookup -type=TXT vinko.quest 8.8.8.8
```
ต้องเป็น `v=spf1 include:_spf.mx.cloudflare.net ~all` **ห้ามมี amazonses โผล่ในบรรทัดนี้**

```bash
nslookup vinko.quest 8.8.8.8
```
ต้องได้ IP ของ Vercel (`216.198.79.1`, `64.29.17.1`)

```bash
nslookup -type=TXT _dmarc.vinko.quest 8.8.8.8
```
**ต้องว่างเปล่า** ถ้ามีค่าโผล่มา แปลว่า DMARC ไปลงผิดที่ ให้ลบแล้วใส่ใหม่ที่ `_dmarc.mail`

> ใส่ `8.8.8.8` ต่อท้ายเสมอ เพื่อถาม Google DNS ตรงๆ ไม่ให้ DNS cache ของเครื่องหลอก

---

## 6. ทดสอบส่งจริง

ยิงอีเมลซ้ำของออเดอร์ที่มีอยู่แล้ว (ออก token ใหม่ให้ด้วย)

```bash
curl -s -X POST https://vinko.quest/api/admin -H "content-type: application/json" -H "x-vinko-admin: $ADMIN_SECRET" -d '{"action":"resend-email","order_ref":"VK-2608-0001"}'
```

`ADMIN_SECRET` อยู่ใน Vercel Environment Variables

ได้ `{"ok":true}` แล้วให้ไปเช็กว่าเมลเข้าจริง และ**ดูใน spam ด้วย** ครั้งแรกที่โดเมนใหม่ส่ง
มีโอกาสเข้า spam จนกว่าจะสะสมชื่อเสียงได้ระยะหนึ่ง

---

## 7. เวลาพัง ดูตรงไหน

### ตาราง `email_events` ใน Supabase

ทุกครั้งที่ระบบส่งเมล ไม่ว่าสำเร็จหรือล้ม จะถูกบันทึกไว้เสมอ

```sql
select created_at, kind, to_email, status, error, provider_message_id
from email_events
order by created_at desc
limit 20;
```

- `status = 'sent'` + มี `provider_message_id` → Resend รับไปแล้ว ถ้าลูกค้าไม่ได้รับ ปัญหาอยู่ที่ปลายทาง (spam / เมลผิด)
- `status = 'failed'` → อ่านช่อง `error` ข้อความมาจาก Resend ตรงๆ

### Logs ที่ Resend

resend.com → **Logs** เห็นทุกฉบับที่ยิงเข้ามา พร้อมสถานะ delivered / bounced / complained
ถ้า `email_events` บอก sent แต่ Resend ไม่มี log แปลว่า key ผิดโปรเจกต์

### ตัวตรวจ env

`api/_lib/config.js` จะฟ้องตั้งแต่ตอน validate ถ้า `RESEND_API_KEY` ไม่ได้ขึ้นต้นด้วย `re_`
ข้อความจะบอกด้วยว่าได้ค่าอะไรมาแบบ mask ไว้

---

## เกี่ยวข้อง

- `content/refund-runbook.md` — ขั้นตอนคืนเงิน
- `api/_lib/email.js` — เทมเพลตอีเมลทั้งหมดและฟังก์ชัน `send()`
- `api/resend-link.js` — ปุ่ม "ส่งลิงก์ใหม่" ฝั่งลูกค้า จำกัดความถี่ไว้
