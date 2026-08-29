const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

function clean(value) {
  return String(value || '')
    .replace(/\s+:/g, ':')
    .replace(/\bdiv by\b/gi, 'divisible by')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<!\.)[.。]$/u, '');
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function compact(value, max = 160) {
  const text = clean(value);
  if (text.length <= max) return text;
  // Keep whole sentences within budget — never cut mid-sentence or add "...".
  // Protect initials (B.R.) so the split doesn't break them.
  const guarded = text.replace(/\b([A-Z])\.(?=\s*[A-Z])/g, '$1@@D@@');
  const parts = guarded.split(/(?<=[.;])\s+/).map((p) => p.replace(/@@D@@/g, '.'));
  let out = '';
  for (const p of parts) { if (out && (out.length + p.length + 1) > max) break; out = out ? `${out} ${p}` : p; }
  return clean(out || parts[0] || text);
}

function sentenceBack(label, answer, pageTitle) {
  const l = clean(label);
  const a = clean(answer);
  const page = clean(pageTitle);

  if (/Divisibility/i.test(page)) {
    if (l === '2') return 'The last digit should be even';
    if (l === '3') return 'The sum of digits should be divisible by 3';
    if (l === '4') return 'The last two digits should be divisible by 4';
    if (l === '5') return 'The last digit should be 0 or 5';
    if (l === '8') return 'The last three digits should be divisible by 8';
    if (l === '9') return 'The sum of digits should be divisible by 9';
    if (l === '11') return 'The odd-place digit sum minus even-place digit sum should be 0 or a multiple of 11';
    if (l === '13') return 'Add four times the last digit to the remaining number and check divisibility by 13';
  }

  if (/Unit Digit/i.test(page)) {
    const rem = l.match(/remainder is\s*(\d+)/i)?.[1];
    if (rem === '1') return 'Use the unit digit of X¹';
    if (rem === '2') return 'Use the unit digit of X²';
    if (rem === '3') return 'Use the unit digit of X³';
    if (rem === '0') return 'Use the unit digit of X⁴';
    if (/Cycle/i.test(l)) return 'The unit digit pattern usually repeats every 4 powers';
    if (/Note/i.test(l)) return 'The digits 0, 1, 5 and 6 keep the same unit digit in every power';
  }

  if (/Original Constitution/i.test(l)) return 'It had 22 Parts, 395 Articles and 8 Schedules';
  if (/Current structure/i.test(l)) return 'It has 25 Parts, 448+ Articles and 12 Schedules';
  if (/Formed/i.test(l)) return `It was formed under ${a}`;
  if (/First meeting/i.test(l)) return `It first met on ${a}`;
  if (/Adopted/i.test(l)) return `It was adopted on ${a}`;
  if (/Enforced/i.test(l)) return `It came into force on ${a}`;
  if (/Members who signed/i.test(l)) return `${a} members signed it`;
  if (/Time taken/i.test(l)) return `It took ${a}`;
  if (/President/i.test(l)) return `${a} was the President`;
  if (/Advisor/i.test(l)) return `${a} was the Constitutional Advisor`;
  if (/Monetary Policy Committee|MPC/i.test(`${page} ${l}`)) return `The MPC has ${a}`;
  if (/Committee/i.test(l)) return `${a} chaired it`;

  if (/Total/i.test(l) && /Tamil Letters/i.test(page)) return `There are ${a} in total`;
  if (/Uyir Eluthu/i.test(l)) return `There are ${a} Uyir letters`;
  if (/Mey Eluthu/i.test(l)) return `There are ${a} Mey letters`;
  if (/Uyirmey/i.test(l)) return `There are ${a} Uyirmey letters`;
  if (/Ayutha/i.test(l)) return `There is ${a} Ayutha letter`;
  if (/Kuril/i.test(l)) return `Kuril has ${a}`;
  if (/Nedil/i.test(l)) return `Nedil has ${a}`;
  if (/Vallinam/i.test(l)) return `Vallinam has ${a}`;
  if (/Mellinam/i.test(l)) return `Mellinam has ${a}`;
  if (/Idaiyinam/i.test(l)) return `Idaiyinam has ${a}`;
  if (/Mudal Eluthu/i.test(l)) return `Mudal Eluthu has ${a}`;
  if (/Sarbu Eluthu/i.test(l)) return `Sarbu Eluthu has ${a}`;
  if (/Maathirai|Pronunciation time/i.test(l)) return `The value is ${a}`;

  if (/Number Classification/i.test(page)) {
    if (/Natural/i.test(l)) return `Natural numbers start from ${a.replace(/^.*?(\d).*$/u, '$1') || '1'}`;
    if (/Whole/i.test(l)) return `Whole numbers start from ${a.replace(/^.*?(\d).*$/u, '$1') || '0'}`;
    if (/Integers/i.test(l)) return 'Integers include negative numbers, zero and positive numbers';
    if (/Rational/i.test(l)) return 'Rational numbers can be written in p/q form';
    if (/Irrational/i.test(l)) return 'Irrational numbers cannot be written as terminating or recurring fractions';
    if (/Prime/i.test(l)) return `There are ${a} prime numbers from 1 to 100`;
  }

  if (/Article\s*(Number\s*)?Map|FR Article/i.test(page)) return a.replace(/\s*\+\s*/g, ' & ');
  if (/Schedule/i.test(page) && /^\d/.test(l)) return `It covers ${a}`;
  if (/Sources of Constitution/i.test(page)) return `It was borrowed from ${a}`;
  if (/season|crop|paddy|cotton|oilseed|tea|coffee|rubber|spices|district|producer/i.test(`${page} ${l}`)) return `It is linked with ${a}`;
  if (/^rate at/i.test(a)) return `${l} is the ${a.charAt(0).toLowerCase()}${a.slice(1)}`;
  if (/^produces\s+/i.test(a)) return `${l} produces ${a.replace(/^produces\s+/i, '')}`;
  if (/^connects\s+/i.test(a)) return `${l} connects ${a.replace(/^connects\s+/i, '')}`;
  if (/^master gland/i.test(a)) return `${l} is the master gland${a.replace(/^master gland/i, '')}`;
  if (/emergency gland/i.test(a)) return `${l} is known as the emergency gland`;
  if (/^thigh bone/i.test(a)) return `${l} is the thigh bone${a.replace(/^thigh bone/i, '')}`;
  if (/^ear bone/i.test(a)) return `${l} is the ear bone${a.replace(/^ear bone/i, '')}`;
  if (/^leg$/i.test(a)) return `${l} are leg bones`;
  if (/^arm$/i.test(a)) return `${l} are arm bones`;
  if (/^% of deposits/i.test(a)) return `${l} is the percentage of deposits banks must keep with RBI`;
  if (/^% banks/i.test(a)) return `${l} is the percentage banks must keep in liquid assets`;
  if (/^adult human has/i.test(a)) return `Adult humans have ${a.replace(/^adult human has\s*/i, '')}`;
  if (/^established\s+\d{4}/i.test(a)) return `${l} was established in ${a.replace(/^established\s+/i, '')}`;
  if (/recap/i.test(`${page} ${l}`)) return `${l} covers ${a}`;
  if (/bone/i.test(a) || /gland|hormone|thyroxine|insulin|glucagon/i.test(`${page} ${l} ${a}`)) return `${l} is ${a}`;

  // Otherwise return the fact as-is. The front already names the topic, so
  // wrapping it ("The key point about X is Y") just repeats the question.
  return a;
}

function examName(trackId) {
  if (trackId === 'upsc_ecosystem') return 'UPSC';
  if (trackId === 'tnpsc_ecosystem') return 'TNPSC';
  if (trackId === 'ssc_ecosystem') return 'SSC';
  return 'Exam';
}

function naturalLabel(label) {
  return clean(label)
    .replace(/\+/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inlinePairs(text) {
  const value = clean(text);

  // Enumerated lists: "1:States/UTs, 2:Salaries, ..." or "1 (States), 3 (Oaths)".
  // Split into one pair per number, keeping the REAL number as the label. The
  // value runs until the next ", N:" / ", N (" marker, so commas INSIDE a value
  // (e.g. "(Assam, Meghalaya, Tripura & Mizoram)") are preserved, not split.
  const enumCount = (value.match(/(?:^|[^0-9])\d{1,2}\s*[:(]/g) || []).length;
  if (enumCount >= 3) {
    const items = [];
    const re = /(\d{1,2})\s*[:(]\s*(.+?)(?=,\s*\d{1,2}\s*[:(]|\.?\s*$)/g;
    let m;
    while ((m = re.exec(value))) {
      const label = clean(m[1]);
      let answer = clean(m[2]).replace(/\s*\+\s*/g, ' & ').replace(/([A-Za-z])\(/g, '$1 (');
      // Strip a dangling ")" left over from the "1 (States/UTs)" format.
      if ((answer.match(/\)/g) || []).length > (answer.match(/\(/g) || []).length) {
        answer = answer.replace(/\)\s*$/, '');
      }
      if (label && answer) items.push({ label, answer });
    }
    if (items.length >= 3) return items;
  }

  // Sentence-style "Label: value." pairs. Protect initials so "B.R. Ambedkar"
  // isn't cut at the first period.
  const guarded = value.replace(/\b([A-Z])\.(?=\s*[A-Z])/g, '$1@@D@@');
  const pairs = [];
  const regex = /(^|[.;]\s*)([^.;:]{1,60}):\s*([^.;]+)/g;
  let match;
  while ((match = regex.exec(guarded))) {
    const label = clean(match[2]).replace(/@@D@@/g, '.');
    const answer = clean(match[3]).replace(/@@D@@/g, '.').replace(/\s*\+\s*/g, ' & ');
    if (label && answer && !/note|drill|skill/i.test(label)) pairs.push({ label, answer });
  }
  return pairs;
}

// "Name (detail)" list pairs, e.g. "1. Kurinji (Mountains). 2. Mullai (Forest)"
// or "Cheras (Vanji, Bow). Cholas (Uraiyur, Tiger)". Extracts label = the name,
// answer = the parenthetical. Skips sentence-like labels (verbs / >3 words) so
// prose like "Women were respected (Avvaiyar)" doesn't make a junk card.
function parenPairs(text) {
  const value = clean(text);
  const pairs = [];
  const re = /(?:^|[.;]\s*)(?:\d+\.\s*)?([A-Z][^.;:()]{1,40}?)\s*\(([^()]{2,70})\)/g;
  let m;
  while ((m = re.exec(value))) {
    const label = clean(m[1]);
    const answer = clean(m[2]).replace(/\s*\+\s*/g, ' & ');
    if (!label || !answer) continue;
    if (label.split(/\s+/).length > 3) continue;
    if (/\b(was|were|is|are|has|have|the|for|with|and|of|to|in)\b/i.test(label)) continue;
    pairs.push({ label, answer });
  }
  return pairs;
}

function card(front, back, source) {
  return {
    front: clean(front),
    back: clean(back),
    source,
  };
}

function makeFront(trackId, pageTitle, label, type) {
  const l = naturalLabel(label);
  const page = clean(pageTitle);
  const context = `${page} ${l}`;

  if (/Original Constitution/i.test(l)) return 'The original structure of the Constitution';
  if (/Current structure/i.test(l)) return 'The current structure of the Constitution';
  if (/Formed/i.test(l) && /Constituent Assembly/i.test(page)) return 'The plan under which the Constituent Assembly was formed';
  if (/First meeting/i.test(l) && /Constituent Assembly/i.test(page)) return 'The first meeting date of the Constituent Assembly';
  if (/Adopted/i.test(l)) return 'The date of Constitution adoption';
  if (/Enforced/i.test(l)) return 'The date of Constitution enforcement';
  if (/Members who signed/i.test(l)) return 'The number of members who signed the Constitution';
  if (/Time taken/i.test(l)) return 'The time taken to frame the Constitution';
  if (/Constituent Assembly President/i.test(l)) return 'The President of the Constituent Assembly';
  if (/Constitutional Advisor/i.test(l)) return 'The Constitutional Advisor';
  if (/Monetary Policy Committee|MPC/i.test(`${page} ${l}`)) return 'The structure of the Monetary Policy Committee';
  if (/Committee/i.test(l)) return `The chairman of the ${l}`;
  if (/Sources of Constitution/i.test(page)) return `The source of ${l}`;
  if (/Article\s*(Number\s*)?Map|FR Article/i.test(page) && /\d/.test(l)) return `The subject of Articles ${l.replace(/-/g, '–')}`;
  if (/Schedule/i.test(page) && /^\d/.test(l)) return `The subject of Schedule ${l}`;
  if (/Thinai/i.test(page)) return `The landscape of the ${l} thinai`;
  if (/Kingdom|Vendhar|வேந்த/i.test(page)) return `The capital and symbols of the ${l}`;
  if (/Sangam/i.test(page) && /Sangam/i.test(l)) return `The seat of the ${l}`;
  if (/Divisibility/i.test(page) && /^\d+$/.test(l)) return `The divisibility rule of ${l}`;
  if (/Unit Digit/i.test(page) && /remainder is/i.test(l)) return `The unit digit rule when the ${l.toLowerCase()}`;
  if (/Unit Digit/i.test(page) && /Cycle/i.test(l)) return 'The power cycle used for unit digit questions';
  if (/Unit Digit/i.test(page) && /Note/i.test(l)) return 'The unit digits that stay fixed in powers';
  if (/Number Classification/i.test(page)) return `The meaning of ${l}`;
  if (/Prime/i.test(context)) return `The key fact about ${l}`;
  if (/BODMAS/i.test(page)) return 'The order used in BODMAS simplification';
  if (/Tamil Letters/i.test(page) && /Total/i.test(l)) return 'The total number of Tamil letters';
  if (/Uyir Eluthu/i.test(page) && /Note/i.test(l)) return 'The long-vowel status of ஐ and ஔ';
  if (/Mey Eluthu/i.test(page) && /Pronunciation time/i.test(l)) return 'The Maathirai value of Mey Eluthu';
  if (/season|sornavari|samba|navarai/i.test(context)) return `The season period of ${l}`;
  if (/crop|paddy|cotton|oilseed|tea|coffee|rubber|spices|district|producer/i.test(context)) return `The crop/location link for ${l}`;
  if (/Uyir|Mey|Uyirmey|Ayutha|Kuril|Nedil|Mudal|Sarbu|Maathirai/i.test(context)) return `The recall fact for ${l}`;
  if (type === 'trap') return '';
  if (type === 'rule' && /recap/i.test(page)) return `The important facts in ${page}`;
  if (type === 'rule') return `The key point about ${page}`;
  if (type === 'pair') return `The key fact about ${l}`;
  return `The key recall point for ${page}`;
}

function cardsFromBlock(trackId, page, block) {
  const out = [];
  const pageTitle = clean(page.title);

  if (block.type === 'table' && Array.isArray(block.rows)) {
    for (const row of block.rows) {
      const cells = row.map(clean).filter(Boolean);
      if (cells.length < 2) continue;
      const label = cells[0];
      const answer = sentenceBack(label, cells.slice(1).join(' | '), pageTitle);
      out.push(card(
        makeFront(trackId, pageTitle, label, 'pair'),
        answer,
        'lesson_page_table'
      ));
    }
  }

  if ((block.type === 'timeline' || block.type === 'fact_grid' || block.type === 'checklist') && Array.isArray(block.items)) {
    for (const item of block.items) {
      let label = clean(item.label);
      const answer = clean(item.value || item.detail);
      if (!label || !answer) continue;
      if (/^if\s*rem$/i.test(label)) {
        const rem = answer.match(/^\d+/)?.[0];
        label = rem ? `remainder is ${rem}` : label;
      }
      out.push(card(
        makeFront(trackId, pageTitle, label, 'pair'),
        sentenceBack(label, answer, pageTitle),
        `lesson_page_${block.type}`
      ));
    }
  }

  if (block.type === 'formula' && block.text) {
    let pairs = inlinePairs(block.text);
    if (pairs.length < 2) pairs = parenPairs(block.text);
    if (pairs.length >= 2) {
      for (const pair of pairs.slice(0, 10)) {
        out.push(card(
          makeFront(trackId, pageTitle, pair.label, 'pair'),
          compact(sentenceBack(pair.label, pair.answer, pageTitle), 140),
          'lesson_page_formula_pair'
        ));
      }
    } else {
      out.push(card(
        makeFront(trackId, pageTitle, pageTitle, 'rule'),
        compact(sentenceBack(pageTitle, block.text, pageTitle), 150),
        'lesson_page_formula'
      ));
    }
  }

  if (block.type === 'text' && block.text) {
    const text = clean(block.text);
    let pairs = inlinePairs(text);
    if (pairs.length < 2) pairs = parenPairs(text);
    if (pairs.length >= 2) {
      for (const pair of pairs.slice(0, 8)) {
        out.push(card(
          makeFront(trackId, pageTitle, pair.label, 'pair'),
          compact(sentenceBack(pair.label, pair.answer, pageTitle), 140),
          'lesson_page_text_pair'
        ));
      }
    } else {
      out.push(card(
        makeFront(trackId, pageTitle, pageTitle, 'rule'),
        compact(sentenceBack(pageTitle, text, pageTitle), 160),
        'lesson_page_text'
      ));
    }
  }

  return out;
}

// Pick an even spread of n items from arr (e.g. Schedules 1,4,7,10 — not 1-4),
// so a large topic is sampled across its range, not just the first few.
function spread(arr, n) {
  if (arr.length <= n) return arr.slice();
  const out = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function buildFlashcards(row, payload) {
  const pages = Array.isArray(payload.lesson_pages) ? payload.lesson_pages.slice(1) : [];
  const limit = row.track_id === 'ssc_ecosystem' ? 18 : 14;

  // 1. One card group per page (topic), filtered + locally deduped.
  const groups = [];
  for (const page of pages) {
    const seen = new Set();
    const g = [];
    for (const block of page.blocks || []) {
      for (const c of cardsFromBlock(row.track_id, page, block)) {
        if (!c.front || !c.back || c.front.length > 110 || c.back.length > 180) continue;
        const key = `${c.front.toLowerCase()}|${c.back.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        g.push(c);
      }
    }
    if (g.length) groups.push(g);
  }
  if (!groups.length) return [];

  // 2. Cap each topic's share so a single page (e.g. the 12 Schedules) can't
  //    dominate the deck; take an even spread from big topics.
  const maxPerTopic = Math.max(3, Math.ceil(limit / groups.length));
  const trimmed = groups.map((g) => spread(g, maxPerTopic));

  // 3. Interleave topics round-robin so consecutive cards switch subject — a
  //    revision deck should feel mixed, like a teacher quizzing across the day,
  //    not 12 schedule cards back to back.
  const deck = [];
  const globalSeen = new Set();
  for (let i = 0; deck.length < limit; i++) {
    let any = false;
    for (const g of trimmed) {
      const c = g[i];
      if (!c) continue;
      any = true;
      const key = `${c.front.toLowerCase()}|${c.back.toLowerCase()}`;
      if (globalSeen.has(key)) continue;
      globalSeen.add(key);
      deck.push(c);
      if (deck.length >= limit) break;
    }
    if (!any) break;
  }
  return deck;
}

async function main() {
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('track_id, day_number, topic_title, content_json')
    .in('track_id', ['upsc_ecosystem', 'tnpsc_ecosystem', 'ssc_ecosystem'])
    .order('track_id')
    .order('day_number');
  if (error) throw error;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, `../scratch/daily-mission-before-flashcards-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));

  let changed = 0;
  let empty = 0;
  for (const row of data) {
    const payload = parsePayload(row.content_json);
    const flashcards = buildFlashcards(row, payload);
    if (!flashcards.length) {
      empty += 1;
      continue;
    }
    const nextPayload = { ...payload, flashcards };
    changed += 1;
    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from('master_content_vault')
        .update({ content_json: nextPayload, updated_at: new Date().toISOString() })
        .eq('track_id', row.track_id)
        .eq('day_number', row.day_number);
      if (updateError) throw updateError;
    }
  }

  const report = { dryRun: DRY_RUN, rows: data.length, changed, empty, backupPath };
  const reportPath = path.resolve(__dirname, `../scratch/daily-mission-flashcards-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
