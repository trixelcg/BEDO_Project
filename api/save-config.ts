import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import { Storage } from '@google-cloud/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bucketName = process.env.GCS_BUCKET_NAME || 'tts-character-assets-2026';
let storage: Storage | null = null;
try {
  // Storage client will automatically use Application Default Credentials (ADC) in GCP environment
  storage = new Storage();
} catch (e) {
  console.warn("GCP Storage client could not be initialized in save-config. Using local disk fallback.", e);
}

// Helper to determine Content-Type based on extension
const getContentType = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.glb': 'model/gltf-binary',
    '.hdr': 'image/vnd.radial-gradient',
    '.exr': 'image/x-exr',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

// Helper to resolve dynamic destination name preserving original file extension
const getDestName = (url: string, defaultName: string): string => {
  if (!url) return defaultName;
  try {
    const urlObj = new URL(url, 'http://localhost');
    const ext = path.extname(urlObj.pathname).toLowerCase();
    if (ext) {
      const base = path.basename(defaultName, path.extname(defaultName));
      return `${base}${ext}`;
    }
  } catch (e) {}
  
  // Fallback for paths like /uploads/file.png
  const baseName = path.basename(url).split('?')[0];
  const ext = path.extname(baseName).toLowerCase();
  if (ext) {
    const base = path.basename(defaultName, path.extname(defaultName));
    return `${base}${ext}`;
  }
  return defaultName;
};

// Helper to download a file from a URL, supporting redirects (e.g. for GCS/S3)
const downloadFile = (url: string, dest: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string) => {
      const client = currentUrl.startsWith('https') ? https : http;
      client.get(currentUrl, (response) => {
        // Handle redirect codes (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
          if (response.headers.location) {
            request(response.headers.location);
            return;
          }
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download file: status code ${response.statusCode}`));
          return;
        }
        
        const fileStream = fs.createWriteStream(dest);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(dest, () => {}); // clean up local file if error
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    };
    request(url);
  });
};

// Helper to copy local upload files or download remote files to public/ and GCS (if in production)
const handleAsset = async (url: string, destName: string, publicDir: string): Promise<string> => {
  if (!url) return '';
  const destPath = path.join(publicDir, destName);
  let hasLocalFile = false;

  // 1. Process local file saving
  if (url.startsWith('http://') || url.startsWith('https://')) {
    console.log(`Downloading remote asset from: ${url} to ${destPath}`);
    await downloadFile(url, destPath);
    hasLocalFile = true;
  } else if (url.startsWith('/uploads/')) {
    const filename = path.basename(url);
    const sourcePath = path.join(__dirname, 'public', 'uploads', filename);
    if (fs.existsSync(sourcePath)) {
      console.log(`Copying local asset from: ${sourcePath} to ${destPath}`);
      fs.copyFileSync(sourcePath, destPath);
      hasLocalFile = true;
    } else {
      console.warn(`Local upload source file not found at: ${sourcePath}`);
    }
  } else {
    // Already points to local fallback /character.glb etc.
    if (fs.existsSync(destPath)) {
      hasLocalFile = true;
    }
  }

  // 2. Process GCS uploading for Cloud Run persistence
  if (storage) {
    try {
      const bucket = storage.bucket(bucketName);
      const destFile = bucket.file(destName);

      if (url.includes(`storage.googleapis.com/${bucketName}/`)) {
        // If it's already an uploaded file in our GCS bucket, copy it inside GCS to the static name
        const sourceName = decodeURIComponent(url.split(`/` + bucketName + `/`)[1]);
        if (sourceName && sourceName !== destName) {
          console.log(`GCS Copy: copying gs://${bucketName}/${sourceName} to gs://${bucketName}/${destName}`);
          await bucket.file(sourceName).copy(destFile);
          await destFile.makePublic();
        }
      } else if (hasLocalFile && fs.existsSync(destPath)) {
        // Otherwise, upload the local file to GCS
        console.log(`GCS Upload: uploading local ${destPath} to gs://${bucketName}/${destName}`);
        await destFile.save(fs.readFileSync(destPath), {
          resumable: false,
          metadata: { contentType: getContentType(destName) }
        });
        await destFile.makePublic();
      }
    } catch (e: any) {
      console.warn(`Failed to sync asset ${destName} to GCS:`, e.message);
    }
  }

  return `/${destName}`;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sceneConfig, ttsConfig, aiConfig, characterUrl, locationUrl, hdrUrl, visemeMap } = req.body;
    
    // Path to public folder in the project root
    const publicDir = path.join(__dirname, '..', 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // Process assets: download remote or copy local uploaded files, keeping original file extensions
    const charDestName = path.basename(characterUrl).split('?')[0] || 'character.glb';
    const locDestName = path.basename(locationUrl).split('?')[0] || 'location.glb';
    const hdrDestName = path.basename(hdrUrl).split('?')[0] || 'environment.webp';

    const localCharacterUrl = await handleAsset(characterUrl, charDestName, publicDir);
    const localLocationUrl = await handleAsset(locationUrl, locDestName, publicDir);
    const localHdrUrl = await handleAsset(hdrUrl, hdrDestName, publicDir);

    // Save the configuration JSON file with local paths
    const configPath = path.join(publicDir, 'config.json');
    const finalConfig = {
      sceneConfig,
      ttsConfig,
      aiConfig,
      characterUrl: localCharacterUrl || characterUrl,
      locationUrl: localLocationUrl || locationUrl,
      hdrUrl: localHdrUrl || hdrUrl,
      visemeMap
    };

    fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), 'utf-8');
    console.log(`Successfully saved configuration and assets to public folder: ${configPath}`);
    
    // If GCS is available, also upload config.json to GCS for persistence
    if (storage) {
      try {
        console.log(`GCS Save Config: uploading config.json to gs://${bucketName}/config.json`);
        const destFile = storage.bucket(bucketName).file('config.json');
        await destFile.save(JSON.stringify(finalConfig, null, 2), {
          metadata: { 
            contentType: 'application/json',
            cacheControl: 'no-cache, no-store, must-revalidate'
          },
          resumable: false
        });
        await destFile.makePublic();
      } catch (e: any) {
        console.warn("Failed to sync config.json to GCS:", e.message);
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'All configurations, viseme maps, and 3D assets saved to the project public folder successfully!',
      characterUrl: finalConfig.characterUrl,
      locationUrl: finalConfig.locationUrl,
      hdrUrl: finalConfig.hdrUrl
    });
  } catch (err: any) {
    console.error('Error saving configuration & downloading assets:', err);
    return res.status(500).json({ error: `Save config and assets error: ${err.message}` });
  }
}

