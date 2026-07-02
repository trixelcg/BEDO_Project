import { Storage } from '@google-cloud/storage';

const bucketName = process.env.GCS_BUCKET_NAME || 'tts-character-assets-2026';
let storage: Storage | null = null;
try {
  storage = new Storage();
} catch (e) {
  console.warn('GCP Storage client could not be initialized in register.ts.', e);
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s: string) => /^[+\d][\d\s()-]{6,}$/.test(s);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const fullName = (body.fullName || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const phone = (body.phone || '').toString().trim();

  if (!fullName || !email || !phone) {
    return res.status(400).json({ error: 'الرجاء تعبئة جميع الحقول' });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }
  if (!isPhone(phone)) {
    return res.status(400).json({ error: 'رقم الجوال غير صحيح' });
  }

  const record = {
    fullName,
    email,
    phone,
    createdAt: new Date().toISOString(),
    userAgent: (req.headers && req.headers['user-agent']) || ''
  };

  try {
    if (storage) {
      const stamp = Date.now();
      const rnd = Math.random().toString(36).slice(2, 8);
      const objectName = `registrations/${stamp}_${rnd}.json`;
      await storage.bucket(bucketName).file(objectName).save(JSON.stringify(record, null, 2), {
        resumable: false,
        metadata: { contentType: 'application/json' }
      });
      console.log(`Saved registration to gs://${bucketName}/${objectName}`);
    } else {
      console.warn('Storage unavailable; registration not persisted:', record);
    }
    return res.status(200).json({ success: true, message: 'تم استلام طلبك بنجاح. سنتواصل معك قريباً.' });
  } catch (err: any) {
    console.error('Error saving registration:', err);
    return res.status(500).json({ error: 'تعذّر حفظ الطلب، حاول مرة أخرى لاحقاً.' });
  }
}
