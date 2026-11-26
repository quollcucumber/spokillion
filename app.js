import { PROMPTS, TIERS } from "./data.js";
import { buildIndex, matchAnswer } from "./match.js";

const ROUNDS = 7;
const SECONDS = 25;
const METRES_PER_POINT = 10;
const DAILY_MAX = ROUNDS * TIERS[TIERS.length - 1].points * METRES_PER_POINT;
const EPOCH = Date.UTC(2026, 10, 26);
const ZONES = [
  [0, "Valley floor"],
  [1000, "Foothills"],
  [2000, "Hairpins"],
  [3000, "Treeline"],
  [4000, "Glacier"],
  [5500, "Hors Catégorie"],
  [7000, "Death zone"],
  [8849, "Above Everest"],
];

const app = document.getElementById("app");
const sky = document.getElementById("sky");
const indexCache = new Map();
const byId = Object.fromEntries(PROMPTS.map((p) => [p.id, p]));
let state = null;
let timer = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const altitude = (results) => results.reduce((a, r) => a + r.points, 0) * METRES_PER_POINT;
const zoneFor = (alt) => ZONES.filter(([m]) => alt >= m).pop()[1];
const indexFor = (p) => indexCache.get(p.id) || indexCache.set(p.id, buildIndex(p)).get(p.id);

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function stageNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) + 1;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function dailyPrompts(key) {
  return shuffle(PROMPTS.map((p) => p.id), rng(hash("spokillion:" + key))).slice(0, ROUNDS);
}

const load = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function recordDaily(key, results) {
  save(`spokillion:daily:${key}`, results);
  const s = load("spokillion:stats", { streak: 0, best: 0, played: 0, last: null, bestAlt: 0 });
  if (s.last === key) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  s.streak = s.last === yKey ? s.streak + 1 : 1;
  s.best = Math.max(s.best, s.streak);
  s.played += 1;
  s.last = key;
  s.bestAlt = Math.max(s.bestAlt, altitude(results));
  save("spokillion:stats", s);
}

// ---------- stage profile ----------
const PROFILE = (() => {
  const rand = rng(42);
  const segs = 28;
  const grads = Array.from({ length: segs }, (_, i) => 0.4 + rand() * 1.2 + (i / segs) * 0.9);
  const total = grads.reduce((a, b) => a + b, 0);
  const pts = [[0, 0]];
  let acc = 0;
  grads.forEach((g, i) => {
    acc += g;
    pts.push([(i + 1) / segs, acc / total]);
  });
  return { pts, grads, max: Math.max(...grads) };
})();

function gradColor(g) {
  const r = g / PROFILE.max;
  if (r < 0.45) return "#6abf4b";
  if (r < 0.65) return "#f2c230";
  if (r < 0.82) return "#e8692b";
  return "#2b2b2b";
}

function profileSVG(alt, maxAlt) {
  const W = 1000, H = 230, L = 72, B = 26, T = 14;
  const x = (f) => L + f * (W - L - 10);
  const y = (f) => H - B - f * (H - B - T);
  const frac = Math.min(alt / maxAlt, 1);
  let fill = "";
  PROFILE.pts.slice(1).forEach(([fx, fy], i) => {
    const [px, py] = PROFILE.pts[i];
    fill += `<polygon points="${x(px)},${y(0)} ${x(px)},${y(py)} ${x(fx)},${y(fy)} ${x(fx)},${y(0)}" fill="${gradColor(PROFILE.grads[i])}" opacity="0.9"/>`;
  });
  let rx = 0, ry = 0, ridden = `${x(0)},${y(0)}`;
  for (let i = 1; i < PROFILE.pts.length; i++) {
    const [px, py] = PROFILE.pts[i - 1];
    const [fx, fy] = PROFILE.pts[i];
    if (fy >= frac) {
      const t = fy === py ? 0 : (frac - py) / (fy - py);
      rx = px + t * (fx - px);
      ry = frac;
      ridden += ` ${x(rx)},${y(ry)}`;
      break;
    }
    ridden += ` ${x(fx)},${y(fy)}`;
    rx = fx;
    ry = fy;
  }
  const outline = PROFILE.pts.map(([fx, fy]) => `${x(fx)},${y(fy)}`).join(" ");
  let axis = "";
  const step = maxAlt > 12000 ? 4000 : 2000;
  for (let m = 0; m <= maxAlt; m += step) {
    const yy = y(m / maxAlt);
    axis += `<line x1="${L}" x2="${W - 10}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 8}" y="${yy + 4}" class="axis">${fmt(m)} m</text>`;
  }
  const ev = 8849 / maxAlt;
  if (ev <= 1) axis += `<line x1="${L}" x2="${W - 10}" y1="${y(ev)}" y2="${y(ev)}" class="everest"/><text x="${W - 14}" y="${y(ev) - 5}" class="axis end">Everest 8,849 m</text>`;
  const cx = x(rx), cy = y(ry);
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Climb profile, ${fmt(alt)} metres">
    ${axis}${fill}
    <polyline points="${outline}" class="outline"/>
    <polyline points="${ridden}" class="ridden"/>
    <g transform="translate(${cx},${cy})" class="rider">
      <circle r="6" class="rider-dot"/>
      <g transform="translate(0,-26)">
        <circle cx="-11" cy="10" r="8" class="bike"/><circle cx="11" cy="10" r="8" class="bike"/>
        <path d="M-11 10 L-3 -2 L9 -2 L11 10 M-3 -2 L1 10 L9 -2 M-5 -5 L-1 -5 M9 -2 L8 -7 L12 -8" class="bike"/>
        <path d="M-2 -6 L6 -16 L10 -10" class="jersey"/><circle cx="8" cy="-20" r="4" class="jersey"/>
      </g>
    </g>
  </svg>`;
}

function setSky(alt, maxAlt) {
  sky.style.setProperty("--h", Math.min(alt / maxAlt, 1).toFixed(3));
}

// ---------- screens ----------
function home() {
  stopTimer();
  const key = todayKey();
  const done = load(`spokillion:daily:${key}`, null);
  const s = load("spokillion:stats", { streak: 0, best: 0, played: 0, bestAlt: 0 });
  setSky(0, 1);
  app.innerHTML = `
    <section class="home">
      <div class="logo">SPOK<span class="dot">I</span>LLION</div>
      <p class="tag">the daily climb</p>
      <p class="lede">Seven cycling prompts. Name something that fits — the rarer your answer, the higher you climb.</p>
      <div class="buttons">
        <button class="btn primary" id="daily">${done ? "See today's stage" : "Ride today's stage"}</button>
        <button class="btn" id="unlimited">Unlimited climb</button>
      </div>
      <p class="stage-no">Stage #${stageNumber(key)} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      <div class="stats">
        <div><b>${s.streak}</b><span>day streak</span></div>
        <div><b>${s.best}</b><span>best streak</span></div>
        <div><b>${s.played}</b><span>stages</span></div>
        <div><b>${fmt(s.bestAlt)} m</b><span>highest</span></div>
      </div>
      <details class="how">
        <summary>How to play</summary>
        <ol>
          <li>Every day, everyone gets the same seven prompts, like “Name a Tour de France climb”.</li>
          <li>You get ${SECONDS} seconds per prompt. Wrong guesses are just a <b>puncture</b>: patch up and keep trying until the clock runs out. Small typos are fine.</li>
          <li>Common answers barely move you. Rare-but-real ones send you up the mountain: ${METRES_PER_POINT} m per point.</li>
          <li>Your first correct answer locks in. Running out of time is a <b>bonk</b> (0 m).</li>
        </ol>
        <ul class="tiers">${TIERS.map((t) => `<li><span class="sw" style="background:${t.color}"></span>${t.name}<em>${t.points} pts</em></li>`).join("")}</ul>
        <p class="fine">Rarity tiers are our own editorial guesses, not live player stats.</p>
      </details>
    </section>`;
  document.getElementById("daily").onclick = () => (done ? finish({ mode: "daily", key, prompts: dailyPrompts(key), results: done }) : start("daily"));
  document.getElementById("unlimited").onclick = () => start("unlimited");
}

function start(mode) {
  const key = todayKey();
  const prompts = mode === "daily" ? dailyPrompts(key) : shuffle(PROMPTS.map((p) => p.id), Math.random);
  state = { mode, key, prompts, results: [] };
  question();
}

function header() {
  const alt = altitude(state.results);
  const maxAlt = state.mode === "daily" ? DAILY_MAX : Math.max(DAILY_MAX, Math.ceil((alt * 1.25) / 1000) * 1000);
  setSky(alt, maxAlt);
  const n = state.results.length + (state.phase === "question" ? 1 : 0);
  const label = state.mode === "daily" ? `Stage #${stageNumber(state.key)} · Prompt ${Math.min(n, ROUNDS)}/${ROUNDS}` : `Unlimited · Prompt ${n}`;
  return `
    <header class="bar">
      <button class="link" id="home">← Spokillion</button>
      <span>${label}</span>
      <span class="alt"><b>${fmt(alt)} m</b> · ${zoneFor(alt)}</span>
    </header>
    ${profileSVG(alt, maxAlt)}`;
}

function bindHome() {
  document.getElementById("home").onclick = () => {
    if (state && state.mode === "daily" && state.results.length < ROUNDS && !confirm("Leave this stage? Your progress will be lost.")) return;
    home();
  };
}

function currentPrompt() {
  if (state.mode === "unlimited" && state.results.length >= state.prompts.length) {
    state.prompts.push(...shuffle(PROMPTS.map((p) => p.id), Math.random));
  }
  return byId[state.prompts[state.results.length]];
}

function question() {
  state.phase = "question";
  const p = currentPrompt();
  app.innerHTML = `
    ${header()}
    <section class="card">
      <h1 class="prompt">${esc(p.q)}</h1>
      <div class="timer"><div id="fill"></div></div>
      <form id="form" autocomplete="off">
        <input id="answer" type="text" placeholder="Type your answer…" maxlength="80" autocapitalize="off" spellcheck="false" />
        <div class="row">
          <button class="btn primary" type="submit">Submit</button>
          <button class="btn ghost" type="button" id="pass">Pass</button>
        </div>
        <p class="msg" id="msg"></p>
        <p class="misses" id="misses"></p>
      </form>
    </section>`;
  bindHome();
  const input = document.getElementById("answer");
  input.focus();
  const misses = [];
  const msg = document.getElementById("msg");
  document.getElementById("form").onsubmit = (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    const m = matchAnswer(indexFor(p), v);
    if (m && m.ambiguous) {
      msg.textContent = "More than one rider has that surname: add a first name.";
      input.select();
      return;
    }
    if (!m) {
      misses.push(v);
      msg.textContent = `Puncture! “${v}” isn't on our list. Keep trying.`;
      document.getElementById("misses").innerHTML = misses.map((x) => `<s>${esc(x)}</s>`).join(" · ");
      input.value = "";
      input.classList.remove("shake");
      void input.offsetWidth;
      input.classList.add("shake");
      return;
    }
    answer(p, v, m, "ok", misses);
  };
  document.getElementById("pass").onclick = () => answer(p, "", null, "pass", misses);
  startTimer(() => answer(p, "", null, "bonk", misses));
}

function startTimer(onEnd) {
  stopTimer();
  const t0 = performance.now();
  const fill = document.getElementById("fill");
  const tick = () => {
    const left = 1 - (performance.now() - t0) / (SECONDS * 1000);
    if (left <= 0) {
      timer = null;
      onEnd();
      return;
    }
    fill.style.width = `${left * 100}%`;
    fill.className = left < 0.25 ? "low" : "";
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}
function stopTimer() {
  if (timer) cancelAnimationFrame(timer);
  timer = null;
}

function answer(p, input, m, reason, misses = []) {
  stopTimer();
  const tier = m ? m.tier : -1;
  state.results.push({ id: p.id, input, display: m ? m.display : null, tier, points: m ? TIERS[tier].points : 0, reason, misses });
  reveal(p);
}

function reveal(p) {
  state.phase = "reveal";
  const r = state.results[state.results.length - 1];
  const last = state.mode === "daily" && state.results.length >= ROUNDS;
  if (last) recordDaily(state.key, state.results);
  let body;
  if (r.tier >= 0) {
    const t = TIERS[r.tier];
    const note = p.notes && p.notes[r.display];
    body = `
      <div class="badge" style="background:${t.color}">${t.name}</div>
      <h2 class="answer">${esc(r.display)}</h2>
      <p class="gain">+${t.points} pts · <b>+${fmt(t.points * METRES_PER_POINT)} m</b></p>
      ${note ? `<p class="note">${esc(note)}</p>` : ""}`;
  } else {
    const title = { bonk: "Bonk!", pass: "Soft-pedalled" }[r.reason];
    const why = { bonk: "Out of time.", pass: "You let this one go." }[r.reason];
    const tries = r.misses && r.misses.length ? `<p class="misses">Punctures: ${r.misses.map((x) => `<s>${esc(x)}</s>`).join(" · ")}</p>` : "";
    body = `<div class="badge none">No points</div><h2 class="answer">${title}</h2><p class="gain">${why}</p>${tries}`;
  }
  const rarer = p.tiers.slice(Math.max(r.tier + 1, 3)).flat();
  const examples = shuffle(rarer, Math.random).slice(0, 3).map((a) => a.split("|")[0]);
  app.innerHTML = `
    ${header()}
    <section class="card reveal">
      <p class="prompt small">${esc(p.q)}</p>
      ${body}
      ${examples.length ? `<p class="rarer">Rarer picks: ${examples.map(esc).join(" · ")}</p>` : ""}
      <div class="row">
        <button class="btn primary" id="next">${last ? "See results" : "Next prompt →"}</button>
        ${state.mode === "unlimited" ? `<button class="btn ghost" id="end">End ride</button>` : ""}
      </div>
    </section>`;
  bindHome();
  const next = document.getElementById("next");
  next.onclick = () => (last ? finish(state) : question());
  setTimeout(() => next.focus(), 250);
  const end = document.getElementById("end");
  if (end) end.onclick = () => finish(state);
}

function shareText(st) {
  const alt = altitude(st.results);
  const squares = st.results.map((r) => (r.tier >= 0 ? TIERS[r.tier].emoji : "⬛")).join("");
  const title = st.mode === "daily" ? `Spokillion Stage #${stageNumber(st.key)}` : `Spokillion Unlimited (${st.results.length} prompts)`;
  return `${title} 🚴 ${fmt(alt)} m · ${zoneFor(alt)}\n${squares}\n${location.origin}${location.pathname}`;
}

function finish(st) {
  state = { ...st, phase: "done" };
  stopTimer();
  const alt = altitude(st.results);
  const maxAlt = st.mode === "daily" ? DAILY_MAX : Math.max(DAILY_MAX, Math.ceil((alt * 1.25) / 1000) * 1000);
  setSky(alt, maxAlt);
  const rows = st.results
    .map((r) => {
      const p = byId[r.id];
      const t = r.tier >= 0 ? TIERS[r.tier] : null;
      const all = p.tiers
        .map((tier, i) => (tier.length ? `<div class="tier-row"><span class="sw" style="background:${TIERS[i].color}"></span><b>${TIERS[i].name}</b> ${tier.map((a) => esc(a.split("|")[0])).join(", ")}</div>` : ""))
        .reverse()
        .join("");
      return `<details class="res">
        <summary><span class="sw" style="background:${t ? t.color : "#333"}"></span><span class="q">${esc(p.q)}</span><span class="a">${t ? esc(r.display) : r.misses && r.misses.length ? `<s>${esc(r.misses[r.misses.length - 1])}</s>` : "—"}</span><span class="p">${t ? `+${fmt(t.points * METRES_PER_POINT)} m` : "0 m"}</span></summary>
        <div class="all">${all}</div>
      </details>`;
    })
    .join("");
  app.innerHTML = `
    <header class="bar"><button class="link" id="home">← Spokillion</button><span>${st.mode === "daily" ? `Stage #${stageNumber(st.key)} results` : "Unlimited results"}</span><span></span></header>
    ${profileSVG(alt, maxAlt)}
    <section class="card done">
      <p class="small">You climbed</p>
      <h1 class="big">${fmt(alt)} m</h1>
      <p class="zone">${zoneFor(alt)}${alt >= 8849 ? " — higher than Everest!" : ""}</p>
      <pre class="share">${esc(shareText(st))}</pre>
      <div class="row">
        <button class="btn primary" id="share">Copy result</button>
        <button class="btn" id="again">${st.mode === "daily" ? "Unlimited climb" : "Ride again"}</button>
      </div>
      <h3>Your answers <span class="fine">(tap a prompt to see every accepted answer)</span></h3>
      ${rows}
      ${st.mode === "daily" ? `<p class="fine">New stage at midnight.</p>` : ""}
    </section>`;
  document.getElementById("home").onclick = home;
  document.getElementById("again").onclick = () => start("unlimited");
  document.getElementById("share").onclick = async (e) => {
    const text = shareText(st);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      e.target.textContent = "Copied!";
    } catch {
      e.target.textContent = "Couldn't copy";
    }
  };
}

home();
