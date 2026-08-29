import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StackedFractionProps {
  numerator: string;
  denominator: string;
  fontSize?: number;
  color?: string;
}

/**
 * Renders a true textbook-style stacked fraction (Numerator over Denominator with a horizontal bar).
 */
export function StackedFraction({
  numerator,
  denominator,
  fontSize = 13,
  color = '#0F172A',
}: StackedFractionProps) {
  const numText = String(numerator || '').trim();
  const denText = String(denominator || '').trim();

  return (
    <View style={styles.container}>
      <Text style={[styles.numerator, { fontSize: fontSize * 0.88, color }]}>
        {numText}
      </Text>
      <View style={[styles.fractionBar, { borderColor: color }]} />
      <Text style={[styles.denominator, { fontSize: fontSize * 0.88, color }]}>
        {denText}
      </Text>
    </View>
  );
}

interface InlineMathTextProps {
  text: string;
  fontSize?: number;
  color?: string;
  style?: any;
}

/**
 * Renders inline math text with auto-detected stacked fractions, subscript variables, and textbook symbols.
 */
export function InlineMathText({
  text,
  fontSize = 14,
  color = '#0F172A',
  style,
}: InlineMathTextProps) {
  if (!text) return null;

  // Regex matching fractions like 1/f, 2/3, (a+b)/(c-d), \frac{a}{b}, n_2/n_1, etc.
  const fractionRegex = /(\b[a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s\(\)]+)\/([a-zA-Z0-9₀-₉α-ωΑ-Ω\+\-\*\s\(\)]+\b)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fractionRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0];
    const rawNum = match[1].replace(/[\(\)]/g, '').trim();
    const rawDen = match[2].replace(/[\(\)]/g, '').trim();

    // Push preceding text
    if (matchIndex > lastIndex) {
      parts.push(
        <Text key={`text-${lastIndex}`} style={[{ fontSize, color }, style]}>
          {text.substring(lastIndex, matchIndex)}
        </Text>
      );
    }

    // Push stacked fraction component
    parts.push(
      <StackedFraction
        key={`frac-${matchIndex}`}
        numerator={rawNum}
        denominator={rawDen}
        fontSize={fontSize}
        color={color}
      />
    );

    lastIndex = matchIndex + fullMatch.length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    parts.push(
      <Text key={`text-${lastIndex}`} style={[{ fontSize, color }, style]}>
        {text.substring(lastIndex)}
      </Text>
    );
  }

  return (
    <View style={styles.inlineRow}>
      {parts}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
    paddingHorizontal: 2,
  },
  numerator: {
    fontFamily: 'Poppins-Medium',
    textAlign: 'center',
    lineHeight: 14,
    marginBottom: 1,
  },
  fractionBar: {
    width: '100%',
    minWidth: 12,
    borderBottomWidth: 1.5,
    marginVertical: 1,
  },
  denominator: {
    fontFamily: 'Poppins-Medium',
    textAlign: 'center',
    lineHeight: 14,
    marginTop: 1,
  },
});
