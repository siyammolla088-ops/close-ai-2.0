// api/gemini.js
export const config = { runtime: 'edge' };

const DAILY_SEARCH_LIMIT = 1400; // ১৫০০ ফ্রি লিমিটের মধ্যে বাফারসহ ১৪০০ সেট করা

// Supabase-এ সার্চ কাউন্ট চেক এবং আপডেট করার ফাংশন
async function checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey) {
  const today = new Date().toISOString().slice(0, 10);
  
  try {
    // ১. Supabase থেকে আজকের দিনের সার্চ কাউন্ট চেক করা
    const checkUrl = `${supabaseUrl}/rest/v1/search_usage?usage_date=eq.${today}`;
    const res = await fetch(checkUrl, {
      headers: { 
        'apikey': supabaseServiceKey, 
        'Authorization': `Bearer ${supabaseServiceKey}` 
      }
    });
    
    const rows = await res.json();
    
    // ডেটাবেজ থেকে পাওয়া কাউন্টকে সেফলি নাম্বারে কনভার্ট করা
    let currentCount = 0;
    if (Array.isArray(rows) && rows.length > 0) {
      currentCount = parseInt(rows[0].count, 10) || 0;
    }
    
    // লিমিট ১৪০০ পার হয়ে গেলে false রিটার্ন করবে (সার্চ বন্ধের সংকেত)
    if (currentCount >= DAILY_SEARCH_LIMIT) {
      console.log(`[Search Limit] Daily limit reached (${currentCount}). Turning off Google Search.`);
      return false; 
    }

    // ২. লিমিট পার না হলে কাউন্টার ১ বাড়িয়ে ডেটাবেজে Upsert করা
    // PostgREST এ সঠিক Upsert এর জন্য on_conflict হিসেবে প্রাইমারি কি (usage_date) বলে দেওয়া হলো
    const upsertUrl = `${supabaseUrl}/rest/v1/search_usage`;
    await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates, return=minimal' // ডুপ্লিকেট হলে ওভাররাইট/মার্জ করবে
      },
      body: JSON.stringify({ 
        usage_date: today, 
        count: currentCount + 1 
      })
    });

    return true; // সার্চ করার অনুমতি দেওয়া হলো
  } catch (e) {
    console.error('Supabase Tracking Error:', e);
    return true; // কোনো কারণে ডেটাবেজে এরর হলেও অ্যাপ যেন ক্র্যাশ না করে সার্চ করতে দেয়
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'generate'; 

  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'সার্ভারে GEMINI_API_KEY সেট করা নেই।' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawBody = await req.text();
  let jsonBody;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch (e) {
    jsonBody = null;
  }

  // যদি রিকোয়েস্টে লাইভ সার্চ (google_search) অন থাকে, তবেই কাউন্টার চেক হবে
  if (jsonBody && supabaseUrl && supabaseServiceKey) {
    const hasSearchTool = jsonBody.tools && jsonBody.tools.some(t => t.google_search || t.googleSearch);
    
    if (hasSearchTool) {
      const canSearch = await checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey);
      
      // লিমিট শেষ হয়ে গেলে রিকোয়েস্ট থেকে 'tools' অপশনটি মুছে সাধারণ টেক্সট রিকোয়েস্ট পাঠানো হবে
      if (!canSearch) {
        delete jsonBody.tools; 
      }
    }
  }

  // মডেল নাম এবং এন্ডপয়েন্ট সেটআপ
  const model = 'gemini-2.5-flash';
  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${mode === 'stream' ? '&alt=sse' : ''}`;

  const finalBody = jsonBody ? JSON.stringify(jsonBody) : rawBody;

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: finalBody
    });

    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: { message: 'Gemini API তে রিকোয়েস্ট পাঠাতে সমস্যা হয়েছে।' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}      },
      body: JSON.stringify({ usage_date: today, count: currentCount + 1 })
    });

    return true; // সার্চ করার অনুমতি দেওয়া হলো
  } catch (e) {
    console.error('Supabase Tracking Error:', e);
    return true; // কোনো কারণে ডেটাবেজে এরর হলেও অ্যাপ যেন ক্র্যাশ না করে
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'generate'; 

  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'সার্ভারে GEMINI_API_KEY সেট করা নেই।' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawBody = await req.text();
  let jsonBody;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch (e) {
    jsonBody = null;
  }

  // যদি রিকোয়েস্টে লাইভ সার্চ (google_search) অন থাকে, তবেই কাউন্টার চেক হবে
  if (jsonBody && supabaseUrl && supabaseServiceKey) {
    const hasSearchTool = jsonBody.tools && jsonBody.tools.some(t => t.google_search || t.googleSearch);
    
    if (hasSearchTool) {
      const canSearch = await checkAndIncrementSearchUsage(supabaseUrl, supabaseServiceKey);
      
      // লিমিট শেষ হয়ে গেলে রিকোয়েস্ট থেকে 'tools' অপশনটি মুছে সাধারণ টেক্সট রিকোয়েস্ট পাঠানো হবে
      if (!canSearch) {
        delete jsonBody.tools; 
      }
    }
  }

  const model = 'gemini-2.5-flash';
  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${mode === 'stream' ? '&alt=sse' : ''}`;

  const finalBody = jsonBody ? JSON.stringify(jsonBody) : rawBody;

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: finalBody
  });

  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
  });
}
