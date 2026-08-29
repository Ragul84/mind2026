const r = await fetch('https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/topojson/india.json');
const t = await r.json();
for (const k of Object.keys(t.objects)) {
  const geoms = t.objects[k].geometries || [];
  console.log(k, 'geometries', geoms.length, 'sampleProps', JSON.stringify(geoms[0]?.properties), '|', JSON.stringify(geoms[1]?.properties));
}
// distinct state names in states object
const sn = [...new Set((t.objects.states?.geometries || []).map(g => g.properties?.st_nm))].sort();
console.log('STATES:', sn.join(' | '));
