const PARTICLES = new Set(["van", "der", "den", "de", "di", "da", "von", "du", "le", "la", "ten", "del", "dos", "uttrup"]);

export function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/&/g, "and")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Sound-alike spelling folded away so e.g. "Pogachar", "Merx" or "Cipollini" score closer.
function loose(s) {
  return s.replace(/ph/g, "f").replace(/ck|q/g, "k").replace(/ch/g, "c").replace(/y/g, "i").replace(/[wv]/g, "v").replace(/z/g, "s").replace(/x/g, "ks").replace(/([^aeiou])\1+/g, "$1");
}

function surnameKeys(display) {
  const words = display.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  if (words.length < 2) return [];
  const keys = [normalize(words[words.length - 1])];
  let i = words.length - 2;
  while (i > 0 && PARTICLES.has(words[i].toLowerCase())) {
    keys.push(normalize(words.slice(i).join("")));
    i--;
  }
  return keys;
}

// Exact alias keys plus, for people prompts, unique surnames. Surnames shared
// by several riders go in `ambiguous` so the player can be asked to be specific.
export function buildIndex(prompt) {
  const entries = [];
  prompt.tiers.forEach((tier, t) =>
    tier.forEach((raw) => {
      const aliases = raw.split("|");
      entries.push({ display: aliases[0], tier: t, keys: aliases.map(normalize).filter(Boolean) });
    })
  );
  const map = new Map();
  const ambiguous = new Set();
  for (const e of entries) for (const k of e.keys) map.set(k, e);
  if (prompt.people) {
    const counts = new Map();
    const owner = new Map();
    for (const e of entries)
      for (const k of new Set(surnameKeys(e.display))) {
        counts.set(k, (counts.get(k) || 0) + 1);
        owner.set(k, e);
      }
    for (const [k, c] of counts) {
      if (map.has(k) || k.length < 3) continue;
      if (c === 1) map.set(k, owner.get(k));
      else ambiguous.add(k);
    }
  }
  return { entries, map, ambiguous };
}

export function matchAnswer(index, input) {
  const key = normalize(input);
  if (!key) return null;
  if (index.map.has(key)) return index.map.get(key);
  if (index.ambiguous.has(key)) return { ambiguous: true };
  if (key.length < 4 || /^\d+$/.test(key)) return null;
  const lkey = loose(key);
  let best = null;
  let bestD = 99;
  const consider = (k, e) => {
    if (k.length < 4 || k[0] !== key[0]) return;
    const L = Math.min(key.length, k.length);
    const allowed = L < 5 ? 0 : L <= 7 ? 1 : L <= 11 ? 2 : 3;
    const d = Math.min(levenshtein(key, k), levenshtein(lkey, loose(k)));
    if (d <= allowed && d < bestD) {
      bestD = d;
      best = e;
    }
  };
  for (const [k, e] of index.map) consider(k, e);
  for (const k of index.ambiguous) consider(k, AMBIGUOUS);
  if (!best || best === AMBIGUOUS) return best && { ambiguous: true };
  return { ...best, corrected: true };
}

const AMBIGUOUS = {};
