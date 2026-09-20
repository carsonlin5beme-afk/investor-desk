import { journey } from "./ambient-journey";

export const blastLaunchSeconds = 2.8;
export type BlastLaunchPcm = { left: Float32Array; right: Float32Array };
export type BlastLaunchSelection = {
  chordIndex: number;
  phaseSeconds: number;
  overlap: "previous" | "next" | null;
  chordPitchClasses: number[];
  overlapPitchClasses: number[];
  pitchClass: number;
  pitches: [number, number, number];
  key: string;
};
export type BlastLaunchPlayer = {
  play(elapsedSeconds: number): () => void;
  cancel(): void;
  dispose(): void;
};

const CHORD_SECONDS = journey.seconds / journey.chords.length;
// Matches the pad-bank blend in ambient-journey.ts; the worklet clock supplies elapsed time.
const PAD_CROSSFADE_SECONDS = 3.6;
const classes = (chord: readonly number[]) => [
  ...new Set(chord.map((pitch) => pitch % 12)),
];

/** Use one shared tone during a pad blend or an upcoming chord crossing. */
export function selectBlastLaunchChord(
  elapsedSeconds: number,
): BlastLaunchSelection {
  const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const remainder = elapsed % journey.seconds;
  const position = remainder < 0 ? remainder + journey.seconds : remainder;
  const chordIndex = Math.min(
    journey.chords.length - 1,
    Math.floor(position / CHORD_SECONDS),
  );
  const phaseSeconds = position - chordIndex * CHORD_SECONDS;
  const chord = journey.chords[chordIndex];
  const chordPitchClasses = classes(chord);
  let overlap: BlastLaunchSelection["overlap"] = null;
  let earlier: readonly number[] = chord,
    later: readonly number[] = chord;
  if (phaseSeconds < PAD_CROSSFADE_SECONDS) {
    overlap = "previous";
    earlier =
      journey.chords[
        (chordIndex + journey.chords.length - 1) % journey.chords.length
      ];
  } else if (phaseSeconds + blastLaunchSeconds >= CHORD_SECONDS) {
    overlap = "next";
    later = journey.chords[(chordIndex + 1) % journey.chords.length];
  }
  const shared = overlap
    ? classes(earlier).filter((pitch) => classes(later).includes(pitch))
    : [];
  // Every transition in this score has a shared tone. Fail explicitly if that contract changes.
  if (overlap && !shared.length)
    throw new Error("Journey transition has no shared launch tone.");
  const pitchClass = overlap
    ? shared.includes(later[0] % 12)
      ? later[0] % 12
      : shared.includes(earlier[0] % 12)
        ? earlier[0] % 12
        : shared[0]
    : chord[0] % 12;
  return {
    chordIndex,
    phaseSeconds,
    overlap,
    chordPitchClasses,
    overlapPitchClasses: shared,
    pitchClass,
    pitches: [36 + pitchClass, 60 + pitchClass, 72 + pitchClass],
    key: String(pitchClass),
  };
}

const TAU = Math.PI * 2;
const wave = Float32Array.from({ length: 4097 }, (_, index) =>
  Math.sin((TAU * index) / 4096),
);
const sine = (phase: number) => {
  const position = phase * 4096,
    index = Math.floor(position);
  return wave[index] + (wave[index + 1] - wave[index]) * (position - index);
};
const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

/** A pitched glass strike with octave glints and its complete stereo tail baked in. */
export function renderBlastLaunch(
  sampleRate: number,
  elapsedSeconds: number,
): BlastLaunchPcm {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new RangeError(
      "Launch audio requires an integer sample rate from 8,000 to 192,000 Hz.",
    );
  const frames = Math.round(sampleRate * blastLaunchSeconds);
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  const { pitches } = selectBlastLaunchChord(elapsedSeconds);
  const notes = [
    {
      kind: "glass",
      pitch: pitches[2] + 12,
      at: 0,
      gain: 1,
      pan: -0.04,
      attack: 0.008,
      decay: 0.62,
    },
    {
      kind: "glass",
      pitch: pitches[2],
      at: 0,
      gain: 0.2,
      pan: 0.1,
      attack: 0.011,
      decay: 0.82,
    },
    {
      kind: "star",
      pitch: pitches[2] + 12,
      at: 0,
      gain: 0.14,
      pan: 0.22,
      attack: 0.006,
      decay: 0.15,
    },
    {
      kind: "star",
      pitch: pitches[2] + 24,
      at: 0.15,
      gain: 0.035,
      pan: -0.55,
      attack: 0.01,
      decay: 0.26,
    },
    {
      kind: "glass",
      pitch: pitches[2],
      at: 0.29,
      gain: 0.08,
      pan: -0.6,
      attack: 0.06,
      decay: 0.8,
    },
    {
      kind: "star",
      pitch: pitches[2] + 12,
      at: 0.57,
      gain: 0.06,
      pan: 0.7,
      attack: 0.08,
      decay: 0.63,
    },
    {
      kind: "glass",
      pitch: pitches[2],
      at: 0.99,
      gain: 0.055,
      pan: -0.7,
      attack: 0.12,
      decay: 0.72,
    },
    {
      kind: "glass",
      pitch: pitches[2] + 12,
      at: 1.44,
      gain: 0.028,
      pan: 0.5,
      attack: 0.15,
      decay: 0.42,
    },
  ];
  for (const note of notes) {
    const star = note.kind === "star";
    const step = (440 * 2 ** ((note.pitch - 69) / 12)) / sampleRate;
    // The lead spans D6–B6; octave-only reflections keep the selected chord tone.
    // At low device rates even a glint's fundamental can exceed the alias guard.
    if (step > 0.43) continue;
    // Journey's glass/star ratios, with shorter, softer upper partials for the strike.
    const ratio = star ? 3.98 : 2;
    let a = note.gain,
      b = note.gain * (star ? 0.07 : 0.14),
      c = note.gain * (star ? 0.012 : 0.022);
    if (step * ratio > 0.43) b = 0;
    if (step * 5.4 > 0.43) c = 0;
    const da = Math.exp(-1 / (sampleRate * note.decay));
    const db = Math.exp(-1 / (sampleRate * (star ? 0.08 : 0.22)));
    const dc = Math.exp(-1 / (sampleRate * 0.055));
    const panL = Math.cos(((note.pan + 1) * Math.PI) / 4),
      panR = Math.sin(((note.pan + 1) * Math.PI) / 4);
    const attackFrames = sampleRate * note.attack,
      firstFrame = Math.round(sampleRate * note.at);
    let phase = 0,
      partial = 0,
      shimmer = 0;
    for (let frame = firstFrame; frame < frames; frame++) {
      const age = frame - firstFrame;
      const attack = age < attackFrames ? smooth(age / attackFrames) : 1;
      const value =
        attack * (a * sine(phase) + b * sine(partial) + c * sine(shimmer));
      left[frame] += value * panL;
      right[frame] += value * panR;
      phase += step;
      phase -= Math.floor(phase);
      partial += step * ratio;
      partial -= Math.floor(partial);
      shimmer += step * 5.4;
      shimmer -= Math.floor(shimmer);
      a *= da;
      b *= db;
      c *= dc;
    }
  }
  let seed = 0x1a07c4ed;
  const noise = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2147483648 - 1;
  };
  const fast = 1 - Math.exp((-TAU * 1700) / sampleRate),
    slow = 1 - Math.exp((-TAU * 130) / sampleRate);
  const decay = Math.exp(-1 / (sampleRate * 0.045));
  let fastL = 0,
    fastR = 0,
    slowL = 0,
    slowR = 0,
    air = 0.004;
  const attackFrames = sampleRate * 0.008;
  for (let frame = 0; frame < frames; frame++) {
    const a = noise(),
      b = noise();
    fastL += fast * (a - fastL);
    fastR += fast * (b - fastR);
    slowL += slow * (a - slowL);
    slowR += slow * (b - slowR);
    const envelope =
      air * (frame < attackFrames ? smooth(frame / attackFrames) : 1);
    left[frame] += envelope * (fastL - slowL);
    right[frame] += envelope * (fastR - slowR);
    air *= decay;
  }
  // Unequal, low-pass-filtered reflection paths widen the pitched tail. Their
  // combined feedback is below one, and all recursion ends inside this buffer.
  const delays = [0.037, 0.083, 0.149, 0.053, 0.109, 0.173].map((seconds) =>
    Math.round(sampleRate * seconds),
  );
  const damping = 1 - Math.exp((-TAU * 2100) / sampleRate);
  let reflectedL = 0,
    reflectedR = 0;
  for (let frame = 0; frame < frames; frame++) {
    const incomingL =
      (frame >= delays[0] ? 0.18 * right[frame - delays[0]] : 0) +
      (frame >= delays[1] ? 0.14 * left[frame - delays[1]] : 0) +
      (frame >= delays[2] ? 0.09 * right[frame - delays[2]] : 0);
    const incomingR =
      (frame >= delays[3] ? 0.18 * left[frame - delays[3]] : 0) +
      (frame >= delays[4] ? 0.14 * right[frame - delays[4]] : 0) +
      (frame >= delays[5] ? 0.09 * left[frame - delays[5]] : 0);
    reflectedL += damping * (incomingL - reflectedL);
    reflectedR += damping * (incomingR - reflectedR);
    left[frame] += reflectedL;
    right[frame] += reflectedR;
  }
  let peak = 0;
  const silentFrames = Math.max(1, Math.round(sampleRate * 0.004));
  const releaseFrames = sampleRate * 0.6;
  for (let frame = 0; frame < frames; frame++) {
    const remaining = frames - 1 - silentFrames - frame;
    const release =
      remaining < releaseFrames ? smooth(remaining / releaseFrames) : 1;
    left[frame] *= release;
    right[frame] *= release;
    peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
  }
  const normalization = peak > 0 ? 0.075 / peak : 0;
  for (let frame = 0; frame < frames; frame++) {
    left[frame] *= normalization;
    right[frame] *= normalization;
  }
  return { left, right };
}

/** Prepare the finite pitch-class cache once; play allocates only one source/gain group. */
export function createBlastLaunchPlayer(
  context: BaseAudioContext,
  output: AudioNode,
): BlastLaunchPlayer {
  let buffers: Map<string, AudioBuffer> | null = new Map();
  for (let chord = 0; chord < journey.chords.length; chord++) {
    for (const offset of [0, CHORD_SECONDS / 2, CHORD_SECONDS - 1]) {
      const elapsed = chord * CHORD_SECONDS + offset;
      const { key } = selectBlastLaunchChord(elapsed);
      if (buffers.has(key)) continue;
      const pcm = renderBlastLaunch(context.sampleRate, elapsed);
      const buffer = context.createBuffer(
        2,
        pcm.left.length,
        context.sampleRate,
      );
      buffer.getChannelData(0).set(pcm.left);
      buffer.getChannelData(1).set(pcm.right);
      buffers.set(key, buffer);
    }
  }
  type Voice = {
    source: AudioBufferSourceNode;
    gain: GainNode;
    cleaned: boolean;
    cancelling: boolean;
  };
  let active: Voice | null = null,
    disposed = false;
  const disconnect = (node: AudioNode | null) => {
    try {
      node?.disconnect();
    } catch {
      /* An incomplete graph may already be disconnected. */
    }
  };
  const stop = (source: AudioBufferSourceNode) => {
    try {
      source.stop();
    } catch {
      /* Already ended or never started. */
    }
  };
  const finish = (voice: Voice, shouldStop: boolean) => {
    if (voice.cleaned) return;
    voice.cleaned = true;
    voice.source.onended = null;
    if (active === voice) active = null;
    if (shouldStop) stop(voice.source);
    disconnect(voice.source);
    disconnect(voice.gain);
    voice.source.buffer = null;
  };
  const cancelVoice = (voice: Voice) => {
    if (voice.cleaned || active !== voice) return;
    // A pending fade cannot finish while the context is suspended/interrupted.
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
      voice.source.stop(now + 0.008);
    } catch {
      finish(voice, true);
    }
  };
  return {
    play(elapsedSeconds) {
      if (disposed || !buffers || context.state !== "running") {
        if (active) finish(active, true);
        return () => {};
      }
      if (active) finish(active, true);
      let source: AudioBufferSourceNode | null = null,
        gain: GainNode | null = null,
        voice: Voice | null = null;
      try {
        source = context.createBufferSource();
        gain = context.createGain();
        voice = { source, gain, cleaned: false, cancelling: false };
        active = voice;
        const started = voice;
        source.buffer = buffers.get(
          selectBlastLaunchChord(elapsedSeconds).key,
        )!;
        gain.gain.setValueAtTime(1, context.currentTime);
        source.connect(gain);
        gain.connect(output);
        source.onended = () => finish(started, false);
        source.start(context.currentTime);
        return () => cancelVoice(started);
      } catch {
        if (voice) finish(voice, true);
        else {
          if (source) stop(source);
          disconnect(source);
          disconnect(gain);
        }
        return () => {};
      }
    },
    cancel() {
      if (active) cancelVoice(active);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) finish(active, true);
      buffers?.clear();
      buffers = null;
    },
  };
}
