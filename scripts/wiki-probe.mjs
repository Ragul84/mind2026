const API = 'https://en.wikipedia.org/w/api.php';
const enc = encodeURIComponent;
const page = '2026 Kerala Legislative Assembly election';
const clean = (h) => h.replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').replace(/\[\w+\]/g, '').replace(/\s+/g, ' ').trim();
const sr = await fetch(`${API}?action=parse&page=${enc(page)}&prop=sections&format=json&origin=*`);
const sj = await sr.json();
const secs = (sj.parse?.sections || []).filter((x) => /constituenc|result/i.test(x.line));
console.log('sections:', secs.map((s) => `§${s.index} ${s.line}`).join(' | '));
const idx = (sj.parse?.sections || []).find((x) => /results by constituency/i.test(x.line))?.index
  || secs.find((x) => /constituenc/i.test(x.line))?.index;
console.log('using §', idx);
const r = await fetch(`${API}?action=parse&page=${enc(page)}&section=${idx}&prop=text&format=json&origin=*`);
const j = await r.json();
const html = j.parse?.text?.['*'] || '';
console.log('len', html.length, 'tables', (html.match(/<table/g) || []).length, 'data-sort-value count', (html.match(/data-sort-value=/g) || []).length);
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]).slice(0, 7);
rows.forEach((row, i) => {
  const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));
  const dsv = [...row.matchAll(/data-sort-value="([^"]+)"/g)].map((m) => m[1]);
  console.log(`R${i}`, JSON.stringify(cells.slice(0, 9)), 'DSV', JSON.stringify(dsv.slice(0, 2)));
});
