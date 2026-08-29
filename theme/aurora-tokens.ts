// Aurora — MindGains 2026 design language
// Material 3 Expressive–inspired tokens: content-first, calm light surfaces,
// an indigo → royal blue → cyan "intelligence" spectrum, soft ambient depth,
// typography-led hierarchy. Screens should consume these tokens instead of
// hard-coding colors so the language can roll out app-wide consistently.

export const Aurora = {
  color: {
    // Brand spectrum
    indigo: '#4F46E5',
    royal: '#2563EB',
    electric: '#3B82F6',
    cyan: '#06B6D4',
    violet: '#7C5CFC',
    emerald: '#059669',
    amber: '#D97706',
    rose: '#E11D48',

    // Surfaces (light)
    background: '#F7F9FE',
    surface: '#FFFFFF',
    surfaceTint: '#EEF2FF', // indigo-tinted tonal surface (selected states)
    surfaceSunken: '#F1F4FB',

    // Ink — deep navy instead of pure black for a calmer page
    ink: '#171A2C',
    inkSecondary: '#475069',
    inkMuted: '#6B7390', // captions/overlines only (12px+ semibold)

    onPrimary: '#FFFFFF',
    scrim: 'rgba(17, 20, 40, 0.45)',
    hairline: '#E6EAF4',
  },

  gradient: {
    // Primary action — "liquid intelligence" sweep
    intelligence: ['#4F46E5', '#2563EB', '#06B6D4'] as const,
    // Page wash — soft indigo-tinted light; stays gently tinted so white
    // surfaces read without needing shadows or borders
    canvas: ['#EEF3FE', '#F3F6FD', '#F4F7FE'] as const,
    // Accent surface — focus/recommendation moments
    focus: ['#7C5CFC', '#4F46E5'] as const,
  },

  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },

  radius: { sm: 14, md: 20, lg: 28, xl: 36, full: 999 },

  type: {
    // Hero content (verses, headlines). Poppins ≈ friendly geometric display.
    display: { fontFamily: 'Poppins-SemiBold', fontSize: 26, lineHeight: 38, letterSpacing: -0.3, color: '#171A2C' },
    title: { fontFamily: 'Poppins-SemiBold', fontSize: 18, lineHeight: 26, color: '#171A2C' },
    section: { fontFamily: 'Poppins-SemiBold', fontSize: 15, lineHeight: 22, color: '#171A2C' },
    body: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 24, color: '#475069' },
    label: { fontFamily: 'Inter-SemiBold', fontSize: 13, lineHeight: 18, color: '#475069' },
    overline: { fontFamily: 'Inter-SemiBold', fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' as const, color: '#6B7390' },
  },

  // No box shadows anywhere — depth comes from tonal surface contrast only.
  motion: {
    spring: {
      standard: { tension: 220, friction: 24 },
      gentle: { tension: 60, friction: 10 },
    },
    duration: { fast: 150, normal: 280, slow: 480, ambient: 6000 },
  },
};

export type AuroraTokens = typeof Aurora;
