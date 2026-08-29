import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Dimensions,
  Image,
  ScrollView,
  TextInput,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { 
  X, 
  Camera, 
  Image as ImageIcon, 
  Zap, 
  CheckCircle, 
  RotateCcw,
  ZapOff,
  ScanLine,
  FileText
} from 'lucide-react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { theme } from '@/constants/theme';
import { SupabaseService } from '@/utils/supabaseService';
import { usePremiumFeatures } from '@/hooks/usePremiumFeatures';
import { router } from 'expo-router';
import { mascotApi, MathProblemChoice } from '@/services/mascotApi';
// Removed MascotAvatar due to clean minimal UI constraints
// MascotAvatar is no longer needed

const { width, height } = Dimensions.get('window');

interface CameraScanModalProps {
  visible: boolean;
  onClose: () => void;
  onTextExtracted: (text: string, analysis: any) => void;
  qrLike?: boolean;
  languageCode?: string;
}

export default function CameraScanModal({ visible, onClose, onTextExtracted, qrLike = false, languageCode = 'en-IN' }: CameraScanModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const cameraRef = useRef<CameraView>(null);
  const [extractedProblems, setExtractedProblems] = useState<MathProblemChoice[]>([]);
  const [editingProblem, setEditingProblem] = useState<MathProblemChoice | null>(null);
  const [editedProblemText, setEditedProblemText] = useState('');

  const { isPremium } = usePremiumFeatures();

  const frameWidth = qrLike ? width - 80 : width - 80;
  const frameHeight = qrLike ? width - 80 : (width - 80) * 1.2;
  const instructions = qrLike ? "Position equation inside the square" : "Position document within the frame";
  const headerTitleText = qrLike ? "Math Scanner" : "Scan Document";

  // Animation values
  const scanLineY = useSharedValue(0);
  const processingOpacity = useSharedValue(0);
  const successScale = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      startScanAnimation();
      requestCameraPermission();
    }
  }, [visible, permission?.granted]);

  const startScanAnimation = () => {
    scanLineY.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000 }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      false
    );
  };

  const requestCameraPermission = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      return result.granted;
    }
    return true;
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      const hasPermission = await requestCameraPermission();
      if (!hasPermission) {
        Alert.alert('Camera Permission', 'Camera access is required to scan documents');
        return;
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });

      if (photo) {
        setCapturedImage(photo.uri);
        await processImage(photo.base64!, 'image/jpeg');
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const pickImageFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setCapturedImage(asset.uri);
        await processImage(asset.base64!, asset.mimeType || 'image/jpeg');
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  };

  const processImage = async (base64Data: string, imageType: string) => {
    try {
      // ✅ SECURE: Check real subscription tier server-side
      if (!isPremium) {
        Alert.alert(
          'PRO Feature',
          'Camera scan requires MindGains PRO. Upgrade to unlock unlimited scans.',
          [
            { text: 'Upgrade', onPress: () => { onClose(); router.push('/subscription'); } },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        return;
      }

      setIsProcessing(true);
      processingOpacity.value = withTiming(1, { duration: 300 });

      setProcessingStep('Analyzing image...');
      
      if (qrLike) {
        // Use the Math Solve Edge Function to extract mathematical problems
        const mathRes = await mascotApi.extractMathProblems(base64Data, imageType, languageCode);
        if (mathRes.problems && mathRes.problems.length > 0) {
          if (mathRes.problems.length === 1) {
            // Only one problem was found, solve it directly
            setProcessingStep('Math problem found!');
            successScale.value = withSpring(1, { damping: 15, stiffness: 100 });
            setTimeout(() => {
              const text = mathRes.problems[0].display || (mathRes.problems[0] as any).text || '';
              onTextExtracted(text, null);
              handleClose();
            }, 1200);
          } else {
            // Multiple problems found, show selection UI!
            setIsProcessing(false);
            processingOpacity.value = withTiming(0);
            setExtractedProblems(mathRes.problems);
          }
          return;
        } else if (mathRes.rawText) {
          // Fallback to raw text if no segmented equations were found
          setProcessingStep('Math problem found!');
          successScale.value = withSpring(1, { damping: 15, stiffness: 100 });
          setTimeout(() => {
            onTextExtracted(mathRes.rawText!, null);
            handleClose();
          }, 1200);
          return;
        } else {
          throw new Error('No readable mathematical equations found. Please make sure the equation is clear.');
        }
      }

      // Call our OCR processing function (standard mode)
      const response = await SupabaseService.callEdgeFunction('process-image-ocr', {
        imageData: `data:${imageType};base64,${base64Data}`,
        imageType
      }) as any;

      if (!response.success) {
        throw new Error(response.error || 'OCR processing failed');
      }

      setProcessingStep('Text extracted successfully!');
      successScale.value = withSpring(1, { damping: 15, stiffness: 100 });

      // Wait a moment to show success, then return results
      setTimeout(() => {
        onTextExtracted(response.extractedText, response.contentAnalysis);
        handleClose();
      }, 1500);

    } catch (error: any) {
      setIsProcessing(false);
      processingOpacity.value = withTiming(0);
      Alert.alert(
        'Processing Failed', 
        error?.message || 'Failed to extract text from image. Please ensure the image has clear, readable text.',
        [{ text: 'Try Again', onPress: () => setCapturedImage(null) }]
      );
    }
  };

  const handleClose = () => {
    setCapturedImage(null);
    setIsProcessing(false);
    setExtractedProblems([]);
    setEditingProblem(null);
    setEditedProblemText('');
    processingOpacity.value = 0;
    successScale.value = 0;
    scanLineY.value = 0;
    onClose();
  };

  const submitExtractedProblem = (text: string) => {
    const cleaned = text.trim();
    if (!cleaned) {
      Alert.alert('Edit problem', 'Please keep the problem text before solving.');
      return;
    }
    onTextExtracted(cleaned, null);
    handleClose();
  };

  const handleProblemPress = (problem: MathProblemChoice) => {
    const text = problem.display || (problem as any).text || '';
    const confidence = typeof problem.confidence === 'number' ? problem.confidence : 1;
    if (confidence < 0.6) {
      setEditingProblem(problem);
      setEditedProblemText(text);
      return;
    }
    submitExtractedProblem(text);
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const toggleFlash = () => {
    setFlash(!flash);
  };

  // Animation styles
  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanLineY.value * (frameHeight - 10) }],
  }));

  const processingStyle = useAnimatedStyle(() => ({
    opacity: processingOpacity.value,
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
  }));

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {!permission?.granted && (
          <View style={styles.permissionContainer}>
            <View style={styles.permissionCard}>
              <Camera size={42} color="#00D4C7" />
              <Text style={styles.permissionTitle}>Camera access needed</Text>
              <Text style={styles.permissionText}>
                Allow MindGains to scan problems from your notebook or textbook.
              </Text>
              <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
                <Text style={styles.permissionButtonText}>Allow camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.permissionGalleryButton} onPress={pickImageFromGallery}>
                <ImageIcon size={18} color="#0F172A" />
                <Text style={styles.permissionGalleryText}>Use gallery instead</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.permissionCloseButton} onPress={handleClose}>
                <Text style={styles.permissionCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {permission?.granted && !capturedImage && (
          <>
            {/* Camera View */}
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              flash={flash ? 'on' : 'off'}
            >
              {/* Header */}
              <View style={styles.header}>
                <TouchableOpacity style={styles.headerButton} onPress={handleClose}>
                  <View style={styles.headerButtonBackground}>
                    <X size={24} color={'#FFFFFF'} />
                  </View>
                </TouchableOpacity>
                                 <Text style={styles.headerTitle}>{headerTitleText}</Text>
                
                <TouchableOpacity style={styles.headerButton} onPress={toggleFlash}>
                  <View style={styles.headerButtonBackground}>
                    {flash ? (
                      <Zap size={24} color={'#FACC15'} />
                    ) : (
                      <ZapOff size={24} color={'#FFFFFF'} />
                    )}
                  </View>
                </TouchableOpacity>
              </View>

              {/* Scanning Overlay */}
              <View style={styles.scanOverlay}>
                <View style={[styles.scanFrame, { width: frameWidth, height: frameHeight }]}>
                  <View style={styles.scanCorners}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                  </View>
                  
                  <Animated.View style={[styles.scanLine, scanLineStyle]}>
                    <LinearGradient
                      colors={[
                        'transparent',
                        '#0EA5E9' + '80',
                        '#2DD4BF' + '60',
                        '#0EA5E9' + '80',
                        'transparent'
                      ]}
                      style={styles.scanLineGradient}
                    />
                  </Animated.View>
                </View>
                
                <Text style={styles.scanInstructions}>
                  {instructions}
                </Text>
              </View>

              {/* Controls */}
              <View style={styles.controls}>
                <TouchableOpacity style={styles.galleryButton} onPress={pickImageFromGallery}>
                  <LinearGradient
                    colors={['rgba(15, 23, 42, 0.7)', 'rgba(30, 41, 59, 0.7)']}
                    style={styles.controlButton}
                  >
                    <ImageIcon size={24} color={'#FFFFFF'} />
                  </LinearGradient>
                  <Text style={styles.controlButtonText}>Gallery</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
                  <LinearGradient
                    colors={['#FFFFFF', '#E2E8F0']}
                    style={styles.captureButtonGradient}
                  >
                    <Camera size={32} color={'#0F172A'} />
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
                  <LinearGradient
                    colors={['rgba(15, 23, 42, 0.7)', 'rgba(30, 41, 59, 0.7)']}
                    style={styles.controlButton}
                  >
                    <RotateCcw size={24} color={'#FFFFFF'} />
                  </LinearGradient>
                  <Text style={styles.controlButtonText}>Flip</Text>
                </TouchableOpacity>
              </View>
            </CameraView>
          </>
        )}

        {/* Image Preview & Processing */}
        {capturedImage && (
          <View style={styles.previewContainer}>
            <Image source={{ uri: capturedImage }} style={styles.previewImage} />
            
            {!isProcessing && extractedProblems.length === 0 && (
              <View style={styles.previewControls}>
                <TouchableOpacity style={styles.retakeButton} onPress={() => setCapturedImage(null)}>
                  <Text style={styles.retakeButtonText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.processButton} 
                  onPress={() => {
                    FileSystem.readAsStringAsync(capturedImage, { encoding: 'base64' })
                      .then(base64 => processImage(base64, 'image/jpeg'));
                  }}
                >
                  <LinearGradient
                    colors={['#10B981', '#059669']}
                    style={styles.processButtonGradient}
                  >
                    <Text style={styles.processButtonText}>Extract Text</Text>
                    <Zap size={20} color={'#FFFFFF'} />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            {extractedProblems.length > 0 && (
              <View style={styles.problemsOverlay}>
                <View style={styles.problemsContainer}>
                  <View style={styles.problemsHeader}>
                    <Text style={styles.problemsTitle}>Select a Problem</Text>
                    <Text style={styles.problemsSubtitle}>
                      We detected multiple questions. Tap the one you want to solve:
                    </Text>
                  </View>
                  
                  <ScrollView style={styles.problemsScroll} contentContainerStyle={styles.problemsScrollContent}>
                    {extractedProblems.map((prob, idx) => (
                      <TouchableOpacity 
                        key={prob.id || idx.toString()} 
                        style={styles.problemCard}
                        onPress={() => handleProblemPress(prob)}
                      >
                        <View style={styles.problemCardHeader}>
                          <Text style={styles.problemNumber}>Question {idx + 1}</Text>
                          {prob.confidence !== undefined && (
                            <Text style={styles.problemConfidence}>
                              {Math.round(prob.confidence * 100)}% Match
                            </Text>
                          )}
                        </View>
                        <Text style={styles.problemText}>{prob.display || (prob as any).text}</Text>
                        {typeof prob.confidence === 'number' && prob.confidence < 0.6 && (
                          <Text style={styles.confidenceWarning}>unclear - tap to edit before solving</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {editingProblem && (
                    <View style={styles.editProblemPanel}>
                      <Text style={styles.editProblemTitle}>Edit before solving</Text>
                      <TextInput
                        value={editedProblemText}
                        onChangeText={setEditedProblemText}
                        multiline
                        style={styles.editProblemInput}
                        placeholder="Correct the problem text"
                        placeholderTextColor="rgba(226,232,240,0.45)"
                      />
                      <View style={styles.editProblemActions}>
                        <TouchableOpacity
                          style={styles.editCancelButton}
                          onPress={() => {
                            setEditingProblem(null);
                            setEditedProblemText('');
                          }}
                        >
                          <Text style={styles.editCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.editSolveButton}
                          onPress={() => submitExtractedProblem(editedProblemText)}
                        >
                          <Text style={styles.editSolveText}>Solve</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  
                  <TouchableOpacity 
                    style={styles.cancelOverlayBtn} 
                    onPress={() => setExtractedProblems([])}
                  >
                    <Text style={styles.cancelOverlayBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {isProcessing && (
          <Animated.View style={[styles.processingOverlay, processingStyle]} pointerEvents="auto">
            <LinearGradient
              colors={['rgba(15, 23, 42, 0.95)', 'rgba(2, 6, 23, 0.95)']}
              style={styles.processingContainer}
            >
              <Zap size={60} color="#0EA5E9" />
              <Text style={styles.processingTitle}>AI Processing</Text>
              <Text style={styles.processingStep}>{processingStep}</Text>
              
              <Animated.View style={successStyle}>
                {processingStep.includes('success') && (
                  <View style={styles.successIndicator}>
                    <CheckCircle size={24} color={'#10B981'} />
                    <Text style={styles.successText}>Text Extracted!</Text>
                  </View>
                )}
              </Animated.View>
            </LinearGradient>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0F172A',
  },
  permissionCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    borderRadius: 28,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  permissionTitle: {
    marginTop: 14,
    fontSize: 20,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    textAlign: 'center',
  },
  permissionText: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    lineHeight: 20,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 20,
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  permissionButtonText: {
    fontSize: 15,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  permissionGalleryButton: {
    marginTop: 10,
    width: '100%',
    minHeight: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E6FFFB',
  },
  permissionGalleryText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  permissionCloseButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  permissionCloseText: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  camera: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 150,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  headerButton: {
    borderRadius: 22,
  },
  headerButtonBackground: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  scanOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  scanFrame: {
    width: width - 80,
    height: (width - 80) * 1.2,
    position: 'relative',
  },
  scanCorners: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#0EA5E9',
    borderWidth: 3,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
  },
  scanLineGradient: {
    flex: 1,
    borderRadius: 2,
  },
  scanInstructions: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 32,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
    paddingTop: 24,
  },
  captureButton: {
    borderRadius: 40,
  },
  captureButtonGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  galleryButton: {
    alignItems: 'center',
    gap: 6,
  },
  flipButton: {
    alignItems: 'center',
    gap: 6,
  },
  controlButtonText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#F8FAFC',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  previewImage: {
    flex: 1,
    resizeMode: 'contain',
  },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 24,
    backgroundColor: '#1E293B',
  },
  retakeButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  retakeButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  processButton: {
    borderRadius: 16,
  },
  processButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 8,
    borderRadius: 12,
  },
  processButtonText: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingContainer: {
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    margin: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  processingTitle: {
    fontSize: 20,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    marginTop: 16,
  },
  processingStep: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
  },
  successIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  successText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#10B981',
  },
  problemsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  problemsContainer: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  problemsHeader: {
    marginBottom: 16,
  },
  problemsTitle: {
    fontSize: 22,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  problemsSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    lineHeight: 20,
  },
  problemsScroll: {
    marginBottom: 16,
  },
  problemsScrollContent: {
    gap: 12,
  },
  problemCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  problemCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  problemNumber: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0EA5E9',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  problemConfidence: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  problemText: {
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    color: '#F8FAFC',
    lineHeight: 22,
  },
  confidenceWarning: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#FBBF24',
  },
  editProblemPanel: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.35)',
  },
  editProblemTitle: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  editProblemInput: {
    minHeight: 86,
    maxHeight: 140,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    color: '#F8FAFC',
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  editProblemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  editCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  editCancelText: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#CBD5E1',
  },
  editSolveButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00D4C7',
  },
  editSolveText: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#062B2B',
  },
  cancelOverlayBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelOverlayBtnText: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#94A3B8',
  },
});
