/* Read-only production-path MIGA acceptance harness. It mirrors mascotApi.streamChat's
 * request body and SSE parsing but deliberately does not create MIGA sessions/messages. */
require('dotenv').config({ quiet: true });
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error('Supabase credentials required');
const db = createClient(url, service);
const tests = [
  ['newton', "Explain Newton's second law"],
  ['revolt', 'The revolt of 1857'],
  ['revolt_causes', 'Explain the causes of the Revolt of 1857'],
  ['tnpsc_dpsp', 'Explain Directive Principles of State Policy for TNPSC'],
  ['five_kingdom', 'Explain the five kingdom classification'],
  ['indian_monsoon', 'Explain the Indian monsoon'],
];
async function chooseRealUser() {
  const { data: sessions, error } = await db.from('miga_chat_sessions').select('user_id,last_message_at').order('last_message_at', { ascending: false }).limit(40);
  if (error) throw error;
  for (const id of [...new Set((sessions || []).map((x) => x.user_id).filter(Boolean))]) {
    const { data: profile } = await db.from('user_profiles').select('*').eq('id', id).maybeSingle();
    if (profile) return profile;
  }
  const { data: profiles, error: profilesError } = await db.from('user_profiles').select('*').limit(50);
  if (profilesError) throw profilesError;
  const contextual = (profiles || []).find((x) => x.target_exam || x.exam || x.exam_type || x.board || x.class_level);
  if (contextual) return contextual;
  throw new Error('No existing MIGA profile found');
}
async function stream(profile, prompt) {
  const response = await fetch(`${url}/functions/v1/miga_stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
    body: JSON.stringify({ user_id: profile.id, messages: [{ role: 'user', content: prompt }], mode: 'chat', language_code: 'en-IN', language_label: 'English', attachments: [], provider: 'openrouter' }),
  });
  if (!response.ok) throw new Error(await response.text());
  let event = ''; let answer = ''; let evidence = []; const events = [];
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (line.startsWith('event:')) { event = line.slice(6).trim(); events.push(event); continue; }
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
    try { const parsed = JSON.parse(data); if (event === 'evidence') evidence = parsed.evidence || []; else if (parsed.token) answer += parsed.token; } catch {}
  }
  const sources = [];
  for (const item of evidence) {
    const { data: chunk, error: chunkError } = await db.from('textbook_chunks').select('id,source_id,content,board,class_level,subject,chapter,language,chunk_type').eq('id', item.excerptChunkId).maybeSingle();
    if (chunkError) throw chunkError;
    sources.push({ evidence: item, chunk });
  }
  return { prompt, events, answer, evidence, sources, mindmap_fence_present: /```mindmap\s*[\s\S]*?```/i.test(answer) };
}
(async () => {
  const profile = await chooseRealUser();
  const results = []; for (const [name, prompt] of tests) results.push({ name, ...(await stream(profile, prompt)) });
  const report = { generated_at: new Date().toISOString(), request_contract: { mode: 'chat', language_code: 'en-IN', language_label: 'English', attachments: [], provider: 'openrouter', messages: 'single new-chat user turn' }, profile_context_used: { target_exam: profile.target_exam, target_exams: profile.target_exams, exam: profile.exam, exam_type: profile.exam_type, board: profile.board, education_level: profile.education_level, class_level: profile.class_level }, results };
  const output = path.join('reports', 'miga-production-acceptance.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, tests: results.map((x) => ({ name: x.name, answer_chars: x.answer.length, events: x.events, evidence_sources: x.evidence.length, mindmap: x.mindmap_fence_present })) }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
