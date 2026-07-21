export const config = { runtime: 'edge' };

// দৈনিক সার্চ লিমিট ২৫০
const DAILY_SEARCH_LIMIT = 100; 

async function checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    // ১. প্রথমে আজকের দিনের ডেটা চেক করা হচ্ছে
    const checkUrl = `${supabaseUrl}/rest/v1/search_usage?usage_date=eq.${today}`;
    const res = await fetch(checkUrl, {
      headers: { 
        'apikey': supabaseServiceKey, 
        'Authorization': `Bearer ${supabaseServiceKey}` 
      }
    });
    
    const rows = await res.json();
    let currentCount = 0;
    let hasRow = false;

    if (Array.isArray(rows) && rows.length > 0) {
      currentCount = parseInt(rows[0].count, 10) || 0;
      hasRow = true;
    }
    
    // লিমিট ক্রস হলে সার্চ বন্ধ
    if (currentCount >= DAILY_SEARCH_LIMIT) {
      console.log(`[Search Limit] Daily limit reached (${currentCount}).`);
      return false; 
    }

    // ২. ডেটাবেজে কাউন্ট ১ বাড়িয়ে সেভ বা আপডেট করা হচ্ছে
    const upsertUrl = `${supabaseUrl}/rest/v1/search_usage`;
    await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        // merge-duplicates কাজ করার জন্য টেবিলে 'usage_date' কে PRIMARY KEY হতে হবে
        'Prefer': 'resolution=merge-duplicates, return=minimal' 
      },
      body: JSON.stringify({ usage_date: today, count: currentCount + 1 })
    });

    return true; 
  } catch (e) {
    console.error('Supabase Tracking Error:', e);
    return true; // এরর হলেও ইউজার যেন এআই রেসপন্স পায়, তাই true রিটার্ন করা হচ্ছে
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

  // 🤖 স্মার্ট অটো-সার্চ লজিক
  if (supabaseUrl && supabaseServiceKey) {
    const canSearch = await checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey);
    if (canSearch) {
      jsonBody.tools = [{ googleSearch: {} }]; 
    } else {
      // লিমিট শেষ হলে রিকোয়েস্ট থেকে tools অবজেক্টটি ডিলিট করে দেওয়া হবে
      delete jsonBody.tools;
    }
  }

  // Gemini মডেল এবং এন্ডপয়েন্ট সেটআপ
  const model = '​gemini-2.5-flash';
  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${mode === 'stream' ? '&alt=sse' : ''}`;

  try {
    const geminiRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(errText, { status: geminiRes.status, headers: { 'Content-Type': 'application/json' } });
    }

    // ✅ এখানে `printable` পরিবর্তন করে `readable` করা হয়েছে (মূল বাগ ফিক্স)
    const { readable, writable } = new TransformStream();
    geminiRes.body.pipeTo(writable);

    return new Response(readable, {
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
