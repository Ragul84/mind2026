import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const picks = [['upsc_ecosystem', 6], ['upsc_ecosystem', 12], ['tnpsc_ecosystem', 8], ['ssc_ecosystem', 10]];
for (const [trk, day] of picks) {
  const { data } = await sb.from('master_content_vault').select('topic_title,content_json').eq('track_id', trk).eq('day_number', day).maybeSingle();
  if (!data) continue;
  const p = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;
  console.log('\n#### ' + trk.replace('_ecosystem', '').toUpperCase() + ' D' + day + ': ' + data.topic_title + ' ####');
  for (const pg of (p.lesson_pages || []).filter((x) => x.type !== 'overview')) {
    console.log('  [' + String(pg.title).slice(0, 42) + ']');
    for (const b of (pg.blocks || [])) {
      if (b.type === 'table') console.log('    TABLE ' + JSON.stringify(b.headers) + ' ' + JSON.stringify(b.rows).slice(0, 150));
      else if (['timeline', 'fact_grid', 'mindmap'].includes(b.type)) {
        const items = b.items || b.branches || [];
        console.log('    ' + b.type.toUpperCase() + ' ' + JSON.stringify(items.map((x) => (x.label || '') + '=' + (x.value || '')).slice(0, 6)).slice(0, 200));
      } else if (b.type === 'stat') console.log('    STAT ' + JSON.stringify((b.items || []).map((x) => x.value + ':' + x.label)));
      else if (b.type === 'trap') console.log('    TRAP ' + String(b.text).slice(0, 120));
      else console.log('    ' + b.type + ' ' + String(b.text || '').slice(0, 90));
    }
  }
  console.log('  QUIZ:');
  const qs = p.quiz?.questions || p.quiz || [];
  qs.forEach((q, i) => {
    const opts = q.options || [];
    const a = q.answer;
    console.log('    Q' + (i + 1) + ': ' + String(q.question).slice(0, 82) + '  => ' + opts[a]);
  });
}
