import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type MascotBackdropProps = {
  compact?: boolean;
  showRings?: boolean;
  variant?: 'normal' | 'flag';
};

export default function MascotBackdrop({ compact = false, showRings = true, variant = 'normal' }: MascotBackdropProps) {
  const ringSize = compact ? Math.min(SCREEN_WIDTH * 0.78, 344) : Math.min(SCREEN_WIDTH * 0.86, 392);
  const showFlagMedallion = variant === 'flag';

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#F8FAFC', '#FFFFFF', '#F4FBF6']} style={StyleSheet.absoluteFill} />
      <View style={styles.cleanTopWash} />
      <View style={styles.cleanBottomWash} />
      {showFlagMedallion && <View style={styles.flagMedallionShadow} />}
      {showFlagMedallion && (
        <View style={styles.flagSplitWrap}>
          <View style={[styles.flagHalf, styles.flagHalfLeft]}>
            <View style={styles.flagBandSaffron} />
            <View style={styles.flagBandWhite} />
            <View style={styles.flagBandGreen} />
          </View>
          <View style={[styles.flagHalf, styles.flagHalfRight]}>
            <View style={styles.flagBandSaffron} />
            <View style={styles.flagBandWhite} />
            <View style={styles.flagBandGreen} />
          </View>
          <View style={styles.chakra}>
            {Array.from({ length: 12 }).map((_, i) => (
              <View
                key={`chakra-${i}`}
                style={[styles.chakraSpoke, { transform: [{ rotate: `${i * 15}deg` }] }]}
              />
            ))}
            <View style={styles.chakraHub} />
          </View>
        </View>
      )}
      {showRings && <View style={[styles.cleanRing, { width: ringSize, height: ringSize, borderRadius: ringSize / 2 }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  cleanTopWash: {
    position: 'absolute',
    top: -SCREEN_WIDTH * 0.42,
    alignSelf: 'center',
    width: SCREEN_WIDTH * 1.15,
    height: SCREEN_WIDTH * 1.15,
    borderRadius: SCREEN_WIDTH * 0.575,
    backgroundColor: 'rgba(255, 153, 51, 0.1)',
  },
  cleanBottomWash: {
    position: 'absolute',
    bottom: -SCREEN_WIDTH * 0.36,
    alignSelf: 'center',
    width: SCREEN_WIDTH * 1.22,
    height: SCREEN_WIDTH * 1.22,
    borderRadius: SCREEN_WIDTH * 0.61,
    backgroundColor: 'rgba(19, 136, 8, 0.08)',
  },
  cleanRing: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.07,
    width: Math.min(SCREEN_WIDTH * 0.78, 360),
    height: Math.min(SCREEN_WIDTH * 0.78, 360),
    borderRadius: Math.min(SCREEN_WIDTH * 0.39, 180),
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    transform: [{ translateY: 14 }, { scale: 0.98 }],
  },
  flagMedallionShadow: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.07,
    width: Math.min(SCREEN_WIDTH * 0.78, 360),
    height: Math.min(SCREEN_WIDTH * 0.78, 360),
    borderRadius: Math.min(SCREEN_WIDTH * 0.39, 180),
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    transform: [{ translateY: 14 }, { scale: 0.98 }],
  },
  flagSplitWrap: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.07,
    alignSelf: 'center',
    width: Math.min(SCREEN_WIDTH * 0.82, 378),
    height: Math.min(SCREEN_WIDTH * 0.82, 378),
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 8,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    borderRadius: 189,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  flagHalf: {
    width: '50%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  flagHalfLeft: {
    borderTopLeftRadius: 180,
    borderBottomLeftRadius: 180,
  },
  flagHalfRight: {
    borderTopRightRadius: 180,
    borderBottomRightRadius: 180,
  },
  flagBandSaffron: {
    flex: 1,
    backgroundColor: '#FF9933',
  },
  flagBandWhite: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flagBandGreen: {
    flex: 1,
    backgroundColor: '#138808',
  },
  chakra: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#000080',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chakraSpoke: {
    position: 'absolute',
    width: 1,
    height: 38,
    backgroundColor: '#000080',
  },
  chakraHub: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#000080',
  },
});
