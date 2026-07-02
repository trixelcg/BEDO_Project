import http from 'http';
import https from 'https';

// Cache metadata values to eliminate redundant network calls and reduce latency
let cachedProjectId: string | null = null;
let cachedRegion: string | null = null;
let cachedVertexToken: { token: string, expiresAt: number } | null = null;
const badApiKeys: Set<string> = new Set();

async function getGcpMetadata(path: string): Promise<string | null> {
  // Use cached values if available
  if (path === 'project/project-id' && cachedProjectId) return cachedProjectId;
  if (path === 'instance/region' && cachedRegion) return cachedRegion;

  try {
    const response = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
      headers: {
        'Metadata-Flavor': 'Google'
      }
    });
    if (response.ok) {
      const val = (await response.text()).trim();
      // Store in cache
      if (path === 'project/project-id') cachedProjectId = val;
      if (path === 'instance/region') cachedRegion = val;
      return val;
    }
  } catch (err) {
    // metadata server not available
  }
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { provider, apiKey, systemPrompt, modelName, userPrompt } = req.body;

  if (!provider || provider === 'none') {
    return res.status(400).json({ error: 'AI provider is disabled' });
  }

  const activeApiKey = apiKey || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

  if (!activeApiKey && provider !== 'gemini') {
    return res.status(400).json({ error: 'API key is required' });
  }

  try {
    let reply = '';

    if (provider === 'gemini') {
      const model = modelName || 'gemini-2.0-flash';
      
      const callGoogleAiStudio = async (key: string) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const payload = JSON.stringify({
          contents: [{
            parts: [{ text: userPrompt }]
          }],
          systemInstruction: {
            parts: [{ text: systemPrompt || 'أنت مساعد ذكي ولطيف تتحدث بالنيابة عن المنظمة وتجيب بإيجاز واختصار باللغة العربية.' }]
          },
          generationConfig: {
            maxOutputTokens: 200, // Keep responses short for voice TTS
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
        return makeHttpRequest(url, 'POST', { 'Content-Type': 'application/json' }, payload);
      };

      const callVertexAi = async () => {
        let accessToken = '';
        
        // Use cached token if valid (buffer of 60 seconds)
        if (cachedVertexToken && cachedVertexToken.expiresAt > Date.now() + 60000) {
          accessToken = cachedVertexToken.token;
        } else {
          // Fetch new token
          const tokenData = await getGcpMetadata('instance/service-accounts/default/token');
          if (!tokenData) {
            throw new Error('Metadata server token not available (not running on GCP)');
          }
          
          let tokenObj;
          try {
            tokenObj = JSON.parse(tokenData);
          } catch (e) {
            throw new Error('Failed to parse metadata token response');
          }
          
          accessToken = tokenObj.access_token;
          const expiresInMs = (tokenObj.expires_in || 3000) * 1000;
          cachedVertexToken = {
            token: accessToken,
            expiresAt: Date.now() + expiresInMs
          };
        }
        
        const projectId = await getGcpMetadata('project/project-id');
        const regionRaw = await getGcpMetadata('instance/region');
        const region = regionRaw ? regionRaw.split('/').pop() : 'us-central1';
        
        if (!projectId || !accessToken) {
          throw new Error('Could not retrieve Project ID or Access Token from metadata server');
        }
        
        const vertexModel = model.includes('2.5-pro') ? 'gemini-2.5-pro'
          : (model.includes('flash-lite') ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash');
        console.log(`Using Vertex AI Gemini fallback: model=${vertexModel}, projectId=${projectId}, region=${region}`);
        
        const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${vertexModel}:generateContent`;
        const payload = JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: userPrompt }]
          }],
          systemInstruction: {
            parts: [{ text: systemPrompt || 'أنت مساعد ذكي ولطيف تتحدث بالنيابة عن المنظمة وتجيب بإيجاز واختصار باللغة العربية.' }]
          },
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 }
          }
        });
        
        return makeHttpRequest(url, 'POST', {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }, payload);
      };

      // Try Google AI Studio first if API key is present and not known to be bad
      if (activeApiKey && !badApiKeys.has(activeApiKey)) {
        try {
          reply = await callGoogleAiStudio(activeApiKey);
        } catch (err: any) {
          console.warn('Google AI Studio request failed, marking key as bad and attempting fallback to GCP Vertex AI Service Account:', err.message);
          badApiKeys.add(activeApiKey);
          try {
            reply = await callVertexAi();
          } catch (fallbackErr: any) {
            console.error('Vertex AI fallback also failed:', fallbackErr.message);
            throw new Error(`Google AI Studio failed (${err.message}) and Vertex AI fallback failed (${fallbackErr.message})`);
          }
        }
      } else {
        // No key or key is bad, go straight to Vertex AI
        try {
          reply = await callVertexAi();
        } catch (err: any) {
          console.error('Vertex AI request failed:', err.message);
          throw new Error('API key is missing/bad and Vertex AI call failed: ' + err.message);
        }
      }

      const data = JSON.parse(reply);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        throw new Error(data.error?.message || 'Empty response from Gemini API');
      }

      return res.status(200).json({ reply: text.trim() });
      
    } else if (provider === 'openai') {
      const model = modelName || 'gpt-4o-mini';
      const url = 'https://api.openai.com/v1/chat/completions';

      const payload = JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt || 'أنت مساعد ذكي ولطيف تتحدث بالنيابة عن المنظمة وتجيب بإيجاز واختصار باللغة العربية.' },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      const responseStr = await makeHttpRequest(url, 'POST', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeApiKey}`
      }, payload);
      
      const data = JSON.parse(responseStr);
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error(data.error?.message || 'Empty response from OpenAI API');
      }

      return res.status(200).json({ reply: text.trim() });
    }

    throw new Error('Unsupported AI provider');

  } catch (err: any) {
    console.error('AI chat endpoint error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate response' });
  }
}

// Helper to make HTTPS requests using standard Node libraries (no extra dependencies)
function makeHttpRequest(url: string, method: string, headers: Record<string, string>, payload?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        ...headers,
        'Content-Length': payload ? Buffer.byteLength(payload) : 0
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
