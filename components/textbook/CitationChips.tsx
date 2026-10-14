import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticService from '@/utils/hapticService';
import { boardLabel, citationChipLabel, type TextbookCitation } from '@/utils/textbookScope';

/** Book · chapter · page chips under a textbook-mode answer. Tap opens the passage. */
export function CitationChips({ citations }: { citations: TextbookCitation[] }) {
  const [open, setOpen] = useState<TextbookCitation | null>(null);
  if (!citations?.length) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Ionicons name="book-outline" size={13} color="#0F766E" />
        <Text style={styles.head}>From your textbook</Text>
      </View>
      <View style={styles.chips}>
        {citations.map((c) => (
          <TouchableOpacity key={c.chunkId} style={styles.chip} activeOpacity={0.85}
            onPress={() => { HapticService.selection(); setOpen(c); }}
            accessibilityLabel={`Source ${c.ref}: ${citationChipLabel(c)}`}>
            <Text style={styles.ref}>[{c.ref}]</Text>
            <Text style={styles.chipText} numberOfLines={1}>{citationChipLabel(c)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)} />
        {open && (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{open.bookTitle}</Text>
            <Text style={styles.sheetMeta}>
              {boardLabel(open.board)} · Class {open.classLevel}
              {open.chapterNumber != null ? ` · Chapter ${open.chapterNumber}${open.chapterTitle ? `: ${open.chapterTitle}` : ''}` : ''}
              {` · Page ${open.page}`}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={styles.excerpt}>{open.excerpt}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.close} onPress={() => setOpen(null)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  head: { fontSize: 11, fontWeight: '700', color: '#0F766E', letterSpacing: 0.4, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%',
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(0, 212, 199, 0.10)', borderWidth: 1, borderColor: 'rgba(15, 118, 110, 0.25)',
  },
  ref: { fontSize: 11, fontWeight: '800', color: '#0F766E' },
  chipText: { fontSize: 11, color: '#134E4A', flexShrink: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: { position: 'absolute', left: 16, right: 16, top: '20%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  sheetMeta: { fontSize: 12, color: '#0F766E', marginTop: 2, marginBottom: 10, fontWeight: '600' },
  excerpt: { fontSize: 14, lineHeight: 21, color: '#334155' },
  close: { marginTop: 14, alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: '#0F766E', fontWeight: '700' },
});

export default CitationChips;
