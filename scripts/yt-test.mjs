import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const key = env.YOUTUBE_API_KEY;
const q = 'Indian Polity Fundamental Rights UPSC';
const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&relevanceLanguage=en&maxResults=3&q=${encodeURIComponent(q)}&key=${key}`;
const r = await fetch(url);
const j = await r.json();
if (j.error) { console.log('ERROR', r.status, JSON.stringify(j.error.errors||j.error)); process.exit(1); }
console.log('OK', r.status, '— results:', (j.items||[]).length);
for (const it of (j.items||[])) console.log(' ', it.id.videoId, '|', it.snippet.title);
