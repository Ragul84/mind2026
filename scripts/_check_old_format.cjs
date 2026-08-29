require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data } = await sb.from('pyq_questions')
    .select('question_number,question_text,options,answer_text,answer_source,confidence')
    .eq('source_id', 'tnpsc-group1-prelims-2019')
    .order('question_number')
    .limit(10);
  
  for (const q of data || []) {
    console.log(`\nQ${q.question_number}:`);
    console.log('  Text:', q.question_text.slice(0, 120));
    console.log('  Options:', JSON.stringify(q.options));
    console.log('  Answer:', q.answer_text.slice(0, 60));
    console.log('  Source:', q.answer_source, 'conf:', q.confidence);
  }
})();
