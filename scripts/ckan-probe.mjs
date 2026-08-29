const RES = 'f49a01ad-180b-4a54-8ecf-0494769d26fa';
const base = 'https://ckandev.indiadataportal.com/api/3/action/datastore_search_sql?sql=';
const sql = `SELECT DISTINCT district_name FROM "${RES}" WHERE state_name='Tamil Nadu' ORDER BY district_name`;
const r = await fetch(base + encodeURIComponent(sql));
const j = await r.json();
console.log('success', j.success, 'count', j.result?.records?.length);
console.log((j.result?.records || []).map(x => x.district_name).join(' | '));
