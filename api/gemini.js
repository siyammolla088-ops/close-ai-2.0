export const config = { runtime: 'edge' };

// দৈনিক Google Search লিমিট (তোমার পছন্দ অনুসারে 100 রাখলাম)
const DAILY_SEARCH_LIMIT = 100;

async function checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey) {
  const today = new Date().toISOString().slice(0, 10);
  
  try {
    const checkUrl = `\( {supabaseUrl}/rest/v1/search_usage?usage_date=eq. \){today}`;
    const res = await fetch(checkUrl, {
      headers: { 
        'apikey': supabaseServiceKey, 
        'Authorization': `Bearer ${supabaseServiceKey}` 
      }
    });
    
    const rows = await res.json();
    let currentCount = 0;

    if (Array.isArray(rows) && rows.length > 0) {
      currentCount = parseInt(rows[0].count, 10) || 0;
    }
    
    if (currentCount >= DAILY_SEARCH_LIMIT) {
      console.log(`[Search Limit] Daily limit reached (\( {currentCount}/ \){DAILY_SEARCH_LIMIT})`);
      return false;
    }

    const upsertUrl = `${supabaseUrl}/rest/v1/search_usage`;
    await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates, return=minimal'
      },
      body: JSON.stringify({ 
        usage_date: today, 
        count: currentCount + 1 
      })
    });

    return true;
  } catch (e) {
    console.error('Supabase Tracking Error:', e);
    return true; // এরর হলেও চালিয়ে যাবে
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'generate'; 

  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'GEMINI_API_KEY missing' } }), { status: 500 });
  }

  let jsonBody;
  try {
    jsonBody = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON' } }), { status: 400 });
  }

  // Google Search লিমিট চেক + টুল যোগ করা
  if (supabaseUrl && supabaseServiceKey) {
    const canSearch = await checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey);
    if (canSearch) {
      jsonBody.tools = [{ googleSearch: {} }];
    } else {
      delete jsonBody.tools;
    }
  }

  // ==================== মডেল ====================
  const model = 'gemini-2.5-flash';           // এখন 2.5 Flash ব্যবহার করছো
  // const model = 'gemini-3.0-flash-preview-0625';  // পরে Gemini 3 ব্যবহার করতে চাইলে এটা চালু করো

  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/\( {model}: \){endpoint}?key=\( {apiKey} \){mode === 'stream' ? '&alt=sse' : ''}`;

  try {
    const geminiRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API Error:", errText);
      return new Response(errText, { 
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return geminiRes;

  } catch (error) {
    console.error("Proxy Error:", error);
    return new Response(JSON.stringify({ error: { message: 'Proxy error: ' + error.message } }), { status: 500 });
  }
}
