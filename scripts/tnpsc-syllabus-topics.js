/**
 * Canonical TNPSC subject + topic taxonomy for PYQ tagging.
 *
 * subjects = the official TNPSC prelims syllabus units (see
 * supabase/functions/miga_stream/syllabus.ts — Group I/II/IV). topics are
 * sub-items drawn from those unit descriptions, so counts never fragment and
 * every topic traces to a real syllabus entry.
 */

const SUBJECTS = [
  'General Science', 'Geography', 'History & Culture', 'Indian Polity',
  'Indian Economy', 'Tamil Nadu Specific', 'Aptitude & Reasoning', 'Current Affairs',
];

const TOPICS_BY_SUBJECT = {
  'General Science': [
    'Physics', 'Chemistry', 'Botany', 'Zoology',
    'Health & Human Physiology', 'Environment & Ecology', 'Scientific Inventions',
  ],
  Geography: [
    'Physical Geography of India', 'Climate & Monsoon', 'Rivers & Water Resources',
    'Soil, Minerals & Natural Resources', 'Agriculture', 'Population & Transport',
    'Disaster Management', 'World Geography',
  ],
  'History & Culture': [
    'Ancient India & Indus Valley', 'Delhi Sultanate & Mughals', 'South Indian History',
    'Indian National Movement', 'National Leaders', 'Indian Culture & Heritage',
  ],
  'Indian Polity': [
    'Constitution & Preamble', 'Fundamental Rights & Duties', 'Union & State Government',
    'Local Government & Panchayat Raj', 'Judiciary', 'Elections',
    'Rights Bodies, RTI & Governance',
  ],
  'Indian Economy': [
    'National Economy & Planning', 'Banking & Monetary Policy', 'Fiscal Policy & Taxation',
    'Agriculture & Rural Development', 'Industry & Employment', 'Welfare Schemes',
  ],
  'Tamil Nadu Specific': [
    'Tamil Society & Sangam Literature', 'Tamil Nadu in Freedom Struggle',
    'Dravidian & Self-Respect Movement', 'Tamil Nadu Economy & Development',
    'Tamil Nadu Culture & Heritage',
  ],
  'Aptitude & Reasoning': [
    'Arithmetic & Numerical Ability', 'Logical Reasoning',
    'Data Interpretation', 'Series & Puzzles',
  ],
  'Current Affairs': [
    'National Current Affairs', 'Tamil Nadu Current Affairs', 'International Current Affairs',
    'Sports, Awards & Persons in News', 'Government Schemes',
  ],
};

const ALL_TOPICS = new Set();
for (const s of SUBJECTS) for (const t of (TOPICS_BY_SUBJECT[s] || [])) ALL_TOPICS.add(t);

module.exports = { SUBJECTS, TOPICS_BY_SUBJECT, ALL_TOPICS };
