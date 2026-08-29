export type QuizQuestionType =
  | 'mcq'
  | 'multi_statement'
  | 'assertion_reason'
  | 'match'
  | 'sequence'
  | 'fill_blank'
  | 'true_false'
  | 'short_answer'
  | 'passage';

export interface QuizQuestionPair {
  left: string;
  right: string;
}

export interface QuizQuestionItem {
  id?: string;
  text: string;
}

export interface QuizQuestionMedia {
  type: 'image' | 'diagram' | 'map';
  uri: string;
  caption?: string;
}

export interface QuizQuestionEnvelope {
  id?: string;
  question?: string;
  question_text?: string;
  prompt?: string;
  question_type?: QuizQuestionType;
  options?: string[];
  answer_index?: number;
  answer_key?: Array<number | string>;
  explanation?: string;
  difficulty?: string;
  statements?: string[];
  pairs?: QuizQuestionPair[];
  items?: QuizQuestionItem[];
  sequence?: string[];
  blank_answer?: string;
  answer_text?: string;
  passage?: string;
  media?: QuizQuestionMedia;
  source?: string;
  source_tier?: string;
  source_type?: string;
  lesson_id?: string;
  chapter?: string;
  subject?: string;
  class?: string;
  exam_types?: string[];
}

export type QuizQuestionResponse =
  | { type: 'mcq'; selectedIndex: number }
  | { type: 'fill_blank'; text: string }
  | { type: 'match'; mapping: number[] }
  | { type: 'sequence'; order: number[] };

export interface QuizEvaluation {
  isCorrect: boolean;
  selectedLabel?: string;
  correctLabel?: string;
  responseSummary?: string;
  answerSummary?: string;
  selectedIndex?: number;
  correctIndex?: number;
}

const normalizeText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function inferQuestionType(question: QuizQuestionEnvelope): QuizQuestionType {
  if (question.question_type) return question.question_type;
  if (Array.isArray(question.pairs) && question.pairs.length > 0) return 'match';
  if (Array.isArray(question.sequence) && question.sequence.length > 0) return 'sequence';
  if (Array.isArray(question.items) && question.items.length > 0) return 'sequence';
  if (question.blank_answer || question.answer_text) return 'fill_blank';
  if (Array.isArray(question.statements) && question.statements.length > 0) return 'multi_statement';
  const prompt = normalizeText(question.question || question.question_text || question.prompt);
  if (prompt.includes('true or false')) return 'true_false';
  return 'mcq';
}

export function normalizeQuizQuestion(raw: any): QuizQuestionEnvelope | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;

    const question = parsed.question_text || parsed.question || parsed.prompt;
    const passage = parsed.passage;
    const options = toArray<string>(parsed.options).filter((option) => option !== undefined && option !== null).map(String);
    const answerIndex =
      typeof parsed.correct_answer === 'number'
        ? parsed.correct_answer
        : typeof parsed.answer_index === 'number'
          ? parsed.answer_index
          : undefined;

    const normalized: QuizQuestionEnvelope = {
      id: parsed.id,
      question: question ? String(question) : passage ? String(passage) : '',
      question_text: parsed.question_text ? String(parsed.question_text) : undefined,
      prompt: parsed.prompt ? String(parsed.prompt) : undefined,
      question_type: parsed.question_type || parsed.type,
      options: options.length > 0 ? options : undefined,
      answer_index: answerIndex,
      answer_key: Array.isArray(parsed.answer_key) ? parsed.answer_key : undefined,
      explanation: parsed.explanation ? String(parsed.explanation) : undefined,
      difficulty: parsed.difficulty,
      statements: Array.isArray(parsed.statements) ? parsed.statements.map(String) : undefined,
      pairs: Array.isArray(parsed.pairs)
        ? parsed.pairs
            .map((pair: any) => ({
              left: String(pair?.left ?? pair?.question ?? pair?.term ?? ''),
              right: String(pair?.right ?? pair?.match ?? pair?.answer ?? ''),
            }))
            .filter((pair: QuizQuestionPair) => pair.left && pair.right)
        : undefined,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .map((item: any) => ({
              id: item?.id ? String(item.id) : undefined,
              text: String(item?.text ?? item?.label ?? item ?? ''),
            }))
            .filter((item: QuizQuestionItem) => item.text)
        : undefined,
      sequence: Array.isArray(parsed.sequence) ? parsed.sequence.map(String) : undefined,
      blank_answer: parsed.blank_answer ? String(parsed.blank_answer) : undefined,
      answer_text: parsed.answer_text ? String(parsed.answer_text) : undefined,
      passage: passage ? String(passage) : undefined,
      media: parsed.media && typeof parsed.media === 'object'
        ? {
            type: parsed.media.type,
            uri: String(parsed.media.uri ?? ''),
            caption: parsed.media.caption ? String(parsed.media.caption) : undefined,
          }
        : undefined,
      source: parsed.source ? String(parsed.source) : undefined,
      source_tier: parsed.source_tier ? String(parsed.source_tier) : undefined,
      source_type: parsed.source_type ? String(parsed.source_type) : undefined,
      lesson_id: parsed.lesson_id ? String(parsed.lesson_id) : undefined,
      chapter: parsed.chapter ? String(parsed.chapter) : undefined,
      subject: parsed.subject ? String(parsed.subject) : undefined,
      class: parsed.class ? String(parsed.class) : undefined,
      exam_types: Array.isArray(parsed.exam_types) ? parsed.exam_types.map(String) : undefined,
    };

    normalized.question_type = normalized.question_type || inferQuestionType(normalized);
    if (!normalized.question && normalized.passage) {
      normalized.question = normalized.passage;
    }
    if (!normalized.question) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function evaluateQuizQuestion(
  question: QuizQuestionEnvelope,
  response: QuizQuestionResponse,
): QuizEvaluation {
  const type = inferQuestionType(question);
  if (type === 'fill_blank') {
    const correct = normalizeText(question.blank_answer || question.answer_text);
    const selected = normalizeText(response.type === 'fill_blank' ? response.text : '');
    return {
      isCorrect: !!correct && correct === selected,
      selectedLabel: response.type === 'fill_blank' ? response.text : '',
      correctLabel: question.blank_answer || question.answer_text || '',
      responseSummary: response.type === 'fill_blank' ? response.text : '',
      answerSummary: question.blank_answer || question.answer_text || '',
    };
  }

  if (type === 'match') {
    const expected = toArray<number | string>(question.answer_key).map((item) => String(item));
    const selected = response.type === 'match' ? response.mapping.map((item) => String(item)) : [];
    const isCorrect =
      expected.length > 0 &&
      expected.length === selected.length &&
      expected.every((item, idx) => item === selected[idx]);
    return {
      isCorrect,
      responseSummary: selected.join(', '),
      answerSummary: expected.join(', '),
    };
  }

  if (type === 'sequence') {
    const expected = toArray<number | string>(question.answer_key?.length ? question.answer_key : question.sequence).map((item) => String(item));
    const selected = response.type === 'sequence' ? response.order.map((item) => String(item)) : [];
    const isCorrect =
      expected.length > 0 &&
      expected.length === selected.length &&
      expected.every((item, idx) => item === selected[idx]);
    return {
      isCorrect,
      responseSummary: selected.join(' > '),
      answerSummary: expected.join(' > '),
    };
  }

  const selectedIndex = response.type === 'mcq' ? response.selectedIndex : -1;
  const correctIndex = typeof question.answer_index === 'number'
    ? question.answer_index
    : Array.isArray(question.answer_key) && question.answer_key.length > 0 && typeof question.answer_key[0] === 'number'
      ? Number(question.answer_key[0])
      : 0;
  const options = question.options || [];
  return {
    isCorrect: selectedIndex === correctIndex,
    selectedIndex,
    correctIndex,
    selectedLabel: selectedIndex >= 0 ? options[selectedIndex] : undefined,
    correctLabel: options[correctIndex],
    responseSummary: selectedIndex >= 0 ? options[selectedIndex] : '',
    answerSummary: options[correctIndex] || '',
  };
}

export function getQuestionDisplayType(question: QuizQuestionEnvelope) {
  return inferQuestionType(question);
}
