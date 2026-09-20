export type AsteroidImpactPcm = { left: Float32Array; right: Float32Array };
export type AsteroidImpactPlayer = {
  play(gold: boolean): () => void;
  cancel(): void;
  dispose(): void;
};

type Timbre = "wood" | "star" | "glass" | "pulse";
type Note = {
  kind: Timbre;
  pitch: number;
  at: number;
  gain: number;
  pan: number;
  drift?: number;
  bloom?: boolean;
};
const SECONDS = 5;
const TAU = 2 * Math.PI;
const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

/** Five seconds of authored PCM. No context, graph, clock, timers or randomness outside this render. */
export function renderAsteroidImpact(
  sampleRate: number,
  gold: boolean,
): AsteroidImpactPcm {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new RangeError(
      "Impact audio requires an integer sample rate from 8,000 to 192,000 Hz.",
    );
  const frames = sampleRate * SECONDS;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  // The first pulse settles into D; the fracture and its echoes use the radio's
  // wood/star/glass family. Later notes are part of the tail, not a new impact.
  const notes: Note[] = [
    { kind: "pulse", pitch: 38, at: 0, gain: 0.92, pan: -0.03 },
    { kind: "pulse", pitch: 26, at: 0.002, gain: 0.44, pan: 0.03 },
    { kind: "wood", pitch: 50, at: 0.004, gain: 0.31, pan: -0.17 },
    { kind: "wood", pitch: 57, at: 0.013, gain: 0.16, pan: 0.21 },
    { kind: "star", pitch: 78, at: 0.006, gain: 0.105, pan: -0.32 },
    { kind: "star", pitch: 81, at: 0.026, gain: 0.075, pan: 0.39 },
    {
      kind: "glass",
      pitch: 74,
      at: 0.018,
      gain: 0.08,
      pan: -0.43,
      drift: 0.25,
    },
    {
      kind: "glass",
      pitch: 69,
      at: 0.059,
      gain: 0.07,
      pan: 0.41,
      drift: -0.28,
    },
    {
      kind: "glass",
      pitch: 76,
      at: 0.29,
      gain: 0.04,
      pan: 0.28,
      drift: -0.4,
      bloom: true,
    },
    {
      kind: "glass",
      pitch: 81,
      at: 0.73,
      gain: 0.021,
      pan: -0.34,
      drift: 0.46,
      bloom: true,
    },
    {
      kind: "glass",
      pitch: 74,
      at: 1.31,
      gain: 0.019,
      pan: 0.37,
      drift: -0.48,
      bloom: true,
    },
  ];
  if (gold) {
    for (const note of notes) note.gain *= note.kind === "glass" ? 1.35 : 1.12;
    notes.push(
      { kind: "wood", pitch: 54, at: 0.008, gain: 0.21, pan: -0.24 },
      { kind: "star", pitch: 86, at: 0.011, gain: 0.14, pan: 0.47 },
      { kind: "star", pitch: 90, at: 0.043, gain: 0.075, pan: -0.51 },
      {
        kind: "glass",
        pitch: 78,
        at: 0.041,
        gain: 0.105,
        pan: 0.51,
        drift: -0.58,
      },
      {
        kind: "glass",
        pitch: 81,
        at: 0.098,
        gain: 0.088,
        pan: -0.53,
        drift: 0.61,
      },
      {
        kind: "glass",
        pitch: 86,
        at: 0.24,
        gain: 0.047,
        pan: 0.18,
        drift: -0.66,
        bloom: true,
      },
      {
        kind: "glass",
        pitch: 90,
        at: 0.57,
        gain: 0.031,
        pan: -0.37,
        drift: 0.59,
        bloom: true,
      },
      {
        kind: "glass",
        pitch: 88,
        at: 1.07,
        gain: 0.025,
        pan: 0.52,
        drift: -0.42,
        bloom: true,
      },
      {
        kind: "glass",
        pitch: 81,
        at: 1.69,
        gain: 0.024,
        pan: -0.48,
        drift: 0.58,
        bloom: true,
      },
    );
  }
  for (const note of notes) {
    const glass = note.kind === "glass",
      star = note.kind === "star",
      pulse = note.kind === "pulse";
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
    // Preserve ambient-journey.ts trigger() partial ratios and damping; the
    // impact has a quicker strike and its own quiet, slowly opening glass tail.
    const ratio = glass || pulse ? 2 : star ? 3.98 : 2.76;
    let a = note.gain;
    let b = note.gain * (glass ? 0.24 : pulse ? 0.07 : star ? 0.13 : 0.09);
    let c = note.gain * (glass ? 0.09 : star ? 0.022 : 0.012);
    if (frequency * ratio > sampleRate * 0.43) b = 0;
    if (frequency * 5.4 > sampleRate * 0.43) c = 0;
    const da = Math.exp(
      -1 / (sampleRate * (glass ? 2.65 : pulse ? 0.31 : star ? 0.58 : 0.48)),
    );
    const db = Math.exp(
      -1 / (sampleRate * (glass ? 1.55 : star ? 0.16 : 0.12)),
    );
    const dc = Math.exp(-1 / (sampleRate * (glass ? 0.95 : 0.07)));
    const attack =
      sampleRate *
      (note.bloom
        ? 0.21
        : glass
          ? 0.014
          : star
            ? 0.005
            : pulse
              ? 0.007
              : 0.008);
    const endPan = Math.max(-0.8, Math.min(0.8, note.pan + (note.drift ?? 0)));
    const panL = Math.cos(((note.pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((note.pan + 1) * Math.PI) / 4);
    const driftL = Math.cos(((endPan + 1) * Math.PI) / 4) - panL;
    const driftR = Math.sin(((endPan + 1) * Math.PI) / 4) - panR;
    const step = (TAU * frequency) / sampleRate;
    const onset = Math.round(note.at * sampleRate);
    // A small downward pitch sweep adds weight, settling onto the chord tone.
    let bend = pulse ? 0.38 : 0;
    const bendDecay = Math.exp(-1 / (sampleRate * 0.028));
    let phase = 0;
    for (let frame = onset, age = 0; frame < frames; frame++, age++) {
      const value =
        smooth(age / attack) *
        (a * Math.sin(phase) +
          b * Math.sin(phase * ratio) +
          c * Math.sin(phase * 5.4));
      const travel = smooth(age / (sampleRate * 3.4));
      left[frame] += value * (panL + driftL * travel);
      right[frame] += value * (panR + driftR * travel);
      phase += step * (1 + bend);
      bend *= bendDecay;
      a *= da;
      b *= db;
      c *= dc;
    }
  }

  // A short, low-passed air fracture supplies texture without filling the
  // musical tail with broadband noise. Both channels are deterministic.
  let seed = 0x51a7f00d;
  const noise = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2147483648 - 1;
  };
  const fast = 1 - Math.exp((-TAU * 2600) / sampleRate);
  const low = 1 - Math.exp((-TAU * 180) / sampleRate);
  let fastL = 0,
    fastR = 0,
    lowL = 0,
    lowR = 0;
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / sampleRate;
    const a = noise(),
      b = noise();
    fastL += fast * (a - fastL);
    fastR += fast * (b - fastR);
    lowL += low * (a - lowL);
    lowR += low * (b - lowR);
    const envelope =
      smooth(time / 0.006) *
      (gold ? 1.14 : 1) *
      (0.3 * Math.exp(-time / 0.12) + 0.028 * Math.exp(-time / 0.4));
    left[frame] += envelope * (fastL - lowL);
    right[frame] += envelope * (fastR - lowR);
  }

  // Irregular stereo reflections are damped as they recirculate. This is baked
  // diffusion, not an extra live convolver or an unbounded reverb voice.
  const delays = [0.073, 0.113, 0.191, 0.283].map((seconds) =>
    Math.round(sampleRate * seconds),
  );
  const damping = 1 - Math.exp((-TAU * (gold ? 2900 : 2300)) / sampleRate);
  let reflectedA = 0,
    reflectedB = 0,
    reflectedC = 0,
    reflectedD = 0;
  const spread = gold ? 1.12 : 1;
  for (let frame = 0; frame < frames; frame++) {
    reflectedA +=
      damping *
      ((frame >= delays[0] ? right[frame - delays[0]] : 0) - reflectedA);
    reflectedB +=
      damping *
      ((frame >= delays[1] ? left[frame - delays[1]] : 0) - reflectedB);
    reflectedC +=
      damping *
      ((frame >= delays[2] ? left[frame - delays[2]] : 0) - reflectedC);
    reflectedD +=
      damping *
      ((frame >= delays[3] ? right[frame - delays[3]] : 0) - reflectedD);
    left[frame] += spread * (0.19 * reflectedA - 0.115 * reflectedC);
    right[frame] += spread * (0.19 * reflectedB - 0.115 * reflectedD);
  }
  let peak = 0;
  const silentFrames = Math.max(1, Math.round(sampleRate * 0.004));
  for (let frame = 0; frame < frames; frame++) {
    const fade =
      smooth(frame / (sampleRate * 0.005)) *
      smooth((frames - 1 - silentFrames - frame) / (sampleRate * 0.6));
    left[frame] *= fade;
    right[frame] *= fade;
    peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
  }
  const normalization = peak > 0 ? (gold ? 0.4 : 0.29) / peak : 0;
  for (let frame = 0; frame < frames; frame++) {
    left[frame] *= normalization;
    right[frame] *= normalization;
  }
  return { left, right };
}

/** Cache both sounds in the existing graph; a single source/gain group may be connected. */
export function createAsteroidImpactPlayer(
  context: BaseAudioContext,
  output: AudioNode,
): AsteroidImpactPlayer {
  const makeBuffer = (gold: boolean) => {
    const pcm = renderAsteroidImpact(context.sampleRate, gold);
    const buffer = context.createBuffer(2, pcm.left.length, context.sampleRate);
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    return buffer;
  };
  let buffers: [AudioBuffer, AudioBuffer] | null = [
    makeBuffer(false),
    makeBuffer(true),
  ];
  type Voice = {
    source: AudioBufferSourceNode;
    gain: GainNode;
    cleaned: boolean;
    cancelling: boolean;
  };
  let active: Voice | null = null;
  let disposed = false;
  const finish = (voice: Voice, stop: boolean) => {
    if (voice.cleaned) return;
    voice.cleaned = true;
    voice.source.onended = null;
    if (active === voice) active = null;
    if (stop) {
      try {
        voice.source.stop();
      } catch {
        /* Already ended or never started. */
      }
    }
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.source.buffer = null;
  };
  const cancelVoice = (voice: Voice) => {
    if (voice.cleaned || active !== voice) return;
    if (context.state !== "running") {
      finish(voice, true);
      return;
    }
    if (voice.cancelling) return;
    voice.cancelling = true;
    const now = context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.008);
      // Audio-clock cleanup, with no JS timer or accumulating retired groups.
      voice.source.stop(now + 0.008);
    } catch {
      finish(voice, true);
    }
  };
  return {
    play(gold) {
      if (disposed || !buffers || context.state !== "running") {
        if (active) finish(active, true);
        return () => {};
      }
      if (active) finish(active, true);
      const source = context.createBufferSource();
      const gain = context.createGain();
      const voice: Voice = { source, gain, cleaned: false, cancelling: false };
      active = voice;
      try {
        source.buffer = buffers[gold ? 1 : 0];
        gain.gain.setValueAtTime(1, context.currentTime);
        source.connect(gain);
        gain.connect(output);
        source.onended = () => finish(voice, false);
        source.start(context.currentTime);
      } catch {
        finish(voice, true);
      }
      return () => cancelVoice(voice);
    },
    cancel() {
      if (active) cancelVoice(active);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) finish(active, true);
      buffers = null;
    },
  };
}
