// Authored civics lessons for "Know Your India" — exam-aligned (UPSC/TNPSC/SSC polity).
// Kept concise and accurate. Surfaced via the Civics button on the globe screen.
export type CivicsLesson = {
  id: string;
  title: string;
  icon: string;
  color: string;
  blurb: string;
  sections: { head: string; body: string }[];
};

export const CIVICS_LESSONS: CivicsLesson[] = [
  {
    id: 'how-india-governed',
    title: 'How India is Governed',
    icon: 'business',
    color: '#4F46E5',
    blurb: 'The three tiers of government & separation of powers.',
    sections: [
      { head: 'Three tiers', body: 'India is governed at three levels: the UNION (central) government in New Delhi, the STATE governments, and LOCAL self-government (panchayats in villages, municipalities in cities). Each has its own elected bodies and defined powers.' },
      { head: 'Three organs', body: 'Power is split across the LEGISLATURE (makes laws — Parliament / Assemblies), the EXECUTIVE (implements laws — PM/CM & ministers), and the JUDICIARY (interprets laws — Supreme Court, High Courts). This "separation of powers" stops any one organ from becoming too strong.' },
      { head: 'Who does what', body: 'The Union List (e.g. defence, foreign affairs), State List (e.g. police, health) and Concurrent List (e.g. education) in the 7th Schedule divide subjects between Centre and States — this is India\'s federal structure.' },
    ],
  },
  {
    id: 'mp-mla-ward',
    title: 'MP vs MLA vs Ward Member',
    icon: 'people',
    color: '#0EA5E9',
    blurb: 'Who represents you, and at which level.',
    sections: [
      { head: 'Your MP', body: 'A Member of Parliament represents your Lok Sabha constituency in the NATIONAL Parliament (543 seats). MPs make national laws, approve the Union Budget, and question the central government.' },
      { head: 'Your MLA', body: 'A Member of the Legislative Assembly represents a smaller ASSEMBLY constituency in your STATE Assembly (Vidhan Sabha). MLAs handle state subjects — police, roads, schools, health — and choose the Chief Minister.' },
      { head: 'Your Ward Member / Sarpanch', body: 'At the LOCAL level you elect ward members and a panchayat president (sarpanch) or municipal councillor. They run day-to-day local services: water, sanitation, streetlights, local roads.' },
      { head: 'You elect all three', body: 'One citizen, three votes across different elections — Lok Sabha, Assembly, and local body. Each tier solves different problems closest to where the issue lives.' },
    ],
  },
  {
    id: 'amendment-73-74',
    title: '73rd & 74th Amendments',
    icon: 'home',
    color: '#10B981',
    blurb: 'How local self-government got constitutional power.',
    sections: [
      { head: 'The big idea (1992)', body: 'The 73rd Amendment gave constitutional status to PANCHAYATS (rural), and the 74th to MUNICIPALITIES (urban). Local government became a real third tier — not a favour, but a right.' },
      { head: 'Guaranteed elections', body: 'Both mandate elections every 5 years, conducted by a State Election Commission, so local bodies can\'t be left vacant or run by appointees.' },
      { head: 'Reservation', body: 'At least one-third of seats (now often 50% in many states) are reserved for WOMEN, plus seats for SCs & STs in proportion to population — making local politics genuinely representative.' },
      { head: 'The Gram Sabha', body: 'The Gram Sabha — the assembly of ALL adult voters in a village — is the real power-holder. It approves plans and budgets and holds the panchayat accountable. Direct democracy, in your village.' },
      { head: '11th & 12th Schedules', body: 'The 11th Schedule lists 29 subjects for panchayats and the 12th lists 18 for municipalities — water, sanitation, roads, health, schools, and more.' },
    ],
  },
  {
    id: 'bill-to-law',
    title: 'How a Bill Becomes Law',
    icon: 'document-text',
    color: '#7C5CFC',
    blurb: 'The journey from idea to Act of Parliament.',
    sections: [
      { head: 'Introduction', body: 'A proposed law is a BILL. It is introduced in either House (Lok Sabha or Rajya Sabha). Money Bills can only start in the Lok Sabha.' },
      { head: 'Three readings', body: 'Each House debates the bill in three "readings" — introduction, clause-by-clause scrutiny (often via committees), and final vote. Both Houses must pass it.' },
      { head: "President's assent", body: 'After both Houses pass it, the bill goes to the President. Once the President signs, it becomes an ACT (law). The President can return a non-Money Bill once for reconsideration.' },
      { head: 'Why it matters', body: 'This careful process — debate, committees, two Houses, assent — is designed so laws are scrutinised, not rushed. Your MP\'s job is to take part in exactly this.' },
    ],
  },
  {
    id: 'fundamental-rights',
    title: 'Your Fundamental Rights',
    icon: 'shield-checkmark',
    color: '#059669',
    blurb: 'The six rights every Indian holds (Articles 12–35).',
    sections: [
      { head: 'Right to Equality (14–18)', body: 'Equality before the law, no discrimination on religion, race, caste, sex or birthplace, equal opportunity in public jobs, abolition of untouchability and titles.' },
      { head: 'Right to Freedom (19–22)', body: 'Freedom of speech, assembly, movement, residence and profession — plus protection of life and personal liberty (Article 21) and safeguards on arrest.' },
      { head: 'Against Exploitation (23–24)', body: 'Bans human trafficking, forced labour, and employment of children below 14 in hazardous work.' },
      { head: 'Freedom of Religion (25–28)', body: 'Freedom to practise, profess and propagate any religion, and to manage religious affairs.' },
      { head: 'Cultural & Educational (29–30)', body: 'Protects the language, script and culture of minorities and their right to run educational institutions.' },
      { head: 'Right to Constitutional Remedies (32)', body: 'Dr. Ambedkar called Article 32 the "heart and soul" of the Constitution — you can go directly to the Supreme Court if a fundamental right is violated.' },
    ],
  },
  {
    id: 'how-to-vote',
    title: 'How to Vote',
    icon: 'finger-print',
    color: '#D97706',
    blurb: 'From registering to pressing the button.',
    sections: [
      { head: 'Who can vote', body: 'Any Indian citizen aged 18 or above on the qualifying date can vote — one of the youngest voting ages set by the 61st Amendment (1989), which lowered it from 21 to 18.' },
      { head: 'Register first', body: 'You must be on the electoral roll. Register free via Form 6 on voters.eci.gov.in or the Voter Helpline app, and you\'ll get a Voter ID (EPIC).' },
      { head: 'On polling day', body: 'Find your booth, verify your name, get your finger inked, and vote on the EVM. The VVPAT slip lets you confirm your vote was recorded correctly.' },
      { head: 'NOTA', body: 'If you reject all candidates, you can press NOTA ("None Of The Above") — your right to register dissent while still showing up.' },
      { head: 'Why your vote matters', body: 'Many seats are won by a few thousand votes. One vote rarely decides alone — but voting blocks, turnout, and accountability absolutely do. Democracy is a habit, not a one-time act.' },
    ],
  },
];
