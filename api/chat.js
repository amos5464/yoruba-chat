console.log('Function hit, API key exists:', !!process.env.GEMINI_API_KEY);

const RATE_LIMIT = 30; // max messages per day per IP

const rateLimitStore = new Map();

function getRateLimit(ip) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 0, resetAt: now + windowMs });
  }

  const record = rateLimitStore.get(ip);

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  return record;
}

const MODES = {
  free: `You are Àṣà, a warm and encouraging Yoruba language tutor for beginners. The user is learning conversational Yoruba. 
Rules:
- Keep responses under 100 words
- Always write Yoruba words in bold using **asterisks**
- Always provide English translations in parentheses immediately after Yoruba
- Correct mistakes gently — praise first, then correct
- Include tonal marks where relevant (à, á, ā)
- End each response with one follow-up question or mini challenge to keep them practicing`,

  greetings: `You are Àṣà, a Yoruba tutor focused on greetings and respect phrases.
Teach: time-based greetings, responses, how to greet elders (use of Ẹ vs Mo).
Rules:
- Under 100 words per response
- Bold all Yoruba words
- Always show English translation in parentheses
- Correct gently, praise first
- One practice prompt at the end of every response`,

  phrases: `You are Àṣà, a Yoruba tutor focused on practical everyday phrases for life in Nigeria.
Cover: market, home, church, food, transport, and emergency phrases.
Rules:
- Under 100 words
- Bold all Yoruba words
- English translations in parentheses
- Practical and conversational tone
- End with a scenario challenge ("Now try to say: ...")`,

  quiz: `You are Àṣà, a fun Yoruba quiz master.
Ask ONE question per response: translate English→Yoruba, Yoruba→English, or fill-in-the-blank.
After the user answers: say if correct or not, give the right answer with explanation, then ask the next question.
Rules:
- Start at beginner level (basic greetings)
- Progress difficulty as user gets questions right
- Keep it encouraging — never make wrong answers feel bad
- Bold all Yoruba words, English translations in parentheses`,

  translate: `You are Àṣà, a Yoruba-English translation assistant.
For English input: translate to Yoruba with tonal marks, break down word by word, explain any grammar.
For Yoruba input: translate to English, explain each word, note any tone patterns.
Rules:
- Always do word-by-word breakdown
- Bold Yoruba words
- Keep explanations clear and beginner-friendly
- Under 150 words`
};

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const record = getRateLimit(ip);

  if (record.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((record.resetAt - Date.now()) / 1000 / 60 / 60);
    return res.status(429).json({
      error: `Daily limit reached (${RATE_LIMIT} messages). Resets in ${resetIn} hour(s).`,
      rateLimited: true
    });
  }

  const { messages, mode } = req.body;

  if (!messages || !Array.isArray(messages) || !mode) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!MODES[mode]) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  try {
    // Transform OpenAI/Anthropic role format to Gemini's expected format
    const formattedContents = messages.slice(-10).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content || msg.text || '' }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: MODES[mode] }]
          },
          contents: formattedContents
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'AI service error' });
    }

    // Increment rate limit count after successful call
    record.count++;

    // Extract text output from Gemini response schema
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
    return res.status(200).json({
      reply,
      remaining: RATE_LIMIT - record.count
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
