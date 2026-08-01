// โหลดค่า environment จากไฟล์ .env เพื่อเชื่อมต่อ Firebase
require('dotenv').config();
const path = require('path');
const express = require('express');
const admin = require('firebase-admin');

// ตรวจสอบว่าสิ่งที่ต้องมีสำหรับ Firebase ถูกตั้งค่าไว้หรือไม่
const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY_B64', 'FIREBASE_DATABASE_URL', 'FIREBASE_WEB_API_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) console.warn(`Firebase ยังไม่ถูกตั้งค่า: ${missing.join(', ')}`);

// ฟังก์ชันดึงคีย์จาก Base64 แล้วถอดรหัสกลับมาเป็น PEM Key ที่ถูกต้อง
const getPrivateKeyFromB64 = () => {
  const b64Key = process.env.FIREBASE_PRIVATE_KEY_B64;
  if (!b64Key) return undefined;

  // ถอดรหัสข้อความจาก Base64 กลับมาเป็นสตริงปกติ
  return Buffer.from(b64Key, 'base64').toString('ascii');
};

// ถ้ายังไม่มีการเชื่อมต่อ Firebase และค่า env พร้อม ให้เริ่มต้นแอป Firebase
if (!admin.apps.length && !missing.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKeyFromB64(),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const app = express();
app.use(express.json());
// ให้บริการไฟล์สเตติกจาก public และหน้า index ของรากโฟลเดอร์
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname, { index: 'index.html', extensions: ['html'] }));

// ตรวจสอบว่าสามารถใช้งาน Firebase ได้หรือไม่
const configured = () => !missing.length;
const failIfUnconfigured = (res) => {
  if (!configured()) {
    // ถ้ายังไม่ตั้งค่า Firebase ให้ตอบกลับว่าเซิร์ฟเวอร์ยังไม่พร้อม
    res.status(503).json({ message: 'ยังไม่ได้ตั้งค่า Firebase ในไฟล์ .env' });
    return true;
  }
};

// สร้าง key จาก username เพื่อใช้ดัชนีในฐานข้อมูล
const usernameKey = (username) => String(username || '').trim().toLowerCase();
// เวลาในการรอยืนยัน RFID สำหรับการสมัคร และรีเซ็ตรหัสผ่าน
const SIGNUP_TIMEOUT_MS = 60_000;
const PASSWORD_RESET_TIMEOUT_MS = 60_000;
// username พิเศษสำหรับบัญชีที่ไม่ต้องผ่านการยืนยัน RFID
const EXEMPT_PENDING_USERNAME = 'test';
const PASSWORD_RESET_QUEUE_NODE = 'passwordResetQueue';

async function getPasswordResetRequest(requestId) {
  // อ่านข้อมูลคำขอรีเซ็ตรหัสผ่านจาก Realtime Database
  const snapshot = await admin.database().ref(`passwordResetRequests/${requestId}`).get();
  return snapshot.exists() ? snapshot.val() : null;
}

async function createPasswordResetRequest(email) {
  // normalize email เป็นตัวพิมพ์เล็กเพื่อตรวจสอบกับ Firebase Auth
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await admin.auth().getUserByEmail(normalizedEmail);
  const profileSnap = await admin.database().ref(`users/${user.uid}`).get();
  const profile = profileSnap.val() || {};

  // บัญชีบางประเภทไม่ต้องรอ RFID เช่น username พิเศษที่ตั้งค่าไว้
  const skipRfid = String(profile.username || '').trim().toLowerCase() === EXEMPT_PENDING_USERNAME;
  const requestRef = admin.database().ref('passwordResetRequests').push();
  const requestId = requestRef.key;
  const expiresAt = Date.now() + PASSWORD_RESET_TIMEOUT_MS;
  const requestData = {
    uid: user.uid,
    email: normalizedEmail,
    expiresAt,
    status: skipRfid ? 'verified' : 'waiting',
    skipRfid,
    createdAt: admin.database.ServerValue.TIMESTAMP,
  };

  // เก็บคำขอรีเซ็ตรหัสผ่านไว้ในฐานข้อมูล
  await requestRef.set(requestData);
  if (!skipRfid) {
    // ถ้าต้องยืนยัน RFID ให้ลง queue เพื่อรอการแตะบัตร
    await admin.database().ref(`${PASSWORD_RESET_QUEUE_NODE}/${user.uid}`).set({ requestId, requestedAt: admin.database.ServerValue.TIMESTAMP });
  }
  return { requestId, expiresAt, skipRfid };
}

async function verifyPasswordResetWithCard(cardUid) {
  // ตรวจสอบว่าบัตร RFID นี้มีในระบบหรือไม่
  const cardSnapshot = await admin.database().ref(`rfidCards/${cardUid}`).get();
  if (!cardSnapshot.exists()) return null;
  const uid = cardSnapshot.val()?.uid;
  if (!uid) return null;

  // ตรวจดูว่า UID ของผู้ใช้คนนั้นกำลังอยู่ในคิวรีเซ็ตรหัสผ่านหรือไม่
  const queueSnapshot = await admin.database().ref(`${PASSWORD_RESET_QUEUE_NODE}/${uid}`).get();
  if (!queueSnapshot.exists()) return null;
  const { requestId } = queueSnapshot.val();
  const request = await getPasswordResetRequest(requestId);

  // เงื่อนไขต้องเป็นคำขอที่รออยู่และยังไม่หมดเวลา
  if (!request || request.status !== 'waiting' || request.expiresAt < Date.now()) return null;

  // อัปเดตสถานะคำขอว่าได้รับการยืนยันด้วย RFID แล้ว และเอาออกจากคิว
  await Promise.all([
    admin.database().ref(`passwordResetRequests/${requestId}/status`).set('verified'),
    admin.database().ref(`${PASSWORD_RESET_QUEUE_NODE}/${uid}`).remove(),
  ]);
  return { requestId, uid };
}

async function removeExpiredPendingAccount(uid) {
  // ลบบัญชีที่รอ RFID นานเกินกำหนด
  const profile = (await admin.database().ref(`users/${uid}`).get()).val();
  if (!profile || profile.rfidStatus !== 'pending' || !profile.rfidExpiresAt || profile.rfidExpiresAt > Date.now()) return false;
  if (String(profile.username || '').trim().toLowerCase() === EXEMPT_PENDING_USERNAME) return false;

  const updates = {
    [`users/${uid}`]: null,
    [`rfidEnrollmentQueue/${uid}`]: null,
  };
  if (profile.username) updates[`usernames/${usernameKey(profile.username)}`] = null;

  // ลบข้อมูลบัญชีผู้ใช้และคิว enrollment ในฐานข้อมูล
  await admin.database().ref().update(updates);
  try {
    await admin.auth().deleteUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  return true;
}

function schedulePendingAccountRemoval(uid, expiresAt) {
  // ตั้งเวลาให้เรียกลบบัญชีเมื่อครบกำหนด
  setTimeout(() => removeExpiredPendingAccount(uid).catch(console.error), Math.max(0, expiresAt - Date.now()));
}

async function initializePendingRemovals() {
  // โหลดบัญชีทั้งหมดจากฐานข้อมูล เพื่อกำหนดการลบสำหรับบัญชีที่ยังรอ RFID
  const snapshot = await admin.database().ref('users').get();
  snapshot.forEach((child) => {
    const profile = child.val();
    if (!profile || profile.rfidStatus !== 'pending' || !profile.rfidExpiresAt) return;
    const expiresAt = profile.rfidExpiresAt;
    if (expiresAt <= Date.now()) {
      removeExpiredPendingAccount(child.key).catch(console.error);
    } else {
      schedulePendingAccountRemoval(child.key, expiresAt);
    }
  });
}

async function authenticate(req, res, next) {
  if (failIfUnconfigured(res)) return;
  try {
    // ดึง token จาก header Authorization ในรูปแบบ Bearer
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    // ถ้า token ไม่ถูกต้องหรือหมดอายุ ให้ปฏิเสธการเข้าถึง
    res.status(401).json({ message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

async function ensureProfile(uid) {
  // ตรวจสอบว่า profile ใน Realtime Database มีหรือยัง
  const ref = admin.database().ref(`users/${uid}`);
  const snapshot = await ref.get();
  if (snapshot.exists()) return snapshot.val();

  // ถ้ายังไม่มี ให้สร้าง profile เบื้องต้นจาก Firebase Auth
  const user = await admin.auth().getUser(uid);
  const profile = {
    username: user.displayName || null,
    email: user.email || null,
    rfidStatus: 'unverified',
    rfidUid: null,
    createdAt: admin.database.ServerValue.TIMESTAMP,
  };
  await ref.set(profile);
  return profile;
}

async function accountData(uid) {
  // รวมข้อมูลโปรไฟล์และล็อกเกอร์ของผู้ใช้
  const profile = await ensureProfile(uid);
  const lockers = (await admin.database().ref('lockers').get()).val() || {};
  const ownedLockerIds = Object.entries(lockers)
    .filter(([, locker]) => locker?.ownerUid === uid)
    .map(([id]) => Number(id));
  return { profile, ownedLockerIds };
}

// เข้าสู่ระบบด้วย Username/Email และ Password
app.post('/api/login', async (req, res) => {
  if (failIfUnconfigured(res)) return;
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ message: 'กรอก Username/Email และ Password ให้ครบ' });

  try {
    let email = String(identifier).trim();
    if (!email.includes('@')) {
      // ค้นหา email จาก username index
      const record = await admin.database().ref(`usernames/${usernameKey(email)}`).get();
      email = record.val()?.email;
    }
    if (!email) return res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง' });

    // เรียก Firebase Auth REST API เพื่อยืนยันรหัสผ่าน
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(401).json({ message: 'Username/Email หรือ Password ไม่ถูกต้อง' });

    const decoded = await admin.auth().verifyIdToken(data.idToken);
    const profile = await ensureProfile(decoded.uid);
    // ส่ง token พร้อมบอกหน้าต่อไปว่าต้องไปหน้าไหน
    res.json({ token: data.idToken, next: profile.rfidStatus === 'pending' ? 'rfid' : 'dashboard' });
  } catch {
    res.status(502).json({ message: 'ไม่สามารถเชื่อมต่อ Firebase Authentication ได้' });
  }
});

// สมัครสมาชิกและสร้างบัญชีพร้อมคิวรอแตะ RFID
app.post('/api/register', async (req, res) => {
  if (failIfUnconfigured(res)) return;
  const { username, email, password } = req.body;
  const key = usernameKey(username);

  if (!/^[a-z0-9._-]{3,30}$/.test(key)) return res.status(400).json({ message: 'Username ต้องมี 3–30 ตัว ใช้อักษรอังกฤษ ตัวเลข . _ หรือ -' });
  if (!email || !password || password.length < 6) return res.status(400).json({ message: 'กรอกอีเมลและ Password อย่างน้อย 6 ตัวอักษร' });

  try {
    const indexRef = admin.database().ref(`usernames/${key}`);
    const existing = await indexRef.get();
    if (existing.exists()) return res.status(409).json({ message: 'Username นี้ถูกใช้งานแล้ว' });

    const user = await admin.auth().createUser({ email: email.trim(), password, displayName: username.trim() });
    try {
      const expiresAt = Date.now() + SIGNUP_TIMEOUT_MS;
      // เขียนข้อมูลผู้ใช้ใหม่ลง Realtime Database พร้อมสถานะรอ RFID
      await admin.database().ref().update({
        [`users/${user.uid}`]: {
          username: username.trim(),
          email: email.trim(),
          rfidStatus: 'pending',
          rfidUid: null,
          rfidExpiresAt: expiresAt,
          createdAt: admin.database.ServerValue.TIMESTAMP,
        },
        [`usernames/${key}`]: { uid: user.uid, email: email.trim() },
        [`rfidEnrollmentQueue/${user.uid}`]: { requestedAt: admin.database.ServerValue.TIMESTAMP },
      });
      schedulePendingAccountRemoval(user.uid, expiresAt);
    } catch (dbError) {
      // ถ้าเขียนฐานข้อมูลไม่สำเร็จ ให้ลบผู้ใช้ที่สร้างไว้แล้วเพื่อไม่ให้ค้าง
      await admin.auth().deleteUser(user.uid);
      throw dbError;
    }

    // ทำ auto-login หลังสมัครสำเร็จ
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
    });
    const session = await response.json();
    if (!response.ok) {
      const error = new Error(session.error?.message || 'สร้างบัญชีสำเร็จ แต่ไม่สามารถเข้าสู่ระบบอัตโนมัติ');
      error.code = session.error?.message;
      throw error;
    }

    res.status(201).json({ token: session.idToken, expiresAt: Date.now() + SIGNUP_TIMEOUT_MS });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') return res.status(409).json({ message: 'Email นี้ถูกใช้งานแล้ว' });
    if (error.code === 'CONFIGURATION_NOT_FOUND') return res.status(503).json({ message: 'ยังไม่ได้เปิด Email/Password ใน Firebase' });
    res.status(502).json({ message: error.message || 'สร้างบัญชีไม่สำเร็จ' });
  }
});

// สร้างคำขอรีเซ็ตรหัสผ่าน และอาจใส่ผู้ใช้เข้า queue รอ RFID
app.post('/api/forgot-password', async (req, res) => {
  if (failIfUnconfigured(res)) return;
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'กรอกอีเมลให้ครบ' });

  try {
    const request = await createPasswordResetRequest(email);
    res.json({ requestId: request.requestId, expiresAt: request.expiresAt, skipRfid: request.skipRfid });
  } catch (error) {
    if (error.code === 'auth/user-not-found') return res.status(404).json({ message: 'ไม่พบอีเมลนี้ในระบบ' });
    res.status(502).json({ message: error.message || 'ไม่สามารถสร้างคำขอรีเซ็ตรหัสผ่านได้' });
  }
});

// ตรวจสถานะคำขอรีเซ็ตรหัสผ่าน เพื่อให้หน้า UI รู้ว่ารีเซ็ตได้หรือยัง
app.get('/api/forgot-password/status', async (req, res) => {
  if (failIfUnconfigured(res)) return;
  const requestId = String(req.query.requestId || '').trim();
  if (!requestId) return res.status(400).json({ message: 'requestId ไม่ถูกต้อง' });

  try {
    const request = await getPasswordResetRequest(requestId);
    if (!request) return res.status(404).json({ message: 'ไม่พบคำขอรีเซ็ตรหัสผ่าน' });
    const remaining = Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000));
    const verified = Boolean(request.skipRfid || request.status === 'verified');
    const canReset = verified || Date.now() >= request.expiresAt;
    res.json({ requestId, email: request.email, verified, canReset, expiresAt: request.expiresAt, remaining, skipRfid: request.skipRfid });
  } catch (error) {
    res.status(502).json({ message: error.message || 'ไม่สามารถอ่านสถานะคำขอได้' });
  }
});

// เปลี่ยนรหัสผ่านเมื่อคำขอพร้อมใช้งาน
app.post('/api/reset-password', async (req, res) => {
  if (failIfUnconfigured(res)) return;
  const { requestId, password } = req.body;
  if (!requestId || !password || password.length < 6) return res.status(400).json({ message: 'กรอกรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร' });

  try {
    const request = await getPasswordResetRequest(String(requestId));
    if (!request) return res.status(404).json({ message: 'ไม่พบคำขอรีเซ็ตรหัสผ่าน' });
    if (request.status === 'completed') return res.status(410).json({ message: 'คำขอนี้ถูกใช้งานแล้ว' });
    if (!request.skipRfid && request.status === 'waiting' && Date.now() < request.expiresAt) {
      return res.status(403).json({ message: 'รอให้ครบ 60 วินาทีหรือแตะบัตร RFID ที่ผูกกับอีเมลนี้ก่อน' });
    }

    await admin.auth().updateUser(request.uid, { password });
    await admin.database().ref(`passwordResetRequests/${requestId}`).update({ status: 'completed', completedAt: admin.database.ServerValue.TIMESTAMP });
    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (error) {
    res.status(502).json({ message: error.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้' });
  }
});

// คืนข้อมูลโปรไฟล์ผู้ใช้ และรายการล็อกเกอร์ที่เป็นเจ้าของ
app.get('/api/me', authenticate, async (req, res) => {
  try {
    res.json(await accountData(req.user.uid));
  } catch {
    res.status(500).json({ message: 'อ่านข้อมูลบัญชีไม่สำเร็จ' });
  }
});

// Endpoint สำหรับ ESP32 ส่ง UID บัตร RFID มาให้
app.post('/api/rfid/scan', async (req, res) => {
  // ตรวจสอบ Device Key เพื่อให้เฉพาะฮาร์ดแวร์ที่อนุญาตเข้าถึงได้
  if (!process.env.DEVICE_API_KEY || req.headers['x-device-key'] !== process.env.DEVICE_API_KEY) {
    return res.status(401).json({ message: 'Device key ไม่ถูกต้อง' });
  }
  if (failIfUnconfigured(res)) return;

  const cardUid = String(req.body?.cardUid || '').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
  if (cardUid.length < 4) return res.status(400).json({ message: 'RFID card UID ไม่ถูกต้อง' });

  try {
    const cardSnapshot = await admin.database().ref(`rfidCards/${cardUid}`).get();
    if (cardSnapshot.exists()) {
      // ถ้าบัตรติดตั้งไว้แล้ว ให้ตรวจสอบว่ามันกำลังใช้เพื่อยืนยันคำขอรีเซ็ตรหัสผ่านหรือไม่
      const resetResult = await verifyPasswordResetWithCard(cardUid);
      if (resetResult) {
        return res.json({ message: 'ยืนยันบัตร RFID สำหรับรีเซ็ตรหัสผ่านสำเร็จ', requestId: resetResult.requestId });
      }
      return res.status(409).json({ message: 'บัตรนี้ถูกยืนยันแล้ว' });
    }

    // ถ้าบัตรยังไม่ลงทะเบียน ให้เลือกผู้ใช้ถัดไปที่อยู่ในคิว enrollment
    const queue = (await admin.database().ref('rfidEnrollmentQueue').get()).val() || {};
    const next = Object.entries(queue)
      .sort(([, a], [, b]) => (a.requestedAt || 0) - (b.requestedAt || 0))[0];
    if (!next) return res.status(202).json({ message: 'ไม่มีผู้ใช้รอยืนยัน RFID' });

    const [uid] = next;
    await admin.database().ref().update({
      [`users/${uid}/rfidStatus`]: 'verified',
      [`users/${uid}/rfidUid`]: cardUid,
      [`rfidCards/${cardUid}`]: { uid, verifiedAt: admin.database.ServerValue.TIMESTAMP },
      [`rfidEnrollmentQueue/${uid}`]: null,
    });

    res.json({ message: 'ยืนยันบัตร RFID สำเร็จ' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'บันทึกบัตร RFID ไม่สำเร็จ' });
  }
});

// คืนข้อมูลล็อกเกอร์ที่ผู้ใช้เป็นเจ้าของเท่านั้น
app.get('/api/lockers', authenticate, async (req, res) => {
  try {
    const value = (await admin.database().ref('lockers').get()).val() || {};
    const owned = Object.fromEntries(Object.entries(value).filter(([, locker]) => locker?.ownerUid === req.user.uid));
    res.json({ lockers: owned });
  } catch {
    res.status(500).json({ message: 'อ่านข้อมูลล็อกเกอร์ไม่สำเร็จ' });
  }
});

// ควบคุมล็อกเกอร์ทั้งล็อคและปลดล็อคโดยผู้ใช้ที่เป็นเจ้าของ
app.post('/api/lockers/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const { action } = req.body;
  if (![1, 2, 3].includes(id) || !['lock', 'unlock'].includes(action)) return res.status(400).json({ message: 'คำสั่งล็อกเกอร์ไม่ถูกต้อง' });

  try {
    const locker = (await admin.database().ref(`lockers/${id}`).get()).val();
    if (!locker || locker.ownerUid !== req.user.uid) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ควบคุมล็อกเกอร์ช่องนี้' });
    const state = action === 'unlock' ? 'open' : 'locked';
    const payload = { state, updatedAt: admin.database.ServerValue.TIMESTAMP, updatedBy: req.user.uid };
    await admin.database().ref(`lockers/${id}`).update(payload);
    await admin.database().ref('events').push({ lockerId: id, action, by: req.user.uid, at: admin.database.ServerValue.TIMESTAMP });

    const lockers = (await admin.database().ref('lockers').get()).val() || {};
    const owned = Object.fromEntries(Object.entries(lockers).filter(([, item]) => item?.ownerUid === req.user.uid));
    res.json({ lockers: owned });
  } catch {
    res.status(500).json({ message: 'บันทึกคำสั่งลง Firebase ไม่สำเร็จ' });
  }
});

// เริ่มต้นเซิร์ฟเวอร์ และตั้ง timeout เพื่อลบบัญชีที่รอ RFID เกินเวลา
app.listen(process.env.PORT || 3000, () => {
  if (configured()) {
    initializePendingRemovals().catch(console.error);
  }
  console.log(`Smart Locker: http://localhost:${process.env.PORT || 3000}`);
});
