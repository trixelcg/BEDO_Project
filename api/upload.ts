import { put, getSignedUploadUrl } from './gcsStorage';

export default async function handler(req: any, res: any) {
  // GET request (or POST request asking for signed URL parameters)
  if (req.method === 'GET' || (req.method === 'POST' && req.query.filename && req.query.contentType && !req.query.fallback)) {
    try {
      const filename = req.query.filename as string;
      const contentType = req.query.contentType as string;
      if (!filename) {
        return res.status(400).json({ error: 'Missing filename query parameter' });
      }
      
      const data = await getSignedUploadUrl(filename, contentType);
      return res.status(200).json(data);
    } catch (err: any) {
      console.error('Error generating upload URL:', err);
      return res.status(500).json({ error: `Upload URL Error: ${err.message}` });
    }
  }

  // POST or PUT request for direct binary streaming uploads (or local mock uploads fallback)
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const filename = (req.query.filename as string) || `upload_${Date.now()}.glb`;
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    
    let fileBuffer: Buffer;
    
    if (req.body && Buffer.isBuffer(req.body)) {
      fileBuffer = req.body;
    } else if (req.body && typeof req.body === 'string') {
      fileBuffer = Buffer.from(req.body);
    } else {
      // Read binary stream chunks into buffer
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      fileBuffer = Buffer.concat(chunks);
    }

    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: 'File is empty or body could not be parsed' });
    }

    console.log(`Processing direct upload for file: ${filename}, size: ${fileBuffer.length} bytes`);
    const blob = await put(filename, fileBuffer, { contentType });
    
    return res.status(200).json(blob);
  } catch (err: any) {
    console.error('Error handling file upload:', err);
    return res.status(500).json({ error: `Upload error: ${err.message}` });
  }
}

// Disable body parsing so raw binary streaming is supported natively
export const config = {
  api: {
    bodyParser: false,
  },
};
