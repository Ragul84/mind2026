import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  QuizEvaluation,
  QuizQuestionEnvelope,
  QuizQuestionResponse,
  evaluateQuizQuestion,
  getQuestionDisplayType,
} from '@/utils/quizQuestionTypes';

type Props = {
  question: QuizQuestionEnvelope;
  revealAnswer?: boolean;
  disabled?: boolean;
  onSubmit: (evaluation: QuizEvaluation, response: QuizQuestionResponse) => void;
};

const alpha = (idx: number) => String.fromCharCode(65 + idx);

export default function QuestionRenderer({ question, revealAnswer = false, disabled = false, onSubmit }: Props) {
  const type = getQuestionDisplayType(question);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [fillText, setFillText] = useState('');
  const [matchMapping, setMatchMapping] = useState<number[]>([]);
  const [sequenceOrder, setSequenceOrder] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState<QuizQuestionResponse | null>(null);

  const resetKey = useMemo(
    () => question.id || question.question || question.question_text || question.prompt || Math.random().toString(36),
    [question.id, question.question, question.question_text, question.prompt],
  );

  useEffect(() => {
    setSelectedIndex(null);
    setFillText('');
    setMatchMapping([]);
    setSequenceOrder([]);
    setSubmitted(null);
  }, [resetKey]);

  const submit = (response: QuizQuestionResponse) => {
    const evaluation = evaluateQuizQuestion(question, response);
    setSubmitted(response);
    onSubmit(evaluation, response);
  };

  const optionList = (question.options && question.options.length > 0)
    ? question.options
    : type === 'true_false'
      ? ['True', 'False']
      : (type === 'multi_statement' && question.statements?.length
        ? question.statements.map((statement, idx) => `Statement ${idx + 1}: ${statement}`)
        : []);
  const matchLeft = question.pairs?.length
    ? question.pairs.map((pair) => pair.left)
    : (question.items || []).map((item, idx) => String(item?.text ?? item?.label ?? item ?? `Item ${idx + 1}`).trim());
  const matchRight = optionList.length > 0
    ? optionList
    : question.pairs?.map((pair) => pair.right) || [];
  const matchExpected = Array.isArray(question.answer_key) ? question.answer_key.map((item) => String(item)) : [];
  const sequenceItems = (question.items || optionList.map((opt, idx) => ({ id: String(idx), text: opt })))
    .map((item, idx) => ({
      id: item?.id ? String(item.id) : String(idx),
      text: String(item?.text ?? item?.label ?? item ?? '').trim(),
    }))
    .filter((item) => item.text.length > 0);
  const filledMatchCount = matchMapping.filter((value) => Number.isInteger(value)).length;
  const canSubmitMatch = filledMatchCount === matchLeft.length && matchLeft.length > 0;
  const canSubmitSequence = sequenceOrder.length === sequenceItems.length && sequenceItems.length > 0;

  const showResultBanner = revealAnswer && submitted;
  const evaluation = showResultBanner ? evaluateQuizQuestion(question, submitted as QuizQuestionResponse) : null;

  const renderChoiceButtons = () => {
    if (optionList.length === 0) return null;
    return optionList.map((option, idx) => {
      const isSelected = selectedIndex === idx;
      const isCorrect = revealAnswer && question.answer_index === idx;
      const isWrong = revealAnswer && isSelected && !isCorrect;
      return (
        <TouchableOpacity
          key={idx}
          activeOpacity={disabled || revealAnswer ? 1 : 0.82}
          disabled={disabled || revealAnswer}
          style={[
            styles.optionCard,
            isSelected && !revealAnswer && styles.optionSelected,
            isCorrect && styles.optionCorrect,
            isWrong && styles.optionWrong,
          ]}
          onPress={() => {
            if (disabled || revealAnswer) return;
            setSelectedIndex(idx);
            submit({ type: 'mcq', selectedIndex: idx });
          }}
        >
          <View style={[styles.optionBadge, isCorrect && styles.optionBadgeCorrect, isWrong && styles.optionBadgeWrong]}>
            <Text style={styles.optionBadgeText}>{alpha(idx)}</Text>
          </View>
          <Text style={styles.optionText}>{option}</Text>
          {revealAnswer && isCorrect && <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
          {revealAnswer && isWrong && <Ionicons name="close-circle" size={18} color="#EF4444" />}
        </TouchableOpacity>
      );
    });
  };

  const renderFillBlank = () => (
    <View style={styles.sectionBlock}>
      <Text style={styles.helperText}>Type the missing answer</Text>
      <TextInput
        value={fillText}
        onChangeText={setFillText}
        editable={!disabled && !revealAnswer}
        placeholder="Enter answer"
        placeholderTextColor="#94A3B8"
        style={styles.textInput}
      />
      {optionList.length > 0 && (
        <View style={styles.chipWrap}>
          {optionList.map((option, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.chip}
              disabled={disabled || revealAnswer}
              onPress={() => setFillText(option)}
            >
              <Text style={styles.chipText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!revealAnswer && (
        <TouchableOpacity
          style={[styles.submitBtn, !fillText.trim() && styles.submitBtnDisabled]}
          disabled={disabled || !fillText.trim()}
          onPress={() => submit({ type: 'fill_blank', text: fillText })}
        >
          <Text style={styles.submitBtnText}>Check Answer</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const toggleSequence = (idx: number) => {
    if (revealAnswer || disabled) return;
    setSequenceOrder((prev) => (prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx]));
  };

  const removeSequenceItem = (idx: number) => {
    if (revealAnswer || disabled) return;
    setSequenceOrder((prev) => prev.filter((item) => item !== idx));
  };

  const renderSequence = () => (
    <View style={styles.sectionBlock}>
      <Text style={styles.helperText}>Tap items in the correct order</Text>
      <View style={styles.sequenceSelection}>
        {sequenceOrder.map((idx, orderIdx) => (
          <TouchableOpacity
            key={`${idx}-${orderIdx}`}
            style={styles.sequencePill}
            onPress={() => removeSequenceItem(idx)}
            disabled={disabled || revealAnswer}
          >
            <Text style={styles.sequencePillText}>{orderIdx + 1}. {sequenceItems[idx]?.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.sequenceGrid}>
        {sequenceItems.map((item, idx) => {
          const selected = sequenceOrder.includes(idx);
          return (
            <TouchableOpacity
              key={item.id || `${idx}`}
              style={[styles.sequenceCard, selected && styles.sequenceCardSelected]}
              disabled={disabled || revealAnswer}
              onPress={() => toggleSequence(idx)}
            >
              <Text style={styles.sequenceCardText}>{item.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!revealAnswer && (
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmitSequence && styles.submitBtnDisabled]}
          disabled={disabled || !canSubmitSequence}
          onPress={() => submit({ type: 'sequence', order: sequenceOrder })}
        >
          <Text style={styles.submitBtnText}>Check Order</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderMatch = () => (
    <View style={styles.sectionBlock}>
      <Text style={styles.helperText}>Tap the correct match for each item</Text>
      <View style={styles.matchLegend}>
        {matchRight.map((right, idx) => (
          <View key={`legend-${right}-${idx}`} style={styles.matchLegendPill}>
            <Text style={styles.matchLegendLetter}>{alpha(idx)}</Text>
            <Text style={styles.matchLegendText} numberOfLines={1}>{right}</Text>
          </View>
        ))}
      </View>
      <View style={styles.matchList}>
        {matchLeft.map((left, leftIdx) => (
          <View key={`${left}-${leftIdx}`} style={styles.matchRow}>
            <View style={styles.matchStem}>
              <View style={styles.matchStemIndex}>
                <Text style={styles.matchStemIndexText}>{leftIdx + 1}</Text>
              </View>
              <Text style={styles.matchLeft}>{left}</Text>
            </View>
            <View style={styles.matchChoices}>
              {matchRight.map((right, rightIdx) => {
                const selected = matchMapping[leftIdx] === rightIdx;
                const expected = matchExpected[leftIdx];
                const isCorrect = revealAnswer && expected ? expected === String(rightIdx) : false;
                const isWrong = revealAnswer && selected && !isCorrect;
                return (
                  <TouchableOpacity
                    key={`${right}-${rightIdx}`}
                    style={[
                      styles.matchChoice,
                      selected && styles.matchChoiceSelected,
                      isCorrect && styles.matchChoiceCorrect,
                      isWrong && styles.matchChoiceWrong,
                    ]}
                    disabled={disabled || revealAnswer}
                    onPress={() => {
                      const next = [...matchMapping];
                      next[leftIdx] = rightIdx;
                      setMatchMapping(next);
                    }}
                  >
                    <Text style={[styles.matchChoiceBadge, isCorrect && styles.matchChoiceBadgeCorrect, isWrong && styles.matchChoiceBadgeWrong]}>
                      {alpha(rightIdx)}
                    </Text>
                    <Text style={styles.matchChoiceText}>{right}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      {!revealAnswer && (
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmitMatch && styles.submitBtnDisabled]}
          disabled={disabled || !canSubmitMatch}
          onPress={() => submit({ type: 'match', mapping: matchMapping })}
        >
          <Text style={styles.submitBtnText}>Check Match</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderResultBanner = () => {
    if (!showResultBanner || !evaluation) return null;
    return (
      <View style={[styles.resultBanner, evaluation.isCorrect ? styles.resultCorrect : styles.resultWrong]}>
        <Ionicons
          name={evaluation.isCorrect ? 'checkmark-circle' : 'alert-circle'}
          size={16}
          color={evaluation.isCorrect ? '#059669' : '#B91C1C'}
        />
        <Text style={[styles.resultBannerText, evaluation.isCorrect ? styles.resultBannerTextCorrect : styles.resultBannerTextWrong]}>
          {evaluation.isCorrect ? 'Correct' : 'Check the explanation'}
        </Text>
      </View>
    );
  };

  const renderPrompt = () => (
    <>
      {question.passage ? <Text style={styles.passageText}>{question.passage}</Text> : null}
      {question.media?.uri ? (
        <Image source={{ uri: question.media.uri }} resizeMode="contain" style={styles.mediaImage} />
      ) : null}
      {question.statements?.length ? (
        <View style={styles.statementBox}>
          {question.statements.map((statement, idx) => (
            <Text key={`${idx}-${statement}`} style={styles.statementText}>
              {idx + 1}. {statement}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      {renderPrompt()}
      {renderResultBanner()}
      {type === 'fill_blank' ? renderFillBlank() : null}
      {type === 'sequence' ? renderSequence() : null}
      {type === 'match' ? renderMatch() : null}
      {(type === 'mcq' || type === 'true_false' || type === 'multi_statement' || (type !== 'fill_blank' && type !== 'sequence' && type !== 'match')) ? (
        <View style={styles.optionsWrap}>
          {renderChoiceButtons()}
        </View>
      ) : null}
      {showResultBanner && evaluation && (
        <View style={styles.explainer}>
          <Text style={styles.explainerTitle}>Answer</Text>
          <Text style={styles.explainerText}>
            {evaluation.answerSummary || question.explanation || 'Review the topic for the full explanation.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  questionText: {
    fontSize: 17,
    lineHeight: 26,
    color: '#0F172A',
    fontFamily: 'Poppins-SemiBold',
  },
  passageText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    fontFamily: 'Inter-Medium',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mediaImage: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
  },
  statementBox: {
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statementText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#334155',
    fontFamily: 'Inter-Medium',
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  resultCorrect: { backgroundColor: 'rgba(16,185,129,0.12)' },
  resultWrong: { backgroundColor: 'rgba(239,68,68,0.10)' },
  resultBannerText: { fontFamily: 'Poppins-SemiBold', fontSize: 12 },
  resultBannerTextCorrect: { color: '#047857' },
  resultBannerTextWrong: { color: '#991B1B' },
  optionsWrap: { gap: 10 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  optionSelected: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124,58,237,0.06)',
  },
  optionCorrect: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  optionWrong: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  optionBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    flexShrink: 0,
  },
  optionBadgeCorrect: { backgroundColor: 'rgba(16,185,129,0.15)' },
  optionBadgeWrong: { backgroundColor: 'rgba(239,68,68,0.12)' },
  optionBadgeText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#334155' },
  optionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    color: '#0F172A',
    fontFamily: 'Inter-Medium',
  },
  sectionBlock: { gap: 10 },
  helperText: {
    fontSize: 12,
    color: '#64748B',
    fontFamily: 'Inter-Medium',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0F172A',
    fontFamily: 'Inter-Medium',
    backgroundColor: '#FFFFFF',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Poppins-Medium',
    color: '#1D4ED8',
  },
  submitBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
  },
  matchList: { gap: 10 },
  matchRow: {
    gap: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  matchStem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  matchStemIndex: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    flexShrink: 0,
  },
  matchStemIndexText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#4338CA',
  },
  matchLeft: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Poppins-SemiBold',
    color: '#0F172A',
    flex: 1,
  },
  matchChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  matchChoice: {
    minWidth: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  matchChoiceSelected: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124,58,237,0.08)',
  },
  matchChoiceCorrect: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16,185,129,0.10)',
  },
  matchChoiceWrong: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  matchChoiceBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: '#E2E8F0',
    color: '#334155',
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    overflow: 'hidden',
  },
  matchChoiceBadgeCorrect: {
    backgroundColor: 'rgba(16,185,129,0.18)',
    color: '#047857',
  },
  matchChoiceBadgeWrong: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    color: '#B91C1C',
  },
  matchChoiceText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter-Medium',
    color: '#334155',
  },
  matchLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 2,
  },
  matchLegendPill: {
    minWidth: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  matchLegendLetter: {
    width: 22,
    height: 22,
    borderRadius: 7,
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: '#EEF2FF',
    color: '#4338CA',
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    overflow: 'hidden',
  },
  matchLegendText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#0F172A',
    fontFamily: 'Inter-Medium',
  },
  sequenceSelection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sequencePill: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sequencePillText: {
    fontSize: 12,
    color: '#312E81',
    fontFamily: 'Inter-Medium',
  },
  sequenceGrid: {
    gap: 8,
  },
  sequenceCard: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  sequenceCardSelected: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124,58,237,0.08)',
  },
  sequenceCardText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#0F172A',
  },
  explainer: {
    gap: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  explainerTitle: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    color: '#0F172A',
  },
  explainerText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#475569',
    lineHeight: 19,
  },
});
