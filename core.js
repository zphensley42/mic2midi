// Pure logic: pitch detection (YIN), frames -> notes, notes -> SMF bytes. No DOM, so node can test it.

// buf: Float32Array time-domain samples. Returns Hz, or 0 if unvoiced.
export function yin(buf, sr) {
  const n = buf.length >> 1, d = new Float32Array(n);
  for (let tau = 1; tau < n; tau++) {
    let s = 0;
    for (let i = 0; i < n; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  let run = 0; d[0] = 1;
  for (let tau = 1; tau < n; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
  // ponytail: range ~sr/n .. 2kHz (whistle). threshold 0.15 = YIN paper default; lower = stricter voicing.
  for (let tau = Math.floor(sr / 2000); tau < n - 1; tau++) {
    if (d[tau] < 0.15) {
      while (tau + 1 < n - 1 && d[tau + 1] < d[tau]) tau++;
      const a = d[tau - 1], b = d[tau], c = d[tau + 1], sh = (a - c) / (2 * (a - 2 * b + c));
      return sr / (tau + (isFinite(sh) ? sh : 0));
    }
  }
  return 0;
}

// frames: [{t sec, f Hz, rms}] -> notes [{n midi, s sec, e sec, v velocity}]
// mode 'onset': one note per *sound* (starts at silence or a re-attack = sudden jump in loudness); pitch inside a sound
//   is ignored except as one value: src 'avg' = median over the sound, 'attack' = median of its first ~150ms.
// mode 'pitch': also split whenever pitch moves (legato humming). snap = extra semitones of drift tolerated.
// smooth (sec): median window, min note length, gap bridging.
// tail (0..1): frames quieter than tail * loudest of last 0.4s are a fading release (pitch sags) = silence.
// attack: loudness ratio vs the previous 100ms that counts as a re-attack.
export function transcribe(frames, gate, { smooth = 0.12, snap = 0.25, tail = 0.15, mode = 'onset', src = 'avg', attack = 1.6 } = {}) {
  const x = frames.map((fr, i) => {
    let peak = fr.rms;
    for (let j = i - 1; j >= 0 && frames[j].t > fr.t - 0.4; j--) peak = Math.max(peak, frames[j].rms);
    return fr.f && fr.rms > gate && fr.rms >= tail * peak ? 69 + 12 * Math.log2(fr.f / 440) : NaN;
  });
  const r = smooth / 2, minLen = Math.max(0.06, smooth);
  let lo = 0, hi = 0, cur = -1;
  const voiced = [], held = []; // per frame: mostly-voiced?, hysteresis-held pitch (pitch mode)
  x.forEach((_, i) => {
    while (frames[lo].t < frames[i].t - r) lo++;
    while (hi < frames.length && frames[hi].t <= frames[i].t + r) hi++;
    const w = x.slice(lo, hi).filter(v => v === v).sort((a, b) => a - b);
    if (voiced[i] = w.length * 2 >= hi - lo) {
      const med = w[w.length >> 1];
      if (cur < 0 || Math.abs(med - cur) > 0.5 + snap) cur = Math.min(127, Math.max(0, Math.round(med)));
      held[i] = cur;
    } else held[i] = cur = -1;
  });
  const med = a => { a = [...a].sort((p, q) => p - q); return a[a.length >> 1]; };
  const raw = []; let seg = null;
  frames.forEach((fr, i) => {
    const end = i + 1 < frames.length ? frames[i + 1].t : fr.t + 0.02;
    if (!voiced[i]) { seg = null; return; }
    if (seg && mode === 'onset' && fr.t - seg.s > 0.12) { // re-attack = louder than everything in the previous 100ms by `attack`x
      let low = Infinity;
      for (let j = i - 1; j >= 0 && frames[j].t > fr.t - 0.1; j--) low = Math.min(low, frames[j].rms);
      if (fr.rms > low * attack) seg = null;
    }
    if (seg && mode === 'pitch' && seg.n !== held[i]) seg = null;
    if (!seg) raw.push(seg = { n: held[i], s: fr.t, e: end, r: 0, c: 0, xs: [] });
    seg.e = end; seg.r += fr.rms; seg.c++;
    if (x[i] === x[i]) seg.xs.push([fr.t - seg.s, x[i]]);
  });
  if (mode === 'onset') for (const g of raw) {
    const pick = src === 'attack' ? g.xs.filter(([dt]) => dt >= 0.03 && dt <= 0.18) : g.xs;
    const use = pick.length ? pick : g.xs;
    g.n = use.length ? Math.min(127, Math.max(0, Math.round(med(use.map(u => u[1]))))) : -1;
  }
  const out = [];
  for (const n of raw.filter(n => n.n >= 0 && n.e - n.s >= minLen)) {
    const p = out.at(-1);
    if (p && n.s - p.e < minLen) { // gap left by a dropped blip: merge or go legato
      if (p.n === n.n && mode === 'pitch') { p.e = n.e; p.r += n.r; p.c += n.c; continue; } // onset mode keeps repeats separate
      p.e = n.s;
    }
    out.push(n);
  }
  return out.map(({ n, s, e, r, c }) => ({ n, s, e, v: Math.min(127, Math.round(30 + r / c * 400)) }));
}

// Pin starts to a grid and lengths to common note values, measured from the first note's onset.
// grid/lengths in beats (1 = quarter): 0 = off, .25 = sixteenth, .5 = eighth, 1 = quarter.
const LENS = [.25, .5, .75, 1, 1.5, 2, 3, 4]; // ponytail: 16th..whole incl. dotted; longer holds cap at a whole note (tie notes in DAW)
export function quantize(notes, bpm, grid) {
  if (!grid || !notes.length) return notes;
  const spb = 60 / bpm, o = notes[0].s;
  const q = notes.map(n => ({ ...n, b: Math.round((n.s - o) / spb / grid) * grid, d: (n.e - n.s) / spb }));
  const out = [];
  q.forEach((n, i) => {
    const next = q[i + 1];
    if (next && next.b <= n.b) return; // two notes landed on one grid slot: later one wins
    const room = next ? next.b - n.b : Infinity;
    const ok = LENS.filter(l => l >= grid && l <= room);
    const len = ok.length ? ok.reduce((a, l) => Math.abs(l - n.d) < Math.abs(a - n.d) ? l : a) : room;
    out.push({ n: n.n, v: n.v, s: o + n.b * spb, e: o + (n.b + len) * spb });
  });
  return out;
}

// Format-0 SMF, 480 ppq. Leading silence trimmed.
export function toMidi(notes, bpm = 120) {
  const base = notes[0]?.s ?? 0, tick = t => Math.round((t - base) * bpm * 8), us = Math.round(60e6 / bpm);
  const vlq = v => { const b = [v & 127]; while (v >>= 7) b.unshift((v & 127) | 128); return b; };
  const u32 = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ev = notes.flatMap(n => [[tick(n.s), 1, n.n, n.v], [tick(n.e), 0, n.n, 0]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]); // off before on at same tick
  const t = [0, 0xFF, 0x51, 3, us >> 16, (us >> 8) & 255, us & 255]; let last = 0;
  for (const [k, on, p, v] of ev) { t.push(...vlq(k - last), on ? 0x90 : 0x80, p, v); last = k; }
  t.push(0, 0xFF, 0x2F, 0);
  return new Uint8Array([77, 84, 104, 100, ...u32(6), 0, 0, 0, 1, 0x01, 0xE0, 77, 84, 114, 107, ...u32(t.length), ...t]);
}
