import { IncomingMessage, ServerResponse } from 'http';

let cachedGcpToken: { token: string, expiresAt: number } | null = null;
const badApiKeys: Set<string> = new Set();

async function getGcpAccessToken(): Promise<string | null> {
  // Use cached token if valid (buffer of 60 seconds)
  if (cachedGcpToken && cachedGcpToken.expiresAt > Date.now() + 60000) {
    return cachedGcpToken.token;
  }

  try {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers: {
        'Metadata-Flavor': 'Google'
      }
    });
    if (response.ok) {
      const data = await response.json();
      const expiresInMs = (data.expires_in || 3000) * 1000;
      cachedGcpToken = {
        token: data.access_token,
        expiresAt: Date.now() + expiresInMs
      };
      return data.access_token;
    } else {
      const statusText = await response.text();
      console.warn(`Failed to fetch metadata token. Status: ${response.status}, Response: ${statusText}`);
    }
  } catch (err) {
    console.warn('Metadata server not available, not running on GCP:', err);
  }
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { provider, apiKey, voiceId, text } = req.body;

  if (!provider || !text) {
    res.status(400).json({ error: 'Missing required fields: provider and text' });
    return;
  }

  const activeApiKey = apiKey || (
    provider === 'elevenlabs' ? process.env.ELEVENLABS_API_KEY :
    provider === 'openai' ? process.env.OPENAI_API_KEY :
    provider === 'gcp' ? process.env.GCP_API_KEY : null
  );

  if (!activeApiKey && provider !== 'gcp') {
    res.status(400).json({ error: 'API key is required' });
    return;
  }

  try {
    if (provider === 'elevenlabs') {
      const voice = voiceId || '21m00Tcm4TlvDq8ikWAM';
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        res.status(response.status).json({ error: `ElevenLabs API error: ${errText}` });
        return;
      }

      const audioBuffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      res.status(200).send(Buffer.from(audioBuffer));
      return;
    }

    if (provider === 'openai') {
      const voice = voiceId || 'alloy';
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voice
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        res.status(response.status).json({ error: `OpenAI API error: ${errText}` });
        return;
      }

      const audioBuffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      res.status(200).send(Buffer.from(audioBuffer));
      return;
    }

    if (provider === 'gcp') {
      const isArabic = /[\u0600-\u06FF]/.test(text);
      const voiceName = voiceId || (isArabic ? 'ar-XA-Wavenet-A' : 'en-US-Journey-F');
      // Extract lang code dynamically from voice name (e.g. ar-SA, ar-AE, ar-XA)
      let langCode = 'en-US';
      if (voiceName.includes('-')) {
        const parts = voiceName.split('-');
        if (parts.length >= 2) {
          langCode = `${parts[0]}-${parts[1]}`;
        }
      } else if (isArabic) {
        langCode = 'ar-SA';
      }

      let response;
      let usedToken = false;

      const callGcpTts = async (authKeyOrToken: string, isToken: boolean) => {
        const url = isToken 
          ? 'https://texttospeech.googleapis.com/v1/text:synthesize' 
          : `https://texttospeech.googleapis.com/v1/text:synthesize?key=${authKeyOrToken}`;
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (isToken) {
          headers['Authorization'] = `Bearer ${authKeyOrToken}`;
        }

        return fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: { ssml: `<speak><prosody rate="0.92">${text}</prosody></speak>` },
            voice: { languageCode: langCode, name: voiceName },
            audioConfig: { audioEncoding: 'MP3' }
          })
        });
      };

      // 1. Try with active API Key if provided and not known to be bad
      if (activeApiKey && !badApiKeys.has(activeApiKey)) {
        try {
          response = await callGcpTts(activeApiKey, false);
          // If the API key is unauthorized or fails authentication, we trigger fallback to service account
          if (response.status === 401 || response.status === 403 || response.status === 400 || response.status === 429) {
            console.warn(`GCP API Key failed (${response.status}), marking as bad and attempting fallback to Service Account token...`);
            badApiKeys.add(activeApiKey);
            const token = await getGcpAccessToken();
            if (token) {
              response = await callGcpTts(token, true);
              usedToken = true;
            }
          }
        } catch (err) {
          console.warn('Failed to fetch with API key, marking as bad and attempting fallback to Service Account token:', err);
          badApiKeys.add(activeApiKey);
          const token = await getGcpAccessToken();
          if (token) {
            response = await callGcpTts(token, true);
            usedToken = true;
          }
        }
      }

      // 2. If no response yet (e.g. no API key was provided), fetch using Service Account token
      if (!response) {
        const token = await getGcpAccessToken();
        if (token) {
          response = await callGcpTts(token, true);
          usedToken = true;
        } else {
          res.status(400).json({ error: 'GCP API key is missing and metadata server is not available' });
          return;
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`GCP TTS API Error: Status ${response.status}, Details: ${errText}`);
        res.status(response.status).json({ error: `GCP API error (usedToken=${usedToken}): ${errText}` });
        return;
      }

      const json = await response.json();
      const audioBuffer = Buffer.from(json.audioContent, 'base64');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.status(200).send(audioBuffer);
      return;
    }

    res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (err: any) {
    console.error('Error in proxy TTS API:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
