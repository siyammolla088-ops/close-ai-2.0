export const config = { runtime: 'edge' };

// আপনার চাহিদা অনুযায়ী ডেইলি সার্চ লিমিট ২৫০ করা হলো
const DAILY_SEARCH_LIMIT = 250; 

async function checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const checkUrl = `${supabaseUrl}/rest/v1/search_usage?usage_date=eq.${today}`;
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
      console.log(`[Search Limit] Daily limit reached (${currentCount}).`);
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
      body: JSON.stringify({ usage_date: today, count: currentCount + 1 })
    });

    return true; 
  } catch (e) {
    console.error('Supabase Tracking Error:', e);
    return true; 
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

  // 🤖 স্মার্ট অটো-সার্চ লজিক: 
  // ফ্রন্টএন্ড থেকে tools পাঠানোর দরকার নেই, ব্যাকএন্ড নিজেই Gemini-কে সার্চ করতে বলবে
  if (supabaseUrl && supabaseServiceKey) {
    const canSearch = await checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey);
    if (canSearch) {
      // এআই নিজেই প্রম্পট বুঝে ডিসাইড করবে কখন সার্চ লাগবে (কোনো কি-ওয়ার্ড লাগবে না)
      jsonBody.tools = [{ googleSearch: {} }]; 
    } else {
      delete jsonBody.tools;
    }
  }

  // Gemini 1.5 বা 2.5 বা আপনার কাঙ্ক্ষিত মডেল এখানে দিন (যেমন: gemini-2.5-flash)
  const model = 'gemini-2.5-flash';
  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${mode === 'stream' ? '&alt=sse' : ''}`;

  try {
    const geminiRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonBody)
    });

    // Edge Runtime-এ সেফলি স্ট্রিম পাস করার স্ট্যান্ডার্ড পদ্ধতি
    const { printable, writable } = new TransformStream();
    geminiRes.body.pipeTo(writable);

    return new Response(printable, {
      status: geminiRes.status,
      headers: {
        'Content-Type': mode === 'stream' ? 'text/event-stream' : 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: { message: error.message } }), { status: 500 });
  }
}
