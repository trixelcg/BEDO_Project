import http from 'http';
import https from 'https';

export default async function handler(req: any, res: any) {
  const urlParam = req.query.url;

  if (!urlParam) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    let targetUrl = decodeURIComponent(urlParam);
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    console.log(`Crawling URL: ${targetUrl}`);
    const html = await fetchHtml(targetUrl);
    
    // Clean up the HTML to get clean text
    const cleanText = extractCleanText(html);

    return res.status(200).json({ 
      success: true, 
      url: targetUrl,
      text: cleanText 
    });

  } catch (err: any) {
    console.error('Scraper/Crawler error:', err);
    return res.status(500).json({ error: `Scraping failed: ${err.message}` });
  }
}

// Helper to fetch HTML from a URL, supporting redirects (up to 3 levels)
function fetchHtml(url: string, depth = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (depth > 3) {
      reject(new Error('Too many redirects'));
      return;
    }

    const client = url.startsWith('https') ? https : http;
    
    // Set user agent so websites don't block us as a bot
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };

    client.get(url, options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const originalUrl = new URL(url);
          redirectUrl = originalUrl.origin + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
        }
        resolve(fetchHtml(redirectUrl, depth + 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Server returned status code ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Regular expressions to clean up HTML tags, script, and style blocks
function extractCleanText(html: string): string {
  if (!html) return '';

  let text = html;

  // 1. Remove script and style blocks entirely
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, ''); // Comments

  // 2. Extract core text tags or just strip all html tags
  // Replace block tags with newlines so text doesn't merge
  text = text.replace(/<\/p>|<\/div>|<\/h1>|<\/h2>|<\/h3>|<\/h4>|<\/li>|<\/tr>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' '); // Strip all tags

  // 3. Clean up spacing and HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"');

  // 4. Reduce whitespace
  const lines = text.split('\n');
  const cleanLines = lines
    .map(line => line.trim())
    .filter(line => line.length > 5) // Skip very short header text or layout labels
    .slice(0, 150); // limit length to fit system prompt limits

  return cleanLines.join('\n').substring(0, 4000); // Max 4000 characters
}
