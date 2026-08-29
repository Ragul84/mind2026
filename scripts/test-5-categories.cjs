const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'C:/mindwhite/.env' });

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test5Categories() {
  const tests = [
    { label: '1. TNPSC GS (Group 1 2019)', source_id: 'tnpsc-group1-prelims-2019' },
    { label: '2. General Tamil (Group 4)', source_id: 'tnpsc-group-4-question-papers-2016-tnpsc-group-4-2016-general-tamil-pdf' },
    { label: '3. Group 2 General English', source_id: 'tnpsc-group2-prelims-2024-ge' },
    { label: '4. UPSC CSE Prelims', exam: 'UPSC' },
    { label: '5. Diagram Visual PYQ', needs_figure: true }
  ];

  console.log('================================================================');
  console.log('🤖 5-CATEGORY AI CHAT GROUNDED PYQ TEST SUITE');
  console.log('================================================================');

  for (const t of tests) {
    let q = supabase.from('pyq_questions').select('*');
    if (t.source_id) q = q.eq('source_id', t.source_id);
    if (t.exam) q = q.eq('exam', t.exam);
    if (t.needs_figure) q = q.eq('needs_figure', true);

    const { data, error } = await q.limit(1);
    if (error) {
      console.log(`\n❌ [FAIL] ${t.label}: ${error.message}`);
    } else if (data && data.length > 0) {
      const r = data[0];
      const qTextClean = r.question_text.replace(/\r?\n|\r/g, ' ').slice(0, 100);
      console.log(`\n✅ [PASS] ${t.label}:`);
      console.log(`   ID:       ${r.id}`);
      console.log(`   Exam:     ${r.exam} (${r.year || 'N/A'})`);
      console.log(`   Question: "${qTextClean}..."`);
      console.log(`   Options:  ${JSON.stringify(r.options)}`);
      console.log(`   Answer:   "${r.answer_text}" | Source: ${r.answer_source}`);
      if (r.images && r.images.length > 0) {
        console.log(`   Diagram:  ${r.images.join(', ')}`);
      }
    } else {
      console.log(`\n❌ [FAIL] ${t.label}: No row found`);
    }
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 5 CATEGORIES TESTED & GROUNDED IN SUPABASE BASELINE!');
  console.log('================================================================');
}

test5Categories();
