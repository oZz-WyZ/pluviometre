import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.PLUVIO_CONFIG || {};
export const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

export const MOIS = ['Janv.','Févr.','Mars','Avr.','Mai','Juin','Juil.','Août','Sept.','Oct.','Nov.','Déc.'];
export const $ = id => document.getElementById(id);
export const fmt = (n, d = 1) => Number(n).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
export const fmtDate = k => { const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
export const isoOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const todayISO = () => isoOf(new Date());

export function toast(msg){
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Données ---------- */

// Charge tous les relevés sous forme { 'AAAA-MM-JJ': mm }, par pages de 1000 lignes.
export async function loadData(){
  const out = {};
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE){
    const { data, error } = await sb.from('releves').select('jour,mm').order('jour').range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data) out[r.jour] = Number(r.mm);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function saveReleve(jour, mm){
  const { error } = await sb.from('releves').upsert({ jour, mm }, { onConflict: 'jour' });
  if (error) throw error;
}

export async function deleteReleve(jour){
  const { error } = await sb.from('releves').delete().eq('jour', jour);
  if (error) throw error;
}

export async function importReleves(entries){
  const rows = Object.entries(entries).map(([jour, mm]) => ({ jour, mm }));
  for (let i = 0; i < rows.length; i += 500){
    const { error } = await sb.from('releves').upsert(rows.slice(i, i + 500), { onConflict: 'jour' });
    if (error) throw error;
  }
  return rows.length;
}

/* ---------- Calculs ---------- */

export function years(data){
  const s = new Set(Object.keys(data).map(k => +k.slice(0, 4)));
  s.add(new Date().getFullYear());
  return [...s].sort((a, b) => a - b);
}
export function yearEntries(data, y){
  return Object.entries(data).filter(([k]) => k.startsWith(y + '-')).sort(([a], [b]) => a < b ? -1 : 1);
}
export function monthlyTotals(data, y){
  const t = Array(12).fill(0), c = Array(12).fill(0);
  for (const [k, v] of yearEntries(data, y)){ const m = +k.slice(5, 7) - 1; t[m] += v; c[m]++; }
  return { t, c };
}
export function monthlyAverage(data, excludeY){
  const sums = Array(12).fill(0), n = Array(12).fill(0);
  for (const y of years(data)){
    if (y === excludeY) continue;
    const { t, c } = monthlyTotals(data, y);
    for (let m = 0; m < 12; m++) if (c[m] > 0){ sums[m] += t[m]; n[m]++; }
  }
  return sums.map((s, i) => n[i] ? s / n[i] : null);
}

/* ---------- Graphique SVG ---------- */

function niceCeil(x){
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function drawBars(el, labels, values, {overlay = null, highlight = null} = {}){
  const W = 760, H = 260, P = {t: 20, r: 12, b: 34, l: 44};
  const max = Math.max(1, ...values.map(v => v || 0), ...(overlay || []).map(v => v || 0));
  const top = niceCeil(max);
  const iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / labels.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#5fd3ff"/><stop offset="1" stop-color="#3a86ff"/>
    </linearGradient></defs>`;
  for (let i = 0; i <= 4; i++){
    const v = top * i / 4, y = P.t + ih - (v / top) * ih;
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.1)"/>
          <text class="axis" x="${P.l - 8}" y="${y + 4}" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  labels.forEach((lab, i) => {
    const v = values[i] || 0, h = (v / top) * ih, x = P.l + i * bw + bw * 0.2, w = bw * 0.6, y = P.t + ih - h;
    const fill = highlight === i ? '#ffd166' : 'url(#g)';
    s += `<rect class="bar" x="${x}" y="${y}" width="${w}" height="${Math.max(h, 0)}" rx="5" fill="${fill}">
            <title>${lab} : ${fmt(v)} mm</title></rect>
          <text class="axis" x="${x + w / 2}" y="${H - 12}" text-anchor="middle">${lab}</text>`;
  });
  if (overlay) overlay.forEach((v, i) => {
    if (v == null) return;
    const x1 = P.l + i * bw + bw * 0.15, x2 = P.l + i * bw + bw * 0.85, y = P.t + ih - (v / top) * ih;
    s += `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"><title>Moyenne : ${fmt(v)} mm</title></line>`;
  });
  el.innerHTML = s + '</svg>';
}

/* ---------- Assistant de saisie (texte libre -> relevés) ---------- */

const MOIS_FR = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Transforme un texte libre en relevés. Une ligne (ou un segment séparé par « ; ») = un relevé.
// Renvoie [{ ligne, jour, mm }] ou [{ ligne, erreur }].
export function parseChat(text, today = new Date()){
  const todayIso = isoOf(today);
  const addDays = n => { const d = new Date(today); d.setDate(d.getDate() + n); return isoOf(d); };
  const fullDate = (y, m, d) => {
    const dt = new Date(y, m - 1, d);
    return dt.getMonth() === m - 1 ? isoOf(dt) : null;
  };
  const results = [];

  for (const line of text.split(/\r?\n|;/).map(l => l.trim()).filter(Boolean)){
    let s = norm(line);
    let date = null, dateFound = false, m;

    if ((m = s.match(/demain/))){ date = addDays(1); dateFound = true; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/avant[- ]hier/))){ date = addDays(-2); dateFound = true; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\bhier\b/))){ date = addDays(-1); dateFound = true; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/aujourd ?hui/))){ date = todayIso; dateFound = true; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?/))){
      let y = m[3] ? +m[3] : today.getFullYear();
      if (y < 100) y += 2000;
      date = fullDate(y, +m[2], +m[1]); dateFound = true; s = s.replace(m[0], ' ');
    }
    else if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MOIS_FR.join('|')})(?:\\s+(\\d{4}))?\\b`)))){
      const y = m[3] ? +m[3] : today.getFullYear();
      date = fullDate(y, MOIS_FR.indexOf(m[2]) + 1, +m[1]); dateFound = true; s = s.replace(m[0], ' ');
    }
    else if ((m = s.match(/\ble (\d{1,2})\b/))){
      date = fullDate(today.getFullYear(), today.getMonth() + 1, +m[1]); dateFound = true; s = s.replace(m[0], ' ');
    }

    if (!dateFound) date = todayIso;
    if (date === null){ results.push({ ligne: line, erreur: 'Date invalide' }); continue; }
    if (date > todayIso){ results.push({ ligne: line, erreur: 'Date future' }); continue; }

    const nums = [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map(x => x[0]);
    let mm = null;
    if (nums.length) mm = Number(nums[nums.length - 1].replace(',', '.'));
    else if (/\b(rien|zero|pas de pluie|sec)\b/.test(s)) mm = 0;

    if (mm === null || isNaN(mm)) results.push({ ligne: line, erreur: 'Quantité introuvable' });
    else results.push({ ligne: line, jour: date, mm: Math.round(mm * 10) / 10 });
  }
  return results;
}

export function buildRain(){
  const r = $('rain');
  if (!r) return;
  for (let i = 0; i < 45; i++){
    const d = document.createElement('div');
    d.className = 'drop';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.animationDuration = (1.2 + Math.random() * 1.6) + 's';
    d.style.animationDelay = -Math.random() * 3 + 's';
    r.appendChild(d);
  }
}
