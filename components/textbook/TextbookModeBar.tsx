import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticService from '@/utils/hapticService';
import { TextbookScopePicker } from './TextbookScopePicker';
import { scopeLabel, type TextbookScope } from '@/utils/textbookScope';

type Props = {
  enabled: boolean;
  scope: TextbookScope;
  onToggle: (next: boolean) => void;
  onScopeChange: (next: TextbookScope) => void;
};

/** "Textbook mode" toggle above the MIGA composer, with a board/class sheet. */
export function TextbookModeBar({ enabled, scope, onToggle, onScopeChange }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<TextbookScope>(scope);

  const openSheet = () => { setDraft(scope); setSheetOpen(true); HapticService.selection(); };

  return (
    <>
      <View style={[styles.bar, enabled && styles.barOn]}>
        <Ionicons name="book" size={15} color={enabled ? '#0F766E' : '#64748B'} />
        <Text style={[styles.title, enabled && styles.titleOn]}>Textbook mode</Text>
        <TouchableOpacity onPress={openSheet} style={styles.scopeBtn} accessibilityLabel="Change textbook board and class">
          <Text style={styles.scopeText} numberOfLines={1}>{scopeLabel(scope)}</Text>
          <Ionicons name="chevron-down" size={12} color="#64748B" />
        </TouchableOpacity>
        <Switch
          value={enabled}
          onValueChange={(v) => { HapticService.selection(); onToggle(v); }}
          trackColor={{ true: '#5EEAD4', false: '#CBD5E1' }}
          thumbColor={enabled ? '#0F766E' : '#F8FAFC'}
          accessibilityLabel="Answer only from my textbooks, with chapter and page citations"
        />
      </View>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Answer from my textbooks</Text>
          <Text style={styles.sheetText}>
            MIGA searches the books you pick and cites the book, chapter and page for every fact.
          </Text>
          <TextbookScopePicker value={draft} onChange={setDraft} title="BOARD AND CLASS" />
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => { onScopeChange(draft); if (!enabled) onToggle(true); setSheetOpen(false); HapticService.success(); }}
          >
            <Text style={styles.saveText}>Use these books</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12, marginBottom: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: '#F1F5F9',
  },
  barOn: { backgroundColor: 'rgba(0, 212, 199, 0.12)' },
  title: { fontSize: 12, fontWeight: '700', color: '#475569' },
  titleOn: { color: '#0F766E' },
  scopeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6 },
  scopeText: { fontSize: 12, color: '#64748B', flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  sheet: { backgroundColor: '#FFFFFF', padding: 20, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  sheetText: { fontSize: 13, color: '#475569', marginTop: 4 },
  saveBtn: { marginTop: 18, backgroundColor: '#0F766E', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});

export default TextbookModeBar;
