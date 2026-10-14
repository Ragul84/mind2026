import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Image,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Modal,
  Linking,
  Alert,
  Share,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Menu, SquarePen, Phone, Plus, Mic, ArrowUp, Square, Copy, Check,
  RefreshCw, ThumbsUp, ThumbsDown, X, Search, Bookmark, Pencil, Trash2,
  ArrowDown, ArrowRight, Zap, Lightbulb, CircleHelp, Dumbbell, ScanLine,
  CircleCheck, CircleX, Award, CircleDot, ChevronDown, ChevronRight, Network, ImageOff, Share2, type LucideIcon,
} from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { mascotApi, PaperAnswer } from '@/services/mascotApi';
import { TextbookModeBar } from '@/components/textbook/TextbookModeBar';
import { CitationChips } from '@/components/textbook/CitationChips';
import {
  EMPTY_SCOPE,
  loadTextbookMode,
  loadTextbookScope,
  saveTextbookMode,
  saveTextbookScope,
  type TextbookCitation,
  type TextbookScope,
} from '@/utils/textbookScope';
import { AIUsageService } from '@/services/aiUsageService';
import { supabase } from '@/utils/supabaseService';
import PaperScanModal from '@/components/ui/PaperScanModal';
import { formatResetIn } from '@/utils/aiLimitPrompt';
import { weakAreasService, WeakTopic, SprintContent } from '@/services/weakAreasService';
import { showAILimitPrompt } from '@/utils/aiLimitPrompt';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { ContentPlaceholder } from './SkeletonLoader';
import { LearningDocumentRenderer } from '@/components/miga/learning/LearningDocumentRenderer';
import type { LearningBlock } from '@/components/miga/learning/types';

/**
 * MigaChat - the MIGA text chat surface.
 *
 * Design language: MindGains teal on M3 colour roles, with the interaction model
 * of a desktop-grade assistant (ChatGPT / Claude): stop mid-stream, regenerate,
 * edit-and-resend, full Markdown (code, tables, quotes, links), image
 * attachments, answer feedback, and a searchable / pinnable history.
 *
 * Colours live in the C token map below. It is deliberately shaped as a theme
 * object so a dark variant is a swap of that one object, not a sweep of the file.
 */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const C = {
  primary: '#0F766E',
  primaryBright: '#14B8A6',
  primarySoft: '#E1F3EF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#CCFBF1',

  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceContainer: '#F1F5F4',
  surfaceContainerHigh: '#E6EEEC',
  userBubble: '#F2F5F5',
  userBubbleBorder: '#E7EDEB',

  onSurface: '#0F172A',
  onSurfaceVariant: '#5B6470',
  onSurfaceFaint: '#8A8E96',
  outline: 'rgba(15, 23, 42, 0.10)',
  outlineVariant: '#DCE5E2',

  danger: '#B3261E',
  dangerSoft: '#FBE7E7',
  dangerBorder: '#E4A0A0',

  codeBg: '#0F1F1D',
  codeText: '#E6F1EE',
  codeChrome: '#1B302D',
  inlineCodeBg: '#EDF3F1',
  inlineCodeText: '#0B3B36',

  scrim: 'rgba(15,23,42,0.45)',
};

// M3 state layers: interaction is expressed as a translucent wash of the accent
// over the component's own colour, at the spec's opacities, rather than by
// swapping the surface to a different colour.
const STATE_PRESSED = 'rgba(15,118,110,0.12)'; // primary @ 12%

// M3 emphasized-decelerate easing (Google motion)
const EMPHASIZED = Easing.bezier(0.05, 0.7, 0.1, 1);

// Composer metrics. Every control in the bar is CONTROL px square and the text
// field's single-line height is LINE + 2*PAD, so one-line text sits dead centre
// against the buttons and the bar grows only when the text actually wraps.
const LINE_H = 21;                      // one line of input text
const INPUT_PAD_V = 9;                  // input's own vertical padding
const CONTROL = LINE_H + INPUT_PAD_V * 2; // 39 - button size == single-line row height
const MAX_COMPOSER_HEIGHT = LINE_H * 5; // five calm lines, then the field scrolls internally
const MAX_ATTACHMENTS = 4;
// Stream watchdogs. A dropped socket on mobile often produces no error at all â€”
// the read just never returns â€” so the UI has to time it out itself or the
// "thinking" line loops forever.
const STALL_MS = 25_000;     // no token for this long == dead stream
const MAX_STREAM_MS = 120_000; // hard ceiling on one answer

// Reveal cadence. Every tick re-renders the message list and re-parses the
// growing answer's Markdown, so the tick rate â€” not the step size â€” is what
// costs. At 16ms that was 60 full re-renders a second and long answers ground
// to a crawl. 33ms is still well above the ~20fps where text stops reading as
// typed, and the larger step keeps throughput higher than before.
// A 12fps commit cadence keeps the reading motion responsive without repeatedly
// rebuilding native text/layout for every network fragment. Network tokens still
// land immediately in targetRef; this controls only paint work.
const REVEAL_TICK_MS = 80;
const REVEAL_MIN_STEP = 40;
// Auto-follow cadence while streaming. Far cheaper than once per tick and reads
// the same, because the text underneath is only growing a few characters a tick.
const SCROLL_FOLLOW_MS = 160;
const ANDROID_KEYBOARD_FALLBACK_RATIO = 0.46;
const ANDROID_KEYBOARD_MIN_LIFT = 360;

const hapticLight = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
const hapticSelect = () => { Haptics.selectionAsync().catch(() => {}); };
const withoutStructuredLegacyFooter = (content: string) => content.replace(/\n{2,}\s*(?:\*\*[^\n*]*\bSource:\*\*|Source:)\s*[^\n]*\s*$/i, '').trimEnd();
const formatEvidenceUnit = (display: TextbookEvidence['display']) => {
  const type = display.unitType ? `${display.unitType.charAt(0).toUpperCase()}${display.unitType.slice(1)}` : '';
  return [display.unitNumber && type ? `${type} ${display.unitNumber}` : '', display.unitTitle].filter(Boolean).join(' Â· ');
};
const formatEvidenceIdentity = (display: TextbookEvidence['display']) => {
  const parts = [
    display.board && String(display.board).toUpperCase(),
    display.classLevel ? `Class ${display.classLevel}` : '',
    display.subject ? String(display.subject).replace(/-/g, ' ') : '',
  ].filter(Boolean);
  return parts.join(' Â· ');
};

type ChatRole = 'user' | 'assistant';
type Feedback = 'up' | 'down' | null;
// The Sources button is hidden for now while the citation UI/model is being
// redesigned (evidence keeps flowing and persisting underneath — flip this
// back to true to bring the button back with zero data migration needed).
const SHOW_SOURCES_BUTTON = false;

type Attachment = { id: string; dataUrl: string; mimeType: string };
type TextbookEvidence = { evidenceId: string; supportingChunkCount: number; excerpt: string; display: { board?: string; classLevel?: number; subject?: string; language?: string; bookTitle?: string; volumeOrPart?: string; chapterNumber?: string; chapterTitle?: string; unitType?: 'chapter' | 'theme' | 'unit' | 'lesson' | 'other'; unitNumber?: string; unitTitle?: string; officialSourceUrl?: string } };

// The retrieval step can return several chunks from the same chapter/section
// as separate evidence entries. Showing "Sources · 5" for one chapter reads as
// five independent textbooks were consulted, which overstates the retrieval.
// Grouping by the same book + chapter/section identity keeps the drawer
// honest: one card per real source, each listing every passage it covers.
function groupEvidenceBySource(evidence: TextbookEvidence[] | null | undefined): TextbookEvidence[] {
  if (!evidence?.length) return [];
  const groups = new Map<string, TextbookEvidence>();
  const order: string[] = [];
  for (const item of evidence) {
    const d = item.display || {};
    const key = [d.board, d.classLevel, d.subject, d.bookTitle, d.chapterNumber || d.unitNumber, d.chapterTitle || d.unitTitle].join('|').toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.supportingChunkCount = (existing.supportingChunkCount || 1) + (item.supportingChunkCount || 1);
      if (item.excerpt && !existing.excerpt.includes(item.excerpt)) {
        existing.excerpt = `${existing.excerpt}\n\n${item.excerpt}`;
      }
    } else {
      groups.set(key, { ...item, display: { ...d } });
      order.push(key);
    }
  }
  return order.map((key) => groups.get(key)!);
}
type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sprintRun?: boolean;
  failed?: boolean;
  stopped?: boolean;
  feedback?: Feedback;
  attachments?: Attachment[];
  rowId?: string | null; // server id, for feedback writes
  /**
   * Sent to the model but never drawn. Used to advance a quiz: the run needs a
   * turn in the history to continue, but showing "Next question" as a bubble
   * turns a clean quiz into a transcript of the user pressing a button.
   */
  hidden?: boolean;
  /** Position in a quiz run, for the "Question 3 of 10" counter. */
  quizIndex?: number;
  /** The existing quiz card remains readable while its replacement is loading. */
  quizAdvancing?: boolean;
  evidence?: TextbookEvidence[];
  /** Page-level book/chapter/page citations (textbook mode). */
  citations?: TextbookCitation[];
};
type ChatSession = {
  id: string;
  title?: string | null;
  pinned?: boolean | null;
  last_message_at?: string | null;
  updated_at?: string | null;
};

/** Keep only the citations the answer actually referenced with [n]; all if it used none. */
function usedCitations(answer: string, citations: TextbookCitation[]): TextbookCitation[] | undefined {
  if (!citations.length) return undefined;
  const used = new Set<number>();
  for (const m of String(answer || '').matchAll(/\[(\d{1,2})\]/g)) used.add(Number(m[1]));
  const filtered = citations.filter((c) => used.has(c.ref));
  return filtered.length ? filtered : citations;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Session titles
// ---------------------------------------------------------------------------

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'why', 'how', 'can', 'you',
  'please', 'pls', 'explain', 'solve', 'quick', 'revision', 'mcq', 'question', 'answer',
  'tell', 'about', 'give', 'notes', 'short', 'brief', 'detail', 'miga',
]);

function cleanTitleCandidate(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^(explain|quick revision of|revise|solve this mcq:?|solve|answer this|tell me about|notes on)\s+/i, '')
    .replace(/^scanned\s+\d*\s*questions?:?/i, 'Scanned paper')
    .replace(/[?!.:;,\-]+$/g, '')
    .trim();
}

function titleFromConversation(parts: string[]) {
  const cleaned = parts
    .map(cleanTitleCandidate)
    .filter((item) => item && item.length > 2 && item.toLowerCase() !== 'scanned a question paper');
  if (!cleaned.length) return 'New chat';

  const combined = cleaned.join(' ');
  const keywordCounts = new Map<string, number>();
  combined
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOPWORDS.has(word))
    .forEach((word) => keywordCounts.set(word, (keywordCounts.get(word) || 0) + 1));

  const keywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);

  if (keywords.length >= 2) {
    return keywords
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .slice(0, 56);
  }

  return cleaned[0].slice(0, 56);
}

/**
 * Title from the whole first exchange, not just the opening line. "explain this"
 * or "hey" carries no topic, but the answer to it does, so the reply is folded
 * in as context. It is truncated hard: a full answer is far longer than the
 * question and would otherwise swamp the keyword counts and title the chat after
 * whatever the model happened to dwell on.
 */
const ANSWER_TITLE_CHARS = 220;

function titleFromExchange(userParts: string[], answer: string) {
  const gist = String(answer || '').replace(/```[\s\S]*?```/g, ' ').slice(0, ANSWER_TITLE_CHARS);
  return titleFromConversation([...userParts, gist]);
}

const buildChatPrompt = () =>
  [
    'SYSTEM: You are MIGA, a sharp, witty, genuinely warm study buddy for Indian exam aspirants (UPSC, TNPSC, SSC, banking, etc.).',
    'This is TEXT chat (not voice). Be fast, direct, accurate, and exam-ready. Lead with the answer, then a tight reason.',
    'SOURCE VERIFICATION POLICY: When providing textbook sources or citations, format them in exact visual tree hierarchy: Sources â†’ Board/Class â†’ â†“ â†’ Chapter â†’ â†“ â†’ Page (e.g. Sources â†’ NCERT Class 11 â†’ â†“ â†’ Chapter 9 â†’ â†“ â†’ Page 143).',
    'EVIDENCE DISCIPLINE (critical when textbook sources are attached to this answer): stay claim-by-claim inside what the retrieved passages actually support. Do not add tangential "this also connects to X" enrichment just because it is true or impressive, it is not free, it dilutes an answer the student trusts as textbook-grounded. If a related concept genuinely helps answer THIS question, one short clause is enough; it never needs its own paragraph. When in doubt, cut it and let the student ask a follow-up.',
    'LENGTH: default to short and syllabus-tight. A definition-style question (state a law, define a term, "what is X") gets: a one-line definition, the defining formula if one exists, one line of meaning, done, usually under 100 words total. Do not default to a full derivation, history, or a list of related concepts unless the student asks for depth, asks "explain in detail", or the question itself genuinely requires multiple steps. End a short answer with a one-line offer like "Want the derivation or an example?" rather than including it unasked.',
    'STRUCTURE for a concept-explanation answer: use a clear heading when the question is a real concept explanation, but do not force extra sections for simple factual questions. Keep the first pass compact and exam-ready.',
    'Formatting: short paragraphs; a compact list only when it genuinely helps. Bold key terms/articles/years sparingly. No filler preamble, no tangential enrichment, no extra concept dump when the question only needs the core idea.',
    'You may use Markdown tables for comparisons, fenced code blocks for code, and > for a key takeaway. They render properly.',
    'FORMULAS (important, this app renders real math, not plain text): whenever the topic has a defining formula, place it right after the one-line definition, on its own line, wrapped in single $ signs, e.g. $F = ma$ or $F = \\frac{dp}{dt}$. It renders as a large, boxed, properly typeset display formula, exactly like a textbook. Use standard LaTeX inside the $ $ (\\frac{}{}, \\sqrt{}, \\Delta, \\alpha, subscripts with _, superscripts with ^). Never write a formula in plain unwrapped text (e.g. never write "F = dp/dt" bare); it must be inside $ $ or it renders as literal words, not math. Show at most 2 to 3 formula steps by default (statement, then the boxed result); a full multi-line derivation is a follow-up, not the opener.',
    'Right after a formula, only if it has more than one non-obvious symbol, add a compact legend as separate lines shaped exactly "**F** = net force in newtons" (single short symbol, 1 to 3 characters, then " = " then the meaning), one per line: it renders as a clean colour-coded legend. Skip this for a single, self-evident symbol.',
    'When a formula or result has a one-line "why it makes sense" takeaway, add ONE line starting exactly "**Intuition**: " followed by the takeaway: it renders as a highlighted insight callout, the single most useful sentence for a student cramming before an exam. Never more than one such line per answer.',
    'For MCQs: state the correct option clearly first (e.g. "Answer: C"), then a one-line why.',
    'If unsure, say so briefly rather than inventing. Keep exam relevance front and centre.',
    'WRITING: Never use em dashes or hyphens as connectors. Write clean, modern prose using commas, periods, or colons. This matters.',
    'LANGUAGE: You are multilingual, not bilingual. You converse in all major Indian languages (Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, Punjabi, Odia, Urdu and more) as well as English, and you answer in whatever language the student writes in â€” never a language they were not currently speaking or typing, regardless of any language picked elsewhere in the app (e.g. for voice mode). Default to English when the student writes in English. Never say you only support English and Tamil.',
  ].join('\n');

// Each action gets its own vivid icon colour (the Duolingo playbook): a bright
// circle that makes the choice instantly scannable and the screen feel alive.
type Suggestion = { icon: LucideIcon; label: string; color: string; prefill?: string; scan?: boolean; sprint?: boolean };
const SUGGESTIONS: Suggestion[] = [
  { icon: Lightbulb, label: 'Explain a concept', color: '#58CC02', prefill: 'Explain ' },
  { icon: CircleHelp, label: 'Solve an MCQ', color: '#A560E8', prefill: 'Solve this MCQ:\n' },
  { icon: Dumbbell, label: 'Sprint weak areas', color: '#FF9600', sprint: true },
  { icon: ScanLine, label: 'Scan & solve', color: '#1CB0F6', scan: true },
];

// Three-dot teal thinking wave. Memoised: it sits next to a label that swaps every
// couple of seconds, and without this every swap re-renders the dots and restarts
// their loop, which reads as a stutter rather than a pulse.
/**
 * A pressable that dips on touch â€” the same tactile press as the landing
 * suggestion buttons. Used for the message action symbols so they feel alive
 * instead of flat. The visual (border/fill) lives on the scaling node.
 */
function PressableScale({ children, onPress, style, accessibilityLabel, disabled }: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const [down, setDown] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={accessibilityLabel}
    >
      <MotiView
        animate={{ scale: down ? 0.88 : 1 }}
        transition={{ type: 'timing', duration: 90, easing: EMPHASIZED }}
        style={style}
      >
        {children}
      </MotiView>
    </Pressable>
  );
}

const DOT_COLORS = ['#0F766E', '#14B8A6', '#5EEAD4'];
const TypingDots = React.memo(function TypingDots() {
  return (
    <View style={styles.typingRow}>
      {DOT_COLORS.map((c, i) => (
        <MotiView
          key={i}
          from={{ translateY: 0, opacity: 0.4, scale: 0.8 }}
          animate={{ translateY: -5, opacity: 1, scale: 1 }}
          transition={{ type: 'timing', duration: 460, easing: EMPHASIZED, loop: true, repeatReverse: true, delay: i * 130 }}
          style={[styles.typingDot, { backgroundColor: c }]}
        />
      ))}
    </View>
  );
});

/**
 * M3 spring. Material's expressive motion is spring-driven rather than
 * duration-driven: the physics is what makes a surface feel like an object
 * instead of a fade. Spatial only, per the M3 motion spec: opacity and colour
 * still ride the emphasized curve above.
 */
const SPRING_SPATIAL = { type: 'spring', damping: 22, stiffness: 260, mass: 0.9 } as const;

// ---------------------------------------------------------------------------
// Thinking narrative
//
// The early beats claim real work, so they have to BE real. miga_stream only
// runs textbook retrieval when the turn clears its own gate (see wantsTextbookText
// in supabase/functions/miga_stream/index.ts) and routes quiz / PYQ / current
// affairs down separate paths entirely. The predicates below mirror that gate,
// in the same precedence, so "hai" never claims to be searching NCERT.
//
// Past the retrieval beat the real work is one opaque model call. Rather than
// invent progress it does not have, the narrative drifts into character. Holds
// are uneven: a fixed cadence reads as a spinner, not a mind.
// ---------------------------------------------------------------------------

// Kept deliberately in sync with the edge function's own hint regexes.
const T_BRAND_RE = /\b(mindgains|miga|daily dose|study lab|quiz hub|chatgpt|gemini|claude|google ai)\b/i;
const T_QUIZ_RE = /\b(quiz\s+me|quiz|mock\s+test|practice\s+test|one\s+by\s+one|poll\s+mode|telegram\s+poll|10\s+questions|question\s+by\s+question|next\s+question)\b/i;
const T_NEWS_RE = /\b(current\s+affairs|pib|press\s+information\s+bureau|official\s+news|state\s+news|news\s+update)\b/i;
const T_PYQ_RE = /\b(pyqs?|(?:previous|past|last)\s+years?(?:['â€™]s)?\s+(?:questions?|papers?|mcqs?|problems?|prelims|mains)|year\s+question)\b/i;
// The edge function's own floor for running retrieval at all.
const T_RETRIEVAL_MIN_CHARS = 12;

// Only the routes that genuinely perform I/O before the model call are narrated.
// Everything else â€” greetings, brand questions, quiz continuations â€” gets plain
// dots. Silence cannot be wrong; a sentence can, and this classifier is only a
// guess at what the server will do, so its blast radius is kept deliberately
// small. A wrong 'none' costs nothing; only these three can ever overclaim.
type Track = 'news' | 'pyq' | 'textbook' | 'none';

function trackFor(text: string): Track {
  const t = String(text || '').trim();
  // Brand and quiz answer straight from the prompt â€” no retrieval to report.
  if (T_BRAND_RE.test(t) || T_QUIZ_RE.test(t)) return 'none';
  if (T_NEWS_RE.test(t)) return 'news';
  if (T_PYQ_RE.test(t)) return 'pyq';
  if (t.length > T_RETRIEVAL_MIN_CHARS) return 'textbook';
  return 'none'; // greetings and one-liners: nothing is retrieved, claim nothing
}

// At most two beats per narrated route, in the order the work actually happens.
// There is no third pool: when the wait outlasts these, the last line holds. A
// static true line beats a rotating invented one.
const THINK_WORK: Record<Exclude<Track, 'none'>, string[]> = {
  textbook: [
    'Thinking',
    'Analyzing request',
  ],
  pyq: [
    'Thinking',
    'Searching database',
  ],
  news: [
    'Thinking',
    'Searching current affairs',
  ],
};

// Words only earn their place when there is a real wait to explain. Under this,
// the answer has already started and a label would just flash and vanish.
const NARRATE_AFTER_MS = 1200;
const BEAT_MS = 1600;

/**
 * The pending-answer state. Dots by default, for every route and every message.
 * The narrated routes swap in a label only once the wait passes
 * NARRATE_AFTER_MS â€” so a fast answer never shows words at all.
 */
function ThinkingLine({ prompt = '' }: { prompt?: string }) {
  const track = useMemo(() => trackFor(prompt), [prompt]);
  const work = track === 'none' ? null : THINK_WORK[track];
  const [beat, setBeat] = useState(-1); // -1 == dots only

  useEffect(() => {
    if (!work) return;
    const timers: any[] = [
      setTimeout(() => setBeat(0), NARRATE_AFTER_MS),
      setTimeout(() => setBeat(1), NARRATE_AFTER_MS + BEAT_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [work]);

  const line = work && beat >= 0 ? work[Math.min(beat, work.length - 1)] : 'MIGA is thinking';

  return (
    <View style={styles.thinkContainer}>
      <View style={styles.thinkHeader}>
        <Text style={styles.thinkStatusText}>{line}</Text>
        <View style={styles.thinkDotsContainer}>
          <TypingDots />
        </View>
      </View>
      <ContentPlaceholder lines={3} height={14} style={styles.skeletonMargin} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Markdown
//
// The model replies in Markdown and the backend genuinely emits tables, fences
// and rules, so this renders the real grammar rather than a subset. Parsing is
// line-based and streaming-safe: an unterminated fence or a dangling ** renders
// as its finished form rather than flashing raw syntax at the reader.
// ---------------------------------------------------------------------------

type Block =
  | { k: 'p'; text: string }
  | { k: 'h'; level: number; text: string }
  | { k: 'li'; text: string; depth: number; marker: string | null }
  | { k: 'code'; lang: string; code: string }
  | { k: 'quote'; text: string; type?: 'note' | 'warning' | 'tip' | 'caution' | 'important' | 'default' }
  | { k: 'hr' }
  | { k: 'table'; header: string[]; rows: string[][] }
  | { k: 'math'; text: string; label?: string }
  | { k: 'gap' };

const FENCE_RE = /^\s*```(\w*)\s*$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

// These are presentation labels written explicitly by the answer, not guesses
// based on a topic. Keeping the recognition deliberately narrow avoids making
// an ordinary paragraph look like an "exam tip" or "intuition" by accident.
const SEMANTIC_LABELS: Record<string, 'definition' | 'insight' | 'important' | 'example'> = {
  definition: 'definition',
  'key idea': 'definition',
  'key point': 'important',
  important: 'important',
  'exam tip': 'important',
  'exam point': 'important',
  intuition: 'insight',
  insight: 'insight',
  'common misconception': 'insight',
  example: 'example',
};

function parseExplicitSemanticLine(line: string) {
  const match = line.match(/^\s*\*\*([^*:\n]{2,40})\*\*\s*:\s*(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const tone = SEMANTIC_LABELS[label.toLowerCase()];
  return tone ? { label, text: match[2].trim(), tone } : null;
}

function parseSymbolDefinition(text: string) {
  const match = text.match(/^\s*(?:\*\*)?([^=*:\n]{1,12})(?:\*\*)?\s*(?:=|:|\u2013|-)\s*(.+)$/);
  if (!match) return null;
  const symbol = match[1].replace(/[*`]/g, '').trim();
  // A legend is about compact symbols, not a sentence that happens to include
  // an equals sign. The group composer below also requires two such entries.
  if (!symbol || /\s{2,}|[.!?]$/.test(symbol)) return null;
  return { symbol, meaning: match[2].trim() };
}

function isExplicitEquationLine(line: string) {
  const value = line.trim();
  if (value.length < 3 || value.length > 120 || /[.!?]$/.test(value)) return false;
  // Markdown has to win over mathematics. A bullet or bold span is never
  // promoted directly into a display equation.
  if (/^(?:[-*+]|\d+[.)]|>|#)/.test(value) || /[*`]/.test(value)) return false;
  if (!/[=\u221d\u2264\u2265\u2248]/.test(value)) return false;
  // Explicit symbols/operators or LaTex constitute an equation. Prose such as
  // "The reason is = ..." stays a paragraph.
  return /\\(?:frac|sqrt|sum|int|partial)|[A-Za-z\u0370-\u03FF\u2080-\u2089]\s*[=\u221d\u2264\u2265\u2248]\s*[A-Za-z0-9\u0370-\u03FF\u2080-\u2089]/.test(value);
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function formatMathFormula(latex: string): string {
  let str = latex;
  let prev = '';
  while (str !== prev) {
    prev = str;
    str = str.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1) / ($2)');
  }
  str = str
    .replace(/\\sin/g, 'sin')
    .replace(/\\cos/g, 'cos')
    .replace(/\\tan/g, 'tan')
    .replace(/\\cot/g, 'cot')
    .replace(/\\sec/g, 'sec')
    .replace(/\\csc/g, 'csc')
    .replace(/\\log/g, 'log')
    .replace(/\\ln/g, 'ln')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\quad/g, '   ')
    .replace(/\\qquad/g, '     ')
    .replace(/\\theta/g, 'Î¸')
    .replace(/\\alpha/g, 'Î±')
    .replace(/\\beta/g, 'Î²')
    .replace(/\\gamma/g, 'Î³')
    .replace(/\\delta/g, 'Î´')
    .replace(/\\lambda/g, 'Î»')
    .replace(/\\pi/g, 'Ï€')
    .replace(/\\times/g, ' Ã— ')
    .replace(/\\div/g, ' Ã· ')
    .replace(/\\pm/g, ' Â± ')
    .replace(/\\ge/g, ' â‰¥ ')
    .replace(/\\le/g, ' â‰¤ ')
    .replace(/\\neq/g, ' â‰  ')
    .replace(/\\approx/g, ' â‰ˆ ')
    .replace(/\\infty/g, ' âˆž ')
    .replace(/\\cdot/g, 'Â·')
    .replace(/\\Delta/g, 'Î”')
    .replace(/\\sigma/g, 'Ïƒ')
    .replace(/\\omega/g, 'Ï‰')
    .replace(/\\mu/g, 'Î¼')
    .replace(/\\propto/g, ' âˆ ')
    .replace(/\\nabla/g, 'âˆ‡')
    .replace(/\\partial/g, 'âˆ‚')
    .replace(/\\rightarrow|\\to\b/g, ' â†’ ')
    .replace(/\\leftarrow/g, ' â† ')
    .replace(/\\leq/g, ' â‰¤ ')
    .replace(/\\geq/g, ' â‰¥ ')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'âˆš($1)')
    .replace(/\\left|\\right/g, '')
    .replace(/\\(?:mathbf|mathrm|mathit|boldsymbol|vec|hat|bar|overline|underline|text)\{([^{}]+)\}/g, '$1')
    .replace(/\\_([a-zA-Z0-9])/g, '<sub>$1</sub>')
    .replace(/\\^([a-zA-Z0-9])/g, '<sup>$1</sup>');

  const subMap: Record<string, string> = {
    '0': 'â‚€', '1': 'â‚', '2': 'â‚‚', '3': 'â‚ƒ', '4': 'â‚„',
    '5': 'â‚…', '6': 'â‚†', '7': 'â‚‡', '8': 'â‚ˆ', '9': 'â‚‰',
    '+': 'â‚Š', '-': 'â‚‹', '=': 'â‚Œ', '(': 'â‚', ')': 'â‚Ž',
    'a': 'â‚', 'e': 'â‚‘', 'h': 'â‚•', 'i': 'áµ¢', 'j': 'â±¼',
    'k': 'â‚–', 'l': 'â‚—', 'm': 'â‚˜', 'n': 'â‚™', 'o': 'â‚’',
    'p': 'â‚š', 'r': 'áµ£', 's': 'â‚›', 't': 'â‚œ', 'u': 'áµ¤',
    'v': 'áµ¥', 'x': 'â‚“'
  };
  const superMap: Record<string, string> = {
    '0': 'â°', '1': 'Â¹', '2': 'Â²', '3': 'Â³', '4': 'â´',
    '5': 'âµ', '6': 'â¶', '7': 'â·', '8': 'â¸', '9': 'â¹',
    '+': 'âº', '-': 'â»', '=': 'âº', '(': 'â½', ')': 'â¾',
    'n': 'â¿', 'i': 'â±', 'x': 'Ë£'
  };

  str = str.replace(/_\{([^}]+)\}/g, (match, p1) => {
    return p1.split('').map((char: string) => subMap[char] || char).join('');
  });
  str = str.replace(/_([a-zA-Z0-9])/g, (match, p1) => {
    return subMap[p1] || p1;
  });
  str = str.replace(/\^\{([^}]+)\}/g, (match, p1) => {
    return p1.split('').map((char: string) => superMap[char] || char).join('');
  });
  str = str.replace(/\^([a-zA-Z0-9])/g, (match, p1) => {
    return superMap[p1] || p1;
  });

  return str.replace(/\\/g, '').trim();
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: Block[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Math block: starts with $$ or \[
    if (line.trim() === '$$' || line.trim() === '\\[' || line.trim().startsWith('$$') || line.trim().startsWith('\\[')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
        out.push({ k: 'math', text: trimmed.slice(2, -2).trim() });
        continue;
      }
      if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length > 4) {
        out.push({ k: 'math', text: trimmed.slice(2, -2).trim() });
        continue;
      }
      const body: string[] = [];
      let startText = '';
      if (trimmed.startsWith('$$')) startText = trimmed.slice(2);
      else if (trimmed.startsWith('\\[')) startText = trimmed.slice(2);
      if (startText.trim()) {
        body.push(startText);
      }
      i++;
      while (i < lines.length && !lines[i].includes('$$') && !lines[i].includes('\\]')) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        const endTrim = lines[i].trim();
        let endText = '';
        if (endTrim.endsWith('$$')) endText = endTrim.slice(0, -2);
        else if (endTrim.endsWith('\\]')) endText = endTrim.slice(0, -2);
        if (endText.trim()) {
          body.push(endText);
        }
      }
      out.push({ k: 'math', text: body.join('\n').trim() });
      continue;
    }

    // Fenced code. An unclosed fence (still streaming) runs to the end.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] || '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { body.push(lines[i]); i++; }
      out.push({ k: 'code', lang, code: body.join('\n') });
      continue;
    }

    // Table: a pipe row followed by a |---|---| separator.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('|')) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      out.push({ k: 'table', header, rows });
      continue;
    }

    if (!line.trim()) { out.push({ k: 'gap' }); continue; }

    // A formula that occupies its own Markdown line deserves its own visual
    // line too. Keeping `$F = ma$` inside prose makes it easy to miss and can
    // wrap awkwardly on narrow Android screens.
    const inlineFormula = line.trim().match(/^\$([^$\n]+)\$$/);
    if (inlineFormula) { out.push({ k: 'math', text: inlineFormula[1] }); continue; }
    const namedFormula = line.trim().match(/^(?:\*\*)?(formula|equation)(?:\*\*)?\s*:\s*(.+)$/i);
    if (namedFormula) { out.push({ k: 'math', text: namedFormula[2], label: namedFormula[1] }); continue; }
    if (isExplicitEquationLine(line)) { out.push({ k: 'math', text: line.trim() }); continue; }
    if (HR_RE.test(line)) { out.push({ k: 'hr' }); continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { out.push({ k: 'h', level: heading[1].length, text: heading[2] }); continue; }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      let text = quote[1];
      let type: 'note' | 'warning' | 'tip' | 'caution' | 'important' | 'default' = 'default';
      const alertMatch = text.match(/^\[!(NOTE|WARNING|TIP|CAUTION|IMPORTANT)\]\s*(.*)$/i);
      if (alertMatch) {
        type = alertMatch[1].toLowerCase() as any;
        text = alertMatch[2];
      }
      out.push({ k: 'quote', text, type });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*â€¢]\s+(.*)$/);
    if (bullet) {
      out.push({ k: 'li', text: bullet[2], depth: Math.floor(bullet[1].length / 2), marker: null });
      continue;
    }

    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      out.push({ k: 'li', text: numbered[3], depth: Math.floor(numbered[1].length / 2), marker: `${numbered[2]}.` });
      continue;
    }

    out.push({ k: 'p', text: line });
  }
  return out;
}

// Strip the AI-wrapper em dash / hyphen connectors into natural commas. Runs on
// INLINE text only (never on a whole document), so a "- " bullet marker at the
// start of a line is already consumed by the block parser and can't be eaten.
// Number ranges like "Art. 36-51" have no surrounding spaces and stay intact.
function cleanConnectors(text: string) {
  return text
    .replace(/\s*â€”\s*/g, ', ')
    .replace(/\s*â€“\s*/g, ', ')
    .replace(/\s+--\s+/g, ', ')
    .replace(/\s+-\s+/g, ', ');
}

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\s]+\)|\(Ref:\s*[^)]+\)|\[Ref:\s*[^\]]+\]|\$[^\$\n]+\$)/g;

function parseInline(text: string, kp: string, base?: any): React.ReactNode[] {
  // While streaming, an opening ** may not have its closing ** yet: hide the
  // dangling marker so the reader never sees raw "**" before it turns bold.
  let t = cleanConnectors(text);
  if (((t.match(/\*\*/g) || []).length) % 2 === 1) {
    const i = t.lastIndexOf('**');
    t = t.slice(0, i) + t.slice(i + 2);
  }

  return t.split(INLINE_RE).filter(Boolean).map((p, i) => {
    const key = `${kp}-${i}`;
    if (/^`[^`]+`$/.test(p)) {
      return <Text key={key} style={[base, styles.mdInlineCode]}>{` ${p.slice(1, -1)} `}</Text>;
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return <Text key={key} style={[base, styles.mdBold]}>{p.slice(2, -2)}</Text>;
    }
    if (/^~~[^~]+~~$/.test(p)) {
      return <Text key={key} style={[base, styles.mdStrike]}>{p.slice(2, -2)}</Text>;
    }
    if (/^\*[^*]+\*$/.test(p) || /^_[^_]+_$/.test(p)) {
      return <Text key={key} style={[base, styles.mdItalic]}>{p.slice(1, -1)}</Text>;
    }
    const refMatch = p.match(/^\((Ref:\s*[^)]+)\)$/) || p.match(/^\[(Ref:\s*[^\]]+)\]$/);
    if (refMatch) {
      return <Text key={key} style={[base, styles.refBadgeText]}>{` ${refMatch[1]} `}</Text>;
    }
    if (/^\$[^\$]+\$$/.test(p)) {
      return <Text key={key} style={[base, styles.mathText]}>{formatMathFormula(p.slice(1, -1))}</Text>;
    }
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <Text key={key} style={[base, styles.mdLink]} onPress={() => Linking.openURL(link[2]).catch(() => {})}>
          {link[1]}
        </Text>
      );
    }
    return p;
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(code);
      hapticLight();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [code]);
  return (
    <View style={styles.codeWrap}>
      <View style={styles.codeHead}>
        <Text style={styles.codeLang}>{lang || 'code'}</Text>
        <Pressable onPress={copy} hitSlop={8} style={styles.codeCopy}>
          {copied
            ? <Check size={12} color={C.primaryBright} strokeWidth={2.5} />
            : <Copy size={12} color="#8FA8A3" strokeWidth={2} />}
          <Text style={[styles.codeCopyText, copied && { color: C.primaryBright }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText} selectable>{code}</Text>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Interactive quiz poll
//
// Quiz mode has the model emit a ```quiz fence holding JSON, so a question
// arrives as data rather than prose. That means the card can score the tap
// locally and answer instantly, with no round trip: the Telegram-poll feel.
// If the JSON is malformed the block falls back to rendering as plain code
// rather than swallowing the question.
// ---------------------------------------------------------------------------

type QuizData = {
  q: string;
  options: string[];
  answer: number;
  explanation?: string;
  // The real figure from the paper (public pyq-figures URL). Present on
  // figure-dependent PYQs â€” this is what makes a "circuit shown below" question
  // actually answerable, and the thing a generic AI cannot show.
  image?: string;
  imageCaption?: string;
  // Set when this card is a REAL previous-year question (e.g. "UPSC 2024"). It
  // switches the card to PYQ styling and suppresses the quiz-mode "Next
  // question" flow â€” a PYQ set is delivered whole, not walked one at a time.
  source?: string;
};

function parseQuiz(raw: string): QuizData | null {
  try {
    const d = JSON.parse(raw.trim());
    const options = Array.isArray(d?.options) ? d.options.map((o: any) => String(o)) : [];
    const answer = Number(d?.answer);
    if (!d?.q || options.length < 2) return null;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    // Only accept a same-origin figures URL; never render an arbitrary remote
    // image the model might hallucinate into the block.
    const img = typeof d?.image === 'string' && /\/pyq-figures\//.test(d.image) ? d.image : undefined;
    return {
      q: String(d.q),
      options,
      answer,
      explanation: d.explanation ? String(d.explanation) : undefined,
      image: img,
      imageCaption: img && d?.imageCaption ? String(d.imageCaption) : undefined,
      source: typeof d?.source === 'string' ? String(d.source).slice(0, 40) : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mindmap
//
// The differentiator: exam answers are structural (linkages, article numbers,
// groupings) and prose flattens that. The model emits a `mindmap` fence and this
// renders it as a revisable artefact rather than another paragraph.
//
// Caps are load-bearing, not cosmetic. A well-behaved topic like Fundamental
// Rights fits naturally; "explain the Indian economy" would otherwise come back
// as 9 branches x 7 leaves, which is a JSON dump with rounded corners. Trimming
// here means a malformed or over-eager block still renders as something a thumb
// can read.
// ---------------------------------------------------------------------------

const MM_MAX_BRANCHES = 6;
const MM_MAX_CHILDREN = 5;
// Branches beyond this start collapsed, so a big map stays one screen tall.
const MM_OPEN_BY_DEFAULT = 3;

type MindmapNode = { label: string; ref?: string; color: string; children: string[] };
type MindmapData = { root: string; subtitle?: string; nodes: MindmapNode[] };

// Duolingo palette: saturated, high-contrast, one hue per branch so a student
// can navigate by colour alone on a re-read.
const MM_COLORS = ['#0F766E', '#1CB0F6', '#FF9600', '#A560E8', '#EC4899', '#EF4444'];
const MM_NAMED: Record<string, string> = {
  teal: '#0F766E', blue: '#1CB0F6', orange: '#FF9600',
  purple: '#A560E8', pink: '#EC4899', red: '#EF4444', green: '#58CC02',
};

function parseMindmap(raw: string): MindmapData | null {
  try {
    const d = JSON.parse(raw.trim());
    const root = String(d?.root || '').trim();
    if (!root || !Array.isArray(d?.nodes)) return null;

    const nodes: MindmapNode[] = d.nodes
      .slice(0, MM_MAX_BRANCHES)
      .map((n: any, i: number) => {
        const label = String(n?.label || '').trim();
        if (!label) return null;
        const raw = String(n?.color || '').toLowerCase();
        return {
          label,
          ref: n?.ref ? String(n.ref).trim() : undefined,
          color: MM_NAMED[raw] || MM_COLORS[i % MM_COLORS.length],
          children: (Array.isArray(n?.children) ? n.children : [])
            .map((c: any) => String(c).trim())
            .filter(Boolean)
            .slice(0, MM_MAX_CHILDREN),
        };
      })
      .filter(Boolean) as MindmapNode[];

    // One lone branch is a list, not a map â€” fall back to prose rather than
    // dressing up something that has no structure to show.
    if (nodes.length < 2) return null;
    return { root, subtitle: d?.subtitle ? String(d.subtitle).trim() : undefined, nodes };
  } catch {
    return null;
  }
}

function MindmapBranch({ node, index }: { node: MindmapNode; index: number }) {
  const [open, setOpen] = useState(index < MM_OPEN_BY_DEFAULT);
  const hidden = node.children.length;

  return (
    <View style={styles.mmBranch}>
      <Pressable
        onPress={() => { hapticLight(); setOpen((v) => !v); }}
        style={styles.mmHeadRow}
        accessibilityLabel={`${node.label}, ${open ? 'collapse' : 'expand'}`}
      >
        <View style={[styles.mmCoin, { backgroundColor: node.color }]} />
        <Text style={styles.mmBranchLabel} numberOfLines={1}>{node.label}</Text>
        {!!node.ref && (
          <View style={[styles.mmRefPill, { backgroundColor: node.color + '1A' }]}>
            <Text style={[styles.mmRefText, { color: node.color }]}>{node.ref}</Text>
          </View>
        )}
        {hidden > 0 && (
          <ChevronDown
            size={15}
            color={C.onSurfaceFaint}
            strokeWidth={2.4}
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          />
        )}
      </Pressable>

      {open && hidden > 0 && (
        <View style={[styles.mmChildren, { borderLeftColor: node.color }]}>
          {node.children.map((c, i) => (
            <View key={i} style={styles.mmLeafRow}>
              <View style={[styles.mmLeafDot, { backgroundColor: node.color }]} />
              <Text style={styles.mmLeafText}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function MindmapCard({ data, onQuiz }: { data: MindmapData; onQuiz?: (text: string) => void }) {
  return (
    <View style={styles.mmCard}>
      <View style={styles.mmHeader}>
        <View style={styles.mmKickerRow}>
          <Network size={12} color={C.primary} strokeWidth={2.6} />
          <Text style={styles.mmKicker}>MINDMAP</Text>
        </View>
        <Text style={styles.mmRoot}>{data.root}</Text>
        {!!data.subtitle && <Text style={styles.mmSubtitle}>{data.subtitle}</Text>}
      </View>

      <View style={styles.mmBody}>
        {data.nodes.map((n, i) => <MindmapBranch key={`${n.label}-${i}`} node={n} index={i} />)}
      </View>

      <Pressable
        onPress={() => { hapticLight(); onQuiz?.(`Quiz me on ${data.root}`); }}
        style={({ pressed }) => [styles.mmQuizBtn, pressed && styles.mmQuizBtnPressed]}
        accessibilityLabel={`Quiz me on ${data.root}`}
      >
        <Zap size={14} color={C.primary} strokeWidth={2.6} fill={C.primary} />
        <Text style={styles.mmQuizText}>Quiz me on this</Text>
      </Pressable>
    </View>
  );
}

// Hoisted so every message shell hands Moti the SAME objects. As inline literals
// these were fresh on every reveal tick, which made Reanimated re-evaluate the
// entry animation for every message in the thread ~30 times a second â€” the cost
// scaled with transcript length, which is why long chats crawled.
const MSG_FROM = { opacity: 0, translateY: 10 } as const;
const MSG_ANIMATE = { opacity: 1, translateY: 0 } as const;
const MSG_TRANSITION = { type: 'timing', duration: 300, easing: EMPHASIZED } as const;

/**
 * Per-message wrapper: entry animation plus the layout probe that anchors a new
 * question to the top of the screen. Deliberately NOT memoised on id â€” children
 * carry the streaming text and must keep updating. The win here is stable props,
 * not a skipped render.
 */
function MessageShell({ id, onAnchor, children }: {
  id: string;
  onAnchor: (id: string, y: number) => void;
  children: React.ReactNode;
}) {
  const handleLayout = useCallback(
    (e: any) => onAnchor(id, e.nativeEvent.layout.y),
    [id, onAnchor],
  );
  return (
    <MotiView
      from={MSG_FROM}
      animate={MSG_ANIMATE}
      transition={MSG_TRANSITION}
      onLayout={handleLayout}
      style={styles.msgBlock}
    >
      {children}
    </MotiView>
  );
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * The paper's actual figure. Keeps its own load/error state because a broken
 * image on a PYQ is worse than none â€” it must never leave a dead grey box on a
 * question the student is trying to answer. On failure it collapses to a small
 * honest note rather than a broken frame.
 */
function QuizFigure({ url, caption }: { url: string; caption?: string }) {
  const [ratio, setRatio] = useState(16 / 10);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Image.getSize(
      url,
      (w, h) => { if (alive && w > 0 && h > 0) setRatio(w / h); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [url]);

  if (failed) {
    return (
      <View style={styles.figFailed}>
        <ImageOff size={15} color={C.onSurfaceFaint} strokeWidth={2} />
        <Text style={styles.figFailedText}>Figure unavailable</Text>
      </View>
    );
  }
  return (
    <View style={styles.figWrap}>
      <Image
        source={{ uri: url }}
        style={[styles.figImage, { aspectRatio: ratio }]}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
      {!!caption && <Text style={styles.figCaption}>{caption}</Text>}
    </View>
  );
}

/**
 * Splits an exam question into its three natural parts so each can be styled for
 * a real hierarchy instead of one flat wall of same-sized text:
 *   stem    â€” "With reference to X, consider the following statements:"
 *   items   â€” the enumerated statements/pairs (I., II., 1., 2., â€¦)
 *   closing â€” "Which of the above is/are correct?"
 * A plain question with no list just comes back as the stem.
 */
function parseQuestionParts(raw: string): { stem: string; items: { marker: string; text: string }[]; closing: string } {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();

  let closing = '';
  const close = t.match(/\s+((?:Which (?:of|one)\b|How many\b|Select the correct|The correct answer).*)$/i);
  if (close && close.index !== undefined) {
    closing = close[1].trim();
    t = t.slice(0, close.index).trim();
  }

  // Catches every list style seen in the corpus: roman/arabic with a dot OR a
  // paren (I. 1. 1) II)), and parenthesised markers ((a) (1)). Trailing space is
  // optional (OCR glues "I.Full"), and the lookahead requires a real item start
  // so mid-sentence abbreviations aren't mistaken for markers.
  const enumRe = /(^|\s)((?:I{1,3}|IV|VI{0,3}|IX|X)[.)]|\d{1,2}[.)]|\([a-eA-E0-9]{1,2}\))\s*(?=[A-Za-z("'\d])/g;
  const marks: { idx: number; len: number; marker: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = enumRe.exec(t))) {
    marks.push({ idx: m.index + m[1].length, len: m[0].length - m[1].length, marker: m[2] });
  }
  if (marks.length < 2) return { stem: t, items: [], closing };

  const stem = t.slice(0, marks[0].idx).trim();
  const items = marks.map((mk, i) => {
    const start = mk.idx + mk.len;
    const end = i + 1 < marks.length ? marks[i + 1].idx : t.length;
    return { marker: mk.marker, text: t.slice(start, end).trim() };
  });
  return { stem, items, closing };
}

function QuestionBody({ raw }: { raw: string }) {
  const { stem, items, closing } = useMemo(() => parseQuestionParts(raw), [raw]);

  // No list â†’ a normal single question, rendered at the compact prompt size.
  if (!items.length) {
    return <Text style={styles.qPlain}>{parseInline(stem, 'qp', styles.qPlain)}</Text>;
  }
  return (
    <View>
      {!!stem && <Text style={styles.qStem}>{parseInline(stem, 'qs', styles.qStem)}</Text>}
      <View style={styles.qList}>
        {items.map((it, i) => (
          <View key={i} style={styles.qItemRow}>
            <Text style={styles.qMarker}>{it.marker}</Text>
            <Text style={styles.qItemText}>{parseInline(it.text, `qi${i}`, styles.qItemText)}</Text>
          </View>
        ))}
      </View>
      {!!closing && <Text style={styles.qClosing}>{parseInline(closing, 'qc', styles.qClosing)}</Text>}
    </View>
  );
}

// A quiz run is a fixed set, so the student knows how much is left. Open-ended
// "keep going forever" gives them no sense of progress and no natural stopping
// point, which is why the count is fixed here rather than left to the model.
const QUIZ_SET_SIZE = 10;

function QuizCard({ data, onNext, index, total, onAnswered, onAdvance, onResult, advancing = false }: {
  data: QuizData;
  onNext?: (text: string) => void;
  index?: number;
  total?: number;               // size of the set (defaults to quiz-mode's 10)
  onAnswered?: () => void;      // side effect on answer (quiz mode: scroll)
  onAdvance?: () => void;       // local "next" within a set (PYQ walker) â€” no round-trip
  onResult?: (correct: boolean) => void; // report correctness (PYQ walker scoring)
  advancing?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === data.answer;
  // A PYQ card is a real past question. It shows a provenance badge alongside the
  // one-by-one counter, so it reads as "PYQ 3 of 5 Â· UPSC 2025".
  const isPyq = !!data.source;
  const setSize = total ?? QUIZ_SET_SIZE;
  const qNum = typeof index === 'number' ? index + 1 : null;
  const isLast = qNum !== null && qNum >= setSize;
  const kicker = isPyq
    ? (qNum ? `PYQ ${qNum} OF ${setSize} â€¢ ${data.source}` : `PYQ â€¢ ${data.source}`)
    : (qNum ? `QUESTION ${qNum} OF ${setSize}` : 'QUIZ');

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const ok = i === data.answer;
    if (ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    onResult?.(ok);
    // Bring the explanation into view: it renders below the fold on a long card.
    onAnswered?.();
    // The explanation enters with a short motion; follow once more after its
    // layout has expanded so a tap never leaves the answer hidden below fold.
    setTimeout(() => onAnswered?.(), 280);
  };

  return (
    <View style={styles.quizCard}>
      <LinearGradient
        colors={[C.primary, C.primaryBright]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.quizStripe}
      />
      <View style={styles.quizTop}>
        <CircleDot size={13} color={C.primary} strokeWidth={2.2} />
        <Text style={styles.quizKicker}>{kicker}</Text>
        {answered && (
          <MotiView
            from={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 220, easing: EMPHASIZED }}
            style={[styles.quizVerdict, correct ? styles.quizVerdictOk : styles.quizVerdictNo]}
          >
            {correct
              ? <Check size={11} color="#FFFFFF" strokeWidth={3} />
              : <X size={11} color="#FFFFFF" strokeWidth={3} />}
            <Text style={styles.quizVerdictText}>{correct ? 'Correct' : 'Missed'}</Text>
          </MotiView>
        )}
      </View>

      <QuestionBody raw={data.q} />

      {!!data.image && <QuizFigure url={data.image} caption={data.imageCaption} />}

      <View style={{ gap: 6, marginTop: 11 }}>
        {data.options.map((o, i) => {
          const isRight = answered && i === data.answer;
          const isWrong = answered && i === picked && !correct;
          return (
            <MotiView
              key={i}
              animate={{ scale: isRight ? 1.015 : 1 }}
              transition={{ type: 'timing', duration: 220, easing: EMPHASIZED }}
            >
              <Pressable
                disabled={answered}
                onPress={() => choose(i)}
                android_ripple={{ color: 'rgba(15,118,110,0.10)' }}
                style={({ pressed }) => [
                  styles.quizOpt,
                  pressed && !answered && styles.quizOptPressed,
                  isRight && styles.quizOptRight,
                  isWrong && styles.quizOptWrong,
                  answered && !isRight && !isWrong && styles.quizOptMuted,
                ]}
              >
                <View style={[styles.quizBadge, isRight && styles.quizBadgeRight, isWrong && styles.quizBadgeWrong]}>
                  <Text style={[styles.quizBadgeText, (isRight || isWrong) && { color: '#FFFFFF' }]}>{OPTION_LABELS[i]}</Text>
                </View>
                <Text style={[styles.quizOptText, (isRight || isWrong) && { color: '#0B3B36' }]}>{o}</Text>
                {isRight && <CircleCheck size={17} color={C.primary} strokeWidth={2.2} />}
                {isWrong && <CircleX size={17} color={C.danger} strokeWidth={2.2} />}
              </Pressable>
            </MotiView>
          );
        })}
      </View>

      {answered && !!data.explanation && (
        <MotiView
          from={{ opacity: 0, translateY: 6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 260, easing: EMPHASIZED }}
        >
          {/* Its own tinted panel rather than loose text under the options: the
              explanation is the part worth reading twice, and as bare prose it
              read as a footnote to the card instead of the payoff. */}
          <View style={[styles.quizWhyCard, correct ? styles.quizWhyOk : styles.quizWhyNo]}>
            <View style={styles.quizWhyHead}>
              <View style={[styles.quizWhyDot, { backgroundColor: correct ? C.primary : C.danger }]}>
                {correct
                  ? <Check size={9} color="#FFFFFF" strokeWidth={3.2} />
                  : <X size={9} color="#FFFFFF" strokeWidth={3.2} />}
              </View>
              <Text style={[styles.quizWhyKicker, { color: correct ? C.primary : C.danger }]}>
                {correct ? 'WHY THIS IS RIGHT' : `ANSWER: ${OPTION_LABELS[data.answer]}`}
              </Text>
            </View>
            <Text style={styles.quizWhy}>{parseInline(data.explanation, 'qe', styles.quizWhy)}</Text>
          </View>
        </MotiView>
      )}

      {answered && !isLast && (onAdvance || onNext) && (
        <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 260, delay: 120 }}>
          <Pressable
            disabled={advancing}
            style={[styles.quizNext, advancing && styles.quizNextLoading]}
            onPress={() => { hapticLight(); if (onAdvance) onAdvance(); else onNext?.('Next question'); }}
          >
            {advancing ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.quizNextText}>Loading next question</Text>
              </>
            ) : (
              <>
                <Text style={styles.quizNextText}>Next question</Text>
                <ArrowRight size={15} color="#FFFFFF" strokeWidth={2.4} />
              </>
            )}
          </Pressable>
        </MotiView>
      )}

      {/* Quiz-mode set completion. The PYQ walker draws its own score summary. */}
      {answered && isLast && !isPyq && !onAdvance && (
        <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 260, delay: 120 }}>
          <View style={styles.quizDone}>
            <Award size={15} color={C.primary} strokeWidth={2.4} />
            <Text style={styles.quizDoneText}>Set complete â€” {setSize} of {setSize}</Text>
          </View>
        </MotiView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PYQ set â€” a whole practice set of REAL previous-year questions, walked one at
// a time (counter, next-in-place, score) instead of stacked. The questions are
// all present up front (no round-trip per "next"), which is why this is a local
// walker rather than the LLM-continuation quiz flow.
// ---------------------------------------------------------------------------

type PyqSet = { exam: string; questions: QuizData[] };

function parsePyqSet(raw: string): PyqSet | null {
  try {
    const d = JSON.parse(raw.trim());
    if (!Array.isArray(d?.questions) || !d.questions.length) return null;
    const exam = String(d?.exam || '').trim();
    const questions: QuizData[] = [];
    for (const qd of d.questions) {
      const options = Array.isArray(qd?.options) ? qd.options.map((o: any) => String(o)) : [];
      const answer = Number(qd?.answer);
      if (!qd?.q || options.length < 2) continue;
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
      questions.push({
        q: String(qd.q),
        options,
        answer,
        explanation: qd.explanation ? String(qd.explanation) : undefined,
        source: qd.year ? `${exam} ${qd.year}` : exam,
      });
    }
    return questions.length ? { exam, questions } : null;
  } catch {
    return null;
  }
}

function PyqSetCard({ data }: { data: PyqSet }) {
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const total = data.questions.length;
  const safeIdx = Math.min(idx, total - 1);
  const q = data.questions[safeIdx];
  const isLast = safeIdx >= total - 1;

  return (
    <View>
      <AnimatePresence exitBeforeEnter>
        <MotiView
          key={safeIdx}
          from={{ opacity: 0, translateX: 22 }}
          animate={{ opacity: 1, translateX: 0 }}
          exit={{ opacity: 0, translateX: -22 }}
          transition={{ type: 'timing', duration: 220, easing: EMPHASIZED }}
        >
          <QuizCard
            data={q}
            index={safeIdx}
            total={total}
            onResult={(ok) => { if (ok) setScore((s) => s + 1); if (isLast) setFinished(true); }}
            onAdvance={isLast ? undefined : () => setIdx((i) => i + 1)}
          />
        </MotiView>
      </AnimatePresence>

      {finished && <PyqScore score={score} total={total} />}
    </View>
  );
}

/**
 * Duolingo-style end-of-set card: a big animated ring that fills to the score,
 * the ratio in the centre, and one line of encouragement keyed to how it went.
 * Deliberately minimal â€” one number, one ring, one line.
 */
function PyqScore({ score, total }: { score: number; total: number }) {
  const pct = total > 0 ? score / total : 0;
  const perfect = score === total;
  const good = pct >= 0.6;
  const ring = perfect ? '#FFC800' : good ? C.primary : '#FF9600';
  const size = 76;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <MotiView
      from={{ opacity: 0, translateY: 10, scale: 0.96 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 16, stiffness: 220 }}
      style={styles.pyqScore}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.outlineVariant} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={ring}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={circ * (1 - pct)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Text style={[styles.pyqScoreNum, { color: ring }]}>{score}<Text style={styles.pyqScoreDen}>/{total}</Text></Text>
      </View>
      <Text style={styles.pyqScoreLabel}>
        {perfect ? 'Perfect set! ðŸŽ¯' : good ? 'Solid work â€” keep going.' : 'Review these and retry.'}
      </Text>
    </MotiView>
  );
}

type MathPiece = { kind: 'text'; value: string } | { kind: 'fraction'; numerator: string; denominator: string };

function readBracedMath(value: string, openIndex: number) {
  if (value[openIndex] !== '{') return null;
  let depth = 0;
  for (let i = openIndex; i < value.length; i += 1) {
    if (value[i] === '{') depth += 1;
    if (value[i] === '}') {
      depth -= 1;
      if (depth === 0) return { value: value.slice(openIndex + 1, i), next: i + 1 };
    }
  }
  return null;
}

// A deliberately small native math layout: it improves the high-value
// standalone LaTex fraction without a WebView or a heavyweight parser. Anything
// it cannot prove is a fraction remains ordinary math text, so meaning never
// changes through presentation.
function splitMathPieces(value: string): MathPiece[] {
  const pieces: MathPiece[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('\\frac', cursor);
    if (start < 0) break;
    const numerator = readBracedMath(value, start + 5);
    const denominator = numerator ? readBracedMath(value, numerator.next) : null;
    if (!numerator || !denominator) { cursor = start + 5; continue; }
    if (start > cursor) pieces.push({ kind: 'text', value: value.slice(cursor, start) });
    pieces.push({ kind: 'fraction', numerator: numerator.value, denominator: denominator.value });
    cursor = denominator.next;
  }
  if (cursor < value.length) pieces.push({ kind: 'text', value: value.slice(cursor) });
  return pieces.length ? pieces : [{ kind: 'text', value }];
}

function normaliseMathSource(value: string) {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function MathExpression({ value, compact = false }: { value: string; compact?: boolean }) {
  const cleanValue = useMemo(() => normaliseMathSource(value), [value]);
  const pieces = useMemo(() => splitMathPieces(cleanValue), [cleanValue]);
  return (
    <View style={[styles.mathExpression, compact && styles.mathExpressionCompact]}>
      {pieces.map((piece, index) => piece.kind === 'fraction' ? (
        <View key={index} style={[styles.mathFraction, compact && styles.mathFractionCompact]}>
          <Text style={[styles.mathFractionText, compact && styles.mathFractionTextCompact]}>{formatMathFormula(piece.numerator)}</Text>
          <View style={styles.mathFractionRule} />
          <Text style={[styles.mathFractionText, compact && styles.mathFractionTextCompact]}>{formatMathFormula(piece.denominator)}</Text>
        </View>
      ) : (
        <Text key={index} style={[styles.mathBlockText, compact && styles.mathBlockTextCompact]}>{formatMathFormula(piece.value)}</Text>
      ))}
    </View>
  );
}

function DerivationSequence({ equations }: { equations: { text: string; label?: string }[] }) {
  return (
    <View style={styles.derivation}>
      {equations.map((equation, index) => (
        <View key={`${equation.text}-${index}`} style={styles.derivationRow}>
          <MathExpression value={equation.text} compact />
        </View>
      ))}
    </View>
  );
}

function SemanticNote({ label, text, tone }: { label: string; text: string; tone: 'definition' | 'insight' | 'important' | 'example' }) {
  const icon = tone === 'insight' ? <Lightbulb size={15} color="#6D4DB4" strokeWidth={2.3} />
    : tone === 'important' ? <CircleCheck size={15} color="#B86B11" strokeWidth={2.3} />
    : tone === 'example' ? <ArrowRight size={15} color="#2474A6" strokeWidth={2.3} />
    : <Bookmark size={14} color={C.primary} strokeWidth={2.3} />;
  return (
    <View style={[styles.semanticNote, (styles as any)[`semantic_${tone}`]]}>
      <View style={styles.semanticHead}>{icon}<Text style={[styles.semanticLabel, (styles as any)[`semanticLabel_${tone}`]]}>{label}</Text></View>
      <Text style={styles.semanticText}>{parseInline(text, `semantic-${label}`, styles.semanticText)}</Text>
    </View>
  );
}

function SymbolLegend({ items }: { items: { symbol: string; meaning: string }[] }) {
  return (
    <View style={styles.symbolLegend}>
      {items.map((item, index) => (
        <View key={`${item.symbol}-${index}`} style={styles.symbolRow}>
          <View style={styles.symbolToken}><Text style={styles.symbolText}>{formatMathFormula(item.symbol)}</Text></View>
          <Text style={styles.symbolMeaning}>{parseInline(item.meaning, `symbol-${index}`, styles.symbolMeaning)}</Text>
        </View>
      ))}
    </View>
  );
}

function MarkdownTable({ header, rows }: { header: string[]; rows: string[][] }) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  // Fit common 2â€“3 column study tables inside a 360dp viewport. Only genuinely
  // wide tables overflow horizontally; narrow fact tables stay compact.
  const longest = Array.from({ length: cols }).map((_, c) => Math.max(
    String(header[c] || '').replace(/[*_`]/g, '').length,
    ...rows.map((row) => String(row[c] || '').replace(/[*_`]/g, '').length),
  ));
  const widths = longest.map((chars) => Math.max(88, Math.min(172, chars * 6.1 + 22)));
  const total = widths.reduce((sum, width) => sum + width, 0);
  const compactScale = total > 0 && total <= 344 ? 1 : Math.max(0.86, 344 / total);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tr, styles.trHead]}>
          {Array.from({ length: cols }).map((_, c) => (
            <View key={c} style={[styles.td, { width: Math.round(widths[c] * compactScale) }]}>
              <Text style={styles.thText}>{parseInline(header[c] || '', `th${c}`, styles.thText)}</Text>
            </View>
          ))}
        </View>
        {rows.map((row, r) => (
          <View key={r} style={[styles.tr, r % 2 === 1 && styles.trAlt]}>
            {Array.from({ length: cols }).map((_, c) => (
              <View key={c} style={[styles.td, { width: Math.round(widths[c] * compactScale) }]}>
                <Text style={styles.tdText}>{parseInline(row[c] || '', `td${r}-${c}`, styles.tdText)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Memoised on `text`. During streaming the message list re-renders on every
 * reveal tick, and re-parsing every finished answer each time is pure waste:
 * only the growing message's text actually changes. Without this the cost of a
 * tick scales with the whole transcript, so long chats crawl.
 */
const RichMessage = React.memo(function RichMessage({ text, messageId, onQuizNext, onMindmapQuiz, quizIndex, onQuizAnswered, quizAdvancing }: {
  text: string;
  messageId: string;
  onQuizNext?: (messageId: string, text: string) => void;
  onMindmapQuiz?: (text: string) => void;
  quizIndex?: number;
  onQuizAnswered?: () => void;
  quizAdvancing?: boolean;
}) {
  const renderSpecial = useCallback((b: LearningBlock, key: string) => {
    if (b.k === 'hr') return <View key={key} style={styles.mdHr} />;
    if (b.k === 'table') return <MarkdownTable key={key} header={b.header} rows={b.rows} />;
    if (b.k === 'quote') {
      const isAlert = b.type && b.type !== 'default';
      const alertStyle = isAlert ? (styles as any)[`alert_${b.type}`] : styles.mdQuote;
      const textStyle = isAlert ? (styles as any)[`alertText_${b.type}`] : styles.mdQuoteText;
      const kickerText = b.type && b.type !== 'default' ? b.type.toUpperCase() : '';
      return <View key={key} style={[styles.mdQuote, alertStyle]}>{isAlert && <Text style={[styles.alertKicker, (styles as any)[`alertKicker_${b.type}`]]}>{kickerText}</Text>}<Text style={[styles.mdQuoteText, textStyle]}>{parseInline(b.text, `q-${key}`, textStyle)}</Text></View>;
    }
    if (b.k === 'code') {
      if (b.lang === 'quiz') { const quiz = parseQuiz(b.code); return quiz ? <QuizCard key={key} data={quiz} onNext={(next) => onQuizNext?.(messageId, next)} index={quizIndex} onAnswered={onQuizAnswered} advancing={quizAdvancing} /> : <View key={key} style={styles.quizSkeleton}><TypingDots /></View>; }
      if (b.lang === 'mindmap') { const mm = parseMindmap(b.code); return mm ? <MindmapCard key={key} data={mm} onQuiz={(next) => onMindmapQuiz?.(next)} /> : <View key={key} style={styles.quizSkeleton}><TypingDots /></View>; }
      if (b.lang === 'pyqset') { const set = parsePyqSet(b.code); return set ? <PyqSetCard key={key} data={set} /> : <View key={key} style={styles.quizSkeleton}><TypingDots /></View>; }
      return <CodeBlock key={key} lang={b.lang} code={b.code} />;
    }
    return null;
  }, [messageId, onMindmapQuiz, onQuizAnswered, onQuizNext, quizAdvancing, quizIndex]);

  return (
    <View style={styles.answerDocument}>
      <LearningDocumentRenderer
        text={text}
        renderInline={parseInline}
        formatMath={formatMathFormula}
        renderSpecial={renderSpecial}
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Weak-Area Sprint, rendered INLINE inside the chat (not a separate page). Loads
// the topics due for revision, generates a coaching drill per topic, and walks
// the user through cards + a checkpoint, feeding results back to spaced repetition.
// ---------------------------------------------------------------------------

function InlineSprint({ exam }: { exam?: string }) {
  const [phase, setPhase] = useState<'loading' | 'empty' | 'card' | 'checkpoint' | 'done'>('loading');
  const [topics, setTopics] = useState<WeakTopic[]>([]);
  const tiRef = useRef(0);
  const [content, setContent] = useState<SprintContent | null>(null);
  const [ci, setCi] = useState(0);
  const [showInsight, setShowInsight] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const revisedRef = useRef(0);

  const openTopic = useCallback(async (list: WeakTopic[], idx: number) => {
    setContent(null); setCi(0); setShowInsight(false); setPicked(null); setPhase('loading');
    const t = list[idx];
    let c: SprintContent | null = null;
    try {
      c = await weakAreasService.generateSprint(t.topic, t.reason, t.subject || exam || 'UPSC');
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.startsWith('LIMIT_REACHED:')) showAILimitPrompt(msg.replace('LIMIT_REACHED:', ''));
    }
    if (c && (c.cards?.length || c.checkpoint)) {
      setContent(c);
    } else {
      setContent({ topic: t.topic, cards: [{ heading: t.topic, points: ['Quick recall: revise the core idea and one exam trap for this topic.'], insight: '' }], checkpoint: null });
    }
    setPhase('card');
  }, [exam]);

  const finishTopic = useCallback((correct: boolean) => {
    const t = topics[tiRef.current];
    if (t) {
      if (correct) { weakAreasService.markRevised(t.id).catch(() => {}); revisedRef.current += 1; }
      else weakAreasService.recordWrong(t.topic, t.subject, 'Missed the sprint checkpoint', 'sprint').catch(() => {});
    }
    const next = tiRef.current + 1;
    if (next >= topics.length) { setPhase('done'); return; }
    tiRef.current = next;
    void openTopic(topics, next);
  }, [openTopic, topics]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await weakAreasService.getDueTopics(5);
      if (!alive) return;
      if (!list.length) { setPhase('empty'); return; }
      setTopics(list); tiRef.current = 0;
      void openTopic(list, 0);
    })();
    return () => { alive = false; };
  }, [openTopic]);

  const t = topics[tiRef.current];
  const card = content?.cards?.[ci];
  const lastCard = !!content && ci >= (content.cards?.length ?? 1) - 1;

  if (phase === 'loading') {
    return (
      <View style={styles.sprintCard}>
        <View style={styles.sprintTop}><Dumbbell size={15} color={C.primary} strokeWidth={2.2} /><Text style={styles.sprintKicker}>WEAK-AREA SPRINT</Text></View>
        <View style={{ marginTop: 10 }}><TypingDots /></View>
        <Text style={styles.sprintDim}>{t ? `Building your drill on ${t.topic}â€¦` : 'Finding what is due for revisionâ€¦'}</Text>
      </View>
    );
  }
  if (phase === 'empty') {
    return (
      <View style={styles.sprintCard}>
        <View style={styles.sprintTop}><CircleCheck size={16} color={C.primary} strokeWidth={2.2} /><Text style={styles.sprintKicker}>ALL CAUGHT UP</Text></View>
        <Text style={styles.sprintBody}>Nothing is due for revision right now. Keep answering questions and I will queue whatever you miss, then sprint it back to you here.</Text>
      </View>
    );
  }
  if (phase === 'done') {
    return (
      <View style={styles.sprintCard}>
        <View style={styles.sprintTop}><Award size={16} color={C.primary} strokeWidth={2.2} /><Text style={styles.sprintKicker}>SPRINT COMPLETE</Text></View>
        <Text style={styles.sprintBody}>You revised {revisedRef.current} of {topics.length} weak {topics.length === 1 ? 'area' : 'areas'}. Mastered ones will not resurface until they are due again.</Text>
      </View>
    );
  }
  if (phase === 'checkpoint' && content?.checkpoint) {
    const cp = content.checkpoint;
    const answered = picked !== null;
    return (
      <View style={styles.sprintCard}>
        <View style={styles.sprintTop}><CircleHelp size={16} color={C.primary} strokeWidth={2.2} /><Text style={styles.sprintKicker}>CHECKPOINT Â· {t?.topic?.slice(0, 26)}</Text></View>
        <Text style={styles.sprintQ}>{cp.question}</Text>
        <View style={{ gap: 8, marginTop: 4 }}>
          {cp.options.map((o, i) => {
            const right = answered && i === cp.answerIndex;
            const wrong = answered && i === picked && i !== cp.answerIndex;
            return (
              <Pressable key={i} disabled={answered} onPress={() => { hapticSelect(); setPicked(i); }} style={[styles.sprintOpt, right && styles.sprintOptRight, wrong && styles.sprintOptWrong]}>
                <Text style={[styles.sprintOptText, (right || wrong) && { color: '#0B3B36' }]}>{o}</Text>
              </Pressable>
            );
          })}
        </View>
        {answered && <Text style={styles.sprintWhy}>{picked === cp.answerIndex ? 'Correct. ' : 'Not quite. '}{cp.explanation}</Text>}
        {answered && (
          <Pressable style={styles.sprintBtn} onPress={() => finishTopic(picked === cp.answerIndex)}>
            <Text style={styles.sprintBtnText}>{tiRef.current + 1 >= topics.length ? 'Finish sprint' : 'Next topic'}</Text>
          </Pressable>
        )}
      </View>
    );
  }
  // phase === 'card'
  return (
    <View style={styles.sprintCard}>
      <View style={styles.sprintTop}>
        <Dumbbell size={15} color={C.primary} strokeWidth={2.2} />
        <Text style={styles.sprintKicker}>SPRINT Â· {t?.topic?.slice(0, 24)}</Text>
        <Text style={styles.sprintCount}>{ci + 1}/{content?.cards?.length ?? 1}</Text>
      </View>
      {!!card?.heading && <Text style={styles.sprintHeading}>{card.heading}</Text>}
      <View style={{ gap: 6, marginTop: 2 }}>
        {(card?.points || []).map((p, i) => (
          <View key={i} style={styles.sprintPointRow}><Text style={styles.sprintDot}>â€¢</Text><Text style={styles.sprintPoint}>{p}</Text></View>
        ))}
      </View>
      {!!card?.insight && (
        showInsight
          ? <Text style={styles.sprintInsight}>ðŸ’¡ {card.insight}</Text>
          : <Pressable onPress={() => setShowInsight(true)} style={styles.sprintReveal}><Text style={styles.sprintRevealText}>Show the insight</Text></Pressable>
      )}
      <Pressable
        style={styles.sprintBtn}
        onPress={() => {
          hapticLight();
          if (!lastCard) { setCi((n) => n + 1); setShowInsight(false); return; }
          if (content?.checkpoint) { setPicked(null); setPhase('checkpoint'); return; }
          finishTopic(true);
        }}
      >
        <Text style={styles.sprintBtnText}>{!lastCard ? 'Next card' : content?.checkpoint ? 'Take the checkpoint' : (tiRef.current + 1 >= topics.length ? 'Finish sprint' : 'Next topic')}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// History grouping
// ---------------------------------------------------------------------------

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
function groupSessions(list: ChatSession[]) {
  const today = startOfDay(new Date());
  const day = 86400000;
  const buckets: { label: string; items: ChatSession[] }[] = [
    { label: 'Pinned', items: [] },
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const s of list) {
    if (s.pinned) { buckets[0].items.push(s); continue; }
    const ts = new Date(s.last_message_at || s.updated_at || Date.now()).getTime();
    const d = startOfDay(new Date(ts));
    if (d >= today) buckets[1].items.push(s);
    else if (d >= today - day) buckets[2].items.push(s);
    else if (d >= today - day * 7) buckets[3].items.push(s);
    else buckets[4].items.push(s);
  }
  return buckets.filter((b) => b.items.length);
}

// ---------------------------------------------------------------------------

// Survives an unmount (tab switch) but not a module reload (app cold start), so
// the open chat is restored when the student returns to this tab, while a fresh
// launch still starts empty. Keyed by user so a re-login can't inherit a thread.
let liveChatCache: { userId: string; sessionId: string | null; messages: ChatMessage[] } | null = null;

interface ActiveStreamContext {
  userId: string;
  sessionId: string | null;
  assistantId: string;
  targetText: string;
  shownTextCount: number;
  done: boolean;
  stopped: boolean;
  abortController: AbortController | null;
  messagesRef: { current: ChatMessage[] };
}

let activeStreamContext: ActiveStreamContext | null = null;

export function MigaChat({
  userId,
  languageCode = 'en-IN',
  languageLabel = 'English',
  bottomInset = 0,
  onSwitchToCall,
}: {
  userId: string;
  languageCode?: string;
  languageLabel?: string;
  bottomInset?: number;
  onSwitchToCall?: () => void;
}) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  const [scanOpen, setScanOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [query, setQuery] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Android's adjustResize owns the actual IME viewport. This ref is only a
  // diagnostic record of the native layout we receive; it is deliberately not
  // used to manufacture a second keyboard offset.
  const viewportHeightRef = useRef(0);
  const onViewportLayout = useCallback((event: any) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // A user bubble reveals its copy/edit actions only on long-press, the way
  // WhatsApp/ChatGPT do it â€” otherwise every turn carries a permanent little
  // toolbar that just adds noise to the thread.
  const [revealedUserId, setRevealedUserId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [renaming, setRenaming] = useState<ChatSession | null>(null);
  const [renameText, setRenameText] = useState('');
  const [composerH, setComposerH] = useState(LINE_H);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [sourceEvidence, setSourceEvidence] = useState<TextbookEvidence[] | null>(null);
  // Textbook mode: answers only from the student's own books, with page citations.
  const [textbookMode, setTextbookMode] = useState(false);
  const [textbookScope, setTextbookScope] = useState<TextbookScope>(EMPTY_SCOPE);
  const textbookModeRef = useRef(false);
  const textbookScopeRef = useRef<TextbookScope>(EMPTY_SCOPE);
  useEffect(() => { textbookModeRef.current = textbookMode; }, [textbookMode]);
  useEffect(() => { textbookScopeRef.current = textbookScope; }, [textbookScope]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [mode, scope] = await Promise.all([loadTextbookMode(), loadTextbookScope(userId)]);
      if (!alive) return;
      setTextbookMode(mode);
      setTextbookScope(scope);
    })();
    return () => { alive = false; };
  }, [userId]);
  const handleTextbookToggle = useCallback((next: boolean) => {
    setTextbookMode(next);
    void saveTextbookMode(next);
  }, []);
  const handleTextbookScope = useCallback((next: TextbookScope) => {
    setTextbookScope(next);
    void saveTextbookScope(userId, next);
  }, [userId]);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  const [keyboardFrameHeight, setKeyboardFrameHeight] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardDockActive, setKeyboardDockActive] = useState(false);

  const cloudSessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<FlatList<ChatMessage>>(null);
  const rootRef = useRef<any>(null);
  // When a new question is sent we pin THAT message to the top of the viewport
  // once (via onLayout), then never auto-scroll again, so the answer streams in
  // below without the view jumping around.
  const anchorIdRef = useRef<string | null>(null);
  // Smooth-reveal buffer (ChatGPT-style): tokens land in targetRef; a timer
  // advances shownRef toward it at an even cadence so text never dumps at once.
  const targetRef = useRef('');
  const shownRef = useRef(0);
  const doneRef = useRef(false);
  const revealRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const startRevealRef = useRef<((id: string) => void) | null>(null);
  // Lets identity-stable callbacks reach the latest sendMessage without listing
  // it as a dependency, which would make them change on every render.
  const sendMessageRef = useRef<
    ((text: string, atts?: Attachment[], opts?: { hidden?: boolean; replaceQuiz?: boolean; replaceQuizId?: string; followToBottom?: boolean }) => Promise<void>) | null
  >(null);
  // Whether the stream should keep pulling the view down. Re-armed on send.
  const stickToBottomRef = useRef(true);
  const streamingRef = useRef(false);
  const keyboardProbeTimersRef = useRef<any[]>([]);

  // -------------------------------------------------------------------------
  // Cloud sync
  // -------------------------------------------------------------------------

  const loadChatSessions = useCallback(async () => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('miga_chat_sessions')
        .select('id, title, pinned, last_message_at, updated_at')
        .eq('user_id', userId)
        .eq('archived', false)
        .order('pinned', { ascending: false })
        .order('last_message_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      if (mountedRef.current) {
        setChatSessions(data || []);
      }
      return data || [];
    } catch (error) {
      console.warn('[MigaChat] cloud session list failed', error);
      return null;
    }
  }, [userId]);

  const loadCloudMessages = useCallback(async (sessionId: string) => {
    if (!userId || !sessionId) return;
    try {
      const query = (columns: string) => supabase
        .from('miga_chat_messages')
        .select(columns)
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(80);
      // An installed app can outrun its database. If the feedback migration has
      // not landed yet, fall back rather than failing the whole history load:
      // losing the thumbs state is survivable, losing the thread is not.
      let { data: rows, error } = await query('id, role, content, feedback, evidence');
      if (error) ({ data: rows, error } = await query('id, role, content'));
      if (error) throw error;
      cloudSessionIdRef.current = sessionId;
      setMessages((rows || []).map((row: any) => ({
        id: row.id || newId(),
        rowId: row.id || null,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: String(row.content || ''),
        feedback: (row.feedback as Feedback) ?? null,
        evidence: Array.isArray(row.evidence) ? row.evidence : undefined,
      })));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    } catch (error) {
      console.warn('[MigaChat] cloud history load failed', error);
    }
  }, [userId]);

  const ensureCloudSession = useCallback(async (firstMessage?: string) => {
    if (!userId) return null;
    if (cloudSessionIdRef.current) return cloudSessionIdRef.current;
    try {
      // Deliberately does NOT adopt the most recent session. An empty thread on
      // screen must mean an empty thread on the server, otherwise a fresh chat
      // silently appends to whatever was open last.
      const { data, error } = await supabase
        .from('miga_chat_sessions')
        .insert({ user_id: userId, title: titleFromConversation([firstMessage || 'New chat']) })
        .select('id')
        .single();
      if (error) throw error;
      cloudSessionIdRef.current = data?.id || null;
      void loadChatSessions();
      return cloudSessionIdRef.current;
    } catch (error) {
      console.warn('[MigaChat] cloud session unavailable', error);
      return null;
    }
  }, [loadChatSessions, userId]);

  // Returns the inserted row id so feedback can target it later.
  const persistCloudMessage = useCallback(async (sessionId: string | null, role: ChatRole, content: string, title?: string, evidence?: TextbookEvidence[]) => {
    if (!userId || !sessionId || !content.trim()) return null;
    try {
      const { data } = await supabase
        .from('miga_chat_messages')
        .insert({ session_id: sessionId, user_id: userId, role, content, ...(role === 'assistant' && evidence?.length ? { evidence } : {}) })
        .select('id')
        .single();
      await supabase
        .from('miga_chat_sessions')
        .update({
          updated_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          ...(role === 'user' && title ? { title } : {}),
        })
        .eq('id', sessionId)
        .eq('user_id', userId);
      void loadChatSessions();
      return data?.id || null;
    } catch (error) {
      console.warn('[MigaChat] message cloud sync failed', error);
      return null;
    }
  }, [loadChatSessions, userId]);

  /**
   * Re-title a session once its first answer exists. The row has to be created
   * before the answer does, so its opening title can only ever come from the
   * question â€” which for "hey" or "explain this" names the chat nothing useful.
   * This runs once per session, after the exchange that gives it meaning.
   */
  const retitleSession = useCallback(async (sessionId: string | null, userParts: string[], answer: string) => {
    if (!userId || !sessionId) return;
    let title = '';
    try {
      // Routed through companion_llm_proxy so the OpenRouter key never ships
      // in the client bundle â€” this used to call OpenRouter directly with
      // EXPO_PUBLIC_OPENROUTER_API_KEY, extractable from the app binary.
      const { data } = await supabase.functions.invoke('companion_llm_proxy', {
        body: {
          model: 'google/gemini-2.0-flash-lite:free',
          messages: [
            {
              role: 'system',
              content: 'Generate a short, natural, professional title of 2 to 4 words summarizing the user\'s first question and the assistant\'s answer. Do not use quotes, markdown, punctuation, or helper phrases like "Title:". Examples: "Abolition of Untouchability", "Pallava Rock-Cut Temples", "Repo Rate Definition". Reply in the same language as the conversation (English or Tanglish/Tamil).'
            },
            {
              role: 'user',
              content: `Question: ${userParts.join(' ')}\nAnswer snippet: ${answer.slice(0, 300)}`
            }
          ],
          max_tokens: 15,
          temperature: 0.3
        }
      });
      if (data?.success && data?.content) {
        title = String(data.content).trim().replace(/^['"]|['"]$/g, '');
      }
    } catch (e) {
      console.warn('[MigaChat] LLM titling failed, falling back', e);
    }

    if (!title) {
      title = titleFromExchange(userParts, answer);
    }

    if (!title || title === 'New chat') return;
    try {
      await supabase
        .from('miga_chat_sessions')
        .update({ title })
        .eq('id', sessionId)
        .eq('user_id', userId);
      void loadChatSessions();
    } catch (error) {
      console.warn('[MigaChat] retitle failed', error);
    }
  }, [loadChatSessions, userId]);

  // Regenerate and edit supersede turns that are already on the server. Without
  // this the old rows survive and the thread grows duplicate/stale answers the
  // next time it is loaded from the cloud.
  const deleteCloudRows = useCallback(async (ids: (string | null | undefined)[]) => {
    const real = ids.filter(Boolean) as string[];
    if (!real.length || !userId) return;
    try {
      await supabase.from('miga_chat_messages').delete().in('id', real).eq('user_id', userId);
    } catch (error) {
      console.warn('[MigaChat] superseded row cleanup failed', error);
    }
  }, [userId]);

  // -------------------------------------------------------------------------
  // Keyboard + boot
  // -------------------------------------------------------------------------

  const fallbackKeyboardHeight = useCallback((event?: any) => {
    const eventHeight = event?.endCoordinates?.height;
    const metricHeight = typeof Keyboard.metrics === 'function' ? Keyboard.metrics()?.height : undefined;
    const screenHeight = Dimensions.get('screen').height;
    const windowHeight = Dimensions.get('window').height;
    const resizeDelta = Math.max(0, screenHeight - windowHeight);
    const measured = Math.max(
      typeof eventHeight === 'number' ? eventHeight : 0,
      typeof metricHeight === 'number' ? metricHeight : 0,
      resizeDelta,
    );
    if (Platform.OS !== 'android') return measured;
    // Some Expo/Android overlay combinations report a partial or zero keyboard
    // height even while the IME visibly covers the composer. In focused input
    // state, use a realistic lower bound so open never renders behind the IME.
    const fallback = Math.max(ANDROID_KEYBOARD_MIN_LIFT, Math.round(Dimensions.get('screen').height * ANDROID_KEYBOARD_FALLBACK_RATIO));
    return measured >= ANDROID_KEYBOARD_MIN_LIFT ? measured : fallback;
  }, []);

  const clearKeyboardProbes = useCallback(() => {
    keyboardProbeTimersRef.current.forEach((timer) => clearTimeout(timer));
    keyboardProbeTimersRef.current = [];
  }, []);

  const scheduleKeyboardProbes = useCallback((event?: any) => {
    clearKeyboardProbes();
    const probe = () => {
      const height = fallbackKeyboardHeight(event);
      setKeyboardFrameHeight(height);
      setKeyboardVisible(true);
      setKeyboardDockActive(true);
    };
    probe();
    keyboardProbeTimersRef.current = [70, 180, 320].map((delay) => setTimeout(probe, delay));
  }, [clearKeyboardProbes, fallbackKeyboardHeight]);

  const updateKeyboardOverlap = useCallback((event: any) => {
    const keyboardTop = event?.endCoordinates?.screenY;
    const apply = () => {
      const keyboardHeight = fallbackKeyboardHeight(event);
      setKeyboardFrameHeight(keyboardHeight);
      if (typeof rootRef.current?.measureInWindow !== 'function') {
        setKeyboardOverlap(keyboardHeight);
        setKeyboardVisible(true);
        return;
      }
      rootRef.current.measureInWindow((_x: number, y: number, _width: number, height: number) => {
        const overlap = typeof keyboardTop === 'number' ? Math.max(0, y + height - keyboardTop) : 0;
        setKeyboardOverlap(overlap > 24 ? overlap : 0);
        setKeyboardVisible(true);
      });
    };
    requestAnimationFrame(apply);
    setTimeout(apply, 80);
    setTimeout(apply, 220);
  }, [fallbackKeyboardHeight]);

  // One keyboard owner: the composer uses the measured overlap between the
  // actual MIGA viewport and the native keyboard frame. If Android adjustResize
  // really resized the overlay, overlap is zero and we keep a small visual gap.
  // If the absolute overlay ignores resize, overlap becomes the required dock
  // clearance. Hide always resets it, so there is no stale white reservation.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, updateKeyboardOverlap);
    const onHide = Keyboard.addListener(hideEvt, () => {
      clearKeyboardProbes();
      setKeyboardVisible(false);
      setKeyboardOverlap(0);
      setKeyboardFrameHeight(0);
      setInputFocused(false);
      setKeyboardDockActive(false);
    });
    return () => { onShow.remove(); onHide.remove(); };
  }, [clearKeyboardProbes, updateKeyboardOverlap]);

  // A fresh mount always opens a NEW chat rather than restoring the last thread,
  // matching ChatGPT/Claude/Gemini: launching the app is a new question, and the
  // previous conversation is one tap away in history. Only the session list is
  // fetched here; no thread is loaded.
  //
  // Switching tabs unmounts this screen, so a naive "clear on mount" would drop
  // the open conversation every time the student peeks at another tab. Instead we
  // RESTORE from a module-level cache (see liveChatCache) that survives an
  // unmount within the same app session but not a cold start â€” so a tab hop keeps
  // the chat, while a real relaunch still opens fresh.
  useEffect(() => {
    if (!userId) return;
    if (activeStreamContext && activeStreamContext.userId === userId) {
      cloudSessionIdRef.current = activeStreamContext.sessionId;
      setMessages(activeStreamContext.messagesRef.current);
      setStreaming(true);

      targetRef.current = activeStreamContext.targetText;
      shownRef.current = activeStreamContext.shownTextCount;
      doneRef.current = activeStreamContext.done;
      stoppedRef.current = activeStreamContext.stopped;
      abortRef.current = activeStreamContext.abortController;

      startRevealRef.current?.(activeStreamContext.assistantId);
    } else if (liveChatCache && liveChatCache.messages.length) {
      cloudSessionIdRef.current = liveChatCache.sessionId;
      setMessages(liveChatCache.messages);
    }
    void loadChatSessions();
  }, [loadChatSessions, userId]);

  // Keep the cache in step with the live thread so a remount can restore it.
  useEffect(() => {
    if (messages.length > 0) {
      liveChatCache = { userId: userId || '', sessionId: cloudSessionIdRef.current, messages };
      AsyncStorage.setItem('miga_active_session_cache', JSON.stringify(liveChatCache)).catch(() => {});
    }
  }, [messages, userId]);

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  const stopReveal = useCallback(() => {
    if (revealRef.current) { clearInterval(revealRef.current); revealRef.current = null; }
  }, []);

  // Bring newly revealed content into view once layout has settled. Used when a
  // quiz card appears and when its explanation opens â€” both render below the
  // fold on a tall card, and making the student hunt for them is friction in the
  // exact moment they are waiting for feedback.
  const scrollToEndSoon = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 90);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 280);
  }, []);

  // Reveal loop: ~60fps; reveals a slice per tick, eased so it catches up quickly
  // when far behind and eases out as it nears the buffer end. The floor and the
  // ceiling both matter: too low and long answers crawl behind the network, too
  // high and the "typing" illusion collapses into a paste.
  const startReveal = useCallback((id: string) => {
    if (activeStreamContext && activeStreamContext.assistantId === id) {
      // Resume existing refs from context
    } else {
      targetRef.current = '';
      shownRef.current = 0;
      doneRef.current = false;
    }
    stopReveal();
    revealRef.current = setInterval(() => {
      const target = targetRef.current;
      if (activeStreamContext && activeStreamContext.assistantId === id) {
        activeStreamContext.shownTextCount = shownRef.current;
      }

      if (shownRef.current < target.length) {
        const remaining = target.length - shownRef.current;
        const step = Math.max(REVEAL_MIN_STEP, Math.min(100, Math.ceil(remaining * 0.35)));
        shownRef.current += step;
        const shownText = target.slice(0, shownRef.current);
        const updateMsgs = (prev: ChatMessage[]) => {
          const next = prev.map((m) => (m.id === id ? { ...m, content: shownText } : m));
          if (activeStreamContext && activeStreamContext.assistantId === id) {
            activeStreamContext.messagesRef.current = next;
          }
          return next;
        };
        if (mountedRef.current) {
          setMessages(updateMsgs);
        } else if (activeStreamContext && activeStreamContext.assistantId === id) {
          activeStreamContext.messagesRef.current = updateMsgs(activeStreamContext.messagesRef.current);
        }
      } else if (doneRef.current) {
        const updateMsgs = (prev: ChatMessage[]) => {
          const next = prev.map((m) => (m.id === id ? { ...m, content: targetRef.current } : m));
          if (activeStreamContext && activeStreamContext.assistantId === id) {
            activeStreamContext.messagesRef.current = next;
          }
          return next;
        };
        if (mountedRef.current) {
          setMessages(updateMsgs);
          stopReveal();
          setStreaming(false);
        } else {
          if (activeStreamContext && activeStreamContext.assistantId === id) {
            activeStreamContext.messagesRef.current = updateMsgs(activeStreamContext.messagesRef.current);
          }
          stopReveal();
        }
        if (activeStreamContext && activeStreamContext.assistantId === id) {
          activeStreamContext = null;
        }
      }
    }, REVEAL_TICK_MS);
  }, [stopReveal]);
  startRevealRef.current = startReveal;

  useEffect(() => {
    return () => {
      clearKeyboardProbes();
      if (!activeStreamContext) {
        stopReveal();
        abortRef.current?.abort();
      }
    };
  }, [clearKeyboardProbes, stopReveal]);

  /**
   * Follow the growing answer, throttled. This fires on every reveal tick, and
   * scrollToEnd is a synchronous native layout pass â€” calling it 30x a second
   * stalls the JS thread badly enough to look like the stream itself is slow.
   * One scroll every SCROLL_FOLLOW_MS is visually identical and costs ~1/5th.
   */
  const lastScrollRef = useRef(0);
  const onContentGrow = useCallback(() => {
    if (!streamingRef.current || !stickToBottomRef.current) return;
    const now = Date.now();
    if (now - lastScrollRef.current < SCROLL_FOLLOW_MS) return;
    lastScrollRef.current = now;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  const anchorToTop = useCallback((id: string, y: number) => {
    if (anchorIdRef.current !== id) return;
    anchorIdRef.current = null;
    requestAnimationFrame(() => scrollRef.current?.scrollToOffset({ offset: Math.max(0, y - 12), animated: true }));
  }, []);

  /**
   * Runs one generation into `assistantId`, given the exact history to send.
   * Shared by first-send, regenerate, and edit-and-resend so all three behave
   * identically (including stop, usage limits, and persistence).
   */
  const runGeneration = useCallback(
    async (
      history: { role: string; content: string }[],
      assistantId: string,
      sessionId: string | null,
      atts: Attachment[],
      initialMessages: ChatMessage[],
      replaceQuizId?: string,
    ) => {
      if (mountedRef.current) {
        setStreaming(true);
      }
      stoppedRef.current = false;
      startReveal(assistantId);

      const controller = new AbortController();
      abortRef.current = controller;

      activeStreamContext = {
        userId: userId || '',
        sessionId,
        assistantId,
        targetText: '',
        shownTextCount: 0,
        done: false,
        stopped: false,
        abortController: controller,
        messagesRef: { current: initialMessages },
      };

      try {
        const usage = await AIUsageService.check('miga_message');
        // Only a GENUINE limit blocks (limit > 0 && spent). A gate error returns
        // limit 0, and must never silently swallow the chat: fail open and answer.
        if (usage.limit > 0 && !usage.allowed) {
          const resetIn = formatResetIn(usage.resetAt);
          const back = resetIn ? `back in ${resetIn}` : 'resets tomorrow';
          targetRef.current = `You've used today's ${usage.limit} free MIGA messages, ${back}. Upgrade to Pro for a lot more.`;
          doneRef.current = true;
          if (activeStreamContext) {
            activeStreamContext.done = true;
          }
          return;
        }
      } catch { /* fail-open */ }

      try {
        let streamedEvidence: TextbookEvidence[] = [];
        let streamedCitations: TextbookCitation[] = [];
        await new Promise<void>((resolve, reject) => {
          // The chat must never be able to hang forever. Two safety nets:
          // a stall timer (no token for STALL_MS) and a hard ceiling, both of
          // which abort the socket and settle this promise.
          let settled = false;
          let stall: any = null;
          const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(stall);
            clearTimeout(ceiling);
            fn();
          };
          const giveUp = () => {
            controller.abort();
            finish(() => reject(new Error('Stream stalled')));
          };
          const armStall = () => {
            clearTimeout(stall);
            stall = setTimeout(giveUp, STALL_MS);
          };
          const ceiling = setTimeout(giveUp, MAX_STREAM_MS);
          armStall();

          mascotApi.streamChat(
            userId || 'guest',
            [{ role: 'system', content: buildChatPrompt() }, ...history],
            'chat',
            (token) => {
              targetRef.current += token;
              if (activeStreamContext) {
                activeStreamContext.targetText = targetRef.current;
              }
              armStall();
            },
            () => finish(resolve),
            (err) => finish(() => reject(err)),
            {
              // Text chat must never force a language onto the reply â€” it should
              // only ever mirror whatever the student actually typed. languageCode/
              // languageLabel here used to be the same shared state as voice/call
              // mode's language picker, so picking a language for a voice call also
              // silently forced every typed chat message into that language.
              languageCode: 'en-IN',
              languageLabel: 'English',
              signal: controller.signal,
              attachments: atts.map((a) => ({ dataUrl: a.dataUrl, mimeType: a.mimeType })),
              onEvidence: (payload) => { streamedEvidence = Array.isArray(payload?.evidence) ? payload.evidence as TextbookEvidence[] : []; },
              textbookMode: textbookModeRef.current,
              textbookScope: textbookScopeRef.current,
              onCitations: (payload) => { streamedCitations = Array.isArray(payload?.citations) ? payload.citations as TextbookCitation[] : []; },
            },
            // A throw inside streamChat itself (before any callback fires) would
            // otherwise strand this promise â€” surface it as a normal error.
          ).catch((err: any) => finish(() => reject(err)));
        });
        if (!targetRef.current.trim()) targetRef.current = 'Hmm, I blanked on that, try asking again?';
        doneRef.current = true;
        if (activeStreamContext) {
          activeStreamContext.done = true;
        }
        const rowId = await persistCloudMessage(sessionId, 'assistant', targetRef.current, undefined, streamedEvidence);
        const updateMsgs = (prev: ChatMessage[]) => {
          const pendingQuiz = replaceQuizId ? prev.find((m) => m.id === assistantId) : undefined;
          const next = replaceQuizId
            ? prev
              .filter((m) => m.id !== assistantId)
              .map((m) => (m.id === replaceQuizId
                ? {
                  ...m,
                  content: targetRef.current,
                  rowId, evidence: streamedEvidence.length ? streamedEvidence : undefined,
                  citations: usedCitations(targetRef.current, streamedCitations),
                  quizIndex: pendingQuiz?.quizIndex ?? m.quizIndex,
                  quizAdvancing: false,
                }
                : m))
            : prev.map((m) => (m.id === assistantId ? { ...m, rowId, evidence: streamedEvidence.length ? streamedEvidence : undefined, citations: usedCitations(targetRef.current, streamedCitations) } : m));
          if (activeStreamContext) activeStreamContext.messagesRef.current = next;
          return next;
        };
        if (mountedRef.current) {
          setMessages(updateMsgs);
        } else if (activeStreamContext) {
          activeStreamContext.messagesRef.current = updateMsgs(activeStreamContext.messagesRef.current);
        }
        AIUsageService.consume('miga_message').catch(() => {});
        // Name the chat from the exchange that just completed. `history` holds
        // the turns sent to the model, so one prior user turn means this was the
        // opening exchange and the placeholder title is still in place.
        if (history.filter((h) => h.role === 'user').length <= 1) {
          void retitleSession(sessionId, history.filter((h) => h.role === 'user').map((h) => h.content), targetRef.current);
        }
        // Mark the opening question of a set so the counter starts at 1, and
        // bring the card into view â€” it renders below a long prose lead-in.
        if (/```quiz/.test(targetRef.current)) {
          const updateQuiz = (prev: ChatMessage[]) => {
            const next = prev.map((m) => (
              m.id === assistantId && typeof m.quizIndex !== 'number' ? { ...m, quizIndex: 0 } : m
            ));
            if (activeStreamContext) activeStreamContext.messagesRef.current = next;
            return next;
          };
          if (mountedRef.current) {
            setMessages(updateQuiz);
            scrollToEndSoon();
          } else if (activeStreamContext) {
            activeStreamContext.messagesRef.current = updateQuiz(activeStreamContext.messagesRef.current);
          }
        }
      } catch {
        if (stoppedRef.current) {
          // User pressed stop: keep whatever streamed in, mark it, don't error.
          doneRef.current = true;
          if (activeStreamContext) activeStreamContext.done = true;
          const updateStop = (prev: ChatMessage[]) => {
            const next = replaceQuizId
              ? prev
                .filter((m) => m.id !== assistantId)
                .map((m) => (m.id === replaceQuizId ? { ...m, quizAdvancing: false } : m))
              : prev.map((m) => (m.id === assistantId ? { ...m, stopped: true } : m));
            if (activeStreamContext) activeStreamContext.messagesRef.current = next;
            return next;
          };
          if (mountedRef.current) {
            setMessages(updateStop);
          } else if (activeStreamContext) {
            activeStreamContext.messagesRef.current = updateStop(activeStreamContext.messagesRef.current);
          }
          if (targetRef.current.trim()) void persistCloudMessage(sessionId, 'assistant', targetRef.current);
          return;
        }
        doneRef.current = true;
        if (activeStreamContext) activeStreamContext.done = true;
        if (!targetRef.current.trim()) {
          targetRef.current = 'Connection hiccup. Tap retry to try again.';
          const updateFail = (prev: ChatMessage[]) => {
            const next = replaceQuizId
              ? prev
                .filter((m) => m.id !== assistantId)
                .map((m) => (m.id === replaceQuizId ? { ...m, quizAdvancing: false } : m))
              : prev.map((m) => (m.id === assistantId ? { ...m, failed: true } : m));
            if (activeStreamContext) activeStreamContext.messagesRef.current = next;
            return next;
          };
          if (mountedRef.current) {
            setMessages(updateFail);
          } else if (activeStreamContext) {
            activeStreamContext.messagesRef.current = updateFail(activeStreamContext.messagesRef.current);
          }
        } else {
          void persistCloudMessage(sessionId, 'assistant', targetRef.current);
        }
      } finally {
        abortRef.current = null;
        if (activeStreamContext) {
          activeStreamContext.abortController = null;
        }
        doneRef.current = true;
        if (activeStreamContext) {
          activeStreamContext.done = true;
        }
      }
    },
    [languageCode, languageLabel, persistCloudMessage, retitleSession, scrollToEndSoon, startReveal, userId],
  );

  /**
   * Advance a quiz run. The turn still goes to the model (it needs the history
   * to know where the set is up to) but is flagged hidden, so the thread does
   * not fill up with the student pressing a button. The answered card is dropped
   * as the next one arrives â€” the Telegram poll feel, one live question at a
   * time rather than an ever-growing wall of finished quizzes.
   */
  const handleQuizNext = useCallback((quizMessageId: string, t: string) => {
    // Keep the answered card in place while the next model turn is generated.
    // A quiet in-button loading state is far clearer than replacing a question
    // with a generic thinking shell.
    stickToBottomRef.current = true;
    void sendMessageRef.current?.(t, [], { hidden: true, replaceQuiz: true, replaceQuizId: quizMessageId });
  }, []);

  const handleMindmapQuiz = useCallback((t: string) => {
    stickToBottomRef.current = true;
    void sendMessageRef.current?.(t, [], { followToBottom: true });
  }, []);

  const stopGeneration = useCallback(() => {
    stoppedRef.current = true;
    hapticLight();
    abortRef.current?.abort();
    doneRef.current = true;
  }, []);

  const sendMessage = useCallback(
    async (text: string, atts: Attachment[] = [], opts?: { hidden?: boolean; replaceQuiz?: boolean; replaceQuizId?: string; followToBottom?: boolean }) => {
      const clean = text.trim();
      if ((!clean && !atts.length) || streaming) return;

      hapticLight();
      Keyboard.dismiss(); // hand the screen back to the answer
      // ChatGPT/Claude behaviour: pin the just-sent question near the top and let
      // the answer flow BELOW it, rather than yanking the view to the bottom as
      // it streams. anchorToTop (fired on the user row's layout) does the pin;
      // not sticking to bottom is what keeps a short answer â€” like a single PYQ
      // card â€” sitting still where the reader is already looking.
      stickToBottomRef.current = !!opts?.replaceQuiz || !!opts?.followToBottom;
      const assistantId = newId();
      const history = messages
        .filter((m) => !m.sprintRun && m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      const sessionTitle = titleFromConversation([
        ...messages.filter((m) => m.role === 'user').map((m) => m.content),
        clean,
      ]);
      const userMsgId = newId();
      // A hidden advance must not re-anchor the scroll: the student is mid-run
      // and the next card should simply take the finished one's place.
      anchorIdRef.current = opts?.hidden || opts?.followToBottom ? null : userMsgId;

      // Position in the run, so the card can show "Question 3 of 10".
      const prevQuizIndex = [...messages].reverse().find((m) => typeof m.quizIndex === 'number')?.quizIndex;
      const nextQuizIndex = opts?.replaceQuiz
        ? (typeof prevQuizIndex === 'number' ? prevQuizIndex + 1 : 1)
        : (/```quiz/.test(text) ? undefined : 0);

      const base = opts?.replaceQuizId
        ? messages.map((m) => (m.id === opts.replaceQuizId ? { ...m, quizAdvancing: true } : m))
        : opts?.replaceQuiz
        ? messages.filter((m) => !(m.role === 'assistant' && typeof m.quizIndex === 'number'))
        : messages;
      const nextMessages: ChatMessage[] = [
        ...base,
        { id: userMsgId, role: 'user', content: clean, attachments: atts, hidden: opts?.hidden },
        { id: assistantId, role: 'assistant', content: '', hidden: !!opts?.replaceQuizId, quizIndex: opts?.replaceQuiz ? nextQuizIndex : undefined },
      ];
      setMessages(nextMessages);
      setInput('');
      setPending([]);
      setComposerH(LINE_H);
      setStreaming(true);
      if (opts?.replaceQuiz || opts?.followToBottom) scrollToEndSoon();

      // Optimistic UI is deliberately ahead of persistence. A slow/new Supabase
      // session must never make a student wonder whether Send registered.
      void (async () => {
        const sessionId = await ensureCloudSession(clean);
        void persistCloudMessage(sessionId, 'user', clean, sessionTitle).then((rowId) => {
          if (mountedRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, rowId } : m)));
          }
        });
        await runGeneration([...history, { role: 'user', content: clean }], assistantId, sessionId, atts, nextMessages, opts?.replaceQuizId);
      })();
    },
    [ensureCloudSession, messages, persistCloudMessage, runGeneration, scrollToEndSoon, streaming],
  );
  sendMessageRef.current = sendMessage;

  const sendAnswerFollowUp = useCallback((prompt: string) => {
    if (streaming) return;
    const clean = prompt.trim();
    if (!clean) return;
    void sendMessageRef.current?.(clean, [], { followToBottom: true });
  }, [streaming]);

  const regenerate = useCallback(async () => {
    if (streaming) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.sprintRun);
    if (!lastAssistant) return;
    const idx = messages.findIndex((m) => m.id === lastAssistant.id);
    const history = messages
      .slice(0, idx)
      .filter((m) => !m.sprintRun && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    if (!history.length) return;

    hapticLight();
    void deleteCloudRows([lastAssistant.rowId]); // the answer being replaced
    const nextMessages = messages.map((m) => (m.id === lastAssistant.id ? { ...m, content: '', failed: false, stopped: false, feedback: null, rowId: null } : m));
    setMessages(nextMessages);
    await runGeneration(history, lastAssistant.id, cloudSessionIdRef.current, [], nextMessages);
  }, [deleteCloudRows, messages, runGeneration, streaming]);

  const commitEdit = useCallback(async () => {
    const id = editingId;
    const text = editText.trim();
    if (!id || !text || streaming) { setEditingId(null); return; }
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) { setEditingId(null); return; }

    const history = messages
      .slice(0, idx)
      .filter((m) => !m.sprintRun && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    const assistantId = newId();
    const userMsgId = messages[idx].id;
    setEditingId(null);
    anchorIdRef.current = id;
    // Drop everything from the edited turn onward: the thread re-forks from here,
    // on the server as well as locally.
    void deleteCloudRows(messages.slice(idx).map((m) => m.rowId));
    const nextMessages: ChatMessage[] = [
      ...messages.slice(0, idx),
      { ...messages[idx], content: text, rowId: null },
      { id: assistantId, role: 'assistant', content: '' },
    ];
    setMessages(nextMessages);
    const sessionId = await ensureCloudSession(text);
    void persistCloudMessage(sessionId, 'user', text).then((rowId) => {
      if (mountedRef.current) {
        setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, rowId } : m)));
      }
    });
    await runGeneration([...history, { role: 'user', content: text }], assistantId, sessionId, [], nextMessages);
  }, [deleteCloudRows, editText, editingId, ensureCloudSession, messages, persistCloudMessage, runGeneration, streaming]);

  // -------------------------------------------------------------------------
  // Message actions
  // -------------------------------------------------------------------------

  const copyMessage = useCallback(async (id: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      hapticLight();
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {}
  }, []);

  const shareMessage = useCallback(async (text: string) => {
    try {
      hapticLight();
      // Strip the fenced blocks (quiz/pyqset/mindmap JSON) â€” sharing raw JSON is
      // noise; share the readable answer with a light MindGains attribution.
      const clean = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
      if (!clean) return;
      await Share.share({ message: `${clean}\n\nâ€” via MindGains` });
    } catch {}
  }, []);

  const rateMessage = useCallback(async (msg: ChatMessage, value: Exclude<Feedback, null>) => {
    const next = msg.feedback === value ? null : value;
    hapticSelect();
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, feedback: next } : m)));
    if (!msg.rowId || !userId) return;
    try {
      await supabase.from('miga_chat_messages').update({ feedback: next }).eq('id', msg.rowId).eq('user_id', userId);
    } catch (error) {
      console.warn('[MigaChat] feedback sync failed', error);
    }
  }, [userId]);

  const addImage = useCallback(async () => {
    if (pending.length >= MAX_ATTACHMENTS) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photo access needed', 'Allow photo access to attach an image to your question.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        selectionLimit: MAX_ATTACHMENTS - pending.length,
        allowsMultipleSelection: true,
      });
      if (res.canceled) return;
      hapticLight();
      const next = res.assets
        .filter((a) => a.base64)
        .map((a) => {
          const mimeType = a.mimeType || 'image/jpeg';
          return { id: newId(), mimeType, dataUrl: `data:${mimeType};base64,${a.base64}` };
        });
      setPending((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      console.warn('[MigaChat] image pick failed', error);
    }
  }, [pending.length]);

  const openAttachmentMenu = useCallback(() => {
    if (pending.length >= MAX_ATTACHMENTS) return;
    hapticLight();
    Alert.alert('Add to chat', undefined, [
      { text: 'Choose image', onPress: addImage },
      { text: 'Scan question paper', onPress: () => setScanOpen(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [addImage, pending.length]);

  const activateKeyboardDock = useCallback(() => {
    if (Platform.OS !== 'android') return;
    setInputFocused(true);
    setKeyboardDockActive(true);
    scheduleKeyboardProbes();
  }, [scheduleKeyboardProbes]);

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  const startNewChat = useCallback(() => {
    cloudSessionIdRef.current = null;
    setMessages([]);
    setInput('');
    setPending([]);
    setHistoryOpen(false);
  }, []);

  const openChatSession = useCallback((sessionId: string) => {
    setHistoryOpen(false);
    setQuery('');
    void loadCloudMessages(sessionId);
  }, [loadCloudMessages]);

  const togglePin = useCallback(async (session: ChatSession) => {
    const next = !session.pinned;
    hapticSelect();
    setChatSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: next } : s)));
    try {
      await supabase.from('miga_chat_sessions').update({ pinned: next }).eq('id', session.id).eq('user_id', userId);
      void loadChatSessions();
    } catch (error) {
      console.warn('[MigaChat] pin failed', error);
    }
  }, [loadChatSessions, userId]);

  const commitRename = useCallback(async () => {
    const s = renaming;
    const title = renameText.trim();
    setRenaming(null);
    if (!s || !title) return;
    setChatSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title } : x)));
    try {
      await supabase.from('miga_chat_sessions').update({ title }).eq('id', s.id).eq('user_id', userId);
      void loadChatSessions();
    } catch (error) {
      console.warn('[MigaChat] rename failed', error);
    }
  }, [loadChatSessions, renameText, renaming, userId]);

  const deleteSession = useCallback((session: ChatSession) => {
    Alert.alert('Delete chat?', `"${session.title || 'New chat'}" will be removed. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setChatSessions((prev) => prev.filter((s) => s.id !== session.id));
          if (cloudSessionIdRef.current === session.id) startNewChat();
          try {
            // Archive rather than hard-delete: the row is the anchor for its
            // messages, and history stays recoverable server-side.
            await supabase.from('miga_chat_sessions').update({ archived: true }).eq('id', session.id).eq('user_id', userId);
            void loadChatSessions();
          } catch (error) {
            console.warn('[MigaChat] delete failed', error);
          }
        },
      },
    ]);
  }, [loadChatSessions, startNewChat, userId]);

  const handleScanResults = useCallback((answers: PaperAnswer[], note?: string) => {
    if (!answers.length) return;
    const lines = answers.map((a) => {
      const head = a.answer
        ? 'Q' + a.q + ': ' + a.answer + (a.answerText ? ': ' + a.answerText : '')
        : 'Q' + a.q + ': ' + (a.answerText || '');
      return a.reason ? head + '\n   ' + a.reason : head;
    });
    const body = 'Scanned ' + answers.length + ' question' + (answers.length > 1 ? 's' : '') + ':\n\n' + lines.join('\n\n') + (note ? '\n\n' + note : '');
    const userScanMessage = 'Scanned a question paper';
    const sessionTitle = titleFromConversation([
      ...messages.filter((m) => m.role === 'user').map((m) => m.content),
      ...answers.map((answer) => [answer.q, answer.answer, answer.answerText, answer.reason].filter(Boolean).join(' ')),
    ]);
    const userMsgId = newId();
    anchorIdRef.current = userMsgId;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: userScanMessage },
      { id: newId(), role: 'assistant', content: body },
    ]);
    void (async () => {
      const sessionId = await ensureCloudSession(userScanMessage);
      await persistCloudMessage(sessionId, 'user', userScanMessage, sessionTitle);
      await persistCloudMessage(sessionId, 'assistant', body);
    })();
  }, [ensureCloudSession, messages, persistCloudMessage]);

  // Start the Weak-Area Sprint INSIDE the chat: drop a run marker message that
  // renders the interactive InlineSprint, and pin it to the top of the view.
  const startSprint = useCallback(() => {
    const userMsgId = newId();
    anchorIdRef.current = userMsgId;
    hapticLight();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: 'Sprint my weak areas' },
      { id: newId(), role: 'assistant', content: '', sprintRun: true },
    ]);
  }, []);

  // -------------------------------------------------------------------------

  const showEmpty = messages.length === 0;
  // Sits clear of the tab bar with real breathing room beneath it â€” a composer
  // flush to the bottom edge reads as cramped next to the rest of the app.
  // bottomInset is the visible tab-bar reservation supplied by the host. Keep
  // the dock close to it; Android's resized root handles the keyboard position.
  // `bottomInset` is the full occupied host navigation area, not merely the
  // Android safe-area inset. The chat overlay sits behind the global tab bar.
  // One bottom-dock source: the host measures the real global tab dock. When
  // Android resizes the viewport for the IME, that dock is no longer visible,
  // so only a deliberate 10px visual gap remains. There is no keyboard-height
  // translation anywhere in this component.
  const closedDockClearance = Math.max(bottomInset + 8, 58);
  const openDockClearance = Math.max(keyboardOverlap, Platform.OS === 'android' ? keyboardFrameHeight : 0) + 10;
  const keyboardActive = keyboardVisible || inputFocused || keyboardDockActive;
  const composerBottom = closedDockClearance;
  const composerLift = keyboardActive ? Math.max(0, openDockClearance - closedDockClearance) : 0;
  const composerBarHeight = Math.min(MAX_COMPOSER_HEIGHT, Math.max(LINE_H, composerH)) + INPUT_PAD_V * 2;
  const composerReservedHeight = composerBottom + composerLift + composerBarHeight + (pending.length ? 62 : 0);
  const nativeKeyboard = useAnimatedKeyboard();
  const dockKeyboardStyle = useAnimatedStyle(() => {
    const nativeLift = Math.max(0, nativeKeyboard.height.value - closedDockClearance + 10);
    const lift = Math.max(nativeLift, composerLift);
    return { transform: [{ translateY: -lift }] };
  }, [closedDockClearance, composerLift]);
  const canSend = (!!input.trim() || pending.length > 0) && !streaming;
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant' && !m.sprintRun)?.id,
    [messages],
  );

  // Hidden turns (quiz advances) exist in history for the model but are never
  // drawn. Everything that renders indexes THIS list, never `messages`.
  const visibleMessages = useMemo(() => messages.filter((m) => !m.hidden), [messages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chatSessions;
    return chatSessions.filter((s) => (s.title || 'New chat').toLowerCase().includes(q));
  }, [chatSessions, query]);
  const grouped = useMemo(() => groupSessions(filtered), [filtered]);

  return (
    <KeyboardAvoidingView
      style={[styles.flex, styles.chatSurface]}
      onLayout={onViewportLayout}
      // Android manifest uses adjustResize. Let that native viewport be the
      // single layout owner; a height-mode KeyboardAvoidingView on top of it
      // was the source of the stale white reservation after IME dismissal.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      enabled={Platform.OS === 'ios'}
    >
      <View ref={rootRef} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      {showEmpty && <View style={styles.headerSky} pointerEvents="none" />}
      <View style={styles.chatHeader}>
        {/* Absolutely centred, so the wordmark sits at the true midpoint of the
            screen no matter how wide the flanking controls get. Laid out first
            and non-interactive so the buttons above it still take taps. */}
        <View style={styles.brandAbs} pointerEvents="none">
          <View style={styles.chatBrand}>
            <Text style={styles.chatBrandText}>MIGA</Text>
            <View style={styles.brandBolt}>
              <Zap size={10} color="#FFFFFF" strokeWidth={2.6} fill="#FFFFFF" />
            </View>
          </View>
        </View>

        <View style={styles.headerGroup}>
          <Pressable
            onPress={() => { hapticLight(); setHistoryOpen(true); }}
            android_ripple={{ color: STATE_PRESSED, borderless: true, radius: 20 }}
            style={({ pressed }) => [styles.chatIconButton, pressed && styles.stateLayer]}
            accessibilityLabel="Open chat history"
          >
            <Menu size={19} color={C.onSurface} strokeWidth={2.1} />
          </Pressable>
          {!showEmpty && (
            <Pressable
              onPress={startNewChat}
              android_ripple={{ color: STATE_PRESSED, borderless: true, radius: 20 }}
              style={({ pressed }) => [styles.chatIconButton, pressed && styles.stateLayer]}
              accessibilityLabel="New chat"
            >
              <SquarePen size={17} color={C.onSurface} strokeWidth={2} />
            </Pressable>
          )}
        </View>

        <View style={styles.headerSpacer} />

        <View style={styles.headerGroup}>
          {onSwitchToCall && (
            <Pressable
              onPress={onSwitchToCall}
              android_ripple={{ color: STATE_PRESSED }}
              style={({ pressed }) => [styles.chatCallPill, pressed && styles.stateLayer]}
              accessibilityLabel="Switch to voice call"
            >
              <Phone size={14} color={C.primary} strokeWidth={2.3} />
              <Text style={styles.chatCallText}>Call</Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: composerReservedHeight + 18 },
          showEmpty && styles.scrollContentEmpty,
        ]}
        data={showEmpty ? [] : visibleMessages}
        keyExtractor={(item) => item.id}
        initialNumToRender={12}
        windowSize={9}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={40}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={128}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          setScrollOffset(contentOffset.y);
          const bottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
          setAtBottom((prev) => (prev !== bottom ? bottom : prev));
          stickToBottomRef.current = bottom;
        }}
        // Follow the answer as it grows, the way every major assistant does, but
        // only while the user is already at the bottom. Yanking someone back down
        // while they are reading earlier text is worse than not following at all.
        onContentSizeChange={onContentGrow}
        ListEmptyComponent={showEmpty ? (
          <View style={styles.empty}>
            {/* Sky wash behind the hero. Its mid tone (#E4F2FD) is the exact colour
                the hero fades into, so the image's bottom edge has no visible seam;
                below the hero it continues to white for the cards. */}
            <LinearGradient
              colors={['#DCEEFB', '#E4F2FD', '#E4F2FD', '#FFFFFF']}
              locations={[0, 0.45, 0.66, 1]}
              style={styles.emptySky}
              pointerEvents="none"
            />

            <MotiView
              from={{ scale: 0.9, opacity: 0, translateY: -8 }}
              animate={{ scale: 1, opacity: 1, translateY: 0 }}
              transition={SPRING_SPATIAL}
              style={styles.heroWrap}
            >
              <Image source={require('@/assets/images/miga-hero.jpg')} style={styles.hero} resizeMode="cover" />
              {/* Top edge dissolves into the header sky (kept short, above the ears). */}
              <LinearGradient
                colors={['#DCEEFB', 'rgba(220,238,251,0)']}
                style={styles.heroTopFade}
                pointerEvents="none"
              />
              {/* Dissolves the image's lower half into the SAME sky tone as the page
                  behind it, so it reads as one continuous sky, not a pasted photo. */}
              <LinearGradient
                colors={['rgba(228,242,253,0)', 'rgba(228,242,253,0.9)', '#E4F2FD']}
                locations={[0.2, 0.72, 1]}
                style={styles.heroFade}
                pointerEvents="none"
              />
            </MotiView>

            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ ...SPRING_SPATIAL, delay: 60 }}
              style={styles.emptyHeadWrap}
            >
              <Text style={styles.emptyTitle}>
                What would you{'\n'}like to <Text style={styles.emptyTitleAccent}>learn today</Text>?
              </Text>
            </MotiView>

            <View style={styles.suggGrid}>
              {SUGGESTIONS.map((sg, i) => (
                <MotiView
                  key={sg.label}
                  from={{ opacity: 0, translateY: 16, scale: 0.96 }}
                  animate={{ opacity: 1, translateY: 0, scale: 1 }}
                  transition={{ ...SPRING_SPATIAL, delay: 140 + i * 60 }}
                  style={styles.suggCell}
                >
                  <Pressable
                    onPress={() => {
                      hapticLight();
                      if (sg.scan) setScanOpen(true);
                      else if (sg.sprint) startSprint();
                      else setInput(sg.prefill || '');
                    }}
                    android_ripple={{ color: 'rgba(15,23,42,0.06)' }}
                    style={({ pressed }) => [styles.suggChip, pressed && styles.suggChipPressed]}
                  >
                    <View style={[styles.suggIcon, { backgroundColor: sg.color }]}>
                      <sg.icon size={17} color="#FFFFFF" strokeWidth={2.6} />
                    </View>
                    <Text style={styles.suggText} numberOfLines={2}>{sg.label}</Text>
                  </Pressable>
                </MotiView>
              ))}
            </View>
          </View>
        ) : null}
        renderItem={({ item: m, index: mi }) => (
            <MessageShell
              key={m.id}
              id={m.id}
              onAnchor={anchorToTop}
            >
              <MotiView
                from={{ opacity: 0, translateY: 12 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 250, easing: EMPHASIZED }}
                style={styles.flex}
              >
                {m.role === 'user' ? (
                  editingId === m.id ? (
                    <View style={styles.editCard}>
                      <TextInput
                        style={styles.editInput}
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        autoFocus
                        placeholderTextColor={C.onSurfaceFaint}
                      />
                      <View style={styles.editActions}>
                        <Pressable onPress={() => setEditingId(null)} style={styles.editCancel}>
                          <Text style={styles.editCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={commitEdit} style={styles.editSave}>
                          <Text style={styles.editSaveText}>Send</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.userRow}>
                      <View style={styles.userBubble}>
                        {!!m.attachments?.length && (
                          <View style={styles.attachRow}>
                            {m.attachments.map((a) => (
                              <Pressable key={a.id} onPress={() => { hapticLight(); setZoomImage(a.dataUrl); }}>
                                <Image source={{ uri: a.dataUrl }} style={styles.attachThumbSent} />
                              </Pressable>
                            ))}
                          </View>
                        )}
                        <Pressable
                          onLongPress={() => { hapticLight(); setRevealedUserId((id) => (id === m.id ? null : m.id)); }}
                          delayLongPress={280}
                        >
                          <Text style={styles.textUser} selectable={false}>{m.content}</Text>
                        </Pressable>
                      </View>
                      <AnimatePresence>
                        {!streaming && revealedUserId === m.id && (
                          <MotiView
                            from={{ opacity: 0, translateY: -4 }}
                            animate={{ opacity: 1, translateY: 0 }}
                            exit={{ opacity: 0, translateY: -4 }}
                            transition={{ type: 'timing', duration: 160, easing: EMPHASIZED }}
                            style={styles.userActions}
                          >
                            <PressableScale
                              onPress={() => copyMessage(m.id, m.content)}
                              style={styles.userActionBtn}
                              accessibilityLabel="Copy this message"
                            >
                              {copiedId === m.id
                                ? <Check size={14} color={C.primary} strokeWidth={2.6} />
                                : <Copy size={14} color={C.onSurfaceVariant} strokeWidth={2.1} />}
                            </PressableScale>
                            <PressableScale
                              onPress={() => { hapticLight(); setEditingId(m.id); setEditText(m.content); setRevealedUserId(null); }}
                              style={styles.userActionBtn}
                              accessibilityLabel="Edit this message"
                            >
                              <Pencil size={14} color={C.onSurfaceVariant} strokeWidth={2.1} />
                            </PressableScale>
                          </MotiView>
                        )}
                      </AnimatePresence>
                    </View>
                  )
                ) : (
                  <View style={styles.assistantBlock}>
                    <View style={styles.migaTag}>
                      <Image source={require('@/assets/images/miga_chat_avatar.png')} style={styles.migaAvatar} />
                      <Text style={styles.migaTagText}>MIGA</Text>
                    </View>

                    <View style={styles.assistantCard}>
                      {m.sprintRun ? (
                        <InlineSprint />
                      ) : !m.content ? (
                        // An assistant turn always trails the user turn it answers,
                        // so the previous row carries the prompt being worked on.
                        <ThinkingLine prompt={visibleMessages[mi - 1]?.role === 'user' ? visibleMessages[mi - 1].content : ''} />
                      ) : (
                        <>
                          <RichMessage
                            text={m.evidence?.length ? withoutStructuredLegacyFooter(m.content) : m.content}
                            messageId={m.id}
                            onQuizNext={handleQuizNext}
                            onMindmapQuiz={handleMindmapQuiz}
                            quizIndex={m.quizIndex}
                            onQuizAnswered={scrollToEndSoon}
                            quizAdvancing={m.quizAdvancing}
                          />

                          {!m.sprintRun && !!m.content && (
                            <View style={styles.studyActionPanel}>
                              <View style={styles.studyActionRow}>
                                <PressableScale
                                  onPress={() => sendAnswerFollowUp('Rewrite the previous answer in a brief, exam-ready way. Keep only the core idea and the most important takeaway.')}
                                  style={[styles.studyActionChip, styles.studyActionChipTeal]}
                                  accessibilityLabel="Get a brief answer"
                                >
                                  <SquarePen size={12} color="#0F766E" strokeWidth={2.2} />
                                  <Text style={styles.studyActionText}>Brief</Text>
                                </PressableScale>
                                <PressableScale
                                  onPress={() => sendAnswerFollowUp('Rewrite the previous answer in a mains-style way with clear headings, compact depth, and exam points.')}
                                  style={[styles.studyActionChip, styles.studyActionChipViolet]}
                                  accessibilityLabel="Get a mains style answer"
                                >
                                  <Award size={12} color="#6D3AC8" strokeWidth={2.2} />
                                  <Text style={styles.studyActionText}>Mains</Text>
                                </PressableScale>
                                <PressableScale
                                  onPress={() => sendAnswerFollowUp('Explain the previous answer more visually and simply, using a short structure, analogy, or sequence if helpful.')}
                                  style={[styles.studyActionChip, styles.studyActionChipBlue]}
                                  accessibilityLabel="Explain visually"
                                >
                                  <Lightbulb size={12} color="#2563EB" strokeWidth={2.3} />
                                  <Text style={styles.studyActionText}>Visual</Text>
                                </PressableScale>
                                <PressableScale
                                  onPress={() => sendAnswerFollowUp('Quiz me on this topic.')}
                                  style={[styles.studyActionChip, styles.studyActionChipAmber]}
                                  accessibilityLabel="Quiz me on this"
                                >
                                  <CircleHelp size={12} color="#C2410C" strokeWidth={2.3} />
                                  <Text style={styles.studyActionText}>Quiz me</Text>
                                </PressableScale>
                              </View>
                            </View>
                          )}

                          {!!m.evidence?.length && (() => {
                            const groupedEvidence = groupEvidenceBySource(m.evidence);
                            const primaryEvidence = groupedEvidence[0];
                            const d = primaryEvidence?.display || {};
                            const identity = formatEvidenceIdentity(d);
                            const unitLine = formatEvidenceUnit(d) || [d.chapterNumber && `Chapter ${d.chapterNumber}`, d.chapterTitle].filter(Boolean).join(' · ');
                            const sourceLine = [identity, d.bookTitle ? `${d.bookTitle}${d.volumeOrPart ? ` · ${d.volumeOrPart}` : ''}` : '', unitLine].filter(Boolean).join(' · ');
                            return (
                              <View style={styles.sourcePreviewCard}>
                                <View style={styles.sourcePreviewHead}>
                                  <View style={styles.sourcePreviewIcon}><CircleCheck size={13} color={C.primary} strokeWidth={2.4} /></View>
                                  <View style={styles.sourcePreviewHeadText}>
                                    <Text style={styles.sourcePreviewTitle}>Textbook verified</Text>
                                    {!!sourceLine && <Text style={styles.sourcePreviewLine}>{sourceLine}</Text>}
                                  </View>
                                </View>
                              </View>
                            );
                          })()}

                          {!!m.citations?.length && <CitationChips citations={m.citations} />}

                          {m.stopped && <Text style={styles.stoppedNote}>Stopped by you</Text>}

                          {!m.sprintRun && !!m.content && !(streaming && m.id === lastAssistantId) && (
                            <View style={styles.cardFooter}>
                              <View style={styles.footerLine} />
                              <View style={styles.actionRow}>
                                {SHOW_SOURCES_BUTTON && !!m.evidence?.length && (
                                  <PressableScale onPress={() => { hapticLight(); setSourceEvidence(m.evidence || null); }} style={styles.sourcesAction} accessibilityLabel={`Open ${groupEvidenceBySource(m.evidence).length} textbook sources`}>
                                    <CircleCheck size={14} color={C.primary} strokeWidth={2.4} />
                                    <Text style={styles.sourcesActionText}>Sources · {groupEvidenceBySource(m.evidence).length}</Text>
                                  </PressableScale>
                                )}
                                <PressableScale onPress={() => copyMessage(m.id, m.content)} style={styles.actionBtn} accessibilityLabel="Copy answer">
                                  {copiedId === m.id
                                    ? <Check size={14} color={C.primary} strokeWidth={2.6} />
                                    : <Copy size={14} color={C.onSurfaceVariant} strokeWidth={2} />}
                                </PressableScale>

                                <PressableScale onPress={() => shareMessage(m.content)} style={styles.actionBtn} accessibilityLabel="Share answer">
                                  <Share2 size={14} color={C.onSurfaceVariant} strokeWidth={2} />
                                </PressableScale>

                                {m.id === lastAssistantId && (
                                  <PressableScale onPress={regenerate} style={styles.actionBtn} accessibilityLabel={m.failed ? 'Retry' : 'Regenerate'}>
                                    <RefreshCw size={14} color={m.failed ? C.primary : C.onSurfaceVariant} strokeWidth={m.failed ? 2.6 : 2} />
                                  </PressableScale>
                                )}

                                {!m.failed && (
                                  <View style={styles.rateGroup}>
                                    <PressableScale onPress={() => rateMessage(m, 'up')} style={styles.actionBtn} accessibilityLabel="Good answer">
                                      <ThumbsUp size={14} strokeWidth={2} color={m.feedback === 'up' ? C.primary : C.onSurfaceVariant} fill={m.feedback === 'up' ? C.primarySoft : 'transparent'} />
                                    </PressableScale>
                                    <PressableScale onPress={() => rateMessage(m, 'down')} style={styles.actionBtn} accessibilityLabel="Bad answer">
                                      <ThumbsDown size={14} strokeWidth={2} color={m.feedback === 'down' ? C.danger : C.onSurfaceVariant} fill={m.feedback === 'down' ? C.dangerSoft : 'transparent'} />
                                    </PressableScale>
                                  </View>
                                )}
                              </View>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                )}
              </MotiView>
            </MessageShell>
        )}
      />

      {/* Fullscreen Image Zoom Modal */}
      <Modal visible={!!zoomImage} transparent animationType="fade" onRequestClose={() => setZoomImage(null)}>
        <View style={styles.zoomModalBg}>
          <Pressable style={styles.zoomClose} onPress={() => setZoomImage(null)}>
            <X size={22} color="#FFFFFF" strokeWidth={2.5} />
          </Pressable>
          {zoomImage && (
            <Image source={{ uri: zoomImage }} style={styles.zoomImageFull} resizeMode="contain" />
          )}
        </View>
      </Modal>

      <Modal visible={!!sourceEvidence} transparent animationType="slide" onRequestClose={() => setSourceEvidence(null)}>
        <View style={styles.sourcesScrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSourceEvidence(null)} />
          <View style={styles.sourcesSheet}>
            <View style={styles.sourcesHandle} />
            {(() => { const grouped = groupEvidenceBySource(sourceEvidence); return (
            <>
            <View style={styles.sourcesHead}><View><Text style={styles.sourcesTitle}>Sources · {grouped.length}</Text><Text style={styles.sourcesSub}>Textbook passages used for this answer</Text></View><Pressable onPress={() => setSourceEvidence(null)} hitSlop={12}><X size={19} color={C.onSurfaceVariant} /></Pressable></View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sourcesList}>
              {grouped.map((e, index) => { const d = e.display || {}; const identity = [d.board && String(d.board).toUpperCase(), d.classLevel && `Class ${d.classLevel}`, d.subject && String(d.subject).replace(/-/g, ' ')].filter(Boolean).join(' Â· '); const legacyChapter = [d.chapterNumber && `Chapter ${d.chapterNumber}`, d.chapterTitle].filter(Boolean).join(' Â· '); const sourceUnit = formatEvidenceUnit(d) || legacyChapter; return <View key={e.evidenceId} style={styles.sourceRow}><Text style={styles.sourceIndex}>{index + 1}</Text><View style={styles.sourceBody}>{!!identity && <Text style={styles.sourceIdentity}>{identity}</Text>}{!!d.bookTitle && <Text style={styles.sourceBook}>{d.bookTitle}{d.volumeOrPart ? ` Â· ${d.volumeOrPart}` : ''}</Text>}{!!sourceUnit && <Text style={styles.sourceChapter}>{sourceUnit}</Text>}<Text style={styles.sourceExcerpt}>{e.excerpt}</Text>{e.supportingChunkCount > 1 && <Text style={styles.sourceSupport}>{e.supportingChunkCount} supporting passages</Text>}{!!d.officialSourceUrl && <Pressable onPress={() => Linking.openURL(d.officialSourceUrl!)}><Text style={styles.sourceOpen}>Open official chapter</Text></Pressable>}</View></View>; })}
            </ScrollView>
            </>
            ); })()}
          </View>
        </View>
      </Modal>

      {/* Jump to top */}
      <AnimatePresence>
        {scrollOffset > 300 && !showEmpty && (
          <MotiView
            from={{ opacity: 0, scale: 0.8, translateY: 6 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'timing', duration: 180, easing: EMPHASIZED }}
            style={[styles.jumpTopWrap, { bottom: composerReservedHeight + 18 }]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => { hapticLight(); scrollRef.current?.scrollToOffset({ offset: 0, animated: true }); }}
              style={styles.jumpBtn}
              accessibilityLabel="Scroll to top"
            >
              <ArrowUp size={17} color={C.onSurface} strokeWidth={2.3} />
            </Pressable>
          </MotiView>
        )}
      </AnimatePresence>

      {/* Jump to latest */}
      <AnimatePresence>
        {!atBottom && !showEmpty && (
          <MotiView
            from={{ opacity: 0, scale: 0.8, translateY: 6 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'timing', duration: 180, easing: EMPHASIZED }}
            style={[styles.jumpWrap, { bottom: composerReservedHeight + 12 }]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => { hapticLight(); scrollRef.current?.scrollToEnd({ animated: true }); }}
              style={styles.jumpBtn}
              accessibilityLabel="Jump to latest message"
            >
              <ArrowDown size={17} color={C.onSurface} strokeWidth={2.3} />
            </Pressable>
          </MotiView>
        )}
      </AnimatePresence>

      {/* The resized Android root owns keyboard placement; no manual translate. */}
      <Animated.View style={[styles.dock, { bottom: composerBottom }, dockKeyboardStyle]}>
        {pending.length > 0 && (
          <View style={styles.pendingRow}>
            {pending.map((a) => (
              <View key={a.id} style={styles.pendingChip}>
                <Image source={{ uri: a.dataUrl }} style={styles.pendingThumb} />
                <Pressable
                  onPress={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}
                  style={styles.pendingX}
                  hitSlop={6}
                  accessibilityLabel="Remove attachment"
                >
                  <X size={11} color="#FFFFFF" strokeWidth={3} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <TextbookModeBar
          enabled={textbookMode}
          scope={textbookScope}
          onToggle={handleTextbookToggle}
          onScopeChange={handleTextbookScope}
        />
        <View style={styles.inputBar}>
          <Pressable
            onPress={openAttachmentMenu}
            disabled={pending.length >= MAX_ATTACHMENTS}
            android_ripple={{ color: 'rgba(15,118,110,0.18)', borderless: true, radius: 20 }}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed, pending.length >= MAX_ATTACHMENTS && { opacity: 0.4 }]}
            accessibilityLabel="Add image or scan a question paper"
          >
            <Plus size={21} color={C.onSurfaceVariant} strokeWidth={2.2} />
          </Pressable>

          {/* The placeholder is its own layer: RN renders a TextInput's own
              placeholder at the input's fontSize, and this one has to be
              smaller and heavier than what the user types. It is pinned to the
              first text line so it never drifts as the field grows. */}
          <View style={styles.inputWrap}>
            {!input && (
              <Text style={styles.placeholder} pointerEvents="none" numberOfLines={1}>
                Ask MIGA anything
              </Text>
            )}
            <TextInput
              style={[styles.input, { height: Math.min(MAX_COMPOSER_HEIGHT, Math.max(LINE_H, composerH)) }]}
              value={input}
              onChangeText={setInput}
              multiline
              onPressIn={activateKeyboardDock}
              onFocus={() => {
                setInputFocused(true);
                setKeyboardDockActive(true);
                if (Platform.OS === 'android') scheduleKeyboardProbes();
              }}
              onBlur={() => {
                setInputFocused(false);
              }}
              onContentSizeChange={(e) => setComposerH(e.nativeEvent.contentSize.height)}
            />
          </View>

          <View style={styles.rightActions}>
            {onSwitchToCall && !input.trim() && !pending.length && !streaming && (
              <Pressable
                onPress={onSwitchToCall}
                android_ripple={{ color: 'rgba(15,118,110,0.18)', borderless: true, radius: 20 }}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                accessibilityLabel="Switch to voice call"
              >
                <Mic size={19} color={C.primary} strokeWidth={2.3} />
              </Pressable>
            )}
            <Pressable
              onPress={() => (streaming ? stopGeneration() : sendMessage(input, pending))}
              disabled={!streaming && !canSend}
              android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false, radius: 24 }}
              style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed]}
              accessibilityLabel={streaming ? 'Stop generating' : 'Send message'}
            >
              <LinearGradient
                colors={!streaming && !canSend ? ['#C2D6D3', '#B3CBC7'] : [C.primaryBright, C.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendFill}
              >
                <MotiView
                  key={streaming ? 'stop' : 'send'}
                  from={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'timing', duration: 180, easing: EMPHASIZED }}
                >
                  {streaming
                    ? <Square size={12} color="#FFFFFF" strokeWidth={2.4} fill="#FFFFFF" />
                    : <ArrowUp size={19} color="#FFFFFF" strokeWidth={2.6} />}
                </MotiView>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Animated.View>

      <PaperScanModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        languageCode={languageCode}
        onResults={handleScanResults}
      />

      {/* History bottom sheet â€” same shape/motion as call mode's "Sessions" sheet
          (mascot.tsx isSessionSheetOpen): scrim + sheet sliding up from the bottom,
          not a side drawer. */}
      <AnimatePresence>
        {historyOpen && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'timing', duration: 180 }}
            style={[StyleSheet.absoluteFillObject, styles.bottomSheetOverlay]}
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setHistoryOpen(false)} />
            <MotiView
              from={{ translateY: 320, opacity: 0.92 }}
              animate={{ translateY: 0, opacity: 1 }}
              exit={{ translateY: 320, opacity: 0.92 }}
              transition={{ type: 'timing', duration: 220 }}
              style={[styles.bottomSheet, { paddingBottom: Math.max(bottomInset, 16) + 8 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.sheetHandle} />

              <View style={styles.sessionSheetHead}>
                <Text style={styles.sheetTitle}>History</Text>
                <Pressable onPress={startNewChat} style={({ pressed }) => [styles.sessionNewBtn, pressed && styles.stateLayer]}>
                  <Plus size={15} color="#FFFFFF" strokeWidth={2.6} />
                  <Text style={styles.sessionNewBtnText}>New</Text>
                </Pressable>
              </View>

              <View style={styles.searchBar}>
                <Search size={15} color="#64748B" strokeWidth={2.2} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search chats"
                  placeholderTextColor="#64748B"
                />
                {!!query && (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <CircleX size={15} color="#64748B" strokeWidth={2.2} />
                  </Pressable>
                )}
              </View>

              <ScrollView style={styles.bottomSheetScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {!grouped.length ? (
                  <View style={styles.emptySessionBox}>
                    <Text style={styles.emptySessionText}>{query ? `No chats match "${query}".` : 'No saved chats yet.'}</Text>
                  </View>
                ) : grouped.map((group) => (
                  <View key={group.label}>
                    <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
                    {group.items.map((session) => {
                      const active = session.id === cloudSessionIdRef.current;
                      return (
                        <Pressable
                          key={session.id}
                          style={[styles.sessionRow, active && styles.sessionRowActive]}
                          onPress={() => openChatSession(session.id)}
                        >
                          <LinearGradient
                            colors={session.pinned ? ['#7C4DFF', '#5B3FA0'] : ['#3B82F6', '#2255D9']}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={styles.sessionBadge}
                          >
                            {session.pinned
                              ? <Bookmark size={13} color="#FFFFFF" strokeWidth={2.4} fill="#FFFFFF" />
                              : <Zap size={13} color="#FFFFFF" strokeWidth={2.4} fill="#FFFFFF" />}
                          </LinearGradient>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sessionTitle} numberOfLines={1}>{session.title || 'New chat'}</Text>
                            <Text style={styles.sessionMeta} numberOfLines={1}>
                              {active ? 'Active now' : 'Cloud archived'}
                            </Text>
                          </View>
                          <Pressable onPress={() => togglePin(session)} hitSlop={8} style={styles.rowAction} accessibilityLabel={session.pinned ? 'Unpin chat' : 'Pin chat'}>
                            <Bookmark size={14} strokeWidth={2} color={session.pinned ? '#7C4DFF' : '#94A3B8'} fill={session.pinned ? '#7C4DFF' : 'transparent'} />
                          </Pressable>
                          <Pressable
                            onPress={() => { setRenaming(session); setRenameText(session.title || ''); }}
                            hitSlop={8}
                            style={styles.rowAction}
                            accessibilityLabel="Rename chat"
                          >
                            <Pencil size={14} color="#94A3B8" strokeWidth={2} />
                          </Pressable>
                          <Pressable onPress={() => deleteSession(session)} hitSlop={8} style={styles.rowAction} accessibilityLabel="Delete chat">
                            <Trash2 size={14} color="#94A3B8" strokeWidth={2} />
                          </Pressable>
                          {active
                            ? <CircleDot size={16} color="#3B82F6" strokeWidth={2.4} />
                            : <ChevronRight size={16} color="#CBD5E1" strokeWidth={2.2} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </MotiView>
          </MotiView>
        )}
      </AnimatePresence>

      {/* Rename */}
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.renameOverlay} onPress={() => setRenaming(null)}>
          <View style={styles.renameCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.renameTitle}>Rename chat</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              placeholder="Chat name"
              placeholderTextColor={C.onSurfaceFaint}
              onSubmitEditing={commitRename}
              returnKeyType="done"
            />
            <View style={styles.renameActions}>
              <Pressable onPress={() => setRenaming(null)} style={styles.editCancel}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={commitRename} style={styles.editSave}>
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chatSurface: { backgroundColor: '#FCFDFC' },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 50,
  },
  brandAbs: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  headerGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerSpacer: { flex: 1 },
  chatBrand: { flexDirection: 'row', alignItems: 'center' },
  chatBrandText: { fontFamily: 'Poppins-Bold', fontSize: 17, color: C.onSurface, letterSpacing: 1.2 },
  brandBolt: { width: 19, height: 19, borderRadius: 7, marginLeft: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, transform: [{ rotate: '8deg' }] },
  // Tonal surface + state layer, not an outline: M3 reads elevation from colour.
  chatIconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceContainer },
  stateLayer: { backgroundColor: C.surfaceContainerHigh },
  chatCallPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, height: 40, borderRadius: 20, backgroundColor: C.primaryContainer },
  chatCallText: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: C.primary, letterSpacing: 0.2 },
  scrollContent: { paddingHorizontal: 16, paddingVertical: 12 },
  scrollContentEmpty: { flexGrow: 1, justifyContent: 'flex-start' },

  empty: { alignItems: 'center' },
  // Sky wash bleeds past the scroll padding to the screen edges.
  emptySky: { position: 'absolute', top: -20, left: -20, right: -20, height: 440 },
  // Matches the hero/emptySky top colour so the header area reads as continuous sky.
  headerSky: { position: 'absolute', top: 0, left: 0, right: 0, height: 130, backgroundColor: '#DCEEFB' },
  // Full-bleed hero banner (cancels the content's 16px padding). The height
  // crops the image's lower edge, which is what leaves the gap above the heading.
  heroWrap: { alignSelf: 'stretch', marginHorizontal: -16, marginTop: -6, height: 258, overflow: 'hidden' },
  hero: { width: '100%', height: '100%' },
  heroTopFade: { position: 'absolute', left: 0, right: 0, top: 0, height: 34 },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 },
  emptyHeadWrap: { marginTop: 12 },
  emptyTitle: { fontFamily: 'Poppins-Bold', fontSize: 29, lineHeight: 36, color: '#0B2540', letterSpacing: -0.8, textAlign: 'center' },
  emptyTitleAccent: { color: C.primary },

  suggGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 20, marginHorizontal: -5 },
  suggCell: { width: '50%', padding: 5 },
  // White card, colour comes from the icon coin â€” the Duolingo signature. Flat:
  // depth is a hairline border, not a shadow.
  suggChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, minHeight: 58,
    borderWidth: 1, borderColor: '#E7EEF4',
  },
  suggChipPressed: { backgroundColor: '#F6FAFF', transform: [{ scale: 0.97 }] },
  suggIcon: {
    width: 37, height: 37, borderRadius: 18.5, alignItems: 'center', justifyContent: 'center',
  },
  suggText: { flex: 1, fontFamily: 'Poppins-SemiBold', fontSize: 13, lineHeight: 17, color: '#0B2540', letterSpacing: -0.2 },

  // Traditional famous app exchange layout: tight 4px gap between user question
  // and assistant answer, clean 14px gap between turns.
  msgBlock: { marginBottom: 12 },
  userRow: { width: '100%', alignItems: 'flex-end', marginTop: 10, marginBottom: 2 },
  // Duolingo speech bubble: soft teal fill, chunky radius, and depth from a
  // heavier bottom border rather than a shadow.
  userBubble: {
    maxWidth: '86%',
    backgroundColor: '#0F766E',
    borderRadius: 20,
    borderTopRightRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  textUser: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#FFFFFF', lineHeight: 22, letterSpacing: -0.1 },
  // Right-aligned icon pair under the user's bubble.
  userActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4, marginRight: 2 },
  userActionBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceContainer,
  },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 9 },
  attachThumbSent: { width: 62, height: 62, borderRadius: 11, backgroundColor: C.surfaceContainerHigh },
  editCard: { width: '100%' },
  editInput: { fontFamily: 'Inter-Medium', fontSize: 15.5, color: C.onSurface, lineHeight: 23, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.primary, padding: 12, minHeight: 76 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 9 },
  editCancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 11 },
  editCancelText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: C.onSurfaceVariant },
  editSave: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 11, backgroundColor: C.primary },
  editSaveText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#FFFFFF' },

  assistantBlock: { width: '100%', paddingHorizontal: 1, marginTop: 4, marginBottom: 16 },
  assistantCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#D9E8E5',
    borderBottomWidth: 3,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    marginVertical: 0,
  },
  answerDocument: { paddingTop: 1 },
  studyActionPanel: {
    marginTop: 10,
    marginBottom: 4,
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#FBFDFD',
    borderWidth: 1,
    borderColor: '#E3EEEB',
  },
  studyActionRow: { flexDirection: 'row', gap: 6, flexWrap: 'nowrap' },
  studyActionChip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 16,
    paddingHorizontal: 8,
    minHeight: 34,
    borderWidth: 1,
  },
  studyActionChipTeal: { backgroundColor: '#F0FBF9', borderColor: '#CBEAE5' },
  studyActionChipViolet: { backgroundColor: '#F7F3FF', borderColor: '#E3D8FF' },
  studyActionChipBlue: { backgroundColor: '#EFF6FF', borderColor: '#D6E6FF' },
  studyActionChipAmber: { backgroundColor: '#FFF7ED', borderColor: '#F9E2C6' },
  studyActionText: { fontFamily: 'Inter-SemiBold', fontSize: 11.3, lineHeight: 14, color: C.onSurface, textAlign: 'center', includeFontPadding: false },
  answerTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 21, lineHeight: 27, letterSpacing: -0.45, color: C.onSurface, marginTop: 3, marginBottom: 7 },
  answerLead: { fontFamily: 'Inter-Medium', fontSize: 16, lineHeight: 24, color: '#273449', marginBottom: 10, letterSpacing: -0.1 },
  listGroup: { marginVertical: 2, gap: 1 },
  cardFooter: { marginTop: 13, marginHorizontal: -14, marginBottom: -10 },
  footerLine: { height: 1, backgroundColor: '#E7EEF4', marginHorizontal: 0, marginBottom: 7 },
  progressBarContainer: { height: 3, width: '100%', backgroundColor: '#F1F5F9', position: 'absolute', top: 54, zIndex: 100 },
  progressBar: { height: '100%', backgroundColor: C.primary },
  jumpTopWrap: { position: 'absolute', right: 20, zIndex: 90 },

  zoomModalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.95)', justifyContent: 'center', alignItems: 'center' },
  zoomClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  zoomImageFull: { width: '100%', height: '85%' },

  thinkContainer: { paddingVertical: 12, gap: 10 },
  thinkHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  thinkStatusText: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: '#0F766E' },
  thinkDotsContainer: { width: 30, height: 12, justifyContent: 'center' },
  skeletonMargin: { marginTop: 4 },

  primaryEquation: { marginVertical: 11, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#CFE8E2', backgroundColor: '#F7FBFA' },
  inlineEquation: { alignSelf: 'center', marginVertical: 5, paddingVertical: 2, maxWidth: '100%' },
  derivation: { marginVertical: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: '#CDE7E1', gap: 2 },
  derivationRow: { minHeight: 25, justifyContent: 'center' },
  mathExpression: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, alignItems: 'center', justifyContent: 'center', minHeight: 28, maxWidth: '100%' },
  mathExpressionCompact: { justifyContent: 'flex-start', minHeight: 23 },
  mathBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontStyle: 'italic',
    fontSize: 19,
    color: '#0B3B36',
    lineHeight: 30,
    textAlign: 'center',
    flexShrink: 1,
  },
  mathBlockTextCompact: { fontSize: 16.5, lineHeight: 23, textAlign: 'left' },
  mathBlockLabel: { alignSelf: 'center', marginBottom: 3, fontFamily: 'Inter-SemiBold', fontSize: 10.5, letterSpacing: 0.8, color: C.primary },
  mathFraction: { alignItems: 'center', justifyContent: 'center', marginHorizontal: 4, minWidth: 30 },
  mathFractionText: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontStyle: 'italic', fontSize: 17, lineHeight: 21, color: '#0B3B36' },
  mathFractionCompact: { marginHorizontal: 3, minWidth: 24 },
  mathFractionTextCompact: { fontSize: 14.5, lineHeight: 18 },
  mathFractionRule: { alignSelf: 'stretch', height: 1.2, backgroundColor: '#0B3B36', marginVertical: 1 },

  semanticNote: { borderLeftWidth: 3, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 9, marginVertical: 7 },
  semanticHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  semanticLabel: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, letterSpacing: 0.05 },
  semanticText: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 22, color: C.onSurface },
  semantic_definition: { backgroundColor: '#F1F8F7', borderLeftColor: C.primary },
  semanticLabel_definition: { color: C.primary },
  semantic_insight: { backgroundColor: '#F7F4FE', borderLeftColor: '#8B6CC7' },
  semanticLabel_insight: { color: '#6D4DB4' },
  semantic_important: { backgroundColor: '#FFFAF0', borderLeftColor: '#D29439' },
  semanticLabel_important: { color: '#A85F0B' },
  semantic_example: { backgroundColor: '#F2F8FD', borderLeftColor: '#4A90C2' },
  semanticLabel_example: { color: '#2474A6' },

  symbolLegend: { marginVertical: 9, borderWidth: 1, borderColor: '#E1EAE7', borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E9EFED' },
  symbolToken: { minWidth: 30, paddingHorizontal: 7, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF6F3' },
  symbolText: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontStyle: 'italic', fontSize: 17, color: C.primary },
  symbolMeaning: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 14.5, lineHeight: 20.5, color: C.onSurface },

  migaTag: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  migaAvatar: { width: 29, height: 29, borderRadius: 14.5, backgroundColor: '#E8F6F3', borderWidth: 1, borderColor: 'rgba(15,118,110,0.18)' },
  // A rounded coin, sized to sit level with the wordmark â€” the same badge
  // language as the streak/XP icons on the home header.
  migaTagBolt: {
    width: 22, height: 22, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary,
    borderBottomWidth: 2, borderBottomColor: '#0B5C55',
  },
  migaTagText: { fontFamily: 'Poppins-Bold', fontSize: 13, letterSpacing: 0.7, color: C.onSurface },
  migaGrounded: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 27, paddingHorizontal: 8, borderRadius: 14, backgroundColor: '#EEF8F6', borderWidth: 1, borderColor: '#D7ECE7' },
  migaGroundedText: { fontFamily: 'Inter-SemiBold', fontSize: 11.5, color: C.primary },
  stoppedNote: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: C.onSurfaceFaint, marginTop: 8, fontStyle: 'italic' },

  // Icon-only symbols, ChatGPT-style: no labels, no boxes â€” just the glyph with
  // the PressableScale dip. A hairline square gives a faint touch target without
  // the heavy pill the labelled version used.
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingBottom: 8 },
  actionBtn: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  rateGroup: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  // Mindmap. Duolingo construction throughout: white card, colour carried by the
  // branch coins and rails, depth from a heavier bottom border rather than a
  // shadow â€” the same recipe as the home screen and the action pills.
  mmCard: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: C.outlineVariant,
    borderBottomWidth: 4,
    padding: 16,
  },
  mmHeader: { marginBottom: 14 },
  mmKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7 },
  mmKicker: { fontFamily: 'Poppins-Bold', fontSize: 10, letterSpacing: 1.3, color: C.primary },
  mmRoot: { fontFamily: 'Poppins-Bold', fontSize: 19, color: '#0B2540', letterSpacing: -0.4, lineHeight: 25 },
  mmSubtitle: { fontFamily: 'Inter-Medium', fontSize: 12, color: C.onSurfaceVariant, marginTop: 3 },

  mmBody: { gap: 4 },
  mmBranch: { paddingVertical: 2 },
  mmHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 },
  // The coin anchors the branch colour; the rail below inherits it so the eye
  // tracks one hue down through the children.
  mmCoin: { width: 13, height: 13, borderRadius: 7 },
  mmBranchLabel: { flex: 1, fontFamily: 'Poppins-SemiBold', fontSize: 14.5, color: '#0B2540', letterSpacing: -0.2 },
  mmRefPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  mmRefText: { fontFamily: 'Inter-Bold', fontSize: 10.5, letterSpacing: 0.1 },

  mmChildren: { marginLeft: 6, paddingLeft: 15, borderLeftWidth: 2.5, paddingVertical: 3, gap: 7 },
  mmLeafRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  mmLeafDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  mmLeafText: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 13.5, color: '#334155', lineHeight: 19 },

  mmQuizBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 11, borderRadius: 999,
    backgroundColor: C.primarySoft,
    borderWidth: 1.5, borderColor: '#CDE7E1', borderBottomWidth: 3,
  },
  mmQuizBtnPressed: { backgroundColor: '#D3EAE5', borderBottomWidth: 1.5, marginTop: 15.5 },
  mmQuizText: { fontFamily: 'Inter-Bold', fontSize: 13.5, color: C.primary, letterSpacing: -0.1 },

  // Compact exam-reading hierarchy: no coloured highlighter treatment on prose.
  textAssistant: { fontFamily: 'Inter-Regular', fontSize: 15.5, color: C.onSurface, lineHeight: 23.5, letterSpacing: -0.05, marginBottom: 9 },
  mdBold: {
    fontFamily: 'Inter-Bold',
    color: '#0E5F59',
    backgroundColor: '#EAF8F5',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  mdItalic: { fontStyle: 'italic' },
  mdStrike: { textDecorationLine: 'line-through', color: C.onSurfaceVariant },
  mdLink: { color: C.primary, textDecorationLine: 'underline' },
  mdInlineCode: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13.5, color: C.inlineCodeText, backgroundColor: C.inlineCodeBg },
  mdHeading: { fontFamily: 'Poppins-SemiBold', fontSize: 19, color: C.onSurface, lineHeight: 25, marginTop: 12, marginBottom: 5, letterSpacing: -0.25 },
  mdHeadingSm: { fontFamily: 'Poppins-SemiBold', fontSize: 17, lineHeight: 23, letterSpacing: -0.05 },
  mdHr: { height: StyleSheet.hairlineWidth, backgroundColor: C.outlineVariant, marginVertical: 11 },
  mdQuote: { borderLeftWidth: 2, borderLeftColor: C.primary, backgroundColor: '#F6FAF9', borderRadius: 7, paddingVertical: 8, paddingHorizontal: 11, marginVertical: 7 },
  mdQuoteText: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 22, color: C.onSurface },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginVertical: 2 },
  mdBulletIconContainer: { width: 12, height: 23, justifyContent: 'center', alignItems: 'center' },
  mdBulletIcon: { width: 5, height: 5, borderRadius: 3 },
  mdNum: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: C.primary, lineHeight: 23, minWidth: 16 },
  mdBulletText: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 15.5, color: C.onSurface, lineHeight: 23 },

  // Callout Boxes (Alert cards)
  alertKicker: { fontFamily: 'Poppins-Bold', fontSize: 11, letterSpacing: 0.8, marginBottom: 4 },
  alert_note: { backgroundColor: '#F0F9FF', borderLeftColor: '#0284C7', borderLeftWidth: 4, borderRadius: 10, padding: 12, marginVertical: 8 },
  alertText_note: { color: '#0369A1' },
  alertKicker_note: { color: '#0284C7' },

  alert_warning: { backgroundColor: '#FFFBEB', borderLeftColor: '#D97706', borderLeftWidth: 4, borderRadius: 10, padding: 12, marginVertical: 8 },
  alertText_warning: { color: '#B45309' },
  alertKicker_warning: { color: '#D97706' },

  alert_tip: { backgroundColor: '#F0FDF4', borderLeftColor: '#16A34A', borderLeftWidth: 4, borderRadius: 10, padding: 12, marginVertical: 8 },
  alertText_tip: { color: '#15803D' },
  alertKicker_tip: { color: '#16A34A' },

  alert_caution: { backgroundColor: '#FEF2F2', borderLeftColor: '#DC2626', borderLeftWidth: 4, borderRadius: 10, padding: 12, marginVertical: 8 },
  alertText_caution: { color: '#B91C1C' },
  alertKicker_caution: { color: '#DC2626' },

  alert_important: { backgroundColor: '#FDF2F8', borderLeftColor: '#DB2777', borderLeftWidth: 4, borderRadius: 10, padding: 12, marginVertical: 8 },
  alertText_important: { color: '#BE185D' },
  alertKicker_important: { color: '#DB2777' },

  // Reference Badge & Math formula styles
  refBadgeText: { fontFamily: 'Inter-Bold', fontSize: 11, color: C.primary, backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 0.5, borderColor: '#CDE7E1', overflow: 'hidden' },
  mathText: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontStyle: 'italic', fontSize: 16.5, color: '#0F172A' },

  codeWrap: { borderRadius: 14, backgroundColor: C.codeBg, overflow: 'hidden', marginVertical: 8 },
  codeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.codeChrome },
  codeLang: { fontFamily: 'Inter-SemiBold', fontSize: 10.5, letterSpacing: 0.8, color: '#8FA8A3', textTransform: 'uppercase' },
  codeCopy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeCopyText: { fontFamily: 'Inter-SemiBold', fontSize: 10.5, color: '#8FA8A3' },
  codeScroll: { padding: 12 },
  codeText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 20, color: C.codeText },

  tableScroll: { marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#DDE6E2', borderRadius: 10, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  tr: { flexDirection: 'row' },
  trHead: { backgroundColor: '#EEF5F2' },
  trAlt: { backgroundColor: '#FAFCFB' },
  td: { paddingVertical: 6, paddingHorizontal: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#E1E9E6', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E1E9E6' },
  thText: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: C.onSurface, lineHeight: 17 },
  tdText: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: C.onSurface, lineHeight: 18 },

  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 4 },

  thinkWrap: { paddingVertical: 3, minHeight: 24, justifyContent: 'center' },
  shimmerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  shimmerSpace: { width: 4 },
  thinkText: {
    fontFamily: 'Inter-Medium', fontSize: 14, lineHeight: 20,
    color: C.primary, letterSpacing: 0.1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },

  // Quiz poll
  quizSkeleton: { paddingVertical: 14 },
  quizCard: {
    width: '100%', backgroundColor: C.surface, borderRadius: 18, borderWidth: 1,
    borderColor: C.outlineVariant, padding: 13, paddingLeft: 15, overflow: 'hidden', marginVertical: 4,
  },
  quizStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  quizTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quizKicker: { flex: 1, fontFamily: 'Poppins-Bold', fontSize: 10, letterSpacing: 0.9, color: C.primary },
  quizVerdict: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 8 },
  quizVerdictOk: { backgroundColor: C.primary },
  quizVerdictNo: { backgroundColor: C.danger },
  quizVerdictText: { fontFamily: 'Inter-Bold', fontSize: 9.5, color: '#FFFFFF', letterSpacing: 0.3 },

  // Question hierarchy â€” three distinct levels instead of one flat block.
  // Plain (no list): the whole question, compact.
  qPlain: { fontFamily: 'Poppins-SemiBold', fontSize: 14, lineHeight: 20, color: C.onSurface, marginTop: 9 },
  // Stem: the "consider the followingâ€¦" lead-in is context, so it's lighter.
  qStem: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, lineHeight: 18, color: C.onSurfaceVariant, marginTop: 9 },
  // The enumerated list: tight rows, marker in a fixed gutter so text aligns.
  qList: { marginTop: 7, marginBottom: 2, gap: 5, paddingLeft: 2 },
  qItemRow: { flexDirection: 'row', gap: 7 },
  qMarker: { fontFamily: 'Inter-Bold', fontSize: 12, lineHeight: 17, color: C.primary, minWidth: 20 },
  qItemText: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 12.5, lineHeight: 17, color: C.onSurface },
  // Closing question: the thing being asked, so it carries the weight.
  qClosing: { fontFamily: 'Poppins-SemiBold', fontSize: 13, lineHeight: 19, color: C.onSurface, marginTop: 8 },
  // The paper's figure. White mat + hairline frame so a scanned diagram reads as
  // a deliberate exhibit, not a stray image; width-driven with a real aspect
  // ratio so nothing is cropped or squashed.
  figWrap: { marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: C.outlineVariant, backgroundColor: '#FFFFFF', padding: 8 },
  figImage: { width: '100%', borderRadius: 8, backgroundColor: '#F6FAFF' },
  figCaption: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: C.onSurfaceFaint, textAlign: 'center', marginTop: 6 },
  figFailed: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: C.outlineVariant,
    borderStyle: 'dashed', backgroundColor: C.surfaceContainer,
  },
  figFailedText: { fontFamily: 'Inter-Medium', fontSize: 12.5, color: C.onSurfaceFaint },
  quizOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10,
    borderRadius: 12, borderWidth: 1, borderColor: C.outlineVariant, backgroundColor: C.surface,
  },
  quizOptPressed: { backgroundColor: C.surfaceContainer, borderColor: C.primaryBright },
  quizOptRight: { borderColor: C.primary, backgroundColor: '#D9F1EC' },
  quizOptWrong: { borderColor: C.dangerBorder, backgroundColor: C.dangerSoft },
  quizOptMuted: { opacity: 0.5 },
  quizBadge: { width: 21, height: 21, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceContainerHigh },
  quizBadgeRight: { backgroundColor: C.primary },
  quizBadgeWrong: { backgroundColor: C.danger },
  quizBadgeText: { fontFamily: 'Inter-Bold', fontSize: 10.5, color: C.onSurfaceVariant },
  quizOptText: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 13, lineHeight: 18, color: C.onSurface },
  // Explanation panel. Tinted to the verdict so a wrong answer reads as a
  // correction rather than more of the same teal.
  quizWhyCard: { borderRadius: 13, padding: 11, marginTop: 11, borderWidth: 1.5 },
  quizWhyOk: { backgroundColor: C.primarySoft, borderColor: '#CDE7E1' },
  quizWhyNo: { backgroundColor: '#FEF2F2', borderColor: '#F6CDCD' },
  quizWhyHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  quizWhyDot: { width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  quizWhyKicker: { fontFamily: 'Poppins-Bold', fontSize: 9.5, letterSpacing: 0.9 },
  quizWhy: { fontFamily: 'Inter-Medium', fontSize: 12.5, lineHeight: 19, color: '#0B3B36' },
  quizDone: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 13, paddingVertical: 12, borderRadius: 14,
    backgroundColor: C.primarySoft, borderWidth: 1.5, borderColor: '#CDE7E1',
  },
  quizDoneText: { fontFamily: 'Inter-Bold', fontSize: 13.5, color: C.primary },
  // PYQ set score card â€” a filling ring with the ratio inside, Duolingo-minimal.
  pyqScore: {
    alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 20, borderRadius: 18,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.outlineVariant,
  },
  pyqScoreNum: { fontFamily: 'Poppins-Bold', fontSize: 22, letterSpacing: -0.5 },
  pyqScoreDen: { fontFamily: 'Poppins-SemiBold', fontSize: 13, color: C.onSurfaceFaint },
  pyqScoreLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: C.onSurface },
  quizNext: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 11, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 10 },
  quizNextLoading: { backgroundColor: '#0B5C55' },
  quizNextText: { fontFamily: 'Poppins-SemiBold', fontSize: 13, color: '#FFFFFF' },

  // Inline Weak-Area Sprint card (lives inside the chat, milky + premium)
  sprintCard: { width: '100%', backgroundColor: '#F4F8F7', borderRadius: 20, borderWidth: 1, borderColor: '#DDE9E6', padding: 16 },
  sprintTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sprintKicker: { flex: 1, fontFamily: 'Poppins-SemiBold', fontSize: 11.5, letterSpacing: 0.8, color: C.primary },
  sprintCount: { fontFamily: 'Inter-Bold', fontSize: 12, color: C.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  sprintDim: { fontFamily: 'Inter-Medium', fontSize: 13.5, color: C.onSurfaceVariant, marginTop: 8 },
  sprintBody: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 24, color: C.onSurface, marginTop: 10 },
  sprintHeading: { fontFamily: 'Poppins-SemiBold', fontSize: 17, lineHeight: 24, color: C.onSurface, marginTop: 12, marginBottom: 6 },
  sprintPointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sprintDot: { fontFamily: 'Inter-Bold', fontSize: 15, lineHeight: 24, color: C.primary },
  sprintPoint: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 24, color: C.onSurface },
  sprintInsight: { fontFamily: 'Inter-Medium', fontSize: 14.5, lineHeight: 23, color: '#0B3B36', backgroundColor: C.primarySoft, borderRadius: 13, padding: 12, marginTop: 12 },
  sprintReveal: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#CFE3DF', backgroundColor: C.surface },
  sprintRevealText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: C.primary },
  sprintQ: { fontFamily: 'Poppins-SemiBold', fontSize: 16, lineHeight: 23, color: C.onSurface, marginTop: 12, marginBottom: 10 },
  sprintOpt: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: '#DDE9E6', backgroundColor: C.surface },
  sprintOptRight: { borderColor: C.primary, backgroundColor: '#D9F1EC' },
  sprintOptWrong: { borderColor: C.dangerBorder, backgroundColor: C.dangerSoft },
  sprintOptText: { fontFamily: 'Inter-Medium', fontSize: 14.5, color: C.onSurface },
  sprintWhy: { fontFamily: 'Inter-Medium', fontSize: 14, lineHeight: 22, color: C.onSurfaceVariant, marginTop: 12 },
  sprintBtn: { marginTop: 16, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  sprintBtnText: { fontFamily: 'Poppins-SemiBold', fontSize: 14.5, color: '#FFFFFF' },

  jumpWrap: { position: 'absolute', right: 20, zIndex: 90 },
  jumpBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 2, borderColor: C.outlineVariant, borderBottomWidth: 3.5,
  },

  dock: { position: 'absolute', left: 12, right: 12, zIndex: 100 },
  pendingRow: { flexDirection: 'row', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  pendingChip: { width: 54, height: 54, borderRadius: 12, overflow: 'visible' },
  pendingThumb: { width: 54, height: 54, borderRadius: 12, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.outline },
  pendingX: { position: 'absolute', top: -5, right: -5, width: 19, height: 19, borderRadius: 10, backgroundColor: C.onSurface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  // Every direct child of the bar is CONTROL tall, and the bar bottom-aligns
  // them, so a single-line composer is one clean row and growth only ever pushes
  // the top edge upward.
  // Duolingo depth: a thicker bottom border, never a shadow. The bar reads as a
  // physical slab sitting on the page, and it matches the buttons everywhere else.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: C.surface,
    borderRadius: 18,
    paddingLeft: 5,
    paddingRight: 5,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#D8E3DF',
  },
  iconBtn: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, alignItems: 'center', justifyContent: 'center' },
  iconBtnPressed: { backgroundColor: C.surfaceContainerHigh },
  inputWrap: { flex: 1, justifyContent: 'center', paddingVertical: INPUT_PAD_V, paddingHorizontal: 6 },
  placeholder: {
    // Pinned to the first line box so it sits exactly where the caret starts.
    position: 'absolute', left: 6, right: 0, top: INPUT_PAD_V, height: LINE_H,
    fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: LINE_H,
    color: C.onSurfaceFaint, letterSpacing: 0.1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  input: {
    color: C.onSurface, fontSize: 15.5, lineHeight: LINE_H, fontFamily: 'Inter-Medium',
    // Android gives multiline inputs invisible top/bottom padding of its own,
    // which is what knocks the text off-centre against the buttons.
    padding: 0, margin: 0, textAlignVertical: 'top',
    maxHeight: MAX_COMPOSER_HEIGHT,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sendBtn: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, overflow: 'hidden' },
  sendFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sendBtnPressed: { opacity: 0.88 },

  // History sheet: same shape/motion family as call mode's Sessions sheet
  // (mascot.tsx) â€” scrim + a bottom sheet that slides up, not a side drawer.
  bottomSheetOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'flex-end', zIndex: 9999 },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 20, paddingTop: 14,
    maxHeight: '78%',
    zIndex: 10000,
    shadowColor: '#1E3A8A', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 16,
  },
  bottomSheetScroll: { flexGrow: 0 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 18 },
  sessionSheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  sessionNewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, height: 36, borderRadius: 18,
    backgroundColor: '#0F172A',
  },
  sessionNewBtnText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 12, height: 40, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  searchInput: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 13.5, color: '#0F172A', height: '100%' },
  groupLabel: { fontFamily: 'Inter-Bold', fontSize: 9.5, letterSpacing: 1.2, color: '#64748B', marginTop: 14, marginBottom: 8, marginLeft: 6 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)', marginBottom: 8 },
  sessionRowActive: { backgroundColor: 'rgba(59, 130, 246, 0.06)', borderColor: 'rgba(59, 130, 246, 0.22)' },
  sessionBadge: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sessionTitle: { fontSize: 13.5, fontFamily: 'Poppins-Medium', color: '#0F172A' },
  sessionMeta: { marginTop: 1, fontSize: 10.5, fontFamily: 'Inter-Medium', color: '#64748B' },
  rowAction: { padding: 4 },
  emptySessionBox: { paddingVertical: 20, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#F1F5F9', alignItems: 'center' },
  emptySessionText: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#64748B' },
  sourcesAction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 30, borderRadius: 15, backgroundColor: C.primarySoft, marginRight: 4 },
  sourcesActionText: { color: C.primary, fontFamily: 'Inter-SemiBold', fontSize: 12 },
  sourcesScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.scrim },
  sourcesSheet: { maxHeight: '76%', backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24 },
  sourcesHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.outlineVariant, marginTop: 10, marginBottom: 14 },
  sourcesHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1, borderColor: C.outlineVariant },
  sourcesTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: C.onSurface },
  sourcesSub: { marginTop: 2, fontSize: 12.5, fontFamily: 'Inter-Medium', color: C.onSurfaceVariant },
  sourcesList: { paddingTop: 4, paddingBottom: 12 },
  sourceRow: { flexDirection: 'row', paddingVertical: 15, borderBottomWidth: 1, borderColor: '#EDF1F0' },
  sourceIndex: { width: 27, height: 27, borderRadius: 14, overflow: 'hidden', textAlign: 'center', paddingTop: 5, backgroundColor: C.primarySoft, color: C.primary, fontFamily: 'Inter-Bold', fontSize: 12, marginRight: 11 },
  sourceBody: { flex: 1 }, sourceIdentity: { textTransform: 'none', color: C.primary, fontFamily: 'Inter-SemiBold', fontSize: 12.5, lineHeight: 18 },
  sourceBook: { color: C.onSurface, fontFamily: 'Inter-Medium', fontSize: 13.5, lineHeight: 20, marginTop: 2 },
  sourceChapter: { color: C.onSurface, fontFamily: 'Inter-SemiBold', fontSize: 13.5, lineHeight: 20, marginTop: 1 },
  sourceExcerpt: { color: C.onSurfaceVariant, fontFamily: 'Inter-Regular', fontSize: 13, lineHeight: 19, marginTop: 7 },
  sourceSupport: { color: C.onSurfaceFaint, fontFamily: 'Inter-Medium', fontSize: 11.5, marginTop: 7 },
  sourceOpen: { color: C.primary, fontFamily: 'Inter-SemiBold', fontSize: 12.5, marginTop: 9 },
  sourcePreviewCard: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#D8E7E3',
    backgroundColor: '#FCFDFD',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sourcePreviewHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  sourcePreviewIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#EAF8F5', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  sourcePreviewHeadText: { flex: 1, minWidth: 0 },
  sourcePreviewTitle: { fontFamily: 'Inter-Bold', fontSize: 12.2, lineHeight: 15.5, color: '#0E5F59' },
  sourcePreviewLine: { fontFamily: 'Inter-Medium', fontSize: 12.2, lineHeight: 17, color: C.onSurfaceVariant, marginTop: 2 },
  renameOverlay: { flex: 1, backgroundColor: C.scrim, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  renameCard: { width: '100%', backgroundColor: C.surface, borderRadius: 24, padding: 20 },
  renameTitle: { fontFamily: 'Poppins-Bold', fontSize: 17, color: C.onSurface, marginBottom: 14 },
  renameInput: { fontFamily: 'Inter-Medium', fontSize: 15, color: C.onSurface, backgroundColor: C.surfaceContainer, borderRadius: 12, paddingHorizontal: 13, height: 46 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
});

