export type PrimaryExam = 'upsc' | 'tnpsc' | 'ssc' | 'rrb' | 'neet' | 'jee' | 'banking' | 'other' | null;
export type PrimaryCurriculum = 'ncert' | 'samacheer' | null;

export type StudyContextSelection = {
  primaryExam: PrimaryExam;
  primaryCurriculum: PrimaryCurriculum;
};

/**
 * Maps an explicit onboarding choice to the routing data MIGA needs. This is
 * deliberately separate from the Daily Mission track: a school curriculum is
 * not automatically an exam.
 */
export function studyContextForOnboardingTrack(track: string): StudyContextSelection {
  switch (track) {
    case 'tnpsc_ecosystem':
      return { primaryExam: 'tnpsc', primaryCurriculum: 'samacheer' };
    case 'samacheer_ecosystem':
      return { primaryExam: null, primaryCurriculum: 'samacheer' };
    case 'upsc_ecosystem':
      return { primaryExam: 'upsc', primaryCurriculum: 'ncert' };
    case 'ncert_ecosystem':
      return { primaryExam: null, primaryCurriculum: 'ncert' };
    case 'ssc_ecosystem':
      return { primaryExam: 'ssc', primaryCurriculum: 'ncert' };
    case 'rrb_ecosystem':
      return { primaryExam: 'rrb', primaryCurriculum: 'ncert' };
    case 'neet_ecosystem':
      return { primaryExam: 'neet', primaryCurriculum: 'ncert' };
    case 'jee_ecosystem':
      return { primaryExam: 'jee', primaryCurriculum: 'ncert' };
    case 'banking_ecosystem':
      return { primaryExam: 'banking', primaryCurriculum: 'ncert' };
    case 'other':
    default:
      return { primaryExam: 'other', primaryCurriculum: 'ncert' };
  }
}

export function practiceExamIdForStudyContext(primaryExam?: string | null) {
  switch (String(primaryExam || '').toLowerCase()) {
    case 'tnpsc': return 'tnpsc';
    case 'ssc': return 'ssc';
    case 'rrb': return 'rrb';
    case 'upsc': return 'upsc';
    default: return 'upsc';
  }
}
