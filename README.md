# Smart Locker (Node.js + Firebase)

## ติดตั้ง

1. สร้าง Firebase project แล้วเปิด **Authentication > Email/Password** และ **Realtime Database**
2. หน้า Register (`/register.html`) ใช้สร้างผู้ใช้งานใหม่ หรือสร้างผู้ใช้แอดมินใน Authentication
3. สร้าง service account key แล้วกรอกค่าลง `.env` (คัดลอกจาก `.env.example`)
4. รัน `npm install` และ `npm run dev`
5. เปิด `http://localhost:3000`

## โครงสร้างข้อมูล Realtime Database

`lockers/1`, `lockers/2`, `lockers/3` จะเก็บ `state`, `updatedAt`, `updatedBy`; `events` เก็บ audit log ทุกคำสั่ง และ `users` / `usernames` ใช้เก็บชื่อผู้ใช้และค้นหา Username ตอนล็อกอิน

ESP32 ควรอ่าน `lockers/{id}/state` ผ่าน Firebase REST API หรือให้เชื่อมผ่าน Node.js/MQTT แล้วสั่งรีเลย์ตามค่า `open`/`locked` พร้อมเขียนสถานะกลับเมื่อสั่งงานจริงสำเร็จ

## การยืนยันบัตร RFID

หลังสมัคร ผู้ใช้จะอยู่ในคิวรอยืนยันและจะเห็นข้อความให้แตะบัตรที่ตู้ RFID. ESP32 ส่ง UID ของบัตรมายัง `POST /api/rfid/scan` พร้อม header `x-device-key` ที่ตรงกับ `DEVICE_API_KEY` ใน `.env`:

```json
{ "cardUid": "A1B2C3D4" }
```

เมื่อสำเร็จ สถานะบัญชีจะเป็น `ยืนยัน RFID แล้ว`. แดชบอร์ดหาล็อกเกอร์ของผู้ใช้จริงจาก `lockers/{id}/ownerUid`; ถ้าไม่มีจะแสดง `ไม่มี`.
