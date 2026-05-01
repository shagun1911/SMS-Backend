import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config';
// @ts-ignore
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import QuestionBank from '../models/questionBank.model';
import TopicWeightage from '../models/topicWeightage.model';
import { getSyllabusByClassAndExam } from '../data/syllabusCatalog';
import { getRedisClient, isRedisAvailable } from '../config/redis';

// ─── Public types (unchanged surface) ────────────────────────────────────────

export type QuestionType = 'objective' | 'subjective' | 'mixed';
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'mixed';
export type TargetExam = 'boards' | 'jee' | 'neet' | 'school' | string;
export type SeniorTrack = 'boards' | 'competitive';
export type ExamPattern = 'pyq' | 'conceptual' | 'mixed';
export type CoachingStyle = 'allen' | 'fiitjee' | 'aakash';

export interface TeacherQuestion {
    question: string;
    type: 'objective' | 'subjective';
    difficulty: 'easy' | 'medium' | 'hard';
    options?: string[];
    answer?: string;
    marks?: number;
}

export interface GenerateTestPaperInput {
    schoolId?: string;
    schoolName?: string;
    className: string;
    subject: string;
    chapter: string;
    chapters?: string[];
    topicsByChapter?: Record<string, string[]>;
    includeWholeChapter: boolean;
    topics?: string;
    questionType: QuestionType;
    difficultyLevel: DifficultyLevel;
    /** Strict percentage distribution e.g. {easy:30, medium:50, hard:20} */
    difficultyDistribution?: { easy: number; medium: number; hard: number };
    /** Strict percentage distribution e.g. {objective:40, subjective:60} */
    typeDistribution?: { objective: number; subjective: number };
    /** Pre-supplied teacher questions — included first, count is deducted from LLM target */
    teacherQuestions?: TeacherQuestion[];
    questionCount: number;
    targetExam: TargetExam;
    seniorTrack?: SeniorTrack;
    examPattern?: ExamPattern;
    coachingStyles?: CoachingStyle[];
    includePreviousYear: boolean;
    prioritizeRepeated: boolean;
    durationMinutes?: number;
    marksPerQuestion?: number;
    specialInstructions?: string;
}

export interface GeneratedQuestion {
    questionNumber: number;
    question: string;
    type: 'objective' | 'subjective';
    difficulty: 'easy' | 'medium' | 'hard';
    marks: number;
    options?: string[];
    answerKey?: string;
    solution?: string;
    provider?: "gemini" | "groq";
}

export interface GeneratedTestPaper {
    title: string;
    meta: {
        className: string;
        subject: string;
        chapter: string;
        targetExam: string;
        questionType: QuestionType;
        difficultyLevel: DifficultyLevel;
        totalQuestions: number;
        totalMarks: number;
        durationMinutes: number;
    };
    instructions: string[];
    questions: GeneratedQuestion[];
    sections?: Array<{ type: 'objective' | 'subjective'; questions: GeneratedQuestion[] }>;
}

export interface TestPaperMeta {
    subjects: string[];
    targetExamOptions: TargetExam[];
    chapters: string[];
    topicsByChapter: Record<string, string[]>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cleanText(text: string): string {
    return String(text || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizedHash(text: string): string {
    return crypto
        .createHash('sha256')
        .update(text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim())
        .digest('hex');
}

function isLowQuality(q: { question?: string; options?: string[] }): boolean {
    const t = cleanText(q.question || '');
    if (!t || t.length < 20) return true;
    if (/mcq question\s*\d+\s*for class/i.test(t)) return true;
    if (/^question\s*\d+$/i.test(t)) return true;
    return false;
}

// ─── Bucket calculation ───────────────────────────────────────────────────────

interface Bucket {
    difficulty: 'easy' | 'medium' | 'hard';
    type: 'objective' | 'subjective';
    count: number;
}

function resolveDifficultyPct(
    input: GenerateTestPaperInput
): { easy: number; medium: number; hard: number } {
    if (input.difficultyDistribution) {
        const { easy, medium, hard } = input.difficultyDistribution;
        return { easy, medium, hard };
    }
    // map legacy difficultyLevel
    if (input.difficultyLevel === 'easy') return { easy: 100, medium: 0, hard: 0 };
    if (input.difficultyLevel === 'medium') return { easy: 0, medium: 100, hard: 0 };
    if (input.difficultyLevel === 'hard') return { easy: 0, medium: 0, hard: 100 };
    return { easy: 30, medium: 50, hard: 20 }; // mixed default
}

function resolveTypePct(
    input: GenerateTestPaperInput
): { objective: number; subjective: number } {
    if (input.typeDistribution) return input.typeDistribution;
    if (input.questionType === 'objective') return { objective: 100, subjective: 0 };
    if (input.questionType === 'subjective') return { objective: 0, subjective: 100 };
    return { objective: 50, subjective: 50 }; // mixed default
}

function buildBuckets(total: number, input: GenerateTestPaperInput): Bucket[] {
    const dp = resolveDifficultyPct(input);
    const tp = resolveTypePct(input);

    const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];
    const types: Array<'objective' | 'subjective'> = ['objective', 'subjective'];

    const buckets: Bucket[] = [];
    let assigned = 0;
    let maxBucket: Bucket | null = null;

    for (const diff of difficulties) {
        const diffPct = dp[diff] / 100;
        if (diffPct === 0) continue;
        for (const type of types) {
            const typePct = tp[type] / 100;
            if (typePct === 0) continue;
            const count = Math.round(total * diffPct * typePct);
            if (count === 0) continue;
            const b: Bucket = { difficulty: diff, type, count };
            buckets.push(b);
            assigned += count;
            if (!maxBucket || count > maxBucket.count) maxBucket = b;
        }
    }

    // Fix rounding error on the largest bucket
    if (maxBucket && assigned !== total) {
        maxBucket.count += total - assigned;
    }

    // Split buckets into max 10 questions per call to limit LLM pressure
    const finalBuckets: Bucket[] = [];
    for (const b of buckets) {
        if (b.count <= 0) continue;
        let remaining = b.count;
        while (remaining > 10) {
            finalBuckets.push({ ...b, count: 10 });
            remaining -= 10;
        }
        if (remaining > 0) finalBuckets.push({ ...b, count: remaining });
    }

    return finalBuckets;
}

import { generateWithGroq } from '../utils/groq';

// ─── Gemini with high token limit for test paper ──────────────────────────────
type GeminiKey = {
    key: string;
    lastFailureAt: number;
    cooldownUntil: number;
    index: number;
    client: GoogleGenerativeAI;
};

let geminiPool: GeminiKey[] = [];

function initGeminiPool() {
    if (geminiPool.length > 0) return;
    const keys = config.gemini.apiKeys;
    geminiPool = keys.map((k, i) => ({
        key: k,
        lastFailureAt: 0,
        cooldownUntil: 0,
        index: i,
        client: new GoogleGenerativeAI(k)
    }));
}

function isQuotaError(err: any): boolean {
    const msg = String(err?.message ?? err).toLowerCase();
    // Transport-level errors (Error fetching...) are often hidden rate limits or network congestion
    return err?.status === 429 || msg.includes("429") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("error fetching");
}

function isAuthError(err: any): boolean {
    const msg = String(err?.message ?? err).toLowerCase();
    return err?.status === 403 || msg.includes("403") || msg.includes("denied") || msg.includes("forbidden") || msg.includes("access");
}

function markKeyFailure(key: GeminiKey, error: any) {
    key.lastFailureAt = Date.now();
    if (isQuotaError(error)) {
        key.cooldownUntil = Date.now() + 120_000; // 2 min cooldown
        console.warn(`[TP] key_index=${key.index} quota_exceeded (or network error) → 2m cooldown`);
    } else if (isAuthError(error)) {
        key.cooldownUntil = Date.now() + 10 * 60_000; // 10 min cooldown
        console.error(`[TP] key_index=${key.index} auth_error → 10m cooldown`);
    } else {
        key.cooldownUntil = Date.now() + 60_000; // 1 min cooldown for unknown errors
        console.warn(`[TP] key_index=${key.index} unknown_error → 1m cooldown`);
    }
}

function getActiveKey(): GeminiKey | null {
    initGeminiPool();
    const now = Date.now();
    const available = geminiPool.filter(k => now >= k.cooldownUntil);
    if (available.length === 0) return null;
    // Round-robin or random — random is fine here
    return available[Math.floor(Math.random() * available.length)];
}

const TP_MODELS = [
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b',
];

interface PipelineContext {
    llmFailureCount: number;
    usedGroq?: boolean;
}

const MAX_LLM_FAILURES = 5;

const DEBUG_SIMPLE_PROMPT = false;

async function callLLMWithRetry(fn: () => Promise<string | null>, ctx: PipelineContext, retries = 3): Promise<string | null> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fn();
            if (res && res.trim().length > 20) {
                return res;
            }
            console.warn(`[TP] retry_empty_response attempt=${i + 1}`);
        } catch (err: any) {
            console.error(`[TP] retry_error attempt=${i + 1}`, err?.message);
        }
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
    console.error("[TP] llm_failed_after_retries");
    ctx.llmFailureCount++;
    return null;
}

async function _callGeminiInternal(prompt: string, maxTokens: number): Promise<string | null> {
    if (DEBUG_SIMPLE_PROMPT) {
        prompt = `Generate 3 physics questions on gravitation in JSON`;
    }
    const models = [...new Set(TP_MODELS)];
    for (const modelId of models) {
        const keyObj = getActiveKey();
        if (!keyObj) {
            console.error("[TP] all_keys_in_cooldown");
            return null;
        }

        try {
            console.log(`[TP] using_key_index=${keyObj.index} model=${modelId}`);
            const model = keyObj.client.getGenerativeModel({
                model: modelId,
                generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
            });
            const llmCall = model.generateContent(prompt);
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("LLM_TIMEOUT")), 60000)
            );
            const result = await Promise.race([llmCall, timeout]);
            
            // @ts-ignore
            console.log("[TP] llm_status=", result.response?.status || "unknown");
            
            // @ts-ignore
            const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            const rawResponse = text ? String(text).trim() : "";
            
            console.log("[TP] raw_llm_response=", (rawResponse || "").slice(0, 300));
            return rawResponse;
        } catch (err: any) {
            const msg = String(err?.message ?? err);
            const status = err?.status ?? err?.statusCode;
            
            console.error(`[TP] key_failed index=${keyObj.index} model=${modelId} error=${msg.slice(0, 100)}`);
            markKeyFailure(keyObj, err);

            if (status === 401 || msg.toLowerCase().includes("not authorized")) {
                return null; // Fatal for this key, maybe next key works
            }
            
            const is404 = status === 404 || /not found|not supported/i.test(msg);
            if (is404) continue; // try next model
            
            // Network/Transport errors (Error fetching...) are often persistent in certain environments (like Render).
            // If we hit this, we fail this specific model call and let the next one try.
            // However, we mark the key so it's not reused immediately.
            continue; 
        }
    }
    return null;
}

async function callLLMForPaper(
    prompt: string, 
    maxTokens: number, 
    ctx: PipelineContext
): Promise<{ text: string | null; provider: "gemini" | "groq" }> {
    // ─── Phase 1: Try Groq First (Primary) ───
    try {
        const groqText = await generateWithGroq(prompt, "You are a professional academic examiner. Return valid JSON only.");
        if (groqText && groqText.length > 50) {
            return { text: groqText, provider: "groq" };
        }
        console.warn("[TP] Groq failed or returned empty → falling back to Gemini");
    } catch (err: any) {
        console.warn("[TP] Groq error:", err?.message || "Unknown error", "→ falling back to Gemini");
    }

    // ─── Phase 2: Try Gemini Pool (Fallback) ───
    const geminiResult = await callLLMWithRetry(() => _callGeminiInternal(prompt, maxTokens), ctx, 2);
    if (geminiResult) {
        return { text: geminiResult, provider: "gemini" };
    }

    return { text: null, provider: "gemini" };
}

// ─── Safe JSON extraction + line-based fallback ─────────────────────────────────

function sanitizeJson(src: string): string {
    return src
        .replace(/[\u201C\u201D]/g, '"')  // smart quotes
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')    // trailing commas
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":') // unquoted keys
        .trim();
}

function tryParseQuestionArray(src: string): any[] | null {
    if (!src.includes("{") && !src.includes("[")) {
        console.warn("[TP] non_json_response_detected");
        return null;
    }
    const cleaned = sanitizeJson(src);
    // 1. Full JSON parse
    try {
        const parsed = JSON.parse(cleaned);
        if (parsed?.questions && Array.isArray(parsed.questions)) { console.log('[TP] parse_success method=full_object'); return parsed.questions; }
        if (Array.isArray(parsed)) { console.log('[TP] parse_success method=full_array'); return parsed; }
    } catch { /* continue */ }

    // 2. Extract {...} block then parse
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            const p = JSON.parse(sanitizeJson(objMatch[0]));
            if (p?.questions && Array.isArray(p.questions)) { console.log('[TP] parse_success method=object_extract'); return p.questions; }
        } catch { /* continue */ }
    }

    // 3. Extract [...] array block then parse
    const arrMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrMatch) {
        try {
            const arr = JSON.parse(sanitizeJson(arrMatch[0]));
            if (Array.isArray(arr)) { console.log('[TP] parse_success method=array_extract'); return arr; }
        } catch { /* continue */ }
    }

    return null;
}

// ─── Topic validation helpers (strict group-based) ────────────────────────────

const SYNONYMS: Record<string, string[]> = {
    gravitation: ["gravity", "gravitational"],
    "escape velocity": ["escape speed"],
    "newton": ["newton's", "newtons"],
    "law": ["laws"],
};

function expandGroup(group: string[]): string[] {
    const out = new Set(group);
    for (const token of group.join(" ").split(" ")) {
        const k = token.toLowerCase();
        if (SYNONYMS[k]) SYNONYMS[k].forEach(s => out.add(s));
    }
    return Array.from(out);
}

function containsPhrase(text: string, phrase: string) {
    return text.includes(phrase);
}

/**
 * Common unrelated-topic phrases that should always be rejected.
 * Covers Units & Measurements leakage and similar off-topic categories.
 */
const TOPIC_BLACKLIST_PATTERNS = [
    /vernier(\s+caliper)?/i,
    /screw\s+gauge/i,
    /\bdimension(al)?\b.*?(formula|analysis|check)/i,
    /significant\s+figure/i,
    /\berror(s)?\b.*(measurement|absolute|relative|percentage)/i,
    /least\s+count/i,
    /\bunit(s)?\s+(of\s+)?measurement/i,
    /\bSI\s+unit/i,
    /physical\s+quantity.*unit/i,
];

function buildTopicGroups(chapters: string[], topics: string): { groups: string[][], phrases: string[] } {
    const groups: string[][] = [];
    const phrases: string[] = [];

    const phraseToGroup = (phrase: string): string[] => {
        if (phrase.trim().includes(' ')) {
            phrases.push(phrase.trim().toLowerCase());
        }
        const STOP = new Set(['the', 'of', 'and', 'in', 'for', 'a', 'an', 'to', 'by', 'with', 'or', 'at', 'on', 'its', 'is', 'are', 'be', 'as', 'that', 'this', 'from']);
        const tokens = phrase
            .toLowerCase()
            .split(/[\s,;|/]+/)
            .map(w => w.replace(/[^a-z0-9]/g, ''))
            .filter(w => w.length >= 3 && !STOP.has(w));
        return expandGroup(tokens);
    };

    chapters.forEach(ch => {
        const g = phraseToGroup(ch);
        if (g.length > 0) groups.push(g);
    });

    if (topics) {
        topics.split(/[,;]+/).forEach(t => {
            const g = phraseToGroup(t.trim());
            if (g.length > 0) groups.push(g);
        });
    }

    return { groups, phrases };
}

function isValidTopicStrict(questionText: string, topicGroups: string[][], phrases: string[], logReject = false): boolean {
    if (topicGroups.length === 0) return true;

    const lq = questionText.toLowerCase();

    const hasGroup = topicGroups.some(group => {
        const matches = group.filter(kw => lq.includes(kw)).length;
        const threshold = group.length <= 2 ? group.length : Math.ceil(group.length * 0.75);
        return matches >= threshold;
    });
    const hasPhrase = phrases.length > 0 && phrases.some(p => containsPhrase(lq, p));
    const matchedTopic = hasPhrase || hasGroup;

    // Blacklist check first
    const isBlacklisted = TOPIC_BLACKLIST_PATTERNS.some(rx => rx.test(lq));
    if (isBlacklisted && !matchedTopic) {
        if (logReject) console.log(`[TP] topic_reject="${questionText.slice(0, 80)}" (blacklist)`);
        return false;
    }

    if (!matchedTopic) {
        if (logReject) console.log(`[TP] topic_reject="${questionText.slice(0, 80)}" (miss)`);
        return false;
    }

    return true;
}

function basicQuality(q: string): boolean {
    const t = q.toLowerCase();
    if (t.length < 20 || t.length > 200) return false;
    // Reject obvious junk (JSON fragments, braces, code fences)
    if (/[{}[\]"`]/.test(t)) return false;
    // Must contain a question signal
    if (!(t.includes("?") || t.includes(":") || /(calculate|find|derive|prove|state|what|why|how|determine|name|define)/.test(t))) return false;
    return true;
}

function isValidTopicRelaxed(questionText: string, topicGroups: string[][], phrases: string[]): boolean {
    if (topicGroups.length === 0) return true;
    const lq = questionText.toLowerCase();

    // Check if it matches at least one phrase
    if (phrases.length > 0 && phrases.some(p => containsPhrase(lq, p))) return true;

    // Adaptive thresholding: require higher match for longer groups
    return topicGroups.some(group => {
        let matchCount = 0;
        for (const kw of group) {
            if (lq.includes(kw)) matchCount++;
        }
        
        let threshold = Math.max(1, Math.ceil(group.length * 0.5));
        if (group.length >= 4) threshold = Math.ceil(group.length * 0.6);
        if (group.length <= 2) threshold = 1;
        
        return matchCount >= threshold;
    });
}


function lineFallbackParser(
    raw: string,
    type: 'objective' | 'subjective',
    difficulty: 'easy' | 'medium' | 'hard',
    topicGroups: string[][] = [],
    phrases: string[] = []
): any[] {
    if (!raw) return [];

    console.log('[TP] fallback_parser_used');
    const genericPattern = /^(explain|write a short note|write short note|describe|discuss|what do you mean|give an example)/i;
    const junkPattern = /[{}\/\[\]"']|"questions"|json/i;
    const seen = new Set<string>();

    return raw
        .split(/\n/)
        .map((line) => line.replace(/^\d+[.)\s]+/, '').trim())
        .filter((line) => {
            if (line.length < 20 || line.length > 200) return false;
            if (junkPattern.test(line)) return false;
            if (genericPattern.test(line)) return false;
            if (!/[?:]/.test(line) && !/\b(what|which|how|find|calculate|define|state|name|explain|prove|derive|determine)\b/i.test(line)) return false;
            if (!isValidTopicStrict(line, topicGroups, phrases, true)) return false;
            const key = line.toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);

            return true;
        })
        .map((line) => ({
            question: line,
            type,
            difficulty,
            options: [],
            answer: '',
            solution: '',
        }));
}

function extractJsonArray(
    raw: string,
    type: 'objective' | 'subjective' = 'objective',
    difficulty: 'easy' | 'medium' | 'hard' = 'medium',
    topicGroups: string[][] = [],
    phrases: string[] = []
): any[] | null {
    if (!raw || raw.trim().length < 20) { 
        console.warn('[TP] empty_llm_response_detected'); 
        return null; 
    }

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const sources = [fenced ? fenced[1] : '', raw].filter(Boolean);

    for (const src of sources) {
        const result = tryParseQuestionArray(src);
        if (result && result.length > 0) return result;
    }

    const lineResult = lineFallbackParser(raw, type, difficulty, topicGroups, phrases);
    if (lineResult.length > 0) {

        // Deduplicate across all sources
        const dedupSeen = new Set<string>();
        const deduped = lineResult.filter((q) => {
            const key = String(q.question || '').toLowerCase().trim();
            if (dedupSeen.has(key)) return false;
            dedupSeen.add(key);
            return true;
        });
        return deduped;
    }

    console.warn('[TP] all_parse_methods_failed');
    return null;
}


// ─── Difficulty definitions + examples ──────────────────────────────────────

const DIFFICULTY_BLOCK: Record<'easy' | 'medium' | 'hard', { def: string; example: string }> = {
    easy: {
        def: 'Direct application of a single concept or formula. No complex calculations. Solvable in under 1 minute.',
        example: 'Example (Easy): "A body of mass 5kg is accelerated at 2m/s². Calculate the net force acting on it."',
    },
    medium: {
        def: 'Requires 2-3 logical steps or multiple formula applications. May involve conceptual reasoning or simple vector addition.',
        example: 'Example (Medium): "A 2kg block is pulled on a horizontal surface with a force of 10N at 30° to the horizontal. If friction is negligible, find the acceleration."',
    },
    hard: {
        def: 'Competitive level (JEE/NEET). Multi-concept integration, tricky reasoning, or advanced problem solving. May involve calculus or non-trivial geometry.',
        example: 'Example (Hard): "A variable force F = (2 + 3x)N acts on a particle. Calculate the work done by this force in moving the particle from x=0 to x=2m."',
    },
};

// ─── Single bucket prompt + call ─────────────────────────────────────────────

function buildBucketPrompt(bucket: Bucket, input: GenerateTestPaperInput): string {
    const safeSubject  = (input.subject  || 'General').trim();
    const safeChapters = (input.chapters?.length ? input.chapters : [input.chapter])
        .filter(Boolean).join(', ') || 'All chapters';
    const safeTopics   = input.topics?.trim() ? input.topics.trim() : 'None specified';
    const extra = input.specialInstructions ? `Special note: ${input.specialInstructions}.` : '';
    const { def, example } = DIFFICULTY_BLOCK[bucket.difficulty];

    const typeNote =
        bucket.type === 'objective'
            ? 'Include exactly 4 distinct and plausible options. Put the ACTUAL text of the choices in the "options" array. DO NOT use placeholders like ["A","B","C","D"].'
            : 'No options. Set "options":[].';
    const diffRule =
        bucket.difficulty === 'easy'   ? 'easy → direct formula application (single step)' :
        bucket.difficulty === 'medium' ? 'medium → 2-step reasoning or conceptual application' :
                                         'hard → advanced/competitive level (JEE/NEET style), multi-concept integration';

    return `You are a professional academic examiner. 
Generate high-quality physics questions based on the following context.

CONTEXT:
* Subject: ${safeSubject} | Class: ${input.className} | Level: ${input.targetExam} (Standards: ${input.targetExam === 'jee' || input.targetExam === 'neet' ? 'Competitive/High' : 'School/Standard'})
* Chapters: ${safeChapters}
* Topics: ${safeTopics}${extra ? `\n* ${extra}` : ''}
* Exam Style: ${input.examPattern || 'Standard'}
* Target: Professional academic test paper for ${input.targetExam.toUpperCase()} candidates.

REQUIREMENTS:
1. Generate up to ${bucket.count} questions. 
2. ALL questions MUST be from the provided chapters and topics.
3. DO NOT generate questions from any other chapter (e.g., Units & Measurements, Errors, Dimensions, etc.) unless requested.
4. If a question does not belong to the given topics, skip it.
5. Generate as many valid questions as possible. 

DIFFICULTY RULE — ${bucket.difficulty.toUpperCase()}:
${diffRule}
${def}
${example}

QUESTION TYPE: ${bucket.type.toUpperCase()}
${typeNote}

SELF-CHECK (before responding): For EACH question:
  - Is it from the correct chapters/topics?
  - Does difficulty match ${bucket.difficulty.toUpperCase()}?
  - If objective, are options distinct and correct?
  - RETURN ONLY VALID JSON.

FINAL VALIDATION (VERY IMPORTANT):
Before returning, verify:
* Total questions = ${bucket.count}
* All questions belong ONLY to the given chapters and topics
* Difficulty matches the requested level

If any condition fails, FIX internally before returning.

Return ONLY valid JSON. No markdown, no text outside JSON.

JSON FORMAT:
{"questions":[{"question":"...","type":"${bucket.type}","difficulty":"${bucket.difficulty}","options":[],"answer":"...","solution":"..."}]}

Generate as many ${bucket.difficulty} ${bucket.type} questions as possible now:`.trim();
}


// ─── Soft difficulty confidence scorer ───────────────────────────────────────

function difficultyConfidence(
    questionText: string,
    expected: 'easy' | 'medium' | 'hard'
): { valid: boolean; confidence: number } {
    const t = questionText.toLowerCase();
    const wordCount = questionText.split(/\s+/).length;

    const hardKeywords = /calculat|derive|prove|find.*and.*find|acceleration|integrate|differentiate|multi|uniform.*and|stages|phase|sequence|edge case/i;
    const easyKeywords = /^what is|^define|^name|^state the|^write the formula|^which of the following is/i;
    const mediumKeywords = /travels|covers|how long|calculate the|find the (speed|time|distance|velocity|force|current|resistance)|if a|when a|given that/i;

    const looksHard   = hardKeywords.test(t) || wordCount > 45;
    const looksEasy   = easyKeywords.test(t) && wordCount < 20;
    const looksMedium = mediumKeywords.test(t) || (wordCount >= 15 && wordCount <= 45 && !looksEasy && !looksHard);

    let confidence = 0.5; // neutral baseline

    if (expected === 'easy') {
        if (looksEasy) confidence = 0.9;
        else if (looksHard) confidence = 0.1;
        else if (looksMedium) confidence = 0.3;
        else confidence = 0.6; // short ambiguous — give benefit of doubt
    } else if (expected === 'hard') {
        if (looksHard) confidence = 0.9;
        else if (looksEasy) confidence = 0.1;
        else if (wordCount > 25) confidence = 0.6;
        else confidence = 0.3;
    } else { // medium
        if (looksMedium) confidence = 0.9;
        else if (looksEasy && !looksHard) confidence = 0.35;
        else if (looksHard && wordCount > 35) confidence = 0.35;
        else confidence = 0.6; // ambiguous — lean accept
    }

    return { valid: confidence >= 0.5, confidence };
}

async function generateBucket(
    bucket: Bucket,
    input: GenerateTestPaperInput,
    seen: Set<string>,
    ctx: PipelineContext,
    topicGroups: string[][],
    phrases: string[],
    skipDifficultyFilter = false
): Promise<GeneratedQuestion[]> {
    if (ctx.llmFailureCount >= MAX_LLM_FAILURES) {
        console.warn("[TP] skipping bucket — LLM unavailable");
        return [];
    }
    const TOKENS_PER_Q = 500;
    const TOKENS_PER_Q_RETRY = 400;
    const MAX_RETRIES = 3;
    const collected: GeneratedQuestion[] = [];
    // Small buckets get relaxed filtering to avoid total failure
    const relaxed = skipDifficultyFilter || bucket.count <= 2;
    let needed = bucket.count;

    for (let attempt = 0; attempt < MAX_RETRIES && needed > 0; attempt++) {
        const tokensPerQ = attempt === 0 ? TOKENS_PER_Q : TOKENS_PER_Q_RETRY;
        const maxTokens = Math.min(2500, Math.max(256, needed * tokensPerQ));

        const thisBucket: Bucket = { ...bucket, count: needed };
        const prompt = buildBucketPrompt(thisBucket, input);

        console.log(`[TP] bucket=${bucket.difficulty}+${bucket.type} attempt=${attempt + 1} needed=${needed} maxTokens=${maxTokens} relaxed=${relaxed}`);

        const res = await callLLMForPaper(prompt, maxTokens, ctx);
        if (!res.text) { console.warn(`[TP] no response for ${bucket.difficulty}+${bucket.type} attempt ${attempt + 1}`); continue; }

        const arr = extractJsonArray(res.text, bucket.type, bucket.difficulty);
        if (!arr) { console.warn(`[TP] JSON parse failed for ${bucket.difficulty}+${bucket.type} attempt ${attempt + 1}`); continue; }

        let generated = 0, accepted = 0, rejected = 0;
        for (const q of arr) {
            if (collected.length >= bucket.count) break;
            generated++;
            const questionText = cleanText(String(q?.question || ''));
            if (!questionText || questionText.length < 15) { rejected++; continue; }
            if (isLowQuality({ question: questionText })) { rejected++; continue; }

            // Soft difficulty gate (skipped for small/relaxed buckets)
            if (!relaxed) {
                const { valid, confidence } = difficultyConfidence(questionText, bucket.difficulty);
                if (!valid) {
                    console.warn(`[TP] difficulty mismatch (expected=${bucket.difficulty} confidence=${confidence.toFixed(2)}): "${questionText.slice(0, 50)}" - discarded`);
                    rejected++;
                    continue;
                }
            }

            const hash = normalizedHash(questionText);
            if (seen.has(hash)) { rejected++; continue; }

            // Provider-aware topic filter
            const ok = res.provider === "groq"
                ? isValidTopicRelaxed(questionText, topicGroups, phrases)
                : (relaxed ? true : isValidTopicStrict(questionText, topicGroups, phrases));
            
            if (!ok) { rejected++; continue; }

            seen.add(hash);
            accepted++;

            const options = bucket.type === 'objective'
                ? (Array.isArray(q.options) ? q.options.map((o: any) => cleanText(String(o))) : ['Option A', 'Option B', 'Option C', 'Option D']).slice(0, 4)
                : [];

            collected.push({
                questionNumber: 0,
                question: questionText,
                type: bucket.type,
                difficulty: bucket.difficulty,
                marks: input.marksPerQuestion || 1,
                options,
                answerKey: cleanText(String(q?.answer || q?.answerKey || '')),
                solution: cleanText(String(q?.solution || '')),
                provider: res.provider
            });
        }

        needed = bucket.count - collected.length;
        console.log(`[TP] bucket=${bucket.difficulty}+${bucket.type} attempt=${attempt + 1} generated=${generated} accepted=${accepted} rejected=${rejected} total=${collected.length}/${bucket.count}`);
    }

    // Fallback: fill from QuestionBank if still short
    if (collected.length < bucket.count) {
        const bankRows = await QuestionBank.find({
            className: input.className,
            subject: new RegExp(`^${input.subject}$`, 'i'),
            difficulty: bucket.difficulty,
            questionType: bucket.type,
        })
            .limit((bucket.count - collected.length) * 3)
            .lean();

        for (const row of bankRows) {
            if (collected.length >= bucket.count) break;
            const hash = normalizedHash(row.question);
            if (seen.has(hash)) continue;
            if (isLowQuality({ question: row.question })) continue;
            seen.add(hash);
            collected.push({
                questionNumber: 0,
                question: cleanText(row.question),
                type: bucket.type,
                difficulty: bucket.difficulty,
                marks: input.marksPerQuestion || 1,
                options: row.options || [],
                answerKey: cleanText(row.answer || ''),
                solution: cleanText(row.solution || ''),
            });
        }
    }

    return collected;
}

// ─── Redis-backed result cache (TTL 60s, falls back to in-memory) ─────────────

const _tpMemCache = new Map<string, { result: GeneratedTestPaper; expiresAt: number }>();

async function cacheGet(key: string): Promise<GeneratedTestPaper | null> {
    if (isRedisAvailable()) {
        try {
            const raw = await getRedisClient().get(`tp:${key}`);
            if (raw) return JSON.parse(raw) as GeneratedTestPaper;
        } catch (e: any) {
            console.warn(`[TP] cache_error op=get msg=${e.message}`);
        }
    }
    const entry = _tpMemCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _tpMemCache.delete(key); return null; }
    return entry.result;
}

async function cacheSet(key: string, result: GeneratedTestPaper, ttlSec = 60): Promise<void> {
    if (isRedisAvailable()) {
        try {
            await getRedisClient().setex(`tp:${key}`, ttlSec, JSON.stringify(result));
            return;
        } catch (e: any) {
            console.warn(`[TP] cache_error op=set msg=${e.message}`);
        }
    }
    _tpMemCache.set(key, { result, expiresAt: Date.now() + ttlSec * 1000 });
    for (const [k, v] of _tpMemCache.entries()) {
        if (Date.now() > v.expiresAt) _tpMemCache.delete(k);
    }
}


// ─── Top-up: one extra LLM call for missing questions ────────────────────────

async function generateTopUp(
    missing: number,
    input: GenerateTestPaperInput,
    seen: Set<string>,
    ctx: PipelineContext,
    topicGroups: string[][],
    phrases: string[],
    preferDifficulty?: 'easy' | 'medium' | 'hard',
    preferType?: 'objective' | 'subjective'
): Promise<GeneratedQuestion[]> {
    if (ctx.llmFailureCount >= MAX_LLM_FAILURES) {
        console.warn("[TP] skipping topup — LLM unavailable");
        return [];
    }
    let categoryHint = preferDifficulty || preferType
        ? `Prefer generating ${preferDifficulty ?? 'mixed'} ${preferType ?? 'mixed'} questions to fill a gap.`
        : 'Maintain approximate difficulty and type balance.';
    if (seen.size > 0) {
        categoryHint += ' Avoid repeating previous question patterns.';
    }
    console.log(`[TP] topup_triggered missing=${missing} prefer=${preferDifficulty ?? 'any'}+${preferType ?? 'any'}`);
    const chapters = (input.chapters?.length ? input.chapters : [input.chapter])
        .filter(Boolean).join(', ') || 'All chapters';
    const typeInstruction = preferType === 'objective'
        ? 'Generate ONLY objective questions with exactly 4 distinct options and a correct answer.'
        : preferType === 'subjective'
            ? 'Generate ONLY subjective/theoretical questions without options.'
            : 'Maintain a balance of objective and subjective questions.';

    const prompt = `Generate clear physics questions on ${input.subject}, chapters: ${chapters}.${input.topics ? ` Focus: ${input.topics}.` : ''}
${typeInstruction}
Focus on correctness over complexity.
Provide ACTUAL, valid options for objective questions. DO NOT use placeholders like "A, B, C, D".
Return ONLY valid JSON:
{"questions":[{"question":"...","type":"${preferType || 'objective'}","difficulty":"${preferDifficulty || 'medium'}","options":[],"answer":"...","solution":"..."}]}
Generate up to ${missing} questions now:`.trim();

    const maxTokens = Math.min(2500, Math.max(500, missing * 500));
    const res = await callLLMForPaper(prompt, maxTokens, ctx);
    if (!res.text) return [];
    const arr = extractJsonArray(res.text, 'objective', 'medium');
    if (!arr) return [];

    const result: GeneratedQuestion[] = [];
    for (const q of arr) {
        if (result.length >= missing) break;
        const questionText = cleanText(String(q?.question || ''));
        if (!questionText || questionText.length < 15 || isLowQuality({ question: questionText })) continue;
        const hash = normalizedHash(questionText);
        if (seen.has(hash)) continue;
        
        // Provider-aware filtering
        const ok = res.provider === "groq"
            ? isValidTopicRelaxed(questionText, topicGroups, phrases)
            : (true); // top-up logic often bypasses topic check or handles it outside
            
        if (!ok) continue;

        seen.add(hash);
        result.push({
            questionNumber: 0,
            question: questionText,
            type: (q.type === 'subjective' ? 'subjective' : 'objective') as 'objective' | 'subjective',
            difficulty: (['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium') as 'easy' | 'medium' | 'hard',
            marks: input.marksPerQuestion || 1,
            options: Array.isArray(q.options) ? q.options.map((o: any) => cleanText(String(o))).slice(0, 4) : [],
            answerKey: cleanText(String(q?.answer || '')),
            solution: cleanText(String(q?.solution || '')),
            provider: res.provider
        });
    }
    return result;
}

// ─── Distribution rebalance (trim only, no regeneration) ─────────────────────

function rebalanceDistribution(
    questions: GeneratedQuestion[],
    requested: number,
    diffDist?: { easy: number; medium: number; hard: number },
    typeDist?: { objective: number; subjective: number }
): GeneratedQuestion[] {
    if (!diffDist && !typeDist) return questions;
    const total = Math.min(questions.length, requested);
    const buckets: Record<string, GeneratedQuestion[]> = {};
    for (const q of questions) {
        const key = `${q.difficulty}+${q.type}`;
        (buckets[key] = buckets[key] || []).push(q);
    }
    const difficulties = ['easy', 'medium', 'hard'] as const;
    const types = ['objective', 'subjective'] as const;
    const targets: Record<string, number> = {};
    let assigned = 0;
    let maxKey = '', maxCount = -1;
    for (const d of difficulties) {
        const dp = diffDist ? diffDist[d] / 100 : 1 / 3;
        if (dp === 0) continue;
        for (const t of types) {
            const tp = typeDist ? typeDist[t] / 100 : 0.5;
            if (tp === 0) continue;
            const count = Math.round(total * dp * tp);
            const key = `${d}+${t}`;
            targets[key] = count;
            assigned += count;
            if (count > maxCount) { maxCount = count; maxKey = key; }
        }
    }
    if (maxKey && assigned !== total) targets[maxKey] += total - assigned;
    const result: GeneratedQuestion[] = [];
    for (const [key, target] of Object.entries(targets)) {
        result.push(...(buckets[key] || []).slice(0, target));
    }
    if (result.length < total) {
        const usedSet = new Set(result.map((q) => normalizedHash(q.question)));
        for (const q of questions) {
            if (result.length >= total) break;
            if (!usedSet.has(normalizedHash(q.question))) result.push(q);
        }
    }
    return result.slice(0, total);
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function runWithLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < tasks.length; i += limit) {
        const chunk = tasks.slice(i, i + limit);
        const res = await Promise.all(chunk.map(t => t()));
        results.push(...res);
    }
    return results;
}

export async function generateTestPaper(input: GenerateTestPaperInput): Promise<GeneratedTestPaper> {
    const ctx: PipelineContext = { llmFailureCount: 0 };

    if (!getActiveKey()) {
        console.error("[TP] all_keys_in_cooldown — skipping to catastrophic fallback");
        // No Gemini keys available at all
    }

    if (ctx.llmFailureCount >= MAX_LLM_FAILURES) {
        console.error("[TP] GLOBAL_LLM_FAILURE — aborting early");
        return {
            title: `${input.subject} - ${input.chapter} (Fallback)`,
            meta: {
                className: input.className,
                subject: input.subject,
                chapter: (input.chapters || [input.chapter]).join(', '),
                targetExam: input.targetExam,
                questionType: input.questionType || 'mixed',
                difficultyLevel: input.difficultyLevel || 'medium',
                totalQuestions: 1,
                totalMarks: input.marksPerQuestion || 1,
                durationMinutes: input.durationMinutes || 60,
            },
            instructions: ['Unable to generate questions due to LLM unavailability.'],
            questions: [{
                questionNumber: 1,
                question: "Unable to generate questions matching the strict criteria. Please relax the topic constraints or try again.",
                type: "objective",
                difficulty: "easy",
                marks: input.marksPerQuestion || 1,
                options: ["Retry", "Change Topics", "Expand Chapters", "N/A"],
                answerKey: "Retry",
                solution: ""
            }],
            sections: [{ type: 'objective', questions: [{
                questionNumber: 1,
                question: "Unable to generate questions matching the strict criteria. Please relax the topic constraints or try again.",
                type: "objective",
                difficulty: "easy",
                marks: input.marksPerQuestion || 1,
                options: ["Retry", "Change Topics", "Expand Chapters", "N/A"],
                answerKey: "Retry",
                solution: ""
            }] }]
        };
    }
    const t0 = Date.now();
    const TOTAL_BUDGET_MS = 90000; // Increased to 90s to ensure higher success rate

    // Request hash for observability
    const requestHash = normalizedHash(
        `${input.className}|${input.subject}|${(input.chapters || []).join(',')}|${input.topics || ''}`
    ).slice(0, 8);
    console.log(`[TP] request_hash=${requestHash} class=${input.className} subject=${input.subject} count=${input.questionCount}`);

    const marksPerQ = input.marksPerQuestion || 1;
    const teacherQs: GeneratedQuestion[] = (input.teacherQuestions || []).map((tq, i) => ({
        questionNumber: i + 1,
        question: cleanText(tq.question),
        type: tq.type,
        difficulty: tq.difficulty,
        marks: tq.marks ?? marksPerQ,
        options: tq.options || [],
        answerKey: cleanText(tq.answer || ''),
        solution: '',
    }));

    const llmTarget = Math.max(0, input.questionCount - teacherQs.length);
    const stage1Target = Math.ceil(llmTarget * 0.6);
    const stage1Buckets = stage1Target > 0 ? buildBuckets(stage1Target, input) : [];

    const { groups: topicGroups, phrases } = buildTopicGroups(
        (input.chapters?.length ? input.chapters : [input.chapter]).filter(Boolean) as string[],
        input.topics || ''
    );

    const seen = new Set<string>(teacherQs.map((q) => normalizedHash(q.question)));

    // ── STAGE A: Quality First (60% target) ───────────────────────────────────
    const stage1Results = await runWithLimit(
        stage1Buckets.map((b) => async () => {
            const res = await generateBucket(b, input, seen, ctx, topicGroups, phrases);
            await new Promise(r => setTimeout(r, 500)); // Small pause to respect RPM
            return res;
        }),
        1 // Sequential is safer for free tier quotas
    );

    let llmQuestions: GeneratedQuestion[] = stage1Results.flat();

    // ── STAGE B: Fill Gap (40% target, triggered if < 80% total) ──────────────
    const typePct = resolveTypePct(input);
    const targetObj = Math.round(input.questionCount * (typePct.objective / 100));
    const targetSub = input.questionCount - targetObj;

    const threshold = Math.floor(input.questionCount * 0.8);
    let currentTotal = teacherQs.length + llmQuestions.length;

    if (currentTotal < threshold && ctx.llmFailureCount < MAX_LLM_FAILURES) {
        const objInHand = [...teacherQs, ...llmQuestions].filter(q => q.type === 'objective').length;
        const subInHand = [...teacherQs, ...llmQuestions].filter(q => q.type === 'subjective').length;
        
        const objGap = Math.max(0, targetObj - objInHand);
        const subGap = Math.max(0, targetSub - subInHand);

        console.log(`[TP] stage_b_triggered objGap=${objGap} subGap=${subGap} total=${currentTotal}/${input.questionCount}`);
        
        if (objGap > 0) {
            const stage2Results = await generateTopUp(objGap, input, seen, ctx, topicGroups, phrases, undefined, 'objective');
            llmQuestions.push(...stage2Results);
        }
        if (subGap > 0 && ctx.llmFailureCount < MAX_LLM_FAILURES) {
            const stage2Results = await generateTopUp(subGap, input, seen, ctx, topicGroups, phrases, undefined, 'subjective');
            llmQuestions.push(...stage2Results);
        }
        currentTotal = teacherQs.length + llmQuestions.length;
    }

    // ── Global fallback (last resort) ──
    if (llmQuestions.length === 0 && llmTarget > 0) {
        console.error("[TP] LLM_STALLED — triggering emergency fallback");
        const fallbackPrompt = `Generate 5 physics questions on ${input.subject} in JSON. Provide actual options.`;
        const fallbackRaw = await callLLMForPaper(fallbackPrompt, 1000, ctx);
        if (fallbackRaw.text) {
            const fallbackArr = extractJsonArray(fallbackRaw.text, 'objective', 'easy', [], []);
            if (fallbackArr && fallbackArr.length > 0) {
                llmQuestions = fallbackArr.map((q: any) => ({
                    questionNumber: 0,
                    question: cleanText(q.question),
                    type: 'objective',
                    difficulty: 'easy',
                    marks: input.marksPerQuestion || 1,
                    options: q.options || [],
                    answerKey: cleanText(q.answer || ''),
                    solution: '',
                    provider: fallbackRaw.provider
                }));
            }
        }
    }

    // ── Topic filter: reject LLM questions that don't match subject chapters/topics ──────
    if (topicGroups.length > 0) {
        const originalQuestions = [...llmQuestions];
        const beforeFilter = llmQuestions.length;
        
        // Stage 1: Strict
        llmQuestions = llmQuestions.filter(q => {
            if (q.provider === "groq") return isValidTopicRelaxed(q.question, topicGroups, phrases);
            return isValidTopicStrict(q.question, topicGroups, phrases, true);
        });
        
        const kept = llmQuestions.length;
        const rejected = beforeFilter - kept;
        const rateNum = rejected / (kept + rejected || 1);
        console.log(`[TP] topic_filter kept=${kept} rejected=${rejected} rate=${rateNum.toFixed(2)}`);

        // Stage 2: Relaxed Fallback
        if (llmQuestions.length === 0 && originalQuestions.length > 0) {
            console.warn("[TP] topic_filter_zero → applying relaxed filter");
            let relaxed = originalQuestions.filter(q => isValidTopicRelaxed(q.question, topicGroups, phrases));
            
            // Cap relaxed results at 80% of requestedCount to avoid massive drift
            const cap = Math.floor(input.questionCount * 0.8);
            if (relaxed.length > cap) {
                console.log(`[TP] relaxed_filter_cap exceeded (${relaxed.length} > ${cap}) → trimming by score`);
                relaxed = relaxed
                    .sort((a, b) => scoreQuestion(b) - scoreQuestion(a))
                    .slice(0, cap);
            }
            llmQuestions = relaxed;
            console.log(`[TP] relaxed_filter_kept=${llmQuestions.length}`);
        }

        // Stage 3: Quality-gated safety fallback
        if (llmQuestions.length === 0 && originalQuestions.length > 0) {
            console.error("[TP] topic_filter_total_failure → using quality-gated fallback");
            llmQuestions = originalQuestions.filter(q => basicQuality(q.question)).slice(0, input.questionCount);
        }

        if (rateNum > 0.6) {
            console.log(`[TP] high_rejection_rate — prompt may be too strict`);
        }
    }
    
    // ── OBJECTIVE SAFETY PASS: Filter out invalid options/placeholders ────────
    const placeholders = new Set(['a', 'b', 'c', 'd', 'option a', 'option b', 'option c', 'option d', 'n/a', 'none', 'retry']);
    llmQuestions = llmQuestions.filter(q => {
        if (q.type !== 'objective') return true;
        if (!Array.isArray(q.options) || q.options.length < 2) return false;
        const validOptions = q.options.filter(o => {
            const t = String(o).toLowerCase().trim();
            return t.length > 0 && !placeholders.has(t);
        });
        if (validOptions.length < 2) {
            console.warn(`[TP] rejecting_objective_due_to_placeholders: "${q.question.slice(0, 50)}"`);
            return false;
        }
        return true;
    });

    // ── TARGETED RECOVERY: If objectives collapsed, try one last targeted pass ──
    const finalObjCount = [...teacherQs, ...llmQuestions].filter(q => q.type === 'objective').length;
    const objDeficit = targetObj - finalObjCount;

    if (objDeficit > 0 && ctx.llmFailureCount < MAX_LLM_FAILURES && Date.now() - t0 < TOTAL_BUDGET_MS - 5000) {
        console.warn(`[TP] objective_deficit=${objDeficit} -> triggering targeted recovery pass`);
        const recovery = await generateTopUp(objDeficit, input, seen, ctx, topicGroups, phrases, 'medium', 'objective');
        
        const validRecovery = recovery.filter(q => {
            if (q.type !== 'objective') return false;
            if (!Array.isArray(q.options) || q.options.length < 2) return false;
            const validOptions = q.options.filter(o => {
                const t = String(o).toLowerCase().trim();
                return t.length > 0 && !placeholders.has(t);
            });
            return validOptions.length >= 2;
        });

        if (validRecovery.length > 0) {
            console.log(`[TP] recovery_success added=${validRecovery.length}`);
            llmQuestions.push(...validRecovery);
        }
    }
    
    // Final Invariants: No duplicates, capped at requestedCount
    const finalSeenBeforeDedup = new Set<string>();
    llmQuestions = llmQuestions.filter(q => {
        const h = normalizedHash(q.question);
        if (finalSeenBeforeDedup.has(h)) return false;
        finalSeenBeforeDedup.add(h);
        return true;
    }).slice(0, input.questionCount);

    // ── Cache check ────────────────────────────────────────────────────────────
    const variation = Math.floor(Date.now() / 30000); // 30s buckets
    const cacheKey = normalizedHash(
        `${input.className}|${input.subject}|${(input.chapters||[]).join(',')}` +
        `|${input.topics||''}|${input.questionCount}` +
        `|${JSON.stringify(input.difficultyDistribution||{})}` +
        `|${JSON.stringify(input.typeDistribution||{})}` +
        `|${input.specialInstructions||''}` +
        `|${(input.teacherQuestions||[]).map(q => q.question).join(',')}` +
        `|v2_topic_strict|${variation}`
    );
    const cached = await cacheGet(cacheKey);
    if (cached) {
        console.log(`[TP] request_hash=${requestHash} cache_hit`);
        return cached;
    }

    // ── Merge: teacher questions first ────────────────────────────────────────
    let merged: GeneratedQuestion[] = [...teacherQs, ...llmQuestions];

    // ── Quality scorer (defined early — used throughout pipeline) ─────────────
    const numericKeywords = /\d|calcul|deriv|force|speed|current|voltage|mass|velocity|accel|resistanc|mol|pressure|frequen|wavelength|energy/i;
    const genericPhrases = /^(explain|describe|discuss|write a note|write short|give an example)/i;
    const scoreQuestion = (q: GeneratedQuestion): number => {
        let s = 0;
        if (numericKeywords.test(q.question)) s += 1;
        if (q.question.length >= 20 && q.question.length <= 120) s += 1;
        if (genericPhrases.test(q.question)) s -= 1;
        // Blend difficulty confidence (+/-0.36 range)
        const conf = difficultyConfidence(q.question, q.difficulty).confidence;
        s += (conf - 0.5) * 0.9;
        return s;
    };

    // ── STEP 1: Final quality filter + dedup (BEFORE top-up) ─────────────────
    const finalSeen = new Set<string>();
    merged = merged.filter((q) => {
        if (!q.question || q.question.length < 15) return false;
        if (isLowQuality({ question: q.question })) return false;
        if (scoreQuestion(q) < 0) return false;          // relaxed: reject only clearly bad (< 0)
        const key = normalizedHash(q.question);
        if (finalSeen.has(key)) return false;
        finalSeen.add(key);
        return true;
    });

    // ── GUARANTEE COUNT: Post-filter hard top-up loop ─────────────────────────
    let hardAttempts = 0;
    while (merged.length < input.questionCount && hardAttempts < 4) {
        if (ctx.llmFailureCount >= MAX_LLM_FAILURES) break;
        if (Date.now() - t0 > TOTAL_BUDGET_MS) {
            console.warn("[TP] budget_exceeded — returning best effort from hard_topup");
            break;
        }
        
        const missing = input.questionCount - merged.length;
        const topupSeen = new Set<string>(merged.map(q => normalizedHash(q.question)));
        const more = await generateTopUp(missing, input, topupSeen, ctx, topicGroups, phrases);
        
        const valid = more.filter(q => {
            if (isLowQuality({ question: q.question })) return false;
            if (scoreQuestion(q) < 0) return false;
            if (topicGroups.length > 0 && !isValidTopicStrict(q.question, topicGroups, phrases, true)) return false;
            const h = normalizedHash(q.question);
            if (finalSeen.has(h)) return false;
            finalSeen.add(h);
            return true;
        });
        
        if (valid.length === 0) {
            console.log(`[TP] topup_stalled_no_new_questions`);
            break;
        }
        
        merged.push(...valid);
        hardAttempts++;
    }

    if (merged.length < input.questionCount) {
        if (Date.now() - t0 > TOTAL_BUDGET_MS) {
            console.warn("[TP] skip_relaxed_topup_due_to_timeout");
        } else {
            console.log(`[TP] hard_topup failed to reach count, relaxing difficulty...`);
            const missing = input.questionCount - merged.length;
            const topupSeen = new Set<string>(merged.map(q => normalizedHash(q.question)));
            // relax difficulty
            const more = await generateTopUp(missing, input, topupSeen, ctx, topicGroups, phrases, undefined, undefined);
            const valid = more.filter(q => {
                if (isLowQuality({ question: q.question })) return false;
                if (topicGroups.length > 0 && !isValidTopicStrict(q.question, topicGroups, phrases, true)) return false;
                const h = normalizedHash(q.question);
                if (finalSeen.has(h)) return false;
                finalSeen.add(h);
                return true;
            });
            merged.push(...valid);
        }
    }

    console.log(`[TP] after_hard_topup=${merged.length}/${input.questionCount}`);

    // ── EARLY EXIT: skip top-up + rebalance only if count AND distribution are satisfied ──
    const preExitDeviation = input.difficultyDistribution
        ? (Object.entries(input.difficultyDistribution) as [string, number][]).reduce((max, [k, v]) => {
              const expected = Math.round(input.questionCount * v / 100);
              const actual = merged.filter(q => q.difficulty === k).length;
              return Math.max(max, Math.abs(expected - actual));
          }, 0)
        : 0;
    const earlyExit = merged.length >= input.questionCount && preExitDeviation <= 2;
    if (earlyExit) console.log(`[TP] early_exit count=${merged.length} deviation=${preExitDeviation} — skipping top-up and rebalance`);
    else if (merged.length >= input.questionCount) console.log(`[TP] early_exit_skipped deviation=${preExitDeviation} — proceeding to rebalance`);

    // ── STEP 2: Score-sort (teacher questions stay at front) ──────────────────
    const teacherSet = new Set(teacherQs.map((q) => normalizedHash(q.question)));
    const teacherMerged = merged.filter((q) => teacherSet.has(normalizedHash(q.question)));
    const llmMerged = merged
        .filter((q) => !teacherSet.has(normalizedHash(q.question)))
        .sort((a, b) => scoreQuestion(b) - scoreQuestion(a));
    merged = [...teacherMerged, ...llmMerged];

    // ── STEP 3: Category-aware top-up (AFTER filter) ──────────────────────────
    let topupUsed = false;

    // ── Helper: compute per-bucket targets accounting for teacher questions ────
    const computeBucketTargets = (
        totalTarget: number,
        diffDist: { easy: number; medium: number; hard: number },
        typeDist: { objective: number; subjective: number },
        existingTeacherQs: GeneratedQuestion[]
    ): Record<string, number> => {
        // Subtract teacher contributions from targets
        const teacherContrib: Record<string, number> = {};
        for (const q of existingTeacherQs) {
            const key = `${q.difficulty}+${q.type}`;
            teacherContrib[key] = (teacherContrib[key] || 0) + 1;
        }
        const targets: Record<string, number> = {};
        let assigned = 0;
        let maxKey = '', maxTarget = -1;
        const activeBuckets: string[] = [];
        for (const d of ['easy', 'medium', 'hard'] as const) {
            const dp = (diffDist[d] || 0) / 100;
            if (dp === 0) continue;
            for (const t of ['objective', 'subjective'] as const) {
                const tp = (typeDist[t] || 0) / 100;
                if (tp === 0) continue;
                const key = `${d}+${t}`;
                activeBuckets.push(key);
                const raw = Math.round(totalTarget * dp * tp);
                const adjusted = Math.max(0, raw - (teacherContrib[key] || 0));
                targets[key] = adjusted;
                assigned += adjusted;
                if (adjusted > maxTarget) { maxTarget = adjusted; maxKey = key; }
            }
        }
        // Floor: ensure every active bucket (non-zero %) gets at least 1 — only if total is large enough
        if (totalTarget >= activeBuckets.length) {
            for (const key of activeBuckets) {
                if (targets[key] === 0) {
                    targets[key] = 1;
                    assigned += 1;
                    if (maxKey && maxKey !== key && targets[maxKey] > 1) { targets[maxKey]--; }
                }
            }
        }
        // Correct rounding drift
        const llmTarget = Math.max(0, totalTarget - existingTeacherQs.length);
        const drift = llmTarget - assigned;
        if (maxKey && drift !== 0) targets[maxKey] = Math.max(0, targets[maxKey] + drift);
        return targets;
    };

    // ── STEP 3: Category-aware top-up (AFTER filter) ──────────────────────────
    if (!earlyExit && input.difficultyDistribution && input.typeDistribution) {
        const targets = computeBucketTargets(
            input.questionCount, input.difficultyDistribution, input.typeDistribution, teacherQs
        );
        const currentCounts: Record<string, number> = {};
        for (const q of merged.filter(q => !teacherSet.has(normalizedHash(q.question)))) {
            const key = `${q.difficulty}+${q.type}`;
            currentCounts[key] = (currentCounts[key] || 0) + 1;
        }
        const MAX_ATTEMPTS_PER_BUCKET = 2;
        const relaxedUsed: Record<string, number> = {}; // track relaxed questions added per bucket
        for (const [key, target] of Object.entries(targets)) {
            const have = currentCounts[key] || 0;
            let need = target - have;
            if (need <= 0) continue;
            const [d, t] = key.split('+') as ['easy' | 'medium' | 'hard', 'objective' | 'subjective'];
            let attemptsUsed = 0;

            // Attempt 1: strict category
            if (attemptsUsed < MAX_ATTEMPTS_PER_BUCKET) {
                attemptsUsed++;
                const seen1 = new Set<string>(merged.map(q => normalizedHash(q.question)));
                const extra1 = await generateTopUp(need, input, seen1, ctx, topicGroups, phrases, d, t);
                const valid1 = extra1.filter(q => scoreQuestion(q) >= 0 && (!topicGroups.length || isValidTopicStrict(q.question, topicGroups, phrases)));
                if (valid1.length > 0) { merged = [...merged, ...valid1]; topupUsed = true; need -= valid1.length; }
            }
            // Attempt 2: relax difficulty, cap relaxed questions at 30% of bucket target (global tracking)
            if (need > 0 && attemptsUsed < MAX_ATTEMPTS_PER_BUCKET) {
                attemptsUsed++;
                const relaxCap = Math.max(1, Math.ceil(target * 0.3));
                const alreadyRelaxed = relaxedUsed[key] || 0;
                const relaxAllowed = Math.max(0, relaxCap - alreadyRelaxed);
                if (relaxAllowed > 0) {
                    const relaxNeed = Math.min(need, relaxAllowed);
                    const seen2 = new Set<string>(merged.map(q => normalizedHash(q.question)));
                    const extra2 = await generateTopUp(relaxNeed, input, seen2, ctx, topicGroups, phrases, undefined, t);
                    const valid2 = extra2.filter(q => scoreQuestion(q) >= 0 && (!topicGroups.length || isValidTopicStrict(q.question, topicGroups, phrases)));
                    if (valid2.length > 0) {
                        merged = [...merged, ...valid2];
                        topupUsed = true;
                        need -= valid2.length;
                        relaxedUsed[key] = alreadyRelaxed + valid2.length;
                    }
                } else {
                    console.log(`[TP] relaxed_cap_reached bucket=${key} cap=${relaxCap}`);
                }
            }
            if (need > 0) {
                console.warn(`[TP] bucket_exhausted difficulty=${d} type=${t} still_missing=${need}`);
            }
        }
    } else if (!earlyExit && merged.length < input.questionCount) {
        // 3b. Simple top-up (no distribution specified)
        const missingCount = input.questionCount - merged.length;
        const topupSeen = new Set<string>(merged.map(q => normalizedHash(q.question)));
        const extra = await generateTopUp(missingCount, input, topupSeen, ctx, topicGroups, phrases);
        if (extra.length > 0) { merged = [...merged, ...extra.filter(q => scoreQuestion(q) >= 0 && (!topicGroups.length || isValidTopicStrict(q.question, topicGroups, phrases)))]; topupUsed = true; }
    }
    console.log(`[TP] after_distribution_topup=${merged.length}/${input.questionCount}`);

    // ── STEP 4: Distribution rebalance (trim only) ────────────────────────────
    if (!earlyExit) {
        merged = rebalanceDistribution(merged, input.questionCount, input.difficultyDistribution, input.typeDistribution);
    }

    // Post-rebalance deficit check: top-up any remaining category shortfall (1 more pass)
    if (!earlyExit && input.difficultyDistribution && input.typeDistribution) {
        const targets2 = computeBucketTargets(
            input.questionCount, input.difficultyDistribution, input.typeDistribution, teacherQs
        );
        const postCounts: Record<string, number> = {};
        for (const q of merged.filter(q => !teacherSet.has(normalizedHash(q.question)))) {
            const key = `${q.difficulty}+${q.type}`;
            postCounts[key] = (postCounts[key] || 0) + 1;
        }
        for (const [key, target] of Object.entries(targets2)) {
            if (ctx.llmFailureCount >= MAX_LLM_FAILURES) break;
            if (Date.now() - t0 > TOTAL_BUDGET_MS) {
                console.warn("[TP] budget_exceeded — returning best effort from dist_topup");
                break;
            }
            const have = postCounts[key] || 0;
            const need = target - have;
            if (need <= 0) continue;
            const [d, t] = key.split('+') as ['easy' | 'medium' | 'hard', 'objective' | 'subjective'];
            const seen3 = new Set<string>(merged.map(q => normalizedHash(q.question)));
            const extra3 = await generateTopUp(need, input, seen3, ctx, topicGroups, phrases, d, t);
            if (extra3.length > 0) { 
                const valid3 = extra3.filter(q => scoreQuestion(q) >= 0 && (!topicGroups.length || isValidTopicStrict(q.question, topicGroups, phrases)));
                merged = [...merged, ...valid3]; topupUsed = true; 
            }
        }
        merged = rebalanceDistribution(merged, input.questionCount, input.difficultyDistribution, input.typeDistribution);
    }

    // ── STEP 5: Hard cap + distribution-aware fill ────────────────────────────
    let allQuestions: GeneratedQuestion[] = merged
        .slice(0, input.questionCount)
        .map((q, i) => ({ ...q, questionNumber: i + 1 }));

    if (allQuestions.length < input.questionCount) {
        const usedHashes = new Set(allQuestions.map(q => normalizedHash(q.question)));
        const pool = [...teacherQs, ...llmQuestions].filter(q => {
            if (!q.question || q.question.length < 15) return false;
            const h = normalizedHash(q.question);
            if (usedHashes.has(h)) return false;
            usedHashes.add(h);
            return true;
        });

        // Prioritize missing-category questions first
        const fillNeeded = input.questionCount - allQuestions.length;
        let fillerPool: GeneratedQuestion[] = [];
        if (input.difficultyDistribution && input.typeDistribution) {
            const targets3 = computeBucketTargets(
                input.questionCount, input.difficultyDistribution, input.typeDistribution, teacherQs
            );
            const fillCounts: Record<string, number> = {};
            for (const q of allQuestions.filter(q => !teacherSet.has(normalizedHash(q.question)))) {
                const key = `${q.difficulty}+${q.type}`;
                fillCounts[key] = (fillCounts[key] || 0) + 1;
            }
            // Pick from missing categories first
            const prioritized = pool.filter(q => {
                const key = `${q.difficulty}+${q.type}`;
                return (fillCounts[key] || 0) < (targets3[key] || 0);
            });
            const fallbackPool = pool.filter(q => {
                const key = `${q.difficulty}+${q.type}`;
                return (fillCounts[key] || 0) >= (targets3[key] || 0);
            });
            fillerPool = [...prioritized, ...fallbackPool];
        } else {
            fillerPool = pool;
        }

        allQuestions = [
            ...allQuestions,
            ...fillerPool.slice(0, fillNeeded).map((q, i) => ({ ...q, questionNumber: allQuestions.length + i + 1 })),
        ];
    }

    // ── STEP 6: Absolute Guarantee (Contract Safety) ──────────────────────────
    const elapsed = Date.now() - t0;
    const SAFE_EXTRA_WINDOW = 5000; // 5 seconds buffer

    if (allQuestions.length < input.questionCount) {
        const remaining = input.questionCount - allQuestions.length;

        if (elapsed < TOTAL_BUDGET_MS + SAFE_EXTRA_WINDOW) {
            console.warn("[TP] final_fill_attempt remaining=", remaining);
            try {
                const usedHashes = new Set(allQuestions.map(q => normalizedHash(q.question)));
                const more = await generateTopUp(remaining, input, usedHashes, ctx, topicGroups, phrases);
                const valid = more.filter(q => {
                    if (isLowQuality({ question: q.question })) return false;
                    if (topicGroups.length > 0 && !isValidTopicStrict(q.question, topicGroups, phrases, true)) return false;
                    const h = normalizedHash(q.question);
                    if (usedHashes.has(h)) return false;
                    usedHashes.add(h);
                    return true;
                });
                allQuestions.push(...valid.map((q, i) => ({ ...q, questionNumber: allQuestions.length + i + 1 })));
            } catch (err: any) {
                console.error("[TP] final_fill_failed", err?.message);
            }
        } else {
            console.warn("[TP] skip_final_fill_due_to_timeout elapsed=", elapsed);
        }
    }

    // ── Final distribution validation ─────────────────────────────────────────
    const fallbackUsed = llmQuestions.length === 0 || stage1Results.flat().length < llmQuestions.length;
    const distActual = allQuestions.reduce((acc, q) => {
        acc[q.difficulty] = (acc[q.difficulty] || 0) + 1; return acc;
    }, {} as Record<string, number>);
    const distLog = Object.entries(distActual).map(([k, v]) => `${k}:${v}`).join(' ');
    const avgScore = allQuestions.length
        ? (allQuestions.reduce((s, q) => s + scoreQuestion(q), 0) / allQuestions.length).toFixed(2)
        : '0';

    // Check deviation against expected — tiered severity
    if (input.difficultyDistribution) {
        const dd = input.difficultyDistribution;
        const total = allQuestions.length;
        const expectedLog = (Object.entries(dd) as [string, number][])
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}:${Math.round(total * v / 100)}`).join(' ');
        const maxDev = (Object.entries(dd) as [string, number][]).reduce((max, [k, v]) => {
            const expected = Math.round(total * v / 100);
            const actual = distActual[k] || 0;
            return Math.max(max, Math.abs(expected - actual));
        }, 0);
        if (maxDev > 3) {
            console.warn(`[TP] final_distribution_drift high expected=${expectedLog} actual=${distLog} maxDev=${maxDev}`);
        } else if (maxDev > 2) {
            console.warn(`[TP] distribution_mismatch expected=${expectedLog} actual=${distLog}`);
        }
    }

    console.log(`[TP] request_hash=${requestHash} final=${allQuestions.length}/${input.questionCount} topup=${topupUsed} fallback=${fallbackUsed} cache=false`);
    
    if (allQuestions.length < input.questionCount) {
        if (allQuestions.length >= threshold) {
            console.log(`[TP] degraded_mode count=${allQuestions.length}/${input.questionCount}`);
        } else {
            console.warn(`[TP] severe_shortage count=${allQuestions.length}/${input.questionCount}`);
        }
    }

    console.log(`[TP] final_questions=${allQuestions.length}`);
    console.log(`[TP] distribution_actual=${distLog}`);
    console.log(`[TP] quality_score_avg=${avgScore}`);

    // Soft failure: return partial paper instead of throwing
    if (!allQuestions.length) {
        console.error("[TP] FINAL_ZERO_OUTPUT — ROOT CAUSE: LLM FAILURE OR OVER-STRICT FILTER");
        console.error('[TP] catastrophic_failure — returning minimal fallback');
        return {
            title: `${input.subject} - ${input.chapter} (Fallback)`,
            meta: {
                className: input.className,
                subject: input.subject,
                chapter: input.chapter || 'Multiple Chapters',
                targetExam: input.targetExam,
                questionType: input.questionType,
                difficultyLevel: input.difficultyLevel,
                totalQuestions: 1,
                totalMarks: input.marksPerQuestion || 1,
                durationMinutes: 5,
            },
            instructions: [],
            questions: [{
                questionNumber: 1,
                question: "Unable to generate questions matching the strict criteria. Please relax the topic constraints or try again.",
                type: "objective",
                difficulty: "easy",
                marks: input.marksPerQuestion || 1,
                options: ["Retry", "Change Topics", "Expand Chapters", "N/A"],
                answerKey: "Retry",
                solution: ""
            }],
        };
    }



    // Save AI questions to QuestionBank (fire-and-forget)
    Promise.all(
        llmQuestions.map((q) => {
            const hash = normalizedHash(q.question);
            return QuestionBank.updateOne(
                { questionHash: hash },
                {
                    $setOnInsert: {
                        schoolId: input.schoolId,
                        examType: input.targetExam,
                        className: input.className,
                        subject: input.subject,
                        chapter: (input.chapters?.[0] || input.chapter),
                        topic: input.topics || '',
                        difficulty: q.difficulty,
                        questionType: q.type,
                        source: 'ai',
                        question: q.question,
                        options: q.options || [],
                        answer: q.answerKey || '',
                        solution: q.solution || '',
                        questionHash: hash,
                    },
                },
                { upsert: true }
            );
        })
    ).catch(() => { /* non-critical */ });

    const totalMarks = allQuestions.reduce((s, q) => s + q.marks, 0);

    const objectiveQs = allQuestions.filter((q) => q.type === 'objective');
    const subjectiveQs = allQuestions.filter((q) => q.type === 'subjective');
    const sections: GeneratedTestPaper['sections'] = [];
    if (objectiveQs.length) sections.push({ type: 'objective', questions: objectiveQs });
    if (subjectiveQs.length) sections.push({ type: 'subjective', questions: subjectiveQs });

    const resolvedType: QuestionType =
        objectiveQs.length && subjectiveQs.length ? 'mixed' : objectiveQs.length ? 'objective' : 'subjective';

    const paper: GeneratedTestPaper = {
        title: `${String(input.targetExam).toUpperCase()} ${input.subject} Test Paper`,
        meta: {
            className: input.className,
            subject: input.subject,
            chapter: (input.chapters || [input.chapter]).join(', '),
            targetExam: input.targetExam,
            questionType: resolvedType,
            difficultyLevel: input.difficultyLevel,
            totalQuestions: allQuestions.length,
            totalMarks,
            durationMinutes: input.durationMinutes || 60,
        },
        instructions: [
            'Read all questions carefully.',
            objectiveQs.length ? 'For objective questions, choose one best option.' : '',
            subjectiveQs.length ? 'Write subjective answers clearly and stepwise.' : '',
            'Manage your time effectively.',
        ].filter(Boolean),
        questions: allQuestions,
        sections,
    };

    cacheSet(cacheKey, paper);
    return paper;
}

// ─── Meta (unchanged) ─────────────────────────────────────────────────────────

export async function getTestPaperMeta(input: {
    examType: TargetExam;
    className: string;
    subject?: string;
}): Promise<TestPaperMeta> {
    const classNum = Number(input.className);
    const defaultTargetExamOptions: TargetExam[] =
        Number.isFinite(classNum) && classNum >= 11
            ? ['boards', 'jee', 'neet']
            : ['boards'];

    const syllabus = getSyllabusByClassAndExam(input.className, input.examType as any);
    const subjectFromClass = (): string[] => Object.keys(syllabus);
    const subjectRegex = input.subject ? new RegExp(`^${input.subject}$`, 'i') : undefined;
    const baseFilter: Record<string, unknown> = { examType: input.examType, className: input.className };
    if (subjectRegex) baseFilter.subject = subjectRegex;

    const [bankRows, weightRows] = await Promise.all([
        QuestionBank.find(baseFilter).select('subject chapter topic').lean(),
        TopicWeightage.find(baseFilter).select('subject chapter topic').lean(),
    ]);

    const subjects = new Set<string>();
    const topicsByChapter: Record<string, string[]> = {};
    const addRow = (subject?: string, chapter?: string, topic?: string) => {
        const s = String(subject || '').trim();
        const c = String(chapter || '').trim();
        const t = String(topic || '').trim();
        if (s) subjects.add(s);
        if (!c) return;
        if (!topicsByChapter[c]) topicsByChapter[c] = [];
        if (t && !topicsByChapter[c].includes(t)) topicsByChapter[c].push(t);
    };

    bankRows.forEach((r: any) => addRow(r.subject, r.chapter, r.topic));
    weightRows.forEach((r: any) => addRow(r.subject, r.chapter, r.topic));

    const sortedSubjects = [...subjects].sort((a, b) => a.localeCompare(b));
    const resolvedSubjects = sortedSubjects.length ? sortedSubjects : subjectFromClass();

    const addStaticChapters = (subjectName: string) => {
        const chapterTopicMap = syllabus[subjectName] || {};
        Object.entries(chapterTopicMap).forEach(([ch, topics]) => {
            if (!topicsByChapter[ch]) topicsByChapter[ch] = [];
            (topics || []).forEach((t) => {
                if (!topicsByChapter[ch].includes(t)) topicsByChapter[ch].push(t);
            });
        });
    };

    if (input.subject) {
        const matched = resolvedSubjects.find((s) => s.toLowerCase() === String(input.subject).toLowerCase()) || input.subject;
        addStaticChapters(matched);
    } else {
        resolvedSubjects.forEach(addStaticChapters);
    }

    return {
        subjects: resolvedSubjects,
        targetExamOptions: defaultTargetExamOptions,
        chapters: Object.keys(topicsByChapter).sort((a, b) => a.localeCompare(b)),
        topicsByChapter,
    };
}

// ─── PDF (unchanged) ──────────────────────────────────────────────────────────

export async function generateTestPaperPdfBuffer(
    paper: GeneratedTestPaper,
    schoolName = 'School'
): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    doc.font('Helvetica-Bold').fontSize(16).text(schoolName, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(13).text(paper.title || 'Test Paper', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Class: ${paper.meta.className}   Subject: ${paper.meta.subject}   Chapter: ${paper.meta.chapter}`);
    doc.text(`Type: ${paper.meta.questionType}   Difficulty: ${paper.meta.difficultyLevel}   Exam: ${paper.meta.targetExam}`);
    doc.text(`Total Questions: ${paper.meta.totalQuestions}   Total Marks: ${paper.meta.totalMarks}   Duration: ${paper.meta.durationMinutes} mins`);
    doc.moveDown();

    if (paper.instructions?.length) {
        doc.font('Helvetica-Bold').text('Instructions:');
        doc.font('Helvetica');
        paper.instructions.forEach((line) => doc.text(`- ${line}`));
        doc.moveDown(0.8);
    }

    const renderSectionHeader = (label: string) => {
        doc.font('Helvetica-Bold').fontSize(11).text(`Section: ${label}`, { underline: true });
        doc.font('Helvetica').fontSize(10);
        doc.moveDown(0.4);
    };

    if (paper.sections?.length) {
        for (const section of paper.sections) {
            renderSectionHeader(section.type === 'objective' ? 'Objective (MCQ)' : 'Subjective');
            section.questions.forEach((q) => {
                doc.font('Helvetica-Bold').text(`Q${q.questionNumber}. (${q.marks} marks, ${q.difficulty})`);
                doc.font('Helvetica').text(q.question);
                if (q.options?.length) {
                    q.options.forEach((opt, idx) => doc.text(`   ${String.fromCharCode(65 + idx)}. ${opt}`));
                }
                doc.moveDown(0.6);
            });
        }
    } else {
        paper.questions.forEach((q) => {
            doc.font('Helvetica-Bold').text(`Q${q.questionNumber}. (${q.marks} marks, ${q.difficulty})`);
            doc.font('Helvetica').text(q.question);
            if (q.options?.length) {
                q.options.forEach((opt, idx) => doc.text(`   ${String.fromCharCode(65 + idx)}. ${opt}`));
            }
            doc.moveDown(0.6);
        });
    }

    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).text('Answer Key', { align: 'center' });
    doc.moveDown(0.8);
    paper.questions.forEach((q) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`Q${q.questionNumber}:`, { continued: true });
        doc.font('Helvetica').text(` ${q.answerKey || '—'}`);
    });

    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).text('Solutions', { align: 'center' });
    doc.moveDown(0.8);
    paper.questions.forEach((q) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`Q${q.questionNumber}. ${q.question}`);
        doc.font('Helvetica').fontSize(10).text(q.solution || q.answerKey || 'No solution provided.');
        doc.moveDown(0.5);
    });

    doc.end();
    return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}
