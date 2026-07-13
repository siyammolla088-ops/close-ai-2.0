// এই ফাইলটা আপনার প্রজেক্টের রুটে "api" ফোল্ডারের ভেতরে "gemini.js" নামে রাখতে হবে।
// Vercel এটা স্বয়ংক্রিয়ভাবে /api/gemini নামে একটা সার্ভারলেস এন্ডপয়েন্ট বানিয়ে দেবে।
// আপনার Gemini API key এখানে কখনো ক্লায়েন্ট (ব্রাউজার) পর্যন্ত পৌঁছাবে না।

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'generate'; // 'stream' অথবা 'generate'

  // ⚠️ Vercel Dashboard → Settings → Environment Variables এ গিয়ে
  // GEMINI_API_KEY নামে একটা ভ্যারিয়েবল যোগ করুন, ভ্যালুতে আপনার আসল Gemini API key বসান
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'সার্ভারে GEMINI_API_KEY সেট করা নেই। Vercel Environment Variables এ যোগ করুন।' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const model = 'gemini-3-flash-preview';
  const endpoint = mode === 'stream' ? 'streamGenerateContent' : 'generateContent';
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${mode === 'stream' ? '&alt=sse' : ''}`;

  const body = await req.text();

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
  });
}
