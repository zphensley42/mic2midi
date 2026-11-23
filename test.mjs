// Run: node test.mjs
import assert from 'node:assert';
import { yin, transcribe, quantize, toMidi } from './core.js';

const sr = 48000, buf = new Float32Array(2048);
// A4 0.5s, C5 0.5s, silence 0.3s, A4 0.4s
const tone = t => t < .5 ? 440 : t < 1 ? 523.25 : t < 1.3 ? 0 : t < 1.7 ? 440 : -1;
const frames = [];
for (let t = 0; tone(t) >= 0; t += 0.016) {
  const f = tone(t); let s2 = 0;
  for (let i = 0; i < buf.length; i++) { buf[i] = f ? 0.3 * Math.sin(2 * Math.PI * f * (t + i / sr)) : 0; s2 += buf[i] ** 2; }
  frames.push({ t, f: yin(buf, sr), rms: Math.sqrt(s2 / buf.length) });
}
const P = { mode: 'pitch' };
const notes = transcribe(frames, 0.01, P);
assert.deepStrictEqual(notes.map(n => n.n), [69, 72, 69]);
assert(Math.abs(notes[0].e - notes[0].s - 0.5) < 0.1);

const m = toMidi(notes);
assert.strictEqual(String.fromCharCode(...m.slice(0, 4)), 'MThd');
assert.strictEqual(m.filter((b, i) => b === 0x90 && i > 22).length >= 3, true);
assert.deepStrictEqual([...m.slice(-3)], [0xFF, 0x2F, 0]);
assert.strictEqual(toMidi([]).length > 20, true); // empty ok
// wobble: 1s of A4 with a 40ms A#4 blip + 0.6 semitone drift => one solid note
const wob = []; for (let t = 0; t < 1; t += 0.016) wob.push({ t, f: t > .5 && t < .54 ? 466.16 : t > .7 ? 455 : 440, rms: .2 });
const w = transcribe(wob, 0.01, P);
assert.strictEqual(w.length, 1); assert.strictEqual(w[0].n, 69); assert(w[0].e - w[0].s > 0.95);

// pin: bpm 120 (0.5s/beat), quarter grid. 2.2-beat note -> half, 1.6-beat note starting at beat 2.4 -> beat 2, quarter
const q = quantize([{ n: 60, s: 1, e: 2.1, v: 80 }, { n: 62, s: 2.2, e: 2.6, v: 80 }], 120, 1);
assert.deepStrictEqual(q.map(n => [n.s, n.e]), [[1, 2], [2, 2.5]]);
assert.strictEqual(quantize(notes, 120, 0), notes); // off = passthrough
assert.deepStrictEqual([...toMidi(q, 100).slice(26, 29)], [0x09, 0x27, 0xC0]); // tempo meta

// fading tail: loud 0.4s of A4, then 0.3s quiet (4% level) whose pitch sagged to G#4 => one note, not two
const tl = []; for (let t = 0; t < .7; t += 0.016) tl.push(t < .4 ? { t, f: 440, rms: .3 } : { t, f: 415.3, rms: .012 });
assert.strictEqual(transcribe(tl, 0.01, P).length, 1);
assert.strictEqual(transcribe(tl, 0.01, { ...P, tail: 0 }).length, 2); // knob off = old behavior

// onset mode: pitch moving inside ONE sound => one note; attack overshoot (466 first 0.2s, then 440) => avg 69, attack 70
const g1 = []; for (let t = 0; t < .8; t += 0.016) g1.push({ t, f: t < .2 ? 466.16 : 440, rms: .2 });
assert.deepStrictEqual(transcribe(g1, 0.01).map(n => n.n), [69]);
assert.deepStrictEqual(transcribe(g1, 0.01, { src: 'attack' }).map(n => n.n), [70]);
assert.strictEqual(transcribe(wob, 0.01, P).length, 1);
// onset mode: same pitch twice with a loudness dip between (da-da) => two notes
const dd = []; for (let t = 0; t < 1; t += 0.016) dd.push({ t, f: 440, rms: t > .45 && t < .5 ? .05 : .3 });
assert.deepStrictEqual(transcribe(dd, 0.01).map(n => n.n), [69, 69]);

console.log('ok', notes.map(n => n.n));
