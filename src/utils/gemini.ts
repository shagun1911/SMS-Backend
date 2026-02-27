import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config';
import { generateWithGroq } from './groq';

const MAX_OUTPUT_TOKENS = 1024;

/** Fallback models when primary returns 429/404. Only valid models here. */
const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
    if (!config.gemini.apiKey) return null;
    if (!genAI) genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    return genAI;
}

function parseResponse(response: any): string | null {
    if (!response) return null;
    const candidate = response.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0];
    if (textPart?.text) return String(textPart.text).trim();
    if (response.promptFeedback?.blockReason) return null;
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') return null;
    try {
        const text = response.text?.();
        if (text) return String(text).trim();
    } catch {
        // ignore
    }
    return null;
}

function quotaExhaustedMessage(msg: string): string {
    if (/limit:\s*0/i.test(msg)) {
        return "Free tier quota is 0 for this model. Try setting GEMINI_MODEL=gemini-1.5-flash or gemini-1.0-pro in server .env and restart. Or wait for daily reset (midnight Pacific).";
    }
    return "You've hit the free tier limit. Wait about a minute and try again. See ai.google.dev/gemini-api/docs/rate-limits.";
}

/**
 * Call Gemini with a specific model id. Returns text or throws.
 */
async function generateWithModel(
    client: GoogleGenerativeAI,
    modelId: string,
    fullPrompt: string
): Promise<string> {
    const model = client.getGenerativeModel({
        model: modelId,
        generationConfig: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: 0.4,
        },
    });
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = parseResponse(response);
    if (text) return text;
    if (response?.promptFeedback?.blockReason) {
        throw new Error('Prompt blocked');
    }
    return 'I could not generate a response. Please try again.';
}

/**
 * Generate a response from Gemini. Tries primary model, then fallbacks on 429 limit:0.
 */
export async function generateWithGemini(prompt: string, systemInstruction?: string): Promise<string> {
    const client = getClient();
    if (!client) {
        return 'AI assistant is not configured. Please set GEMINI_API_KEY in environment.';
    }
    const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
    const modelsToTry = [config.gemini.model, ...FALLBACK_MODELS.filter((m) => m !== config.gemini.model)];
    console.log('[Gemini] prompt length (chars):', fullPrompt.length, '| trying model:', modelsToTry[0]);

    for (const modelId of modelsToTry) {
        try {
            const text = await generateWithModel(client, modelId, fullPrompt);
            if (modelId !== config.gemini.model) console.log('[Gemini] succeeded with fallback model:', modelId);
            return text;
        } catch (err: any) {
            const msg = err?.message || String(err);
            const status = err?.status ?? err?.response?.status ?? err?.statusCode;
            const is429 = status === 429 || /quota|rate limit|resource exhausted|too many requests/i.test(msg);
            const isLimitZero = /limit:\s*0/i.test(msg);
            const is404 = status === 404 || /not found|model.*not supported/i.test(msg);
            const hasNext = modelId !== modelsToTry[modelsToTry.length - 1];

            if (hasNext && ((is429 && isLimitZero) || is404)) {
                const next = modelsToTry[modelsToTry.indexOf(modelId) + 1];
                console.log('[Gemini]', is404 ? '404' : '429 limit:0', 'for', modelId, '→ retrying with', next);
                continue;
            }

            console.error('[Gemini]', status, msg);
            if (is429) {
                const groqText = await generateWithGroq(prompt, systemInstruction);
                if (groqText) {
                    console.log('[AI] Gemini limit reached → used Groq');
                    return groqText;
                }
                return quotaExhaustedMessage(msg);
            }
            if (status === 403 || /api key|invalid key|permission|forbidden/i.test(msg)) {
                return 'AI is not configured or the API key is invalid. Set GEMINI_API_KEY in server .env.';
            }
            if (status === 400 || /bad request|invalid argument/i.test(msg)) {
                return 'The request could not be processed. Please rephrase and try again.';
            }
            if (is404) {
                return 'Model not available for this key. In server .env set GEMINI_MODEL=gemini-3-flash-preview or gemini-2.0-flash (see ai.google.dev/gemini-api/docs/models for current names).';
            }
            if (/valid Part|blocked|safety|content.*filter/i.test(msg)) {
                return 'The response was filtered. Please try rephrasing your question.';
            }
            return 'Sorry, I could not process your request right now. Please try again in a moment.';
        }
    }

    const groqText = await generateWithGroq(prompt, systemInstruction);
    if (groqText) {
        console.log('[AI] Gemini limit reached → used Groq');
        return groqText;
    }
    return quotaExhaustedMessage('limit: 0');
}
