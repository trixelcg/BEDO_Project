import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bucketName = process.env.GCS_BUCKET_NAME || 'tts-character-assets-2026';

let storage: Storage | null = null;
try {
  // Storage client will automatically use Application Default Credentials (ADC) in GCP environment
  storage = new Storage();
} catch (e) {
  console.warn("GCP Storage client could not be initialized. Using local disk uploads fallback.", e);
}

// Ensure local uploads directory exists for fallback
const LOCAL_UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
  fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
}

export async function put(
  filename: string,
  data: Buffer,
  options: { contentType?: string; [key: string]: any } = {}
) {
  if (storage && process.env.NODE_ENV === 'production') {
    try {
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(filename);

      await file.save(data, {
        metadata: {
          contentType: options.contentType || 'application/octet-stream',
        },
        resumable: false,
      });

      try {
        await file.makePublic();
      } catch (e: any) {
        console.warn("Could not set file public access explicitly:", e.message);
      }

      const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(filename)}`;
      return { url: publicUrl };
    } catch (err) {
      console.warn("GCS Upload failed. Falling back to local disk upload.", err);
    }
  }

  // Fallback to local storage
  const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const filePath = path.join(LOCAL_UPLOADS_DIR, safeFilename);
  fs.writeFileSync(filePath, data);

  const publicUrl = `/uploads/${safeFilename}`;
  return { url: publicUrl };
}

// Generate Signed Upload URL for client-side direct uploads
export async function getSignedUploadUrl(filename: string, contentType: string) {
  if (storage && process.env.NODE_ENV === 'production') {
    try {
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(filename);

      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: contentType || 'application/octet-stream',
      });

      const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(filename)}`;
      return { uploadUrl, publicUrl };
    } catch (err) {
      console.warn("GCS Signed URL generation failed. Falling back to mock URL.", err);
    }
  }

  // Fallback / Mock upload URL for local dev environment
  const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const mockUploadUrl = `/api/upload?filename=${encodeURIComponent(safeFilename)}&fallback=true`;
  const publicUrl = `/uploads/${safeFilename}`;
  return { uploadUrl: mockUploadUrl, publicUrl };
}
