// OFFICIAL exam syllabus — the mentor-AI's ground truth.
//
// MIGA must know the REAL, latest official syllabus of each exam, not a
// model-invented one. Every syllabus / coverage / weightage / topic-priority
// answer is grounded on the text below. Content is transcribed from the official
// notifications: UPSC CSE (prelims broad areas + the detailed Mains GS I-IV
// enumeration), and TNPSC Group 1 (Code 497, 16.12.2024), Group 2/2A (Code 495)
// and Group 4 (Code 496, 12.12.2024) — with the official per-unit question
// weightage TNPSC publishes. Update this file when a board revises its syllabus.

export type SyllabusDoc = {
  id: string;
  exam: string;
  paper: string;
  title: string;
  source: string;
  effectiveDate: string;
  weightage?: Record<string, number>;
  text: string;
};

export const SYLLABI: SyllabusDoc[] = [
  {
    id: "upsc-prelims-gs", exam: "UPSC", paper: "prelims-gs",
    title: "UPSC Civil Services Prelims — General Studies Paper I",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "General Studies Paper I (200 marks). Official broad areas:",
      "1. Current events of national and international importance.",
      "2. History of India and Indian National Movement.",
      "3. Indian and World Geography — Physical, Social, Economic Geography of India and the World.",
      "4. Indian Polity and Governance — Constitution, Political System, Panchayati Raj, Public Policy, Rights Issues, etc.",
      "5. Economic and Social Development — Sustainable Development, Poverty, Inclusion, Demographics, Social Sector initiatives, etc.",
      "6. General issues on Environmental Ecology, Bio-diversity and Climate Change — not requiring subject specialisation.",
      "7. General Science.",
      "UPSC keeps prelims topics deliberately broad; detailed sub-topics come from the Mains GS papers.",
    ].join("\n"),
  },
  {
    id: "upsc-csat", exam: "UPSC", paper: "csat",
    title: "UPSC Civil Services Prelims — CSAT (General Studies Paper II)",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "General Studies Paper II — CSAT (200 marks; qualifying, minimum 33%). Official areas:",
      "1. Comprehension. 2. Interpersonal skills including communication skills.",
      "3. Logical reasoning and analytical ability. 4. Decision-making and problem-solving.",
      "5. General mental ability. 6. Basic numeracy (Class X level).",
      "7. Data interpretation — charts, graphs, tables, data sufficiency (Class X level).",
    ].join("\n"),
  },
  {
    id: "upsc-mains-gs1", exam: "UPSC", paper: "mains-gs1",
    title: "UPSC Mains GS-I — Indian Heritage & Culture, History & Geography of the World & Society",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "Indian culture — Art Forms, Literature and Architecture from ancient to modern times.",
      "Modern Indian history (mid-18th century to present) — events, personalities, issues.",
      "The Freedom Struggle — its stages and contributors from across the country.",
      "Post-independence consolidation and reorganization within the country.",
      "History of the world — industrial revolution, world wars, colonization/decolonization, political philosophies (communism, capitalism, socialism) and their effect on society.",
      "Salient features of Indian Society; diversity of India.",
      "Role of women and women's organizations; population issues; poverty and developmental issues; urbanization.",
      "Effects of globalization on Indian society; social empowerment, communalism, regionalism, secularism.",
      "Salient features of world's physical geography.",
      "Distribution of key natural resources; factors for location of primary, secondary and tertiary industries.",
      "Important geophysical phenomena — earthquakes, tsunami, volcanoes, cyclones; changes in critical geographical features and in flora and fauna.",
    ].join("\n"),
  },
  {
    id: "upsc-mains-gs2", exam: "UPSC", paper: "mains-gs2",
    title: "UPSC Mains GS-II — Governance, Constitution, Polity, Social Justice & International Relations",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "Indian Constitution — historical underpinnings, evolution, features, amendments, significant provisions, basic structure.",
      "Union and States — functions, responsibilities, federal structure, devolution of powers and finances to local levels and challenges.",
      "Separation of powers between organs; dispute redressal mechanisms and institutions.",
      "Comparison of the Indian constitutional scheme with other countries.",
      "Parliament and State Legislatures — structure, functioning, conduct of business, powers & privileges.",
      "Structure, organization and functioning of the Executive and the Judiciary; pressure groups and associations.",
      "Salient features of the Representation of People's Act.",
      "Appointment to Constitutional posts; powers, functions and responsibilities of Constitutional Bodies; statutory, regulatory and quasi-judicial bodies.",
      "Government policies and interventions for development in various sectors; issues in design and implementation.",
      "Development processes — role of NGOs, SHGs, groups, donors, charities, institutional stakeholders.",
      "Welfare schemes for vulnerable sections; mechanisms, laws, institutions for protection of vulnerable sections.",
      "Social sector/services — Health, Education, Human Resources; issues relating to poverty and hunger.",
      "Governance, transparency and accountability; e-governance; citizens charters; role of civil services.",
      "India and its neighbourhood; bilateral, regional and global groupings; effect of policies of developed & developing countries; Indian diaspora; important international institutions.",
    ].join("\n"),
  },
  {
    id: "upsc-mains-gs3", exam: "UPSC", paper: "mains-gs3",
    title: "UPSC Mains GS-III — Technology, Economic Development, Environment, Security & Disaster Management",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "Indian Economy — planning, mobilization of resources, growth, development and employment.",
      "Inclusive growth and issues arising from it; Government Budgeting.",
      "Agriculture — major crops & cropping patterns; irrigation; storage, transport and marketing of produce; e-technology for farmers.",
      "Direct & indirect farm subsidies and minimum support prices; PDS; buffer stocks and food security; technology missions; animal-rearing economics.",
      "Food processing industries — scope, location, supply chain management. Land reforms in India.",
      "Effects of liberalization; changes in industrial policy and their effects on industrial growth.",
      "Infrastructure — Energy, Ports, Roads, Airports, Railways; investment models.",
      "Science and Technology — developments and applications; achievements of Indians; indigenization of technology.",
      "Awareness in IT, Space, Computers, robotics, nano-technology, bio-technology; intellectual property rights.",
      "Conservation, environmental pollution and degradation, environmental impact assessment. Disaster and disaster management.",
      "Linkages between development and spread of extremism; role of external state and non-state actors in internal security.",
      "Internal security challenges through communication networks, media and social networking; basics of cyber security; money-laundering.",
      "Border-area security challenges; linkages of organized crime with terrorism; security forces and agencies and their mandate.",
    ].join("\n"),
  },
  {
    id: "upsc-mains-gs4", exam: "UPSC", paper: "mains-gs4",
    title: "UPSC Mains GS-IV — Ethics, Integrity and Aptitude",
    source: "UPSC CSE notification (official)", effectiveDate: "2024",
    text: [
      "Ethics and Human Interface — essence, determinants and consequences of ethics; dimensions of ethics; ethics in private and public relationships; human values; role of family, society and educational institutions.",
      "Attitude — content, structure, function; influence on thought and behaviour; moral and political attitudes; social influence and persuasion.",
      "Aptitude and foundational values for Civil Service — integrity, impartiality, non-partisanship, objectivity, dedication to public service, empathy, tolerance, compassion.",
      "Emotional intelligence — concepts and applications in administration and governance.",
      "Contributions of moral thinkers and philosophers from India and the world.",
      "Public/Civil service values and Ethics in Public administration — ethical concerns and dilemmas; accountability and ethical governance; corporate governance.",
      "Probity in Governance — public service concept; transparency, RTI, Codes of Ethics/Conduct, Citizen's Charters, challenges of corruption. Case studies.",
    ].join("\n"),
  },
  {
    id: "tnpsc-group-1", exam: "TNPSC", paper: "group-1",
    title: "TNPSC Group I — Preliminary Examination (Degree Standard, 200 Questions)",
    source: "TNPSC official notification (Code 497, 16.12.2024)", effectiveDate: "2024-12-16",
    weightage: {
      "General Science": 10, "Geography of India": 10,
      "History, Culture & Indian National Movement": 25, "Indian Polity": 40,
      "Indian Economy & Development Administration in Tamil Nadu": 50,
      "History, Culture, Heritage & Socio-Political Movements of Tamil Nadu": 40,
      Aptitude: 15, Reasoning: 10,
    },
    text: [
      "Single paper: General Studies (Degree Standard — 175 Q) + Aptitude & Mental Ability (SSLC Standard — 25 Q). Official per-unit weightage below.",
      "PART A — GENERAL STUDIES (175 Q):",
      "Unit I: General Science (10 Q) — scientific temper; nature of universe; general scientific laws; mechanics; properties of matter; electricity & magnetism, light, sound, heat, nuclear physics, laser, electronics, communications; elements & compounds, acids/bases/salts, petroleum products, fertilizers, pesticides; life science — classification, evolution, genetics, physiology, nutrition, health & hygiene, human diseases; environment & ecology; latest inventions; current affairs.",
      "Unit II: Geography of India (10 Q) — location; physical features; monsoon, climate; water resources; rivers; soil, minerals, natural resources; forest & wildlife; agricultural pattern; transport & communication; population; tribes; disaster management; environmental pollution; climate change; green energy; current affairs.",
      "Unit III: History, Culture of India & Indian National Movement (25 Q) — Indus Valley; Guptas, Delhi Sultans, Mughals, Marathas; Vijayanagaram & Bahmani; South Indian history; National Renaissance; INC; national leaders (Ambedkar, Bhagat Singh, Bharathiar, V.O.C., Nehru, Kamarajar, Gandhi, Azad, Periyar, Rajaji, Bose, Tagore); Satyagraha & militant movements; communalism & partition; Indian culture & unity in diversity; secular state; national symbols; current affairs.",
      "Unit IV: Indian Polity (40 Q) — Constitution; Preamble; salient features; Union/State/UT; citizenship, Fundamental Rights, Duties, DPSP; Union & State Executive and Legislature; local governments, Panchayat Raj; federalism & Centre-State relations; elections; judiciary; rule of law; corruption & anti-corruption; Lokpal & Lok Ayukta; RTI; empowerment of women; Consumer Protection; Human Rights; political parties; current affairs.",
      "Unit V: Indian Economy & Development Administration in Tamil Nadu (50 Q) — nature of economy; five-year plans; Planning Commission & NITI Aayog; revenue; RBI; fiscal & monetary policy; Finance Commission; Union-State resource sharing; GST; employment; land reforms & agriculture; industrial growth; rural welfare; social problems; HDI in TN; reservation policy; economic trends in TN; welfare schemes; social justice; education & health in TN; geography of TN & economic impact; e-Governance; current affairs.",
      "Unit VI: History, Culture, Heritage & Socio-Political Movements in Tamil Nadu (40 Q) — Tamil society & archaeology; Tamil literature (Sangam to contemporary); Thirukkural; role of TN in freedom struggle; role of women; Justice Party; rationalism; Self-Respect Movement; Dravidian Movement; Thanthai Periyar & Perarignar Anna.",
      "PART B — APTITUDE & MENTAL ABILITY (25 Q): Aptitude (15 Q) — simplification, percentage, HCF, LCM, ratio & proportion, simple & compound interest, area, volume, time & work. Reasoning (10 Q) — logical reasoning, puzzles, dice, visual reasoning, alpha-numeric reasoning, number series.",
    ].join("\n"),
  },
  {
    id: "tnpsc-group-2-2a", exam: "TNPSC", paper: "group-2-2a",
    title: "TNPSC Group II & IIA — Preliminary Examination (Degree Standard, 75 GS Questions)",
    source: "TNPSC official notification (Code 495)", effectiveDate: "2024",
    weightage: {
      "General Science": 5, "Geography of India": 5,
      "History, Culture & Indian National Movement": 10, "Indian Polity": 15,
      "Indian Economy & Development Administration in Tamil Nadu": 20,
      "History, Culture, Heritage & Socio-Political Movements of Tamil Nadu": 20,
      Aptitude: 15, Reasoning: 10,
    },
    text: [
      "Single paper: General Studies (Degree Standard — 75 Q) + Aptitude & Mental Ability (25 Q) + Language (General Tamil/English — 100 Q). Official per-unit weightage below for GS + aptitude.",
      "PART A — GENERAL STUDIES (75 Q):",
      "Unit I: General Science (5 Q) — as Group I but at 5 questions: scientific temper; nature of universe; scientific laws; mechanics; matter; everyday physics/chemistry; life science; environment & ecology; latest inventions; current affairs.",
      "Unit II: Geography of India (5 Q) — location, physical features, monsoon & climate, water resources, rivers, soil/minerals, forest & wildlife, agriculture, transport, population & tribes, disaster management, pollution, climate change, green energy, current affairs.",
      "Unit III: History, Culture of India & Indian National Movement (10 Q) — Indus Valley; Guptas, Delhi Sultans, Mughals, Marathas; Vijayanagaram & Bahmani; South Indian history; National Renaissance; INC; national leaders; Satyagraha & militant movements; communalism & partition; Indian culture; secular state.",
      "Unit IV: Indian Polity (15 Q) — Constitution; Preamble; salient features; Union/State/UT; citizenship, FR, FD, DPSP; Union & State Executive/Legislature; local governments, Panchayat Raj; federalism; elections; judiciary; corruption & anti-corruption; Lokpal & Lok Ayukta; RTI; women empowerment; Consumer Protection; Human Rights; political parties; current affairs.",
      "Unit V: Indian Economy & Development Administration in Tamil Nadu (20 Q) — nature of economy; five-year plans; NITI Aayog; RBI; fiscal & monetary policy; Finance Commission; GST; employment; land reforms & agriculture; industrial growth; rural welfare; social problems; HDI in TN; reservation policy; economic trends in TN; welfare schemes; education & health in TN; e-Governance; current affairs.",
      "Unit VI: History, Culture, Heritage & Socio-Political Movements in Tamil Nadu (20 Q) — Tamil society & archaeology; Tamil literature; Thirukkural; role of TN in freedom struggle; women; Justice Party; rationalism; Self-Respect Movement; Dravidian Movement; Periyar & Anna.",
      "PART B — APTITUDE & MENTAL ABILITY (25 Q): Aptitude (15 Q) and Reasoning (10 Q) — same topics as Group I.",
      "PART C — Language (General Tamil or General English, 100 Q, qualifying).",
    ].join("\n"),
  },
  {
    id: "tnpsc-group-4", exam: "TNPSC", paper: "group-4",
    title: "TNPSC Group IV — Combined Examination (SSLC Standard, 75 GS Questions)",
    source: "TNPSC official notification (Code 496, 12.12.2024)", effectiveDate: "2024-12-12",
    weightage: {
      "General Science": 5, Geography: 5,
      "History, Culture & Indian National Movement": 10, "Indian Polity": 15,
      "Indian Economy & Development Administration in Tamil Nadu": 20,
      "History, Culture, Heritage & Socio-Political Movements of Tamil Nadu": 20,
      Aptitude: 15, Reasoning: 10,
    },
    text: [
      "Single paper: General Studies (SSLC Standard — 75 Q) + Aptitude & Mental Ability (25 Q) + Tamil/English Eligibility-cum-Scoring Test (100 Q). Official per-unit weightage below for GS + aptitude.",
      "PART A — GENERAL STUDIES (75 Q):",
      "Unit I: General Science (5 Q) — nature of universe; measurement; scientific laws (motion, force, pressure, energy); everyday physics; elements & compounds, acids/bases/salts, petroleum, fertilizers, pesticides, metallurgy, food adulterants; life science; environmental science; latest inventions; current affairs.",
      "Unit II: Geography (5 Q) — earth location; physical features; monsoon & climate; water resources; rivers; soil/minerals; forest & wildlife; agriculture; transport; population of TN & India; disaster management; environment & climate change; current affairs.",
      "Unit III: History, Culture of India & Indian National Movement (10 Q) — Indus Valley; Guptas, Delhi Sultans, Mughals, Marathas; South Indian history; National Renaissance; INC; national leaders (incl. Muthulakshmi Ammaiyar, Muvalur Ramamirtham); TN modes of agitation; Indian culture; secular state.",
      "Unit IV: Indian Polity (15 Q) — Constitution; Preamble; salient features; Union/State/UT; citizenship, FR, FD, DPSP; Executive & Legislature; local governments, Panchayat Raj; federalism; elections; judiciary; corruption & anti-corruption; Lokpal & Lokayukta; RTI; women empowerment; Consumer Protection; Human Rights; political parties in TN & India; current affairs.",
      "Unit V: Indian Economy & Development Administration in Tamil Nadu (20 Q) — nature of economy; five-year plans; NITI Aayog; RBI; Finance Commission; GST; employment; land reforms & agriculture; industrial growth; rural welfare; social problems; social justice; education & health in TN; geography of TN & economic impact; welfare schemes; current affairs.",
      "Unit VI: History, Culture, Heritage & Socio-Political Movements of Tamil Nadu (20 Q) — Tamil society & archaeology; Tamil literature; Thirukkural; role of TN in freedom struggle; women; social reformers and social transformation of Tamil Nadu.",
      "PART B — APTITUDE & MENTAL ABILITY (25 Q): Aptitude (15 Q) and Reasoning (10 Q).",
      "PART C — Tamil/English Eligibility-cum-Scoring Test (100 Q).",
    ].join("\n"),
  },
];

// Map a detected subject (from SUBJECT_HINTS taxonomy) to the syllabus unit key so
// analytics can quote the OFFICIAL weightage for that subject where published.
const SUBJECT_TO_UNIT: Record<string, string[]> = {
  Polity: ["Indian Polity"],
  History: ["History, Culture & Indian National Movement", "History, Culture, Heritage & Socio-Political Movements of Tamil Nadu"],
  Geography: ["Geography of India", "Geography"],
  Economy: ["Indian Economy & Development Administration in Tamil Nadu"],
  "Science & Technology": ["General Science"],
  Environment: ["General Science", "Geography of India"],
  "Art & Culture": ["History, Culture & Indian National Movement", "History, Culture, Heritage & Socio-Political Movements of Tamil Nadu"],
  Aptitude: ["Aptitude", "Reasoning"],
};

// Returns the official syllabus text for an exam. For UPSC, prelims-GS + the
// detailed Mains GS enumeration (the real sub-topic map). For TNPSC, the group
// the student targets (falls back to the flagship group when unspecified).
export function getSyllabusForExam(exam: string, prompt = ""): SyllabusDoc[] {
  const e = String(exam || "").toUpperCase();
  const p = String(prompt || "").toLowerCase();
  if (e === "UPSC") {
    // Prelims broad areas + detailed Mains GS papers = the authoritative topic map.
    return SYLLABI.filter((s) => s.exam === "UPSC" && s.paper !== "csat");
  }
  if (e === "TNPSC") {
    let paper = "group-1";
    if (/\bgroup\s*4|group\s*iv\b/.test(p)) paper = "group-4";
    else if (/\bgroup\s*2a?\b|group\s*ii/.test(p)) paper = "group-2-2a";
    else if (/\bgroup\s*1|group\s*i\b/.test(p)) paper = "group-1";
    const doc = SYLLABI.find((s) => s.exam === "TNPSC" && s.paper === paper);
    return doc ? [doc] : SYLLABI.filter((s) => s.exam === "TNPSC");
  }
  return SYLLABI.filter((s) => s.exam === e);
}

// Compact official-syllabus context block for grounding an answer.
export function syllabusContextBlock(exam: string, prompt = ""): string {
  const docs = getSyllabusForExam(exam, prompt);
  if (!docs.length) return "";
  const parts = docs.map((d) => {
    const w = d.weightage
      ? `\nOFFICIAL WEIGHTAGE (questions per unit): ${Object.entries(d.weightage).map(([k, v]) => `${k} ${v}`).join("; ")}.`
      : "";
    return `### ${d.title}\n[${d.source}]${w}\n${d.text}`;
  });
  return parts.join("\n\n");
}

// Official weightage for a named subject in an exam, if the board publishes it.
export function officialWeightageForSubject(exam: string, subject: string, prompt = ""): { unit: string; questions: number }[] {
  const units = SUBJECT_TO_UNIT[subject] || [subject];
  const out: { unit: string; questions: number }[] = [];
  for (const doc of getSyllabusForExam(exam, prompt)) {
    if (!doc.weightage) continue;
    for (const u of units) {
      if (doc.weightage[u] != null) out.push({ unit: u, questions: doc.weightage[u] });
    }
  }
  return out;
}
