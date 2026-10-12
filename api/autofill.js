// POST /api/autofill  { url, categories: [names] }  ->  suggested gear fields
// Auth: Bearer <Supabase access token>; caller must be on the admins list.
// Env: ANTHROPIC_API_KEY (Vercel project settings).
const SUPABASE_URL = 'https://domzsdxeencwxyblsptm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvbXpzZHhlZW5jd3h5YmxzcHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NTU3NTcsImV4cCI6MjEwNzIzMTc1N30.Ipf9JTyhX6ixd5_aCmmhd8eZ78MHSJHGhSju9dGAP3c';
const MODEL = 'claude-haiku-5-5';

async function isAdmin(token) {
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/admins?select=email`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0; // RLS only returns rows to admins
}

function pageDigest(html, url) {
  const pick = re => { const m = html.match(re); return m ? m[1] : ''; };
  const metas = [...html.matchAll(/<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)]
    .filter(m => /^(og:|product:|twitter:|description)/i.test(m[1])).map(m => `${m[1]}: ${m[2]}`).slice(0, 40).join('\n');
  const jsonld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).join('\n').slice(0, 15000);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 20000);
  return `URL: ${url}\nTITLE: ${pick(/<title[^>]*>([\s\S]*?)<\/title>/i).trim()}\n\nMETA:\n${metas}\n\nJSON-LD:\n${jsonld}\n\nPAGE TEXT:\n${text}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(token))) return res.status(401).json({ error: 'Not signed in as an admin.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const url = String(body.url || '').trim();
  const categories = Array.isArray(body.categories) ? body.categories.slice(0, 50).map(String) : [];
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Paste a full product link (https://…).' });

  let html = '';
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', 'Accept-Language': 'en-CA,en;q=0.9' }, signal: AbortSignal.timeout(12000) });
    html = await r.text();
    if (!r.ok && html.length < 500) return res.status(502).json({ error: `The store returned ${r.status}. Fill this one in by hand.` });
  } catch (e) {
    return res.status(502).json({ error: 'Could not load that page. The store may block automated requests.' });
  }

  const prompt = `You extract product data for an emergency-preparedness gear catalog.
Existing capability categories: ${categories.map(c => `"${c}"`).join(', ') || '(none)'}.

From the product page below, return ONLY a JSON object with these keys:
- "name": product name as sold (short, no store name)
- "description": one plain sentence on what it is and why it matters in a kit (max 140 chars)
- "source": the store's domain, e.g. "pelican.com"
- "price": current price as a number (sale price if on sale), or null if not shown
- "currency": "CAD" or "USD" — the currency the page shows
- "price_est": true if you are unsure of the price
- "category": the best-fitting existing category name exactly as written; if none fit, a short new category name
- "category_is_new": true if category is not in the existing list
- "volume_l": estimated packed volume in litres (number, 2 decimals max) from dimensions if given, else your best estimate
- "capacity_l": internal capacity in litres if it is a case/bag/container, else null
- "image": absolute URL of the main product image (prefer og:image), or null

PAGE:
${pageDigest(html, url)}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.AUTOFILL_MODEL || MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'AI request failed.' });
    const text = (data.content || []).map(b => b.text || '').join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    json.url = url;
    return res.status(200).json(json);
  } catch (e) {
    return res.status(502).json({ error: 'Could not read the AI response. Try again or fill by hand.' });
  }
};
