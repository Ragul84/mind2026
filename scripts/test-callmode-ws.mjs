// Reproduce a call-mode turn against the deployed Railway voice backend and log
// every frame the server sends, so we can see whether it answers, errors, or
// hangs (e.g. OpenRouter credits exhausted).
//   node scripts/test-callmode-ws.mjs
const URL = 'wss://miga-server-production.up.railway.app/ws_story';

function runTurn(label, payload, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const frames = {};
    let firstAt = 0;
    const started = Date.now();
    const done = (why) => {
      console.log(`\n[${label}] finished: ${why}`);
      console.log(`[${label}] frame counts:`, JSON.stringify(frames));
      console.log(`[${label}] time to first frame: ${firstAt ? (firstAt - started) + 'ms' : 'NONE'}`);
      try { ws.close(); } catch {}
      resolve();
    };
    const t = setTimeout(() => done('TIMEOUT (still loading, no done frame)'), timeoutMs);
    ws.onopen = () => { console.log(`[${label}] open -> sending start`); ws.send(JSON.stringify(payload)); };
    ws.onmessage = (ev) => {
      if (!firstAt) firstAt = Date.now();
      let msg; try { msg = JSON.parse(ev.data); } catch { console.log(`[${label}] non-JSON frame:`, String(ev.data).slice(0, 120)); return; }
      const type = msg.type || '?';
      frames[type] = (frames[type] || 0) + 1;
      if (type === 'error') console.log(`[${label}] ERROR frame:`, JSON.stringify(msg).slice(0, 300));
      else if (type === 'sentence') console.log(`[${label}] sentence:`, String(msg.text || '').slice(0, 90));
      else if (type === 'audio') console.log(`[${label}] audio frame: b64len=${(msg.chunk || '').length} visemes=${(msg.visemes||[]).length} isFinal=${msg.isFinal}`);
      else if (type === 'done') { clearTimeout(t); done('done frame received'); }
      else console.log(`[${label}] ${type}`);
    };
    ws.onerror = (e) => { clearTimeout(t); console.log(`[${label}] ws error:`, e?.message || e); done('ws error'); };
    ws.onclose = (e) => { clearTimeout(t); done(`socket closed (code=${e?.code} reason=${e?.reason || ''})`); };
  });
}

const base = {
  action: 'start',
  language_code: 'en-IN',
  session_id: 'test-' + Date.now(),
  request_id: 'req-' + Date.now(),
  student_profile: { name: 'Test', exam: 'UPSC', language: 'English' },
};

await runTurn('TUTOR "hi"', {
  ...base, mode: 'tutor', input_kind: 'topic', query: 'hi',
  tutor_instruction: 'You are MIGA, a live voice tutor. Greet warmly in 1-2 short spoken sentences.',
});

await runTurn('TUTOR topic', {
  ...base, mode: 'tutor', input_kind: 'topic', query: 'Explain fundamental rights',
  tutor_instruction: 'You are MIGA, a live voice tutor. Teach in 2-4 short spoken sentences.',
});

await runTurn('STORY topic', { ...base, mode: 'story', input_kind: 'topic', query: 'Photosynthesis' });

console.log('\nAll turns done.');
