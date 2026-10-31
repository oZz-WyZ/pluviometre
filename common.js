const cfg = window.PLUVIO_CONFIG || {};

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

// Découpe un CSV (champs entre guillemets, virgule ou point-virgule) en lignes de cellules.
function parseCSV(text){
  const sep = (text.split('\n')[0].match(/;/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep){ row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

// Lit le Google Sheet : un onglet par année, nommé « 2026 », « 2025 »…
// Onglet : A1 = année, B1:M1 = mois, A2:A32 = jours 1..31, B2:M32 = mm (cellule vide = pas de relevé).
// Renvoie { 'AAAA-MM-JJ': mm }. Un onglet absent ou mal formé est ignoré.
async function loadYear(y){
  const url = `https://docs.google.com/spreadsheets/d/${cfg.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${y}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const rows = parseCSV(await res.text());
  // Google renvoie le 1er onglet si le nom n'existe pas : A1 doit contenir l'année demandée.
  if (!rows.length || String(rows[0][0]).replace(/\D/g, '') !== String(y)) return null;
  const out = {};
  for (const row of rows.slice(1, 32)){
    const day = +String(row[0]).trim();
    if (!(day >= 1 && day <= 31)) continue;
    for (let m = 0; m < 12; m++){
      const raw = String(row[m + 1] ?? '').trim().replace(',', '.');
      const mm = Number(raw);
      const dt = new Date(y, m, day);
      if (raw !== '' && isFinite(mm) && mm >= 0 && dt.getMonth() === m) out[isoOf(dt)] = mm;
    }
  }
  return out;
}

export async function loadData(){
  const now = new Date().getFullYear(), first = cfg.FIRST_YEAR || now;
  const ys = Array.from({ length: now - first + 1 }, (_, i) => first + i);
  const parts = await Promise.all(ys.map(y => loadYear(y).catch(() => null)));
  if (parts.every(p => p === null)) throw new Error('Aucun onglet lisible');
  return Object.assign({}, ...parts.filter(Boolean));
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

// Cumul de l'année y jusqu'à la date « MM-JJ » incluse.
export function cumulTo(data, y, md){
  return yearEntries(data, y).reduce((a, [k, v]) => k.slice(5) <= md ? a + v : a, 0);
}

// Records sur tout l'historique. Une série = jours consécutifs relevés (un jour manquant la coupe).
// shortcut: « année complète » = passée et >= 300 relevés ; à revoir si ton père saute souvent des jours.
export function records(data){
  const keys = Object.keys(data).sort();
  const best = (arr, f) => arr.reduce((b, x) => (!b || f(x) > f(b)) ? x : b, null);
  const worst = (arr, f) => arr.reduce((b, x) => (!b || f(x) < f(b)) ? x : b, null);
  const cur = new Date().getFullYear();
  const yrs = years(data).filter(y => y < cur && yearEntries(data, y).length >= 300)
    .map(y => ({ y, v: yearEntries(data, y).reduce((a, [, v]) => a + v, 0) }));
  const months = {};
  for (const k of keys) months[k.slice(0, 7)] = (months[k.slice(0, 7)] || 0) + data[k];
  const streak = pred => {
    let best = null, n = 0, from = null, prev = null;
    for (const k of keys){
      const next = prev && Math.round((new Date(k) - new Date(prev)) / 864e5) === 1;
      if (pred(data[k])){ if (n && next) n++; else { n = 1; from = k; } if (!best || n > best.n) best = { n, from, to: k }; }
      else n = 0;
      prev = k;
    }
    return best;
  };
  return {
    wetYear: best(yrs, x => x.v), dryYear: worst(yrs, x => x.v),
    wetMonth: best(Object.entries(months), e => e[1]),
    day: best(keys.map(k => [k, data[k]]), e => e[1]),
    dry: streak(v => v === 0), rain: streak(v => v > 0)
  };
}

/* ---------- Graphique SVG ---------- */

function niceCeil(x){
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// Une couleur stable par année (la même partout). L'or est réservé à la ligne de moyenne.
const PALETTE = ['#5fd3ff','#7bdc9a','#ff8fab','#b794f6','#ff9f68','#4dd4c6','#c3d96b','#6f9bff'];
export const yearColor = y => PALETTE[y % PALETTE.length];

export function drawBars(el, labels, values, {overlay = null, colors = null} = {}){
  // SVG à l'échelle 1:1 (viewBox = largeur réelle) pour garder des textes de 14 px lisibles.
  const W = Math.max(280, el.clientWidth || 760), H = 300, P = {t: 30, r: 12, b: 40, l: 52};
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
  const narrow = bw < 44 && labels.length === 12; // mois sur colonnes trop étroites : initiale seule
  labels.forEach((lab, i) => {
    const v = values[i] || 0, h = (v / top) * ih, x = P.l + i * bw + bw * 0.2, w = bw * 0.6, y = P.t + ih - h;
    const fill = colors ? colors[i] : 'url(#g)';
    // Barre assez large : valeur écrite dedans, en permanence. Sinon : au-dessus, au survol.
    const wide = w >= 84, inside = wide && h >= 30;
    const cls = !wide ? 'val' : inside ? 'val show in' : 'val show';
    s += `<g class="bg"><rect class="bar" x="${x}" y="${y}" width="${w}" height="${Math.max(h, 0)}" rx="5" fill="${fill}"/>
            <text class="${cls}" x="${x + w / 2}" y="${inside ? y + 22 : y - 8}" text-anchor="middle">${fmt(v)} mm</text></g>
          <text class="axis" x="${x + w / 2}" y="${H - 14}" text-anchor="middle">${narrow ? lab[0] : lab}</text>`;
  });
  if (overlay) overlay.forEach((v, i) => {
    if (v == null) return;
    const x1 = P.l + i * bw + bw * 0.15, x2 = P.l + i * bw + bw * 0.85, y = P.t + ih - (v / top) * ih;
    s += `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#ffd166" stroke-width="2.5" stroke-dasharray="4 3"><title>Moyenne : ${fmt(v)} mm</title></line>`;
  });
  el.innerHTML = s + '</svg>';
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
