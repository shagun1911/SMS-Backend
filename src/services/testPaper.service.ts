import { generateWithGemini } from '../utils/gemini';
import { generateWithGroq } from '../utils/groq';
// @ts-ignore - pdfkit may not have types
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import QuestionBank from '../models/questionBank.model';
import TopicWeightage from '../models/topicWeightage.model';
import { getSyllabusByClassAndExam } from '../data/syllabusCatalog';

export type QuestionType = 'objective' | 'subjective' | 'mixed';
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'mixed';
export type TargetExam = 'boards' | 'jee' | 'neet' | 'school';
export type SeniorTrack = 'boards' | 'competitive';
export type ExamPattern = 'pyq' | 'conceptual' | 'mixed';
export type CoachingStyle = 'allen' | 'fiitjee' | 'aakash';

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
}

export interface TestPaperMeta {
    subjects: string[];
    targetExamOptions: TargetExam[];
    chapters: string[];
    topicsByChapter: Record<string, string[]>;
}

function cleanText(text: string): string {
    return String(text || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isPlaceholderQuestionText(text: string): boolean {
    const t = String(text || '').toLowerCase().trim();
    return (
        /mcq question\s*\d+\s*for class/i.test(t) ||
        /physics\s*\(.*\)\s*mcq question/i.test(t) ||
        /^question\s*\d+$/i.test(t) ||
        t.includes('generated fallback question')
    );
}

function isPlaceholderOptions(options?: string[]): boolean {
    if (!options || options.length < 4) return false;
    const cleaned = options.map((o) => String(o || '').toLowerCase().trim());
    return cleaned[0] === 'option a' && cleaned[1] === 'option b' && cleaned[2] === 'option c' && cleaned[3] === 'option d';
}

function isLowQualityQuestion(q: {
    question?: string;
    options?: string[];
    answerKey?: string;
    solution?: string;
}): boolean {
    const question = cleanText(q.question || '');
    if (!question || question.length < 20) return true;
    if (isPlaceholderQuestionText(question)) return true;
    if (isPlaceholderOptions(q.options) && String(q.answerKey || '').toLowerCase().trim() === 'option a') return true;
    if (String(q.solution || '').toLowerCase().includes('generated fallback')) return true;
    if ((q.question || '').includes('�')) return true;
    return false;
}

function examLevelTokens(exam: TargetExam, difficulty: DifficultyLevel): string[] {
    if (exam === 'jee') {
        return difficulty === 'hard'
            ? ['multi-step', 'advanced', 'numerical', 'concept', 'application']
            : ['numerical', 'concept', 'application'];
    }
    if (exam === 'neet') {
        return difficulty === 'hard'
            ? ['assertion', 'reason', 'ncert line', 'application', 'diagram']
            : ['ncert', 'concept', 'biology'];
    }
    return difficulty === 'hard'
        ? ['case', 'higher order', 'competency']
        : ['syllabus', 'board pattern'];
}

function looksExamLevel(question: string, exam: TargetExam, difficulty: DifficultyLevel): boolean {
    const q = cleanText(question).toLowerCase();
    const tokens = examLevelTokens(exam, difficulty);
    if (difficulty === 'hard') {
        return q.length >= 55 || tokens.some((t) => q.includes(t));
    }
    return q.length >= 35;
}

async function generateAI(prompt: string): Promise<string> {
    const groqResult = await generateWithGroq(prompt);
    if (groqResult) return groqResult;
    return generateWithGemini(prompt);
}

function extractFirstJsonObject(input: string): string | null {
    const text = input || '';
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === '{') {
            if (start === -1) start = i;
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0 && start !== -1) return text.slice(start, i + 1);
        }
    }
    return null;
}

function tryParseJson(raw: string): GeneratedTestPaper | null {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const firstObject = extractFirstJsonObject(raw) || '';
    const firstArrayMatch = raw.match(/\[[\s\S]*\]/);
    const firstArray = firstArrayMatch ? firstArrayMatch[0] : '';
    const candidates = [fenced ? fenced[1] : '', raw, firstObject, firstArray].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const cleaned = candidate
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, "'")
                .replace(/,\s*([}\]])/g, '$1')
                .trim();
            const parsed = JSON.parse(cleaned);
            if (parsed && Array.isArray(parsed.questions)) {
                return parsed as GeneratedTestPaper;
            }
            if (Array.isArray(parsed)) {
                return {
                    title: 'Generated Test Paper',
                    meta: {
                        className: '',
                        subject: '',
                        chapter: '',
                        targetExam: '',
                        questionType: 'mixed',
                        difficultyLevel: 'mixed',
                        totalQuestions: parsed.length,
                        totalMarks: parsed.reduce((sum: number, q: any) => sum + Number(q?.marks || 1), 0),
                        durationMinutes: 60,
                    },
                    instructions: ['Read all questions carefully.'],
                    questions: parsed.map((q: any, idx: number) => ({
                        questionNumber: idx + 1,
                        question: String(q?.question || q?.prompt || `Question ${idx + 1}`),
                        type: (q?.type === 'subjective' ? 'subjective' : 'objective') as 'objective' | 'subjective',
                        difficulty: (q?.difficulty === 'easy' || q?.difficulty === 'medium' || q?.difficulty === 'hard' ? q.difficulty : 'medium') as 'easy' | 'medium' | 'hard',
                        marks: Number(q?.marks || 1),
                        options: Array.isArray(q?.options) ? q.options.map((x: any) => String(x)) : [],
                        answerKey: String(q?.answerKey || q?.answer || ''),
                        solution: String(q?.solution || ''),
                    })),
                };
            }
        } catch (_e) {
            // try next candidate
        }
    }
    return null;
}

function parseModelJson(raw: string): GeneratedTestPaper | null {
    return tryParseJson(raw);
}

function parseQuestionsFromPlainText(text: string, input: GenerateTestPaperInput, count: number): GeneratedQuestion[] {
    const difficulties = difficultyMix(input.difficultyLevel, count);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const questions: GeneratedQuestion[] = [];
    let current: GeneratedQuestion | null = null;

    const pushCurrent = () => {
        if (!current) return;
        if (!current.question) return;
        if (current.type === 'objective' && (!current.options || current.options.length < 2)) {
            current.options = ['Option A', 'Option B', 'Option C', 'Option D'];
        }
        questions.push(current);
    };

    for (const line of lines) {
        const qMatch = line.match(/^(Q(?:uestion)?\s*\d+[\)\:\.\-]?\s*)(.*)$/i);
        if (qMatch) {
            pushCurrent();
            const index = questions.length;
            const type: 'objective' | 'subjective' =
                input.questionType === 'mixed'
                    ? (index % 2 === 0 ? 'objective' : 'subjective')
                    : (input.questionType as 'objective' | 'subjective');
            current = {
                questionNumber: index + 1,
                question: qMatch[2] || `Question ${index + 1}`,
                type,
                difficulty: difficulties[Math.min(index, difficulties.length - 1)] || 'medium',
                marks: input.marksPerQuestion || 1,
                options: [],
                answerKey: '',
                solution: '',
            };
            continue;
        }
        if (!current) continue;

        if (/^[A-D][\)\.\:\-]\s*/i.test(line)) {
            current.options = current.options || [];
            current.options.push(line.replace(/^[A-D][\)\.\:\-]\s*/i, '').trim());
            continue;
        }
        if (/^(answer|correct answer)\s*[:\-]/i.test(line)) {
            current.answerKey = line.replace(/^(answer|correct answer)\s*[:\-]\s*/i, '').trim();
            continue;
        }
        if (/^(solution|explanation)\s*[:\-]/i.test(line)) {
            current.solution = line.replace(/^(solution|explanation)\s*[:\-]\s*/i, '').trim();
            continue;
        }
        if (!current.solution) {
            current.solution = line;
        }
    }
    pushCurrent();

    return questions.slice(0, count).map((q, i) => ({
        ...q,
        questionNumber: i + 1,
        options: q.type === 'objective' ? (q.options && q.options.length ? q.options.slice(0, 4) : ['Option A', 'Option B', 'Option C', 'Option D']) : [],
        answerKey: q.answerKey || (q.type === 'objective' ? 'Option A' : 'Expected key points'),
        solution: q.solution || 'Stepwise solution expected.',
    }));
}

function normalizedHash(text: string): string {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function difficultyMix(level: DifficultyLevel, count: number): Array<'easy' | 'medium' | 'hard'> {
    if (level === 'easy') return Array(count).fill('easy');
    if (level === 'hard') return Array(count).fill('hard');
    if (level === 'medium') return Array(count).fill('medium');
    const easy = Math.round(count * 0.3);
    const hard = Math.round(count * 0.2);
    const medium = Math.max(0, count - easy - hard);
    return [...Array(easy).fill('easy'), ...Array(medium).fill('medium'), ...Array(hard).fill('hard')];
}

function buildPrompt(input: GenerateTestPaperInput): string {
    const weightageHints = input.prioritizeRepeated
        ? 'Bias question selection toward high-frequency topics and repeatedly asked sub-concepts.'
        : 'Use balanced topic spread.';
    const examSpecificGuidance =
        input.targetExam === 'jee'
            ? 'JEE STYLE MANDATORY: Physics/Chemistry/Math should be calculation-heavy and concept-combination based. Use exam-grade distractors. No trivial school-level questions.'
            : input.targetExam === 'neet'
                ? 'NEET STYLE MANDATORY: Include NCERT-aligned conceptual and statement-based MCQs with biological precision and high-yield medical entrance patterns.'
                : 'BOARDS STYLE MANDATORY: Follow board exam pattern with competency-based and stepwise answer expectation.';
    return `
You are an expert exam paper setter for Indian schools and competitive exams.

Create the BEST quality test paper with highly relevant, exam-oriented questions.
Use:
- syllabus alignment,
- commonly repeated patterns,
- previous-year inspired styles (without copying copyrighted text verbatim),
- balanced difficulty based on input,
- clean question language suitable for students.
- coaching style flavor where requested (Allen/FIITJEE/Aakash).
- each question should include a concise solution.
- Use plain ASCII symbols only. Avoid malformed unicode characters.
- ${examSpecificGuidance}

STRICT OUTPUT FORMAT:
- Return only valid JSON (no markdown) matching this exact shape:
{
  "title": "string",
  "meta": {
    "className": "string",
    "subject": "string",
    "chapter": "string",
    "targetExam": "string",
    "questionType": "objective|subjective|mixed",
    "difficultyLevel": "easy|medium|hard|mixed",
    "totalQuestions": number,
    "totalMarks": number,
    "durationMinutes": number
  },
  "instructions": ["string"],
  "questions": [
    {
      "questionNumber": number,
      "question": "string",
      "type": "objective|subjective",
      "difficulty": "easy|medium|hard",
      "marks": number,
      "options": ["string", "string", "string", "string"],
      "answerKey": "string",
      "solution": "string"
    }
  ]
}

RULES:
- Total questions must be exactly ${input.questionCount}.
- For objective questions, include exactly 4 options.
- For subjective questions, omit options.
- Keep answerKey concise (single best answer or expected key points).
- Mix easy/medium/hard as requested by difficulty level.
- If questionType is mixed, include both objective and subjective.
- Avoid duplicated questions.
- Keep wording age-appropriate for class ${input.className}.
- ${weightageHints}

INPUT CONTEXT:
- School: ${input.schoolName || 'School'}
- Class: ${input.className}
- Subject: ${input.subject}
- Target Exam: ${input.targetExam}
- Senior Track (if class 11/12): ${input.seniorTrack || 'n/a'}
- Chapter: ${input.chapter}
- Chapters selected: ${(input.chapters || [input.chapter]).join(', ')}
- Include whole chapter: ${input.includeWholeChapter ? 'yes' : 'no'}
- Focus topics (if any): ${input.topics || 'n/a'}
- Topics by chapter: ${JSON.stringify(input.topicsByChapter || {})}
- Question type: ${input.questionType}
- Difficulty: ${input.difficultyLevel}
- Question count: ${input.questionCount}
- Exam Pattern: ${input.examPattern || 'mixed'}
- Coaching styles: ${(input.coachingStyles || []).join(', ') || 'none'}
- Include previous-year style: ${input.includePreviousYear ? 'yes' : 'no'}
- Prioritize repeated/hot questions: ${input.prioritizeRepeated ? 'yes' : 'no'}
- Duration (minutes): ${input.durationMinutes || 60}
- Marks per question: ${input.marksPerQuestion || 1}
- Special instructions: ${input.specialInstructions || 'n/a'}
`.trim();
}

async function generateAndParseAI(input: GenerateTestPaperInput): Promise<GeneratedTestPaper | null> {
    const prompt = buildPrompt(input);
    const raw = await generateAI(prompt);
    let parsed: GeneratedTestPaper | null = parseModelJson(raw);
    if (!parsed) {
        const repairPrompt = [
            'Convert the following content into strict valid JSON only.',
            'Do not include markdown fences.',
            'Do not add any explanation text.',
            'Keep the same schema and values where possible.',
            '',
            raw,
        ].join('\n');
        const repaired = await generateAI(repairPrompt);
        parsed = parseModelJson(repaired);
    }
    return parsed;
}

export async function generateTestPaper(input: GenerateTestPaperInput): Promise<GeneratedTestPaper> {
    const selectedChapters = (input.chapters && input.chapters.length ? input.chapters : [input.chapter])
        .map((c) => String(c).trim())
        .filter(Boolean);
    const selectedTypes =
        input.questionType === 'mixed' ? ['objective', 'subjective'] : [input.questionType];
    const wantedDifficulties = difficultyMix(input.difficultyLevel, input.questionCount);
    const schoolFilter = input.schoolId ? [{ schoolId: input.schoolId }, { schoolId: { $exists: false } }] : [{ schoolId: { $exists: false } }];

    const bankRows = await QuestionBank.find({
        examType: input.targetExam,
        className: input.className,
        subject: new RegExp(`^${input.subject}$`, 'i'),
        chapter: { $in: selectedChapters.map((c) => new RegExp(`^${c}$`, 'i')) },
        questionType: { $in: selectedTypes },
        $or: schoolFilter,
    })
        .sort({ usageCount: 1, createdAt: -1 })
        .limit(Math.max(input.questionCount * 2, 40))
        .lean();

    const picked: GeneratedQuestion[] = [];
    const seen = new Set<string>();

    for (const row of bankRows) {
        if (picked.length >= input.questionCount) break;
        if (isLowQualityQuestion({ question: row.question, options: row.options || [], answerKey: row.answer, solution: row.solution })) {
            continue;
        }
        const hash = normalizedHash(row.question);
        if (seen.has(hash)) continue;
        seen.add(hash);
        picked.push({
            questionNumber: picked.length + 1,
            question: row.question,
            type: row.questionType as 'objective' | 'subjective',
            difficulty: row.difficulty as 'easy' | 'medium' | 'hard',
            marks: input.marksPerQuestion || 1,
            options: row.options || [],
            answerKey: row.answer,
            solution: row.solution,
        });
    }

    const remaining = input.questionCount - picked.length;
    if (remaining > 0) {
        const aiInput: GenerateTestPaperInput = { ...input, questionCount: remaining };
        let parsed: GeneratedTestPaper | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            parsed = await generateAndParseAI(aiInput);
            if (!parsed?.questions?.length) continue;
            const examReadyCount = parsed.questions.filter((q) =>
                looksExamLevel(q.question || '', input.targetExam, input.difficultyLevel)
            ).length;
            if (examReadyCount >= Math.max(1, Math.floor(remaining * 0.6))) break;
        }
        if (!parsed?.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
            const plainPrompt = [
                `Generate exactly ${remaining} ${input.subject} questions for class ${input.className}.`,
                `Chapters: ${selectedChapters.join(', ')}. Topic focus: ${input.includeWholeChapter ? 'complete chapter' : (input.topics || input.chapter)}.`,
                `Question type: ${input.questionType}. Difficulty: ${input.difficultyLevel}.`,
                'Return plain text only in this format per question:',
                'Q1: <question>',
                'A) <option>',
                'B) <option>',
                'C) <option>',
                'D) <option>',
                'Answer: <correct>',
                'Solution: <short solution>',
            ].join('\n');
            const plain = await generateAI(plainPrompt);
            const parsedQuestions = parseQuestionsFromPlainText(plain, input, remaining).filter((q) =>
                !isLowQualityQuestion({
                    question: q.question,
                    options: q.options || [],
                    answerKey: q.answerKey,
                    solution: q.solution,
                })
            );
            if (!parsedQuestions.length) {
                throw new Error('AI generation failed. Please retry with a different chapter/topic.');
            }
            parsed = {
                title: `${input.targetExam.toUpperCase()} ${input.subject} Test Paper`,
                meta: {
                    className: input.className,
                    subject: input.subject,
                    chapter: input.chapter,
                    targetExam: input.targetExam,
                    questionType: input.questionType,
                    difficultyLevel: input.difficultyLevel,
                    totalQuestions: parsedQuestions.length,
                    totalMarks: parsedQuestions.reduce((sum, q) => sum + (q.marks || 0), 0),
                    durationMinutes: input.durationMinutes || 60,
                },
                instructions: ['Read all questions carefully.'],
                questions: parsedQuestions,
            };
        }

        for (const q of parsed.questions) {
            if (picked.length >= input.questionCount) break;
            if (isLowQualityQuestion({ question: q.question, options: q.options || [], answerKey: q.answerKey, solution: q.solution })) {
                continue;
            }
            if (!looksExamLevel(q.question || '', input.targetExam, input.difficultyLevel)) {
                continue;
            }
            const hash = normalizedHash(q.question || '');
            if (!q?.question || seen.has(hash)) continue;
            seen.add(hash);
            picked.push({
                questionNumber: picked.length + 1,
                question: cleanText(q.question),
                type: q.type,
                difficulty: q.difficulty || wantedDifficulties[Math.min(picked.length, wantedDifficulties.length - 1)] || 'medium',
                marks: q.marks || input.marksPerQuestion || 1,
                options: (q.options || []).map((o) => cleanText(String(o))),
                answerKey: cleanText(q.answerKey || ''),
                solution: cleanText(q.solution || ''),
            });
            await QuestionBank.updateOne(
                { questionHash: hash },
                {
                    $setOnInsert: {
                        schoolId: input.schoolId,
                        examType: input.targetExam,
                        className: input.className,
                        subject: input.subject,
                        chapter: selectedChapters[0] || input.chapter,
                        topic: input.topics || '',
                        difficulty: q.difficulty || 'medium',
                        questionType: q.type,
                        source: 'ai',
                        coachingStyle: input.coachingStyles?.[0],
                        question: cleanText(q.question),
                        options: (q.options || []).map((o) => cleanText(String(o))),
                        answer: cleanText(q.answerKey || ''),
                        solution: cleanText(q.solution || ''),
                        questionHash: hash,
                    },
                },
                { upsert: true }
            );
        }
    }

    await Promise.all(
        picked.map((q) =>
            QuestionBank.updateOne({ questionHash: normalizedHash(q.question) }, { $inc: { usageCount: 1 } })
        )
    );

    const totalMarks = picked.reduce((sum, q) => sum + (q.marks || 0), 0);
    if (!picked.length) {
        throw new Error('No valid questions were generated. Please retry with a different chapter/topic.');
    }
    return {
        title: `${input.targetExam.toUpperCase()} ${input.subject} Test Paper`,
        meta: {
            className: input.className,
            subject: input.subject,
            chapter: selectedChapters.join(', '),
            targetExam: input.targetExam,
            questionType: input.questionType,
            difficultyLevel: input.difficultyLevel,
            totalQuestions: picked.length,
            totalMarks,
            durationMinutes: input.durationMinutes || 60,
        },
        instructions: [
            'Read all questions carefully.',
            input.questionType !== 'subjective' ? 'For objective questions, mark one best option.' : 'Answer each question clearly and stepwise.',
            'Manage time effectively.',
        ],
        questions: picked.map((q) => ({
            ...q,
            question: cleanText(q.question),
            options: (q.options || []).map((o) => cleanText(o)),
            answerKey: cleanText(q.answerKey || ''),
            solution: cleanText(q.solution || ''),
        })),
    };
}

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

    const syllabus = getSyllabusByClassAndExam(input.className, input.examType);
    const subjectFromClass = (): string[] => Object.keys(syllabus);

    const subjectRegex = input.subject ? new RegExp(`^${input.subject}$`, 'i') : undefined;
    const baseFilter: Record<string, unknown> = {
        examType: input.examType,
        className: input.className,
    };
    if (subjectRegex) baseFilter.subject = subjectRegex;

    const [bankRows, weightRows] = await Promise.all([
        QuestionBank.find(baseFilter)
            .select('subject chapter topic')
            .lean(),
        TopicWeightage.find(baseFilter)
            .select('subject chapter topic')
            .lean(),
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

    // Merge static syllabus chapters/topics so dropdowns are always populated.
    const addStaticChapters = (subjectName: string) => {
        const chapterTopicMap = syllabus[subjectName] || {};
        Object.entries(chapterTopicMap).forEach(([chapterName, topics]) => {
            if (!topicsByChapter[chapterName]) topicsByChapter[chapterName] = [];
            (topics || []).forEach((topic) => {
                if (!topicsByChapter[chapterName].includes(topic)) topicsByChapter[chapterName].push(topic);
            });
        });
    };

    if (input.subject) {
        const resolvedSubject =
            resolvedSubjects.find((s) => s.toLowerCase() === String(input.subject).toLowerCase()) || input.subject;
        addStaticChapters(resolvedSubject);
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
    doc.text(
        `Type: ${paper.meta.questionType}   Difficulty: ${paper.meta.difficultyLevel}   Exam: ${paper.meta.targetExam}`
    );
    doc.text(`Total Questions: ${paper.meta.totalQuestions}   Total Marks: ${paper.meta.totalMarks}   Duration: ${paper.meta.durationMinutes} mins`);
    doc.moveDown();

    if (paper.instructions?.length) {
        doc.font('Helvetica-Bold').text('Instructions:');
        doc.font('Helvetica');
        paper.instructions.forEach((line) => doc.text(`- ${line}`));
        doc.moveDown(0.8);
    }

    paper.questions.forEach((q) => {
        doc.font('Helvetica-Bold').text(`Q${q.questionNumber}. (${q.marks} marks, ${q.difficulty})`);
        doc.font('Helvetica').text(q.question);
        if (q.options?.length) {
            q.options.forEach((opt, idx) => {
                const label = String.fromCharCode(65 + idx);
                doc.text(`   ${label}. ${opt}`);
            });
        }
        doc.moveDown(0.6);
    });

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
