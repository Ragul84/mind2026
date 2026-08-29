require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data } = await sb.from('pyq_questions')
    .select('question_number,question_text,answer_text,answer_source')
    .eq('source_id', 'tnpsc-group1-prelims-2019')
    .order('question_number');
  
  console.log('Total:', data?.length ?? 0);
  const nums = (data || []).map(r => parseInt(r.question_number, 10)).filter(n => !isNaN(n));
  const missing = [];
  for (let i = 1; i <= 200; i++) if (!nums.includes(i)) missing.push(i);
  console.log('Missing Q numbers:', missing.length, missing.slice(0, 20).join(', ') + (missing.length > 20 ? '...' : ''));
  
  // Show some samples
  for (const q of (data || []).slice(0, 5)) {
    console.log(`\nQ${q.question_number}: ${q.question_text.slice(0, 100)}`);
    console.log(`  -> ${q.answer_text.slice(0, 80)}`);
  }
})();
