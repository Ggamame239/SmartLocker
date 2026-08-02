# SmartLocker

SmartLocker เป็นระบบตู้ล็อกเกอร์อัจฉริยะที่สร้างด้วย Node.js, Express และ Firebase Realtime Database โดยมีฟีเจอร์หลักคือ:

- ลงทะเบียนผู้ใช้งานด้วย Email/Password
- ยืนยัน RFID หลังสมัครเพื่อผูกบัตรกับบัญชี
- รีเซ็ตรหัสผ่านด้วยการสแกนบัตร RFID
- ควบคุมสถานะล็อกเกอร์ผ่านแดชบอร์ด
- บันทึกกิจกรรมและสถานะล็อกเกอร์ลง Firebase

## โครงสร้างโปรเจค

- `server.js` - เซิร์ฟเวอร์หลัก ใช้ Express ให้บริการหน้าเว็บสเตติก, API และเชื่อมต่อ Firebase
- `public/` - หน้าเว็บที่ให้บริการแก่ผู้ใช้
  - `register.html` - หน้าสมัครสมาชิก
  - `dashboard.html` - แดชบอร์ดผู้ใช้
  - `rfid-enroll.html` - หน้าแจ้งรอการแตะ RFID หลังสมัครหรือรีเซ็ตรหัสผ่าน
  - `forgot-password.html` / `forgot-password-wait.html` / `reset-password.html` - หน้ารีเซ็ตรหัสผ่าน
- `.env` - เก็บคอนฟิก Firebase และคีย์ลับ
- `package.json` - ขึ้นระบบ Node.js และ dependencies

## การตั้งค่า

1. สร้าง Firebase project ใหม่
2. เปิดใช้งาน **Authentication > Email/Password**
3. เปิดใช้งาน **Realtime Database** และตั้งค่าเป็นโหมดทดสอบหรืออนุญาตตามต้องการ
4. สร้าง Firebase Service Account key และนำข้อมูลใส่ `.env`
5. ติดตั้งแพ็กเกจ:

```bash
npm install
```

6. รันเซิร์ฟเวอร์:

```bash
npm run dev
```

7. เปิดเว็บที่:

```text
http://localhost:3000(local)
smartlockermanager.up.railway.app(host)
```

## ตัวแปรใน `.env`

ต้องมีค่าเหล่านี้:

- `PORT` - พอร์ตเซิร์ฟเวอร์
- `FIREBASE_PROJECT_ID`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `DEVICE_API_KEY` - ใช้สำหรับตรวจสอบคำขอจากอุปกรณ์ RFID

> หมายเหตุ: หากเก็บ `FIREBASE_PRIVATE_KEY` ใน `.env` โดยมี `\n` ให้แน่ใจว่าโค้ดแปลง escape sequence กลับเป็น newline จริงก่อนใช้งาน

## กระบวนการหลักของระบบ

### 1. สมัครสมาชิก

- ผู้ใช้กรอกข้อมูลใน `register.html`
- ถ้าผ่าน validation ระบบสร้างบัญชีใน Firebase Auth และเก็บโปรไฟล์ใน Realtime Database
- ผู้ใช้จะอยู่ในสถานะ `pending` จนกว่าจะยืนยันบัตร RFID

### 2. ยืนยันบัตร RFID

- หลังสมัคร ผู้ใช้เห็นหน้ารอแตะบัตร RFID (`rfid-enroll.html`)
- อุปกรณ์ RFID/ESP32 ส่ง `cardUid` มายัง API `POST /api/rfid/scan`
- เซิร์ฟเวอร์จะเชื่อมต่อกับ Firebase เพื่ออัปเดตสถานะบัญชี

### 3. รีเซ็ตรหัสผ่าน

- ผู้ใช้ขอรีเซ็ตรหัสผ่านจาก `forgot-password.html`
- ระบบสร้างคำขอรีเซ็ตและถ้ายังไม่ข้าม RFID จะรอจนกว่าจะสแกนบัตร
- เมื่อยืนยันสำเร็จ ผู้ใช้ไปยัง `reset-password.html`

## ฐานข้อมูลหลัก

- `users/{uid}` - ข้อมูลโปรไฟล์ผู้ใช้, สถานะ RFID, username
- `usernames/{key}` - แผนที่จาก username เป็น uid
- `lockers/{lockerId}` - สถานะล็อกเกอร์, เจ้าของ, เวลาอัปเดต
- `passwordResetRequests/{requestId}` - คำขอรีเซ็ตรหัสผ่าน
- `passwordResetQueue/{uid}` - คิวรอการยืนยัน RFID สำหรับรีเซ็ตรหัสผ่าน
- `rfidCards/{cardUid}` - แผนที่บัตร RFID ไปยัง uid
- `rfidEnrollmentQueue/{uid}` - คิวรอยืนยันบัตรหลังสมัคร

## ข้อมูลเพิ่มเติม

ระบบนี้ออกแบบมาเพื่อเชื่อมต่อกับอุปกรณ์ล็อกเกอร์ภายนอก เช่น ESP32 ที่สามารถอ่าน/เขียนข้อมูลจาก Firebase ได้โดยตรง หรือเข้าถึง API ของเซิร์ฟเวอร์เพื่อตรวจสอบและสั่งล็อกเกอร์
