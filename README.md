# mic2midi

Hum, whistle or scat into your mic and get a MIDI file you can drop into a DAW.

Runs as a small standalone window: no install, no dependencies, everything stays on your machine.

## Run

```
python3 mic2midi.py
```

Needs Python 3 and Chrome, Chromium or Edge on `PATH`. The launcher serves the folder on a random localhost port, opens it as an app window, and quits when you close the window. Mic permission is remembered in `~/.cache/mic2midi-profile`.

(Without the launcher: `python3 -m http.server`, then open `http://localhost:8000` in Chrome. ES modules need http, so opening `index.html` directly won't work.)

## Use

1. **Record** (Pause / Resume / Stop). The green waveform and the piano roll build up live on a shared time axis.
2. Tune the controls below. Everything re-transcribes instantly after you stop, so you never need to re-record to try settings.
3. **Play MIDI** to hear the result (simple synth).
4. **Save .mid…** to choose where to write the file (Chrome/Edge show a save dialog).

## Controls

| Control | What it does |
|---|---|
| **Noise gate** | Sound below the dashed lines on the waveform counts as silence. Raise for noisy rooms. |
| **Smoothing** | Median window, minimum note length and gap bridging. Higher gives fewer, longer, steadier notes. |
| **Tail cutoff** | Sound quieter than this % of a note's recent peak is treated as silence. Whistles sag in pitch as they fade, and this stops that tail becoming a ghost note. 0 = off. |
| **Notes: by sound** | A note starts only at silence or a loudness re-attack. Pitch moving inside a sound is ignored. Best for whistling and scatting. |
| **Notes: by pitch change** | Also splits whenever pitch moves. Best for slurred, legato humming with no gaps. |
| **Pitch from** | *Whole sound*: median pitch over the sound. *Attack*: just the first ~150ms (the note you aimed at). By-sound mode only. |
| **Re-attack** | How much louder than the previous 100ms counts as a new sound. Lower = more sensitive. By-sound mode only. |
| **Pitch snap** | Extra semitones your pitch may drift before the note changes. By-pitch mode only. |
| **Pin lengths** | Snap starts to a grid and lengths to standard note values (16th up to whole, dotted included). The minimum sets the grid. |
| **BPM** | Tempo for pinning. Also written into the `.mid`. Set it to the speed you hummed at. |
| **Transpose** | Shift every note by semitones (12 = one octave). |

The in-app help panel has a diagram for each control.

## How it works

- Pitch: [YIN](http://audition.ircam.fr/publications/yin.pdf) autocorrelation on a 2048-sample window each animation frame (about 50 Hz to 2 kHz). Browser echo cancellation, noise suppression and auto-gain are turned off because they wreck pitch tracking.
- Transcription: frames become notes through voicing/tail gating, onset detection, median smoothing and optional quantizing. See [`core.js`](core.js).
- Output: format-0 Standard MIDI File, 480 PPQ, monophonic, leading silence trimmed.

## Limits

- Monophonic only. One voice at a time.
- Held notes longer than a whole note are capped when pinning; tie them in your DAW.
- Timing comes from animation frames (about 16ms), so don't expect sample-accurate onsets.
- Saving to a chosen location needs Chrome/Edge's File System Access API; other browsers fall back to a plain download.
- Linux-tested only. The launcher itself is plain Python and should work elsewhere if a Chromium browser is on `PATH`.

## Test

```
node test.mjs
```

Synthesizes tones through the real pitch detector and transcriber and asserts notes, wobble handling, tails, onsets, pinning and MIDI bytes.

## License

[MIT](LICENSE)
