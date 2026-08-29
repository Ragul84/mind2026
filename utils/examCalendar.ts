/**
 * examCalendar.ts — curated official / tentative exam dates per exam & branch.
 *
 * There is no official public API for Indian exam dates; commissions publish
 * annual planners / calendars (PDFs & notifications). So we maintain a curated
 * calendar here (verified against the 2026 official planners) and let the user
 * pick their specific exam + branch. Dates marked `tentative` come from a
 * window/planner and can shift — the UI says so. Update this file each cycle.
 *
 * Sources (Aug 2026): TNPSC Annual Planner 2026, SSC Calendar 2026-27, UPSC
 * Calendar 2026.
 */

export interface ExamBranch {
  id: string;
  label: string;
  /** ISO YYYY-MM-DD. Omit if not yet announced. */
  date?: string;
  /** True when the date is from a window/planner and may shift. */
  tentative?: boolean;
}

export interface ExamDef {
  id: string;
  name: string;
  icon: string;   // FontAwesome5
  color: string;
  branches: ExamBranch[];
}

export const EXAM_CALENDAR: ExamDef[] = [
  {
    id: 'upsc', name: 'UPSC Civil Services', icon: 'landmark', color: '#2563EB',
    branches: [
      { id: 'prelims', label: 'CSE Prelims', date: '2026-05-24' },
      { id: 'mains', label: 'CSE Mains', date: '2026-08-21' },
    ],
  },
  {
    id: 'tnpsc', name: 'TNPSC', icon: 'graduation-cap', color: '#0F766E',
    branches: [
      { id: 'group1', label: 'Group I Prelims', date: '2026-09-27' },
      { id: 'group2', label: 'Group II / IIA', date: '2026-10-25' },
      { id: 'group4', label: 'Group IV / VAO', date: '2026-12-20' },
    ],
  },
  {
    id: 'ssc', name: 'SSC', icon: 'file-signature', color: '#D97706',
    branches: [
      { id: 'cgl', label: 'CGL Tier-1', date: '2026-06-01', tentative: true },
      { id: 'chsl', label: 'CHSL Tier-1', date: '2026-07-15', tentative: true },
      { id: 'mts', label: 'MTS', date: '2026-10-01', tentative: true },
      { id: 'cpo', label: 'CPO / SI', date: '2026-10-15', tentative: true },
      { id: 'gd', label: 'GD Constable', date: '2027-01-15', tentative: true },
    ],
  },
  {
    id: 'rrb', name: 'RRB / Railway', icon: 'train', color: '#F43F5E',
    branches: [
      { id: 'ntpc', label: 'NTPC CBT', tentative: true },
      { id: 'groupd', label: 'Group D', tentative: true },
    ],
  },
  {
    id: 'banking', name: 'Banking (IBPS / SBI)', icon: 'university', color: '#7C3AED',
    branches: [
      { id: 'ibps-po', label: 'IBPS PO', tentative: true },
      { id: 'ibps-clerk', label: 'IBPS Clerk', tentative: true },
    ],
  },
];

export function getExam(examId?: string): ExamDef | undefined {
  return EXAM_CALENDAR.find((e) => e.id === examId);
}
export function getBranch(examId?: string, branchId?: string): ExamBranch | undefined {
  return getExam(examId)?.branches.find((b) => b.id === branchId);
}

/** Whole days from today (IST-ish, local midnight) until the date, or null. */
export function daysUntil(dateISO?: string): number | null {
  if (!dateISO) return null;
  const target = new Date(dateISO + 'T00:00:00');
  const now = new Date();
  const ms = target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}
