export type SemanticTone = 'definition' | 'insight' | 'important' | 'example';

export type LearningBlock =
  | { k: 'p'; text: string }
  | { k: 'h'; level: number; text: string }
  | { k: 'li'; text: string; depth: number; marker: string | null }
  | { k: 'code'; lang: string; code: string }
  | { k: 'quote'; text: string; type?: 'note' | 'warning' | 'tip' | 'caution' | 'important' | 'default' }
  | { k: 'hr' }
  | { k: 'table'; header: string[]; rows: string[][] }
  | { k: 'math'; text: string; label?: string }
  | { k: 'gap' };

// This is deliberately presentation-neutral. A future additive structured
// payload can populate these exact nodes without creating a second UI path.
export type LearningNode =
  | { k: 'title'; text: string }
  | { k: 'lead'; text: string }
  | { k: 'section'; level: number; text: string }
  | { k: 'prose'; text: string }
  | { k: 'list'; items: Extract<LearningBlock, { k: 'li' }>[] }
  | { k: 'symbols'; items: { symbol: string; meaning: string }[] }
  | { k: 'formula'; text: string; label?: string; prominent: boolean }
  | { k: 'derivation'; equations: { text: string; label?: string }[] }
  | { k: 'semantic'; label: string; text: string; tone: SemanticTone }
  | { k: 'timeline'; items: Extract<LearningBlock, { k: 'li' }>[] }
  | { k: 'process'; items: Extract<LearningBlock, { k: 'li' }>[] }
  | { k: 'factGrid'; items: { label: string; value: string }[] }
  | { k: 'comparison'; leftLabel: string; rightLabel: string; rows: { label: string; left: string; right: string }[] }
  | { k: 'block'; block: Exclude<LearningBlock, { k: 'p' | 'h' | 'li' | 'math' | 'gap' }> };

export type StructuredLearningPresentation = {
  schemaVersion: 1;
  nodes: LearningNode[];
};
