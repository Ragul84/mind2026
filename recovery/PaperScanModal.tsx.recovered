import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { mascotApi, PaperAnswer, AIBudgetError } from '@/services/mascotApi';

/**
 * PaperScanModal — "Scan & Solve". Photograph (or pick + crop) a question paper;
 * MIGA answers every question fast with Q# → option → answer + a one-line why and
 * an honest confidence badge. Free feature, bounded by the daily AI cost budget.
 *
 * Crop: gallery picks support single-region crop (allowsEditing) so users can
 * isolate one question, or shoot the full page. (Multi-region draggable crop is
 * a planned v2.)
 */

interface PaperScanModalProps {
  visible: boolean;
  onClose: () => void;
  languageCode?: string;
  onResults: (answers: PaperAnswer[], note?: string) => void;
}

export default function PaperScanModal({ visible, onClose, languageCode = 'en-IN', onResults }: PaperScanModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<PaperAnswer[] | null>(null);
  const [note, setNote] = useState('');
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (visible && !permission?.granted) requestPermission();
  }, [visible]);

  const reset = () => {
    setCaptured(null);
    setBusy(false);
    setAnswers(null);
    setNote('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const process = async (base64: string, imageType: string) => {
    setBusy(true);
    try {
      const res = await mascotApi.solveQuestionPaper(base64, imageType, languageCode);
      if (!res.answers.length) {
        Alert.alert(
          'Nothing readable',
          res.note || 'Couldn’t read clear questions. Try better lighting, get closer, or crop to one question.',
          [{ text: 'Retake', onPress: () => setCaptured(null) }],
        );
        setBusy(false);
        return;
      }
      setAnswers(res.answers);
      setNote(res.note || '');
    } catch (e: any) {
      setBusy(false);
      if (e instanceof AIBudgetError) {
        Alert.alert(
          'Daily free limit reached',
          'You’ve used today’s free AI for now — it resets at midnight. Upgrade to PRO for much more.',
          [
            { text: 'Upgrade', onPress: () => { handleClose(); router.push('/subscription'); } },
            { text: 'OK', style: 'cancel' },
          ],
        );
        return;
      }
      Alert.alert('Scan failed', e?.message || 'Something went wrong. Please try again.', [
        { text: 'Retake', onPress: () => setCaptured(null) },
      ]);
    }
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
      if (photo?.base64) {
        setCaptured(photo.uri);
        await process(photo.base64, 'image/jpeg');
      }
    } catch {
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true, // single-region crop — isolate one question if wanted
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled && result.assets[0]?.base64) {
        const asset = result.assets[0];
        setCaptured(asset.uri);
        await process(asset.base64!, asset.mimeType || 'image/jpeg');
      }
    } catch {
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  };

  const confidenceTone = (c?: number) => {
    if (typeof c !== 'number') return null;
    if (c >= 0.8) return { label: 'High confidence', color: '#059669' };
    if (c >= 0.55) return { label: 'Likely', color: '#D97706' };
    return { label: 'Double-check', color: '#E11D48' };
  };

  if (!visible) return null;

  // ── Results view ──────────────────────────────────────────────────────────
  if (answers) {
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen">
        <View style={styles.resultsRoot}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity onPress={handleClose} style={styles.resHeaderBtn}>
              <Ionicons name="close" size={22} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.resultsTitle}>{answers.length} answer{answers.length > 1 ? 's' : ''}</Text>
            <TouchableOpacity onPress={() => { reset(); }} style={styles.resHeaderBtn}>
              <Ionicons name="scan" size={20} color="#4F46E5" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.resultsScroll} showsVerticalScrollIndicator={false}>
            {!!note && (
              <View style={styles.noteCard}>
                <Ionicons name="information-circle" size={15} color="#4F46E5" />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            )}
            {answers.map((a, i) => {
              const tone = confidenceTone(a.confidence);
              return (
                <View key={`${a.q}-${i}`} style={styles.ansCard}>
                  <View style={styles.ansTop}>
                    <View style={styles.qBadge}>
                      <Text style={styles.qBadgeText}>Q{a.q}</Text>
                    </View>
                    {tone && (
                      <View style={[styles.confPill, { backgroundColor: `${tone.color}14` }]}>
                        <Text style={[styles.confText, { color: tone.color }]}>{tone.label}</Text>
                      </View>
                    )}
                  </View>
                  {!!a.question && <Text style={styles.qText}>{a.question}</Text>}
                  <View style={styles.ansRow}>
                    {!!a.answer && (
                      <View style={styles.ansLetter}>
                        <Text style={styles.ansLetterText}>{a.answer}</Text>
                      </View>
                    )}
                    <Text style={styles.ansTextValue}>{a.answerText || a.answer}</Text>
                  </View>
                  {!!a.reason && <Text style={styles.reasonText}>{a.reason}</Text>}
                </View>
              );
            })}
            <Text style={styles.disclaimer}>
              AI-generated answers — verify low-confidence ones against your source.
            </Text>
          </ScrollView>

          <View style={styles.resultsFooter}>
            <TouchableOpacity style={styles.retakeBtn} onPress={() => reset()} activeOpacity={0.85}>
              <Ionicons name="camera-outline" size={18} color="#0F172A" />
              <Text style={styles.retakeText}>Scan another</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.discussBtn}
              activeOpacity={0.85}
              onPress={() => { onResults(answers, note); handleClose(); }}
            >
              <Text style={styles.discussText}>Discuss in chat</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Capture / processing view ─────────────────────────────────────────────
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.root}>
        {!permission?.granted ? (
          <View style={styles.permWrap}>
            <View style={styles.permCard}>
              <Ionicons name="camera" size={40} color="#4F46E5" />
              <Text style={styles.permTitle}>Camera access needed</Text>
              <Text style={styles.permText}>Allow MIGA to scan question papers and answer them instantly.</Text>
              <TouchableOpacity style={styles.permBtn} onPress={() => requestPermission()}>
                <Text style={styles.permBtnText}>Allow camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.permGallery} onPress={pickFromGallery}>
                <Ionicons name="images-outline" size={18} color="#0F172A" />
                <Text style={styles.permGalleryText}>Use gallery instead</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.permClose} onPress={handleClose}>
                <Text style={styles.permCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : captured ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: captured }} style={styles.previewImg} />
            {busy && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#FFFFFF" />
                <Text style={styles.processingText}>Reading & solving…</Text>
              </View>
            )}
            {!busy && (
              <View style={styles.previewControls}>
                <TouchableOpacity style={styles.retakeBtn} onPress={() => setCaptured(null)}>
                  <Text style={styles.retakeText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.solveBtn}
                  onPress={() => FileSystem.readAsStringAsync(captured, { encoding: 'base64' }).then((b) => process(b, 'image/jpeg'))}
                >
                  <Text style={styles.solveText}>Solve</Text>
                  <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <CameraView ref={cameraRef} style={styles.camera} facing={facing} flash={flash ? 'on' : 'off'}>
            <View style={styles.camHeader}>
              <TouchableOpacity style={styles.camHeaderBtn} onPress={handleClose}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.camTitle}>Scan & Solve</Text>
              <TouchableOpacity style={styles.camHeaderBtn} onPress={() => setFlash((f) => !f)}>
                <Ionicons name={flash ? 'flash' : 'flash-off'} size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.frameWrap}>
              <View style={styles.frame}>
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
              </View>
              <Text style={styles.frameHint}>Fit the question(s) in the frame · full page or crop one</Text>
            </View>

            <View style={styles.camControls}>
              <TouchableOpacity style={styles.sideBtn} onPress={pickFromGallery}>
                <Ionicons name="images" size={24} color="#FFFFFF" />
                <Text style={styles.sideBtnText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shutter} onPress={takePicture}>
                <View style={styles.shutterInner} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.sideBtn} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
                <Ionicons name="camera-reverse" size={24} color="#FFFFFF" />
                <Text style={styles.sideBtnText}>Flip</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1120' },
  camera: { flex: 1 },
  camHeader: { position: 'absolute', top: 50, left: 0, right: 0, zIndex: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  camHeaderBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center' },
  camTitle: { fontSize: 17, fontFamily: 'Poppins-Bold', color: '#FFFFFF', backgroundColor: 'rgba(15,23,42,0.6)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12 },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  frame: { width: '100%', aspectRatio: 0.78, position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#4F46E5', borderWidth: 3 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  frameHint: { marginTop: 22, fontSize: 13.5, fontFamily: 'Inter-Medium', color: '#FFFFFF', textAlign: 'center', backgroundColor: 'rgba(15,23,42,0.6)', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14 },
  camControls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 44, paddingTop: 20 },
  sideBtn: { alignItems: 'center', gap: 5, width: 60 },
  sideBtnText: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#F8FAFC' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF' },

  // permission
  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permCard: { width: '100%', maxWidth: 360, alignItems: 'center', borderRadius: 28, padding: 24, backgroundColor: '#FFFFFF' },
  permTitle: { marginTop: 14, fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A', textAlign: 'center' },
  permText: { marginTop: 8, fontSize: 14, fontFamily: 'Inter-Medium', color: '#64748B', lineHeight: 20, textAlign: 'center' },
  permBtn: { marginTop: 20, width: '100%', minHeight: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4F46E5' },
  permBtnText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  permGallery: { marginTop: 10, width: '100%', minHeight: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: '#EEF1FF' },
  permGalleryText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  permClose: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 12 },
  permCloseText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#64748B' },

  // preview / processing
  previewWrap: { flex: 1, backgroundColor: '#0B1120' },
  previewImg: { flex: 1, resizeMode: 'contain' },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,17,32,0.78)', alignItems: 'center', justifyContent: 'center', gap: 14 },
  processingText: { fontSize: 15, fontFamily: 'Poppins-SemiBold', color: '#FFFFFF' },
  previewControls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: 24, backgroundColor: '#0F172A' },
  solveBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 16, backgroundColor: '#4F46E5' },
  solveText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },

  // results
  resultsRoot: { flex: 1, backgroundColor: '#F6F8FC' },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 54, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEF2F7' },
  resHeaderBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultsTitle: { fontSize: 17, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  resultsScroll: { padding: 16, paddingBottom: 8 },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EEF1FF', borderRadius: 12, padding: 11, marginBottom: 12 },
  noteText: { flex: 1, fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#4338CA', lineHeight: 18 },
  ansCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E6EAF4', padding: 14, marginBottom: 10 },
  ansTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  qBadge: { backgroundColor: '#EEF1FF', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  qBadgeText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#4F46E5' },
  confPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  confText: { fontSize: 11, fontFamily: 'Poppins-SemiBold' },
  qText: { fontSize: 14, fontFamily: 'Inter-Medium', color: '#334155', lineHeight: 20, marginBottom: 10 },
  ansRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ansLetter: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center' },
  ansLetterText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  ansTextValue: { flex: 1, fontSize: 14.5, fontFamily: 'Poppins-SemiBold', color: '#0F172A', lineHeight: 20 },
  reasonText: { marginTop: 8, fontSize: 13, fontFamily: 'Inter-Regular', color: '#64748B', lineHeight: 19 },
  disclaimer: { fontSize: 11.5, fontFamily: 'Inter-Regular', color: '#94A3B8', textAlign: 'center', marginTop: 6, marginBottom: 4 },
  resultsFooter: { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 30, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEF2F7' },
  retakeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 18, height: 50, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  retakeText: { fontSize: 14.5, fontFamily: 'Poppins-SemiBold', color: '#0F172A' },
  discussBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 16, backgroundColor: '#4F46E5' },
  discussText: { fontSize: 14.5, fontFamily: 'Poppins-SemiBold', color: '#FFFFFF' },
});
