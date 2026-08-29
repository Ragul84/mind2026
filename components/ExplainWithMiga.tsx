// Explain-every-wrong-answer (Phase 2). A self-contained inline card that turns
// a question + its correct answer into a grounded, cited micro-lesson streamed
// from MIGA (miga_stream, study mode). Drops into any reader — no chat-UI changes.
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { mascotApi } from '@/services/mascotApi';
import { useAuthContext } from '@/components/AuthProvider';
import HapticService from '@/utils/hapticService';

type Props = {
  question: string;
  options: string[];
  correctText: string;
  userPickText?: string;
  /** Optional exam/subject context to sharpen retrieval. */
  context?: string;
};

// Strip fenced/JSON blocks and heavy markdown so plain <Text> reads cleanly.
function clean(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function ExplainWithMiga({ question, options, correctText, userPickText, context }: Props) {
  const { user } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const startedRef = useRef(false);

  const run = () => {
    HapticService.selection();
    setOpen(true);
    if (startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    setError(false);

    const prompt =
      `Explain the correct answer to this multiple-choice question as a short, clear micro-lesson grounded in the textbook. ` +
      `Say why the correct option is right, and briefly why a tempting wrong option is wrong. Keep it to 3–5 sentences.` +
      (context ? `\nContext: ${context}` : '') +
      `\n\nQuestion: ${question}\nOptions:\n` +
      options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n') +
      `\nCorrect answer: ${correctText}` +
      (userPickText ? `\nStudent chose: ${userPickText}` : '');

    let acc = '';
    mascotApi.streamChat(
      user?.id || 'anon',
      [{ role: 'user', content: prompt }],
      'study',
      (tok) => { acc += tok; setText(clean(acc)); if (loading) setLoading(false); },
      (full) => { setText(clean(full || acc)); setLoading(false); },
      () => { setError(true); setLoading(false); },
      { languageCode: 'en-IN', languageLabel: 'English' },
    );
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.trigger} activeOpacity={0.85} onPress={run}>
        <Ionicons name="sparkles" size={15} color="#0F766E" />
        <Text style={styles.triggerText}>Explain with MIGA</Text>
      </TouchableOpacity>
    );
  }

  return (
    <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 220 }} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.migaBadge}><Ionicons name="sparkles" size={12} color="#FFFFFF" /></View>
        <Text style={styles.headerText}>MIGA explains</Text>
      </View>
      {loading && !text ? (
        <View style={styles.loadingRow}><ActivityIndicator size="small" color="#00AFA5" /><Text style={styles.loadingText}>Reading your textbook…</Text></View>
      ) : error ? (
        <Text style={styles.errorText}>Couldn't load an explanation right now. Try again in a moment.</Text>
      ) : (
        <Text style={styles.body}>{text}{loading ? ' ▍' : ''}</Text>
      )}
      <View style={styles.footer}>
        <Ionicons name="shield-checkmark" size={11} color="#0F766E" />
        <Text style={styles.footerText}>Grounded in your textbooks</Text>
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, height: 44, borderRadius: 13, backgroundColor: '#F0FDFC', borderWidth: 1, borderColor: '#CCFBF1' },
  triggerText: { fontSize: 13.5, fontFamily: 'Poppins-Bold', color: '#0F766E' },

  card: { marginTop: 12, backgroundColor: '#F4F7FA', borderRadius: 14, padding: 14, borderLeftWidth: 3, borderLeftColor: '#00D4C7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  migaBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#00AFA5', alignItems: 'center', justifyContent: 'center' },
  headerText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#0F766E' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  loadingText: { fontSize: 13, fontFamily: 'Inter-Medium', color: '#64748B' },
  body: { fontSize: 13.5, fontFamily: 'Inter-Medium', color: '#334155', lineHeight: 20 },
  errorText: { fontSize: 13, fontFamily: 'Inter-Medium', color: '#94A3B8', lineHeight: 19 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  footerText: { fontSize: 10.5, fontFamily: 'Poppins-SemiBold', color: '#0F766E' },
});
