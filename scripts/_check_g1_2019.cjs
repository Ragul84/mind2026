require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data } = await sb.from('pyq_sources').select('*').eq('id', 'tnpsc-group1-prelims-2019-gs');
  console.log('tnpsc-group1-prelims-2019-gs source:', JSON.stringify(data, null, 2));

  const { data: old } = await sb.from('pyq_questions').select('question_number,question_text,answer_text,answer_source').eq('source_id', 'tnpsc-group1-prelims-2019').order('question_number');
  console.log('\nOld source tnpsc-group1-prelims-2019 questions:', old?.length ?? 0);
  if (old && old.length > 0) {
    console.log('Sample:', JSON.stringify(old.slice(0, 3), null, 2));
    console.log('Q1 text:', old[0]?.question_text?.slice(0, 100));
  }
})();
