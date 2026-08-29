require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  console.log('=== TNPSC source counts ===');
  const { data, error } = await sb.from('pyq_questions').select('source_id,year').ilike('exam', 'TNPSC');
  if (error) { console.error(error); return; }
  const bySrc = {};
  for (const r of data) { bySrc[r.source_id] = (bySrc[r.source_id] || 0) + 1; }
  for (const [id, c] of Object.entries(bySrc).sort()) console.log(id + ': ' + c);

  console.log('\n=== TNPSC sources metadata ===');
  const { data: srcs } = await sb.from('pyq_sources').select('*').ilike('exam', 'TNPSC');
  for (const s of srcs || []) console.log(JSON.stringify(s));

  console.log('\n=== Untagged TNPSC (any answer_source) ===');
  const { data: untagged } = await sb.from('pyq_questions').select('source_id,year,question_number').is('subject', null).ilike('exam', 'TNPSC');
  const ut = {};
  for (const r of untagged || []) { ut[r.source_id] = (ut[r.source_id] || 0) + 1; }
  for (const [id, c] of Object.entries(ut).sort()) console.log(id + ': ' + c + ' untagged');
})();
