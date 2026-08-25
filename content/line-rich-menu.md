# LINE Rich Menu — สเปก ลิงก์ และ prompt สร้างภาพ

ไฟล์นี้คือต้นฉบับของ rich menu ใน LINE OA (ตัวเมนูจริงตั้งใน LINE OA Manager
ไม่ได้อยู่ในโค้ด repo นี้) เก็บไว้เพื่อให้สร้างใหม่หรือแก้ทีหลังได้โดยไม่ต้องนึกเอง

---

## 1. สเปกภาพที่ LINE บังคับ

| หัวข้อ | ค่า |
|---|---|
| ขนาดไฟล์ภาพ | **2500 × 1686 px** (แบบเต็ม 6 ช่อง) |
| นามสกุล | JPEG หรือ PNG |
| ขนาดไฟล์ | **ไม่เกิน 1 MB** |
| เทมเพลต | 6 ช่อง 3 คอลัมน์ × 2 แถว |
| ข้อความบนแถบเมนู | `เมนู VINKO` |
| ค่าเริ่มต้น | เปิดเมนูค้างไว้ (แสดงอัตโนมัติ) |

ขนาดต่อช่อง (LINE แบ่งให้เอง เราแค่วางภาพให้ตรง):

```
คอลัมน์:  0–833   |  833–1666  |  1666–2500     (กว้าง ~833 px)
แถว:      0–843   |  843–1686                   (สูง 843 px)
```

**ช่องหนึ่ง = 833 × 843 ≈ จัตุรัส** เวลาสั่ง AI สร้างภาพจึงสั่งเป็น **1:1**
แล้วค่อยย่อ/ครอปตอนประกอบ

---

## 2. ผังเมนูและลิงก์ปลายทาง

| ช่อง | ตำแหน่ง | ป้ายบนภาพ | Action | ปลายทาง |
|---|---|---|---|---|
| 1 | บน-ซ้าย | แบบสำรวจ EF | Link | `https://vinko.quest/ef-check` |
| 2 | บน-กลาง | ดาวน์โหลดฟรี | Link | `https://vinko.quest/free-sample?from=line` |
| 3 | บน-ขวา | พิมพ์ใบประกาศ | Link | `https://vinko.quest/certificate` |
| 4 | ล่าง-ซ้าย | สั่งซื้อหนังสือ | Link | `https://vinko.quest/#order` |
| 5 | ล่าง-กลาง | ขอลิงก์ดาวน์โหลด | Link | `https://vinko.quest/resend-link` |
| 6 | ล่าง-ขวา | สอบถาม | **Text** | ส่งข้อความ `สอบถามเรื่องหนังสือ` |

**ห้ามลืม `?from=line` ในช่อง 2** — ถ้าไม่ใส่ คนที่กดมาจากเมนู (ซึ่งเป็นเพื่อนอยู่แล้ว)
จะเจอหน้าที่เขียนว่า "เพิ่มเพื่อน LINE ก่อน" พร้อม QR แล้วงงว่าให้แอดอะไรอีก
โค้ดที่อ่านค่านี้อยู่ใน `free-sample.html`

**ช่อง 6 ต้องเป็น Text action ไม่ใช่ Link** — เพราะเมนูไม่ได้พกตัวตนของลูกค้ามาด้วย
ทุกคนกดแล้วได้ URL เดียวกันหมด จะลิงก์ไปหน้า "ไฟล์ของฉัน" ไม่ได้
(`/download` ต้องใช้ token รายคนที่ออกให้ตอนซื้อ)

---

## 3. วิธีใช้ prompt ในไฟล์นี้

> **สร้างเป็นภาพเดียว 6 ช่องรวดเดียวไม่ได้ผล** — AI วางกริดไม่ตรง px และเขียน
> ภาษาไทยเพี้ยนเกือบทุกครั้ง วิธีที่ใช้ได้จริงคือ **สร้าง 6 ภาพแยก จัตุรัส ไม่มีตัวอักษร**
> แล้วเอามาต่อกริดและพิมพ์ข้อความไทยทับใน Canva/Figma

ประกอบ prompt แต่ละช่องแบบนี้:

```
[STYLE LOCK] + [CHARACTER LOCK ของตัวละครที่อยู่ในช่องนั้น] + [SCENE ของช่องนั้น]
+ [COMPOSITION LOCK] + [NEGATIVE LOCK]
```

ในหมวด 5 ผมรวมให้เป็นก้อนเดียวพร้อมก๊อปแล้วทุกช่อง

---

## 4. Lock blocks (DNA ของ VINKO — ห้ามแก้เอง)

ตัวละครและสไตล์ต้องตรงกับในหนังสือ ไม่งั้นเมนูจะดูเป็นคนละแบรนด์
ต้นฉบับ: `C:\Users\ACER\Downloads\STORY-02_Prompt_Lock_Blocks.md`

### 4.1 STYLE LOCK (ใส่ทุกช่อง)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark
```

หมายเหตุ: `soft-shaded gradient` เป็นข้อล็อกของแบรนด์ **ห้ามเปลี่ยนเป็น flat vector**

### 4.2 CHARACTER LOCK (ใส่เฉพาะตัวที่โผล่ในช่องนั้น)

**ซัน** — เด็กชายไทย 6 ขวบ นักวิทย์น้อย

```
a Thai boy about 6 years old, short black hair, round dark brown eyes, MUST be wearing a
white lab coat with a front chest pocket and a pen clipped in the pocket, grey t-shirt
visible underneath the coat, navy blue shorts #003087, red sandals
```

**นิว** — นกค็อกคาทู

```
a white cockatoo with a large recurved yellow crest, bright blue cartoon eyes, short square
tail with yellow tail-tips, dark grey curved beak proportional to head size
```

**โรเบิร์ต** — แฮมสเตอร์ (ต้องเล็กเสมอ)

```
a small Syrian hamster, golden-brown fur, white belly and cheeks, extra-round chubby cheeks,
short round ears, very short stub tail — MUST be drawn clearly small in scale, noticeably
smaller than the cockatoo and about one-fifth the height of the boy when in the same frame
```

**วู้ดดี้** — เต่าซัลคาต้า (แว่น + หนังสือ ทุกเฟรม)

```
a young sulcata tortoise, brown angular-patterned shell, light green body, pale yellow
underbelly, MUST be wearing round-frame glasses resting on the snout with no visible temple
arms, MUST be holding or positioned near a small book, quadrupedal pose
```

### 4.3 COMPOSITION LOCK (ใส่ทุกช่อง)

```
Subject occupies the upper two-thirds of the square; the bottom third is plain low-detail
background reserved for a text label added later; 8% empty safety margin on all four edges,
nothing important touching the edges
```

เหตุผล: ข้อความไทยจะพิมพ์ทับตรงล่าง และ LINE ตัดขอบช่องนิดหน่อยบนบางเครื่อง

### 4.4 NEGATIVE LOCK (ใส่ทุกช่อง แบบคำต่อคำ)

```
flat vector style, no gradients, painterly watercolor texture, photorealistic rendering,
boy without white lab coat, boy in plain t-shirt only, hamster same size as or larger than
cockatoo, hamster with bushy tail, hamster resembling a squirrel, tortoise without glasses,
tortoise without book, extra limbs, cluttered background, busy patterned background,
subject filling the bottom third, drop shadow box frame, text, letters, numbers, Thai
characters, labels, watermark, logo, UI icons, app buttons
```

---

## 5. Prompt พร้อมก๊อป — 6 ช่อง

ทุกก้อนรวม STYLE + CHARACTER + SCENE + COMPOSITION + NEGATIVE ไว้แล้ว
ก๊อปทั้งก้อนวางได้เลย

### ช่อง 1 — แบบสำรวจ EF  (ซัน + วู้ดดี้)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a Thai boy about 6 years old, short black hair, round dark brown eyes, MUST be
wearing a white lab coat with a front chest pocket and a pen clipped in the pocket, grey
t-shirt visible underneath the coat, navy blue shorts #003087, red sandals — sitting
cross-legged, thinking with one finger on his chin and a curious happy expression, three
small glowing orange lightbulbs floating above his head in an arc; beside him a young
sulcata tortoise, brown angular-patterned shell, light green body, pale yellow underbelly,
MUST be wearing round-frame glasses resting on the snout with no visible temple arms, MUST
be holding a small book, quadrupedal pose, looking up at the boy.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, boy without white lab coat, boy in plain t-shirt only, tortoise without glasses,
tortoise without book, extra limbs, cluttered background, busy patterned background, subject
filling the bottom third, drop shadow box frame, text, letters, numbers, Thai characters,
labels, watermark, logo, UI icons, app buttons.
```

### ช่อง 2 — ดาวน์โหลดฟรี รหัสลับลายนิ้วมือ  (โรเบิร์ต)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a small Syrian hamster, golden-brown fur, white belly and cheeks, extra-round chubby
cheeks, short round ears, very short stub tail, standing upright on his hind legs holding a
large round magnifying glass with both front paws, peering through it with one eye comically
enlarged; behind him a big soft navy-blue fingerprint swirl pattern glowing faintly like a
clue, and one small orange gift tag floating nearby.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, hamster with bushy tail, hamster resembling a squirrel, extra limbs, cluttered
background, busy patterned background, subject filling the bottom third, drop shadow box
frame, text, letters, numbers, Thai characters, labels, watermark, logo, UI icons, app
buttons.
```

### ช่อง 3 — พิมพ์ใบประกาศ  (ซัน)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a Thai boy about 6 years old, short black hair, round dark brown eyes, MUST be
wearing a white lab coat with a front chest pocket and a pen clipped in the pocket, grey
t-shirt visible underneath the coat, navy blue shorts #003087, red sandals — standing
proudly and holding up a completely blank cream certificate sheet with an orange ribbon
rosette seal in its lower corner, both hands gripping the edges, wide delighted smile, a few
small orange confetti sparkles in the air around him.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, boy without white lab coat, boy in plain t-shirt only, any writing or ruled lines
on the certificate, extra limbs, cluttered background, busy patterned background, subject
filling the bottom third, drop shadow box frame, text, letters, numbers, Thai characters,
labels, watermark, logo, UI icons, app buttons.
```

> เอกสารในภาพต้อง **ว่างเปล่าจริงๆ** ถ้า AI ใส่เส้นบรรทัดหรือตัวหนังสือมั่วมา ให้สร้างใหม่
> อย่าฝืนใช้ เพราะซูมในมือถือแล้วเห็นชัด

### ช่อง 4 — สั่งซื้อหนังสือ  (ไม่มีตัวละคร เน้นสินค้า)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a neat stack of three closed children's activity books seen at a slight three-quarter
angle, covers in warm orange and deep navy with blank untitled covers, the top book tilted
open-ready; a small clear beaker with orange bubbling liquid and two floating bubbles
resting beside the stack; a soft orange glow under the stack.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, book titles, cover artwork with writing, price tags, shopping cart icon, extra
objects, cluttered background, busy patterned background, subject filling the bottom third,
drop shadow box frame, text, letters, numbers, Thai characters, labels, watermark, logo, UI
icons, app buttons.
```

### ช่อง 5 — ขอลิงก์ดาวน์โหลด  (ซัน)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a Thai boy about 6 years old, short black hair, round dark brown eyes, MUST be
wearing a white lab coat with a front chest pocket and a pen clipped in the pocket, grey
t-shirt visible underneath the coat, navy blue shorts #003087, red sandals — standing and
holding out a large puffy rounded envelope toward the viewer with both hands, the envelope
glowing warm orange as if something bright is sealed inside it, a small soft aura radiating
outward from the envelope's edges, the boy's expression friendly and eager as if handing
over something precious; three tiny star-sparkles floating around the envelope.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, boy without white lab coat, boy in plain t-shirt only, download arrow icon,
chain link icon, email app interface, open envelope showing contents, QR code, extra limbs,
cluttered background, busy patterned background, subject filling the bottom third, drop
shadow box frame, text, letters, numbers, Thai characters, labels, watermark, logo, UI
icons, app buttons.
```

### ช่อง 6 — สอบถาม  (นิว)

```
Soft-shaded children's book illustration, square 1:1 format, soft gradients and gentle
highlights, rounded friendly shapes, warm cream background #F7F4EF, accent colours limited
to warm orange #F59A23, deep navy #071B5D and sky blue #173A8A, single subject centred with
generous empty space around it, clean and uncluttered like a sticker, no text, no letters,
no watermark.
Scene: a white cockatoo with a large recurved yellow crest, bright blue cartoon eyes, short
square tail with yellow tail-tips, dark grey curved beak proportional to head size —
perched on a simple wooden bar, head tilted, beak slightly open as if chirping a friendly
hello, one wing raised in a small wave; a single empty rounded speech bubble in soft orange
floating beside its head, completely blank inside.
Composition: subject occupies the upper two-thirds of the square; the bottom third is plain
low-detail background reserved for a text label added later; 8% empty safety margin on all
four edges, nothing important touching the edges.
Negative: flat vector style, no gradients, painterly watercolor texture, photorealistic
rendering, cockatoo eyes wrong colour, writing inside the speech bubble, chat app interface,
extra limbs, cluttered background, busy patterned background, subject filling the bottom
third, drop shadow box frame, text, letters, numbers, Thai characters, labels, watermark,
logo, UI icons, app buttons.
```

---

## 6. ขั้นตอนประกอบไฟล์จริง

1. สร้างงาน **2500 × 1686 px** ใน Canva (Custom size) หรือ Figma
2. ถมพื้นหลังทั้งแผ่นด้วยครีม **`#F7F4EF`** ก่อน จะได้ไม่มีขอบขาวโผล่
3. ลากเส้นไกด์แนวตั้งที่ **833** และ **1666** แนวนอนที่ **843**
4. วางภาพทั้ง 6 ลงช่อง ครอปเป็นจัตุรัสให้เต็มช่อง
5. เส้นคั่นช่อง: เส้นบาง **1–2 px** สีนาวี `#071B5D` โปร่งใส ~15%
   (ไม่ต้องมีก็ได้ แต่มีแล้วคนดูออกว่ากดได้ 6 จุด)
6. พิมพ์ข้อความไทยทับที่ **แถบล่างของแต่ละช่อง**
   - ฟอนต์: **Mitr** (หัวเรื่องของเว็บใช้ตัวนี้) หรือ **Anuphan** ถ้าหาไม่เจอ
   - น้ำหนัก 600 ขนาด ~46–52 px สี `#071B5D`
   - จัดกึ่งกลาง บรรทัดเดียว ถ้ายาวเกินให้ตัดคำ ไม่ใช่ลดขนาดจนเล็กกว่าช่องอื่น
7. Export **JPEG คุณภาพ 80** → ควรได้ 300–700 KB
   ถ้าเกิน 1 MB ให้ลดคุณภาพลงเป็น 70 (อย่าลดขนาด px เด็ดขาด LINE จะปฏิเสธ)

**เช็กก่อนอัป:** เปิดภาพแล้วย่อดูเท่าฝ่ามือ — ถ้าอ่านป้ายไม่ออกในขนาดนั้น
บนมือถือจริงก็อ่านไม่ออก ให้เพิ่มขนาดฟอนต์ ไม่ใช่เพิ่มรายละเอียดภาพ

---

## 7. ตั้งค่าใน LINE OA Manager

`manager.line.biz` → เลือกบัญชี → **ริชเมนู** → สร้างใหม่

1. ชื่อ (เห็นเฉพาะเรา): `เมนูหลัก 2026-08`
2. ช่วงเวลาแสดงผล: เริ่มวันนี้ ไม่ต้องกำหนดวันจบ
3. ข้อความบนแถบเมนู: **`เมนู VINKO`**
4. การแสดงผลเมนู: **แสดงโดยค่าเริ่มต้น**
5. เทมเพลต: แบบ 6 ช่อง (3×2)
6. อัปโหลดภาพที่ทำไว้
7. กดทีละช่อง แล้วใส่ action ตามตารางหมวด 2
8. บันทึก แล้ว**เปิด LINE ในมือถือกดทดสอบให้ครบทั้ง 6 ปุ่มด้วยตัวเอง**
   โดยเฉพาะช่อง 2 ต้องเข้าไปแล้วเห็นปุ่มดาวน์โหลดทันที ไม่ใช่เห็น QR ให้แอดเพื่อน
