require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const sources = [
    'tnpsc-group2-prelims-2024-gs-v2',
    'tnpsc-group4-prelims-2019-gs',
    'tnpsc-group1-prelims-2019-gs',
  ];
  for (const sid of sources) {
    const { data, error } = await sb.from('pyq_questions')
      .select('created_at')
      .eq('source_id', sid)
      .order('created_at', { ascending: true })
      .limit(1);
    const { data: latest } = await sb.from('pyq_questions')
      .select('created_at')
      .eq('source_id', sid)
      .order('created_at', { ascending: false })
      .limit(1);
    console.log(sid + ':');
    console.log('  count:', data?.length ?? 0);
    if (data && data[0]) console.log('  first created:', data[0].created_at);
    if (latest && latest[0]) console.log('  last created:', latest[0].created_at);
  }
})();
