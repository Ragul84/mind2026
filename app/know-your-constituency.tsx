import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Linking, Modal, Pressable, ActivityIndicator, Image, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import notificationService from '@/utils/notificationService';
import { recordCivicAction, getCivicProgress, BADGES, type CivicState, type Badge, type CivicAction } from '@/utils/civicProgress';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabaseService';
import { Aurora } from '@/theme/aurora-tokens';

const MP_2024: Record<string, { pc: string; state: string; mp: string; party: string; abbr: string; margin: number | null }> = require('@/assets/data/mp_2024.json');
const MLA_2026: Record<string, { ac: string; winner: string; party: string; abbr: string; state: string }> = require('@/assets/data/mla_2026.json');
const META: Record<string, { state: string; districts: number; assembly: number; lokSabha: number; population: string; tagline: string }> = require('@/assets/data/states_meta.json');
const GK: Record<string, { capital: string; language: string; formed: string; facts: string[] }> = require('@/assets/data/states_gk.json');
import { CIVICS_LESSONS, type CivicsLesson } from '@/assets/data/civics_lessons';

const norm = (s: string) => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, ' ').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '').trim();
const inr = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en-IN'));
const haptic = (k: 'light' | 'medium' | 'success' = 'light') => { try { k === 'success' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(k === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light); } catch {} };
function lev(a: string, b: string) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
function bestMatch(target: string, options: string[]): string | null { const t = norm(target); const ex = options.find((o) => norm(o) === t); if (ex) return ex; let best: string | null = null, bd = 99; for (const o of options) { const d = lev(t, norm(o)); if (d < bd) { bd = d; best = o; } } return bd <= 3 ? best : null; }

const CKAN = 'https://ckandev.indiadataportal.com/api/3/action';
const RES = 'f49a01ad-180b-4a54-8ecf-0494769d26fa';
type GP = { gp_name: string; gp_code: string; block_name: string };
type AC = { ac: string; district: string; pc: string };

// best reachable "their record" link: a Google search scoped to myneta.info lands on
// the specific person's affidavit/record page (MyNeta has no open per-name URL).
const recordUrl = (name: string, place: string, role: string) =>
  'https://www.google.com/search?q=' + encodeURIComponent(`${name} ${place} ${role} site:myneta.info`);

// state name → HindustanTimesLabs folder key (for the assembly seat list)
const stKey = (name: string) => {
  const k = (name || '').toLowerCase().replace(/&/g, '').replace(/\band\b/g, '').replace(/[^a-z]/g, '');
  const ov: Record<string, string> = { jammuandkashmir: 'jammukashmir', nctofdelhi: 'delhi', orissa: 'odisha', pondicherry: 'puducherry', uttaranchal: 'uttarakhand', dadraandnagarhavelianddamananddiu: 'dadranagarhaveli' };
  return ov[k] || k;
};

// ── Globe (globe.gl + topojson). Graphite base, single violet accent, selected
// state glows & rises. Tap state → preview (highlight); "Explore" drills to districts.
const GLOBE_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<style>
  html,body{margin:0;height:100%;width:100%;background:#05070F;overflow:hidden;}
  #g{width:100%;height:100%;}
  #ld{position:absolute;inset:0;display:flex;flex-direction:column;gap:16px;align-items:center;justify-content:center;color:#aab3c9;font-family:-apple-system,system-ui,sans-serif;font-size:14px;}
  .sp{width:36px;height:36px;border:3px solid rgba(255,255,255,0.14);border-top-color:#7C5CFC;border-radius:50%;animation:s .9s linear infinite;}
  @keyframes s{to{transform:rotate(360deg)}}
</style>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3"></script>
<script src="https://cdn.jsdelivr.net/npm/globe.gl"></script>
</head><body>
<div id="g"></div>
<div id="ld"><div class="sp"></div><div id="lt"></div></div>
<script>
  var post=function(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m));}catch(e){}};
  var world,states=[],districts=[],pcAll=[],pcByState={},acCache={},mode='dist',kind='states',selectedState=null;
  // translucent land so the night-lights glow through (alive, not flat gray)
  var GRAPHITE='rgba(74,82,138,0.50)',GRAPHITE_DIM='rgba(48,52,82,0.36)',VIOLET='rgba(143,104,255,0.78)',TINT='rgba(122,94,248,0.26)';
  function nrm(s){return (s||'').toUpperCase().replace(/&/g,'AND').replace(/[^A-Z0-9]+/g,'');}
  var selFeat=null;
  function featKey(f){ if(kind==='ac')return f.properties.AC_NAME; if(kind==='pc')return f.properties.pc_name; if(kind==='districts')return f.properties.district; return null; }
  function isSelFeat(f){ return selFeat && kind!=='states' && featKey(f)===selFeat; }
  function reapply(){ if(world) world.polygonCapColor(ck).polygonSideColor(sd).polygonStrokeColor(st).polygonAltitude(al); }
  function ck(f){ if(kind==='states'){ if(selectedState) return f.properties.st_nm===selectedState?VIOLET:GRAPHITE_DIM; return GRAPHITE; } return isSelFeat(f)?'rgba(150,112,255,0.88)':TINT; }
  function sd(f){ if(kind==='states'&&selectedState===f.properties.st_nm) return 'rgba(124,92,252,0.5)'; if(kind==='states') return 'rgba(96,106,166,0.35)'; return isSelFeat(f)?'rgba(124,92,252,0.55)':'rgba(70,80,140,0.22)'; }
  function st(f){ if(kind==='states'&&selectedState===f.properties.st_nm) return 'rgba(214,200,255,1)'; if(kind==='states') return 'rgba(172,184,236,0.62)'; return isSelFeat(f)?'rgba(222,210,255,1)':'rgba(200,208,244,0.4)'; }
  function al(f){ if(kind==='states') return selectedState===f.properties.st_nm?0.05:0.006; return isSelFeat(f)?0.045:0.006; }
  function nameOf(f){ if(kind==='states')return f.properties.st_nm; if(kind==='districts')return f.properties.district; if(kind==='ac')return (f.properties.AC_NAME||'').replace(/\\s*\\((SC|ST)\\)/i,''); return f.properties.pc_name; }
  function polys(f){var g=f.geometry;if(!g)return [];return g.type==='Polygon'?[g.coordinates]:g.coordinates;}
  function ringArea(r){var a=0;for(var i=0,n=r.length-1;i<n;i++){a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];}return a/2;}
  function ringCentroid(r){var a=0,cx=0,cy=0;for(var i=0,n=r.length-1;i<n;i++){var ff=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];a+=ff;cx+=(r[i][0]+r[i+1][0])*ff;cy+=(r[i][1]+r[i+1][1])*ff;}a=a/2;if(Math.abs(a)<1e-9)return [r[0][0],r[0][1]];return [cx/(6*a),cy/(6*a)];}
  function centerOf(f){var best=null,bestA=-1;polys(f).forEach(function(p){var r=p[0];var a=Math.abs(ringArea(r));if(a>bestA){bestA=a;best=r;}});if(!best)return {lat:22,lng:80};var c=ringCentroid(best);return {lat:c[1],lng:c[0]};}
  var curSorted=[]; // [{f,lat,lng,t,st,k,ar,small}] centroids precomputed, area-desc
  function area(f){var best=0;polys(f).forEach(function(p){var a=Math.abs(ringArea(p[0]));if(a>best)best=a;});return best;}
  function makeLabel(d){
    var el=document.createElement('div');el.textContent=d.t;
    el.style.cssText='white-space:nowrap;transform:translate(-50%,-50%);font-family:-apple-system,system-ui,sans-serif;';
    if(d.k==='states'){
      el.style.cssText+=(d.small?'pointer-events:auto;cursor:pointer;':'pointer-events:none;')+'font-size:'+(d.sel?13:10.5)+'px;font-weight:'+(d.sel?'700':'600')+';color:'+(d.sel?'#fff':'rgba(232,236,248,0.92)')+';text-shadow:0 1px 5px rgba(0,0,0,0.98);padding:5px 7px;';
      if(d.small) el.onclick=function(ev){ev.stopPropagation();previewState(d.st);};
    } else { el.style.cssText+='pointer-events:none;font-size:10px;font-weight:600;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.98);letter-spacing:0.2px;'; }
    return el;
  }
  // viewport-aware: only labels features currently in view, biggest first, capped for legibility
  function refreshLabels(){
    if(!world)return;
    if(!curSorted.length){world.htmlElementsData([]);return;}
    var pov=world.pointOfView();var alt=pov.altitude||1.25;
    var coslat=Math.max(0.3,Math.cos(pov.lat*Math.PI/180));
    var half=Math.max(2.5,alt*42);
    var cap=Math.max(8,Math.min(40,Math.round(28/alt)));
    var arr=[];
    for(var i=0;i<curSorted.length && arr.length<cap;i++){
      var d=curSorted[i];
      if(Math.abs(d.lat-pov.lat)<half && Math.abs(d.lng-pov.lng)<half/coslat){
        arr.push({lat:d.lat,lng:d.lng,t:d.t,st:d.st,k:d.k,sel:(d.k==='states'&&d.st===selectedState),small:d.small});
      }
    }
    if(kind==='states'&&selectedState){var has=false,a2;for(a2=0;a2<arr.length;a2++){if(arr[a2].st===selectedState){arr[a2].sel=true;has=true;break;}}if(!has){for(a2=0;a2<curSorted.length;a2++){if(curSorted[a2].st===selectedState){var sf=curSorted[a2];arr.push({lat:sf.lat,lng:sf.lng,t:sf.t,st:sf.st,k:'states',sel:true,small:sf.small});break;}}}}
    world.htmlElementsData(arr).htmlLat('lat').htmlLng('lng').htmlAltitude(function(d){return d.sel?0.055:0.008;}).htmlElement(makeLabel);
  }
  function setLabels(fs){
    curSorted=fs.map(function(f){var c=centerOf(f);return {f:f,lat:c.lat,lng:c.lng,t:nameOf(f),st:f.properties.st_nm,k:kind,ar:area(f),small:false};}).sort(function(a,b){return b.ar-a.ar;});
    if(kind==='states'){for(var i=0;i<curSorted.length;i++)curSorted[i].small=(i>=16);}
    refreshLabels();
  }
  function draw(fs){world.polygonsData(fs).polygonAltitude(al).polygonCapColor(ck).polygonSideColor(sd).polygonStrokeColor(st).polygonLabel(function(){return '';});setLabels(fs);}
  function fitFly(fs,ms,latShift,tighten){
    var mnx=180,mny=90,mxx=-180,mxy=-90;
    fs.forEach(function(f){polys(f).forEach(function(p){p[0].forEach(function(c){if(c[0]<60||c[0]>100||c[1]<5||c[1]>40)return;if(c[0]<mnx)mnx=c[0];if(c[0]>mxx)mxx=c[0];if(c[1]<mny)mny=c[1];if(c[1]>mxy)mxy=c[1];});});});
    if(mxx<mnx){world.pointOfView({lat:27.5,lng:81,altitude:1.35},ms||1200);return;}
    var midLat=(mny+mxy)/2,midLng=(mnx+mxx)/2;
    var dx=(mxx-mnx)*Math.cos(midLat*Math.PI/180),dy=mxy-mny,span=Math.max(dx,dy);
    var alt=Math.max(0.14,Math.min(1.35,span/26)); if(tighten)alt*=0.78; // zoom closer (esp. assembly)
    var shift=latShift?dy*0.22:0; // aim north of the region so it sits lower in the frame
    world.pointOfView({lat:midLat+shift,lng:midLng,altitude:alt},ms||1300);
    setTimeout(refreshLabels,(ms||1300)+80); // re-density labels once the camera has settled
  }

  function showStates(){kind='states';selectedState=null;draw(states);world.pointOfView({lat:27.5,lng:81,altitude:1.35},1100);post({type:'level',level:'states'});}
  function stateFeat(s){return states.filter(function(f){return f.properties.st_nm===s;});}
  function districtsFor(s){return districts.filter(function(f){return f.properties.st_nm===s;});}
  function pcsFor(s){var k=nrm(s);if(pcByState[k])return pcByState[k];for(var kk in pcByState){if(kk.indexOf(k)>=0||k.indexOf(kk)>=0)return pcByState[kk];}return [];}
  function previewState(s){selectedState=s;kind='states';draw(states);var c=centerOf(stateFeat(s)[0]||states[0]);world.pointOfView({lat:c.lat-2.5,lng:c.lng,altitude:1.0},1100);post({type:'statePreview',state:s});}
  function openSecond(s){selectedState=s;selFeat=null;
    if(mode==='dist'){kind='districts';var d=districtsFor(s);draw(d);fitFly(d.length?d:stateFeat(s),1400,0.4);}
    else if(mode==='pc'){kind='pc';ensurePC(function(){var p=pcsFor(s);draw(p);fitFly(p.length?p:districtsFor(s),1400,0.4);});}
    else if(mode==='ac'){loadAC(s);}
    post({type:'stateSelected',state:s});
  }
  function ensurePC(cb){if(pcAll.length){cb();return;}post({type:'pcLoading'});fetch('https://cdn.jsdelivr.net/gh/datameet/maps@master/parliamentary-constituencies/india_pc_2019_simplified.geojson').then(function(r){return r.json();}).then(function(g){pcAll=g.features||[];pcAll.forEach(function(f){var k=nrm(f.properties.st_name);(pcByState[k]=pcByState[k]||[]).push(f);});cb();}).catch(function(){post({type:'pcError'});});}
  function stKey(name){var k=(name||'').toLowerCase().replace(/&/g,'').replace(/\\band\\b/g,'').replace(/[^a-z]/g,'');var ov={jammuandkashmir:'jammukashmir',nctofdelhi:'delhi',orissa:'odisha',pondicherry:'puducherry',uttaranchal:'uttarakhand',dadraandnagarhavelianddamananddiu:'dadranagarhaveli'};return ov[k]||k;}
  function loadAC(s){kind='ac';selFeat=null;var key=stKey(s);if(acCache[key]){draw(acCache[key]);fitFly(acCache[key],1400,0.3,1);post({type:'acReady'});return;}post({type:'acLoading'});fetch('https://cdn.jsdelivr.net/gh/HindustanTimesLabs/shapefiles@master/state_ut/'+key+'/assembly/'+key+'_AC.json').then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(g){acCache[key]=g.features||[];draw(acCache[key]);fitFly(acCache[key],1400,0.3,1);post({type:'acReady'});}).catch(function(){post({type:'acError',state:s});mode='dist';openSecond(s);});}

  function onClick(f){
    if(kind==='states'){previewState(f.properties.st_nm);return;}
    selFeat=featKey(f);reapply();fitFly([f],800,0);
    if(kind==='districts'){post({type:'districtClick',district:f.properties.district,state:f.properties.st_nm});}
    else if(kind==='ac'){post({type:'acClick',ac:f.properties.AC_NAME,district:f.properties.DIST_NAME||'',parentPc:f.properties.PC_NAME||'',state:f.properties.ST_NAME||selectedState});}
    else{post({type:'pcClick',pc:f.properties.pc_name,state:f.properties.st_name});}
  }

  fetch('https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/topojson/india.json').then(function(r){return r.json();}).then(function(topo){
    states=topojson.feature(topo,topo.objects.states).features;
    districts=topojson.feature(topo,topo.objects.districts).features;
    world=Globe()(document.getElementById('g'))
      .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
      .backgroundColor('rgba(0,0,0,0)').showAtmosphere(true).atmosphereColor('#7aa2ff').atmosphereAltitude(0.18)
      .polygonsTransitionDuration(0).onPolygonClick(onClick);
    draw(states);
    var c=world.controls();c.autoRotate=false;c.enableDamping=true;c.minDistance=101;c.maxDistance=700;c.zoomSpeed=1.3;
    var lastLbl=0;world.onZoom(function(){var t=Date.now();if(t-lastLbl>120){lastLbl=t;refreshLabels();}});
    world.pointOfView({lat:16,lng:-62,altitude:3.3},0); // start across the world, zoomed out
    setTimeout(function(){world.pointOfView({lat:27.5,lng:81,altitude:1.35},2900);},450); // sweep + land on India
    document.getElementById('ld').style.display='none';
    post({type:'ready',states:states.map(function(f){return f.properties.st_nm;}).sort()});
  }).catch(function(e){document.getElementById('lt').innerText='Could not load the map. Check connection.';post({type:'error'});});

  window.__kyc={
    explore:function(){if(selectedState)openSecond(selectedState);},
    back:function(){showStates();},
    setMode:function(m){mode=(m==='ac'?'dist':m);if(kind!=='states'&&selectedState)openSecond(selectedState);},
    zoom:function(fac){var p=world.pointOfView();world.pointOfView({lat:p.lat,lng:p.lng,altitude:Math.max(0.15,Math.min(2.4,p.altitude*fac))},420);},
    clearSel:function(){selFeat=null;reapply();}
  };
</script>
</body></html>`;

type Selection =
  | { kind: 'dist'; district: string; state: string }
  | { kind: 'gp'; gp: GP; district: string; state: string }
  | { kind: 'pc'; pc: string; state: string }
  | { kind: 'ac'; ac: string; district: string; parentPc: string; state: string };

const MODES: { id: 'dist' | 'pc' | 'ac'; label: string }[] = [
  { id: 'dist', label: 'Districts' },
  { id: 'ac', label: 'Assembly' },
  { id: 'pc', label: 'Lok Sabha' },
];

const GP_LINKS = [
  { id: 'egram', icon: 'open-outline' as const, color: Aurora.color.emerald, title: 'Full profile on eGramSwaraj', sub: 'Official report — funds, works & members', url: 'https://egramswaraj.gov.in/knowYourPanchayat.do' },
  { id: 'pai', icon: 'leaf' as const, color: Aurora.color.emerald, title: 'SDG scorecard (PAI)', sub: 'Scores on 9 local development themes', url: 'https://pai.gov.in' },
  { id: 'cpgrams', icon: 'megaphone' as const, color: Aurora.color.rose, title: 'Report a local issue', sub: 'File a grievance on the national CPGRAMS portal', url: 'https://pgportal.gov.in' },
  { id: 'lgd', icon: 'home' as const, color: Aurora.color.royal, title: 'Local Government Directory', sub: 'Verify codes & hierarchy', url: 'https://lgdirectory.gov.in' },
];
const PANCHAYAT_FACTS = [
  'Runs your village’s water supply, sanitation, drains, streetlights and local roads.',
  'Led by an elected Sarpanch (president) and Ward Members you vote for every 5 years.',
  'The Gram Sabha — every adult voter in the village, including you — approves its plans and budget.',
  'Funded by Finance Commission grants + local taxes; plans 29 subjects under the 11th Schedule.',
];
const MP_DUTY = [
  'Makes national laws and approves the Union Budget in the Lok Sabha.',
  'Questions the central government and represents ~15–25 lakh people — you included.',
  'Gets MPLADS funds (₹5 crore/year) for local development works.',
  'Serves a 5-year term; you can write to or meet them.',
];
const MLA_DUTY = [
  'Makes state laws and approves the State Budget in the Vidhan Sabha.',
  'Handles state subjects you live with daily — police, roads, schools, health, water.',
  'MLAs elect the Chief Minister; serve a 5-year term.',
  'Represents your assembly constituency; you can petition them directly.',
];
const ACTIONS = [
  { id: 'neta', icon: 'document-text' as const, color: Aurora.color.emerald, title: "Representative's record", sub: 'Assets, education & criminal cases (MyNeta)', url: 'https://myneta.info' },
  { id: 'eci', icon: 'finger-print' as const, color: Aurora.color.amber, title: 'Voter services', sub: 'Find your seat · register · verify', url: 'https://voters.eci.gov.in' },
  { id: 'sansad', icon: 'call' as const, color: Aurora.color.indigo, title: 'Contact Parliament', sub: 'Official 18th Lok Sabha member directory', url: 'https://sansad.in/ls' },
];

// count-up animation for the India hero stats
const Counter = ({ to, suffix = '', style }: { to: number; suffix?: string; style?: any }) => {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf: any; const start = Date.now(); const dur = 900;
    const tick = () => { const t = Math.min(1, (Date.now() - start) / dur); setV(Math.round(to * (1 - Math.pow(1 - t, 3)))); if (t < 1) raf = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(raf);
  }, [to]);
  return <Text style={style}>{v}{suffix}</Text>;
};

export default function KnowYourIndia() {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<'dist' | 'pc' | 'ac'>('dist');
  const [activeState, setActiveState] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null); // state shown in preview card (not yet drilled)
  const [hint, setHint] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const [badgesOpen, setBadgesOpen] = useState(false);
  const [civic, setCivic] = useState<CivicState | null>(null);
  const [badgeToast, setBadgeToast] = useState<Badge | null>(null);
  const [reminderAt, setReminderAt] = useState<string | null>(null);
  useEffect(() => { getCivicProgress().then(setCivic); }, []);
  const handleCivic = useCallback(async (action: CivicAction, key?: string) => {
    const { state, newly } = await recordCivicAction(action, key);
    setCivic(state);
    if (newly.length) { setBadgeToast(newly[0]); haptic('success'); setTimeout(() => setBadgeToast(null), 3400); }
  }, []);

  const scheduleGramSabha = useCallback(async (gpName: string) => {
    try {
      const ok = await notificationService.requestPermissions();
      if (!ok) { setReminderAt('no-permission'); return; }
      const now = new Date(); const days = [[0, 26], [4, 1], [7, 15], [9, 2]]; const cands: Date[] = [];
      for (let y = 0; y < 2; y++) for (const [m, d] of days) cands.push(new Date(now.getFullYear() + y, m, d, 8, 0, 0, 0));
      const next = cands.filter((dt) => dt > now).sort((a, b) => a.getTime() - b.getTime())[0]; if (!next) return;
      await Notifications.scheduleNotificationAsync({ content: { title: '🏛️ Gram Sabha Day', body: `${gpName}'s Gram Sabha may meet today. Show up — that's where real local decisions get made.`, sound: 'default', data: { type: 'gram_sabha' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: next } as any });
      setReminderAt(next.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })); handleCivic('reminder');
    } catch { setReminderAt('error'); }
  }, [handleCivic]);

  // Assembly is a searchable LIST (not map polygons) — names + 2026 MLA where known
  const [acOpen, setAcOpen] = useState(false);
  const [acList, setAcList] = useState<AC[] | null>(null);
  const [acLoading, setAcLoading] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const acCache = useRef<Record<string, AC[]>>({});
  const loadAssembly = useCallback(async (state: string) => {
    setAcOpen(true); setAcQuery('');
    const key = stKey(state);
    if (acCache.current[key]) { setAcList(acCache.current[key]); return; }
    setAcLoading(true); setAcList(null);
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/gh/HindustanTimesLabs/shapefiles@master/state_ut/${key}/assembly/${key}_AC.json`);
      const j = await r.json();
      const seen = new Set<string>(); const list: AC[] = [];
      for (const f of (j.features || [])) { const p = f.properties || {}; const ac = p.AC_NAME; if (!ac || seen.has(ac)) continue; seen.add(ac); list.push({ ac, district: p.DIST_NAME || '', pc: p.PC_NAME || '' }); }
      list.sort((a, b) => a.ac.localeCompare(b.ac));
      acCache.current[key] = list; setAcList(list);
    } catch { setAcList([]); } finally { setAcLoading(false); }
  }, []);

  // heritage hero image for the state preview card (Wikipedia lead image)
  const [heroImg, setHeroImg] = useState<string | null>(null);
  const heroCache = useRef<Record<string, string | null>>({});
  const loadHeroImg = useCallback(async (state: string) => {
    const k = norm(state);
    if (heroCache.current[k] !== undefined) { setHeroImg(heroCache.current[k]); return; }
    setHeroImg(null);
    try {
      const title = encodeURIComponent(state.replace(/&/g, 'and'));
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);
      const j = await r.json();
      const url = j.originalimage?.source || j.thumbnail?.source || null;
      heroCache.current[k] = url; setHeroImg(url);
    } catch { heroCache.current[k] = null; setHeroImg(null); }
  }, []);

  // learning: state knowledge sheet + civics lessons
  const [gkOpen, setGkOpen] = useState(false);
  const [civicsOpen, setCivicsOpen] = useState(false);
  const [lesson, setLesson] = useState<CivicsLesson | null>(null);
  const openLesson = (l: CivicsLesson) => { setLesson(l); setCivicsOpen(false); haptic('light'); handleCivic('lesson', l.id); };
  const openLessonId = (id: string) => { const l = CIVICS_LESSONS.find((x) => x.id === id); if (l) openLesson(l); };

  // context-aware per-state civics lessons (fetched from Supabase, cached for speed/offline)
  const [stateCivics, setStateCivics] = useState<CivicsLesson[]>([]);
  const civicsCache = useRef<Record<string, CivicsLesson[]>>({});
  const loadStateCivics = useCallback(async (state: string) => {
    const key = norm(state);
    if (civicsCache.current[key]) { setStateCivics(civicsCache.current[key]); return; }
    try { const c = await AsyncStorage.getItem('civics_' + key); if (c) { const arr = JSON.parse(c); civicsCache.current[key] = arr; setStateCivics(arr); return; } } catch {}
    setStateCivics([]);
    try {
      const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id', 'civics_lessons').eq('content_json->>state_key', key);
      const arr: CivicsLesson[] = (data || []).map((r: any) => { const j = typeof r.content_json === 'string' ? JSON.parse(r.content_json) : r.content_json; return { id: 'state_' + key, title: j.title, icon: j.icon, color: j.color, blurb: j.blurb, sections: j.sections }; });
      civicsCache.current[key] = arr; setStateCivics(arr);
      AsyncStorage.setItem('civics_' + key, JSON.stringify(arr)).catch(() => {});
    } catch { setStateCivics([]); }
  }, []);

  const ckanStates = useRef<string[] | null>(null);
  const ckanDistByState = useRef<Record<string, string[]>>({});
  const [gpList, setGpList] = useState<GP[] | null>(null);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpQuery, setGpQuery] = useState('');
  const ckanSql = async (sql: string) => { const r = await fetch(`${CKAN}/datastore_search_sql?sql=${encodeURIComponent(sql)}`); const j = await r.json(); if (!j.success) throw new Error('ckan'); return j.result.records as any[]; };
  const resolveState = async (stNm: string) => { if (!ckanStates.current) { const rows = await ckanSql(`SELECT DISTINCT state_name FROM "${RES}"`); ckanStates.current = rows.map((r) => r.state_name); } return bestMatch(stNm, ckanStates.current); };
  const resolveDistrict = async (ck: string, d: string) => { if (!ckanDistByState.current[ck]) { const rows = await ckanSql(`SELECT DISTINCT district_name FROM "${RES}" WHERE state_name='${ck.replace(/'/g, "''")}'`); ckanDistByState.current[ck] = rows.map((r) => r.district_name); } return bestMatch(d, ckanDistByState.current[ck]); };
  const loadPanchayats = useCallback(async (district: string, state: string) => {
    setGpLoading(true); setGpList(null); setGpQuery('');
    try {
      const ckState = await resolveState(state); if (!ckState) throw new Error('s');
      const ckDist = await resolveDistrict(ckState, district); if (!ckDist) throw new Error('d');
      const filters = encodeURIComponent(JSON.stringify({ state_name: ckState, district_name: ckDist }));
      const r = await fetch(`${CKAN}/datastore_search?resource_id=${RES}&limit=5000&filters=${filters}`); const j = await r.json();
      const recs: GP[] = (j.result?.records || []).map((x: any) => ({ gp_name: x.gp_name, gp_code: x.gp_code, block_name: x.block_name }));
      recs.sort((a, b) => a.gp_name.localeCompare(b.gp_name)); setGpList(recs);
    } catch { setGpList([]); } finally { setGpLoading(false); }
  }, []);

  const onMessage = (e: any) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      switch (m.type) {
        case 'ready': setReady(true); break;
        case 'error': setError(true); break;
        case 'level': if (m.level === 'states') { setActiveState(null); setPreviewing(null); } break;
        case 'statePreview': setActiveState(m.state); setPreviewing(m.state); setHint(null); haptic('light'); loadHeroImg(m.state); loadStateCivics(m.state); handleCivic('state', m.state); break;
        case 'stateSelected': setActiveState(m.state); setPreviewing(null); setHint(null); haptic('medium'); break;
        case 'districtClick': setSelection({ kind: 'dist', district: m.district, state: m.state }); haptic('medium'); loadPanchayats(m.district, m.state); break;
        case 'pcClick': setSelection({ kind: 'pc', pc: m.pc, state: m.state }); haptic('medium'); break;
        case 'acClick': setSelection({ kind: 'ac', ac: m.ac, district: m.district, parentPc: m.parentPc, state: m.state }); haptic('medium'); break;
        case 'acLoading': setHint('Loading assembly seats…'); break;
        case 'acReady': setHint(null); break;
        case 'acError': setHint(`Assembly map unavailable for ${m.state}`); setMode('dist'); break;
        case 'pcLoading': setHint('Loading Lok Sabha seats…'); break;
      }
    } catch {}
  };

  const inject = (js: string) => webRef.current?.injectJavaScript(js + ';true;');
  const goBack = () => { if (activeState) { setActiveState(null); setPreviewing(null); setSelection(null); setAcOpen(false); inject(`window.__kyc&&window.__kyc.back()`); } else router.back(); };
  const explore = () => { haptic('medium'); setPreviewing(null); setMode('dist'); inject(`window.__kyc&&(window.__kyc.setMode("dist"),window.__kyc.explore())`); };
  const resetView = () => { haptic('light'); setActiveState(null); setPreviewing(null); setSelection(null); setAcOpen(false); inject(`window.__kyc&&window.__kyc.back()`); };
  const changeMode = (mm: 'dist' | 'pc' | 'ac') => {
    haptic('light');
    if (mm === 'ac') { if (activeState) { inject(`window.__kyc&&window.__kyc.setMode("dist")`); loadAssembly(activeState); } return; }
    setAcOpen(false); setMode(mm); inject(`window.__kyc&&window.__kyc.setMode(${JSON.stringify(mm)})`);
  };
  const tabActive = (id: 'dist' | 'pc' | 'ac') => (id === 'ac' ? acOpen : !acOpen && mode === id);
  const zoom = (f: number) => inject(`window.__kyc&&window.__kyc.zoom(${f})`);

  const mp = selection?.kind === 'pc' ? MP_2024[`${norm(selection.state)}::${norm(selection.pc)}`] : null;
  const mla = selection?.kind === 'ac' ? MLA_2026[`${norm(selection.state)}::${norm(selection.ac)}`] : null;
  const meta = previewing ? META[norm(previewing)] : null;
  const gkState = previewing || activeState;
  const gk = gkState ? GK[norm(gkState)] : null;
  const gkMeta = gkState ? META[norm(gkState)] : null;
  const filteredGp = useMemo(() => { if (!gpList) return []; const q = gpQuery.trim().toLowerCase(); return q ? gpList.filter((g) => g.gp_name.toLowerCase().includes(q) || g.block_name.toLowerCase().includes(q)) : gpList; }, [gpList, gpQuery]);
  const filteredAc = useMemo(() => { if (!acList) return []; const q = acQuery.trim().toLowerCase(); return q ? acList.filter((a) => a.ac.toLowerCase().includes(q) || a.district.toLowerCase().includes(q)) : acList; }, [acList, acQuery]);
  const earnedXp = BADGES.filter((b) => (civic?.badges || []).includes(b.id)).reduce((a, b) => a + b.xp, 0);
  const closeSheet = () => { setSelection(null); setGpList(null); setGpQuery(''); inject(`window.__kyc&&window.__kyc.clearSel()`); };

  // Android hardware back: close the top-most overlay, else step up the hierarchy, else leave
  useEffect(() => {
    const onBack = () => {
      if (lesson) { setLesson(null); return true; }
      if (gkOpen) { setGkOpen(false); return true; }
      if (civicsOpen) { setCivicsOpen(false); return true; }
      if (badgesOpen) { setBadgesOpen(false); return true; }
      if (selection) { closeSheet(); return true; }
      if (acOpen) { setAcOpen(false); return true; }
      if (activeState) { goBack(); return true; } // inside a state → back to India
      return false; // at India level → let the app navigate away
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [lesson, gkOpen, civicsOpen, badgesOpen, selection, acOpen, activeState]);

  return (
    <View style={styles.root}>
      {/* Globe fills everything */}
      <WebView ref={webRef} originWhitelist={['*']} source={{ html: GLOBE_HTML }} style={styles.webview}
        onMessage={onMessage} javaScriptEnabled domStorageEnabled mixedContentMode="always"
        androidLayerType="hardware" setSupportMultipleWindows={false} overScrollMode="never" />

      <SafeAreaView edges={['top']} style={styles.topLayer} pointerEvents="box-none">
        {/* Floating top bar */}
        <View style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity onPress={goBack} style={styles.glassCircle} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>Know Your India</Text>
            <Text style={styles.subtitle}>{activeState || 'Tap a state to begin'}</Text>
          </View>
          <TouchableOpacity onPress={() => { setCivicsOpen(true); haptic('light'); }} style={styles.glassCircle} activeOpacity={0.8}>
            <Ionicons name="book" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setBadgesOpen(true)} style={styles.glassCircle} activeOpacity={0.8}>
            <Ionicons name="trophy" size={17} color={Aurora.color.amber} />
          </TouchableOpacity>
        </View>

        {/* India hero stats — only at India level */}
        {ready && !activeState && (
          <MotiView from={{ opacity: 0, translateY: -10 }} animate={{ opacity: 1, translateY: 0 }}>
            <BlurView intensity={24} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.heroCard}>
              <View style={styles.heroHead}><Text style={styles.heroFlag}>🇮🇳</Text><Text style={styles.heroTitle}>India</Text></View>
              <View style={styles.heroStats}>
                <View style={styles.heroStat}><Text style={styles.heroVal}>1.43B+</Text><Text style={styles.heroLbl}>Population</Text></View>
                <View style={styles.heroStat}><Counter to={28} style={styles.heroVal} /><Text style={styles.heroLbl}>States</Text></View>
                <View style={styles.heroStat}><Counter to={8} style={styles.heroVal} /><Text style={styles.heroLbl}>UTs</Text></View>
                <View style={styles.heroStat}><Counter to={785} suffix="+" style={styles.heroVal} /><Text style={styles.heroLbl}>Districts</Text></View>
              </View>
              <TouchableOpacity style={styles.heroLearn} activeOpacity={0.8} onPress={() => { setCivicsOpen(true); haptic('light'); }}>
                <Ionicons name="book" size={13} color="#cdbcff" />
                <Text style={styles.heroLearnText}>Learn how India is governed</Text>
                <Ionicons name="arrow-forward" size={12} color="#cdbcff" />
              </TouchableOpacity>
            </BlurView>
          </MotiView>
        )}

        {/* Glass mode tabs — only inside a state */}
        {ready && activeState && !previewing && (
          <BlurView intensity={24} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.tabs}>
            {MODES.map((mm) => (
              <TouchableOpacity key={mm.id} onPress={() => changeMode(mm.id)} activeOpacity={0.85} style={[styles.tab, tabActive(mm.id) && styles.tabActive]}>
                <Text style={[styles.tabText, tabActive(mm.id) && styles.tabTextActive]}>{mm.label}</Text>
              </TouchableOpacity>
            ))}
          </BlurView>
        )}
      </SafeAreaView>

      {/* Zoom controls */}
      {ready && (
        <View style={styles.zoomCol} pointerEvents="box-none">
          <TouchableOpacity style={styles.glassCircle} activeOpacity={0.8} onPress={resetView}><Ionicons name="navigate" size={17} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={styles.glassCircle} activeOpacity={0.8} onPress={() => zoom(0.7)}><Ionicons name="add" size={20} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={styles.glassCircle} activeOpacity={0.8} onPress={() => zoom(1.4)}><Ionicons name="remove" size={20} color="#fff" /></TouchableOpacity>
        </View>
      )}

      {!ready && !error && (
        <View style={styles.center} pointerEvents="none"><ActivityIndicator color={Aurora.color.violet} size="large" /></View>
      )}
      {error && (
        <View style={styles.center}><Ionicons name="cloud-offline" size={32} color="#7e879c" /><Text style={styles.centerText}>Couldn’t load the map.{'\n'}Check your connection and reopen.</Text></View>
      )}
      {!!hint && <View style={styles.hintPill} pointerEvents="none"><Text style={styles.hintText}>{hint}</Text></View>}
      {!hint && ready && activeState && !previewing && !selection && !acOpen && (
        <View style={styles.hintPill} pointerEvents="none"><Text style={styles.hintText}>{mode === 'pc' ? 'Tap a Lok Sabha seat' : `Tap a district in ${activeState}`}</Text></View>
      )}

      {/* Badge toast */}
      {badgeToast && (
        <MotiView from={{ opacity: 0, translateY: 16 }} animate={{ opacity: 1, translateY: 0 }} style={styles.badgeToast} pointerEvents="none">
          <View style={styles.badgeToastIcon}><Ionicons name={badgeToast.icon as any} size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}><Text style={styles.badgeToastTitle}>Badge unlocked · +{badgeToast.xp} XP</Text><Text style={styles.badgeToastName}>{badgeToast.name}</Text></View>
        </MotiView>
      )}

      {/* State preview card (lives over the globe) */}
      {previewing && meta && !selection && (
        <MotiView from={{ opacity: 0, translateY: 40 }} animate={{ opacity: 1, translateY: 0 }} style={styles.stateCard}>
          <View style={styles.stateHero}>
            {heroImg ? <Image source={{ uri: heroImg }} style={styles.stateHeroImg} resizeMode="cover" /> : <LinearGradient colors={[Aurora.color.indigo, '#1B1E3A']} style={styles.stateHeroImg} />}
            <LinearGradient colors={['rgba(14,17,30,0)', 'rgba(14,17,30,0.55)', 'rgba(14,17,30,0.98)']} style={StyleSheet.absoluteFill} />
            <View style={styles.stateHeroText}>
              <Text style={styles.stateName}>{meta.state}</Text>
              <Text style={styles.stateTagline}>{meta.tagline}</Text>
            </View>
          </View>
          <View style={styles.stateStats}>
            <View style={styles.stateStat}><Text style={styles.stateVal}>{meta.districts}</Text><Text style={styles.stateLbl}>Districts</Text></View>
            <View style={styles.stateStat}><Text style={styles.stateVal}>{meta.assembly || '—'}</Text><Text style={styles.stateLbl}>Assembly</Text></View>
            <View style={styles.stateStat}><Text style={styles.stateVal}>{meta.lokSabha}</Text><Text style={styles.stateLbl}>Lok Sabha</Text></View>
            <View style={styles.stateStat}><Text style={styles.stateVal}>{meta.population}</Text><Text style={styles.stateLbl}>People</Text></View>
          </View>
          {gk && (
            <View style={styles.gkStrip}>
              <View style={styles.gkItem}><Text style={styles.gkVal} numberOfLines={1}>{gk.capital}</Text><Text style={styles.gkKey}>Capital</Text></View>
              <View style={styles.gkItem}><Text style={styles.gkVal} numberOfLines={1}>{gk.language}</Text><Text style={styles.gkKey}>Language</Text></View>
              <View style={styles.gkItem}><Text style={styles.gkVal} numberOfLines={1}>{gk.formed}</Text><Text style={styles.gkKey}>Formed</Text></View>
            </View>
          )}
          <View style={styles.stateBtnRow}>
            {gk && (
              <TouchableOpacity style={styles.factsBtn} activeOpacity={0.85} onPress={() => { setGkOpen(true); haptic('light'); }}>
                <Ionicons name="book-outline" size={16} color={Aurora.color.violet} /><Text style={styles.factsBtnText}>Facts & GK</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.exploreBtn2} activeOpacity={0.88} onPress={explore}>
              <Text style={styles.exploreText}>Explore</Text><Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </MotiView>
      )}

      {/* State knowledge (GK) sheet */}
      <Modal visible={gkOpen} transparent animationType="slide" onRequestClose={() => setGkOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setGkOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.dTag}>STATE · GENERAL KNOWLEDGE</Text>
          <Text style={styles.sheetName}>{gkState}</Text>
          {gkMeta && <Text style={styles.sheetSub}>{gkMeta.tagline}</Text>}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {gk && (
              <View style={[styles.idCard, { marginTop: 16 }]}>
                <View style={styles.idRow}><Text style={styles.idK}>Capital</Text><Text style={styles.idV}>{gk.capital}</Text></View>
                <View style={styles.idRow}><Text style={styles.idK}>Official language</Text><Text style={styles.idV}>{gk.language}</Text></View>
                <View style={styles.idRow}><Text style={styles.idK}>Formed</Text><Text style={styles.idV}>{gk.formed}</Text></View>
                {gkMeta && <View style={styles.idRow}><Text style={styles.idK}>Districts</Text><Text style={styles.idV}>{gkMeta.districts}</Text></View>}
                {gkMeta && <View style={styles.idRow}><Text style={styles.idK}>Assembly · Lok Sabha</Text><Text style={styles.idV}>{(gkMeta.assembly || '—')} · {gkMeta.lokSabha}</Text></View>}
                {gkMeta && <View style={[styles.idRow, { borderBottomWidth: 0 }]}><Text style={styles.idK}>Population</Text><Text style={styles.idV}>{gkMeta.population}</Text></View>}
              </View>
            )}
            <Text style={styles.sectionLabel}>Exam facts</Text>
            {gk?.facts.map((f, i) => (
              <View key={i} style={styles.factRow}><View style={styles.factDot} /><Text style={styles.factText}>{f}</Text></View>
            ))}
            <TouchableOpacity style={styles.learnCard} activeOpacity={0.85} onPress={() => { setGkOpen(false); setCivicsOpen(true); haptic('light'); }}>
              <View style={styles.learnHead}><Ionicons name="book" size={15} color={Aurora.color.violet} /><Text style={styles.learnTitle}>Learn the civics behind it</Text></View>
              <Text style={styles.learnBody}>Open the civics lessons — how India is governed, your rights, MP vs MLA & more.</Text>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={() => setGkOpen(false)}><Text style={styles.closeBtnText}>Done</Text></TouchableOpacity>
        </View>
      </Modal>

      {/* Civics lessons list */}
      <Modal visible={civicsOpen} transparent animationType="slide" onRequestClose={() => setCivicsOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setCivicsOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={[styles.dTag, { color: Aurora.color.violet }]}>CIVICS · LEARN</Text>
          <Text style={styles.sheetName}>Civics lessons</Text>
          <Text style={styles.sheetSub}>{activeState ? `Tailored for ${activeState}, plus the basics` : 'Short, exam-aligned modules on how India works'}</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {activeState && stateCivics.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 14 }]}>For {activeState}</Text>
                {stateCivics.map((l) => (
                  <TouchableOpacity key={l.id} style={styles.linkCard} activeOpacity={0.85} onPress={() => openLesson(l)}>
                    <View style={[styles.linkIcon, { backgroundColor: l.color + '18' }]}><Ionicons name={l.icon as any} size={18} color={l.color} /></View>
                    <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>{l.title}</Text><Text style={styles.linkSub}>{l.blurb}</Text></View>
                    <Ionicons name="chevron-forward" size={16} color={Aurora.color.inkMuted} />
                  </TouchableOpacity>
                ))}
                <Text style={styles.sectionLabel}>Civics basics</Text>
              </>
            )}
            {CIVICS_LESSONS.map((l, idx) => (
              <TouchableOpacity key={l.id} style={[styles.linkCard, { marginTop: idx === 0 && !(activeState && stateCivics.length > 0) ? 14 : 0 }]} activeOpacity={0.85} onPress={() => openLesson(l)}>
                <View style={[styles.linkIcon, { backgroundColor: l.color + '18' }]}><Ionicons name={l.icon as any} size={18} color={l.color} /></View>
                <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>{l.title}</Text><Text style={styles.linkSub}>{l.blurb}</Text></View>
                <Ionicons name="chevron-forward" size={16} color={Aurora.color.inkMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={() => setCivicsOpen(false)}><Text style={styles.closeBtnText}>Close</Text></TouchableOpacity>
        </View>
      </Modal>

      {/* Lesson reader */}
      <Modal visible={!!lesson} transparent animationType="slide" onRequestClose={() => setLesson(null)}>
        <Pressable style={styles.scrim} onPress={() => setLesson(null)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <TouchableOpacity style={styles.backRow} onPress={() => setLesson(null)}><Ionicons name="chevron-back" size={16} color={Aurora.color.indigo} /><Text style={styles.backRowText}>Civics lessons</Text></TouchableOpacity>
          <Text style={[styles.dTag, { color: lesson?.color }]}>CIVICS</Text>
          <Text style={styles.sheetName}>{lesson?.title}</Text>
          <Text style={styles.sheetSub}>{lesson?.blurb}</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {lesson?.sections.map((s, i) => (
              <View key={i} style={styles.lessonSection}><Text style={styles.lessonHead}>{s.head}</Text><Text style={styles.lessonBody}>{s.body}</Text></View>
            ))}
            <Text style={styles.disclaimer}>Reading civics lessons earns XP toward your Constitution Scholar badge.</Text>
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={() => setLesson(null)}><Text style={styles.closeBtnText}>Done</Text></TouchableOpacity>
        </View>
      </Modal>

      {/* Badges modal */}
      <Modal visible={badgesOpen} transparent animationType="slide" onRequestClose={() => setBadgesOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setBadgesOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.dTag}>CIVIC BADGES</Text>
          <Text style={styles.sheetName}>Your civic journey</Text>
          <Text style={styles.sheetSub}>{(civic?.badges.length || 0)}/{BADGES.length} unlocked · {earnedXp} XP earned</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 14, paddingBottom: 20 }}>
            {BADGES.map((b) => {
              const p = b.progress(civic || { states: [], panchayats: [], lessons: [], records: 0, reminders: 0, badges: [] });
              const done = (civic?.badges || []).includes(b.id);
              return (
                <View key={b.id} style={styles.badgeRow}>
                  <View style={[styles.badgeIcon, { backgroundColor: done ? Aurora.color.amber : Aurora.color.surfaceSunken }]}><Ionicons name={b.icon as any} size={20} color={done ? '#fff' : Aurora.color.inkMuted} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.badgeName}>{b.name}{done ? '  ✓' : ''}</Text>
                    <Text style={styles.badgeDesc}>{b.desc}</Text>
                    {!done && <View style={styles.badgeBar}><View style={[styles.badgeBarFill, { width: `${Math.min(100, Math.round((p.cur / p.goal) * 100))}%` }]} /></View>}
                  </View>
                  <Text style={styles.badgeXp}>+{b.xp}</Text>
                </View>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={() => setBadgesOpen(false)}><Text style={styles.closeBtnText}>Close</Text></TouchableOpacity>
        </View>
      </Modal>

      {/* Assembly seat list (pivot: list, not map polygons) */}
      <Modal visible={acOpen} transparent animationType="slide" onRequestClose={() => setAcOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setAcOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={[styles.dTag, { color: Aurora.color.violet }]}>ASSEMBLY · MLA</Text>
          <Text style={styles.sheetName}>{activeState}</Text>
          <Text style={styles.sheetSub}>{acList ? `${acList.length} assembly seats` : 'Loading…'}</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color={Aurora.color.inkMuted} />
            <TextInput value={acQuery} onChangeText={setAcQuery} placeholder="Search your constituency…" placeholderTextColor={Aurora.color.inkMuted} style={styles.searchInput} />
          </View>
          {acLoading ? (
            <View style={styles.gpLoading}><ActivityIndicator color={Aurora.color.violet} /><Text style={styles.dim}>Fetching seats…</Text></View>
          ) : acList && acList.length === 0 ? (
            <View style={styles.gpLoading}><Ionicons name="alert-circle-outline" size={26} color={Aurora.color.inkMuted} /><Text style={styles.dim}>Assembly seats unavailable for this state.</Text></View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {filteredAc.map((a) => {
                const m = activeState ? MLA_2026[`${norm(activeState)}::${norm(a.ac)}`] : null;
                return (
                  <TouchableOpacity key={a.ac} activeOpacity={0.7} style={styles.gpRow} onPress={() => { haptic('light'); setAcOpen(false); setSelection({ kind: 'ac', ac: a.ac, district: a.district, parentPc: a.pc, state: activeState || '' }); handleCivic('record'); }}>
                    <View style={[styles.gpDot, { backgroundColor: Aurora.color.violet }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gpName}>{a.ac}</Text>
                      <Text style={styles.gpBlock}>{m ? m.winner : (a.district ? a.district + ' district' : 'Tap for details')}</Text>
                    </View>
                    {m ? <View style={[styles.partyTag, { backgroundColor: Aurora.color.violet }]}><Text style={styles.partyTagText}>{m.abbr}</Text></View> : <Ionicons name="chevron-forward" size={16} color={Aurora.color.inkMuted} />}
                  </TouchableOpacity>
                );
              })}
              {filteredAc.length === 0 && <Text style={styles.dim}>No seat matches “{acQuery}”.</Text>}
            </ScrollView>
          )}
          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={() => setAcOpen(false)}><Text style={styles.closeBtnText}>Close</Text></TouchableOpacity>
        </View>
      </Modal>

      {/* Detail sheet (district list / gp / pc / ac) */}
      <Modal visible={!!selection} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.scrim} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {selection?.kind === 'dist' && (
            <View style={{ flex: 1 }}>
              <Text style={styles.dTag}>DISTRICT</Text>
              <Text style={styles.sheetName}>{selection.district}</Text>
              <Text style={styles.sheetSub}>{selection.state}{gpList ? ` · ${gpList.length} gram panchayats` : ''}</Text>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={Aurora.color.inkMuted} />
                <TextInput value={gpQuery} onChangeText={setGpQuery} placeholder="Search your panchayat…" placeholderTextColor={Aurora.color.inkMuted} style={styles.searchInput} />
              </View>
              {gpLoading ? (
                <View style={styles.gpLoading}><ActivityIndicator color={Aurora.color.violet} /><Text style={styles.dim}>Fetching panchayats…</Text></View>
              ) : gpList && gpList.length === 0 ? (
                <View style={styles.gpLoading}><Ionicons name="alert-circle-outline" size={26} color={Aurora.color.inkMuted} /><Text style={styles.dim}>Couldn’t match this district to the panchayat directory.</Text><TouchableOpacity style={styles.lgdBtn} onPress={() => Linking.openURL('https://lgdirectory.gov.in')}><Text style={styles.lgdBtnText}>Open LGD</Text></TouchableOpacity></View>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {filteredGp.map((g) => (
                    <TouchableOpacity key={g.gp_code} activeOpacity={0.7} style={styles.gpRow} onPress={() => { haptic('light'); setSelection({ kind: 'gp', gp: g, district: selection.district, state: selection.state }); setReminderAt(null); handleCivic('panchayat', g.gp_code); handleCivic('lesson', 'amendment73'); }}>
                      <View style={styles.gpDot} /><View style={{ flex: 1 }}><Text style={styles.gpName}>{g.gp_name}</Text><Text style={styles.gpBlock}>{g.block_name} block</Text></View><Ionicons name="chevron-forward" size={16} color={Aurora.color.inkMuted} />
                    </TouchableOpacity>
                  ))}
                  {filteredGp.length === 0 && <Text style={styles.dim}>No panchayat matches “{gpQuery}”.</Text>}
                </ScrollView>
              )}
            </View>
          )}

          {selection?.kind === 'gp' && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
              <TouchableOpacity style={styles.backRow} onPress={() => setSelection({ kind: 'dist', district: selection.district, state: selection.state })}><Ionicons name="chevron-back" size={16} color={Aurora.color.indigo} /><Text style={styles.backRowText}>{selection.district}</Text></TouchableOpacity>
              <Text style={styles.dTag}>GRAM PANCHAYAT</Text>
              <Text style={styles.sheetName}>{selection.gp.gp_name}</Text>
              <Text style={styles.sheetSub}>{selection.gp.block_name} block · {selection.district}, {selection.state}</Text>
              <View style={styles.eduCard}>
                <Text style={styles.eduHead}>What your gram panchayat does</Text>
                {PANCHAYAT_FACTS.map((f, i) => (<View key={i} style={styles.factRow}><View style={styles.factDot} /><Text style={styles.factText}>{f}</Text></View>))}
                <TouchableOpacity style={styles.lessonLink} activeOpacity={0.85} onPress={() => openLessonId('amendment-73-74')}>
                  <Ionicons name="book" size={14} color={Aurora.color.violet} /><Text style={styles.lessonLinkText}>Full lesson: 73rd Amendment & your local power</Text><Ionicons name="arrow-forward" size={13} color={Aurora.color.violet} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.reminderBtn} activeOpacity={0.85} onPress={() => scheduleGramSabha(selection.gp.gp_name)}>
                <Ionicons name={reminderAt && reminderAt !== 'error' && reminderAt !== 'no-permission' ? 'checkmark-circle' : 'notifications'} size={18} color={Aurora.color.indigo} />
                <Text style={styles.reminderBtnText}>{reminderAt === 'no-permission' ? 'Enable notifications to get reminders' : reminderAt === 'error' ? 'Couldn’t set reminder — try again' : reminderAt ? `Reminder set for ${reminderAt} · Gram Sabha day` : 'Remind me about the next Gram Sabha'}</Text>
              </TouchableOpacity>
              <Text style={styles.sectionLabel}>Official identity</Text>
              <View style={styles.idCard}>
                <View style={styles.idRow}><Text style={styles.idK}>LGD code</Text><Text style={styles.idV}>{selection.gp.gp_code}</Text></View>
                <View style={styles.idRow}><Text style={styles.idK}>Block</Text><Text style={styles.idV}>{selection.gp.block_name}</Text></View>
                <View style={[styles.idRow, { borderBottomWidth: 0 }]}><Text style={styles.idK}>District</Text><Text style={styles.idV}>{selection.district}, {selection.state}</Text></View>
              </View>
              <TouchableOpacity style={[styles.linkCard, { marginTop: 10 }]} activeOpacity={0.85} onPress={() => { Linking.openURL('https://egramswaraj.gov.in/knowYourPanchayat.do'); handleCivic('record'); }}>
                <View style={[styles.linkIcon, { backgroundColor: Aurora.color.emerald + '14' }]}><Ionicons name="open-outline" size={18} color={Aurora.color.emerald} /></View>
                <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>Official profile (eGramSwaraj)</Text><Text style={styles.linkSub}>Funds, works & members — opens the gov portal</Text></View>
                <Ionicons name="open-outline" size={16} color={Aurora.color.inkMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkCard} activeOpacity={0.85} onPress={() => { Linking.openURL('https://pgportal.gov.in'); handleCivic('record'); }}>
                <View style={[styles.linkIcon, { backgroundColor: Aurora.color.rose + '14' }]}><Ionicons name="megaphone" size={18} color={Aurora.color.rose} /></View>
                <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>Report a local issue</Text><Text style={styles.linkSub}>File a grievance (CPGRAMS)</Text></View>
                <Ionicons name="open-outline" size={16} color={Aurora.color.inkMuted} />
              </TouchableOpacity>
            </ScrollView>
          )}

          {(selection?.kind === 'pc' || selection?.kind === 'ac') && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
              {selection.kind === 'ac' ? (
                <>
                  <Text style={[styles.dTag, { color: Aurora.color.violet }]}>ASSEMBLY · MLA</Text>
                  <Text style={styles.sheetName}>{selection.ac}</Text>
                  <Text style={styles.sheetSub}>{selection.district ? `${selection.district} · ` : ''}{selection.state}</Text>
                  {mla ? (
                    <View style={styles.repCard}>
                      <View style={styles.repTop}><View style={[styles.repAvatar, { backgroundColor: Aurora.color.violet }]}><Ionicons name="person" size={20} color="#fff" /></View><View style={{ flex: 1 }}><Text style={[styles.repLabel, { color: Aurora.color.violet }]}>YOUR MLA · ELECTED 2026</Text><Text style={styles.repName}>{mla.winner}</Text></View></View>
                      <View style={styles.repMeta}><View style={[styles.partyTag, { backgroundColor: Aurora.color.violet }]}><Text style={styles.partyTagText}>{mla.abbr}</Text></View><Text style={styles.partyFull} numberOfLines={1}>{mla.party}</Text></View>
                      <TouchableOpacity style={styles.repVerify} activeOpacity={0.8} onPress={() => { Linking.openURL(recordUrl(mla.winner, selection.state, 'MLA')); handleCivic('record'); }}><Ionicons name="document-text-outline" size={13} color={Aurora.color.violet} /><Text style={[styles.repVerifyText, { color: Aurora.color.violet }]}>See their record on MyNeta →</Text></TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.repFallback} activeOpacity={0.85} onPress={() => { Linking.openURL('https://myneta.info'); handleCivic('record'); }}>
                      <View style={[styles.linkIcon, { backgroundColor: Aurora.color.violet + '14' }]}><Ionicons name="person" size={18} color={Aurora.color.violet} /></View>
                      <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>Your MLA</Text><Text style={styles.linkSub}>No 2026 result on file for this seat — check MyNeta</Text></View>
                      <Ionicons name="open-outline" size={16} color={Aurora.color.inkMuted} />
                    </TouchableOpacity>
                  )}
                  {!!selection.parentPc && <View style={styles.relCard}><Ionicons name="git-merge-outline" size={15} color={Aurora.color.inkSecondary} /><Text style={styles.relText}>Part of <Text style={styles.relStrong}>{selection.parentPc}</Text> Lok Sabha seat</Text></View>}
                </>
              ) : (
                <>
                  <Text style={styles.dTag}>LOK SABHA · MP</Text>
                  <Text style={styles.sheetName}>{selection.pc}</Text>
                  <Text style={styles.sheetSub}>{selection.state}</Text>
                  {mp ? (
                    <View style={styles.repCard}>
                      <View style={styles.repTop}><View style={styles.repAvatar}><Ionicons name="person" size={20} color="#fff" /></View><View style={{ flex: 1 }}><Text style={styles.repLabel}>YOUR MP · ELECTED 2024</Text><Text style={styles.repName}>{mp.mp}</Text></View></View>
                      <View style={styles.repMeta}><View style={styles.partyTag}><Text style={styles.partyTagText}>{mp.abbr}</Text></View><Text style={styles.partyFull} numberOfLines={1}>{mp.party}</Text></View>
                      {mp.margin ? <Text style={styles.repMargin}>Won by {inr(mp.margin)} votes</Text> : null}
                      <TouchableOpacity style={styles.repVerify} activeOpacity={0.8} onPress={() => { Linking.openURL(recordUrl(mp.mp, selection.state, 'MP')); handleCivic('record'); }}><Ionicons name="document-text-outline" size={13} color={Aurora.color.indigo} /><Text style={styles.repVerifyText}>See their record on MyNeta →</Text></TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.repFallback} activeOpacity={0.85} onPress={() => { Linking.openURL('https://sansad.in/ls'); handleCivic('record'); }}>
                      <View style={[styles.linkIcon, { backgroundColor: Aurora.color.indigo + '14' }]}><Ionicons name="people" size={18} color={Aurora.color.indigo} /></View>
                      <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>Find your MP</Text><Text style={styles.linkSub}>This seat was recently re-drawn — open the directory</Text></View>
                      <Ionicons name="open-outline" size={16} color={Aurora.color.inkMuted} />
                    </TouchableOpacity>
                  )}
                </>
              )}
              <View style={styles.eduCard}>
                <Text style={styles.eduHead}>{selection.kind === 'ac' ? 'What your MLA does' : 'What your MP does'}</Text>
                {(selection.kind === 'ac' ? MLA_DUTY : MP_DUTY).map((f, i) => (<View key={i} style={styles.factRow}><View style={styles.factDot} /><Text style={styles.factText}>{f}</Text></View>))}
                <TouchableOpacity style={styles.lessonLink} activeOpacity={0.85} onPress={() => openLessonId('mp-mla-ward')}>
                  <Ionicons name="book" size={14} color={Aurora.color.violet} /><Text style={styles.lessonLinkText}>Full lesson: MP vs MLA vs Ward Member</Text><Ionicons name="arrow-forward" size={13} color={Aurora.color.violet} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.linkCard, { marginTop: 12 }]} activeOpacity={0.85} onPress={() => { Linking.openURL('https://voters.eci.gov.in'); handleCivic('record'); }}>
                <View style={[styles.linkIcon, { backgroundColor: Aurora.color.amber + '14' }]}><Ionicons name="finger-print" size={18} color={Aurora.color.amber} /></View>
                <View style={styles.linkTextWrap}><Text style={styles.linkTitle}>Voter services</Text><Text style={styles.linkSub}>Find your seat, register or verify your name</Text></View>
                <Ionicons name="open-outline" size={16} color={Aurora.color.inkMuted} />
              </TouchableOpacity>
              <Text style={styles.disclaimer}>{selection.kind === 'ac' ? 'MLA shown is the 2026 assembly-election winner (Wikipedia/ECI). By-elections may change this.' : 'MP shown is the 2024 general-election winner. By-elections may change this — tap verify.'}</Text>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={closeSheet}><Text style={styles.closeBtnText}>Done</Text></TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const GLASS = 'rgba(18,22,38,0.55)';
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070F' },
  webview: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  topLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 6, gap: 10 },
  glassCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: GLASS, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: '#fff' },
  subtitle: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: 'rgba(235,238,248,0.6)', marginTop: 1 },

  heroCard: { marginHorizontal: 14, marginTop: 8, borderRadius: 18, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(16,20,34,0.34)' },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  heroFlag: { fontSize: 15 },
  heroTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff' },
  heroStats: { flexDirection: 'row', justifyContent: 'space-between' },
  heroStat: { alignItems: 'flex-start' },
  heroVal: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff', letterSpacing: -0.3 },
  heroLbl: { fontFamily: 'Inter-Medium', fontSize: 9.5, color: 'rgba(235,238,248,0.55)', marginTop: 1 },

  tabs: { flexDirection: 'row', alignSelf: 'center', marginTop: 8, borderRadius: 15, overflow: 'hidden', padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(16,20,34,0.34)' },
  tab: { paddingHorizontal: 15, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: Aurora.color.violet },
  tabText: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: 'rgba(235,238,248,0.7)' },
  tabTextActive: { color: '#fff' },

  zoomCol: { position: 'absolute', right: 14, bottom: 150, gap: 10 },

  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centerText: { fontFamily: 'Inter-Medium', fontSize: 13, color: '#9fb0d6', textAlign: 'center', lineHeight: 19 },
  hintPill: { position: 'absolute', bottom: 30, alignSelf: 'center', backgroundColor: GLASS, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  hintText: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: '#E7ECF7' },

  badgeToast: { position: 'absolute', bottom: 30, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(12,16,32,0.95)', borderRadius: 16, padding: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  badgeToastIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Aurora.color.amber, alignItems: 'center', justifyContent: 'center' },
  badgeToastTitle: { fontFamily: 'Inter-SemiBold', fontSize: 11, letterSpacing: 0.6, color: Aurora.color.amber },
  badgeToastName: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff', marginTop: 1 },

  stateCard: { position: 'absolute', left: 12, right: 12, bottom: 18, backgroundColor: 'rgba(14,17,30,0.97)', borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  stateHero: { height: 134, justifyContent: 'flex-end' },
  stateHeroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  stateHeroText: { padding: 16 },
  stateName: { fontFamily: 'Poppins-SemiBold', fontSize: 26, color: '#fff', letterSpacing: -0.5 },
  stateTagline: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(202,192,255,0.95)', marginTop: 3 },
  stateStats: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: 16, marginBottom: 16 },
  stateStat: { alignItems: 'center', flex: 1 },
  stateVal: { fontFamily: 'Poppins-SemiBold', fontSize: 19, color: '#fff' },
  stateLbl: { fontFamily: 'Inter-Medium', fontSize: 10.5, color: 'rgba(235,238,248,0.55)', marginTop: 3 },
  exploreText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#fff' },
  gkStrip: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 4, paddingBottom: 14, gap: 10 },
  gkItem: { flex: 1 },
  gkVal: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#fff' },
  gkKey: { fontFamily: 'Inter-Medium', fontSize: 9.5, color: 'rgba(235,238,248,0.5)', marginTop: 2 },
  stateBtnRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingBottom: 18 },
  factsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: 'rgba(124,92,252,0.16)', borderWidth: 1, borderColor: 'rgba(124,92,252,0.4)' },
  factsBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#cdbcff' },
  exploreBtn2: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Aurora.color.violet, borderRadius: 16, paddingVertical: 14 },

  heroLearn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  heroLearnText: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: '#cdbcff' },
  eduCard: { backgroundColor: Aurora.color.surfaceTint, borderRadius: 18, padding: 15, marginTop: 18 },
  eduHead: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: Aurora.color.ink, marginBottom: 6 },
  lessonLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 11, borderTopWidth: 1, borderTopColor: Aurora.color.hairline },
  lessonLinkText: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 13, color: Aurora.color.violet },
  factRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'flex-start' },
  factDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Aurora.color.violet, marginTop: 6 },
  factText: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 13.5, lineHeight: 20, color: Aurora.color.inkSecondary },
  lessonSection: { marginTop: 16 },
  lessonHead: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: Aurora.color.ink, marginBottom: 5 },
  lessonBody: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 22, color: Aurora.color.inkSecondary },

  // sheets (light)
  scrim: { flex: 1, backgroundColor: Aurora.color.scrim },
  sheet: { backgroundColor: Aurora.color.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 18, paddingBottom: 16, height: '80%' },
  handle: { width: 40, height: 4.5, borderRadius: 3, backgroundColor: Aurora.color.hairline, alignSelf: 'center', marginBottom: 14 },
  body: { paddingBottom: 12 },
  dTag: { fontFamily: 'Inter-SemiBold', fontSize: 11, letterSpacing: 1, color: Aurora.color.indigo },
  sheetName: { fontFamily: 'Poppins-SemiBold', fontSize: 25, color: Aurora.color.ink, marginTop: 5, letterSpacing: -0.4 },
  sheetSub: { fontFamily: 'Inter-Medium', fontSize: 13.5, color: Aurora.color.inkSecondary, marginTop: 2 },
  dim: { fontFamily: 'Inter-Medium', fontSize: 13, color: Aurora.color.inkSecondary, textAlign: 'center', lineHeight: 19, marginTop: 8, paddingHorizontal: 20 },

  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Aurora.color.surfaceSunken, borderRadius: 14, paddingHorizontal: 12, height: 44, marginTop: 14, marginBottom: 6 },
  searchInput: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 14.5, color: Aurora.color.ink, padding: 0 },
  gpLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 40 },
  gpRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Aurora.color.hairline },
  gpDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Aurora.color.violet },
  gpName: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: Aurora.color.ink },
  gpBlock: { fontFamily: 'Inter-Regular', fontSize: 12, color: Aurora.color.inkSecondary, marginTop: 1 },
  lgdBtn: { marginTop: 12, backgroundColor: Aurora.color.royal, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  lgdBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#fff' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 6 },
  backRowText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: Aurora.color.indigo },
  idCard: { backgroundColor: Aurora.color.surfaceSunken, borderRadius: 18, paddingHorizontal: 15, marginTop: 18 },
  idRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Aurora.color.hairline },
  idK: { fontFamily: 'Inter-Medium', fontSize: 13, color: Aurora.color.inkSecondary },
  idV: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: Aurora.color.ink, maxWidth: '62%', textAlign: 'right' },

  reminderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Aurora.color.surfaceTint, borderRadius: 14, paddingVertical: 13, marginTop: 14 },
  reminderBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: Aurora.color.indigo },
  learnCard: { backgroundColor: Aurora.color.surfaceTint, borderRadius: 18, padding: 15, marginTop: 14 },
  learnHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  learnTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: Aurora.color.ink },
  learnBody: { fontFamily: 'Inter-Regular', fontSize: 13, lineHeight: 20, color: Aurora.color.inkSecondary },

  sectionLabel: { fontFamily: 'Inter-SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', color: Aurora.color.inkMuted, marginTop: 22, marginBottom: 10 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Aurora.color.surfaceSunken, borderRadius: 16, padding: 13, marginBottom: 9 },
  linkIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkTextWrap: { flex: 1 },
  linkTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: Aurora.color.ink },
  linkSub: { fontFamily: 'Inter-Regular', fontSize: 12, color: Aurora.color.inkSecondary, marginTop: 1 },

  repCard: { backgroundColor: Aurora.color.surfaceTint, borderRadius: 20, padding: 16, marginTop: 18 },
  repTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  repAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Aurora.color.indigo, alignItems: 'center', justifyContent: 'center' },
  repLabel: { fontFamily: 'Inter-SemiBold', fontSize: 10.5, letterSpacing: 0.9, color: Aurora.color.indigo },
  repName: { fontFamily: 'Poppins-SemiBold', fontSize: 19, color: Aurora.color.ink, marginTop: 1, letterSpacing: -0.3 },
  repMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  partyTag: { backgroundColor: Aurora.color.indigo, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  partyTagText: { fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#fff', letterSpacing: 0.3 },
  partyFull: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 12.5, color: Aurora.color.inkSecondary },
  repMargin: { fontFamily: 'Inter-Medium', fontSize: 12.5, color: Aurora.color.inkSecondary, marginTop: 10 },
  repVerify: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  repVerifyText: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: Aurora.color.indigo },
  repFallback: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Aurora.color.surfaceTint, borderRadius: 18, padding: 14, marginTop: 18 },
  relCard: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  relText: { fontFamily: 'Inter-Regular', fontSize: 13, color: Aurora.color.inkSecondary },
  relStrong: { fontFamily: 'Inter-SemiBold', color: Aurora.color.ink },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Aurora.color.hairline },
  badgeIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeName: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: Aurora.color.ink },
  badgeDesc: { fontFamily: 'Inter-Regular', fontSize: 12, color: Aurora.color.inkSecondary, marginTop: 1 },
  badgeBar: { height: 5, borderRadius: 3, backgroundColor: Aurora.color.surfaceSunken, marginTop: 7, overflow: 'hidden' },
  badgeBarFill: { height: 5, borderRadius: 3, backgroundColor: Aurora.color.indigo },
  badgeXp: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: Aurora.color.amber },

  disclaimer: { fontFamily: 'Inter-Regular', fontSize: 11.5, lineHeight: 17, color: Aurora.color.inkMuted, marginTop: 18, textAlign: 'center' },
  closeBtn: { backgroundColor: Aurora.color.ink, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  closeBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#fff' },
});
