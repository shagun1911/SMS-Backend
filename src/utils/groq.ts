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
    const configuredModel = config.groq?.model || 'llama-3.3-70b-versatile';
    const fallbackModels = ['llama-3.3-70b-versatile', 'llama3-70b-8192'];
    const messages: { role: string; content: string }[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    messages.push({ role: 'user', content: prompt });

    const callGroq = async (model: string): Promise<{ ok: boolean; status: number; data: any }> => {
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
        return { ok: res.ok, status: res.status, data };
    };

    try {
        let model = configuredModel;
        let result = await callGroq(model);

        if (!result.ok && result.status === 404) {
            const firstAvailable = fallbackModels.find((m) => m !== configuredModel) || configuredModel;
            model = firstAvailable;
            result = await callGroq(model);
        }

        if (!result.ok) {
            console.error('[Groq]', result.status, result.data?.error?.message ?? result.data);
            return null;
        }

        const text = result.data?.choices?.[0]?.message?.content;
        if (typeof text === 'string') return text.trim();
        return null;
    } catch (err: any) {
        console.error('[Groq]', err?.message ?? err);
        return null;
    }
}
