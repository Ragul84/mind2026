require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const targetSources = [
    'tnpsc-group1-prelims-2021-gs',
    'tnpsc-group1-prelims-2022-gs',
    'tnpsc-group1-prelims-2024-gs',
    'tnpsc-group1-prelims-2019-gs',
    'tnpsc-group2-prelims-2022-gs-v2',
    'tnpsc-group2-prelims-2024-gs-v2',
    'tnpsc-group4-prelims-2022-gs',
    'tnpsc-group4-prelims-2019-gs',
    'tnpsc-group4-prelims-2025',
    'tnpsc-acf-prelims-2023-gs',
    'tnpsc-group2-prelims-2014',
    'tnpsc-group2a-2017-gs',
    'tnpsc-group2-2018-gs',
  ];

  console.log('=== Target source counts ===');
  for (const sid of targetSources) {
    const { count } = await sb.from('pyq_questions').select('*', { count: 'exact', head: true }).eq('source_id', sid);
    const { count: tagged } = await sb.from('pyq_questions').select('*', { count: 'exact', head: true }).eq('source_id', sid).not('subject', 'is', null);
    console.log(`${sid}: ${count ?? 0} total, ${tagged ?? 0} tagged`);
  }

  console.log('\n=== All source_ids containing group1-prelims or group2-prelims or group4-prelims or acf ===');
  const { data } = await sb.from('pyq_questions').select('source_id').or('source_id.like.*group1-prelims*,source_id.like.*group2-prelims*,source_id.like.*group4-prelims*,source_id.like.*acf-prelims*');
  const uniq = {};
  for (const r of data || []) uniq[r.source_id] = (uniq[r.source_id] || 0) + 1;
  for (const [id, c] of Object.entries(uniq).sort()) console.log(`${id}: ${c}`);
})();
