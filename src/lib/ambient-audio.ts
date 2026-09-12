export type AmbientState =
  | "idle"
  | "starting"
  | "playing"
  | "pausing"
  | "paused"
  | "suspended"
  | "error";

export const initialAmbientVolume = 0.18;
const boundedVolume = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : initialAmbientVolume;

/** Original, continuously evolving D–A–E–B ambience. No recordings or network. */
export function createAmbientGraph(context: BaseAudioContext) {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const start = <T extends AudioScheduledSourceNode>(node: T): T => {
    sources.push(node);
    node.start();
    return node;
  };
  const master = keep(context.createGain());
  master.gain.value = 0;
  master.connect(context.destination);
  const bus = keep(context.createGain());
  const dry = keep(context.createGain());
  dry.gain.value = 0.7;
  bus.connect(dry).connect(master);

  // A deterministic, dark stereo impulse: repeatable evidence from this same graph.
  let seed = 18731;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
  const reverb = keep(context.createConvolver());
  const impulse = context.createBuffer(
    2,
    Math.round(context.sampleRate * 5.5),
    context.sampleRate,
  );
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      smooth = smooth * 0.82 + random() * 0.18;
      samples[i] = smooth * Math.pow(1 - i / samples.length, 2.8);
    }
  }
  reverb.buffer = impulse;
  const wet = keep(context.createGain());
  wet.gain.value = 0.52;
  bus.connect(reverb).connect(wet).connect(master);

  // One slow stereo journey shared by the bed, independent of the sparse stars.
  const travel = keep(context.createOscillator());
  travel.frequency.value = 0.008;
  const travelDepth = keep(context.createGain());
  travelDepth.gain.value = 0.16;
  travel.connect(travelDepth);
  start(travel);

  const frequencies = [73.416, 110, 146.832, 164.814, 220, 246.942, 329.628];
  frequencies.forEach((frequency, index) => {
    const tone = keep(context.createOscillator());
    tone.type = "sine";
    tone.frequency.value = frequency;
    tone.detune.value = [-3, 2, 4, -2, 3, -4, 1][index];
    const level = keep(context.createGain());
    level.gain.value = index < 3 ? 0.032 : 0.026;
    const drift = keep(context.createOscillator());
    drift.frequency.value = 0.013 + index * 0.0043;
    const depth = keep(context.createGain());
    depth.gain.value = index < 3 ? 0.009 : 0.012;
    drift.connect(depth).connect(level.gain);
    const pan = keep(context.createStereoPanner());
    pan.pan.value = (index % 2 ? 1 : -1) * (0.12 + index * 0.03);
    travelDepth.connect(pan.pan);
    tone.connect(level).connect(pan).connect(bus);
    start(tone);
    start(drift);
  });

  const air = keep(context.createBufferSource());
  const noise = context.createBuffer(
    2,
    Math.round(context.sampleRate * 12),
    context.sampleRate,
  );
  for (let channel = 0; channel < 2; channel++) {
    const samples = noise.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      smooth = smooth * 0.94 + random() * 0.06;
      // A long raised-cosine envelope joins the generated loop at exact zero.
      const edge = Math.min(
        1,
        i / context.sampleRate,
        (samples.length - 1 - i) / context.sampleRate,
      );
      samples[i] = smooth * (0.5 - 0.5 * Math.cos(Math.PI * edge));
    }
  }
  air.buffer = noise;
  air.loop = true;
  const airFilter = keep(context.createBiquadFilter());
  airFilter.type = "bandpass";
  airFilter.frequency.value = 650;
  airFilter.Q.value = 0.35;
  const airLevel = keep(context.createGain());
  airLevel.gain.value = 0.065;
  air.connect(airFilter).connect(airLevel).connect(bus);
  start(air);

  // Authored muted mallets: eight passing stars, with no recurring note timers
  // or accumulating voices. 64 s at 24 kHz stereo is a fixed 11.72 MiB buffer.
  const stars = keep(context.createBufferSource());
  const starRate = 24000;
  const starBuffer = context.createBuffer(2, 64 * starRate, starRate);
  const left = starBuffer.getChannelData(0);
  const right = starBuffer.getChannelData(1);
  const onsets = [2.4, 8.9, 17.2, 23, 33.8, 41.1, 49.9, 57];
  const notes = [293.665, 440, 329.628, 493.883, 293.665, 587.33, 440, 329.628];
  onsets.forEach((onset, index) => {
    const length = Math.round(1.6 * starRate);
    const offset = Math.round(onset * starRate);
    for (let i = 0; i < length; i++) {
      const time = i / starRate;
      const attack = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, time / 0.02));
      const tail = Math.min(1, (length - 1 - i) / (starRate * 0.2));
      const taper = 0.5 - 0.5 * Math.cos(Math.PI * tail);
      const phase = 2 * Math.PI * notes[index] * time;
      const sample =
        0.055 *
        attack *
        taper *
        (Math.sin(phase) * Math.exp(-time / 0.42) +
          0.09 * Math.sin(phase * 2.76) * Math.exp(-time / 0.11));
      const progress = i / (length - 1);
      const pan = index % 2 ? 0.4 - 0.9 * progress : -0.5 + 0.9 * progress;
      const angle = ((pan + 1) * Math.PI) / 4;
      left[offset + i] = sample * Math.cos(angle);
      right[offset + i] = sample * Math.sin(angle);
    }
  });
  stars.buffer = starBuffer;
  stars.loop = true;
  const starFilter = keep(context.createBiquadFilter());
  starFilter.type = "lowpass";
  starFilter.frequency.value = 1900;
  starFilter.Q.value = 0.5;
  stars.connect(starFilter).connect(bus);
  start(stars);

  let disposed = false;
  return {
    fadeVolume(value: number, seconds = 0.12) {
      if (disposed) return;
      const now = context.currentTime;
      if (typeof master.gain.cancelAndHoldAtTime === "function")
        master.gain.cancelAndHoldAtTime(now);
      else {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
      }
      master.gain.linearRampToValueAtTime(boundedVolume(value), now + seconds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          /* Already stopped. */
        }
      }
      for (const node of nodes) node.disconnect();
      air.buffer = null;
      stars.buffer = null;
      reverb.buffer = null;
    },
  };
}

type AmbientGraph = ReturnType<typeof createAmbientGraph>;
type EngineDependencies = {
  context: () => AudioContext;
  graph: (context: BaseAudioContext) => AmbientGraph;
};

/** Owns one lazily created context. Audio time handles the sound; timers only finish fades. */
export class AmbientAudio {
  private context: AudioContext | null = null;
  private graph: AmbientGraph | null = null;
  private desired = false;
  private disposed = false;
  private operation = 0;
  private volume = initialAmbientVolume;
  private state: AmbientState = "idle";
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly notify: (state: AmbientState) => void,
    private readonly dependencies: EngineDependencies = {
      context: () => new AudioContext(),
      graph: createAmbientGraph,
    },
  ) {}

  private update(state: AmbientState) {
    this.state = state;
    if (!this.disposed) this.notify(state);
  }
  private clearTimers() {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.pauseTimer = this.startTimer = null;
  }
  private stateChanged = () => {
    const state = this.context?.state as string | undefined;
    if (!this.desired || this.state === "starting" || this.disposed) return;
    if (state !== "running") {
      this.desired = false;
      this.operation++;
      this.clearTimers();
      this.graph?.fadeVolume(0, 0);
      this.update("suspended");
    }
  };

  async play() {
    if (this.disposed || this.desired) return;
    const operation = ++this.operation;
    this.desired = true;
    this.clearTimers();
    this.update("starting");
    try {
      if (this.context?.state === "closed") this.release();
      if (!this.context) {
        this.context = this.dependencies.context();
        this.context.addEventListener("statechange", this.stateChanged);
      }
      const context = this.context;
      this.graph ??= this.dependencies.graph(context);
      // This call is synchronous within the user's click/keypress, before any await.
      const resumed = context.resume();
      this.startTimer = setTimeout(() => {
        if (operation !== this.operation || !this.desired) return;
        this.desired = false;
        this.operation++;
        this.graph?.fadeVolume(0, 0);
        void context.suspend().catch(() => {});
        this.update("suspended");
      }, 5000);
      await resumed;
      if (this.disposed || operation !== this.operation) {
        if (!this.desired && context.state === "running")
          await context.suspend();
        return;
      }
      this.clearTimers();
      if (context.state !== "running") {
        this.desired = false;
        this.update("suspended");
        return;
      }
      this.graph.fadeVolume(this.volume, 1.6);
      this.update("playing");
    } catch {
      if (this.disposed || operation !== this.operation) return;
      this.desired = false;
      this.clearTimers();
      this.release();
      this.update("error");
    }
  }

  pause() {
    if (this.disposed) return;
    const operation = ++this.operation;
    this.desired = false;
    this.clearTimers();
    if (!this.context || this.context.state !== "running") {
      this.graph?.fadeVolume(0, 0);
      this.update("paused");
      return;
    }
    this.graph?.fadeVolume(0, 0.3);
    this.update("pausing");
    this.pauseTimer = setTimeout(async () => {
      if (operation !== this.operation || this.disposed) return;
      try {
        await this.context?.suspend();
        if (operation === this.operation) this.update("paused");
      } catch {
        if (operation === this.operation) {
          this.release();
          this.update("paused");
        }
      }
    }, 340);
  }

  setVolume(value: number) {
    this.volume = boundedVolume(value);
    if (
      this.desired &&
      this.context?.state === "running" &&
      this.state === "playing"
    )
      this.graph?.fadeVolume(this.volume);
  }

  private release() {
    const context = this.context;
    context?.removeEventListener("statechange", this.stateChanged);
    this.graph?.dispose();
    this.graph = null;
    this.context = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = false;
    this.operation++;
    this.clearTimers();
    this.release();
  }
}
