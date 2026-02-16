import config from '../config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 1024;

/**
 * Call Groq API (fallback when Gemini hits rate limit). Returns response text or null on failure.
 */
export async function generateWithGroq(
    prompt: string,
    systemInstruction?: string
): Promise<string | null> {
    const apiKey = config.groq?.apiKey;
    if (!apiKey) return null;
    const model = config.groq?.model || 'llama-3.3-70b-versatile';
    const messages: { role: string; content: string }[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    messages.push({ role: 'user', content: prompt });

    try {
        const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.4,
                max_tokens: MAX_TOKENS,
            }),
        });
        const data = (await res.json()) as any;
        if (!res.ok) {
            console.error('[Groq]', res.status, data?.error?.message ?? data);
            return null;
        }
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text === 'string') return text.trim();
        return null;
    } catch (err: any) {
        console.error('[Groq]', err?.message ?? err);
        return null;
    }
}
