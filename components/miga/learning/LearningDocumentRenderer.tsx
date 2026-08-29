import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ArrowRight, Bookmark, Lightbulb } from 'lucide-react-native';
import { learningDocumentFromMarkdown } from './parseLearningDocument';
import type { LearningBlock, LearningNode, SemanticTone, StructuredLearningPresentation } from './types';

type InlineRenderer = (text: string, key: string, style?: any) => React.ReactNode;

type Props = {
  text: string;
  /** Reserved for a future additive presentation payload. Current messages use Markdown. */
  presentation?: StructuredLearningPresentation | null;
  renderInline: InlineRenderer;
  formatMath: (text: string) => string;
  renderSpecial: (block: LearningBlock, key: string) => React.ReactNode;
};

type MathPiece = { kind: 'text'; value: string } | { kind: 'fraction'; numerator: string; denominator: string };

function readBraced(value: string, start: number) {
  if (value[start] !== '{') return null;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') {
      depth -= 1;
      if (depth === 0) return { value: value.slice(start + 1, index), next: index + 1 };
    }
  }
  return null;
}

function mathPieces(value: string): MathPiece[] {
  const pieces: MathPiece[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const fractionAt = value.indexOf('\\frac', cursor);
    if (fractionAt < 0) break;
    const numerator = readBraced(value, fractionAt + 5);
    const denominator = numerator ? readBraced(value, numerator.next) : null;
    if (!numerator || !denominator) { cursor = fractionAt + 5; continue; }
    if (fractionAt > cursor) pieces.push({ kind: 'text', value: value.slice(cursor, fractionAt) });
    pieces.push({ kind: 'fraction', numerator: numerator.value, denominator: denominator.value });
    cursor = denominator.next;
  }
  if (cursor < value.length) pieces.push({ kind: 'text', value: value.slice(cursor) });
  const latexAware: MathPiece[] = pieces.length ? pieces : [{ kind: 'text', value }];
  // Models often send a compact textbook fraction as dp/dt rather than LaTex.
  // In a block already proven to be mathematics this is safe to typeset; prose
  // never enters this path. Complex expressions remain text instead of being
  // guessed at.
  const result: MathPiece[] = [];
  for (const piece of latexAware) {
    if (piece.kind === 'fraction') { result.push(piece); continue; }
    const fraction = /([A-Za-z0-9\u0370-\u03FF\u2080-\u2089^]+)\/([A-Za-z0-9\u0370-\u03FF\u2080-\u2089^]+)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = fraction.exec(piece.value))) {
      if (match.index > last) result.push({ kind: 'text', value: piece.value.slice(last, match.index) });
      result.push({ kind: 'fraction', numerator: match[1], denominator: match[2] });
      last = match.index + match[0].length;
    }
    if (last < piece.value.length) result.push({ kind: 'text', value: piece.value.slice(last) });
  }
  return result.length ? result : [{ kind: 'text', value }];
}

function MathText({ value, formatMath, compact = false }: { value: string; formatMath: (text: string) => string; compact?: boolean }) {
  const clean = value.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  const pieces = useMemo(() => mathPieces(clean), [clean]);
  return <View style={[styles.mathLine, compact && styles.mathLineCompact]}>{pieces.map((piece, index) => piece.kind === 'fraction' ? (
    <View key={index} style={[styles.fraction, compact && styles.fractionCompact]}>
      <Text style={[styles.fractionText, compact && styles.fractionTextCompact]}>{formatMath(piece.numerator)}</Text>
      <View style={styles.fractionBar} />
      <Text style={[styles.fractionText, compact && styles.fractionTextCompact]}>{formatMath(piece.denominator)}</Text>
    </View>
  ) : <Text key={index} allowFontScaling style={[styles.math, compact && styles.mathCompact]}>{formatMath(piece.value)}</Text>)}</View>;
}

function SemanticNote({ label, text, tone, renderInline }: { label: string; text: string; tone: SemanticTone; renderInline: InlineRenderer }) {
  const config = {
    definition: { icon: Bookmark, color: '#0F766E', surface: '#F0FAF8', label: 'DEFINITION' },
    insight: { icon: Lightbulb, color: '#6D3AC8', surface: '#F7F3FF', label: 'INSIGHT' },
    important: { icon: AlertTriangle, color: '#9A5B00', surface: '#FFF8EA', label: 'REMEMBER' },
    example: { icon: ArrowRight, color: '#2563A9', surface: '#F2F7FF', label: 'EXAMPLE' },
  }[tone];
  const Icon = config.icon;
  return (
    <View style={[styles.semantic, { backgroundColor: config.surface }]}>
      <View style={[styles.semanticIcon, { backgroundColor: `${config.color}16` }]}><Icon size={16} color={config.color} strokeWidth={2.2} /></View>
      <View style={styles.semanticContent}>
        <Text style={[styles.semanticLabel, { color: config.color }]}>{label || config.label}</Text>
        <Text selectable style={styles.semanticText}>{renderInline(text, `semantic-${label}`, styles.semanticText)}</Text>
      </View>
    </View>
  );
}

function isComparisonTable(header: string[], rows: string[][]) {
  if (header.length !== 3 || rows.length < 2) return false;
  const first = String(header[0] || '').trim().toLowerCase();
  return /^(basis|feature|aspect|point|factor|difference|parameter|criterion|criteria)$/i.test(first);
}

function ComparisonTable({ header, rows, renderInline }: { header: string[]; rows: string[][]; renderInline: InlineRenderer }) {
  return (
    <View style={styles.compareTable}>
      <View style={styles.compareTableHead}>
        <Text style={styles.compareTitle}>{header[1]}</Text>
        <Text style={styles.compareTitle}>{header[2]}</Text>
      </View>
      {rows.map((row, rowIndex) => (
        <View key={`${row[0]}-${rowIndex}`} style={styles.compareTableRow}>
          <Text style={styles.compareAxis}>{row[0]}</Text>
          <View style={styles.comparePair}>
            <Text selectable style={styles.compareValue}>{renderInline(row[1] || '', `cmp-a-${rowIndex}`, styles.compareValue)}</Text>
            <View style={styles.compareDivider} />
            <Text selectable style={styles.compareValue}>{renderInline(row[2] || '', `cmp-b-${rowIndex}`, styles.compareValue)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function MobileTable({ header, rows, renderInline }: { header: string[]; rows: string[][]; renderInline: InlineRenderer }) {
  if (isComparisonTable(header, rows)) return <ComparisonTable header={header} rows={rows} renderInline={renderInline} />;
  const columns = Math.max(1, header.length, ...rows.map((row) => row.length));
  return (
    <View style={styles.tableShell}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableScroll}>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            {Array.from({ length: columns }).map((_, index) => <Text key={index} style={styles.tableHeaderText}>{renderInline(header[index] || '', `th-${index}`, styles.tableHeaderText)}</Text>)}
          </View>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, rowIndex % 2 === 1 && styles.tableRowAlt]}>
              {Array.from({ length: columns }).map((_, index) => <Text key={index} style={styles.tableCell}>{renderInline(row[index] || '', `td-${rowIndex}-${index}`, styles.tableCell)}</Text>)}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function LearningList({ node, renderInline }: { node: Extract<LearningNode, { k: 'list' | 'timeline' | 'process' }>; renderInline: InlineRenderer }) {
  const timeline = node.k === 'timeline';
  const process = node.k === 'process';
  return (
    <View style={[styles.list, timeline && styles.timeline, process && styles.process]}>
      {node.items.map((item, index) => (
        <View key={`${index}-${item.text}`} style={[styles.listRow, { paddingLeft: item.depth * 12 }]}>
          {timeline ? <View style={styles.timelineMarker}><View style={styles.timelineDot} /></View> : process ? <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View> : item.marker ? <Text style={styles.listNumber}>{item.marker}</Text> : <View style={styles.bullet} />}
          <Text selectable style={styles.listText}>{renderInline(item.text, `list-${index}`, styles.listText)}</Text>
        </View>
      ))}
    </View>
  );
}

function SymbolLegend({ items, renderInline }: { items: { symbol: string; meaning: string }[]; renderInline: InlineRenderer }) {
  return (
    <View style={styles.symbolLegend}>
      {items.map((item, index) => <View style={styles.symbolRow} key={`${item.symbol}-${index}`}>
        <Text style={styles.symbol}>{item.symbol}</Text>
        <Text selectable style={styles.symbolMeaning}>{renderInline(item.meaning, `symbol-${index}`, styles.symbolMeaning)}</Text>
      </View>)}
    </View>
  );
}

function FactGrid({ items, renderInline }: { items: { label: string; value: string }[]; renderInline: InlineRenderer }) {
  return <View style={styles.factGrid}>{items.map((item, index) => <View style={styles.fact} key={`${item.label}-${index}`}><Text style={styles.factLabel}>{item.label}</Text><Text selectable style={styles.factValue}>{renderInline(item.value, `fact-${index}`, styles.factValue)}</Text></View>)}</View>;
}

function Comparison({ leftLabel, rightLabel, rows, renderInline }: Extract<LearningNode, { k: 'comparison' }> & { renderInline: InlineRenderer }) {
  return <View style={styles.comparison}>
    <View style={styles.comparisonHeader}><Text style={styles.comparisonHead}>{leftLabel}</Text><Text style={styles.comparisonHead}>{rightLabel}</Text></View>
    {rows.map((row, index) => <View style={styles.comparisonRow} key={`${row.label}-${index}`}><Text style={styles.comparisonLabel}>{row.label}</Text><View style={styles.comparisonValues}><Text selectable style={styles.comparisonCell}>{renderInline(row.left, `cmp-l-${index}`, styles.comparisonCell)}</Text><Text selectable style={styles.comparisonCell}>{renderInline(row.right, `cmp-r-${index}`, styles.comparisonCell)}</Text></View></View>)}
  </View>;
}

export const LearningDocumentRenderer = React.memo(function LearningDocumentRenderer({ text, presentation, renderInline, formatMath, renderSpecial }: Props) {
  const nodes = useMemo(() => learningDocumentFromMarkdown(text, presentation), [text, presentation]);
  return <View style={styles.document}>{nodes.map((node, index) => {
    const key = `${node.k}-${index}`;
    switch (node.k) {
      case 'title': return <Text key={key} style={styles.title}>{renderInline(node.text, key, styles.title)}</Text>;
      case 'lead': return <Text key={key} selectable style={styles.lead}>{renderInline(node.text, key, styles.lead)}</Text>;
      case 'section': return <Text key={key} style={[styles.section, node.level >= 3 && styles.subsection]}>{renderInline(node.text, key, styles.section)}</Text>;
      case 'prose': return <Text key={key} selectable style={styles.prose}>{renderInline(node.text, key, styles.prose)}</Text>;
      case 'list': case 'timeline': case 'process': return <LearningList key={key} node={node} renderInline={renderInline} />;
      case 'symbols': return <SymbolLegend key={key} items={node.items} renderInline={renderInline} />;
      case 'formula': return (
        <View key={key} style={[styles.formula, node.prominent ? styles.formulaProminent : styles.formulaSupporting]}>
          <View style={styles.formulaHead}>
            <Text style={[styles.formulaChip, node.prominent ? styles.formulaChipProminent : styles.formulaChipSupporting]}>
              {(node.label || 'Formula').toUpperCase()}
            </Text>
          </View>
          {node.prominent && <Text style={[styles.formulaQuote, styles.formulaQuoteLeft]}>"</Text>}
          {node.prominent && <Text style={[styles.formulaQuote, styles.formulaQuoteRight]}>"</Text>}
          <View style={styles.formulaMathWrap}>
            <MathText value={node.text} formatMath={formatMath} compact={!node.prominent} />
          </View>
        </View>
      );
      case 'derivation': return <View key={key} style={styles.derivation}>{node.equations.map((equation, equationIndex) => <View style={styles.derivationLine} key={`${equation.text}-${equationIndex}`}><MathText value={equation.text} formatMath={formatMath} compact /></View>)}</View>;
      case 'semantic': return <SemanticNote key={key} {...node} renderInline={renderInline} />;
      case 'factGrid': return <FactGrid key={key} items={node.items} renderInline={renderInline} />;
      case 'comparison': return <Comparison key={key} {...node} renderInline={renderInline} />;
      case 'block': {
        const block = node.block;
        if (block.k === 'table') return <MobileTable key={key} header={block.header} rows={block.rows} renderInline={renderInline} />;
        return <React.Fragment key={key}>{renderSpecial(block, key)}</React.Fragment>;
      }
      default: return null;
    }
  })}</View>;
});

const styles = StyleSheet.create({
  document: { gap: 0 },
  title: { color: '#0B1F3D', fontSize: 21.2, lineHeight: 26, fontFamily: 'Poppins-Bold', letterSpacing: -0.35, marginBottom: 6 },
  lead: { color: '#273650', fontSize: 15.4, lineHeight: 23, fontFamily: 'Inter-Medium', marginBottom: 10 },
  section: { color: '#0B2540', fontSize: 16.9, lineHeight: 23, fontFamily: 'Poppins-Bold', letterSpacing: -0.12, marginTop: 16, marginBottom: 6 },
  subsection: { color: '#334155', fontSize: 15.4, lineHeight: 21.5, marginTop: 13, fontFamily: 'Poppins-SemiBold' },
  prose: { color: '#26344B', fontSize: 15.15, lineHeight: 22.5, fontFamily: 'Inter-Regular', marginBottom: 7 },
  list: { gap: 4, marginBottom: 9 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#0F8F85', marginTop: 9, marginLeft: 4 },
  listNumber: { minWidth: 20, color: '#0F766E', fontSize: 14.5, lineHeight: 22.5, fontFamily: 'Inter-SemiBold', textAlign: 'right' },
  listText: { flex: 1, minWidth: 0, color: '#26344B', fontSize: 15.05, lineHeight: 22, fontFamily: 'Inter-Regular' },
  timeline: { borderLeftWidth: 1, borderLeftColor: '#BEE7E0', marginLeft: 7, paddingLeft: 0 },
  timelineMarker: { width: 15, alignItems: 'center', marginLeft: -8, paddingTop: 8 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#11998E', borderWidth: 2, borderColor: '#EAF9F6' },
  process: { marginTop: 1 },
  stepNumber: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#E7F7F4', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumberText: { color: '#0F766E', fontSize: 11.5, fontFamily: 'Inter-SemiBold' },
  formula: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    marginVertical: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // One central formula earns a compact object of its own. It is intentionally
  // content-sized rather than a full-width answer card.
  formulaProminent: {
    minWidth: 150,
    minHeight: 78,
    paddingHorizontal: 18,
    paddingTop: 11,
    paddingBottom: 13,
    backgroundColor: '#F4FBFA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BFEAE4',
    shadowColor: '#0F766E',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  formulaSupporting: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 9,
    backgroundColor: '#F8FCFB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCEBE8',
  },
  formulaHead: { width: '100%', alignItems: 'center', marginBottom: 6 },
  formulaChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontFamily: 'Inter-SemiBold',
    fontSize: 10.5,
    letterSpacing: 0.7,
    overflow: 'hidden',
  },
  formulaChipProminent: { color: '#0E5F59', backgroundColor: '#E6F6F3' },
  formulaChipSupporting: { color: '#4E7D78', backgroundColor: '#EDF7F5' },
  formulaQuote: { position: 'absolute', color: '#B9E6E0', fontFamily: 'Poppins-Bold', fontSize: 28, lineHeight: 28 },
  formulaQuoteLeft: { left: 11, top: 7 },
  formulaQuoteRight: { right: 11, bottom: 2 },
  formulaLabel: { alignSelf: 'stretch', textAlign: 'center', color: '#4E7D78', fontSize: 10.5, letterSpacing: 0.9, fontFamily: 'Inter-SemiBold', marginBottom: 5 },
  formulaMathWrap: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 28 },
  mathLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  mathLineCompact: { justifyContent: 'flex-start' },
  math: { color: '#087B74', fontSize: 24, lineHeight: 32, fontFamily: 'serif', textAlign: 'center', flexShrink: 1, maxWidth: '100%' },
  mathCompact: { fontSize: 20, lineHeight: 28, color: '#175B56' },
  fraction: { alignItems: 'center', justifyContent: 'center', marginHorizontal: 3, minWidth: 31 },
  fractionCompact: { minWidth: 24, marginHorizontal: 2 },
  fractionText: { color: '#087B74', fontSize: 20, lineHeight: 23, fontFamily: 'serif', textAlign: 'center' },
  fractionTextCompact: { fontSize: 15, lineHeight: 18, color: '#175B56' },
  fractionBar: { height: 1.25, minWidth: 29, alignSelf: 'stretch', backgroundColor: '#087B74', marginVertical: 1 },
  derivation: { borderLeftWidth: 2, borderLeftColor: '#BDE8E3', paddingLeft: 14, marginVertical: 8, gap: 1 },
  derivationLine: { minHeight: 27, justifyContent: 'center', alignItems: 'flex-start' },
  symbolLegend: { backgroundColor: '#F8FBFB', borderWidth: 1, borderColor: '#DDEBE8', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, marginVertical: 9, gap: 3 },
  symbolRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 3 },
  symbol: { width: 25, color: '#0F766E', fontFamily: 'serif', fontSize: 20, lineHeight: 25, textAlign: 'center' },
  symbolMeaning: { flex: 1, minWidth: 0, color: '#27364E', fontSize: 15, lineHeight: 22.5, fontFamily: 'Inter-Regular' },
  semantic: { flexDirection: 'row', gap: 10, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, marginVertical: 10 },
  semanticIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  semanticContent: { flex: 1, minWidth: 0 },
  semanticLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: 'Inter-SemiBold', marginBottom: 2 },
  semanticText: { color: '#293750', fontSize: 15, lineHeight: 22.5, fontFamily: 'Inter-Regular' },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 9 },
  fact: { flexGrow: 1, flexBasis: '44%', minWidth: 130, backgroundColor: '#F6FAF9', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  factLabel: { color: '#52716D', fontSize: 11.5, lineHeight: 16, fontFamily: 'Inter-SemiBold', marginBottom: 2 },
  factValue: { color: '#1E334C', fontSize: 14.5, lineHeight: 20, fontFamily: 'Inter-Regular' },
  tableShell: { marginVertical: 11, borderWidth: 1, borderColor: '#D5E5E2', borderRadius: 15, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  tableScroll: { minWidth: '100%' },
  table: { minWidth: '100%' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#EAF8F5' },
  tableHeaderText: { flex: 1, minWidth: 108, color: '#0E5F59', fontSize: 12.25, lineHeight: 17, fontFamily: 'Inter-Bold', paddingHorizontal: 10, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E4EFED' },
  tableRowAlt: { backgroundColor: '#FAFDFC' },
  tableCell: { flex: 1, minWidth: 108, color: '#26364D', fontSize: 13.25, lineHeight: 19, fontFamily: 'Inter-Regular', paddingHorizontal: 10, paddingVertical: 8 },
  compareTable: { marginVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: '#D7E8E5', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  compareTableHead: { flexDirection: 'row', backgroundColor: '#EAF8F5', borderBottomWidth: 1, borderBottomColor: '#D7E8E5' },
  compareTitle: { flex: 1, paddingHorizontal: 11, paddingVertical: 9, color: '#0E5F59', fontFamily: 'Poppins-Bold', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  compareTableRow: { paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E9F1EF' },
  compareAxis: { paddingHorizontal: 12, marginBottom: 6, color: '#6A756F', fontFamily: 'Inter-Bold', fontSize: 11.5, lineHeight: 15, textTransform: 'uppercase', letterSpacing: 0.5 },
  comparePair: { flexDirection: 'row', paddingHorizontal: 7 },
  compareValue: { flex: 1, minWidth: 0, color: '#24344C', fontFamily: 'Inter-Regular', fontSize: 13.4, lineHeight: 19.5, paddingHorizontal: 6 },
  compareDivider: { width: 1, backgroundColor: '#E2ECE9', marginVertical: 1 },
  comparison: { borderWidth: 1, borderColor: '#DDE9E7', borderRadius: 13, overflow: 'hidden', marginVertical: 10 },
  comparisonHeader: { flexDirection: 'row', backgroundColor: '#EAF7F5' },
  comparisonHead: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, color: '#155B56', fontFamily: 'Inter-SemiBold', fontSize: 12.5, lineHeight: 17 },
  comparisonRow: { borderTopWidth: 1, borderTopColor: '#E5EFED', paddingTop: 7 },
  comparisonLabel: { paddingHorizontal: 10, paddingBottom: 4, color: '#57706D', fontFamily: 'Inter-SemiBold', fontSize: 11.5, lineHeight: 16 },
  comparisonValues: { flexDirection: 'row' },
  comparisonCell: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingBottom: 9, color: '#26364D', fontFamily: 'Inter-Regular', fontSize: 13.5, lineHeight: 19 },
});
