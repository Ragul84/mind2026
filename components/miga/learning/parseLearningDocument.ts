import { LearningBlock, LearningNode, SemanticTone, StructuredLearningPresentation } from './types';

const FENCE_RE = /^\s*```(\w*)\s*$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

const semanticLabels: Record<string, SemanticTone> = {
  definition: 'definition',
  'key idea': 'definition',
  'key point': 'important',
  important: 'important',
  'exam tip': 'important',
  'exam point': 'important',
  remember: 'important',
  recall: 'important',
  intuition: 'insight',
  insight: 'insight',
  'common misconception': 'insight',
  'common trap': 'insight',
  example: 'example',
};

function semanticLine(text: string) {
  const match = text.match(/^\s*\*\*([^*:\n]{2,40})\*\*\s*:\s*(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const tone = semanticLabels[label.toLowerCase()];
  return tone ? { label, text: match[2].trim(), tone } : null;
}

function symbolDefinition(text: string) {
  const match = text.match(/^\s*(?:\*\*)?([^=*:\n]{1,12})(?:\*\*)?\s*(?:=|:|–|-)\s*(.+)$/);
  if (!match) return null;
  const symbol = match[1].replace(/[*`]/g, '').trim();
  if (!symbol || /\s{2,}|[.!?]$/.test(symbol)) return null;
  // A legend item is a compact symbolic token (F, p1, Δp), never a normal
  // comparison attribute such as "Nature" or "Enforceability".
  if (!/^[A-Za-z\u0370-\u03FF\u0394\u03B4][A-Za-z0-9_\u0370-\u03FF\u2080-\u2089]{0,2}$/.test(symbol)) return null;
  return { symbol, meaning: match[2].trim() };
}

function explicitEquation(text: string) {
  const value = text.trim();
  if (value.length < 3 || value.length > 120 || /[.!?]$/.test(value)) return false;
  if (/^(?:[-*+]|\d+[.)]|>|#)/.test(value) || /[*`]/.test(value)) return false;
  // Covers symbols such as p1 / p2 without broadening the classifier to
  // ordinary prose that happens to contain an equals sign.
  if (/[A-Za-z\u0370-\u03FF\u2080-\u2089][A-Za-z0-9\u0370-\u03FF\u2080-\u2089]*\s*=\s*[A-Za-z0-9\u0370-\u03FF\u2080-\u2089]/.test(value)) return true;
  if (!/[=∝≤≥≈]/.test(value)) return false;
  return /\\(?:frac|sqrt|sum|int|partial)|[A-Za-z\u0370-\u03FF\u2080-\u2089]\s*[=∝≤≥≈]\s*[A-Za-z0-9\u0370-\u03FF\u2080-\u2089]/.test(value);
}

function dateLed(item: string) {
  return /^(?:c\.\s*)?(?:\d{1,2}\s+)?(?:\d{3,4}\s*(?:BCE|BC|CE|AD)?|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})\b/.test(item.trim());
}

function shortFact(text: string) {
  const match = text.match(/^\s*(?:\*\*)?([^:*\n]{2,42})(?:\*\*)?\s*:\s*(.{1,110})$/);
  return match ? { label: match[1].trim(), value: match[2].trim() } : null;
}

function standaloneBoldFormula(text: string) {
  const match = text.trim().match(/^\*\*([^*\n]{3,120})\*\*$/);
  return match && explicitEquation(match[1]) ? match[1].trim() : null;
}

function terminalEquation(text: string) {
  const value = text.trim();
  if (value.length < 8 || /[`]/.test(value)) return null;
  const stripped = value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
  const match = stripped.match(/^(.*?)([A-Za-z\u0370-\u03FF\u0394\u03B4][A-Za-z0-9_\u0370-\u03FF\u2080-\u2089]{0,3}\s*(?:=|âˆ|â‰¤|â‰¥|â‰ˆ)\s*[A-Za-z0-9\u0370-\u03FF\u0394\u03B4\u2080-\u2089\s+\-*/^()]+)[.!?]?$/);
  if (!match) return null;
  const prefix = match[1].replace(/[,;:\s]+$/g, '').trim();
  const equation = match[2].trim();
  if (!prefix || prefix.length < 8 || !explicitEquation(equation)) return null;
  if (/\b(?:where|when|if|such that)\b/i.test(prefix.slice(-80)) && !/\b(?:we get|becomes|simplifies to|therefore|hence|so)\b/i.test(prefix)) return null;
  return { prefix, equation };
}

function comparisonFromExplicitSections(nodes: LearningNode[]) {
  const title = nodes.find((node) => node.k === 'title');
  // This conversion is intentionally strict: it needs an explicit comparison
  // title plus two adjacent labelled fact groups with the same attributes.
  // Similar prose never gets silently recast as a comparison.
  if (!title || !/\b(?:vs\.?|versus|compare|comparison|difference between)\b/i.test(title.text)) return nodes;
  const output: LearningNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const leftSection = nodes[index];
    const leftFacts = nodes[index + 1];
    const rightSection = nodes[index + 2];
    const rightFacts = nodes[index + 3];
    if (
      leftSection?.k === 'section' && leftFacts?.k === 'factGrid'
      && rightSection?.k === 'section' && rightFacts?.k === 'factGrid'
      && leftFacts.items.length >= 2 && leftFacts.items.length === rightFacts.items.length
      && leftFacts.items.every((item, itemIndex) => item.label.trim().toLowerCase() === rightFacts.items[itemIndex].label.trim().toLowerCase())
    ) {
      output.push({
        k: 'comparison',
        leftLabel: leftSection.text,
        rightLabel: rightSection.text,
        rows: leftFacts.items.map((item, itemIndex) => ({ label: item.label, left: item.value, right: rightFacts.items[itemIndex].value })),
      });
      index += 4;
      continue;
    }
    output.push(nodes[index]);
    index += 1;
  }
  return output;
}

export function parseMarkdownBlocks(source: string): LearningBlock[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const result: LearningBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '$$' || trimmed === '\\[' || trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) { result.push({ k: 'math', text: trimmed.slice(2, -2).trim() }); continue; }
      if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length > 4) { result.push({ k: 'math', text: trimmed.slice(2, -2).trim() }); continue; }
      const body: string[] = [];
      const initial = trimmed.startsWith('$$') ? trimmed.slice(2) : trimmed.slice(2);
      if (initial.trim()) body.push(initial);
      index += 1;
      while (index < lines.length && !lines[index].includes('$$') && !lines[index].includes('\\]')) { body.push(lines[index]); index += 1; }
      if (index < lines.length) {
        const end = lines[index].trim();
        const last = end.endsWith('$$') ? end.slice(0, -2) : end.endsWith('\\]') ? end.slice(0, -2) : '';
        if (last.trim()) body.push(last);
      }
      result.push({ k: 'math', text: body.join('\n').trim() });
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_RE.test(lines[index])) { body.push(lines[index]); index += 1; }
      result.push({ k: 'code', lang: fence[1] || '', code: body.join('\n') });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && lines[index + 1].includes('|') && TABLE_SEP_RE.test(lines[index + 1])) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(splitRow(lines[index])); index += 1; }
      index -= 1;
      result.push({ k: 'table', header, rows });
      continue;
    }

    if (!trimmed) { result.push({ k: 'gap' }); continue; }
    const display = trimmed.match(/^\$([^$\n]+)\$$/);
    if (display) { result.push({ k: 'math', text: display[1] }); continue; }
    const boldFormula = standaloneBoldFormula(trimmed);
    if (boldFormula) { result.push({ k: 'math', text: boldFormula }); continue; }
    const named = trimmed.match(/^(?:\*\*)?(formula|equation)(?:\*\*)?\s*:\s*(.+)$/i);
    if (named) { result.push({ k: 'math', text: named[2], label: named[1] }); continue; }
    if (explicitEquation(line)) { result.push({ k: 'math', text: trimmed }); continue; }
    if (HR_RE.test(line)) { result.push({ k: 'hr' }); continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) { result.push({ k: 'h', level: heading[1].length, text: heading[2] }); continue; }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const alert = quote[1].match(/^\[!(NOTE|WARNING|TIP|CAUTION|IMPORTANT)\]\s*(.*)$/i);
      result.push({ k: 'quote', text: alert ? alert[2] : quote[1], type: alert ? alert[1].toLowerCase() as any : 'default' });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (bullet) { result.push({ k: 'li', text: bullet[2], depth: Math.floor(bullet[1].length / 2), marker: null }); continue; }
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) { result.push({ k: 'li', text: numbered[3], depth: Math.floor(numbered[1].length / 2), marker: `${numbered[2]}.` }); continue; }

    result.push({ k: 'p', text: line });
  }
  return result;
}

export function composeLearningDocument(blocks: LearningBlock[]): LearningNode[] {
  const nodes: LearningNode[] = [];
  let index = 0;
  let hasLead = false;
  let hasTitle = false;
  let usedPrimaryFormula = false;

  while (index < blocks.length) {
    const block = blocks[index];
    if (block.k === 'gap') { index += 1; continue; }
    if (block.k === 'h') {
      if (!hasTitle && block.level <= 2) { nodes.push({ k: 'title', text: block.text }); hasTitle = true; }
      else nodes.push({ k: 'section', level: block.level, text: block.text });
      index += 1;
      continue;
    }
    if (block.k === 'math') {
      const equations = [{ text: block.text, label: block.label }];
      let cursor = index + 1;
      while (cursor < blocks.length) {
        if (blocks[cursor].k === 'gap') { cursor += 1; continue; }
        if (blocks[cursor].k !== 'math') break;
        const next = blocks[cursor] as Extract<LearningBlock, { k: 'math' }>;
        equations.push({ text: next.text, label: next.label });
        cursor += 1;
      }
      if (equations.length > 1) nodes.push({ k: 'derivation', equations });
      else {
        const prominent: boolean = !!equations[0].label || (!usedPrimaryFormula && hasLead);
        nodes.push({ k: 'formula', ...equations[0], prominent });
        usedPrimaryFormula ||= prominent;
      }
      index = cursor;
      continue;
    }
    if (block.k === 'li') {
      const items: Extract<LearningBlock, { k: 'li' }>[] = [];
      let cursor = index;
      while (cursor < blocks.length && blocks[cursor].k === 'li') { items.push(blocks[cursor] as Extract<LearningBlock, { k: 'li' }>); cursor += 1; }
      const definitions = items.map((item) => symbolDefinition(item.text));
      const facts = items.map((item) => shortFact(item.text));
      const previous = nodes[nodes.length - 1];
      const previousSection = previous?.k === 'section' || previous?.k === 'title' ? previous.text : '';
      if (items.length >= 2 && definitions.every(Boolean)) nodes.push({ k: 'symbols', items: definitions as { symbol: string; meaning: string }[] });
      else if (items.length >= 2 && items.every((item) => item.marker) && items.every((item) => dateLed(item.text))) nodes.push({ k: 'timeline', items });
      else if (items.length >= 2 && items.every((item) => item.marker) && /(?:steps?|process|sequence|stages?)/i.test(previousSection)) nodes.push({ k: 'process', items });
      else if (items.length >= 2 && facts.every(Boolean)) nodes.push({ k: 'factGrid', items: facts as { label: string; value: string }[] });
      else {
        let pendingItems: Extract<LearningBlock, { k: 'li' }>[] = [];
        const flushItems = () => {
          if (pendingItems.length) nodes.push({ k: 'list', items: pendingItems });
          pendingItems = [];
        };
        items.forEach((item) => {
          const extracted = terminalEquation(item.text);
          if (!extracted) {
            pendingItems.push(item);
            return;
          }
          flushItems();
          nodes.push({ k: 'list', items: [{ ...item, text: extracted.prefix }] });
          nodes.push({ k: 'formula', text: extracted.equation, prominent: false });
        });
        flushItems();
      }
      index = cursor;
      continue;
    }
    if (block.k === 'p') {
      const semantic = semanticLine(block.text);
      if (semantic) { nodes.push({ k: 'semantic', ...semantic }); index += 1; continue; }
      const parts = [block.text];
      let cursor = index + 1;
      while (cursor < blocks.length && blocks[cursor].k === 'p' && !semanticLine((blocks[cursor] as Extract<LearningBlock, { k: 'p' }>).text)) { parts.push((blocks[cursor] as Extract<LearningBlock, { k: 'p' }>).text); cursor += 1; }
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      const extracted = terminalEquation(text);
      if (extracted) {
        if (!hasLead && extracted.prefix.length <= 280) { nodes.push({ k: 'lead', text: extracted.prefix }); hasLead = true; }
        else nodes.push({ k: 'prose', text: extracted.prefix });
        nodes.push({ k: 'formula', text: extracted.equation, prominent: !usedPrimaryFormula && hasLead });
        usedPrimaryFormula ||= hasLead;
      } else if (!hasLead && text.length <= 280) { nodes.push({ k: 'lead', text }); hasLead = true; }
      else nodes.push({ k: 'prose', text });
      index = cursor;
      continue;
    }
    nodes.push({ k: 'block', block: block as Exclude<LearningBlock, { k: 'p' | 'h' | 'li' | 'math' | 'gap' }> });
    index += 1;
  }
  return comparisonFromExplicitSections(nodes);
}

export function learningDocumentFromMarkdown(markdown: string, presentation?: StructuredLearningPresentation | null): LearningNode[] {
  return presentation?.nodes?.length ? presentation.nodes : composeLearningDocument(parseMarkdownBlocks(markdown));
}
