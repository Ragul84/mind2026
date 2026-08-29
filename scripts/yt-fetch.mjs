import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const KEY = env.YOUTUBE_API_KEY;
const CACHE_FILE = 'scripts/yt-cache.json';

const TRACKS = ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem'];
const LANG = { upsc_ecosystem:'en', ssc_ecosystem:'en', tnpsc_ecosystem:'ta' };
const EXAMWORD = { upsc_ecosystem:'UPSC', ssc_ecosystem:'SSC', tnpsc_ecosystem:'TNPSC' };

const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE,'utf8')) : {};
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

function buildQuery(track, topic) {
  let q = (topic||'').replace(/—/g,' ').replace(/\s+/g,' ').trim();
  q = q.replace(/^(UPSC|SSC|TNPSC)\s*:?\s*/i,'');           // drop leading exam token
  q = q.replace(/^(UPSC|SSC|TNPSC)\s+/i,'');                // and a second one if present
  let out = `${q} ${EXAMWORD[track]}`;
  if (track === 'tnpsc_ecosystem') out += ' in Tamil';
  return out.trim();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchOnce(track, query) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=6&order=relevance&relevanceLanguage=${LANG[track]}&q=${encodeURIComponent(query)}&key=${KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) {
    const err = (j.error.errors && j.error.errors[0]) || {};
    const reason = err.reason || j.error.status || 'unknown';
    const msg = (j.error.message || err.message || '').toLowerCase();
    const dailyQuota = msg.includes('per day') || reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
    const burst = !dailyQuota && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || r.status === 429 || r.status === 503);
    return { error: true, dailyQuota, burst, reason, status: r.status };
  }
  const items = (j.items||[]).filter(it => it.id && it.id.videoId);
  const pick = items.find(it => !/#short/i.test(it.snippet?.title||'')) || items[0];
  if (!pick) return { empty: true };
  return { videoId: pick.id.videoId, videoTitle: pick.snippet.title, channel: pick.snippet.channelTitle };
}

// retry burst limits with backoff; daily quota bubbles up as a hard stop
async function search(track, query) {
  let delay = 3000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await searchOnce(track, query);
    if (res.dailyQuota) return { quota: true, reason: res.reason };
    if (res.burst) { await sleep(delay); delay *= 2; continue; }
    return res;
  }
  return { empty: true, reason: 'burst-retries-exhausted' };
}

// build interleaved worklist: day-major so all 3 exams get early coverage
const rowsByTrack = {};
for (const track of TRACKS) {
  const { data } = await supabase.from('master_content_vault').select('day_number,topic_title').eq('track_id',track).order('day_number');
  rowsByTrack[track] = data;
}
const maxDays = Math.max(...TRACKS.map(t=>rowsByTrack[t].length));

let searched = 0, hits = 0, skipped = 0;
outer:
for (let i = 0; i < maxDays; i++) {
  for (const track of TRACKS) {
    const row = rowsByTrack[track][i];
    if (!row) continue;
    const k = `${track}::${row.day_number}`;
    if (cache[k] && cache[k].videoId) { skipped++; continue; }
    const query = buildQuery(track, row.topic_title);
    const res = await search(track, query);
    if (res.quota) { console.log(`\n⚠ DAILY QUOTA reached (${res.reason}) after ${searched} searches this run. Cache saved — re-run after Pacific-midnight reset to continue.`); break outer; }
    searched++;
    await sleep(350); // base throttle to avoid burst rate limit
    if (res.videoId) {
      cache[k] = { videoId: res.videoId, videoTitle: res.videoTitle, channel: res.channel, query };
      hits++;
      saveCache();
      if (hits % 10 === 0) console.log(`  ...${hits} new videos cached (last: ${track} D${row.day_number})`);
    } else {
      console.log(`  ! no result: ${track} D${row.day_number} q="${query}" (${res.reason||'empty'})`);
    }
  }
}
saveCache();
const totalCached = Object.values(cache).filter(v=>v&&v.videoId).length;
console.log(`\nDone this run: ${searched} searches, ${hits} new. Already-had: ${skipped}. Total cached now: ${totalCached}/300.`);
