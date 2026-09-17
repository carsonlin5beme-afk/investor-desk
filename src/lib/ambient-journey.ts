export type JourneyNote = {
  beat: number;
  note: number;
  kind: "wood" | "star" | "glass" | "pulse";
  gain: number;
  duration: number;
  pan: number;
};

export const journey = {
  title: "The Long Way Home",
  bpm: 72,
  beats: 192,
  seconds: 160,
  voiceLimit: 24,
  motif: [62, 66, 69, 76, 71], // D4, F#4, A4, E5, B4.
  sections: [
    "Departure",
    "Open sky",
    "The nebula",
    "First light",
    "Turning home",
    "Homecoming",
  ],
  chords: [
    [50, 57, 64, 66],
    [47, 54, 57, 62],
    [43, 54, 57, 59],
    [45, 52, 57, 59],
    [47, 54, 62, 66],
    [43, 55, 59, 62],
    [50, 57, 64, 66],
    [43, 54, 59, 66],
    [47, 54, 57, 62],
    [45, 52, 59, 64],
    [50, 57, 62, 66],
    [50, 57, 64, 66],
  ],
} as const;

/** An authored score, with purposeful rests rather than an endless arpeggiator. */
export function createJourneyScore(): JourneyNote[] {
  const notes: JourneyNote[] = [];
  const add = (
    kind: JourneyNote["kind"],
    beat: number,
    note: number,
    gain: number,
    duration: number,
    pan: number,
  ) => notes.push({ kind, beat, note, gain, duration, pan });
  const phrase = (
    beat: number,
    melody: readonly number[],
    kind: "wood" | "glass",
    gain: number,
    stretch = 1,
  ) => {
    const rhythm = [0, 1.5, 3, 5.25, 7];
    const touch = [0.86, 0.68, 0.79, 1, 0.64];
    melody.forEach((note, index) =>
      add(
        kind,
        beat + rhythm[index] * stretch + [0, 0.018, -0.012, 0.025, 0.01][index],
        note,
        gain * touch[index],
        kind === "glass" ? 5.2 : 2.1,
        [-0.36, -0.12, 0.18, 0.38, 0.04][index],
      ),
    );
  };

  // Departure: a small signal establishes the melody, with space to hear its tail.
  phrase(3, journey.motif, "wood", 0.066);
  phrase(19, [62, 66, 69, 74, 71], "wood", 0.059);
  add("glass", 11.5, 69, 0.029, 6.4, 0.32);
  add("star", 28, 86, 0.033, 2.8, -0.42);
  // Open sky: the same contour becomes a call and a distant answer.
  phrase(34, journey.motif, "wood", 0.07);
  phrase(50, [59, 62, 66, 73, 69], "wood", 0.063);
  phrase(42.5, [74, 78, 81, 88, 83], "glass", 0.027, 0.75);
  // The nebula: wider spacing, softer attacks, and a quiet bar before arrival.
  phrase(66, [66, 69, 71, 78, 74], "glass", 0.035, 1.4);
  phrase(80, [62, 66, 69, 76, 71], "wood", 0.047, 1.2);
  // First light: the original signal blooms, answered an octave above.
  phrase(98, journey.motif, "wood", 0.075);
  phrase(107, [74, 78, 81, 88, 83], "glass", 0.035, 0.85);
  phrase(115, [67, 71, 74, 81, 76], "wood", 0.067);
  // Turning home: the falling answer recedes, leaving the familiar motif intact.
  phrase(132, [71, 69, 66, 64, 62], "glass", 0.031, 1.2);
  phrase(148, [62, 66, 69, 76, 71], "wood", 0.06);
  phrase(163, journey.motif, "wood", 0.058, 1.2);
  phrase(177, [74, 78, 81, 76, 74], "glass", 0.024, 0.9);

  // High wooden/glass stars are accents, not a constant bright ostinato.
  [
    [37, 86],
    [45.75, 90],
    [55.5, 88],
    [61, 83],
    [70.5, 90],
    [76.75, 93],
    [86, 88],
    [99.5, 86],
    [103.25, 90],
    [111, 93],
    [118.75, 95],
    [124, 90],
    [135.5, 88],
    [143, 83],
    [153.5, 86],
    [166.5, 90],
    [173, 88],
    [183.5, 86],
  ].forEach(([beat, note], index) =>
    add(
      "star",
      beat,
      note,
      0.031 + (index % 3) * 0.004,
      2.8,
      index % 2 ? 0.52 : -0.48,
    ),
  );
  // Low propulsion enters gradually, rests in the nebula and leaves before home.
  for (let bar = 8; bar < 40; bar++) {
    if ((bar >= 20 && bar < 24) || bar === 31 || bar === 39) continue;
    const root = journey.chords[Math.floor(bar / 4)][0] - 12;
    const gain = bar >= 24 && bar < 32 ? 0.033 : 0.025;
    add("pulse", bar * 4 + 0.04, root, gain, 1.1, -0.05);
    if (bar % 4 !== 3)
      add(
        "pulse",
        bar * 4 + 2.5,
        root + (bar % 2 ? 7 : 12),
        gain * 0.6,
        0.9,
        0.09,
      );
  }
  return notes.sort((a, b) => a.beat - b.beat);
}

// This module is loaded from a local Blob, never from an external audio service.
// The processor has fixed arrays/voices and does not allocate in its sample loop.
export const journeyProcessorSource = String.raw`
class LongWayHome extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const score = options.processorOptions;
    this.loopFrames = Math.round(score.seconds * sampleRate);
    this.events = score.notes.map(n => ({ ...n, frame: Math.round(n.beat * 60 / score.bpm * sampleRate) }));
    this.chords = score.chords;
    this.chordFrames = this.loopFrames / this.chords.length;
    this.position = 0;
    this.nextEvent = 0;
    this.loops = 0;
    this.running = true;
    this.dropped = 0;
    this.peakVoices = 0;
    this.notesPlayed = 0;
    this.intro = 0;
    this.seed = 81731;
    this.airFast = 0;
    this.airSlow = 0;
    this.airOther = 0;
    this.fastCoefficient = 1 - Math.exp(-2 * Math.PI * 700 / sampleRate);
    this.slowCoefficient = 1 - Math.exp(-2 * Math.PI * 30 / sampleRate);
    this.otherCoefficient = 1 - Math.exp(-2 * Math.PI * 130 / sampleRate);
    this.travel = 0;
    this.breath = 0;
    this.bank = 0;
    this.levels = new Float32Array([.76, .93, .79, 1.12, .92, .76]);
    this.chordIndex = -1;
    this.fade = 1;
    this.padPhases = new Float64Array(16);
    this.padFrequency = new Float64Array(8);
    this.padLeft = new Float64Array(4);
    this.padRight = new Float64Array(4);
    this.wave = new Float32Array(4097);
    for (let i = 0; i <= 4096; i++) this.wave[i] = Math.sin(i * Math.PI * 2 / 4096);
    for (let i = 0; i < 8; i++) this.padFrequency[i] = 440 * Math.pow(2, (this.chords[0][i % 4] - 69) / 12);
    for (let i = 0; i < 16; i++) this.padPhases[i] = (i * .137) % 1;
    for (let i = 0; i < 4; i++) {
      const p = [-.58, -.19, .21, .56][i];
      this.padLeft[i] = Math.cos((p + 1) * Math.PI / 4);
      this.padRight[i] = Math.sin((p + 1) * Math.PI / 4);
    }
    this.voices = Array.from({ length: score.voiceLimit }, () => ({ active: false, age: 0, duration: 0, phase: 0, partial: 0, shimmer: 0, frequency: 0, a: 0, b: 0, c: 0, da: 0, db: 0, dc: 0, attack: 0, release: 0, left: 0, right: 0, kind: '' }));
    this.port.onmessage = event => {
      if (event.data === 'stop') this.running = false;
      if (event.data === 'stats') this.port.postMessage(this.stats());
    };
  }
  stats() {
    return { loops: this.loops, position: this.position / sampleRate, voiceSlots: this.voices.length, peakVoices: this.peakVoices, droppedNotes: this.dropped, notesPlayed: this.notesPlayed, scoreEvents: this.events.length, wavetableBytes: this.wave.byteLength, padOscillators: 16 };
  }
  sine(phase) {
    phase -= Math.floor(phase);
    const x = phase * 4096, i = Math.floor(x);
    return this.wave[i] + (this.wave[i + 1] - this.wave[i]) * (x - i);
  }
  smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  trigger(note) {
    let voice = null;
    for (let i = 0; i < this.voices.length; i++) if (!this.voices[i].active) { voice = this.voices[i]; break; }
    if (!voice) { this.dropped++; return; }
    const star = note.kind === 'star', glass = note.kind === 'glass', pulse = note.kind === 'pulse';
    voice.active = true; voice.kind = note.kind; voice.age = 0;
    voice.duration = Math.round(note.duration * sampleRate);
    voice.phase = voice.partial = voice.shimmer = 0;
    voice.frequency = 440 * Math.pow(2, (note.note - 69) / 12) / sampleRate;
    voice.a = note.gain;
    voice.b = note.gain * (glass ? .24 : pulse ? .07 : star ? .13 : .09);
    voice.c = note.gain * (glass ? .09 : star ? .022 : .012);
    voice.ratio = glass || pulse ? 2 : star ? 3.98 : 2.76;
    if (voice.frequency * voice.ratio > .43) voice.b = 0;
    if (voice.frequency * 5.4 > .43) voice.c = 0;
    voice.da = Math.exp(-1 / (sampleRate * (glass ? 3.8 : pulse ? .29 : star ? .68 : .52)));
    voice.db = Math.exp(-1 / (sampleRate * (glass ? 1.9 : star ? .16 : .12)));
    voice.dc = Math.exp(-1 / (sampleRate * (glass ? 1.2 : .07)));
    voice.attack = sampleRate * (glass ? .72 : pulse ? .065 : star ? .016 : .024);
    voice.release = sampleRate * (glass ? 1.4 : .22);
    voice.left = Math.cos((note.pan + 1) * Math.PI / 4);
    voice.right = Math.sin((note.pan + 1) * Math.PI / 4);
    this.notesPlayed++;
  }
  process(_inputs, outputs) {
    if (!this.running) return false;
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const left = output[0], right = output[1] || output[0];
    for (let i = 0; i < left.length; i++) {
      if (this.position >= this.loopFrames) {
        this.position = 0; this.nextEvent = 0; this.chordIndex = -1; this.loops++;
        this.port.postMessage(this.stats());
      }
      const chord = Math.min(this.chords.length - 1, Math.floor(this.position / this.chordFrames));
      if (chord !== this.chordIndex) {
        this.chordIndex = chord; this.bank = 1 - this.bank; this.fade = 0;
        for (let p = 0; p < 4; p++) this.padFrequency[this.bank * 4 + p] = 440 * Math.pow(2, (this.chords[chord][p] - 69) / 12);
      }
      while (this.nextEvent < this.events.length && this.events[this.nextEvent].frame <= this.position) this.trigger(this.events[this.nextEvent++]);
      this.fade = Math.min(1, this.fade + 1 / (sampleRate * 3.6));
      this.intro = Math.min(1, this.intro + 1 / (sampleRate * 2.8));
      const blend = this.smooth(this.fade);
      const section = Math.floor(chord / 2);
      const levels = this.levels;
      const sectionAge = (this.position / sampleRate) % (160 / 6);
      const sectionBlend = this.smooth(sectionAge / 4);
      const dynamic = levels[(section + 5) % 6] * (1 - sectionBlend) + levels[section] * sectionBlend;
      const breath = .9 + .1 * this.sine(this.breath);
      const travel = this.sine(this.travel) * .06;
      const introduction = this.smooth(this.intro);
      let l = 0, r = 0;
      for (let p = 0; p < 8; p++) {
        const voice = p % 4, base = p * 2;
        const a = this.padPhases[base], b = this.padPhases[base + 1];
        const wave = (this.sine(a) + .32 * this.sine(b) + .1 * this.sine(a * 2)) / 1.42;
        const bankGain = Math.floor(p / 4) === this.bank ? blend : 1 - blend;
        const sample = wave * bankGain * .039 * dynamic * breath * introduction;
        l += sample * (this.padLeft[voice] - travel);
        r += sample * (this.padRight[voice] + travel);
        this.padPhases[base] = (a + this.padFrequency[p] / sampleRate) % 1;
        this.padPhases[base + 1] = (b + this.padFrequency[p] * (voice % 2 ? 1.0013 : .9989) / sampleRate) % 1;
      }
      let active = 0;
      for (let v = 0; v < this.voices.length; v++) {
        const voice = this.voices[v]; if (!voice.active) continue;
        if (voice.age >= voice.duration) { voice.active = false; continue; }
        active++;
        const shape = this.smooth(voice.age / voice.attack) * this.smooth((voice.duration - voice.age - 1) / voice.release);
        const sample = shape * (voice.a * this.sine(voice.phase) + voice.b * this.sine(voice.partial) + voice.c * this.sine(voice.shimmer));
        l += sample * voice.left; r += sample * voice.right;
        voice.phase = (voice.phase + voice.frequency) % 1;
        voice.partial = (voice.partial + voice.frequency * voice.ratio) % 1;
        voice.shimmer = (voice.shimmer + voice.frequency * 5.4) % 1;
        voice.a *= voice.da; voice.b *= voice.db; voice.c *= voice.dc; voice.age++;
      }
      this.peakVoices = Math.max(this.peakVoices, active);
      this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
      const noise = (this.seed >>> 0) / 2147483648 - 1;
      this.airFast += this.fastCoefficient * (noise - this.airFast);
      this.airSlow += this.slowCoefficient * (noise - this.airSlow);
      this.airOther += this.otherCoefficient * (noise - this.airOther);
      const air = (this.airFast - this.airSlow) * .010 * dynamic * introduction;
      l += air; r += (air * .6 + this.airOther * .004 * dynamic) * introduction;
      left[i] = l; right[i] = r;
      this.travel = (this.travel + .008 / sampleRate) % 1;
      this.breath = (this.breath + .023 / sampleRate) % 1;
      this.position++;
    }
    return true;
  }
}
registerProcessor('investor-desk-long-way-home-v1', LongWayHome);
`;
