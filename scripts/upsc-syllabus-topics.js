/**
 * Canonical UPSC subject + topic taxonomy for PYQ tagging.
 *
 * The `topic` values are the OFFICIAL UPSC syllabus item names (prelims broad
 * areas + the detailed Mains GS I-IV enumeration — see
 * supabase/functions/miga_stream/syllabus.ts). Topics are constrained to this
 * fixed list so analytics counts never fragment across synonyms and every topic
 * traces back to a real syllabus entry.
 *
 * subject  = one of SUBJECTS (fixed).
 * topic    = one of TOPICS_BY_SUBJECT[subject] (must belong to the chosen subject).
 */

const SUBJECTS = [
  'Polity', 'History', 'Art & Culture', 'Geography', 'Economy',
  'Science & Technology', 'Environment', 'Current Affairs',
];

// Topic names taken from the official syllabus (GS-I..IV enumeration + prelims areas).
const TOPICS_BY_SUBJECT = {
  Polity: [
    'Indian Constitution',
    'Fundamental Rights, DPSP & Duties',
    'Union & State Executive',
    'Parliament & State Legislatures',
    'Judiciary',
    'Federalism & Centre-State Relations',
    'Constitutional & Statutory Bodies',
    'Elections & Representation of Peoples Act',
    'Local Government & Panchayati Raj',
    'Citizenship',
    'Government Policies & Governance',
    'Rights Issues & Social Justice',
    'International Relations',
  ],
  History: [
    'Ancient India',
    'Medieval India',
    'Modern Indian History',
    'Indian National Movement',
    'Post-Independence Consolidation',
    'World History',
  ],
  'Art & Culture': [
    'Indian Art & Architecture',
    'Indian Literature',
    'Performing Arts & Culture',
  ],
  Geography: [
    'Indian Physical Geography',
    'World Physical Geography',
    'Economic Geography & Resources',
    'Human Geography & Population',
    'Geophysical Phenomena',
  ],
  Economy: [
    'Indian Economy & Planning',
    'Government Budgeting & Fiscal Policy',
    'Monetary Policy & Banking',
    'Agriculture & Food Security',
    'Industry & Infrastructure',
    'External Sector & Trade',
    'Inclusive Growth & Employment',
  ],
  'Science & Technology': [
    'General Science (Physics & Chemistry)',
    'Biology & Health',
    'Space & Defence Technology',
    'IT, Computers & Communications',
    'Biotechnology',
    'Intellectual Property Rights',
  ],
  Environment: [
    'Biodiversity & Conservation',
    'Environmental Pollution & Degradation',
    'Climate Change',
    'Environmental Governance & Agreements',
  ],
  'Current Affairs': [
    'National Current Affairs',
    'International Current Affairs',
    'Government Schemes',
    'Sports, Awards & Events',
    'Economic Current Affairs',
  ],
};

const ALL_TOPICS = new Set();
for (const s of SUBJECTS) for (const t of (TOPICS_BY_SUBJECT[s] || [])) ALL_TOPICS.add(t);

module.exports = { SUBJECTS, TOPICS_BY_SUBJECT, ALL_TOPICS };
